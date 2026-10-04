/**
 * Durable frozen turn materials (P8-3, plan §11): the frozen root is the
 * single recovery source for an in-flight turn — persisted BEFORE any
 * physical request is registered, hashed over its canonical payload, and
 * never silently re-derived from the live database (T01/T10/T12, I05).
 *
 * A corrupted or hash-mismatched root fails explicitly with
 * `FrozenMaterialsCorruptedError`; callers must stop with zero LLM calls and
 * keep the original envelope for diagnostics.
 */

import type { SqliteDatabase } from '../ports/sqlite';
import type { FrozenTurnContext } from './contextSnapshot';
import type { FinalWireBudget } from '../llm/finalWireVerifier';
import type { ReasoningTier } from '../llm/types';

export const FROZEN_TURN_MATERIALS_SCHEMA = 'frozen-turn-materials-1';

export type FrozenMaterialsCorruptionCode =
  | 'json_corrupt'
  | 'hash_mismatch'
  | 'missing_field';

export class FrozenMaterialsCorruptedError extends Error {
  constructor(
    message: string,
    readonly code: FrozenMaterialsCorruptionCode,
    readonly rootId: string,
  ) {
    super(message);
    this.name = 'FrozenMaterialsCorruptedError';
  }
}

/**
 * What a request view needs to rebuild and re-verify a dispatch. Identity
 * fields follow PROTOCOL_BASELINE.md §4 (one shared association structure).
 */
export interface FrozenTurnIdentity {
  campaignId: string;
  branchId: string;
  turnId: string;
  logicalRequestId: string;
  role: string;
  stage: string;
  attempt: number;
  rootSnapshotId: string;
  requestSnapshotHash: string;
  contractHash?: string;
  preparedHash?: string;
  bodyRevisionHash?: string;
}

export interface FrozenRootSnapshot {
  schemaVersion: typeof FROZEN_TURN_MATERIALS_SCHEMA;
  campaignId: string;
  branchId: string;
  turnId: string;
  /** One logical request per role/stage; the turn bundle is shared by both. */
  logicalRequestId: string;
  role: string;
  stage: string;
  attempt: number;
  /**
   * The full recovery payload. For the play turn this is the frozen context
   * bundle (planner + narrator contexts, wire budgets, reserves, final wire
   * envelopes, capabilities fingerprint, state baseline). Only actual content
   * counts as frozen — ids and DB query parameters do not (plan §11.1).
   */
  payload: {
    turnBundle?: {
      plannerText: string;
      plannerWireOutputTokens: number;
      narratorText: string;
      narratorWireOutputTokens: number;
      plannerFinalWire: FinalWireBudget;
      narratorFinalWire: FinalWireBudget;
      reasoningTier: ReasoningTier;
      plannerReasoningReserveTokens: number | null;
      narratorReasoningReserveTokens: number | null;
      reasoningPolicyVersion: string;
      plannerContext: FrozenTurnContext;
      narratorContext: FrozenTurnContext;
      plannerReasoningRecovery?: {
        worldContext: string;
        wireOutputTokens: number;
        reserveTokens: number;
        context: FrozenTurnContext;
        finalWire?: FinalWireBudget;
      };
      narratorReasoningRecovery?: {
        worldContext: string;
        wireOutputTokens: number;
        reserveTokens: number;
        context: FrozenTurnContext;
        finalWire?: FinalWireBudget;
      };
    };
    stateBaseline: { branchId: string; expectedStateVersion: number };
    capabilitiesFingerprint: string;
    collectionDiagnostics?: string[];
  };
  contentHash: string;
  createdAt: string;
}

/** SHA-256 hex provider; async or sync (same contract as contract hashing). */
export type FreezeHashProvider = { sha256Hex(input: string): Promise<string> | string };

export function rootSnapshotIdFor(branchId: string, turnId: string, logicalRequestId: string): string {
  return `${branchId}:${turnId}:${logicalRequestId}`;
}

export async function computeRootSnapshotContentHash(
  payload: FrozenRootSnapshot['payload'],
  hashProvider: FreezeHashProvider,
): Promise<string> {
  return await hashProvider.sha256Hex(JSON.stringify(sortDeep(payload)));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sortDeep(v)] as [string, unknown]);
    return Object.fromEntries(entries);
  }
  return value;
}

