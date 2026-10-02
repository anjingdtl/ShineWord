import type { SqliteDatabase, SqliteRow, SqliteTransaction } from '../../application/ports/sqlite';
import type { SourceIndexCandidate, SourceIndexKey, SourceIndexPage, SourceIndexStore } from '../../application/sourceIndex/types';
import type { IndexCoverageV1, SourceRangeV1 } from '../../application/ports/phase6';
import { normalizeSearchText, tokenizeChineseSearchText, type SourceSearchEntity } from '../../application/search/chineseSourceSearch';

type IndexRow = SqliteRow & { index_id: number; corrupt: number };
type PageRow = SqliteRow & { start_cp: number; end_cp: number; paragraph_count: number; posting_count: number;
  actual_paragraphs: number; actual_postings: number };
type CandidateRow = SqliteRow & { paragraph_id: number; chapter_id: string; start_cp: number; end_cp: number;
  content_hash: string; score: number };
const MAX_TERMS = 48;
const MAX_CANDIDATES = 64;

/** Bounded on-disk LRU; no novel-sized JS postings or paragraph cache. */
export class SqliteSourceIndexStore implements SourceIndexStore {
  private readonly maxPages: number;
  constructor(private readonly db: SqliteDatabase, options: { maxPages?: number; nowMs?: () => number } = {}) {
    this.maxPages = options.maxPages ?? 256;
    if (!Number.isSafeInteger(this.maxPages) || this.maxPages < 1) throw new Error('source_index_capacity_invalid');
    this.nowMs = options.nowMs ?? Date.now;
  }
  private readonly nowMs: () => number;

  async coverage(key: SourceIndexKey): Promise<IndexCoverageV1> {
    const index = await this.findIndex(key);
    if (!index) return emptyCoverage(key);
    const pages = await this.db.queryAll<PageRow>(`SELECT g.start_cp,g.end_cp,g.paragraph_count,g.posting_count,
      (SELECT COUNT(*) FROM source_index_paragraphs p WHERE p.index_id=g.index_id AND p.page_start_cp=g.start_cp) actual_paragraphs,
      (SELECT COUNT(*) FROM source_index_postings s JOIN source_index_paragraphs p ON p.paragraph_id=s.paragraph_id
       WHERE p.index_id=g.index_id AND p.page_start_cp=g.start_cp) actual_postings
      FROM source_index_pages g WHERE g.index_id=? ORDER BY g.start_cp`, [index.index_id]);
    const damaged = pages.filter(page => page.paragraph_count !== page.actual_paragraphs
      || page.posting_count !== page.actual_postings || page.end_cp > key.codePointCount);
    if (damaged.length) {
      await this.db.transaction(async tx => {
        for (const page of damaged) await tx.execute('DELETE FROM source_index_pages WHERE index_id=? AND start_cp=?', [index.index_id,page.start_cp]);
        await tx.execute('UPDATE source_index_sources SET corrupt=1 WHERE index_id=?', [index.index_id]);
      });
    }
    const valid = pages.filter(page => !damaged.includes(page));
    const indexedRanges: Array<{ startCp: number; endCp: number }> = [];
    for (const page of valid) {
      const previous = indexedRanges[indexedRanges.length - 1];
      if (previous && page.start_cp <= previous.endCp) previous.endCp = Math.max(previous.endCp,page.end_cp);
      else indexedRanges.push({ startCp: page.start_cp, endCp: page.end_cp });
    }
    const lastCheckpoint = indexedRanges[0]?.startCp === 0 ? indexedRanges[0].endCp : 0;
    const corrupt = index.corrupt === 1 || damaged.length > 0;
    return { sourceId:key.sourceId,normalizedTreeHash:key.normalizedTreeHash,indexVersion:key.indexVersion,
      indexedRanges, lastCheckpoint, complete: lastCheckpoint === key.codePointCount && !corrupt, corrupt };
  }

