import type { SourceCatalogPortV1, SourceSearchPortV1, SourceCatalogMemberV1, SearchScopeV1,
  SourceRangeV1, SourceSearchHitV1, SourceSearchResultV1, IndexCoverageV1 } from '../ports/phase6';
import type { SourceStore } from '../ports/sourceStore';
import type { WorldStore } from '../ports/worldStore';
import { mirrorSourceId } from '../ports/worldStore';
import { assertSourceRange, isSourceSetBindingV1 } from '../../domain/build/validation';
import { CodePointOffsetIndex } from '../../domain/world/textOffsets';
import { LocalSourceSearchIndexBuilder, tokenizeChineseSearchText } from '../search/chineseSourceSearch';
import type { LocalSourceLookupResult, LocalSourceRange, LocalSourcePersistentBackend } from '../search/localSourceSearch';
import { MAX_SOURCE_EVIDENCE_CP, type SourceHashProvider } from './sourceCatalog';
import { PERSISTENT_SOURCE_INDEX_VERSION, SOURCE_INDEX_PAGE_CP,
  type SourceIndexCandidate, type SourceIndexKey, type SourceIndexPage, type SourceIndexStore } from './types';

export interface PersistentSourceSearchOptions {
  maxPagesPerPass?: number;
  maxFallbackScanCp?: number;
  yieldControl?: () => Promise<void>;
  authorizePlayerScope?: (input: { worldId: string; scope: Extract<SearchScopeV1,{kind:'player_known'}> }) => Promise<boolean>;
  onCoverageAdvanced?: (coverage: IndexCoverageV1) => void | Promise<void>;
}
/** Stable postings are separate from changing aliases and query permissions. */
export class PersistentSourceSearchService implements SourceSearchPortV1, LocalSourcePersistentBackend {
  private readonly inFlightPages = new Map<string,Promise<void>>();
  private readonly maxPagesPerPass:number;
  private readonly maxFallbackScanCp:number;
  private readonly yieldControl:()=>Promise<void>;
  constructor(
    private readonly catalog:SourceCatalogPortV1,
    private readonly sources:Pick<SourceStore,'getManifest'|'getChapters'>,
    private readonly worlds:Pick<WorldStore,'listEntities'>,
    private readonly store:SourceIndexStore,
    private readonly hashes:SourceHashProvider,
    private readonly options:PersistentSourceSearchOptions={},
  ) {
    this.maxPagesPerPass=options.maxPagesPerPass??32;
    this.maxFallbackScanCp=options.maxFallbackScanCp??8_192;
    this.yieldControl=options.yieldControl??(() => new Promise(resolve => setTimeout(resolve,0)));
    if (!Number.isSafeInteger(this.maxPagesPerPass)||this.maxPagesPerPass<1
      || !Number.isSafeInteger(this.maxFallbackScanCp)||this.maxFallbackScanCp<0||this.maxFallbackScanCp>65_536)
      throw new Error('source_index_options_invalid');
  }

  async ensureIndexed(ranges:readonly SourceRangeV1[]):Promise<void> {
    let completedPages=0;
    const visited=new Set<string>();
    for (const range of ranges) {
      const key=await this.sourceKey(range.sourceId);
      assertSourceRange(range,key);
      // A caller cannot bind arbitrary coordinates to a fabricated evidence hash.
      await this.catalog.readRange(range);
      let coverage=await this.store.coverage(key);
      for (let start=Math.floor(range.startCp/SOURCE_INDEX_PAGE_CP)*SOURCE_INDEX_PAGE_CP;start<range.endCp;start+=SOURCE_INDEX_PAGE_CP) {
        const end=Math.min(key.codePointCount,start+SOURCE_INDEX_PAGE_CP);
        const pageKey=JSON.stringify([key.sourceId,key.normalizedTreeHash,key.indexVersion,start]);
        if (visited.has(pageKey)||isCovered(coverage,start,end)) continue;
        if (completedPages>=this.maxPagesPerPass) return;
        visited.add(pageKey);
        const running=this.inFlightPages.get(pageKey);
        if (running) await running;
        else {
          const build=this.buildPage(key,start,end).finally(() => this.inFlightPages.delete(pageKey));
          this.inFlightPages.set(pageKey,build);
          await build;
        }
        completedPages+=1;
        await this.yieldControl();
        coverage=await this.store.coverage(key);
        await this.options.onCoverageAdvanced?.(coverage);
      }
    }
  }

