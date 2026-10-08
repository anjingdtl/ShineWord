import type { SqliteRow, SqliteTransaction } from '../ports/sqlite';
import type { ContentEntry } from '../../domain/content/types';
import type { SourceRangeV1 } from '../../domain/build/phase6';
import type { SegmentArtifactV1 } from '../../domain/content/segmentArtifact';
import { isSourceBindingCompatible } from '../../domain/build/validation';
import { canonicalStringify, type CanonicalJson } from '../../domain/turns/canonical';
import { resolveSituationReferences } from '../content/locationReferences';
import { SegmentPublicationService } from '../segmentPublication/service';
import { buildSegmentCitations, computeSegmentArtifactHash, resolveLegacyEvidenceRange } from '../segmentPublication/protocol';
import { validateSegmentArtifactContent } from '../segmentPublication/validate';
import { SEGMENT_ARTIFACT_VERSION, SEGMENT_VALIDATION_VERSION } from '../../domain/content/segmentArtifact';
import { cleanSituation, type SituationCleanContext } from './buildPackageFromCanon';
import { createMappingSituationReview, mappedSituationId, type MappingSituationReview } from './mappingSituationReview';

const stable = (value: unknown): string => canonicalStringify(value as CanonicalJson);
const refresh = (): Error => new Error('局面、证据或已发布内容已变化，请刷新审查后重试。');
export interface SituationReviewPreview {
  worldId: string; issueId: string; proofHash: string; review: MappingSituationReview;
  ready: boolean; errors: readonly string[];
}

/** Review only completed mapping checkpoints. No provider, replay or archive mutation. */
export class SituationReviewService {
  constructor(readonly publication: SegmentPublicationService) {}

  private async readState(tx: SqliteTransaction, worldId: string, issueId: string) {
    const { worldStore, store } = this.publication.deps;
    const issue = await tx.queryOne<SqliteRow>(
      'SELECT kind,severity,detail_json,status FROM review_issues WHERE world_id=? AND issue_id=?', [worldId, issueId]);
    if (!issue || issue.kind !== 'situation_dangling_reference' || issue.status !== 'open') throw refresh();
    let situationId: unknown;
    try { situationId = JSON.parse(String(issue.detail_json)).situationId; } catch { throw refresh(); }
    if (typeof situationId !== 'string') throw refresh();
    const world = await tx.queryOne<SqliteRow>('SELECT source_sha256 FROM worlds WHERE world_id=?', [worldId]);
    if (!world) throw refresh();
    const jobs = await tx.queryAll<SqliteRow>(
      "SELECT job_id,result_json FROM world_jobs WHERE world_id=? AND kind='rule_mapping' AND status='done' ORDER BY job_id LIMIT 501", [worldId]);
    if (jobs.length > 500) throw new Error('映射检查点过多，无法确定当前局面的来源。');
    const matches: Array<{ job: SqliteRow; raw: unknown }> = [];
    for (const job of jobs) {
      let candidates: unknown;
      try { candidates = JSON.parse(String(job.result_json)).proposal?.situations; } catch { continue; }
      if (Array.isArray(candidates)) for (const raw of candidates) {
        if (mappedSituationId(raw) === situationId) matches.push({ job, raw });
      }
    }
    if (!matches.length) throw new Error('没有找到这份局面的完整映射检查点，不能发布或记住拒绝决定。');
    if (new Set(matches.map(m => stable(m.raw))).size !== 1) throw new Error('同一局面有不同提案，请先在构建审查中确认来源。');
    const revision = await tx.queryOne<SqliteRow>(
      "SELECT revision FROM world_packages WHERE world_id=? AND status='published' ORDER BY revision DESC LIMIT 1", [worldId]);
    const base = revision ? await worldStore.getWorldPackage(worldId, Number(revision.revision), tx) : null;
    if (!base) throw new Error('缺少可用的已发布基础包。');
    const facts = await worldStore.listFacts(worldId, tx);
    const entities = await worldStore.listEntities(worldId, tx);
    const events = await worldStore.listEvents(worldId, undefined, tx);
    const reviews = await worldStore.listReviewIssues(worldId, 'open', tx);
    const sourceRows = await tx.queryAll<SqliteRow>(`SELECT ws.source_id,ws.source_ordinal,ws.raw_sha256,s.normalized_tree_hash,s.status
      FROM world_sources ws JOIN imported_sources s ON s.source_id=ws.source_id WHERE ws.world_id=? ORDER BY ws.source_ordinal`, [worldId]);
    const artifactRows = await tx.queryAll<SqliteRow>(
      'SELECT artifact_id FROM world_segment_artifacts WHERE world_id=? ORDER BY artifact_id', [worldId]);
    if (artifactRows.length > 512) throw new Error('内容依赖超过可验证范围。');
    const artifacts: SegmentArtifactV1[] = [];
    for (const row of artifactRows) {
      const artifact = await store.getArtifact(String(row.artifact_id), tx);
      if (artifact && artifact.basePackage.revision === base.manifest.revision
        && artifact.basePackage.contentHash === base.manifest.contentHash
        && artifact.mappingVersion === base.manifest.mappingVersion
        && stable(artifact.ruleset) === stable(base.manifest.ruleset)) artifacts.push(artifact);
    }
    const review = createMappingSituationReview(matches[0]!.raw, worldId, String(world.source_sha256), facts);
    // Seal actual immutable inputs, including full paid payloads and recursive evidence.
    const seal = { issue, world, jobs: matches.map(m => m.job), review, base, entities, events, reviews, sourceRows,
      artifacts: artifacts.map(a => ({ artifactId: a.artifactId, contentHash: a.contentHash })) };
    return { review, base, facts, entities, events, reviews, sourceRows, artifacts, seal };
  }

