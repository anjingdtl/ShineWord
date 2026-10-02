import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import type { SourceStore } from '../ports/sourceStore';
import type { BuildRunRecord } from '../ports/worldBuildStore';
import type { SqliteTransaction } from '../ports/sqlite';
import { parseExtractionCheckpoint } from './coordinator';
import { applyExtraction } from '../world/extraction';
import { normalizeFactValue } from '../world/factValueAdapter';

/** Local repair of a previously verified response's wrapper shape. Never
 * requests a provider, guesses coordinates, touches counters or waives gates. */
export async function replayCompletedLocationAdapter(input: { worldStore: SqliteWorldStore; sourceStore: SourceStore;
  run: BuildRunRecord; sha256Hex(text: string): string | Promise<string>; assertCurrent(tx: SqliteTransaction): Promise<void>;
}): Promise<void> {
  const { run, worldStore, sourceStore } = input;
  if (!run.scopeJson || !run.modelFingerprint) return;
  const scope = JSON.parse(run.scopeJson) as { startCp: number; endCp: number };
  const chapters = await sourceStore.getChapters(run.sourceId);
  const now = new Date().toISOString();
  for (const job of await worldStore.listExtractionRequestCheckpoints(run.worldId, run.modelFingerprint)) {
    if (!job.resultJson || !job.extractorVersion?.includes(run.sourceSnapshotHash)) continue;
    const group = parseExtractionCheckpoint(job.resultJson);
    if (!group) continue;
    const facts = group.facts.filter(f => f.predicate === 'current_location' && f.evidence
      && f.evidence.startOffset >= scope.startCp && f.evidence.endOffset <= scope.endCp
      && JSON.stringify(normalizeFactValue(f.predicate, f.value, f.evidence.quote)) !== JSON.stringify(f.value))
      .map(f => ({ ...f, value: normalizeFactValue(f.predicate, f.value, f.evidence.quote) }));
    if (!facts.length) continue;
    const resolved = await applyExtraction({ worldId: run.worldId, source: { chapters,
      sliceRange: (start,end)=>sourceStore.readRange(run.sourceId,start,end) }, extraction: { entities: group.entities, facts, events: [], ruleMappings: [] },
      createdAt: now, sha256Hex: input.sha256Hex, strictLocationClaims: true });
    for (const fact of resolved.facts) {
      const factId = `fact-${run.worldId}-value-adapter-${await input.sha256Hex(JSON.stringify({ sourceId: run.sourceId, subject: fact.subjectEntityId, value: fact.value, sources: fact.sources }))}`;
      await worldStore.saveFact({ ...fact, factId }, now, input.assertCurrent);
    }
  }
}
