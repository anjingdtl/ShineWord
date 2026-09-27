import type { GameStateSnapshot } from '../../domain/state/types';
import {
  canonicalStringify,
  type CanonicalJson,
  type Sha256HexProvider,
} from '../../domain/turns/canonical';
import type { SqliteDatabase } from '../ports/sqlite';

export const SAVE_SCHEMA_VERSION = 'shineword-save-2';
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
  /** SHA-256 over the canonical JSON of the payload below (integrity only). */
  payloadSha256: string;
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
  skills: Array<{ actorId: string; skillId: string; rank: string; practicePoints: number; awardedKeys: string[] }>;
  relationships: Array<{ relId: string; fromActorId: string; toActorId: string; stance: string; closeness: number }>;
  memories: Array<{ memoryId: string; kind: string; summary: string; fromStateVersion: number; toStateVersion: number }>;
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

/** UTF-8 byte length without TextEncoder (Hermes-safe). */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

function payloadForHash(save: Omit<SaveFile, 'manifest'>): CanonicalJson {
  return {
    state: save.state as unknown as CanonicalJson,
    turns: save.turns as unknown as CanonicalJson,
    skills: save.skills as unknown as CanonicalJson,
    relationships: save.relationships as unknown as CanonicalJson,
    memories: save.memories as unknown as CanonicalJson,
  };
}

export interface ExportSaveInput {
  db: SqliteDatabase;
  sha256Hex: Sha256HexProvider['sha256Hex'];
  campaignId: string;
  branchId: string;
  createdAt: string;
}