  private async prepareMaterial(worldId: string, issueId: string) {
    const { store, sourceCatalog, sha256Hex } = this.publication.deps;
    const state = await store.db.transaction(tx => this.readState(tx, worldId, issueId));
    const snapshot = await sourceCatalog.snapshot(worldId);
    const artifacts = state.artifacts.filter(a => isSourceBindingCompatible(a.sourceBinding, snapshot.binding));
    const proofHash = await sha256Hex(stable({ ...state.seal, sourceBinding: snapshot.binding }));
    const entries = new Map<string, ContentEntry>();
    const errors: string[] = [];
    for (const entry of [...state.base.entries, ...artifacts.flatMap(a => a.entries)]) {
      const previous = entries.get(entry.entryId);
      if (previous && stable(previous) !== stable(entry)) errors.push(`immutable_entry_collision:${entry.entryId}`);
      else entries.set(entry.entryId, entry);
    }
    const catalog = [...entries.values()];
    const ctx: SituationCleanContext['ctx'] = {
      knownFactIds: new Set(state.facts.filter(f => ['explicit', 'inference'].includes(f.status) && f.sources.length).map(f => f.factId)), rejected: [],
    };
    const actorNames = new Map(catalog.filter(e => e.kind === 'actor_template')
      .map(e => [String((e.definition as { name?: string }).name ?? ''), e.entryId]));
    const entityNameToTemplateId = new Map<string, string>();
    for (const entity of state.entities) {
      const template = [entity.name, ...entity.aliases].map(name => actorNames.get(name)).find(Boolean);
      if (template) entityNameToTemplateId.set(entity.entityId, template);
    }
    const cleaned = cleanSituation(state.review.proposal, { ctx, knownEntryIds: new Set(entries.keys()),
      knownEvents: new Map(state.events.filter(e => e.status === 'canon').map(e => [e.eventId, e])),
      factSubjects: new Map(state.facts.map(f => [f.factId, f.subjectEntityId])), entityNameToTemplateId,
      entryKinds: new Map(catalog.map(e => [e.entryId, e.kind])),
      knowledgeEntryIds: new Set(catalog.filter(e => e.kind === 'lore' && e.visibility !== 'gm').map(e => e.entryId)) });
    errors.push(...ctx.rejected.flatMap(r => r.reasons));
    let entry: ContentEntry | null = null;
    if (cleaned) {
      const resolved = resolveSituationReferences(cleaned, catalog, state.entities);
      entry = { ...resolved.entry, revision: state.base.manifest.revision };
      errors.push(...resolved.dangling.map(id => `missing_dependency:${id}`));
      if (entries.has(entry.entryId)) errors.push('situation_already_published');
    } else errors.push('situation_validation_failed');
    const coverage: SourceRangeV1[] = [];
    if (!state.review.evidence.length) errors.push('source_evidence_required');
    for (const { factId, fact } of state.review.evidence) {
      if (!fact || !['explicit', 'inference'].includes(fact.status) || !fact.sources.length) { errors.push(`invalid_source_fact:${factId}`); continue; }
      for (const span of fact.sources) {
        try {
          const range = await resolveLegacyEvidenceRange(sourceCatalog, snapshot.members, { chapterId: span.chapterId,
            startCodePoint: span.startOffset, endCodePoint: span.endOffset, contentSha256: span.quoteSha256 });
          if (!coverage.some(r => stable(r) === stable(range))) coverage.push(range);
        } catch { errors.push(`invalid_source_range:${factId}`); }
      }
    }
    const draft = { worldId, segmentId: `repair-${proofHash}`, generation: 1, sourceBinding: snapshot.binding, coverage,
      canonSnapshotHash: await sha256Hex(stable(state.review.evidence)),
      basePackage: { revision: state.base.manifest.revision, contentHash: state.base.manifest.contentHash },
      ruleset: state.base.manifest.ruleset, mappingVersion: state.base.manifest.mappingVersion,
      dependencies: artifacts.map(a => ({ artifactId: a.artifactId, contentHash: a.contentHash })),
      entries: entry ? [entry] : [], sections: [], createdAt: new Date().toISOString() };
    if (entry && !errors.length) {
      try {
        const citations = await buildSegmentCitations({ worldId, entries: [entry], facts: state.facts, catalog: sourceCatalog, sourceBinding: snapshot.binding });
        const { createdAt, ...frozenDraft } = draft;
        const payload = { ...frozenDraft, schemaVersion: SEGMENT_ARTIFACT_VERSION, validationVersion: SEGMENT_VALIDATION_VERSION,
          citations, validation: { warnings: [] } };
        const contentHash = await computeSegmentArtifactHash(payload, sha256Hex);
        errors.push(...validateSegmentArtifactContent({ artifact: { ...payload, createdAt, contentHash, artifactId: `segment-artifact-${contentHash}` },
          dependencyEntries: catalog, facts: state.facts, entities: state.entities, events: state.events, blockingReviews: state.reviews }).errors);
      } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
    const preview: SituationReviewPreview = { worldId, issueId, proofHash, review: state.review, ready: errors.length === 0, errors: [...new Set(errors)] };
    const assertCurrent = async (tx: SqliteTransaction): Promise<void> => {
      const current = await this.readState(tx, worldId, issueId);
      await store.assertSourceBindingCurrent(tx, worldId, snapshot.binding);
      if (await sha256Hex(stable({ ...current.seal, sourceBinding: snapshot.binding })) !== proofHash) throw refresh();
    };
    return { preview, draft, assertCurrent };
  }

  async prepare(worldId: string, issueId: string): Promise<SituationReviewPreview> {
    return (await this.prepareMaterial(worldId, issueId)).preview;
  }

  private async recordDecision(tx: SqliteTransaction, preview: SituationReviewPreview, decision: 'rejected' | 'published', artifact?: SegmentArtifactV1): Promise<void> {
    const now = new Date().toISOString();
    if (decision === 'rejected') await tx.execute(`INSERT INTO review_resolution_policies (world_id,kind,severity,detail_json,resolution,resolved_at)
      VALUES (?,'mapping_situation','major',?,'resolved',?) ON CONFLICT(world_id,kind,severity,detail_json)
      DO UPDATE SET resolution=excluded.resolution,resolved_at=excluded.resolved_at`, [preview.worldId, stable(preview.review), now]);
    const changed = await tx.execute("UPDATE review_issues SET status='resolved',resolved_at=? WHERE world_id=? AND issue_id=? AND status='open'",
      [now, preview.worldId, preview.issueId]);
    if (changed !== 1) throw refresh();
    await tx.execute(`INSERT INTO review_issues (world_id,issue_id,kind,severity,detail_json,status,created_at,resolved_at)
      VALUES (?,?,'situation_mapping_decision','minor',?,'resolved',?,?)`, [preview.worldId, `situation-decision-${preview.proofHash}`,
      JSON.stringify({ decision, proofHash: preview.proofHash, review: preview.review, ...(artifact ? { artifactId: artifact.artifactId, contentHash: artifact.contentHash } : {}) }), now, now]);
  }

  async reject(worldId: string, issueId: string, expectedProofHash: string): Promise<void> {
    const material = await this.prepareMaterial(worldId, issueId);
    if (material.preview.proofHash !== expectedProofHash) throw refresh();
    await this.publication.deps.store.db.transaction(async tx => {
      await material.assertCurrent(tx);
      await this.recordDecision(tx, material.preview, 'rejected');
    });
  }

  async publish(worldId: string, issueId: string, expectedProofHash: string): Promise<SegmentArtifactV1> {
    const material = await this.prepareMaterial(worldId, issueId);
    if (material.preview.proofHash !== expectedProofHash) throw refresh();
    if (!material.preview.ready) throw new Error(`局面尚未通过发布验证：${material.preview.errors.join('；')}`);
    return this.publication.publishArtifact({ ...material.draft, assertCurrent: material.assertCurrent,
      onPublished: (tx, artifact) => this.recordDecision(tx, material.preview, 'published', artifact) });
  }
}