  async search(input:{worldId:string;query:string;scope:SearchScopeV1;topK?:number}):Promise<SourceSearchResultV1> {
    const snapshot=await this.catalog.snapshot(input.worldId);
    const scope=input.scope;
    if (!scope||!Array.isArray(scope.allowedRanges)||scope.allowedRanges.length>1_024) throw new Error('source_search_scope_invalid');
    if (scope.kind==='player_known') {
      if (!scope.branchId||!Number.isSafeInteger(scope.stateVersion)||scope.stateVersion<0
        || !validHash(scope.knowledgeSnapshotHash)||!validHash(scope.contentManifestHash)
        || !await this.options.authorizePlayerScope?.({worldId:input.worldId,scope})) throw new Error('source_search_player_scope_denied');
    } else if (scope.kind==='build_internal'||scope.kind==='explicit_source_lookup') {
      if (!isSourceSetBindingV1(scope.sourceBinding)||!await this.catalog.isBindingCompatible(input.worldId,scope.sourceBinding)
        || (scope.kind==='build_internal'&&(!scope.intentId||scope.worldId!==input.worldId))
        || (scope.kind==='explicit_source_lookup'&&(!scope.branchId||!scope.userCommandId))) throw new Error('source_search_binding_invalid');
      if (!scope.allowedRanges.every(range => scope.sourceBinding.members.some(member => member.sourceId===range.sourceId
        && member.normalizedTreeHash===range.normalizedTreeHash))) throw new Error('source_search_binding_invalid');
    } else throw new Error('source_search_scope_invalid');
    for (const range of scope.allowedRanges) {
      const member=snapshot.members.find(value => value.sourceId===range.sourceId);
      if (!member) throw new Error('source_search_membership_invalid');
      assertSourceRange(range,member);
      await this.catalog.readRange(range);
    }
    const result=await this.queryAllowed(input.worldId,input.query,scope.allowedRanges,snapshot.members,clampTopK(input.topK));
    // Permission checks repeat after asynchronous reads. A completed interaction cannot leak a stale query result.
    if (scope.kind==='player_known'&&!await this.options.authorizePlayerScope?.({worldId:input.worldId,scope}))
      throw new Error('source_search_player_scope_changed');
    if (!await this.catalog.isBindingCompatible(input.worldId,snapshot.binding)) throw new Error('source_search_membership_changed');
    return result;
  }

