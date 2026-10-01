import type { GameStateSnapshot } from '../../domain/state/types';
import {
  canonicalStringify,
  type CanonicalJson,
  type Sha256HexProvider,
} from '../../domain/turns/canonical';
import type { SqliteDatabase } from '../ports/sqlite';
import { replaceEncounterSnapshots } from '../../infra/sqlite/encounterPersistence';
import { SqliteTurnStore } from '../../infra/sqlite/sqliteTurnStore';
import type { BranchContentManifest, ProgressiveDeltaPackage } from '../../domain/content/types';
import { createBaseContentManifest, isBranchContentManifestStructure, isProgressiveDeltaPackageStructure,
  verifyContentManifest, verifyDeltaPackage } from '../worldPackage/contentManifest';
import { hasBranchContentManifestTable, insertBranchContentManifest, readBranchContentManifest, rebindBranchContentManifest } from '../worldPackage/branchContentStore';

export const SAVE_SCHEMA_VERSION = 'shineword-save-6';
export const SAVE_FILE_EXTENSION = '.shineword-save.json';
/** Previous full-save schema with rewind history, before branch content manifests. */
export const PREVIOUS_SAVE_SCHEMA_VERSION = 'shineword-save-5';
/** Earlier full-save schema; it contains encounters but no rewind history. */
export const OLDER_SAVE_SCHEMA_VERSION = 'shineword-save-4';
/** Save schema that predates encounter snapshots. */
export const OLDER_V3_SAVE_SCHEMA_VERSION = 'shineword-save-3';
/** Legacy schema that predates complete card/contract/roll round-trips. */
export const LEGACY_SAVE_SCHEMA_VERSION = 'shineword-save-2';

export interface SaveManifest {
  schemaVersion: typeof SAVE_SCHEMA_VERSION | typeof PREVIOUS_SAVE_SCHEMA_VERSION | typeof OLDER_SAVE_SCHEMA_VERSION | typeof OLDER_V3_SAVE_SCHEMA_VERSION;
  createdAt: string;
  campaignId: string;
  /** Optional for older saves; preserves the user-facing campaign name. */
  title?: string;
  worldRef: {
    worldId: string;
    sourceSha256: string;
    /** Exact immutable package content locked by the campaign (portable across local world-id remapping). */
    packageContentHash?: string;
    /** World packages are referenced by hash; worlds are not embedded. */
  };
  /**
   * Campaign dependency lock (P2 acceptance A05): a restored game continues
   * on EXACTLY this published package revision.
   */
  packageRevision: number;
  rulesetId: string;
  rulesetVersion: string;
  /** The campaign's main goal, restored into opening_json. */
  goal: string;
  branchId: string;
  stateVersion: number;
  anchorJson: unknown;
  /** SHA-256 over the canonical JSON of the payload below (integrity only). */
  payloadSha256: string;
}

export interface SavedTurn {
  turnId: string;
  status: string;
  outcomeGrade: string | null;
  committedStateVersion: number | null;
  expectedStateVersion: number;
  /** The COMPLETE frozen contract (staged or committed). */
  actionContractJson: string;
  actionContractHash: string;
  /** Full roll record (dice, difficulty, grade) — restores rolled-but-uncommitted turns. */
  rollRecord: SavedRoll | null;
  narrativeText: string | null;
}

export interface SavedRoll {
  rulesetId: string;
  rulesetVersion: string;
  rollIndex: number;
  contractHash: string;
  diceCount: number;
  dieSides: number;
  rolls: number[];
  highest: number;
  difficulty: number;
  margin: number;
  grade: string;
  createdAt: string;
}

export interface SavedSnapshot {
  stateVersion: number;
  snapshot: GameStateSnapshot;
  createdAt: string;
}

