import type { BuildIntentV1, OpeningRequirementsV1, PublishedArtifactV1, SourceRangeV1, SourceSetBindingV1 } from '../../domain/build/phase6';
import { isSourceBindingCompatible } from '../../domain/build/validation';
import { SEGMENT_ARTIFACT_VERSION, SEGMENT_VALIDATION_VERSION, type ArtifactReferenceV1,
  type SegmentArtifactV1, type SegmentContentBindingV1 } from '../../domain/content/segmentArtifact';
import type { BookSection, BranchContentManifest, ContentEntry } from '../../domain/content/types';
import { canonicalStringify, type CanonicalJson, type Sha256HexProvider } from '../../domain/turns/canonical';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import { SqliteSegmentArtifactStore } from '../../infra/sqlite/sqliteSegmentArtifactStore';
import type { AdoptionReceiptV1, BranchContentPortV1, SourceCatalogPortV1 } from '../ports/phase6';
import type { SqliteRow, SqliteTransaction } from '../ports/sqlite';
import { readBranchContentManifest } from '../worldPackage/branchContentStore';
import { contentDependencyBinding, createBaseContentManifest, loadBranchDeltaEntries, verifyContentManifest } from '../worldPackage/contentManifest';
import { validatePackage } from '../worldPackage/validate';
import { computeSegmentArtifactHash, buildSegmentCitations, createSegmentArtifactManifest, isRecord,
  isSegmentContentBindingV1, verifySegmentArtifact, resolveLegacyEvidenceRange } from './protocol';
import { validateSegmentArtifactContent } from './validate';

