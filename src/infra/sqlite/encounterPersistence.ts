import type { EncounterSnapshotEntry } from '../../domain/state/types';
import type { SqliteTransaction } from '../../application/ports/sqlite';

/** Replace one branch's encounter projection inside the caller's UnitOfWork. */
export async function replaceEncounterSnapshots(
  tx: SqliteTransaction,
  branchId: string,
  entries: readonly EncounterSnapshotEntry[],
): Promise<void> {
  await tx.execute('DELETE FROM encounters WHERE branch_id = ?', [branchId]);
  for (const entry of entries) {
    const encounter = entry.state;
    const bands = Object.fromEntries(
      Object.entries(encounter.actors).map(([actorId, actor]) => [actorId, actor.distanceBand]),
    );
    const envelope = {
      bands,
      zones: entry.zoneMap,
      sceneZones: entry.zones,
      exits: entry.exits,
      scene: encounter.scene,
      pendingActorIds: encounter.pendingActorIds ?? [],
      // Closeout C6: fate states and any ending marker ride the envelope so
      // reloads, rewind and save/restore reproduce fate progress exactly.
      fates: encounter.fates ?? {},
      endingTriggered: encounter.endingTriggered ?? null,
    };
    await tx.execute(
      `INSERT INTO encounters (branch_id, encounter_id, status, scene_id, distance_bands_json,
         initiative_json, turn_cursor, round, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        branchId,
        encounter.encounterId,
        encounter.status,
        encounter.scene.sceneId,
        JSON.stringify(envelope),
        JSON.stringify(encounter.initiative),
        encounter.turnCursor,
        encounter.round,
        entry.createdAt,
        entry.resolvedAt,
      ],
    );
    for (const actor of Object.values(encounter.actors)) {
      await tx.execute(
        `INSERT INTO encounter_actors (branch_id, encounter_id, actor_id, side, hp, max_hp, stamina,
           conditions_json, distance_band, acted_this_round, moved_this_round)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          encounter.encounterId,
          actor.actorId,
          actor.side,
          actor.hp,
          actor.maxHp,
          actor.stamina,
          JSON.stringify(actor.conditions),
          actor.distanceBand,
          actor.actedThisRound ? 1 : 0,
          actor.movedThisRound ? 1 : 0,
        ],
      );
    }
  }
}
