import type { GameStateSnapshot } from '../../domain/state/types';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
import type { SqliteDatabase } from '../ports/sqlite';

export const SAVE_SCHEMA_VERSION = 'shineword-save-1';
export const SAVE_FILE_EXTENSION = '.shineword-save.json';

export interface SaveManifest {
  schemaVersion: typeof SAVE_SCHEMA_VERSION;
  createdAt: string;
  campaignId: string;
  worldRef: {
    worldId: string;
    sourceSha256: string;
    /** World packages are referenced by hash; worlds are not embedded. */
  };
  rulesetId: string;
  rulesetVersion: string;
  branchId: string;
  stateVersion: number;
}

export interface SaveFile {
  manifest: SaveManifest;
  state: GameStateSnapshot;
  turns: Array<{
    turnId: string;
    status: string;
    outcomeGrade: string | null;
    committedStateVersion: number | null;
    actionContractHash: string;
    rollJson: string | null;
    narrativeText: string | null;
  }>;
  skills: Array<{ actorId: string; skillId: string; rank: string; practicePoints: number; awardedTurns: string[] }>;
  relationships: Array<{ relId: string; fromActorId: string; toActorId: string; stance: string; closeness: number }>;
  memories: Array<{ memoryId: string; kind: string; summary: string; fromStateVersion: number; toStateVersion: number }>;
  /** Integrity digest over the payload above (manifest.sha256 carries it). */
}

const FORBIDDEN_SAVE_KEYS = new Set(['apikey', 'api_key', 'key', 'secret', 'token', 'authorization']);

