import type { ProjectStyleEditV1 } from '../../src/domain/style/types';
import { ProjectStyleService } from '../../src/application/writerStyle/projectStyleService';
import { GovernedWriterStyleAnalyzer } from '../../src/application/writerStyle/sourceAnalyzer';
import { OpenAICompatibleProvider } from '../../src/application/llm/openAICompatible';
import { RateScheduledProvider } from '../../src/application/llm/scheduledProvider';
import { llmModelProfileFingerprint } from '../../src/application/llm/profileFingerprint';
import { freezeRunConfig } from '../../src/application/worldBuild/runConfig';
import { modelBudgetFromProfile } from '../../src/application/worldBuild/profileModelBudget';
import { getDatabaseRuntime } from './database';
import { loadApiProfile } from './profileStore';
import { nativeSha256 } from './nativeCrypto';
import { schedulerForProfile } from './llmScheduler';
import { KeychainSecretStore } from './secureKeyStore';
import { FetchHttpTransport } from './fetchTransport';

export async function getProjectWriterStyle(projectId: string) {
  return (await getDatabaseRuntime()).projectStyle.getProjectStyle(projectId);
}
export async function updateProjectWriterStyle(input: ProjectStyleEditV1) {
  return (await getDatabaseRuntime()).projectStyle.updateProjectStyle(input);
}
export async function listProjectStyleSuggestions(projectId: string) {
  return (await getDatabaseRuntime()).projectStyle.getSourceStyleSuggestions(projectId);
}
export async function adoptProjectStyleSuggestion(projectId: string, profileVersion: string, expectedVersion: string) {
  return (await getDatabaseRuntime()).projectStyle.adoptSourceStyleSuggestion({ projectId, profileVersion, expectedVersion });
}
export async function reanalyzeProjectStyle(projectId: string): Promise<void> {
  const result = await analyzeProjectStyle(projectId, true);
  if (result.status === 'failed') throw new Error(`风格分析未完成：${result.errorCode ?? 'analysis_failed'}`);
}

/** The bootstrap host starts this without awaiting it. The durable M8 claim,
 * shared P3 scheduler and ledger keep it separate from opening and turns. */
export async function ensureAutomaticProjectStyleAnalysis(projectId: string): Promise<void> {
  const runtime = await getDatabaseRuntime();
  if (!await runtime.worldStore.getWorld(projectId) || !await loadApiProfile()) return;
  const binding = await runtime.projectStyle.getProjectStyle(projectId);
  // Cold-start unknown outcomes remain failed, and explicit user selections
  // need no automatic paid analysis. Source changes can be analyzed on demand.
  if (binding.mode !== 'source' || binding.analysisStatus !== 'pending') return;
  await analyzeProjectStyle(projectId, false);
}

async function analyzeProjectStyle(projectId: string, retryKnownFailure: boolean) {
  const runtime = await getDatabaseRuntime();
  const profile = await loadApiProfile();
  if (!profile) throw new Error('请先配置可用的 API。');
  const { members } = await runtime.sourceCatalog.snapshot(projectId);
  // A few bounded windows from the opening sources; never load the entire novel.
  const samples = [];
  for (const member of members.slice(0, 3)) {
    const range = await runtime.sourceCatalog.createRange(member.sourceId, 0, Math.min(member.codePointCount, 1800));
    samples.push({ range, text: await runtime.sourceCatalog.readRange(range) });
  }
  const scheduled = new RateScheduledProvider(new OpenAICompatibleProvider(profile, new KeychainSecretStore(), new FetchHttpTransport(), 300_000), schedulerForProfile(profile));
  const provider = scheduled.withLedger(runtime.llmLedger, { modelProfileFingerprint: llmModelProfileFingerprint(profile) });
  const service = new ProjectStyleService({ store: runtime.writerStyleStore, hash: nativeSha256,
    analyzer: new GovernedWriterStyleAnalyzer(provider, profile),
    isSampleCurrent: async (worldId, windows) => {
      if (!await runtime.worldStore.getWorld(worldId)) return false;
      try {
        const current = await runtime.sourceCatalog.snapshot(worldId);
        for (const sample of windows) {
          if (!current.members.some(m => m.sourceId === sample.range.sourceId && m.normalizedTreeHash === sample.range.normalizedTreeHash)) return false;
          await runtime.sourceCatalog.readRange(sample.range);
        }
        return true;
      } catch { return false; }
    },
  });
  return service.analyzeSourceStyle({ projectId, samples,
    configFingerprint: await nativeSha256.sha256Hex(JSON.stringify(freezeRunConfig(profile, modelBudgetFromProfile(profile)))), retryKnownFailure });
}
