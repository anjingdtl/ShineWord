import type { ProjectStylePortV1 } from '../ports/phase6';
import type { EffectiveStyleSnapshotV1, ProjectStyleEditV1, ProjectStyleViewV1, StyleSemanticV1 } from '../../domain/style/types';
import { STYLE_COMPILER_VERSION } from '../../domain/style/types';
import { DEFAULT_STYLE, DEFAULT_STYLE_ASSET_VERSION, DEFAULT_STYLE_ID } from '../../domain/style/defaults';
import { getWriterStylePreset } from '../../domain/style/presets';
import { isSourceRangeV1 } from '../../domain/build/validation';
import { validateStyleId, validateStyleOverrides, validateStyleSemantic, validateStyleSnapshot, validateStyleText } from '../../domain/style/validation';
import { stableFingerprint } from '../llm/requestPlan';
import { estimateTokens } from '../context/tokenEstimate';
import { compileWriterStyle, resolveStyleSemantic } from './compiler';
import type { ParticipantVoicePort, ProjectStyleBindingRecord, SourceStyleProfile, SourceStyleSample, WriterStyleStore } from './ports';
import { sampleWriterStyleSource, STYLE_SAMPLER_VERSION } from './sourceSampler';
import type { StyleHashPort } from './sourceSampler';
import type { WriterStyleAnalyzerPort } from './sourceAnalyzer';
import { STYLE_ANALYZER_VERSION } from './sourceAnalyzer';
import type { SqliteTransaction } from '../ports/sqlite';
import type { PortableProjectStyleV1 } from '../export/phase6Bundle';
import { computePortableProjectStyleHash, validatePortableProjectStyle } from '../export/phase6Bundle';