export interface SaveFile {
  manifest: SaveManifest;
  state: GameStateSnapshot;
  /** Immutable published branch deltas referenced by this save's history. */
  contentDeltas?: ProgressiveDeltaPackage[];
  /** Full branch snapshot history, including battlefield state at every rewind point. */
  snapshotHistory?: SavedSnapshot[];
  turns: SavedTurn[];
  skills: Array<{ actorId: string; skillId: string; rank: string; practicePoints: number; awardedKeys: string[] }>;
  relationships: Array<{ relId: string; fromActorId: string; toActorId: string; stance: string; closeness: number }>;
  memories: Array<{ memoryId: string; kind: string; summary: string; fromStateVersion: number; toStateVersion: number }>;
  /** Character cards (full card JSON) — without them the game cannot continue. */
  cards: Array<{ actorId: string; cardJson: string }>;
  party: Array<{ actorId: string; controller: string; role: string; joinedAt: string; groupId?: string }>;
  /** Reward ledger — the hard dedup gate, restored so replays never double-award. */
  rewardLedger: Array<{ encounterId: string; actorId: string; skillId: string; rewardKind: string; grantedAt: string }>;
  /** Immutable branch event log (audit + derived-projection rebuild input). */
  branchEvents: Array<{ eventSeq: number; turnId: string; stateVersion: number; eventType: string; payloadJson: string }>;
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
  const payload: Record<string, CanonicalJson> = {
    state: save.state as unknown as CanonicalJson,
    turns: save.turns as unknown as CanonicalJson,
    skills: save.skills as unknown as CanonicalJson,
    relationships: save.relationships as unknown as CanonicalJson,
    memories: save.memories as unknown as CanonicalJson,
    cards: save.cards as unknown as CanonicalJson,
    party: save.party as unknown as CanonicalJson,
    rewardLedger: save.rewardLedger as unknown as CanonicalJson,
    branchEvents: save.branchEvents as unknown as CanonicalJson,
  };
  if (save.snapshotHistory !== undefined) {
    payload.snapshotHistory = save.snapshotHistory as unknown as CanonicalJson;
  }
  if (save.contentDeltas !== undefined) {
    payload.contentDeltas = save.contentDeltas as unknown as CanonicalJson;
  }
  return payload;
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
  const campaign = await db.queryOne<{
    world_id: string;
    title: string;
    ruleset_id: string;
    ruleset_version: string;
    package_revision: number | null;
    anchor_json: string | null;
    opening_json: string;
  }>(
    'SELECT world_id, title, ruleset_id, ruleset_version, package_revision, anchor_json, opening_json FROM campaigns WHERE campaign_id = ?',
    [input.campaignId],
  );
  if (!campaign) throw new Error(`Unknown campaign: ${input.campaignId}.`);
  const world = await db.queryOne<{ source_sha256: string }>(
    'SELECT source_sha256 FROM worlds WHERE world_id = ?',
    [campaign.world_id],
  );
  if (!world) throw new Error(`Campaign world is missing: ${campaign.world_id}.`);
  const stateHead = await db.queryOne<{ snapshot_json: string; state_version: number }>(
    'SELECT snapshot_json, state_version FROM snapshots WHERE branch_id = ? ORDER BY state_version DESC LIMIT 1',
    [input.branchId],
  );
  if (!stateHead) throw new Error(`Branch has no snapshot: ${input.branchId}.`);
  let state = await new SqliteTurnStore(db).getState(input.branchId);
  if (!state) throw new Error(`Branch has no state: ${input.branchId}.`);
  if (state.stateVersion !== stateHead.state_version) {
    throw new Error(`Branch state version ${state.stateVersion} does not match its latest snapshot ${stateHead.state_version}.`);
  }
  const snapshotRows = await db.queryAll<{ state_version: number; snapshot_json: string; created_at: string }>(
    'SELECT state_version, snapshot_json, created_at FROM snapshots WHERE branch_id = ? ORDER BY state_version',
    [input.branchId],
  );
  const encounterRows = await db.queryOne<{ count: number }>(
    'SELECT COUNT(*) AS count FROM encounters WHERE branch_id = ?', [input.branchId]);
  const firstEncounter = await db.queryOne<{ state_version: number | null }>(
    `SELECT MIN(state_version) AS state_version FROM branch_events
      WHERE branch_id = ? AND event_type = 'encounter_started'`, [input.branchId]);
  const snapshotHistory: SavedSnapshot[] = snapshotRows.map(row => {
    const snapshot = JSON.parse(row.snapshot_json) as GameStateSnapshot;
    if (!Array.isArray(snapshot.encounters)) {
      const isKnownPreEncounter = (encounterRows?.count ?? 0) === 0 ||
        (firstEncounter?.state_version !== null && firstEncounter?.state_version !== undefined &&
          row.state_version < firstEncounter.state_version);
      if (!isKnownPreEncounter) {
        throw new Error(`Snapshot at stateVersion ${row.state_version} is missing encounter history; refusing to export an incomplete combat save.`);
      }
      snapshot.encounters = [];
    }
    return { stateVersion: row.state_version, snapshot, createdAt: row.created_at };
  });
  if (snapshotHistory.length === 0 || snapshotHistory[snapshotHistory.length - 1]?.stateVersion !== state.stateVersion) {
    throw new Error(`Branch snapshot history does not contain its current state: ${input.branchId}.`);
  }
  const lockedPackage = campaign.package_revision === null
    ? null
    : await db.queryOne<{ content_hash: string; status: string }>(
        'SELECT content_hash, status FROM world_packages WHERE world_id = ? AND revision = ?',
        [campaign.world_id, campaign.package_revision],
      );
  if (campaign.package_revision !== null && (!lockedPackage || lockedPackage.status !== 'published')) {
    throw new Error(`Campaign package dependency ${campaign.world_id} r${campaign.package_revision} is missing or unpublished.`);
  }

