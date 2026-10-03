import type { BuildRunRecord, BuildUnitRecord } from '../ports/worldBuildStore';

/** unitsFailed is a historical attempt counter, not unfinished extraction. */
export function isRunExtractionComplete(
  run: Pick<BuildRunRecord, 'unitsDone' | 'unitsTotal'>,
  units: readonly Pick<BuildUnitRecord, 'status'>[],
): boolean {
  // Replanning/splitting retains canceled parents for audit while removing
  // them from unitsTotal. Only effective work belongs in this completion gate.
  const effective = units.filter(unit => unit.status !== 'canceled');
  return run.unitsTotal > 0 && run.unitsDone === run.unitsTotal
    && effective.length === run.unitsTotal && effective.every(unit => unit.status === 'completed');
}

/** Count committed extraction units plus mapping, review/validation and publication.
 * These are completed work steps, not elapsed-time estimates. */
export function taskOverallProgress(task: Pick<BuildRunRecord, 'phase' | 'status' | 'unitsDone' | 'unitsTotal'>): {
  done: number; total: number; ratio: number; valueText: string;
} {
  const total = Math.max(0, task.unitsTotal) + 3;
  const extractionDone = Math.max(0, Math.min(task.unitsDone, task.unitsTotal));
  const mappingDone = task.phase === 'validating' || task.phase === 'publishing';
  const reviewDone = task.phase === 'publishing';
  const done = task.status === 'completed' ? total
    : extractionDone + Number(mappingDone) + Number(reviewDone);
  return { done, total, ratio: done / total,
    valueText: `${done}/${total} 步 · ${Math.floor(done / total * 100)}%` };
}
