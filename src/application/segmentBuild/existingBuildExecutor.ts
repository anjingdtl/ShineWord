import type { BuildExecutorPortV1, BuildExecutionViewV1, BuildIntentV1, SourceCatalogPortV1 } from '../ports/phase6';
import type { BuildRunStore } from '../ports/worldBuildStore';
import type { SourceStore } from '../ports/sourceStore';
import type { WorldStore } from '../ports/worldStore';
import { isBuildIntentV1 } from '../../domain/build/validation';
import { createExtractionRun } from '../worldBuild/coordinator';
import { worldBuildExtractorVersion } from '../world/llmExtractor';
import type { FrozenRunConfig } from '../worldBuild/runConfig';
import type { LlmBuildRecoveryPort } from '../ports/llmLedger';

/** Adapter from a logical multi-source segment to the EXISTING fenced run/unit engine. */
export class ExistingBuildExecutor implements BuildExecutorPortV1 {
  constructor(private readonly deps: {
    sources: SourceStore; worlds: WorldStore; runs: BuildRunStore; catalog: SourceCatalogPortV1;
    ledger: Pick<LlmBuildRecoveryPort, 'readBuildRequestOutcome'>;
    config(worldId: string, fingerprint: string): Promise<FrozenRunConfig>;
    sha256Hex(input: string): Promise<string>;
    control?(runId: string, command: 'pause' | 'resume' | 'cancel'): Promise<void>;
  }) {}
  async ensureRun(intent: BuildIntentV1): Promise<{ runIds: readonly string[] }> {
    if (!isBuildIntentV1(intent) || !await this.deps.catalog.isBindingCompatible(intent.worldId,intent.sourceBinding))
      throw new Error('invalid_build_intent');
    const world = await this.deps.worlds.getWorld(intent.worldId);
    if (!world) throw new Error('project_deleted');
    const config = await this.deps.config(intent.worldId,intent.executionConfigFingerprint);
    const ids: string[]=[];
    for (const [i,range] of intent.ranges.entries()) {
      await this.deps.catalog.readRange(range);
      const runId=`phase6-${intent.segmentId}-g${intent.generation}-r${i}`;
      let run=await this.deps.runs.getRun(runId);
      if (!run) {
        try {
          run=await createExtractionRun({sourceStore:this.deps.sources,worldStore:this.deps.worlds,runStore:this.deps.runs,
            sha256Hex:this.deps.sha256Hex}, {runId,worldId:intent.worldId,sourceId:range.sourceId,title:world.title,
            modelFingerprint:`${config.endpoint}#${config.model}`,extractorVersion:worldBuildExtractorVersion(config.reasoningTier),
            mode:'group',config,scope:{startCp:range.startCp,endCp:range.endCp},budget:{
              contextWindowTokens:config.contextWindowTokens,maxContentOutputTokens:config.contentOutputTokens,
              reasoningReserveTokens:config.reasoningReserveTokens,reserveTokens:1500,
              reasoningTier:config.reasoningTier,reasoningEffort:config.reasoningTier,
              reasoningDialect:config.reasoningDialect,supportsPromptCache:config.supportsPromptCache,
            }});
        } catch (error) {
          run=await this.deps.runs.getRun(runId);
          if (!run) throw error;
        }
      }
      const expectedScope=JSON.stringify({startCp:range.startCp,endCp:range.endCp});
      if (run.worldId!==intent.worldId || run.sourceId!==range.sourceId || run.scopeJson!==expectedScope
        || !run.sourceSnapshotHash.endsWith(`:${range.normalizedTreeHash}`)) throw new Error('run_intent_mismatch');
      ids.push(runId);
    }
    return {runIds:ids};
  }
  async requestControl(runId: string, command: 'pause' | 'resume' | 'cancel'): Promise<void> {
    if (this.deps.control) return this.deps.control(runId,command);
    // The composition root must install host control before starting work.
    throw new Error('execution_host_not_attached');
  }
  async readExecution(runId:string):Promise<BuildExecutionViewV1> {
    const run=await this.deps.runs.getRun(runId);
    if (!run) throw new Error('run_missing');
    const units=await this.deps.runs.listUnits(runId);
    const retryAt=units.map(u=>u.retryAt).filter((v):v is string=>v!==null).sort()[0]??null;
    const ledgerOutcome = await this.deps.ledger.readBuildRequestOutcome(runId, run.worldId);
    return {runId,phase:run.phase,status:run.status,completedUnits:run.unitsDone,failedUnits:run.unitsFailed,totalUnits:run.unitsTotal,
      requestOutcome:ledgerOutcome !== 'none' ? ledgerOutcome : run.lastErrorCode?.includes('outcome_unknown') || units.some(u => u.errorCode?.includes('outcome_unknown'))
        ?'outcome_unknown':run.status==='completed'?'known':'none',
      lastErrorCode:ledgerOutcome === 'outcome_unknown' ? 'outcome_unknown'
        : ledgerOutcome === 'known' && run.lastErrorCode?.includes('outcome_unknown') ? null : run.lastErrorCode,
      retryAt,fencingToken:run.fencingToken};
  }
}
