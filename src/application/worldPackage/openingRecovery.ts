import type { WorldRecord } from '../ports/worldStore';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import { isFactVisibleAtAnchor } from '../world/opening';
import { isEntryVisibleAtAnchor } from '../campaign/recruitment';

/** Publication and opening readiness are separate for historical archives. */
export async function hasPlayableOpening(store: SqliteWorldStore, worldId: string, revision: number): Promise<boolean> {
  const pkg = await store.getWorldPackage(worldId, revision);
  if (!pkg || pkg.manifest.status !== 'published') return false;
  const [rawFacts, entities, events] = await Promise.all([store.listFacts(worldId), store.listEntities(worldId), store.listEvents(worldId)]);
  const order = events.filter(event => event.status === 'canon' && event.worldTimeOrder !== null)
    .sort((a, b) => a.worldTimeOrder! - b.worldTimeOrder!)[0]?.worldTimeOrder ?? undefined;
  const facts = rawFacts;
  if (pkg.entries.some(entry => entry.kind === 'scene' && entry.visibility === 'public'
    && isEntryVisibleAtAnchor(entry, facts, order))) return true;
  return entities.some(entity => entity.type === 'location' && facts.some(fact => fact.subjectEntityId === entity.entityId
    && fact.status !== 'speculation' && fact.status !== 'conflict'
    && (order === undefined ? fact.validFrom === null && fact.validTo === null && fact.revealAt === null : isFactVisibleAtAnchor(fact, order))));
}

/** A legacy archive cannot reconstruct deleted evidence from NPC names.
 * Reuse an existing source world only when its byte identity actually matches. */
export async function findLocalOpeningSource(input: {
  worldStore: SqliteWorldStore;
  worldId: string;
  getSetup: (worldId: string) => Promise<{ packageRevision: number | null; locations: string[] }>;
}): Promise<WorldRecord | null> {
  const target = await input.worldStore.getWorld(input.worldId);
  if (!target) return null;
  for (const world of await input.worldStore.listWorlds()) {
    if (world.worldId === target.worldId || world.sourceBytes <= 0
      || (world.sourceSha256 !== target.sourceSha256 && world.legacySourceSha256 !== target.sourceSha256)) continue;
    const setup = await input.getSetup(world.worldId);
    if (setup.packageRevision !== null && setup.locations.length > 0) return world;
  }
  return null;
}