  /** Adapter for the existing caller, whose sourceRanges were already filtered from visible citations. */
  async searchLocal(input:{sourceId:string;worldId:string;query:string;topK?:number;
    sourceRanges?:readonly LocalSourceRange[];signal?:AbortSignal}):Promise<LocalSourceLookupResult> {
    checkAborted(input.signal);
    const snapshot=await this.catalog.snapshot(input.worldId);
    const member=snapshot.members.find(value => value.sourceId===input.sourceId);
    if (!member) throw new Error('source_search_membership_invalid');
    const nativeChapters=await this.sources.getChapters(input.sourceId);
    const ranges:SourceRangeV1[]=[];
    const append=async (start:number,end:number) => {
      for (let cursor=start;cursor<end;cursor+=MAX_SOURCE_EVIDENCE_CP) {
        checkAborted(input.signal);
        ranges.push(await this.catalog.createRange(input.sourceId,cursor,Math.min(end,cursor+MAX_SOURCE_EVIDENCE_CP)));
      }
    };
    if (input.sourceRanges===undefined) await append(0,member.codePointCount);
    else for (const range of input.sourceRanges) {
      const chapter=nativeChapters.find(chapter => chapter.chapterId===range.chapterId
        || mirrorSourceId(member.sourceOrdinal,chapter.chapterId)===range.chapterId);
      if (!chapter||!Number.isSafeInteger(range.startCodePoint)||!Number.isSafeInteger(range.endCodePoint)
        || range.startCodePoint<chapter.startOffset||range.endCodePoint>chapter.endOffset||range.endCodePoint<=range.startCodePoint)
        throw new Error('source_search_range_invalid');
      await append(range.startCodePoint,range.endCodePoint);
    }
    await this.ensureIndexed(ranges);
    checkAborted(input.signal);
    const query=await this.queryAllowed(input.worldId,input.query,ranges,snapshot.members,clampTopK(input.topK));
    const key=await this.sourceKey(input.sourceId);
    const terms=await this.queryTerms(input.worldId,input.query);
    const adjacent:SourceSearchHitV1[]=[];
    for (const hit of query.hits) {
      const nativeChapter=nativeChapters.find(chapter => mirrorSourceId(member.sourceOrdinal,chapter.chapterId)===hit.chapterId);
      const candidates=await this.store.candidates(key,[hit.range],terms.terms,1);
      const candidate=candidates.find(value => value.chapterId===nativeChapter?.chapterId);
      if (!candidate) continue;
      for (const neighbor of await this.store.neighbors(key,candidate,ranges,2-adjacent.length)) {
        const materialized=await this.materialize(key,neighbor,ranges,member,[],false);
        if (materialized&&!query.hits.some(value => sameRange(value.range,materialized.range))
          && !adjacent.some(value => sameRange(value.range,materialized.range))) adjacent.push(materialized);
        if (adjacent.length>=2) break;
      }
      if (adjacent.length>=2) break;
    }
    checkAborted(input.signal);
    if (!await this.catalog.isBindingCompatible(input.worldId,snapshot.binding)) throw new Error('source_search_membership_changed');
    const toPassage=(hit:SourceSearchHitV1) => ({ paragraphId:`${hit.range.sourceId}:${hit.range.startCp}:${hit.range.endCp}`,
      chapterId:hit.chapterId,chapterTitle:member.chapters.find(chapter => chapter.chapterId===hit.chapterId)?.title??hit.chapterId,
      startCodePoint:hit.range.startCp,endCodePoint:hit.range.endCp,text:hit.text });
    return { passages:query.hits.map(toPassage),adjacentPrefetch:adjacent.map(toPassage),coverage:query.coverage,completeness:query.completeness,
      result:{queryTerms:terms.terms,resolvedEntityIds:terms.entityIds,hits:query.hits.map((hit,index) => ({
        paragraphId:`${hit.range.sourceId}:${hit.range.startCp}:${hit.range.endCp}`,chunkId:`persistent:${hit.range.startCp}`,
        chapterId:hit.chapterId,chapterIndex:nativeChapters.find(chapter => mirrorSourceId(member.sourceOrdinal,chapter.chapterId)===hit.chapterId)?.index??0,
        paragraphIndex:index,startCodePoint:hit.range.startCp,endCodePoint:hit.range.endCp,score:hit.score,
        matchedTerms:terms.terms.filter(term => tokenizeChineseSearchText(hit.text).includes(term)),matchedEntityIds:terms.entityIds })),
        adjacentPrefetch:adjacent.map(hit => ({paragraphId:`${hit.range.sourceId}:${hit.range.startCp}:${hit.range.endCp}`,
          chapterId:hit.chapterId,startCodePoint:hit.range.startCp,endCodePoint:hit.range.endCp})),
        searchedParagraphCount:await this.store.countParagraphs(key,ranges),hasMatches:query.hits.length>0 } };
  }

  private async queryAllowed(worldId:string,query:string,ranges:readonly SourceRangeV1[],members:readonly SourceCatalogMemberV1[],topK:number):Promise<SourceSearchResultV1> {
    const terms=await this.queryTerms(worldId,query);
    const hits:SourceSearchHitV1[]=[];
    const coverage:IndexCoverageV1[]=[];
    let complete=true;
    let remainingScan=this.maxFallbackScanCp;
    for (const member of members) {
      const allowed=ranges.filter(range => range.sourceId===member.sourceId);
      if (!allowed.length) continue;
      const key=await this.sourceKey(member.sourceId);
      let indexed=await this.store.coverage(key);
      for (const candidate of await this.store.candidates(key,allowed,terms.terms,64)) {
        const hit=await this.materialize(key,candidate,allowed,member,terms.terms,true);
        if (hit) hits.push(hit);
      }
      indexed=await this.store.coverage(key);
      const missing=missingRanges(allowed,indexed);
      if (missing.length||indexed.corrupt) complete=false;
      // Small required gaps can be scanned without creating a second fact/index pipeline.
      for (const gap of missing) {
        if (gap.endCp-gap.startCp>remainingScan) continue;
        remainingScan-=gap.endCp-gap.startCp;
        const range=await this.catalog.createRange(key.sourceId,gap.startCp,gap.endCp);
        const text=await this.catalog.readRange(range);
        const offsets=new CodePointOffsetIndex(text);
        const chapters=await this.sources.getChapters(key.sourceId);
        for (const chapter of chapters) {
          const start=Math.max(gap.startCp,chapter.startOffset),end=Math.min(gap.endCp,chapter.endOffset);
          if (end<=start) continue;
          const builder=new LocalSourceSearchIndexBuilder();
          builder.addChunk({chunkId:`scan:${start}:${end}`,chapterId:chapter.chapterId,chapterIndex:chapter.index,chunkIndex:0,
            startCodePoint:start,endCodePoint:end,contentHash:range.rangeContentHash,text:offsets.slice(start-gap.startCp,end-gap.startCp)});
          const transient=builder.finish();
          for (const paragraph of transient.paragraphs) {
            const score=scoreTerms(paragraph.termFrequency,terms.terms);
            if (score<=0) continue;
            const evidence=await this.catalog.createRange(key.sourceId,paragraph.startCodePoint,paragraph.endCodePoint);
            hits.push({range:evidence,chapterId:mirrorSourceId(member.sourceOrdinal,chapter.chapterId),score,text:await this.catalog.readRange(evidence)});
          }
        }
        await this.yieldControl();
      }
      coverage.push(indexed);
    }
    const unique=new Map<string,SourceSearchHitV1>();
    for (const hit of hits) unique.set(JSON.stringify([hit.range.sourceId,hit.range.startCp,hit.range.endCp]),hit);
    return {hits:[...unique.values()].sort((a,b) => b.score-a.score||a.range.sourceId.localeCompare(b.range.sourceId)||a.range.startCp-b.range.startCp).slice(0,topK),
      coverage,completeness:complete?'complete':'partial'};
  }

