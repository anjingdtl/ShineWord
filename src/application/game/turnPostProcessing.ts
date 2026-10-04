/**
 * Turn post-processing coordinator (P8-4, plan §13): every authoritative
 * commit leaves a durable handoff (turn-postprocess-handoff-1) inside the
 * commit transaction; this coordinator is the ONLY consumer.
 *
 * One branch runs at most one memory-advancing worker. Claims are conditional
 * writes with lease + monotonic fencing token, so a late/stale worker can
 * neither double-process a handoff nor overwrite a newer checkpoint (I08/I09).
 * Episodic indexing is local and independent from LLM memory maintenance:
 * a provider failure never blocks committed turns from being indexed.
 */

import type { SqliteDatabase, SqliteRow } from '../ports/sqlite';
import type { SqliteTurnStore, CommittedTurnHistoryEntry } from '../../infra/sqlite/sqliteTurnStore';
import type { SqliteStoryMemoryStore } from '../memory/storyMemoryRepository';
import type { SqliteEpisodicStore } from '../memory/episodicStore';
import { episodicRecordFromTurn } from '../memory/episodicStore';
import {
  runStoryMemoryMaintenance,
  shouldRunMaintenance,
} from '../memory/storyMemoryMaintenance';
import type { LlmProvider } from '../llm/types';
import type { FrozenModelCapabilities } from '../llm/requestPlan';
import type { ReasoningPolicySelection } from '../llm/reasoningPolicy';

export type PostprocessTaskStatus =
  | 'pending'
  | 'running'
  | 'retryable_failed'
  | 'outcome_unknown'
  | 'blocked'
  | 'succeeded'
  | 'superseded'
  | 'cancelled';

export interface PostprocessHandoff {
  handoffId: string;
  campaignId: string;
  branchId: string;
  turnId: string;
  committedStateVersion: number;
  publicEvidenceHash: string;
  bodyRevisionHash: string | null;
  hasBody: boolean;
  taskSchema: string;
  status: PostprocessTaskStatus;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  fencingToken: number | null;
  attempts: number;
  episodicIndexed: boolean;
  physicalHttpCount: number;
  diagnosticsJson: string | null;
  createdAt: string;
  updatedAt: string;
}

interface HandoffRow extends SqliteRow {
  episodic_indexed: number;
  handoff_id: string;
  campaign_id: string;
  branch_id: string;
  turn_id: string;
  committed_state_version: number;
  public_evidence_hash: string;
  body_revision_hash: string | null;
  has_body: number;
  task_schema: string;
  status: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  fencing_token: number | null;
  attempts: number;
  physical_http_count: number;
  diagnostics_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoordinatorInput {
  db: SqliteDatabase;
  turns: SqliteTurnStore;
  storyMemory?: { store: SqliteStoryMemoryStore };
  episodic?: { store: SqliteEpisodicStore };
  /** Production wires the ledgered provider; tests may omit it. */
  provider?: LlmProvider;
  capabilities?: FrozenModelCapabilities;
  reasoningPolicy?: ReasoningPolicySelection;
  /** Actor hints for the memory checkpoint compiler. */
  loadActors?: (branchId: string) => Promise<Array<{ actorId: string; name: string }>>;
  /** Test/ops hook: physical HTTP counter source (durable across restarts). */
  clock?: () => Date;
  leaseDurationMs?: number;
  /** Max pending handoffs merged into one processing wave (plan §13.3). */
  maxBatchHandoffs?: number;
}

export interface ProcessBranchResult {
  claimed: number;
  indexed: number;
  memoryStatus: 'clean' | 'partial' | 'failed' | 'skipped' | 'hard_gap';
  unknownOutcome: boolean;
}

const DEFAULT_LEASE_MS = 120_000;
const DEFAULT_MAX_BATCH_HANDOFFS = 8;

export class TurnPostProcessingCoordinator {
  constructor(private readonly input: CoordinatorInput) {}

  private now(): Date {
    return this.input.clock ? this.input.clock() : new Date();
  }