  async commitPage(key: SourceIndexKey, page: SourceIndexPage): Promise<void> {
    if (!Number.isSafeInteger(page.startCp) || page.startCp < 0 || !Number.isSafeInteger(page.endCp)
      || page.endCp <= page.startCp || page.endCp > key.codePointCount) throw new Error('source_index_page_invalid');
    await this.db.transaction(async tx => {
      // SELECT guard prevents a late read/hash completion from reviving a deleted/replaced source.
      await tx.execute(`INSERT OR IGNORE INTO source_index_sources(source_id,normalized_tree_hash,index_version,code_point_count)
        SELECT source_id,normalized_tree_hash,?,code_point_count FROM imported_sources
        WHERE source_id=? AND status='active' AND normalized_tree_hash=? AND code_point_count=?`,
        [key.indexVersion,key.sourceId,key.normalizedTreeHash,key.codePointCount]);
      const index = await this.findIndex(key, tx);
      if (!index) throw new Error('source_changed_or_deleted');
      await tx.execute('DELETE FROM source_index_pages WHERE index_id=? AND start_cp=?', [index.index_id,page.startCp]);
      const postingCount = page.paragraphs.reduce((count,paragraph) => count + Object.keys(paragraph.terms).length,0);
      await tx.execute(`INSERT INTO source_index_pages(index_id,start_cp,end_cp,content_hash,paragraph_count,posting_count,used_at)
        VALUES(?,?,?,?,?,?,?)`, [index.index_id,page.startCp,page.endCp,page.contentHash,page.paragraphs.length,postingCount,this.nowMs()]);
      for (const paragraph of page.paragraphs) {
        if (paragraph.startCp < page.startCp || paragraph.startCp >= page.endCp
          || paragraph.endCp > Math.min(key.codePointCount,page.endCp+1_201) || paragraph.endCp <= paragraph.startCp)
          throw new Error('source_index_paragraph_invalid');
        await tx.execute(`INSERT INTO source_index_paragraphs(index_id,page_start_cp,start_cp,end_cp,chapter_id,content_hash)
          VALUES(?,?,?,?,?,?)`, [index.index_id,page.startCp,paragraph.startCp,paragraph.endCp,paragraph.chapterId,paragraph.contentHash]);
        const row = await tx.queryOne<{ paragraph_id:number }>('SELECT paragraph_id FROM source_index_paragraphs WHERE index_id=? AND start_cp=? AND end_cp=?',
          [index.index_id,paragraph.startCp,paragraph.endCp]);
        if (!row) throw new Error('source_index_write_failed');
        const terms = Object.entries(paragraph.terms);
        for (let offset=0;offset<terms.length;offset+=100) {
          const batch=terms.slice(offset,offset+100);
          if (batch.some(([term,count]) => !term || !Number.isSafeInteger(count) || count<1)) throw new Error('source_index_posting_invalid');
          await tx.execute(`INSERT INTO source_index_postings(paragraph_id,term,frequency) VALUES ${batch.map(() => '(?,?,?)').join(',')}`,
            batch.flatMap(([term,count]) => [row.paragraph_id,term,count]));
        }
      }
      await tx.execute('UPDATE source_index_sources SET corrupt=0 WHERE index_id=?', [index.index_id]);
      await tx.execute(`DELETE FROM source_index_pages WHERE rowid IN
        (SELECT rowid FROM source_index_pages ORDER BY used_at DESC,index_id DESC,start_cp DESC LIMIT -1 OFFSET ?)`, [this.maxPages]);
    });
  }

  async invalidatePage(key: SourceIndexKey, startCp: number): Promise<void> {
    const index=await this.findIndex(key);
    if (!index) return;
    await this.db.transaction(async tx => {
      await tx.execute('DELETE FROM source_index_pages WHERE index_id=? AND start_cp=?', [index.index_id,startCp]);
      await tx.execute('UPDATE source_index_sources SET corrupt=1 WHERE index_id=?', [index.index_id]);
    });
  }