  private async queryTerms(worldId:string,query:string):Promise<{terms:string[];entityIds:string[]}> {
    const entities=await this.worlds.listEntities(worldId);
    const fingerprint=await this.hashes.sha256Hex(JSON.stringify(entities.map(entity => ({entityId:entity.entityId,name:entity.name,
      aliases:[...entity.aliases].sort()})).sort((a,b) => a.entityId.localeCompare(b.entityId))));
    await this.store.replaceAliases(worldId,fingerprint,entities);
    const aliases=await this.store.expandAliasTerms(worldId,query);
    return {terms:[...new Set([...tokenizeChineseSearchText(query).slice(0,24),...aliases.terms])].slice(0,48),entityIds:aliases.entityIds};
  }

  private async materialize(key:SourceIndexKey,candidate:SourceIndexCandidate,allowed:readonly SourceRangeV1[],member:SourceCatalogMemberV1,
    terms:readonly string[],requireMatch:boolean):Promise<SourceSearchHitV1|null> {
    // Filter coordinates before fetching any passage for downstream prompts.
    const permission=allowed.find(range => range.startCp<candidate.endCp&&range.endCp>candidate.startCp);
    if (!permission) return null;
    const whole=await this.catalog.createRange(key.sourceId,candidate.startCp,candidate.endCp);
    if (whole.rangeContentHash!==candidate.contentHash) {
      await this.store.invalidatePage(key,Math.floor(candidate.startCp/SOURCE_INDEX_PAGE_CP)*SOURCE_INDEX_PAGE_CP);
      return null;
    }
    const start=Math.max(permission.startCp,candidate.startCp),end=Math.min(permission.endCp,candidate.endCp);
    const range=start===whole.startCp&&end===whole.endCp?whole:await this.catalog.createRange(key.sourceId,start,end);
    const text=await this.catalog.readRange(range);
    const frequency:Record<string,number>={};
    for (const term of tokenizeChineseSearchText(text)) frequency[term]=(frequency[term]??0)+1;
    const score=requireMatch?scoreTerms(frequency,terms):candidate.score;
    if (requireMatch&&score<=0) return null;
    return {range,chapterId:mirrorSourceId(member.sourceOrdinal,candidate.chapterId),score,text};
  }