function assertNoSecrets(save: unknown, path: string): void {
  if (Array.isArray(save)) {
    save.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (typeof save !== 'object' || save === null) return;
  for (const [key, value] of Object.entries(save as Record<string, unknown>)) {
    if (FORBIDDEN_SAVE_KEYS.has(key.toLowerCase()) && typeof value === 'string' && value.trim().length > 0) {
      throw new Error(`Save export contains a forbidden key at ${path}.${key}.`);
    }
    assertNoSecrets(value, `${path}.${key}`);
  }
}

export interface ExportSaveInput {
  db: SqliteDatabase;
  sha256Hex: Sha256HexProvider['sha256Hex'];
  campaignId: string;
  branchId: string;
  createdAt: string;
}

export async function exportSave(input: ExportSaveInput): Promise<{ save: SaveFile; json: string }> {
  const { db } = input;
  const campaign = await db.queryOne<{ world_id: string; title: string; ruleset_id: string; ruleset_version: string }>(
    'SELECT world_id, title, ruleset_id, ruleset_version FROM campaigns WHERE campaign_id = ?',
    [input.campaignId],
  );
  if (!campaign) throw new Error(`Unknown campaign: ${input.campaignId}.`);
  const world = await db.queryOne<{ source_sha256: string }>(
    'SELECT source_sha256 FROM worlds WHERE world_id = ?',
    [campaign.world_id],
  );
  if (!world) throw new Error(`Campaign world is missing: ${campaign.world_id}.`);
  const state = await db.queryOne<{ snapshot_json: string; state_version: number }>(
    'SELECT snapshot_json, state_version FROM snapshots WHERE branch_id = ? ORDER BY state_version DESC LIMIT 1',
    [input.branchId],
  );
  if (!state) throw new Error(`Branch has no snapshot: ${input.branchId}.`);

  const turnRows = await db.queryAll<{
    turn_id: string;
    status: string;
    outcome_grade: string | null;
    committed_state_version: number | null;
    action_contract_hash: string;
  }>(
    'SELECT turn_id, status, outcome_grade, committed_state_version, action_contract_hash FROM turns WHERE branch_id = ? ORDER BY created_at',
    [input.branchId],
  );
  const turns = [];
  for (const turn of turnRows) {
    const roll = await db.queryOne<{ rolls_json: string }>(
      'SELECT rolls_json FROM roll_records WHERE branch_id = ? AND turn_id = ? AND roll_index = 0',
      [input.branchId, turn.turn_id],
    );
    const narrative = await db.queryOne<{ text: string }>(
      'SELECT text FROM turn_narratives WHERE branch_id = ? AND turn_id = ?',
      [input.branchId, turn.turn_id],
    );
    turns.push({
      turnId: turn.turn_id,
      status: turn.status,
      outcomeGrade: turn.outcome_grade,
      committedStateVersion: turn.committed_state_version,
      actionContractHash: turn.action_contract_hash,
      rollJson: roll?.rolls_json ?? null,
      narrativeText: narrative?.text ?? null,
    });
  }

  const skills = await db.queryAll<{ actor_id: string; skill_id: string; rank: string; practice_points: number; awarded_turns_json: string }>(
    'SELECT actor_id, skill_id, rank, practice_points, awarded_turns_json FROM actor_skills WHERE branch_id = ?',
    [input.branchId],
  );
  const relationships = await db.queryAll<{ rel_id: string; from_actor_id: string; to_actor_id: string; stance: string; closeness: number }>(
    'SELECT rel_id, from_actor_id, to_actor_id, stance, closeness FROM relationships WHERE branch_id = ?',
    [input.branchId],
  );
  const memories = await db.queryAll<{ memory_id: string; kind: string; summary: string; from_state_version: number; to_state_version: number }>(
    'SELECT memory_id, kind, summary, from_state_version, to_state_version FROM memories WHERE branch_id = ?',
    [input.branchId],
  );

  const manifest: SaveManifest = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    createdAt: input.createdAt,
    campaignId: input.campaignId,
    worldRef: { worldId: campaign.world_id, sourceSha256: world.source_sha256 },
    rulesetId: campaign.ruleset_id,
    rulesetVersion: campaign.ruleset_version,
    branchId: input.branchId,
    stateVersion: state.state_version,
  };

  const save: SaveFile = {
    manifest,
    state: JSON.parse(state.snapshot_json) as GameStateSnapshot,
    turns,
    skills: skills.map(skill => ({
      actorId: skill.actor_id,
      skillId: skill.skill_id,
      rank: skill.rank,
      practicePoints: skill.practice_points,
      awardedTurns: JSON.parse(skill.awarded_turns_json) as string[],
    })),
    relationships: relationships.map(rel => ({
      relId: rel.rel_id,
      fromActorId: rel.from_actor_id,
      toActorId: rel.to_actor_id,
      stance: rel.stance,
      closeness: rel.closeness,
    })),
    memories: memories.map(memory => ({
      memoryId: memory.memory_id,
      kind: memory.kind,
      summary: memory.summary,
      fromStateVersion: memory.from_state_version,
      toStateVersion: memory.to_state_version,
    })),
  };

  assertNoSecrets(save, 'save');
  const json = JSON.stringify(save, null, 2);
  return { save, json };
}

export interface ImportSaveValidation {
  ok: boolean;
  errors: string[];
}

/** Structural validation only; restoring is a fork into the local DB. */
export function validateSaveJson(json: string, maxSizeBytes = 8 * 1024 * 1024): ImportSaveValidation {
  const errors: string[] = [];
  if (json.length > maxSizeBytes) {
    return { ok: false, errors: [`Save file exceeds ${maxSizeBytes} bytes.`] };
  }
  let parsed: SaveFile;
  try {
    parsed = JSON.parse(json) as SaveFile;
  } catch {
    return { ok: false, errors: ['Save file is not valid JSON.'] };
  }
  if (parsed.manifest?.schemaVersion !== SAVE_SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion: ${String(parsed.manifest?.schemaVersion)}.`);
  }
  if (!parsed.manifest?.branchId || !parsed.manifest?.campaignId) {
    errors.push('Manifest requires campaignId and branchId.');
  }
  if (!parsed.state?.branchId || typeof parsed.state.stateVersion !== 'number') {
    errors.push('Save state snapshot is malformed.');
  }
  if (!Array.isArray(parsed.turns)) errors.push('turns must be an array.');
  if (!Array.isArray(parsed.skills)) errors.push('skills must be an array.');
  try {
    assertNoSecrets(parsed, 'save');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { ok: errors.length === 0, errors };
}