  async candidates(key: SourceIndexKey, ranges: readonly SourceRangeV1[], terms: readonly string[], limit: number): Promise<SourceIndexCandidate[]> {
    const index=await this.findIndex(key);
    const queryTerms=[...new Set(terms)].slice(0,MAX_TERMS);
    if (!index || !queryTerms.length) return [];
    const boundedLimit=Math.min(MAX_CANDIDATES,Math.max(1,Math.trunc(limit)));
    let candidates: SourceIndexCandidate[]=[];
    for (const range of ranges) {
      const rows=await this.db.queryAll<CandidateRow>(`SELECT p.paragraph_id,p.chapter_id,p.start_cp,p.end_cp,p.content_hash,
        SUM((s.frequency*2.2)/(s.frequency+1.2)) score FROM source_index_postings s
        JOIN source_index_paragraphs p ON p.paragraph_id=s.paragraph_id
        WHERE p.index_id=? AND p.start_cp<? AND p.end_cp>? AND s.term IN (${queryTerms.map(() => '?').join(',')})
        GROUP BY p.paragraph_id ORDER BY score DESC,p.start_cp LIMIT ?`,
        [index.index_id,range.endCp,range.startCp,...queryTerms,boundedLimit]);
      const byId=new Map(candidates.map(candidate => [candidate.paragraphId,candidate]));
      for (const row of rows) byId.set(String(row.paragraph_id),toCandidate(row));
      candidates=[...byId.values()].sort((a,b) => b.score-a.score || a.startCp-b.startCp).slice(0,boundedLimit);
    }
    for (const candidate of candidates) await this.db.execute('UPDATE source_index_pages SET used_at=? WHERE index_id=? AND start_cp<=? AND end_cp>?',
      [this.nowMs(),index.index_id,candidate.startCp,candidate.startCp]);
    return candidates;
  }

  async neighbors(key: SourceIndexKey, hit: SourceIndexCandidate, ranges: readonly SourceRangeV1[], limit:number): Promise<SourceIndexCandidate[]> {
    const index=await this.findIndex(key);
    if (!index || limit<1) return [];
    const rows=await this.db.queryAll<CandidateRow>(`SELECT paragraph_id,chapter_id,start_cp,end_cp,content_hash,0 score
      FROM source_index_paragraphs WHERE index_id=? AND chapter_id=? AND paragraph_id<>?
      AND start_cp<=? AND end_cp>=? ORDER BY ABS(start_cp-?) LIMIT 4`,
      [index.index_id,hit.chapterId,Number(hit.paragraphId),hit.endCp+4,hit.startCp-4,hit.startCp]);
    return rows.filter(row => ranges.some(range => range.startCp<=row.start_cp && range.endCp>=row.end_cp))
      .slice(0,Math.min(4,limit)).map(toCandidate);
  }

  async replaceAliases(worldId:string, fingerprint:string, entities:readonly SourceSearchEntity[]):Promise<void> {
    await this.db.transaction(async tx => {
      const old=await tx.queryOne<{ fingerprint:string }>('SELECT fingerprint FROM source_index_alias_versions WHERE world_id=?',[worldId]);
      if (old?.fingerprint===fingerprint) return;
      // FK and existence check both stop deleted-project late results.
      const world=await tx.queryOne<{ world_id:string }>('SELECT world_id FROM worlds WHERE world_id=?',[worldId]);
      if (!world) throw new Error('source_index_world_deleted');
      await tx.execute('DELETE FROM source_index_alias_versions WHERE world_id=?',[worldId]);
      await tx.execute('INSERT INTO source_index_alias_versions(world_id,fingerprint) VALUES(?,?)',[worldId,fingerprint]);
      for (const entity of entities) for (const alias of [entity.name,...(entity.aliases??[])]) {
        const normalized=normalizeSearchText(alias);
        if (Array.from(normalized).length<2) continue;
        await tx.execute('INSERT OR IGNORE INTO source_index_aliases(world_id,entity_id,normalized_alias,alias_text) VALUES(?,?,?,?)',
          [worldId,entity.entityId,normalized,alias]);
      }
    });
  }