  private async sourceKey(sourceId:string):Promise<SourceIndexKey> {
    const manifest=await this.sources.getManifest(sourceId);
    if (!manifest||manifest.status!=='active') throw new Error('source_not_active');
    return {sourceId,normalizedTreeHash:manifest.normalizedTreeHash,indexVersion:PERSISTENT_SOURCE_INDEX_VERSION,codePointCount:manifest.codePointCount};
  }
  private async buildPage(key:SourceIndexKey,start:number,end:number):Promise<void> {
    const range=await this.catalog.createRange(key.sourceId,start,end);
    if (range.normalizedTreeHash!==key.normalizedTreeHash) throw new Error('source_changed');
    let text=await this.catalog.readRange(range);
    let indexingEnd=end;
    // Complete the boundary line locally (at most one paragraph); a CJK name
    // straddling a storage page must not disappear from recall.
    if (end<key.codePointCount&&!text.endsWith('\n')) {
      const suffixRange=await this.catalog.createRange(key.sourceId,end,Math.min(key.codePointCount,end+1_200));
      const suffix=await this.catalog.readRange(suffixRange);
      const newline=suffix.indexOf('\n');
      const continuation=newline<0?suffix:suffix.slice(0,newline);
      text+=continuation;
      indexingEnd+=new CodePointOffsetIndex(continuation).codePointCount;
    }
    const offsets=new CodePointOffsetIndex(text);
    const chapters=await this.sources.getChapters(key.sourceId);
    const page:SourceIndexPage={startCp:start,endCp:end,contentHash:range.rangeContentHash,paragraphs:[]};
    const paragraphs:SourceIndexPage['paragraphs'][number][]=[];
    for (const chapter of chapters) {
      const from=Math.max(start,chapter.startOffset),to=Math.min(indexingEnd,chapter.endOffset);
      if (to<=from) continue;
      const builder=new LocalSourceSearchIndexBuilder();
      builder.addChunk({chunkId:`page:${start}:${from}`,chapterId:chapter.chapterId,chapterIndex:chapter.index,chunkIndex:0,
        startCodePoint:from,endCodePoint:to,contentHash:range.rangeContentHash,text:offsets.slice(from-start,to-start)});
      for (const paragraph of builder.finish().paragraphs) {
        if (paragraph.startCodePoint>=end) continue;
        let paragraphEnd=paragraph.endCodePoint;
        if (paragraphEnd<to&&offsets.slice(paragraphEnd-start,paragraphEnd-start+1).trim()) paragraphEnd+=1;
        const paragraphText=offsets.slice(paragraph.startCodePoint-start,paragraphEnd-start);
        const frequency:Record<string,number>={};
        for (const term of tokenizeChineseSearchText(paragraphText)) frequency[term]=(frequency[term]??0)+1;
        paragraphs.push({paragraphId:paragraph.paragraphId,chapterId:paragraph.chapterId,
          startCp:paragraph.startCodePoint,endCp:paragraphEnd,terms:frequency,
          contentHash:await this.hashes.sha256Hex(paragraphText)});
      }
    }
    // Parser gaps are legitimate whitespace, never silently omit meaningful original text.
    const covered=chapters.map(chapter => ({startCp:Math.max(start,chapter.startOffset),endCp:Math.min(end,chapter.endOffset)}))
      .filter(value => value.endCp>value.startCp).sort((a,b) => a.startCp-b.startCp);
    let cursor=start;
    for (const interval of covered) {
      if (offsets.slice(cursor-start,interval.startCp-start).trim()) throw new Error('source_index_chapter_coverage');
      cursor=Math.max(cursor,interval.endCp);
    }
    if (offsets.slice(cursor-start,end-start).trim()) throw new Error('source_index_chapter_coverage');
    page.paragraphs=paragraphs;
    await this.store.commitPage(key,page);
  }
}
function isCovered(coverage:IndexCoverageV1,start:number,end:number):boolean {
  return coverage.indexedRanges.some(range => range.startCp<=start&&range.endCp>=end);
}
function missingRanges(ranges:readonly SourceRangeV1[],coverage:IndexCoverageV1):Array<{startCp:number;endCp:number}> {
  const missing:Array<{startCp:number;endCp:number}>=[];
  for (const range of ranges) {
    let cursor=range.startCp;
    for (const indexed of coverage.indexedRanges) {
      if (indexed.endCp<=cursor||indexed.startCp>=range.endCp) continue;
      if (indexed.startCp>cursor) missing.push({startCp:cursor,endCp:indexed.startCp});
      cursor=Math.max(cursor,indexed.endCp);
    }
    if (cursor<range.endCp) missing.push({startCp:cursor,endCp:range.endCp});
  }
  return missing;
}
function scoreTerms(frequency:Readonly<Record<string,number>>,terms:readonly string[]):number {
  return terms.reduce((score,term) => {const count=frequency[term]??0;return score+(count*2.2)/(count+1.2);},0);
}
function sameRange(a:SourceRangeV1,b:SourceRangeV1):boolean {return a.sourceId===b.sourceId&&a.startCp===b.startCp&&a.endCp===b.endCp;}
function validHash(value:string):boolean {return typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value);}
function clampTopK(value:number|undefined):number {return Number.isSafeInteger(value)?Math.max(1,Math.min(8,value!)):3;}
function checkAborted(signal?:AbortSignal):void {
  if (!signal?.aborted) return;
  const error=new Error('Progressive source lookup was canceled.');error.name='AbortError';throw error;
}
