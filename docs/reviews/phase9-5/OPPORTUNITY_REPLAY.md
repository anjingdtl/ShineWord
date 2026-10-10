# Phase 9.5 M2 — Narrative opportunity replay and adversarial review

**Review date:** 2026-10-10
**Scope:** Read-only graph projection, player-facing guidance integration, and replay tests.

## Projection behavior

`projectNarrativeOpportunities` derives a view from the branch’s current `GameStateSnapshot`, its already verified `CampaignPlan` and bound artifacts, the current situation definitions, visible cards, and public entries. It writes no state. It does not cache a graph, create another progress ledger, or apply effects. Existing campaign settlement remains the owner of unlocks, merges, rewards, consequences and endings.

Only public nodes with runtime status `active`, concrete coverage, a matching bound situation, and a live situation snapshot can project as current opportunities. Existing `assessMethod` checks the exact current skill/rank, item ownership, abilities, target presence/life, actor location, knowledge, relationships, rules and condition gates. Unknown, unbound or hidden nodes produce no playable route; hidden node text is not returned.

The projection ranks the current primary node first, then its active successors/alternatives, and preserves all method references under the same target. Identical first-step gestures are grouped in the projection but keep every route reference, since each authored method may carry different four-grade effects. The guidance candidate collector now suppresses repeated references and generic base-action duplicates without collapsing distinct authored methods.

When the current method fails, a different currently legal method for the same situation is preferred in the resulting guidance if one exists. The failed method remains available as a fallback; this is a recommendation order, not a new state lock. A terminal runtime returns no campaign opportunity. Missing concrete/bound content returns explicit player-safe feedback rather than a synthetic action.

The projection now informs the existing Planner method order, the existing Narrator packet, and existing local/ancillary guidance. It does not dispatch a model request or alter prepared resolution, roll, contract, settlement, persistence, or recovery.

## RED-to-GREEN review

The adversarial duplicate-route test was first run against the old guidance signature (`actionKind | skillId | title`) with two distinct methods sharing the same visible gesture/title. It failed because the second `methodRef` disappeared from the Narrator candidate list. The minimal fix deduplicates method candidates by exact reference while retaining signature-based dedupe for generic base actions. The same targeted test then passed with both references preserved.

## Deterministic replay matrix

| Requirement | Replay evidence | Result |
| --- | --- | --- |
| Discover a known legal node and preserve its authored routes | `tests/phase9-5-opportunity-projection.test.cjs`: active primary node; both sweep and talk routes retained | `PASS` |
| Filter by skill, item, ability, knowledge, relationship, actor life and location | Same file: prerequisites first block the route, then the identical snapshot is updated to satisfy them | `PASS` |
| Rank the relevant primary before an active successor | Same file: fixed plan/runtime with two active concrete nodes | `PASS` |
| Suppress repeated opportunity display without losing route identity | Same file: two distinct methods with identical gestures form one group containing both refs | `PASS` |
| Keep route-specific outcomes after convergence | Same file: two synthetic branches complete the same stage; one retains a relationship shift and the other retains a triggered deferred consequence | `PASS` |
| Offer a legal alternative after failure | Same file: fixed peak difficulty and fixed dice fail `sweep`; published `ask-lin` is first in committed guidance and `sweep` remains available | `PASS` |
| End naturally without reopening completed content | Same file: terminal runtime returns no campaign opportunities and its public ending text | `PASS` |
| Give explicit feedback when a successor has no concrete bound content | Same file: a successful route reaches an unprepared successor and committed guidance reports the content gap | `PASS` |
| Keep hidden plan text out of the projection | Same file: GM-visible node title is never returned | `PASS` |
| Avoid added model dispatch | Controlled two-turn provider ledger observes Planner + Narrator for each turn, exactly four calls total | `PASS` |

The focused source build plus projection, guidance, turn, flow, clue, and R69 stage-preparation regressions passed: **67 tests, 0 failures**. `git diff --check` passed. All samples use in-memory fixtures and fixed dice; no real model, saved user campaign, or user novel text was used.

## Adversarial review

| Attack | Review result |
| --- | --- |
| Did the projection add a second state authority? | No. Status and consequences are read from the existing snapshot and immutable content. The projection is ephemeral. |
| Can a merge overwrite effects from an earlier route? | No. Two branches at the same node status retain different relationship and deferred-consequence state after projection. No effects are merged or consumed here. |
| Can hidden canon, GM purpose, or a hidden node title leak? | No. Output is restricted to public plan nodes, visible methods, public objectives/summaries and existing player-safe blockers. A hidden node yields generic content feedback only. |
| Can a stale selected method silently become another action? | No. Compilation still verifies the exact offered method reference and existing stale-choice tests remain green. Projection only orders legal candidates. |
| Does failure become a no-cost free retry? | No. The failed method stays authored and its current grade consequences remain committed; another published legal method is prioritized. No progress is inferred from repetition. |
| Did we add a generic action to disguise missing content? | No. The gap is represented as feedback, while generic base actions continue to be owned by their existing rules. |
| Did M2 add LLM agents or calls? | No. The test ledger remains two existing roles per fresh action. No real-token or latency benchmark was run. |

## Cost and remaining limits

The call count did not increase in the controlled turn trace. Preserving distinct authored methods can increase the number of method candidates in the existing bounded packet (maximum eight method candidates); real-provider input-token impact was not measured because no 9.5 model budget is authorized. Planner, Narrator, and existing campaign-plan owners remain unchanged. Android, installed-device behavior and human play quality are not established by these tests.

## M2 exit

**PASS — deterministic, read-only opportunity projection implemented and integrated.** M2 changes only the derived ranking/guidance view and preserves the existing runtime authority. R69 stage preparation remains the concrete successor supply path; no evidence from these synthetic fixtures alone justifies starting M3 generation experiments.
