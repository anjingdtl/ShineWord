/**
 * Play projection loader (Phase 3 · P4.1) — the mobile half of the read-only
 * projection.
 *
 * This module only *loads* data: one `getSummary()` read plus the locked world
 * package revision. All shaping and the visibility policy live in
 * `src/application/campaign/playProjection.ts`, which is covered by the core
 * regression suite; nothing here writes, and `getSummary()`'s own behaviour is
 * untouched (plan §14.1 option B).
 */
import {
  buildNpcPublicProjection,
  buildPlayUiProjection,
  type NpcPublicProjection,
  type PlayUiProjection,
} from '../../src/application/campaign/playProjection';
import type { ActorCard } from '../../src/domain/characters/card';
import type { ContentEntry } from '../../src/domain/content/types';
import { createReadOnlySession } from './runtime';
import { getDatabaseRuntime } from './database';

/** Entries of the locked revision, used for display names and visibility. */
async function loadEntries(worldId: string, revision: number): Promise<ContentEntry[]> {
  const runtime = await getDatabaseRuntime();
  const pkg = await runtime.worldStore.getWorldPackage(worldId, revision);
  return pkg ? pkg.entries : [];
}

/** The aggregate, single-stateVersion play projection (plan §14.2). */
export async function getPlayUiProjection(
  campaignId: string,
  branchId: string,
): Promise<PlayUiProjection> {
  const session = await createReadOnlySession();
  const summary = await session.getSummary(campaignId, branchId);
  const entries = summary.state.segmentContentBinding
    ? (await (await getDatabaseRuntime()).segmentPublication.loadEffectiveCatalog({ campaignId, branchId, binding: summary.state.segmentContentBinding })).entries
    : await loadEntries(summary.worldId, summary.packageRevision);
  return buildPlayUiProjection({
    campaignId,
    branchId,
    worldId: summary.worldId,
    packageRevision: summary.packageRevision,
    title: summary.title,
    anchorWorldTimeOrder: summary.anchorWorldTimeOrder,
    goal: summary.goal,
    state: summary.state,
    cards: summary.cards,
    entries,
  });
}

/**
 * Public projection of one NPC / creature. The raw card is read from
 * `actor_cards` because `getSummary()` intentionally degrades non-party actors
 * (plan §14.1): the degraded card has lost `templateId`, `description`,
 * `combatBehavior` and the real skill set.
 */
export async function getNpcPublicProjection(
  campaignId: string,
  branchId: string,
  actorId: string,
): Promise<NpcPublicProjection | null> {
  const session = await createReadOnlySession();
  const summary = await session.getSummary(campaignId, branchId);
  const runtime = await getDatabaseRuntime();
  const row = await runtime.db.queryOne<{ card_json: string }>(
    'SELECT card_json FROM actor_cards WHERE branch_id = ? AND actor_id = ?',
    [branchId, actorId],
  );
  if (!row) return null;
  const actor = JSON.parse(row.card_json) as ActorCard;
  const entries = summary.state.segmentContentBinding
    ? (await (await getDatabaseRuntime()).segmentPublication.loadEffectiveCatalog({ campaignId, branchId, binding: summary.state.segmentContentBinding })).entries
    : await loadEntries(summary.worldId, summary.packageRevision);
  const playerCard = summary.cards.find(card => card.controller === 'player') ?? null;
  return buildNpcPublicProjection({
    actor,
    state: summary.state,
    playerActorId: playerCard?.actorId ?? null,
    entries,
  });
}