export class StyleVersionConflictError extends Error {
  constructor(readonly currentVersion: string) { super('项目风格已更新，请读取最新版本后保存。'); this.name = 'StyleVersionConflictError'; }
}
export interface ProjectStyleServiceOptions {
  store: WriterStyleStore; hash: StyleHashPort; analyzer?: WriterStyleAnalyzerPort;
  voices?: ParticipantVoicePort; now?: () => string;
  /** Source adapter rechecks unchanged membership hashes before/after paid work. */
  isSampleCurrent?: (projectId: string, samples: readonly SourceStyleSample[]) => Promise<boolean>;
}
export interface SourceStyleAnalysisOutcome {
  status: 'ready' | 'suggestion' | 'running' | 'failed'; profile: SourceStyleProfile | null;
  cacheHit: boolean; cacheKey: string; errorCode: string | null;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const bindingVersion = (binding: Pick<ProjectStyleBindingRecord, 'projectId' | 'revision' | 'mode' | 'baseline' | 'overrides'>): string =>
  `style-${binding.revision}-${stableFingerprint(binding)}`;
const toView = (record: ProjectStyleBindingRecord): ProjectStyleViewV1 => {
  const { baseline: _baseline, revision: _revision, sourceBaseline: _source, ...view } = record;
  const source = rememberedSource(record);
  return clone({ ...view, ...(source ? { sourceSemantic: source.semantic } : {}) });
};
const rememberedSource = (record: ProjectStyleBindingRecord): ProjectStyleBindingRecord['sourceBaseline'] =>
  record.sourceBaseline ?? (record.mode === 'source' && record.sourceProfileVersion
    ? { styleId: record.styleId, profileVersion: record.sourceProfileVersion, semantic: record.baseline } : undefined);

/** Owns project binding/profile/snapshot writes; never touches facts or branch state. */
export class ProjectStyleService implements ProjectStylePortV1 {
  private readonly now: () => string;
  constructor(private readonly options: ProjectStyleServiceOptions) { this.now = options.now ?? (() => new Date().toISOString()); }
  private async binding(projectId: string): Promise<ProjectStyleBindingRecord> {
    validateStyleId(projectId);
    const saved = await this.options.store.getBinding(projectId);
    if (saved) return saved;
    const baseline = await this.options.store.putAsset({ assetId: DEFAULT_STYLE_ID, assetVersion: DEFAULT_STYLE_ASSET_VERSION, semantic: clone(DEFAULT_STYLE) });
    const initial: ProjectStyleBindingRecord = {
      projectId, mode: 'source', styleId: `${DEFAULT_STYLE_ID}@${DEFAULT_STYLE_ASSET_VERSION}`,
      styleVersion: '', revision: 1, sourceProfileVersion: null, userOverrideVersion: 0,
      baseline: clone(baseline), semantic: clone(baseline), overrides: {}, analysisStatus: 'pending',
    };
    initial.styleVersion = bindingVersion(initial);
    return this.options.store.initializeBinding(initial);
  }
  async getProjectStyle(projectId: string): Promise<ProjectStyleViewV1> { return toView(await this.binding(projectId)); }
  async exportProjectStyle(projectId: string): Promise<PortableProjectStyleV1 | null> {
    const saved = await this.options.store.getBinding(projectId);
    if (!saved) return null;
    let source = rememberedSource(saved);
    if (!source) {
      const profile = (await this.options.store.listProfiles(projectId))[0];
      if (profile) source = { styleId: profile.profileId, profileVersion: profile.profileVersion, semantic: profile.semantic };
    }
    const binding = { ...saved, ...(source ? { sourceBaseline: clone(source) } : {}) };
    return { schemaVersion: 'shineword-project-style-1', binding: clone(binding),
      contentHash: await computePortableProjectStyleHash(binding, this.options.hash.sha256Hex.bind(this.options.hash)) };
  }
  async restoreProjectStyle(tx: SqliteTransaction, targetProjectId: string, style: PortableProjectStyleV1): Promise<void> {
    validateStyleId(targetProjectId);
    if (!await validatePortableProjectStyle(style, style.binding.projectId, this.options.hash.sha256Hex.bind(this.options.hash))) {
      throw new Error('invalid_portable_project_style');
    }
    const binding: ProjectStyleBindingRecord = { ...clone(style.binding), projectId: targetProjectId,
      styleId: style.binding.mode === 'custom' ? `custom:${targetProjectId}` : style.binding.styleId,
      // An in-flight task is neither exported nor resumed from an archive.
      analysisStatus: style.binding.analysisStatus === 'running' ? 'failed' : style.binding.analysisStatus,
    };
    binding.styleVersion = bindingVersion(binding);
    await this.options.store.initializeImportedBinding(tx, binding);
  }
  async updateProjectStyle(input: ProjectStyleEditV1): Promise<{ styleVersion: string }> {
    validateStyleOverrides(input.overrides);
    if (!['source', 'preset', 'custom'].includes(input.mode)) throw new Error('invalid_style_mode');
    const current = await this.binding(input.projectId);
    if (current.styleVersion !== input.expectedVersion) throw new StyleVersionConflictError(current.styleVersion);
    let baseline = current.baseline, styleId = current.styleId, sourceProfileVersion = current.sourceProfileVersion;
    let sourceBaseline = rememberedSource(current);
    if (input.mode === 'preset') {
      const selected = getWriterStylePreset(input.presetId ?? '');
      baseline = await this.options.store.putAsset({ assetId: selected.id, assetVersion: selected.version, semantic: selected.semantic });
      styleId = `${selected.id}@${selected.version}`; sourceProfileVersion = null;
    } else if (input.mode === 'custom') {
      baseline = current.mode === 'custom' ? current.baseline : current.semantic;
      styleId = `custom:${current.projectId}`; sourceProfileVersion = null;
    } else if (current.mode !== 'source') {
      const profiles = await this.options.store.listProfiles(input.projectId);
      // Keep the last selected source baseline across mode switches/imports.
      // Without one, use the earliest learned profile; later ones are suggestions.
      const profile = profiles[0];
      sourceBaseline ??= profile ? { styleId: profile.profileId, profileVersion: profile.profileVersion, semantic: profile.semantic } : undefined;
      baseline = sourceBaseline?.semantic ?? clone(DEFAULT_STYLE);
      styleId = sourceBaseline?.styleId ?? `${DEFAULT_STYLE_ID}@${DEFAULT_STYLE_ASSET_VERSION}`;
      sourceProfileVersion = sourceBaseline?.profileVersion ?? null;
    }
    const next: ProjectStyleBindingRecord = { ...current, mode: input.mode, styleId, sourceProfileVersion,
      ...(sourceBaseline ? { sourceBaseline: clone(sourceBaseline) } : {}),
      baseline: clone(baseline), overrides: clone(input.overrides), semantic: resolveStyleSemantic(baseline, input.overrides),
      userOverrideVersion: current.userOverrideVersion + 1, revision: current.revision + 1,
      analysisStatus: input.mode === 'source' ? (sourceProfileVersion ? 'ready' : 'pending') : current.analysisStatus,
    };
    next.styleVersion = bindingVersion(next);
    if (!await this.options.store.compareAndSetBinding(next, current.styleVersion)) {
      throw new StyleVersionConflictError((await this.binding(input.projectId)).styleVersion);
    }
    return { styleVersion: next.styleVersion };
  }
  async freezeEffectiveStyle(input: Parameters<ProjectStylePortV1['freezeEffectiveStyle']>[0]): Promise<EffectiveStyleSnapshotV1> {
    for (const value of [input.projectId, input.branchId, input.turnId, input.sceneKind]) validateStyleId(value);
    // A retry resolves the durable record before current settings, scene or
    // budget are inspected. Editing settings cannot drift a frozen operation.
    const existing = await this.options.store.getSnapshot(input.projectId, input.branchId, input.turnId);
    if (existing) return clone(existing);
    if (!Array.isArray(input.participantIds)) throw new Error('invalid_style_participants');
    for (const id of input.participantIds) validateStyleId(id);
    const participantIds = [...new Set(input.participantIds)].slice(0, 5);
    const current = await this.binding(input.projectId);
    const voices = this.options.voices ? await this.options.voices.resolveKnownVoices({ projectId: input.projectId, branchId: input.branchId, participantIds }) : [];
    const projection = compileWriterStyle({ baseline: current.baseline, overrides: current.overrides,
      sceneKind: input.sceneKind, participantIds, voices, tokenAllowance: input.tokenAllowance });
    const snapshotId = `style-snapshot:${await this.options.hash.sha256Hex(JSON.stringify([input.projectId, input.branchId, input.turnId]))}`;
    const snapshot: EffectiveStyleSnapshotV1 = {
      snapshotId, projectId: input.projectId, branchId: input.branchId, turnId: input.turnId,
      styleId: current.styleId, styleVersion: current.styleVersion, sourceProfileVersion: current.sourceProfileVersion,
      userOverrideVersion: current.userOverrideVersion, compilerVersion: STYLE_COMPILER_VERSION,
      projectionLevel: projection.level, compiledHash: await this.options.hash.sha256Hex(projection.text), compiledText: projection.text,
      semantic: projection.semantic, tokenEstimate: projection.tokenEstimate, sceneKind: input.sceneKind, participantIds,
    };
    return clone(await this.options.store.putSnapshot(snapshot));
  }
  /** Independent, bounded P3 job. No turn method invokes the analyzer. */
  async analyzeSourceStyle(input: {
    projectId: string; samples: readonly SourceStyleSample[]; configFingerprint: string;
    /** An operator/user retry may reclaim a known failed task, never an unknown running task. */
    retryKnownFailure?: boolean;
  }): Promise<SourceStyleAnalysisOutcome> {
    validateStyleId(input.configFingerprint);
    await this.binding(input.projectId);
    const samples = await sampleWriterStyleSource(input.samples, this.options.hash);
    if (this.options.isSampleCurrent && !await this.options.isSampleCurrent(input.projectId, samples)) throw new Error('style_source_changed');
    const sampleHash = await this.options.hash.sha256Hex(JSON.stringify(samples.map(sample => sample.range)));
    const cacheKey = await this.options.hash.sha256Hex(JSON.stringify({ sampleHash,
      samplerVersion: STYLE_SAMPLER_VERSION, analyzerVersion: STYLE_ANALYZER_VERSION, config: input.configFingerprint }));
    const cached = await this.options.store.getProfile(input.projectId, cacheKey);
    if (cached) {
      const status = await this.attachProfile(cached);
      return { status, profile: cached, cacheHit: true, cacheKey, errorCode: null };
    }
    const logicalRequestId = `style-analysis:${input.projectId}:${cacheKey}`;
    const record = { projectId: input.projectId, cacheKey, logicalRequestId, status: 'running' as const, errorCode: null, updatedAt: this.now() };
    const old = await this.options.store.getAnalysis(input.projectId, cacheKey);
    const claimed = old?.status === 'failed' && input.retryKnownFailure
      ? await this.options.store.retryFailedAnalysis(record) : await this.options.store.claimAnalysis(record);
    if (!claimed) {
      const pending = await this.options.store.getAnalysis(input.projectId, cacheKey);
      const lateProfile = await this.options.store.getProfile(input.projectId, cacheKey);
      if (lateProfile) return { status: await this.attachProfile(lateProfile), profile: lateProfile, cacheHit: true, cacheKey, errorCode: null };
      return { status: pending?.status === 'failed' ? 'failed' : 'running', profile: null, cacheHit: true, cacheKey, errorCode: pending?.errorCode ?? null };
    }
    await this.setAnalysisStatus(input.projectId, 'running');
    try {
      if (!this.options.analyzer) throw new Error('style_analyzer_unconfigured');
      const result = await this.options.analyzer.analyze({ projectId: input.projectId, logicalRequestId, samples });
      if (this.options.isSampleCurrent && !await this.options.isSampleCurrent(input.projectId, samples)) throw new Error('style_source_changed');
      validateStyleSemantic(result.semantic); validateStyleText(result.coverageDescription, 'coverageDescription', 160);
      if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1
        || !Array.isArray(result.evidence) || result.evidence.length > samples.length
        || !result.evidence.every(range => isSourceRangeV1(range) && samples.some(sample => JSON.stringify(sample.range) === JSON.stringify(range)))) throw new Error('invalid_style_analysis_evidence');
      const profile: SourceStyleProfile = { profileId: `source-style:${cacheKey}`, projectId: input.projectId,
        cacheKey, profileVersion: cacheKey, sampleHash, samplerVersion: STYLE_SAMPLER_VERSION,
        analyzerVersion: STYLE_ANALYZER_VERSION, configFingerprint: input.configFingerprint,
        semantic: clone(result.semantic), confidence: result.confidence, coverageDescription: result.coverageDescription,
        evidence: clone(result.evidence), createdAt: this.now() };
      await this.options.store.finishAnalysis({ ...record, status: 'ready', updatedAt: this.now() }, profile);
      return { status: await this.attachProfile(profile), profile, cacheHit: false, cacheKey, errorCode: null };
    } catch (error) {
      // Persist only a redacted classifier, never provider prose/sample text.
      const errorCode = error instanceof Error ? error.name === 'Error'
        ? (/^[a-z_]+(?::[a-zA-Z]+)?$/.test(error.message) ? error.message : 'style_analysis_failed') : error.name : 'style_analysis_failed';
      try {
        await this.options.store.finishAnalysis({ ...record, status: 'failed', errorCode, updatedAt: this.now() });
        await this.setAnalysisStatus(input.projectId, 'failed');
      } catch { /* A deleted project must not be recreated by a late completion. */ }
      return { status: 'failed', profile: null, cacheHit: false, cacheKey, errorCode };
    }
  }
  async recoverAllInterruptedAnalyses(): Promise<number> {
    const records = await this.options.store.listInterruptedAnalyses();
    let count = 0;
    for (const record of records) if (await this.recoverInterruptedAnalysis(record.projectId, record.cacheKey)) count++;
    return count;
  }
  /** Cold-start marks work interrupted; this deliberately does not resend. */
  async recoverInterruptedAnalysis(projectId: string, cacheKey: string): Promise<boolean> {
    const record = await this.options.store.getAnalysis(projectId, cacheKey);
    if (record?.status !== 'running') return false;
    await this.options.store.finishAnalysis({ ...record, status: 'failed', errorCode: 'style_analysis_interrupted_outcome_unknown', updatedAt: this.now() });
    await this.setAnalysisStatus(projectId, 'failed'); return true;
  }
  private async setAnalysisStatus(projectId: string, status: ProjectStyleViewV1['analysisStatus']): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
      const current = await this.options.store.getBinding(projectId);
      if (!current) throw new Error('style_project_deleted');
      if (current.analysisStatus === status) return;
      const next = { ...current, analysisStatus: status, revision: current.revision + 1 };
      next.styleVersion = bindingVersion(next);
      if (await this.options.store.compareAndSetBinding(next, current.styleVersion)) return;
    }
    throw new Error('style_analysis_binding_conflict');
  }
  private async attachProfile(profile: SourceStyleProfile): Promise<'ready' | 'suggestion'> {
    for (let i = 0; i < 4; i += 1) {
      const current = await this.options.store.getBinding(profile.projectId);
      if (!current) throw new Error('style_project_deleted');
      const use = current.mode === 'source' && (current.sourceProfileVersion === null || current.sourceProfileVersion === profile.profileVersion);
      const status = use ? 'ready' : 'suggestion';
      if (current.sourceProfileVersion === profile.profileVersion && current.analysisStatus === status) return status;
      const baseline = use ? profile.semantic : current.baseline;
      const next: ProjectStyleBindingRecord = { ...current,
        ...(use ? { sourceBaseline: { styleId: profile.profileId, profileVersion: profile.profileVersion, semantic: clone(profile.semantic) } } : {}),
        baseline: clone(baseline), semantic: resolveStyleSemantic(baseline, current.overrides),
        sourceProfileVersion: use ? profile.profileVersion : current.sourceProfileVersion,
        styleId: use ? profile.profileId : current.styleId, analysisStatus: status, revision: current.revision + 1 };
      next.styleVersion = bindingVersion(next);
      if (await this.options.store.compareAndSetBinding(next, current.styleVersion)) return status;
    }
    throw new Error('style_analysis_binding_conflict');
  }
  async getSourceStyleSuggestions(projectId: string): Promise<SourceStyleProfile[]> {
    const current = await this.binding(projectId);
    return (await this.options.store.listProfiles(projectId)).filter(profile => profile.profileVersion !== current.sourceProfileVersion);
  }
  async adoptSourceStyleSuggestion(input: { projectId: string; profileVersion: string; expectedVersion: string }): Promise<{ styleVersion: string }> {
    const current = await this.binding(input.projectId);
    if (current.styleVersion !== input.expectedVersion) throw new StyleVersionConflictError(current.styleVersion);
    const profile = (await this.options.store.listProfiles(input.projectId)).find(item => item.profileVersion === input.profileVersion);
    if (!profile) throw new Error('unknown_style_profile');
    const next: ProjectStyleBindingRecord = { ...current, mode: 'source', baseline: clone(profile.semantic),
      sourceBaseline: { styleId: profile.profileId, profileVersion: profile.profileVersion, semantic: clone(profile.semantic) },
      semantic: resolveStyleSemantic(profile.semantic, current.overrides), styleId: profile.profileId,
      sourceProfileVersion: profile.profileVersion, analysisStatus: 'ready', revision: current.revision + 1 };
    next.styleVersion = bindingVersion(next);
    if (!await this.options.store.compareAndSetBinding(next, current.styleVersion)) throw new StyleVersionConflictError((await this.binding(input.projectId)).styleVersion);
    return { styleVersion: next.styleVersion };
  }
  async exportSnapshots(projectId: string, branchId?: string): Promise<EffectiveStyleSnapshotV1[]> {
    return clone(await this.options.store.listSnapshots(projectId, branchId));
  }
  async restoreSnapshots(projectId: string, snapshots: readonly EffectiveStyleSnapshotV1[]): Promise<void> {
    if (snapshots.length > 20000) throw new Error('too_many_style_snapshots');
    const seen = new Map<string, string>();
    // Validate the complete payload before performing a single write.
    for (const snapshot of snapshots) {
      validateStyleSnapshot(snapshot);
      if (snapshot.projectId !== projectId || await this.options.hash.sha256Hex(snapshot.compiledText) !== snapshot.compiledHash
        || snapshot.tokenEstimate !== estimateTokens(snapshot.compiledText)) throw new Error('style_snapshot_restore_hash_or_scope_mismatch');
      const current = await this.options.store.getSnapshot(projectId, snapshot.branchId, snapshot.turnId);
      const key = JSON.stringify([snapshot.branchId, snapshot.turnId]);
      const serialized = JSON.stringify(snapshot);
      if ((seen.has(key) && seen.get(key) !== serialized) || (current && JSON.stringify(current) !== serialized)) throw new Error('immutable_style_snapshot_conflict');
      seen.set(key, serialized);
    }
    for (const snapshot of snapshots) {
      const stored = await this.options.store.putSnapshot(clone(snapshot));
      if (JSON.stringify(stored) !== JSON.stringify(snapshot)) throw new Error('immutable_style_snapshot_conflict');
    }
  }
}

/** Save/archive import gate: validates recoverable content, estimate and digest. */
export async function verifyEffectiveStyleSnapshotHash(value: unknown, hash: StyleHashPort): Promise<boolean> {
  try {
    validateStyleSnapshot(value);
    return value.tokenEstimate === estimateTokens(value.compiledText)
      && await hash.sha256Hex(value.compiledText) === value.compiledHash;
  } catch { return false; }
}