  const contentDeltas: ProgressiveDeltaPackage[] = [];
  if (campaign.package_revision !== null && lockedPackage) {
    const manifestByDelta = new Map<string, BranchContentManifest['deltas'][number]>();
    const hasManifestTable = await hasBranchContentManifestTable(db);
    for (const historyItem of snapshotHistory) {
      const stored = hasManifestTable
        ? await readBranchContentManifest(db, input.branchId, historyItem.stateVersion)
        : null;
      const original: BranchContentManifest = stored ?? historyItem.snapshot.contentManifest ?? createBaseContentManifest({
        worldId: campaign.world_id,
        branchId: input.branchId,
        stateVersion: historyItem.stateVersion,
        basePackage: { revision: campaign.package_revision, contentHash: lockedPackage.content_hash },
      });
      if (original.basePackage.revision !== campaign.package_revision ||
          original.basePackage.contentHash.toLowerCase() !== lockedPackage.content_hash.toLowerCase()) {
        throw new Error(`Snapshot ${historyItem.stateVersion} is bound to a different immutable base package.`);
      }
      const manifest = rebindBranchContentManifest(original, input.branchId, historyItem.stateVersion, campaign.world_id);
      if (!await verifyContentManifest(manifest, input.sha256Hex)) {
        throw new Error(`Snapshot ${historyItem.stateVersion} has a corrupt content manifest.`);
      }
      historyItem.snapshot.contentManifest = manifest;
      for (const ref of manifest.deltas) {
        if (ref.publishedAtStateVersion > historyItem.stateVersion) {
          throw new Error(`Snapshot ${historyItem.stateVersion} references a delta from a later state.`);
        }
        manifestByDelta.set(ref.deltaId, ref);
      }
    }
    const headManifest = snapshotHistory[snapshotHistory.length - 1]?.snapshot.contentManifest;
    if (headManifest) state = { ...state, contentManifest: headManifest };
    for (const ref of manifestByDelta.values()) {
      const row = await db.queryOne<{ status: string; content_hash: string; package_json: string }>(
        `SELECT status, content_hash, package_json FROM progressive_world_deltas WHERE delta_id = ?`, [ref.deltaId],
      );
      if (!row || row.status !== 'published') throw new Error(`Published content delta ${ref.deltaId} is missing from this save.`);
      let delta: ProgressiveDeltaPackage;
      try { delta = JSON.parse(row.package_json) as ProgressiveDeltaPackage; }
      catch { throw new Error(`Published content delta ${ref.deltaId} is malformed.`); }
      if (delta.contentHash.toLowerCase() !== row.content_hash.toLowerCase() || !await verifyDeltaPackage(delta, {
        deltaId: ref.deltaId, contentHash: ref.contentHash, baseContentHash: lockedPackage.content_hash,
      }, input.sha256Hex)) {
        throw new Error(`Published content delta ${ref.deltaId} failed save integrity verification.`);
      }
      contentDeltas.push(delta);
    }
  }