  private mapRow(row: HandoffRow): PostprocessHandoff {
    return {
      handoffId: row.handoff_id,
      campaignId: row.campaign_id,
      branchId: row.branch_id,
      turnId: row.turn_id,
      committedStateVersion: row.committed_state_version,
      publicEvidenceHash: row.public_evidence_hash,
      bodyRevisionHash: row.body_revision_hash,
      hasBody: row.has_body === 1,
      taskSchema: row.task_schema,
      status: row.status as PostprocessTaskStatus,
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
      fencingToken: row.fencing_token,
      attempts: row.attempts,
      episodicIndexed: row.episodic_indexed === 1,
      physicalHttpCount: row.physical_http_count,
      diagnosticsJson: row.diagnostics_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Claims up to `maxBatchHandoffs` pending (or retryable/lease-expired)
   * handoffs for the branch in stateVersion order. Each claim is a conditional
   * write that bumps the fencing token; a lost claim simply skips the row.
   */
  async claimNextHandoffs(branchId: string, owner: string): Promise<PostprocessHandoff[]> {
    const now = this.now();
    const limit = this.input.maxBatchHandoffs ?? DEFAULT_MAX_BATCH_HANDOFFS;
    const rows = await this.input.db.queryAll<HandoffRow>(
      `SELECT * FROM frozen_turn_postprocess_outbox
        WHERE branch_id = ?
          AND status IN ('pending', 'retryable_failed')
          AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
        ORDER BY episodic_indexed ASC, committed_state_version ASC
        LIMIT ?`,
      [branchId, now.toISOString(), limit],
    );
    const claimed: PostprocessHandoff[] = [];
    const leaseExpiresAt = new Date(now.getTime() + (this.input.leaseDurationMs ?? DEFAULT_LEASE_MS)).toISOString();
    for (const row of rows) {
      // Expired outcome_unknown rows pause their batch until explicit
      // resolution: they are never silently re-claimed (I14).
      const changes = await this.input.db.execute(
        `UPDATE frozen_turn_postprocess_outbox SET
           status = 'running', lease_owner = ?, lease_expires_at = ?,
           fencing_token = COALESCE(fencing_token, 0) + 1, attempts = attempts + 1, updated_at = ?
         WHERE handoff_id = ? AND status IN ('pending', 'retryable_failed')
           AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
        [owner, leaseExpiresAt, now.toISOString(), row.handoff_id, now.toISOString()],
      );
      if (changes > 0) {
        // Re-read to carry the NEW fencing token: the conditional terminal
        // updates must match the token THIS claim produced, or a concurrent
        // claimer's token would fail closed (I08).
        const fresh = await this.input.db.queryOne<HandoffRow>(
          'SELECT * FROM frozen_turn_postprocess_outbox WHERE handoff_id = ?',
          [row.handoff_id],
        );
        if (fresh) claimed.push(this.mapRow(fresh));
      }
    }
    return claimed;
  }

  /** Conditional terminal update; only the current lease holder can write. */
  private async finishHandoff(
    handoffId: string,
    owner: string,
    fencingToken: number,
    status: PostprocessTaskStatus,
    diagnostics: string | null,
    physicalHttpDelta: number,
  ): Promise<boolean> {
    const changes = await this.input.db.execute(
      `UPDATE frozen_turn_postprocess_outbox SET
         status = ?, physical_http_count = physical_http_count + ?, diagnostics_json = ?, updated_at = ?
       WHERE handoff_id = ? AND status = 'running' AND lease_owner = ? AND fencing_token = ?`,
      [status, physicalHttpDelta, diagnostics, this.now().toISOString(), handoffId, owner, fencingToken],
    );
    return changes > 0;
  }

  /** Releases a still-claimed handoff back to pending (stale claims). */
  private async releaseHandoff(handoffId: string, owner: string, fencingToken: number): Promise<void> {
    await this.input.db.execute(
      `UPDATE frozen_turn_postprocess_outbox SET
         status = 'pending', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE handoff_id = ? AND status = 'running' AND lease_owner = ? AND fencing_token = ?`,
      [this.now().toISOString(), handoffId, owner, fencingToken],
    );
  }

  async processBranch(branchId: string, options?: { maxWaves?: number }): Promise<ProcessBranchResult> {
    const owner = `worker:${branchId}:local`;
    const indexedTurnIds = new Set<string>();
    const maxWaves = options?.maxWaves ?? 1;
    const result: ProcessBranchResult = {
      claimed: 0,
      indexed: 0,
      memoryStatus: 'skipped',
      unknownOutcome: false,
    };
    for (let wave = 0; wave < maxWaves; wave += 1) {
      const handoffs = await this.claimNextHandoffs(branchId, owner);
      if (handoffs.length === 0) break;
      result.claimed += handoffs.length;

      // (1) Local episodic indexing — idempotent, provider-independent.
      // A handoff released back to pending (memory cadence not yet due) may
      // be re-claimed on a later wave; the UPSERT is idempotent and the
      // counter reports UNIQUE turns, not repeat writes.
      for (const handoff of handoffs) {
        if (indexedTurnIds.has(handoff.turnId)) continue;
        const committed: CommittedTurnHistoryEntry[] =
          await this.input.turns.listCommittedTurnsAfter(branchId, handoff.committedStateVersion - 1);
        const turn = committed.find(entry => entry.turnId === handoff.turnId);
        if (turn && this.input.episodic) {
          const record = episodicRecordFromTurn({ entry: turn });
          await this.input.episodic.store.saveTurnRecord(record);
          await this.input.db.execute(
            `UPDATE frozen_turn_postprocess_outbox SET episodic_indexed = 1
              WHERE handoff_id = ? AND status = 'running' AND lease_owner = ? AND fencing_token = ?`,
            [handoff.handoffId, owner, handoff.fencingToken ?? 0],
          );
          indexedTurnIds.add(handoff.turnId);
          result.indexed += 1;
        }
      }

      // (2) Memory maintenance — only when the memory store, provider and
      // frozen request policy are wired; otherwise the handoffs return to
      // pending and stay covered by the pending bridge. When this wave
      // contained only already-indexed rows, there is nothing new to do:
      // stop instead of cycling the same rows until the wave budget ends.
      if (!this.input.storyMemory || !this.input.provider || !this.input.capabilities || !this.input.reasoningPolicy) {
        // episodicIndexed reflects the flag as of the CLAIM: the claim
        // ordering prefers un-indexed rows, so an all-indexed wave means
        // the whole pending queue is already indexed — nothing new to do.
        const allAlreadyIndexed = handoffs.every(h => h.episodicIndexed);
        for (const handoff of handoffs) {
          await this.releaseHandoff(handoff.handoffId, owner, handoff.fencingToken ?? 0);
        }
        if (allAlreadyIndexed) break;
        continue;
      }

      const state = await this.input.storyMemory.store.getState(branchId);
      const currentStateVersion = handoffs[handoffs.length - 1]?.committedStateVersion ?? 0;
      const cadence = await shouldRunMaintenance({
        store: this.input.storyMemory.store,
        turnStore: this.input.turns,
        branchId,
        currentStateVersion,
      });
      if (!cadence.should) {
        // Coverage already advanced (e.g. a merged batch covered these
        // turns): mark the handoffs succeeded — they ARE covered.
        const through = state?.throughStateVersion ?? 0;
        for (const handoff of handoffs) {
          if (handoff.committedStateVersion <= through) {
            await this.finishHandoff(handoff.handoffId, owner, handoff.fencingToken ?? 0, 'succeeded', null, 0);
          } else {
            await this.releaseHandoff(handoff.handoffId, owner, handoff.fencingToken ?? 0);
          }
        }
        continue;
      }

      const maintenance = await runStoryMemoryMaintenance({
        provider: this.input.provider,
        store: this.input.storyMemory.store,
        turnStore: this.input.turns,
        branchId,
        currentStateVersion,
        actors: this.input.loadActors ? await this.input.loadActors(branchId) : [],
        capabilities: this.input.capabilities,
        reasoningPolicy: this.input.reasoningPolicy,
      });
      result.memoryStatus = maintenance.status === 'hard_gap'
        ? 'hard_gap'
        : maintenance.status as ProcessBranchResult['memoryStatus'];
      const afterState = await this.input.storyMemory.store.getState(branchId);
      const through = afterState?.throughStateVersion ?? 0;
      for (const handoff of handoffs) {
        if (handoff.committedStateVersion <= through) {
          await this.finishHandoff(handoff.handoffId, owner, handoff.fencingToken ?? 0, 'succeeded', null, 0);
        } else if (maintenance.status === 'failed' || maintenance.status === 'hard_gap') {
          await this.finishHandoff(
            handoff.handoffId,
            owner,
            handoff.fencingToken ?? 0,
            maintenance.status === 'hard_gap' ? 'blocked' : 'retryable_failed',
            maintenance.error ?? null,
            0,
          );
        } else {
          await this.releaseHandoff(handoff.handoffId, owner, handoff.fencingToken ?? 0);
        }
      }
      if (maintenance.status !== 'clean' && maintenance.status !== 'skipped') break;
    }
    return result;
  }

  /** Marks a batch outcome_unknown after a sent-but-unconfirmed request (I14). */
  async markUnknownOutcome(handoffIds: string[], reason: string): Promise<void> {
    for (const handoffId of handoffIds) {
      await this.input.db.execute(
        `UPDATE frozen_turn_postprocess_outbox SET status = 'outcome_unknown', diagnostics_json = ?, updated_at = ?
          WHERE handoff_id = ? AND status = 'running'`,
        [reason, this.now().toISOString(), handoffId],
      );
    }
  }

  /** Lists handoffs for diagnostics/UI (coverage lag, blocked reasons). */
  async listHandoffs(branchId: string, statuses?: PostprocessTaskStatus[]): Promise<PostprocessHandoff[]> {
    const rows = statuses && statuses.length > 0
      ? await this.input.db.queryAll<HandoffRow>(
        `SELECT * FROM frozen_turn_postprocess_outbox WHERE branch_id = ? AND status IN (${statuses.map(() => '?').join(',')})
          ORDER BY committed_state_version ASC`,
        [branchId, ...statuses],
      )
      : await this.input.db.queryAll<HandoffRow>(
        'SELECT * FROM frozen_turn_postprocess_outbox WHERE branch_id = ? ORDER BY committed_state_version ASC',
        [branchId],
      );
    return rows.map(row => this.mapRow(row));
  }
}
