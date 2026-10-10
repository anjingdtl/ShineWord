# Phase 9.5 M0 — Runtime module and state ownership

**Audit date:** 2026-10-10
**Source checkpoint:** `a2809bc735cbaace22a87206f509c0387b9bfbd3`

## Authority model

`GameStateSnapshot` is the branch’s game-state authority. It includes the current actor/resource/location data, item ownership and source data, skills, directional relationships, party and encounter state, discoveries, quest progress/rewards, situation runtime, causal time order, content manifests, rules/style snapshots, and the campaign runtime/content bindings. `CampaignRuntimeV1` is the single authoritative record for campaign node status, plan binding, rewards, deferred consequences, progress history, pause/end state, and ending.

SQLite tables are durable storage and query projections of this state plus immutable history. They do not introduce a second live game-state authority. Campaign plans and artifacts are archived content; the branch’s `campaignRuntime.planBinding` and `campaignContentBinding` select the versions in force. World canon stays in the published world package and is not rewritten by campaign outcomes.

## Ownership by concern

| Concern | Authoritative owner | Runtime writers / boundary |
| --- | --- | --- |
| Action rules and roll | Compiled world rule configuration and frozen `ActionContract` | `v2Compile` validates and compiles; `resolveOrReuseRoll` journals one roll under the contract hash |
| Actors, resources, location, conditions | `GameStateSnapshot.actors` | Pure effects/reducers prepare changes; `commitPreparedTurn` persists the exact prepared result |
| Inventory and item provenance | `GameStateSnapshot.itemOwners` / `itemSources` | Validated transfer/effect reducers; `SqliteTurnStore.persistState` projects to SQLite |
| Skills and advancement | Snapshot skill records and actor-card projection | Milestone/training reducers and campaign settlement through local action commits |
| Relationships | Directional `GameStateSnapshot.relationships` | Social resolver, validated campaign effects, and settlement reducers |
| Knowledge | `GameStateSnapshot.discoveries` | Explicit discovery, validated clue rewards, or clue evidence consumed by the session reducer |
| Quest progress and rewards | `GameStateSnapshot.questProgress` / `questRewards` | Session progress reducers and campaign settlement, atomically persisted with state |
| Situation status/counters/promises | `GameStateSnapshot.situations` | `applySituationRuntime` and session prepared-resolution reducers |
| Campaign progression/rewards/consequences | `GameStateSnapshot.campaignRuntime` | `settleCampaignProgress` operates on the prepared snapshot; reward/consequence keys and events are committed once |
| Published world content | Versioned world-package archive plus branch content manifest | World-package publication; campaign content resolves beside it without shadowing canon |
| Campaign authored content | Immutable plan/artifact archive plus branch binding | Candidate validation/adoption; runtime outcomes remain in the snapshot |
| Narration and pending delivery | Narrative candidate/outbox records | Narrator candidate is retained before adoption; outbox delivery is post-commit and replay-aware |
| Model request accounting | Request ledger / planning job records | Planner, Narrator and campaign-plan jobs own distinct request paths; do not infer “zero LLM” from zero Planner calls |

## Commit and recovery boundaries

`applyEffects` and the reducers prepare state in memory; they do not independently commit. `prepareTurnResolution` reduces the transition once, then `commitPreparedTurn` persists the same prepared object. The SQLite transaction performs branch-version/fence checks, saves state and campaign projections, stores the committed turn and narrative adoption, and writes the outbox atomically. Idempotency returns an existing commit instead of applying its effects a second time.

Local rest/training/combat/milestone operations also use the session’s prepared settlement/commit machinery even though they do not enter Planner. The helper `executeDeterministicTurn` is not the production campaign loop and lacks the full CampaignSession settlement path; it must not be used as an interchangeable runtime.

Save export is currently `shineword-save-10`. Restoring a save rebinds the imported branch/campaign IDs while preserving frozen contracts, plan/artifact archives, state, and history. The save importer currently rejects older save-2 through save-9 formats. No save protocol change is part of M0/M1/M2.

## `moduleRegistry` status

`moduleRegistry.ts` contains eight ordered module declarations (`resources_conditions`, `skill_actions`, `exploration_discovery`, `social_relationships`, `combat_zones`, `growth_rest`, `situations_causality`, `pressure_track`) with versions, dependencies, capabilities, and claimed owned fields. The registry validates composition and contributes to the compiled rule binding. It is not eight separately persisted services or a set of independent state owners. The production rule code remains distributed across `v2Compile`, `CampaignSession`, pure reducers, situation/campaign settlement, and the turn store; the current `src/domain/rules/modules` directory contains only `pressureTrack.ts`.

One metadata discrepancy needs resolution before relying on registry ownership as an enforcement mechanism: `exploration_discovery` declares `discoveredEntryIds`, while the live snapshot field is `discoveries`. This report records the mismatch; M0 does not change ownership metadata without a validated migration of the registry contract.

## Narrative graph boundary

The existing CampaignPlan, situation definitions, method requirements/outcomes, and the branch snapshot already represent the graph inputs and runtime progress. `projectPlayableSituations` filters retired situations using current campaign status/node state. Quest and campaign progress are still consumed through their existing reducers. M2 can derive a read-only set of opportunities from these sources, but a persisted parallel graph/progress store would duplicate authority and violate V2.0.
