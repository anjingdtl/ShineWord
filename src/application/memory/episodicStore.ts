/**
 * Episodic persistence + turn derivation (infrastructure plan §31, §66,
 * §101). Every committed turn becomes a locally retrievable record in the
 * same background pass that maintains story memory - deterministic fields
 * only, no extra LLM call.
 */

import type { SqliteDatabase, SqliteRow } from '../ports/sqlite';
import type { CommittedTurnHistoryEntry } from '../../infra/sqlite/sqliteTurnStore';
import type { EpisodicTurnRecord } from './episodicIndex';

interface EpisodicRow extends SqliteRow {
  branch_id: string;
  turn_id: string;
  state_version: number;
  search_text: string;
  metadata_json: string;
  invalid_at_state_version: number | null;
}

interface EpisodicMetadata {
  publicSummary: string;
  narrativeText: string;
  actorIds: string[];
  locationIds: string[];
  questIds: string[];
  entryIds: string[];
  itemIds: string[];
  keywords: string[];
}

export class SqliteEpisodicStore {
  constructor(private readonly db: Pick<SqliteDatabase, 'execute' | 'queryAll'>) {}

  async saveTurnRecord(record: EpisodicTurnRecord): Promise<void> {
    const metadata: EpisodicMetadata = {
      publicSummary: record.publicSummary,
      narrativeText: record.narrativeText,
      actorIds: record.actorIds,
      locationIds: record.locationIds,
      questIds: record.questIds,
      entryIds: record.entryIds,
      itemIds: record.itemIds,
      keywords: record.keywords,
    };
    await this.db.execute(
      `INSERT INTO episodic_turn_index
        (branch_id, turn_id, state_version, search_text, metadata_json, invalid_at_state_version)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(branch_id, turn_id) DO UPDATE SET
         state_version = excluded.state_version,
         search_text = excluded.search_text,
         metadata_json = excluded.metadata_json,
         invalid_at_state_version = excluded.invalid_at_state_version`,
      [
        record.branchId,
        record.turnId,
        record.stateVersion,
        record.publicSummary,
        JSON.stringify(metadata),
        record.invalidAtStateVersion,
      ],
    );
  }

  async listRecords(
    branchId: string,
    maxStateVersion?: number,
  ): Promise<EpisodicTurnRecord[]> {
    const rows = maxStateVersion === undefined
      ? await this.db.queryAll<EpisodicRow>(
        'SELECT * FROM episodic_turn_index WHERE branch_id = ? ORDER BY state_version',
        [branchId],
      )
      : await this.db.queryAll<EpisodicRow>(
        `SELECT * FROM episodic_turn_index
          WHERE branch_id = ? AND state_version <= ? AND invalid_at_state_version IS NULL
          ORDER BY state_version`,
        [branchId, maxStateVersion],
      );
    return rows.map(row => {
      const metadata = JSON.parse(row.metadata_json) as EpisodicMetadata;
      return {
        branchId: row.branch_id,
        turnId: row.turn_id,
        stateVersion: row.state_version,
        publicSummary: metadata.publicSummary ?? '',
        narrativeText: metadata.narrativeText ?? '',
        actorIds: metadata.actorIds ?? [],
        locationIds: metadata.locationIds ?? [],
        questIds: metadata.questIds ?? [],
        entryIds: metadata.entryIds ?? [],
        itemIds: metadata.itemIds ?? [],
        keywords: metadata.keywords ?? [],
        invalidAtStateVersion: row.invalid_at_state_version,
      };
    });
  }
}

/**
 * Deterministic derivation of the episodic record from a committed turn:
 * actor/item/location/quest ids come from the effects that actually
 * committed; keywords carry human names for recall entry points.
 */
export function episodicRecordFromTurn(input: {
  entry: CommittedTurnHistoryEntry;
  keywords?: readonly string[];
}): EpisodicTurnRecord {
  const { entry } = input;
  const actorIds = new Set<string>();
  const locationIds = new Set<string>();
  const questIds = new Set<string>();
  const itemIds = new Set<string>();
  const entryIds = new Set<string>();
  for (const effect of entry.effects ?? []) {
    if (!effect || typeof effect !== 'object') continue;
    const record = effect as Record<string, unknown>;
    const actorOf = (key: string): void => {
      const id = record[key];
      if (typeof id === 'string' && id) actorIds.add(id);
    };
    switch (record.op) {
      case 'changeLocation':
        actorOf('actorId');
        if (typeof record.locationId === 'string' && record.locationId) locationIds.add(record.locationId);
        break;
      case 'transferItem':
        actorOf('fromActorId');
        actorOf('toActorId');
        if (typeof record.itemId === 'string' && record.itemId) itemIds.add(record.itemId);
        break;
      case 'grantItem':
        actorOf('actorId');
        if (typeof record.itemId === 'string' && record.itemId) itemIds.add(record.itemId);
        break;
      case 'recordEvent': {
        const eventType = typeof record.eventType === 'string' ? record.eventType : '';
        if (eventType.includes('quest') && typeof record.questId === 'string') questIds.add(record.questId);
        if (eventType === 'relationship_changed') {
          actorOf('fromActorId');
          actorOf('toActorId');
        }
        break;
      }
      case 'applyCondition':
      case 'removeCondition':
      case 'consumeResource':
      case 'restoreResource':
        actorOf('actorId');
        break;
      default:
        break;
    }
  }
  return {
    branchId: entry.branchId,
    turnId: entry.turnId,
    stateVersion: entry.stateVersion,
    publicSummary: entry.publicSummary,
    narrativeText: entry.narrativeText ?? '',
    actorIds: [...actorIds],
    locationIds: [...locationIds],
    questIds: [...questIds],
    entryIds: [...entryIds],
    itemIds: [...itemIds],
    keywords: [...(input.keywords ?? [])],
    invalidAtStateVersion: null,
  };
}
