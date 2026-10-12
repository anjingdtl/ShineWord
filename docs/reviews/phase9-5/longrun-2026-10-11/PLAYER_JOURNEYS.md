# Android player journeys and decision audit

**Cutoff:** 2026-10-12. The user ended play-testing; no additional player actions were submitted while writing this report.
**Evidence root:** F:/sw95/test-logs/phase9-5-longrun-2026-10-11/
This document contains identifiers, counts and sanitized effects only. It excludes story prose, full prompts, model responses and private screenshots.

## Branch summaries

| Journey | Branch / head | Submitted player turns | Audit candidate decisions | Observed result |
|---|---|---:|---:|---|
| J1 protect/rescue | camp-mv3mw9hk-main / v70 | 54 | 31 | Player advanced through five completed stages to active stage 6. At the next closing route, successful roll was persisted but commit failed because a completion reward actor could not resolve. turn-0071 remains frozen and uncommitted. |
| J2 investigation | camp-mv3khpat-main / v39 | 33 | 16 | Investigation progressed through public clues and ended naturally in a failed campaign state. Preserve the terminal result; do not extend this story to fill a quota. |
| J3 cooperation/free input | camp-mv3iwgv7-main / v15 | 11 | 6 | The campaign completed naturally. Preserve the ending; a new legal story would be needed to continue sampling. |
| J4A fork | camp-mv3mw9hk-bmv4g8y2p / v86 | 70 | 37 | Active. Audit begins at version 1 and includes inherited pre-fork history, so 37 is not the count of decisions made on the A route after forking. |
| J4B fork | camp-mv3mw9hk-bmv4g9u9a / v84 | 68 | 36 | Active. Audit also includes inherited pre-fork history; 36 is not the B-route quota. |
| New short story | camp-mv51iswg-main / v8 | 5 | 4 | Active and saved. Four audit candidates changed usable state/content. The last freeform failure committed without an effect or state diff and was excluded. |

Sanitized audit files: install-check/current-audit-J1.json through current-audit-J4B.json. The most recent short-story audit is install-check/phase95-after-new-campaign-action5-audit.json. Read-only databases are adjacent private files. The frozen J1 snapshot is device-db-after-j1-petition-tap-check-5554.sqlite.

## Decision-count boundary

The five stored audit arrays contain 236 branch-level turn rows and 126 candidateMeaningful=true rows. Those numbers are not unique effective decisions:

- J4A and J4B each include inherited pre-fork turns.
- Turn IDs recur in different campaign/branch namespaces.
- Candidate classification is an audit signal; the original contract additionally requires a meaningful player-facing reason and an actual consequence or later use.
- Replaying, importing, or viewing an existing turn must not add quota.

Therefore the required 80 unique effective UI decisions are **NOT COMPLETE / NOT PROVEN**. The targets remain J1/J2/J3 20 each and J4A/J4B 10 post-fork each. Do not use 126 as the completed total.

## Verified post-fix progress examples

The BUG-95-008 same-scenario replay confirmed a visible active-stage route, a committed stage transition, and continued play on both fork paths. Examples captured in the checkpoint include J4B v78 stage transition, v79 a distinct preparation effect, v80 a distinct evidence/knowledge change, and J4A v73/v74 distinct state progress. These demonstrate that the repaired opportunity route could be used; they do not establish the per-journey quota or two complete delayed-consequence chains.

The BUG-95-007 same-trigger retry replay also showed a fresh successor job after the older job became stale, followed by plan adoption and continued play. See BUGS_AND_FIXES.md for the root cause and scope.

## Causal chains and story quality

- Two consequences that are each scheduled, separated from trigger by at least two effective decisions, triggered, and then actually consumed by later requirements: NOT RUN.
- J4A/J4B same-base divergence followed by a convergence point where route history changes a later method, condition, cost or relationship: NOT RUN as a complete acceptance.
- Three-intent scorecards (goal fit, route difference, freedom, lasting effects, world/characters, pacing/clarity), with each dimension at least 3/4: NOT RUN.
- Canon/time visibility across all journeys and a full leak review: NOT RUN.
- Independent human session: NOT RUN.

## Action for the repair Agent

Preserve natural endings for J2/J3 and preserve J1 v70/turn-0071. Use a new legal branch after repairing the completion-route readiness issue. For any new decision audit, store stable campaign lineage plus source turn/event identity; do not sum branch candidate counters or raw turn IDs alone. Count failed actions only when they have a player-useful cost, consequence, or future use.