  const turnRows = await db.queryAll<{
    turn_id: string;
    status: string;
    outcome_grade: string | null;
    committed_state_version: number | null;
    expected_state_version: number;
    action_contract_json: string;
    action_contract_hash: string;
  }>(
    'SELECT turn_id, status, outcome_grade, committed_state_version, expected_state_version, action_contract_json, action_contract_hash FROM turns WHERE branch_id = ? ORDER BY created_at',
    [input.branchId],
  );
  const turns: SavedTurn[] = [];
  for (const turn of turnRows) {
    const roll = await db.queryOne<{
      ruleset_id: string;
      ruleset_version: string;
      roll_index: number;
      contract_hash: string;
      dice_count: number;
      die_sides: number;
      rolls_json: string;
      highest: number;
      difficulty: number;
      margin: number;
      grade: string;
      created_at: string;
    }>(
      'SELECT ruleset_id, ruleset_version, roll_index, contract_hash, dice_count, die_sides, rolls_json, highest, difficulty, margin, grade, created_at FROM roll_records WHERE branch_id = ? AND turn_id = ? AND roll_index = 0',
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
      expectedStateVersion: turn.expected_state_version,
      actionContractJson: turn.action_contract_json,
      actionContractHash: turn.action_contract_hash,
      rollRecord: roll
        ? {
            rulesetId: roll.ruleset_id,
            rulesetVersion: roll.ruleset_version,
            rollIndex: roll.roll_index,
            contractHash: roll.contract_hash,
            diceCount: roll.dice_count,
            dieSides: roll.die_sides,
            rolls: JSON.parse(roll.rolls_json) as number[],
            highest: roll.highest,
            difficulty: roll.difficulty,
            margin: roll.margin,
            grade: roll.grade,
            createdAt: roll.created_at,
          }
        : null,
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
  const cards = await db.queryAll<{ actor_id: string; card_json: string }>(
    'SELECT actor_id, card_json FROM actor_cards WHERE branch_id = ? ORDER BY actor_id',
    [input.branchId],
  );
  const party = await db.queryAll<{ actor_id: string; controller: string; role: string; joined_at: string; party_group_id: string }>(
    'SELECT actor_id, controller, role, joined_at, party_group_id FROM party_members WHERE branch_id = ? ORDER BY actor_id',
    [input.branchId],
  );
  const ledger = await db.queryAll<{ encounter_id: string; actor_id: string; skill_id: string; reward_kind: string; granted_at: string }>(
    'SELECT encounter_id, actor_id, skill_id, reward_kind, granted_at FROM reward_ledger WHERE branch_id = ?',
    [input.branchId],
  );
  const events = await db.queryAll<{ event_seq: number; turn_id: string; state_version: number; event_type: string; payload_json: string }>(
    'SELECT event_seq, turn_id, state_version, event_type, payload_json FROM branch_events WHERE branch_id = ? ORDER BY event_seq',
    [input.branchId],
  );

  const payload = {
    state,
    contentDeltas,
    snapshotHistory,
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
    cards: cards.map(card => ({ actorId: card.actor_id, cardJson: card.card_json })),
    party: party.map(member => ({
      actorId: member.actor_id,
      controller: member.controller,
      role: member.role,
      joinedAt: member.joined_at,
      groupId: member.party_group_id,
    })),
    rewardLedger: ledger.map(row => ({
      encounterId: row.encounter_id,
      actorId: row.actor_id,
      skillId: row.skill_id,
      rewardKind: row.reward_kind,
      grantedAt: row.granted_at,
    })),
    branchEvents: events.map(event => ({
      eventSeq: event.event_seq,
      turnId: event.turn_id,
      stateVersion: event.state_version,
      eventType: event.event_type,
      payloadJson: event.payload_json,
    })),
  };

  const payloadSha256 = await input.sha256Hex(canonicalStringify(payloadForHash(payload)));

  const manifest: SaveManifest = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    createdAt: input.createdAt,
    campaignId: input.campaignId,
    title: campaign.title,
    worldRef: {
      worldId: campaign.world_id,
      sourceSha256: world.source_sha256,
      ...(lockedPackage ? { packageContentHash: lockedPackage.content_hash } : {}),
    },
    packageRevision: campaign.package_revision ?? 0,
    rulesetId: campaign.ruleset_id,
    rulesetVersion: campaign.ruleset_version,
    goal: readCampaignGoal(campaign.opening_json),
    branchId: input.branchId,
    stateVersion: stateHead.state_version,
    anchorJson: campaign.anchor_json ? JSON.parse(campaign.anchor_json) : {},
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
 * versions must stay consistent with the snapshot. Legacy v2 saves are
 * refused with an explicit policy message: they predate complete
 * card/contract/roll capture and cannot be continued faithfully (plan §15.3).
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
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, errors: ['Save file root must be a JSON object.'] };
    }
    parsed = value as SaveFile;
  } catch {
    return { ok: false, errors: ['Save file is not valid JSON.'] };
  }
  const schemaVersion = parsed.manifest?.schemaVersion;
  if (schemaVersion !== SAVE_SCHEMA_VERSION && schemaVersion !== PREVIOUS_SAVE_SCHEMA_VERSION &&
      schemaVersion !== OLDER_SAVE_SCHEMA_VERSION && schemaVersion !== OLDER_V3_SAVE_SCHEMA_VERSION) {
    if (schemaVersion === LEGACY_SAVE_SCHEMA_VERSION) {
      return {
        ok: false,
        errors: [
          `Legacy ${LEGACY_SAVE_SCHEMA_VERSION} saves predate complete card/contract/roll capture ` +
            'and cannot be continued faithfully. Keep the original device data or start a new campaign ' +
            '(plan §15.3: unverifiable history is never fabricated).',
        ],
      };
    }
    errors.push(`Unsupported schemaVersion: ${String(schemaVersion)}.`);
  }
  if (!parsed.manifest?.branchId || !parsed.manifest?.campaignId) {
    errors.push('Manifest requires campaignId and branchId.');
  }
  if (!Number.isInteger(parsed.manifest?.packageRevision) || (parsed.manifest?.packageRevision ?? 0) < 1) {
    errors.push('Manifest requires a positive packageRevision dependency lock.');
  }
  const packageContentHash = parsed.manifest?.worldRef?.packageContentHash;
  if (packageContentHash !== undefined && (typeof packageContentHash !== 'string' || !/^[a-f0-9]{64}$/i.test(packageContentHash))) {
    errors.push('Manifest worldRef.packageContentHash must be a SHA-256 hex digest when present.');
  }
  if (!parsed.state?.branchId || typeof parsed.state.stateVersion !== 'number') {
    errors.push('Save state snapshot is malformed.');
  }
  if ((schemaVersion === SAVE_SCHEMA_VERSION || schemaVersion === PREVIOUS_SAVE_SCHEMA_VERSION) &&
      !Array.isArray(parsed.state?.encounters)) {
    errors.push('Save is missing complete encounter and battlefield snapshots.');
  }
  if ((schemaVersion === SAVE_SCHEMA_VERSION || schemaVersion === PREVIOUS_SAVE_SCHEMA_VERSION) &&
      (!Array.isArray(parsed.snapshotHistory) || parsed.snapshotHistory.length === 0)) {
    errors.push('Save is missing the full branch snapshot history required for rewind and combat recovery.');
  }
  if (parsed.manifest?.title !== undefined && typeof parsed.manifest.title !== 'string') {
    errors.push('Manifest title must be text when present.');
  }
  if (schemaVersion === SAVE_SCHEMA_VERSION && !Array.isArray(parsed.contentDeltas)) {
    errors.push('Save v6 is missing its immutable progressive content package list.');
  }
  if (schemaVersion === SAVE_SCHEMA_VERSION && Array.isArray(parsed.contentDeltas) &&
      parsed.contentDeltas.some(delta => !isProgressiveDeltaPackageStructure(delta))) {
    errors.push('Save v6 contains a malformed progressive content package.');
  }
  if ((schemaVersion === SAVE_SCHEMA_VERSION || schemaVersion === PREVIOUS_SAVE_SCHEMA_VERSION) &&
      Array.isArray(parsed.snapshotHistory) && parsed.snapshotHistory.some(item =>
        !item || typeof item !== 'object' || Array.isArray(item) ||
        !('snapshot' in item) || !item.snapshot || typeof item.snapshot !== 'object' || Array.isArray(item.snapshot))) {
    errors.push('Save snapshot history contains a malformed entry.');
  }
  if (!Array.isArray(parsed.turns)) errors.push('turns must be an array.');
  if (!Array.isArray(parsed.skills)) errors.push('skills must be an array.');
  if (!Array.isArray(parsed.relationships)) errors.push('relationships must be an array.');
  if (!Array.isArray(parsed.memories)) errors.push('memories must be an array.');
  if (!Array.isArray(parsed.cards) || parsed.cards.length === 0) {
    errors.push('cards must be a non-empty array (a save without cards cannot continue).');
  }
  if (!Array.isArray(parsed.party) || parsed.party.length === 0) {
    errors.push('party must be a non-empty array.');
  }
  if (!Array.isArray(parsed.rewardLedger)) errors.push('rewardLedger must be an array.');
  if (!Array.isArray(parsed.branchEvents)) errors.push('branchEvents must be an array.');
  if (schemaVersion === OLDER_V3_SAVE_SCHEMA_VERSION && !Array.isArray(parsed.state?.encounters)) {
    const containsTemporaryActor = Array.isArray(parsed.cards) && parsed.cards.some(card => {
      try {
        const value = JSON.parse(card.cardJson) as { controller?: string };
        return value.controller === 'gm';
      } catch {
        return false;
      }
    });
    if (containsTemporaryActor) {
        errors.push('This v3 save contains temporary GM actors but no encounter history; resume it on the source device or export a current save.');
    }
  }
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
  if ((schemaVersion === SAVE_SCHEMA_VERSION || schemaVersion === PREVIOUS_SAVE_SCHEMA_VERSION) && Array.isArray(parsed.snapshotHistory)) {
    let previousVersion = -1;
    for (const [index, item] of parsed.snapshotHistory.entries()) {
      if (!Number.isInteger(item.stateVersion) || item.stateVersion < 0 || item.stateVersion <= previousVersion) {
        errors.push(`Snapshot history entry ${index} has an invalid or out-of-order stateVersion.`);
        continue;
      }
      previousVersion = item.stateVersion;
      if (typeof item.createdAt !== 'string' || !item.snapshot || typeof item.snapshot !== 'object') {
        errors.push(`Snapshot history entry ${index} is malformed.`);
        continue;
      }
      if (item.snapshot.branchId !== parsed.manifest.branchId || item.snapshot.stateVersion !== item.stateVersion) {
        errors.push(`Snapshot history entry ${index} does not match the source branch and version.`);
      }
      if (!Array.isArray(item.snapshot.encounters)) {
        errors.push(`Snapshot history entry ${index} is missing complete encounter and battlefield state.`);
      }
      try {
        assertNoSecrets(item.snapshot, `save.snapshotHistory[${index}]`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    const head = parsed.snapshotHistory.find(item => item.stateVersion === parsed.manifest.stateVersion);
    if (!head) {
      errors.push('Snapshot history does not include the manifest stateVersion.');
    }
  }
  if (schemaVersion === SAVE_SCHEMA_VERSION && Array.isArray(parsed.snapshotHistory)) {
    const expectedBaseHash = parsed.manifest.worldRef?.packageContentHash;
    if (!expectedBaseHash || !Array.isArray(parsed.contentDeltas)) {
      errors.push('Save v6 requires a locked base package hash and contentDeltas array.');
    } else {
      const allSnapshots = [
        { stateVersion: parsed.state.stateVersion, snapshot: parsed.state },
        ...parsed.snapshotHistory.map(item => ({ stateVersion: item.stateVersion, snapshot: item.snapshot })),
      ];
      for (const [index, item] of allSnapshots.entries()) {
        const manifest = item.snapshot.contentManifest;
        if (!isBranchContentManifestStructure(manifest) ||
            manifest.branchId !== parsed.manifest.branchId || manifest.stateVersion !== item.stateVersion ||
            manifest.basePackage.revision !== parsed.manifest.packageRevision ||
            manifest.basePackage.contentHash.toLowerCase() !== expectedBaseHash.toLowerCase()) {
          errors.push(`Save v6 content manifest ${index} does not match its branch, state or locked package.`);
          continue;
        }
        if (!await verifyContentManifest(manifest, sha256Hex)) {
          errors.push(`Save v6 content manifest ${index} failed integrity verification.`);
        }
      }
      const deltasById = new Map(parsed.contentDeltas.map(delta => [delta.deltaId, delta]));
      if (deltasById.size !== parsed.contentDeltas.length) errors.push('Save v6 contains duplicate progressive delta ids.');
      for (const item of allSnapshots) {
        for (const ref of item.snapshot.contentManifest?.deltas ?? []) {
          const delta = deltasById.get(ref.deltaId);
          if (!delta || ref.publishedAtStateVersion > item.stateVersion ||
              !await verifyDeltaPackage(delta, {
                deltaId: ref.deltaId, contentHash: ref.contentHash, baseContentHash: expectedBaseHash,
              }, sha256Hex)) {
            errors.push(`Save v6 snapshot ${item.stateVersion} is missing or has an invalid published delta ${ref.deltaId}.`);
          }
        }
      }
      for (const delta of parsed.contentDeltas) {
        if (delta.status !== 'published' || delta.basePackage.revision !== parsed.manifest.packageRevision ||
            delta.basePackage.contentHash.toLowerCase() !== expectedBaseHash.toLowerCase()) {
          errors.push(`Save v6 includes a non-published or mismatched delta ${delta.deltaId}.`);
        }
      }
    }
  }
  const committed = parsed.turns
    .map(turn => turn.committedStateVersion)
    .filter((version): version is number => version !== null);
  if (committed.length > 0 && Math.max(...committed) > parsed.manifest.stateVersion) {
    errors.push('A committed turn references a state version beyond the snapshot.');
  }
  for (const turn of parsed.turns) {
    if (!turn.actionContractJson || turn.actionContractJson === '{}') {
      if (turn.status !== 'Committed') {
        errors.push(`Turn ${turn.turnId} has no frozen contract; it cannot be resumed.`);
      }
    }
    if (turn.rollRecord && !Array.isArray(turn.rollRecord.rolls)) {
      errors.push(`Turn ${turn.turnId} carries a malformed roll record.`);
    }
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
  sha256Hex: Sha256HexProvider['sha256Hex'];
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
 * Restores a validated save as a NEW campaign/branch in one transaction
 * (P2 acceptance A05). Restores EVERYTHING needed to actually continue:
 * dependency lock (packageRevision), cards, party, complete contracts, full
 * roll records (a rolled-but-uncommitted turn resumes with its own dice),
 * reward ledger, branch events, skills, relationships and memories. Requires
 * the referenced world AND its locked package revision to exist locally — a
 * missing dependency is an explicit error, never a silent substitution.
 */
export async function restoreSave(input: RestoreSaveInput): Promise<RestoreSaveResult> {
  const { db, save } = input;
  const saveValidation = await validateSaveJson(JSON.stringify(save), input.sha256Hex);
  if (!saveValidation.ok) {
    throw new Error(`Save validation failed before restore:\n- ${saveValidation.errors.join('\n- ')}`);
  }
  const { manifest } = save;

  const originalWorldId = manifest.worldRef.worldId;
  const originalRevision = manifest.packageRevision;
  const expectedSourceHash = manifest.worldRef.sourceSha256;
  const expectedPackageHash = manifest.worldRef.packageContentHash;
  const world = await db.queryOne<{ source_sha256: string }>(
    'SELECT source_sha256 FROM worlds WHERE world_id = ?',
    [originalWorldId],
  );
  let resolvedWorldId = originalWorldId;
  let resolvedRevision = originalRevision;
  let pkg = world?.source_sha256 === expectedSourceHash
    ? await db.queryOne<{ status: string; content_hash: string }>(
      'SELECT status, content_hash FROM world_packages WHERE world_id = ? AND revision = ?',
      [originalWorldId, originalRevision],
    )
    : null;

  const exactPackageMatches = world?.source_sha256 === expectedSourceHash && pkg?.status === 'published' &&
    (expectedPackageHash === undefined || pkg.content_hash === expectedPackageHash);
  if (!exactPackageMatches) {
    const portableRows = await db.queryAll<{
      world_id: string;
      revision: number;
      status: string;
      content_hash: string;
      validation_json: string;
    }>(
      `SELECT w.world_id, p.revision, p.status, p.content_hash, p.validation_json
         FROM worlds w JOIN world_packages p ON p.world_id = w.world_id
        WHERE w.source_sha256 = ? AND p.revision = ? AND p.status = 'published'
        ORDER BY w.world_id`,
      [expectedSourceHash, originalRevision],
    );
    const portableCandidates = portableRows.flatMap(row => {
      try {
        const validation = JSON.parse(row.validation_json) as {
          importedFromWorldId?: unknown;
          importedFromRevision?: unknown;
          importedFromContentHash?: unknown;
        };
        if (validation.importedFromRevision !== originalRevision) return [];
        if (expectedPackageHash !== undefined) {
          // A save may be exported from a world that was itself imported from
          // a portable package. Its local world id then differs from the
          // package's original source id, while the immutable content hash is
          // still the exact dependency lock across every import hop.
          if (validation.importedFromContentHash !== expectedPackageHash || row.content_hash !== expectedPackageHash) return [];
        } else if (validation.importedFromWorldId !== originalWorldId) {
          // Older saves without a package content lock can only use a direct
          // lineage match; never guess between same-source revisions.
          return [];
        }
        return [{ row, sourceContentHash: validation.importedFromContentHash }];
      } catch {
        return [];
      }
    });
    const lineageHashes = new Set(portableCandidates.map(candidate =>
      typeof candidate.sourceContentHash === 'string' ? candidate.sourceContentHash : candidate.row.content_hash));
    const portableMatches = expectedPackageHash === undefined && lineageHashes.size > 1
      ? []
      : portableCandidates.map(candidate => candidate.row);
    const portableMatch = portableMatches[0];
    if (portableMatch) {
      resolvedWorldId = portableMatch.world_id;
      resolvedRevision = portableMatch.revision;
      pkg = portableMatch;
    }
  }

  if (!pkg) {
    if (!world) {
      throw new Error(
        `Missing dependency: world ${originalWorldId} is not present on this device. ` +
          'Import the matching world package first; the save cannot be restored without it.',
      );
    }
    if (world.source_sha256 !== expectedSourceHash) {
      throw new Error(
        `World ${originalWorldId} exists but its source hash differs from the save manifest; refusing to mix versions.`,
      );
    }
    throw new Error(
      `Missing dependency: world package ${originalWorldId} r${originalRevision} is not present on this device. Import the matching world package first.`,
    );
  }
  if (pkg.status !== 'published') {
    throw new Error(
      `Locked world package r${originalRevision} is ${pkg.status}, not published; refusing to continue on it.`,
    );
  }
  if (expectedPackageHash !== undefined && pkg.content_hash !== expectedPackageHash) {
    throw new Error(
      `World package ${originalWorldId} r${originalRevision} has a different content hash from the save; refusing to mix versions.`,
    );
  }
  if (expectedPackageHash !== undefined && pkg.content_hash !== expectedPackageHash) {
    throw new Error(
      `World package ${originalWorldId} r${originalRevision} has a different content hash from the save; refusing to mix versions.`,
    );
  }

  const campaignExists = await db.queryOne('SELECT campaign_id FROM campaigns WHERE campaign_id = ?', [input.newCampaignId]);
  if (campaignExists) throw new Error(`Campaign id already in use: ${input.newCampaignId}.`);
  const branchExists = await db.queryOne('SELECT branch_id FROM branches WHERE branch_id = ?', [input.newBranchId]);
  if (branchExists) throw new Error(`Branch id already in use: ${input.newBranchId}.`);

  const restoredWorld = await db.queryOne<{ title: string }>('SELECT title FROM worlds WHERE world_id = ?', [resolvedWorldId]);
  const playerId = save.party.find(member => member.controller === 'player')?.actorId;
  const playerCardJson = save.cards.find(card => card.actorId === playerId)?.cardJson;
  const playerCard = playerCardJson ? JSON.parse(playerCardJson) as { name?: unknown } : null;
  const playerName = typeof playerCard?.name === 'string' ? playerCard.name : '旅人';
  const restoredTitle = manifest.title?.trim() || `${restoredWorld?.title ?? '导入的冒险'} · ${playerName}`;

  await db.transaction(async tx => {
    await tx.execute(
      `INSERT INTO campaigns
        (campaign_id, world_id, title, ruleset_id, ruleset_version, world_mapping_version,
         opening_json, created_at, package_revision, anchor_json, status)
       VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, 'active')`,
      [
        input.newCampaignId,
        resolvedWorldId,
        `${restoredTitle.replace(/（导入）$/, '')}（导入）`,
        manifest.rulesetId,
        manifest.rulesetVersion,
        JSON.stringify({
          goal: manifest.goal ?? '',
          protagonistActorId: save.party.find(member => member.controller === 'player')?.actorId ?? '',
          restoredFrom: manifest.campaignId,
          payloadSha256: manifest.payloadSha256,
        }),
        input.createdAt,
        resolvedRevision,
        JSON.stringify(manifest.anchorJson ?? {}),
      ],
    );
    await tx.execute(
      `INSERT INTO branches (branch_id, campaign_id, parent_branch_id, fork_turn_id, state_version, created_at)
       VALUES (?, ?, NULL, NULL, ?, ?)`,
      [input.newBranchId, input.newCampaignId, manifest.stateVersion, input.createdAt],
    );
    for (const delta of save.contentDeltas ?? []) {
      const existingDelta = await tx.queryOne<{ content_hash: string; status: string }>(
        'SELECT content_hash, status FROM progressive_world_deltas WHERE delta_id = ?', [delta.deltaId],
      );
      if (existingDelta) {
        if (existingDelta.content_hash.toLowerCase() !== delta.contentHash.toLowerCase() || existingDelta.status !== 'published') {
          throw new Error(`Progressive delta id collision while restoring save: ${delta.deltaId}.`);
        }
        continue;
      }
      await tx.execute(
        `INSERT INTO progressive_world_deltas
          (delta_id, world_id, origin_branch_id, published_at_state_version, base_revision,
           base_content_hash, status, content_hash, package_json, validation_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [delta.deltaId, delta.worldId, delta.originBranchId, delta.publishedAtStateVersion,
          delta.basePackage.revision, delta.basePackage.contentHash, delta.status, delta.contentHash,
          JSON.stringify(delta), JSON.stringify(delta.validation), delta.createdAt],
      );
    }

    const state: GameStateSnapshot = {
      ...save.state,
      branchId: input.newBranchId,
      encounters: save.state.encounters ?? [],
      ...(save.state.contentManifest ? {
        contentManifest: rebindBranchContentManifest(save.state.contentManifest, input.newBranchId,
          save.state.stateVersion, resolvedWorldId),
      } : {}),
    };
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
    const history = save.snapshotHistory?.length
      ? save.snapshotHistory
      : [{ stateVersion: state.stateVersion, snapshot: state, createdAt: input.createdAt }];
    for (const item of history) {
      const restoredSnapshot: GameStateSnapshot = item.stateVersion === state.stateVersion
        ? state
        : { ...item.snapshot, branchId: input.newBranchId,
            ...(item.snapshot.contentManifest ? {
              contentManifest: rebindBranchContentManifest(item.snapshot.contentManifest, input.newBranchId,
                item.stateVersion, resolvedWorldId),
            } : {}) };
      if (restoredSnapshot.contentManifest) {
        await insertBranchContentManifest(tx, restoredSnapshot.contentManifest, item.createdAt || input.createdAt);
      }
      await tx.execute(
        `INSERT INTO snapshots (branch_id, state_version, snapshot_json, state_hash, created_at)
         VALUES (?, ?, ?, NULL, ?)`,
        [input.newBranchId, item.stateVersion, JSON.stringify(restoredSnapshot), item.createdAt || input.createdAt],
      );
    }

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
    for (const card of save.cards) {
      await tx.execute(
        `INSERT INTO actor_cards (branch_id, actor_id, card_json, created_at, updated_at, updated_state_version)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.newBranchId, card.actorId, card.cardJson, input.createdAt, input.createdAt, state.stateVersion],
      );
    }
    for (const member of save.party) {
      await tx.execute(
        `INSERT INTO party_members (branch_id, actor_id, controller, role, joined_at, party_group_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.newBranchId, member.actorId, member.controller, member.role, member.joinedAt, member.groupId ?? 'main'],
      );
    }
    await replaceEncounterSnapshots(tx, input.newBranchId, state.encounters ?? []);
    for (const row of save.rewardLedger) {
      await tx.execute(
        `INSERT OR IGNORE INTO reward_ledger (branch_id, encounter_id, actor_id, skill_id, reward_kind, granted_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.newBranchId, row.encounterId, row.actorId, row.skillId, row.rewardKind, row.grantedAt],
      );
    }

    for (const turn of save.turns) {
      await tx.execute(
        `INSERT OR IGNORE INTO turns
          (branch_id, turn_id, status, expected_state_version, committed_state_version,
           action_contract_json, action_contract_hash, outcome_grade, public_summary,
           effects_json, created_at, committed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
        [
          input.newBranchId,
          turn.turnId,
          turn.status,
          turn.expectedStateVersion,
          turn.committedStateVersion,
          turn.actionContractJson,
          turn.actionContractHash,
          turn.outcomeGrade,
          turn.narrativeText ? turn.narrativeText.slice(0, 200) : null,
          input.createdAt,
          turn.committedStateVersion !== null ? input.createdAt : null,
        ],
      );
      if (turn.rollRecord) {
        const roll = turn.rollRecord;
        await tx.execute(
          `INSERT OR IGNORE INTO roll_records
            (branch_id, turn_id, roll_index, ruleset_id, ruleset_version, contract_hash,
             dice_count, die_sides, rolls_json, highest, difficulty, margin, grade, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.newBranchId,
            turn.turnId,
            roll.rollIndex,
            roll.rulesetId,
            roll.rulesetVersion,
            roll.contractHash,
            roll.diceCount,
            roll.dieSides,
            JSON.stringify(roll.rolls),
            roll.highest,
            roll.difficulty,
            roll.margin,
            roll.grade,
            roll.createdAt,
          ],
        );
      }
      if (turn.narrativeText && turn.status === 'Committed') {
        await tx.execute(
          `INSERT OR IGNORE INTO turn_narratives (branch_id, turn_id, outcome_grade, text, status, created_at)
           VALUES (?, ?, ?, ?, 'Committed', ?)`,
          [input.newBranchId, turn.turnId, turn.outcomeGrade ?? 'success', turn.narrativeText, input.createdAt],
        );
      }
    }
    // The branch event log references turns, so it lands after them.
    for (const event of save.branchEvents) {
      await tx.execute(
        `INSERT OR IGNORE INTO branch_events (branch_id, event_seq, turn_id, state_version, event_type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [input.newBranchId, event.eventSeq, event.turnId, event.stateVersion, event.eventType, event.payloadJson, input.createdAt],
      );
    }
  });

  return {
    campaignId: input.newCampaignId,
    branchId: input.newBranchId,
    stateVersion: manifest.stateVersion,
  };
}

function readCampaignGoal(openingJson: string): string {
  try {
    const parsed = JSON.parse(openingJson) as { goal?: unknown };
    return typeof parsed.goal === 'string' ? parsed.goal : '';
  } catch {
    return '';
  }
}