async function parseRootRow(row: { payload_json: string; content_hash: string; root_id: string }, hashProvider: FreezeHashProvider): Promise<FrozenRootSnapshot> {
  let payload: FrozenRootSnapshot['payload'];
  try {
    payload = JSON.parse(row.payload_json) as FrozenRootSnapshot['payload'];
  } catch (error) {
    throw new FrozenMaterialsCorruptedError(
      `Frozen turn materials are corrupt (unparseable JSON) for root ${row.root_id}; refusing to re-derive from the live database.`,
      'json_corrupt',
      row.root_id,
    );
  }
  const actualHash = await computeRootSnapshotContentHash(payload, hashProvider);
  if (actualHash !== row.content_hash) {
    throw new FrozenMaterialsCorruptedError(
      `Frozen turn materials hash mismatch for root ${row.root_id} (stored ${row.content_hash}, computed ${actualHash}); refusing to re-derive from the live database.`,
      'hash_mismatch',
      row.root_id,
    );
  }
  if (!payload || typeof payload !== 'object' || !payload.stateBaseline?.branchId) {
    throw new FrozenMaterialsCorruptedError(
      `Frozen turn materials are missing required fields for root ${row.root_id}.`,
      'missing_field',
      row.root_id,
    );
  }
  return {
    schemaVersion: FROZEN_TURN_MATERIALS_SCHEMA,
    campaignId: '',
    branchId: payload.stateBaseline.branchId,
    turnId: '',
    logicalRequestId: '',
    role: '',
    stage: '',
    attempt: 1,
    payload,
    contentHash: row.content_hash,
    createdAt: '',
  };
}

/**
 * SQLite repository for frozen roots and per-request views. Writes are
 * idempotent per root id; an existing root is never overwritten (a new turn
 * uses a new turnId), so a stage update cannot clear frozen columns (T12).
 */
export class RootFrozenMaterialsStore {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly hashProvider: FreezeHashProvider,
  ) {}

  async saveRootSnapshot(
    snapshot: Omit<FrozenRootSnapshot, 'schemaVersion' | 'contentHash'> & { contentHash?: string },
  ): Promise<string> {
    const rootId = rootSnapshotIdFor(snapshot.branchId, snapshot.turnId, snapshot.logicalRequestId);
    const contentHash = snapshot.contentHash
      ?? await computeRootSnapshotContentHash(snapshot.payload, this.hashProvider);
    const existing = await this.db.queryOne<{ root_id: string }>(
      'SELECT root_id FROM frozen_turn_material_roots WHERE root_id = ?',
      [rootId],
    );
    if (existing) return rootId;
    await this.db.execute(
      `INSERT INTO frozen_turn_material_roots
        (root_id, campaign_id, branch_id, turn_id, logical_request_id, role, stage, attempt,
         payload_json, content_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rootId,
        snapshot.campaignId,
        snapshot.branchId,
        snapshot.turnId,
        snapshot.logicalRequestId,
        snapshot.role,
        snapshot.stage,
        snapshot.attempt,
        JSON.stringify(snapshot.payload),
        contentHash,
        snapshot.createdAt,
      ],
    );
    return rootId;
  }

  async loadRootSnapshot(
    branchId: string,
    turnId: string,
    logicalRequestId: string,
  ): Promise<FrozenRootSnapshot | null> {
    const rootId = rootSnapshotIdFor(branchId, turnId, logicalRequestId);
    const row = await this.db.queryOne<{ payload_json: string; content_hash: string; root_id: string }>(
      'SELECT payload_json, content_hash, root_id FROM frozen_turn_material_roots WHERE root_id = ?',
      [rootId],
    );
    if (!row) return null;
    const parsed = await parseRootRow(row, this.hashProvider);
    return { ...parsed, turnId, logicalRequestId, branchId };
  }

  async hasRootSnapshot(branchId: string, turnId: string, logicalRequestId: string): Promise<boolean> {
    const rootId = rootSnapshotIdFor(branchId, turnId, logicalRequestId);
    const row = await this.db.queryOne<{ root_id: string }>(
      'SELECT root_id FROM frozen_turn_material_roots WHERE root_id = ?',
      [rootId],
    );
    return Boolean(row);
  }

  /**
   * Explicitly corrupts nothing; provided for fault-injection tests to verify
   * the zero-LLM failure contract (REG-001 correspondence).
   */
  async rawPayloadJson(branchId: string, turnId: string, logicalRequestId: string): Promise<string | null> {
    const rootId = rootSnapshotIdFor(branchId, turnId, logicalRequestId);
    const row = await this.db.queryOne<{ payload_json: string }>(
      'SELECT payload_json FROM frozen_turn_material_roots WHERE root_id = ?',
      [rootId],
    );
    return row?.payload_json ?? null;
  }
}