  async expandAliasTerms(worldId:string,query:string):Promise<{ terms:string[];entityIds:string[] }> {
    const normalized=normalizeSearchText(query);
    const matched=await this.db.queryAll<{ entity_id:string }>(`SELECT DISTINCT entity_id FROM source_index_aliases
      WHERE world_id=? AND instr(?,normalized_alias)>0 ORDER BY entity_id LIMIT 24`,[worldId,normalized]);
    if (!matched.length) return { terms:[],entityIds:[] };
    const entityIds=matched.map(row => row.entity_id);
    const aliases=await this.db.queryAll<{ alias_text:string }>(`SELECT alias_text FROM source_index_aliases
      WHERE world_id=? AND entity_id IN (${entityIds.map(() => '?').join(',')}) ORDER BY entity_id,normalized_alias LIMIT 96`, [worldId,...entityIds]);
    return { entityIds,terms:[...new Set(aliases.flatMap(row => tokenizeChineseSearchText(row.alias_text)))].slice(0,MAX_TERMS) };
  }

  async countParagraphs(key:SourceIndexKey,ranges:readonly SourceRangeV1[]):Promise<number> {
    const index=await this.findIndex(key); if (!index) return 0;
    const ordered=[...ranges].sort((a,b) => a.startCp-b.startCp);
    const merged:Array<{startCp:number;endCp:number}>=[];
    for (const range of ordered) {const previous=merged[merged.length-1];
      if (previous&&range.startCp<=previous.endCp) previous.endCp=Math.max(previous.endCp,range.endCp);
      else merged.push({startCp:range.startCp,endCp:range.endCp});}
    let count=0;
    for (const range of merged) {
      const row=await this.db.queryOne<{count:number}>('SELECT COUNT(*) count FROM source_index_paragraphs WHERE index_id=? AND start_cp<? AND end_cp>?',
        [index.index_id,range.endCp,range.startCp]); count+=row?.count??0;
    }
    return count;
  }

  async stats():Promise<{ pageCount:number;paragraphCount:number;postingCount:number;maxPages:number }> {
    const row=await this.db.queryOne<{ pages:number;paragraphs:number;postings:number }>(`SELECT
      (SELECT COUNT(*) FROM source_index_pages) pages,(SELECT COUNT(*) FROM source_index_paragraphs) paragraphs,
      (SELECT COUNT(*) FROM source_index_postings) postings`);
    return { pageCount:row?.pages??0,paragraphCount:row?.paragraphs??0,postingCount:row?.postings??0,maxPages:this.maxPages };
  }

  private async findIndex(key:SourceIndexKey,db:Pick<SqliteDatabase,'queryOne'> | Pick<SqliteTransaction,'queryOne'>=this.db):Promise<IndexRow|null> {
    return db.queryOne<IndexRow>(`SELECT i.index_id,i.corrupt FROM source_index_sources i
      JOIN imported_sources s ON s.source_id=i.source_id AND s.normalized_tree_hash=i.normalized_tree_hash
      WHERE i.source_id=? AND i.normalized_tree_hash=? AND i.index_version=? AND s.status='active' AND s.code_point_count=?`,
      [key.sourceId,key.normalizedTreeHash,key.indexVersion,key.codePointCount]);
  }
}
function toCandidate(row:CandidateRow):SourceIndexCandidate {
  return { paragraphId:String(row.paragraph_id),chapterId:row.chapter_id,startCp:row.start_cp,endCp:row.end_cp,
    contentHash:row.content_hash,score:row.score };
}
function emptyCoverage(key:SourceIndexKey):IndexCoverageV1 {
  return { sourceId:key.sourceId,normalizedTreeHash:key.normalizedTreeHash,indexVersion:key.indexVersion,
    indexedRanges:[],complete:false,lastCheckpoint:0,corrupt:false };
}