export async function exportSave(input: ExportSaveInput): Promise<{ save: SaveFile; json: string; jsonByteLength: number }> {
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

  const payload = {
    state: JSON.parse(state.snapshot_json) as GameStateSnapshot,
    turns,
    skills: skills.map(skill => ({
      actorId: skill.actor_id,
      skillId: skill.skill_id,
      rank: skill.rank,
      practicePoints: skill.practice_points,
      awardedKeys: JSON.parse(skill.awarded_turns_json) as string[],
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

  const payloadSha256 = await input.sha256Hex(canonicalStringify(payloadForHash(payload)));

  const manifest: SaveManifest = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    createdAt: input.createdAt,
    campaignId: input.campaignId,
    worldRef: { worldId: campaign.world_id, sourceSha256: world.source_sha256 },
    rulesetId: campaign.ruleset_id,
    rulesetVersion: campaign.ruleset_version,
    branchId: input.branchId,
    stateVersion: state.state_version,
    payloadSha256,
  };

  const save: SaveFile = { manifest, ...payload };

  assertNoSecrets(save, 'save');
  const json = JSON.stringify(save, null, 2);
  return { save, json, jsonByteLength: utf8ByteLength(json) };
}

export interface ImportSaveValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Full structural + integrity validation. Byte length is measured in UTF-8
 * bytes (never JS string length). The payload digest must match; turn
 * versions must stay consistent with the snapshot.
 */
export function validateSaveJson(
  json: string,
  sha256Hex: Sha256HexProvider['sha256Hex'],
  maxBytes = 8 * 1024 * 1024,
): Promise<ImportSaveValidation> {
  return validateSaveJsonBytes(utf8ByteLength(json), json, sha256Hex, maxBytes);
}

export async function validateSaveJsonBytes(
  byteLength: number,
  json: string,
  sha256Hex: Sha256HexProvider['sha256Hex'],
  maxBytes = 8 * 1024 * 1024,
): Promise<ImportSaveValidation> {
  const errors: string[] = [];
  if (byteLength > maxBytes) {
    return { ok: false, errors: [`Save file exceeds ${maxBytes} bytes (got ${byteLength}).`] };
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
  if (!Array.isArray(parsed.relationships)) errors.push('relationships must be an array.');
  if (!Array.isArray(parsed.memories)) errors.push('memories must be an array.');
  if (errors.length > 0) {
    try {
      assertNoSecrets(parsed, 'save');
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    return { ok: false, errors };
  }

  if (parsed.state.branchId !== parsed.manifest.branchId) {
    errors.push('Snapshot branchId does not match the manifest.');
  }
  if (parsed.state.stateVersion !== parsed.manifest.stateVersion) {
    errors.push('Snapshot stateVersion does not match the manifest.');
  }
  const committed = parsed.turns
    .map(turn => turn.committedStateVersion)
    .filter((version): version is number => version !== null);
  if (committed.length > 0 && Math.max(...committed) > parsed.manifest.stateVersion) {
    errors.push('A committed turn references a state version beyond the snapshot.');
  }
  for (const skill of parsed.skills) {
    if (!/^(untrained|novice|trained|expert|master)$/.test(skill.rank)) {
      errors.push(`Skill ${skill.skillId} has invalid rank ${skill.rank}.`);
    }
    if (skill.practicePoints < 0) {
      errors.push(`Skill ${skill.skillId} has negative practice points.`);
    }
  }
  try {
    assertNoSecrets(parsed, 'save');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    const expected = await sha256Hex(canonicalStringify(payloadForHash(parsed)));
    if (expected.toLowerCase() !== parsed.manifest.payloadSha256?.toLowerCase()) {
      errors.push('Payload digest mismatch: the save file is corrupted or was modified.');
    }
  } catch (error) {
    errors.push(`Payload digest could not be computed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ok: errors.length === 0, errors };
}

export interface RestoreSaveInput {
  db: SqliteDatabase;
  save: SaveFile;
  /** New campaign identity for the imported game (never overwrites). */
  newCampaignId: string;
  newBranchId: string;
  createdAt: string;
}

export interface RestoreSaveResult {
  campaignId: string;
  branchId: string;
  stateVersion: number;
}

/**
 * Restores a validated save as a NEW campaign/branch in one transaction.
 * Requires the referenced world (by id and source SHA-256) to already exist
 * locally — a missing dependency is an explicit error, never a silent
 * substitution. Colliding ids are remapped by the caller-provided new ids.
 */
export async function restoreSave(input: RestoreSaveInput): Promise<RestoreSaveResult> {
  const { db, save } = input;
  const { manifest } = save;

  const world = await db.queryOne<{ source_sha256: string }>(
    'SELECT source_sha256 FROM worlds WHERE world_id = ?',
    [manifest.worldRef.worldId],
  );
  if (!world) {
    throw new Error(
      `Missing dependency: world ${manifest.worldRef.worldId} is not present on this device. ` +
        'Import the world package first; the save cannot be restored without it.',
    );
  }
  if (world.source_sha256 !== manifest.worldRef.sourceSha256) {
    throw new Error(
      `World ${manifest.worldRef.worldId} exists but its source hash differs from the save manifest; refusing to mix versions.`,
    );
  }

  const campaignExists = await db.queryOne('SELECT campaign_id FROM campaigns WHERE campaign_id = ?', [input.newCampaignId]);
  if (campaignExists) throw new Error(`Campaign id already in use: ${input.newCampaignId}.`);
  const branchExists = await db.queryOne('SELECT branch_id FROM branches WHERE branch_id = ?', [input.newBranchId]);
  if (branchExists) throw new Error(`Branch id already in use: ${input.newBranchId}.`);

  await db.transaction(async tx => {
    await tx.execute(
      `INSERT INTO campaigns (campaign_id, world_id, title, ruleset_id, ruleset_version, world_mapping_version, opening_json, created_at, status)
       VALUES (?, ?, ?, ?, ?, '{}', ?, ?, 'restored')`,
      [
        input.newCampaignId,
        manifest.worldRef.worldId,
        `${manifest.campaignId} (imported)`,
        manifest.rulesetId,
        manifest.rulesetVersion,
        JSON.stringify({ restoredFrom: manifest.campaignId, payloadSha256: manifest.payloadSha256 }),
        input.createdAt,
      ],
    );
    await tx.execute(
      `INSERT INTO branches (branch_id, campaign_id, parent_branch_id, fork_turn_id, state_version, created_at)
       VALUES (?, ?, NULL, NULL, ?, ?)`,
      [input.newBranchId, input.newCampaignId, manifest.stateVersion, input.createdAt],
    );

    const state = save.state;
    for (const actor of Object.values(state.actors)) {
      await tx.execute(
        `INSERT INTO actor_states (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.newBranchId, actor.actorId, state.stateVersion, actor.locationId, JSON.stringify(actor.resources), JSON.stringify(actor.conditions)],
      );
    }
    for (const [itemId, owner] of Object.entries(state.itemOwners)) {
      await tx.execute(
        'INSERT INTO inventory (branch_id, item_id, owner_actor_id, state_version) VALUES (?, ?, ?, ?)',
        [input.newBranchId, itemId, owner, state.stateVersion],
      );
    }
    await tx.execute(
      `INSERT INTO snapshots (branch_id, state_version, snapshot_json, state_hash, created_at)
       VALUES (?, ?, ?, NULL, ?)`,
      [input.newBranchId, state.stateVersion, JSON.stringify(state), input.createdAt],
    );

    for (const skill of save.skills) {
      await tx.execute(
        `INSERT INTO actor_skills (branch_id, actor_id, skill_id, rank, practice_points, awarded_turns_json, state_version)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [input.newBranchId, skill.actorId, skill.skillId, skill.rank, skill.practicePoints, JSON.stringify(skill.awardedKeys), state.stateVersion],
      );
    }
    for (const rel of save.relationships) {
      await tx.execute(
        `INSERT INTO relationships (branch_id, rel_id, from_actor_id, to_actor_id, stance, closeness, updated_turn_id, state_version)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
        [input.newBranchId, rel.relId, rel.fromActorId, rel.toActorId, rel.stance, rel.closeness, state.stateVersion],
      );
    }
    for (const memory of save.memories) {
      await tx.execute(
        `INSERT OR IGNORE INTO memories (branch_id, memory_id, kind, summary, from_state_version, to_state_version, invalid_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
        [input.newBranchId, memory.memoryId, memory.kind, memory.summary, memory.fromStateVersion, memory.toStateVersion, input.createdAt],
      );
    }

    for (const turn of save.turns) {
      if (!turn.actionContractHash) continue;
      await tx.execute(
        `INSERT OR IGNORE INTO turns
          (branch_id, turn_id, status, expected_state_version, committed_state_version,
           action_contract_json, action_contract_hash, outcome_grade, public_summary,
           effects_json, created_at, committed_at)
         VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, '[]', ?, ?)`,
        [
          input.newBranchId,
          turn.turnId,
          turn.status,
          turn.committedStateVersion ?? 0,
          turn.committedStateVersion,
          turn.actionContractHash,
          turn.outcomeGrade,
          turn.narrativeText ? turn.narrativeText.slice(0, 200) : null,
          input.createdAt,
          turn.committedStateVersion !== null ? input.createdAt : null,
        ],
      );
      if (turn.rollJson && turn.outcomeGrade) {
        const roll = JSON.parse(turn.rollJson) as {
          rulesetId?: string;
          rulesetVersion?: string;
          diceCount?: number;
          dieSides?: number;
          rolls?: number[];
          highest?: number;
          difficulty?: number;
          margin?: number;
          grade?: string;
        };
        if (roll.diceCount !== undefined && roll.rolls) {
          await tx.execute(
            `INSERT OR IGNORE INTO roll_records
              (branch_id, turn_id, roll_index, ruleset_id, ruleset_version, contract_hash,
               dice_count, die_sides, rolls_json, highest, difficulty, margin, grade, created_at)
             VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              input.newBranchId,
              turn.turnId,
              roll.rulesetId ?? manifest.rulesetId,
              roll.rulesetVersion ?? manifest.rulesetVersion,
              turn.actionContractHash,
              roll.diceCount,
              roll.dieSides ?? 6,
              JSON.stringify(roll.rolls),
              roll.highest ?? Math.max(...roll.rolls),
              roll.difficulty ?? 0,
              roll.margin ?? 0,
              roll.grade ?? turn.outcomeGrade,
              input.createdAt,
            ],
          );
        }
      }
      if (turn.narrativeText && turn.status === 'Committed') {
        await tx.execute(
          `INSERT OR IGNORE INTO turn_narratives (branch_id, turn_id, outcome_grade, text, status, created_at)
           VALUES (?, ?, ?, ?, 'Committed', ?)`,
          [input.newBranchId, turn.turnId, turn.outcomeGrade ?? 'success', turn.narrativeText, input.createdAt],
        );
      }
    }
  });

  return {
    campaignId: input.newCampaignId,
    branchId: input.newBranchId,
    stateVersion: manifest.stateVersion,
  };
}