export interface PublishSegmentArtifactInput {
  worldId:string; segmentId:string; generation:number; sourceBinding:SourceSetBindingV1; coverage:readonly SourceRangeV1[];
  canonSnapshotHash:string; basePackage:{revision:number;contentHash:string}; ruleset:{id:string;version:string}; mappingVersion:string;
  dependencies?:readonly ArtifactReferenceV1[];entries:readonly ContentEntry[];sections:readonly BookSection[];
  openingRequirements?:OpeningRequirementsV1;createdAt:string;
  /** M0/M4 checks the actual run lease, fence and intent generation using
   * this transaction. Runtime authority is never serialized into an artifact. */
  assertCurrent?:(tx:SqliteTransaction)=>Promise<void>;
}
export interface LegacyOverlayRebaseInput {
  previousManifest:BranchContentManifest;
  nextManifest:BranchContentManifest;
  createdAt:string;
}
export class SegmentPublicationError extends Error {
  constructor(readonly errorCodes:readonly string[]){super(`Segment publication blocked: ${errorCodes.join(', ')}`);this.name='SegmentPublicationError';}
}
export interface SegmentPublicationDeps {
  store:SqliteSegmentArtifactStore;
  worldStore:Pick<SqliteWorldStore,'getWorldPackage'|'getProgressiveDeltaPackage'|'listFacts'|'listEntities'|'listEvents'|'listReviewIssues'>;
  sourceCatalog:SourceCatalogPortV1;
  sha256Hex:Sha256HexProvider['sha256Hex'];
  now?:()=>string;
}
export class SegmentPublicationService implements BranchContentPortV1 {
  private readonly now:()=>string;
  constructor(readonly deps:SegmentPublicationDeps){this.now=deps.now??(()=>new Date().toISOString());}
  listPublishedArtifacts(worldId:string):Promise<PublishedArtifactV1[]>{return this.deps.store.listPublishedArtifacts(worldId);}
  async publishArtifact(input:PublishSegmentArtifactInput):Promise<SegmentArtifactV1> {
    const {store,worldStore,sourceCatalog,sha256Hex}=this.deps;
    try {
      if(!await sourceCatalog.isBindingCompatible(input.worldId,input.sourceBinding))throw new Error('source_changed');
      const base=await worldStore.getWorldPackage(input.worldId,input.basePackage.revision);
      if(!base||base.manifest.status!=='published'||base.manifest.contentHash!==input.basePackage.contentHash
        ||base.manifest.ruleset.id!==input.ruleset.id||base.manifest.ruleset.version!==input.ruleset.version
        ||base.manifest.mappingVersion!==input.mappingVersion)throw new Error('base_package_mismatch');
      for(const range of input.coverage)await sourceCatalog.readRange(range);
      const [facts,entities,events,reviews]=await Promise.all([worldStore.listFacts(input.worldId),worldStore.listEntities(input.worldId),
        worldStore.listEvents(input.worldId),worldStore.listReviewIssues(input.worldId,'open')]);
      // Conflicts outside a proven source closure may remain pending. An
      // unclassified/malformed conflict fails closed, including old data.
      const catalogSnapshot=await sourceCatalog.snapshot(input.worldId);
      for(const conflict of facts.filter(f=>f.status==='conflict')) {
        if(!conflict.sources.length)throw new Error('unclassified_canon_conflict');
        for(const span of conflict.sources) {
          const r=await resolveLegacyEvidenceRange(sourceCatalog,catalogSnapshot.members,{chapterId:span.chapterId,
            startCodePoint:span.startOffset,endCodePoint:span.endOffset,contentSha256:span.quoteSha256});
          if(input.coverage.some(c=>c.sourceId===r.sourceId&&c.normalizedTreeHash===r.normalizedTreeHash
            &&c.startCp<r.endCp&&c.endCp>r.startCp))throw new Error('canon_conflict_in_scope');
        }
      }
      const dependencies=input.dependencies??[];const dependencyArtifacts:SegmentArtifactV1[]=[];
      const pending=[...dependencies];const seen=new Map<string,string>();
      while(pending.length){const ref=pending.shift()!;const previousHash=seen.get(ref.artifactId);
        if(previousHash!==undefined){if(previousHash!==ref.contentHash)throw new Error('missing_dependency');continue;}
        seen.set(ref.artifactId,ref.contentHash);
        const artifact=await store.getArtifact(ref.artifactId);
        if(!artifact||artifact.worldId!==input.worldId||artifact.contentHash!==ref.contentHash
          ||artifact.basePackage.contentHash!==input.basePackage.contentHash||artifact.basePackage.revision!==input.basePackage.revision
          ||!isSourceBindingCompatible(artifact.sourceBinding,input.sourceBinding))throw new Error('missing_dependency');
        dependencyArtifacts.push(artifact);pending.push(...artifact.dependencies);
        if(seen.size>512)throw new Error('dependency_closure_limit');
      }
      const citations=await buildSegmentCitations({worldId:input.worldId,entries:input.entries,facts,catalog:sourceCatalog,sourceBinding:input.sourceBinding});
      const payload:Omit<SegmentArtifactV1,'artifactId'|'contentHash'|'createdAt'>={schemaVersion:SEGMENT_ARTIFACT_VERSION,
        worldId:input.worldId,segmentId:input.segmentId,generation:input.generation,sourceBinding:input.sourceBinding,
        coverage:input.coverage,canonSnapshotHash:input.canonSnapshotHash,validationVersion:SEGMENT_VALIDATION_VERSION,
        basePackage:input.basePackage,ruleset:input.ruleset,mappingVersion:input.mappingVersion,dependencies,
        entries:input.entries,sections:input.sections,citations,validation:{warnings:[]}};
      // Hash the exact selected canonical subset with the M4 versioned digest.
      // canonSnapshotHash is the frozen M4 checkpoint fingerprint; its format
      // and source proofs are validated here. M5 never recomputes M4's larger
      // semantic dependency selection from just the mapped entry citations.
      let contentHash=await computeSegmentArtifactHash(payload,sha256Hex);
      let artifact:SegmentArtifactV1={...payload,artifactId:`segment-artifact-${contentHash}`,contentHash,createdAt:input.createdAt};
      const result=validateSegmentArtifactContent({artifact,dependencyEntries:[...base.entries,...dependencyArtifacts.flatMap(a=>a.entries)],
        facts,entities,events,blockingReviews:reviews,openingRequirements:input.openingRequirements});
      if(result.errors.length)throw new SegmentPublicationError(result.errors);
      artifact={...artifact,validation:{warnings:result.warnings}};
      const {artifactId:unusedId,contentHash:unusedHash,createdAt:unusedAt,...validatedPayload}=artifact;
      void unusedId;void unusedHash;void unusedAt;
      contentHash=await computeSegmentArtifactHash(validatedPayload,sha256Hex);
      artifact={...artifact,artifactId:`segment-artifact-${contentHash}`,contentHash};
      if(!await verifySegmentArtifact(artifact,sha256Hex))throw new Error('invalid_artifact');
      await store.db.transaction(async tx=>{
        await store.assertSourceBindingCurrent(tx,input.worldId,input.sourceBinding);
        for(const dep of dependencyArtifacts){const stored=await store.getArtifact(dep.artifactId,tx);if(!stored||stored.contentHash!==dep.contentHash)throw new Error('missing_dependency');}
        const currentBase=await worldStore.getWorldPackage(input.worldId,input.basePackage.revision,tx);
        if(!currentBase||currentBase.manifest.status!=='published'||currentBase.manifest.contentHash!==input.basePackage.contentHash
          ||currentBase.manifest.mappingVersion!==input.mappingVersion||currentBase.manifest.ruleset.id!==input.ruleset.id
          ||currentBase.manifest.ruleset.version!==input.ruleset.version)throw new Error('base_package_mismatch');
        const [currentFacts,currentEntities,currentEvents,currentReviews]=await Promise.all([
          worldStore.listFacts(input.worldId,tx),worldStore.listEntities(input.worldId,tx),
          worldStore.listEvents(input.worldId,undefined,tx),worldStore.listReviewIssues(input.worldId,'open',tx)]);
        // A parallel extractor may mark an existing fact conflicted or open a
        // blocker after the earlier validation. This second pass uses only tx
        // readers; source membership/coordinates remain frozen above.
        for(const conflict of currentFacts.filter(f=>f.status==='conflict')) {
          if(!conflict.sources.length)throw new Error('unclassified_canon_conflict');
          for(const span of conflict.sources){const members=catalogSnapshot.members.filter(member=>member.chapters.some(chapter=>chapter.chapterId===span.chapterId
            &&chapter.startCp<=span.startOffset&&chapter.endCp>=span.endOffset));
            if(members.length!==1||!Number.isSafeInteger(span.startOffset)||!Number.isSafeInteger(span.endOffset)
              ||span.startOffset<0||span.endOffset<=span.startOffset)throw new Error('unclassified_canon_conflict');
            const member=members[0]!;
            if(input.coverage.some(range=>range.sourceId===member.sourceId&&range.normalizedTreeHash===member.normalizedTreeHash
              &&range.startCp<span.endOffset&&range.endCp>span.startOffset))throw new Error('canon_conflict_in_scope');}
        }
        const factById=new Map(facts.map(f=>[f.factId,f])),currentFactById=new Map(currentFacts.map(f=>[f.factId,f]));
        for(const id of new Set(artifact.citations.flatMap(c=>c.sourceFactIds))) {
          const previous=factById.get(id),current=currentFactById.get(id);
          if(!previous||!current||canonicalStringify(previous as unknown as CanonicalJson)!==canonicalStringify(current as unknown as CanonicalJson))
            throw new Error('canon_evidence_changed');
        }
        for(const id of input.openingRequirements?.requiredEventIds??[]) {
          const previous=events.find(event=>event.eventId===id),current=currentEvents.find(event=>event.eventId===id);
          if(!previous||!current||canonicalStringify({...previous,dependsOnEventIds:[...previous.dependsOnEventIds].sort()} as unknown as CanonicalJson)
            !==canonicalStringify({...current,dependsOnEventIds:[...current.dependsOnEventIds].sort()} as unknown as CanonicalJson))throw new Error('canon_event_changed');
        }
        const currentResult=validateSegmentArtifactContent({artifact,dependencyEntries:[...currentBase.entries,...dependencyArtifacts.flatMap(a=>a.entries)],
          facts:currentFacts,entities:currentEntities,events:currentEvents,blockingReviews:currentReviews,openingRequirements:input.openingRequirements});
        if(currentResult.errors.length)throw new SegmentPublicationError(currentResult.errors);
        await input.assertCurrent?.(tx);
        await store.insertArtifact(tx,artifact);
      });
      return artifact;
    }catch(error){const errors=error instanceof SegmentPublicationError?error.errorCodes:[error instanceof Error?error.message:'publication_failed'];
      await store.recordDiagnostic({...input,errors});throw error;
    }
  }
  /** Physical publication units: bounded ranges, bounded entries and closure.
   * Root/M4 supplies unit-specific drafts; this method never drops entries or
   * rewrites a branch-scoped old delta into a shared world artifact. */
  async publishIntentDraft(input:Omit<PublishSegmentArtifactInput,'worldId'|'segmentId'|'generation'|'sourceBinding'|'coverage'> &
    {intent:BuildIntentV1;coverage?:readonly SourceRangeV1[]}):Promise<SegmentArtifactV1> {
    return this.publishArtifact({...input,worldId:input.intent.worldId,segmentId:input.intent.segmentId,generation:input.intent.generation,
      sourceBinding:input.intent.sourceBinding,coverage:input.coverage??input.intent.ranges});
  }
  async freezeBinding(campaignId:string,branchId:string):Promise<SegmentContentBindingV1> {
    return this.deps.store.db.transaction(async tx=>{
      const coordinate=await this.readCoordinate(tx,campaignId,branchId);
      if(!coordinate)throw new Error('missing_branch');
      return (await this.readBinding(tx,coordinate,branchId)).binding;
    });
  }
  /** The legacy delta owner calls this inside its own publication transaction.
   * Only the live snapshot's content projection changes; artifact definitions,
   * historical snapshots, character state and frozen turn contracts stay intact. */
  async rebaseLegacyOverlay(tx:SqliteTransaction,input:LegacyOverlayRebaseInput):Promise<SegmentContentBindingV1|null> {
    const {previousManifest:previous,nextManifest:next}=input;
    if(!await verifyContentManifest(previous,this.deps.sha256Hex)||!await verifyContentManifest(next,this.deps.sha256Hex)
      ||next.worldId!==previous.worldId||next.branchId!==previous.branchId||next.stateVersion!==previous.stateVersion
      ||next.contentVersion!==previous.contentVersion+1||next.basePackage.revision!==previous.basePackage.revision
      ||next.basePackage.contentHash!==previous.basePackage.contentHash
      ||next.deltas.length!==previous.deltas.length+1
      ||canonicalStringify(next.deltas.slice(0,-1) as unknown as CanonicalJson)!==canonicalStringify(previous.deltas as unknown as CanonicalJson))
      throw new Error('invalid_legacy_overlay_rebase');
    const campaign=await tx.queryOne<{campaign_id:string}>('SELECT campaign_id FROM branches WHERE branch_id = ?',[next.branchId]);
    if(!campaign)throw new Error('missing_branch');
    const coordinate=await this.readCoordinate(tx,campaign.campaign_id,next.branchId);
    if(!coordinate||coordinate.world_id!==next.worldId||Number(coordinate.state_version)!==next.stateVersion)throw new Error('legacy_overlay_state_changed');
    const snapshot:unknown=typeof coordinate.snapshot_json==='string'?JSON.parse(coordinate.snapshot_json):null;
    if(!isRecord(snapshot))throw new Error('missing_branch');
    if(snapshot.segmentContentBinding===undefined)return null;
    const current=await this.readBinding(tx,coordinate,next.branchId);
    if(current.legacy.manifestHash!==previous.manifestHash||current.legacy.contentVersion!==previous.contentVersion)
      throw new Error('legacy_overlay_manifest_changed');
    const stored=await readBranchContentManifest(tx,next.branchId,next.stateVersion);
    if(stored?.manifestHash!==next.manifestHash||stored.contentVersion!==next.contentVersion)throw new Error('legacy_overlay_not_published');
    if(await this.hasPendingInteraction(tx,next.branchId))throw new Error('legacy_overlay_interaction_running');
    const refs:ArtifactReferenceV1[]=[];
    for(const artifactId of current.binding.artifactIds){const artifact=await this.deps.store.getArtifact(artifactId,tx);
      if(!artifact)throw new Error('invalid_artifact');refs.push({artifactId,contentHash:artifact.contentHash});}
    const manifest=await createSegmentArtifactManifest({worldId:next.worldId,branchId:next.branchId,stateVersion:next.stateVersion,
      legacyManifestHash:next.manifestHash,artifacts:refs},this.deps.sha256Hex);
    const binding:SegmentContentBindingV1={...contentDependencyBinding(next),artifactIds:refs.map(ref=>ref.artifactId),
      ...(refs.length?{artifactManifestHash:manifest.artifactManifestHash}:{})};
    const rebased={...snapshot,contentManifest:next,segmentContentBinding:binding};
    await this.deps.store.insertManifest(tx,manifest,input.createdAt);
    const updated=await tx.execute(`UPDATE snapshots SET snapshot_json = ? WHERE branch_id = ? AND state_version = ?
      AND snapshot_json = ? AND EXISTS (SELECT 1 FROM branches WHERE branch_id = ? AND state_version = ?)
      AND NOT EXISTS (SELECT 1 FROM interaction_operations WHERE branch_id = ? AND status = 'running')`,
      [JSON.stringify(rebased),next.branchId,next.stateVersion,String(coordinate.snapshot_json),next.branchId,next.stateVersion,next.branchId]);
    if(updated!==1)throw new Error('legacy_overlay_atomic_fence_failed');
    return binding;
  }
  async adoptAtSafeBoundary(input:{campaignId:string;branchId:string;expectedStateVersion:number;expectedManifestHash:string;
    artifactIds:readonly string[]}):Promise<AdoptionReceiptV1> {
    const {store,sourceCatalog}=this.deps;
    return store.db.transaction(async tx=>{
      const coordinate=await this.readCoordinate(tx,input.campaignId,input.branchId);
      if(!coordinate)return {status:'rejected',reason:'missing_branch',binding:null};
      const current=await this.readBinding(tx,coordinate,input.branchId);
      const reject=(reason:AdoptionReceiptV1['reason'],status:AdoptionReceiptV1['status']='rejected'):AdoptionReceiptV1=>({status,reason,binding:current.binding});
      if(Number(coordinate.state_version)!==input.expectedStateVersion)return reject('state_changed');
      if((current.binding.artifactManifestHash??current.binding.manifestHash)!==input.expectedManifestHash)return reject('manifest_changed');
      if(await this.hasPendingInteraction(tx,input.branchId))return reject('interaction_running','pending');
      if(!Array.isArray(input.artifactIds)||input.artifactIds.length>512||new Set(input.artifactIds).size!==input.artifactIds.length)return reject('invalid_artifact');
      const requested=new Set([...current.binding.artifactIds,...input.artifactIds]);
      const refs:ArtifactReferenceV1[]=[];const entries=new Map(current.baseEntries.map(e=>[e.entryId,e]));
      // Order references deterministically; each definition remains immutable.
      for(const artifactId of [...requested].sort()){
        let artifact:SegmentArtifactV1|null;
        try{artifact=await store.getArtifact(artifactId,tx);}catch{return reject('invalid_artifact');}
        if(!artifact||artifact.worldId!==coordinate.world_id||artifact.basePackage.revision!==current.legacy.basePackage.revision
          ||artifact.basePackage.contentHash!==current.legacy.basePackage.contentHash||artifact.mappingVersion!==coordinate.world_mapping_version
          ||artifact.ruleset.id!==coordinate.ruleset_id||artifact.ruleset.version!==coordinate.ruleset_version)return reject('invalid_artifact');
        // Reads are within the same transaction as adoption; deletion/hash changes cannot race the fence.
        try{await store.assertSourceBindingCurrent(tx,String(coordinate.world_id),artifact.sourceBinding);}catch{return reject('source_changed');}
        for(const dependency of artifact.dependencies){if(!requested.has(dependency.artifactId))return reject('missing_dependency');
          const dep=await store.getArtifact(dependency.artifactId,tx);if(!dep||dep.contentHash!==dependency.contentHash)return reject('missing_dependency');}
        for(const entry of artifact.entries){const previous=entries.get(entry.entryId);
          if(previous&&canonicalStringify(previous as unknown as CanonicalJson)!==canonicalStringify(entry as unknown as CanonicalJson))return reject('invalid_artifact');
          entries.set(entry.entryId,entry);}
        refs.push({artifactId,contentHash:artifact.contentHash});
      }
      if(input.artifactIds.every(id=>current.binding.artifactIds.includes(id)))return reject('already_adopted','adopted');
      const manifest=await createSegmentArtifactManifest({worldId:String(coordinate.world_id),branchId:input.branchId,stateVersion:input.expectedStateVersion,
        legacyManifestHash:current.legacy.manifestHash,artifacts:refs},this.deps.sha256Hex);
      const binding:SegmentContentBindingV1={...contentDependencyBinding({...current.legacy,stateVersion:input.expectedStateVersion}),
        artifactIds:refs.map(r=>r.artifactId),artifactManifestHash:manifest.artifactManifestHash};
      const snapshot=isRecord(current.snapshot)?{...current.snapshot,segmentContentBinding:binding}:null;
      if(!snapshot)return reject('missing_branch');
      await store.insertManifest(tx,manifest,this.now());
      const updated=await tx.execute(`UPDATE snapshots SET snapshot_json = ? WHERE branch_id = ? AND state_version = ?
        AND snapshot_json = ? AND EXISTS (SELECT 1 FROM branches b JOIN campaigns c ON c.campaign_id = b.campaign_id
          WHERE b.branch_id = ? AND b.campaign_id = ? AND b.state_version = ?)
        AND NOT EXISTS (SELECT 1 FROM interaction_operations WHERE branch_id = ? AND status = 'running')`,
        [JSON.stringify(snapshot),input.branchId,input.expectedStateVersion,String(coordinate.snapshot_json),input.branchId,input.campaignId,input.expectedStateVersion,input.branchId]);
      if(updated!==1)throw new Error('adoption_atomic_fence_failed');
      return {status:'adopted',reason:'ok',binding};
    });
  }
  async loadEffectiveCatalog(input:{campaignId:string;branchId:string;binding?:SegmentContentBindingV1}):Promise<{
    binding:SegmentContentBindingV1;entries:ContentEntry[];sections:BookSection[]}> {
    const binding=input.binding??await this.freezeBinding(input.campaignId,input.branchId);
    if(!isSegmentContentBindingV1(binding)||binding.branchId!==input.branchId)throw new Error('invalid_artifact_binding');
    const coordinate=await this.readCoordinate(this.deps.store.db,input.campaignId,input.branchId);
    if(!coordinate)throw new Error('missing_branch');
    const worldId=String(coordinate.world_id);
    const legacy=await readBranchContentManifest(this.deps.store.db,input.branchId,binding.stateVersion)
      ??createBaseContentManifest({worldId,branchId:input.branchId,stateVersion:binding.stateVersion,
        basePackage:{revision:binding.basePackageRevision,contentHash:binding.manifestHash}});
    if(legacy.manifestHash!==binding.manifestHash||legacy.contentVersion!==binding.contentVersion
      ||legacy.basePackage.revision!==binding.basePackageRevision
      ||canonicalStringify(legacy.deltas.map(delta=>delta.deltaId) as CanonicalJson)!==canonicalStringify([...binding.deltaIds] as CanonicalJson))throw new Error('legacy_binding_changed');
    const base=await this.deps.worldStore.getWorldPackage(worldId,binding.basePackageRevision);
    if(!base||base.manifest.contentHash!==legacy.basePackage.contentHash)throw new Error('base_package_mismatch');
    const deltas=await loadBranchDeltaEntries({manifest:{...legacy,stateVersion:binding.stateVersion},worldId,branchId:input.branchId,stateVersion:binding.stateVersion,
      baseRevision:base.manifest.revision,baseContentHash:base.manifest.contentHash,getDelta:id=>this.deps.worldStore.getProgressiveDeltaPackage(id),sha256Hex:this.deps.sha256Hex});
    const entries=[...base.entries,...deltas.flatMap(d=>d.entries)];const sections=[...base.sections,...deltas.flatMap(d=>d.sections)];
    const refs:ArtifactReferenceV1[]=[];
    for(const artifactId of binding.artifactIds){const a=await this.deps.store.getArtifact(artifactId);
      if(!a||a.worldId!==worldId||a.basePackage.revision!==base.manifest.revision||a.basePackage.contentHash!==base.manifest.contentHash
        ||a.mappingVersion!==base.manifest.mappingVersion||a.ruleset.id!==base.manifest.ruleset.id||a.ruleset.version!==base.manifest.ruleset.version)throw new Error('invalid_artifact');
      for(const ref of a.dependencies){if(!binding.artifactIds.includes(ref.artifactId))throw new Error('missing_dependency');
        const dependency=await this.deps.store.getArtifact(ref.artifactId);if(!dependency||dependency.contentHash!==ref.contentHash)throw new Error('missing_dependency');}
      refs.push({artifactId,contentHash:a.contentHash});entries.push(...a.entries);sections.push(...a.sections);
    }
    if(refs.length||binding.artifactManifestHash!==undefined){const manifest=await createSegmentArtifactManifest({worldId,branchId:input.branchId,stateVersion:binding.stateVersion,
      legacyManifestHash:binding.manifestHash,artifacts:refs},this.deps.sha256Hex);
      if(manifest.artifactManifestHash!==binding.artifactManifestHash)throw new Error('artifact_binding_hash_changed');}
    const uniqueEntries=new Map<string,ContentEntry>();
    for(const entry of entries){const previous=uniqueEntries.get(entry.entryId);
      if(previous&&canonicalStringify(previous as unknown as CanonicalJson)!==canonicalStringify(entry as unknown as CanonicalJson))throw new Error('immutable_entry_collision');
      uniqueEntries.set(entry.entryId,entry);}
    const merged=new Map<string,BookSection>();
    for(const section of sections){const key=`${section.book}:${section.sectionKey}`;const prior=merged.get(key);
      merged.set(key,prior?{...prior,entryIds:[...new Set([...prior.entryIds,...section.entryIds])]}:{...section,entryIds:[...section.entryIds]});}
    const catalogEntries=[...uniqueEntries.values()];const catalogSections=[...merged.values()];
    const validation=validatePackage({worldId,revision:base.manifest.revision},catalogEntries,catalogSections);
    if(!validation.ok)throw new Error(`invalid_effective_catalog:${validation.errors.join(',')}`);
    return {binding,entries:catalogEntries,sections:catalogSections};
  }
  /** Save/fork/rewind restoration uses the snapshot's exact refs, never the
   * highest world revision or a later adoption row. This creates only a local
   * projection; it does not adopt any newly available world content. */
  async restoreBindingProjection(input:{campaignId:string;branchId:string;binding:SegmentContentBindingV1}):Promise<void> {
    const catalog=await this.loadEffectiveCatalog(input);
    const coordinate=await this.readCoordinate(this.deps.store.db,input.campaignId,input.branchId);
    if(!coordinate)throw new Error('missing_branch');
    const refs:ArtifactReferenceV1[]=[];
    for(const id of catalog.binding.artifactIds){const a=await this.deps.store.getArtifact(id);if(!a)throw new Error('invalid_artifact');refs.push({artifactId:id,contentHash:a.contentHash});}
    const manifest=await createSegmentArtifactManifest({worldId:String(coordinate.world_id),branchId:input.branchId,
      stateVersion:input.binding.stateVersion,legacyManifestHash:input.binding.manifestHash,artifacts:refs},this.deps.sha256Hex);
    if(refs.length&&manifest.artifactManifestHash!==input.binding.artifactManifestHash)throw new Error('invalid_artifact_binding');
    await this.deps.store.db.transaction(tx=>this.deps.store.insertManifest(tx,manifest,this.now()));
  }
  private readCoordinate(tx:Pick<SqliteTransaction,'queryOne'>,campaignId:string,branchId:string):Promise<SqliteRow|null> {
    return tx.queryOne<SqliteRow>(`SELECT b.state_version,c.world_id,c.package_revision,c.ruleset_id,c.ruleset_version,c.world_mapping_version,s.snapshot_json
      FROM branches b JOIN campaigns c ON c.campaign_id = b.campaign_id
      LEFT JOIN snapshots s ON s.branch_id = b.branch_id AND s.state_version = b.state_version
      WHERE b.branch_id = ? AND b.campaign_id = ?`,[branchId,campaignId]);
  }
  private async hasPendingInteraction(tx:Pick<SqliteTransaction,'queryOne'>,branchId:string):Promise<boolean> {
    const running=await tx.queryOne<{n:number}>("SELECT COUNT(*) AS n FROM interaction_operations WHERE branch_id = ? AND status = 'running'",[branchId]);
    if(Number(running?.n??0)>0)return true;
    // The turn journal has existed since schema 1. Missing/corrupt journal
    // storage must fail closed, never imply an idle branch.
    const staged=await tx.queryOne<{n:number}>("SELECT COUNT(*) AS n FROM turns WHERE branch_id = ? AND status <> 'Committed'",[branchId]);
    return Number(staged?.n??0)>0;
  }
  private async readBinding(tx:SqliteTransaction,coordinate:SqliteRow,branchId:string):Promise<{
    binding:SegmentContentBindingV1;legacy:BranchContentManifest;snapshot:Record<string,unknown>|null;baseEntries:ContentEntry[]}> {
    const stateVersion=Number(coordinate.state_version);let snapshot:Record<string,unknown>|null=null;
    if(typeof coordinate.snapshot_json==='string'){const value:unknown=JSON.parse(coordinate.snapshot_json);if(isRecord(value))snapshot=value;}
    let legacy=await readBranchContentManifest(tx,branchId,stateVersion);
    if(isRecord(snapshot?.contentManifest)){const candidate=snapshot!.contentManifest as unknown as BranchContentManifest;
      if(candidate.branchId!==branchId||candidate.stateVersion!==stateVersion||!await verifyContentManifest(candidate,this.deps.sha256Hex))throw new Error('invalid_snapshot_manifest');
      legacy=candidate;}
    const base=await this.deps.worldStore.getWorldPackage(String(coordinate.world_id),legacy?.basePackage.revision??Number(coordinate.package_revision),tx);
    if(!base||base.manifest.status!=='published')throw new Error('base_package_mismatch');
    legacy=legacy??createBaseContentManifest({worldId:String(coordinate.world_id),branchId,stateVersion,
      basePackage:{revision:base.manifest.revision,contentHash:base.manifest.contentHash}});
    if(!await verifyContentManifest(legacy,this.deps.sha256Hex)||legacy.worldId!==coordinate.world_id||legacy.basePackage.contentHash!==base.manifest.contentHash)throw new Error('legacy_binding_changed');
    const binding:SegmentContentBindingV1={...contentDependencyBinding({...legacy,stateVersion}),artifactIds:[]};
    if(snapshot?.segmentContentBinding!==undefined){
      const frozen=snapshot.segmentContentBinding;
      if(!isSegmentContentBindingV1(frozen)||frozen.branchId!==branchId||frozen.stateVersion!==stateVersion
        ||frozen.manifestHash!==binding.manifestHash||frozen.contentVersion!==binding.contentVersion||frozen.basePackageRevision!==binding.basePackageRevision
        ||canonicalStringify([...frozen.deltaIds] as CanonicalJson)!==canonicalStringify([...binding.deltaIds] as CanonicalJson))throw new Error('invalid_snapshot_artifact_binding');
      binding.artifactIds=[...frozen.artifactIds];if(frozen.artifactManifestHash)binding.artifactManifestHash=frozen.artifactManifestHash;
      const refs:ArtifactReferenceV1[]=[];const artifacts=new Map<string,SegmentArtifactV1>();
      for(const id of frozen.artifactIds){const a=await this.deps.store.getArtifact(id,tx);if(!a||a.worldId!==coordinate.world_id
        ||a.basePackage.revision!==base.manifest.revision||a.basePackage.contentHash!==base.manifest.contentHash
        ||a.mappingVersion!==base.manifest.mappingVersion||a.ruleset.id!==base.manifest.ruleset.id||a.ruleset.version!==base.manifest.ruleset.version)throw new Error('invalid_artifact');
        artifacts.set(id,a);refs.push({artifactId:id,contentHash:a.contentHash});}
      for(const artifact of artifacts.values())for(const dependency of artifact.dependencies)
        if(artifacts.get(dependency.artifactId)?.contentHash!==dependency.contentHash)throw new Error('missing_dependency');
      if(refs.length||frozen.artifactManifestHash!==undefined){const m=await createSegmentArtifactManifest({worldId:String(coordinate.world_id),branchId,stateVersion,legacyManifestHash:binding.manifestHash,artifacts:refs},this.deps.sha256Hex);
        if(m.artifactManifestHash!==frozen.artifactManifestHash)throw new Error('artifact_binding_hash_changed');}
    }
    const deltas=await loadBranchDeltaEntries({manifest:{...legacy,stateVersion},worldId:String(coordinate.world_id),branchId,stateVersion,
      baseRevision:base.manifest.revision,baseContentHash:base.manifest.contentHash,getDelta:id=>this.deps.worldStore.getProgressiveDeltaPackage(id,tx),sha256Hex:this.deps.sha256Hex});
    return {binding,legacy,snapshot,baseEntries:[...base.entries,...deltas.flatMap(d=>d.entries)]};
  }
}
