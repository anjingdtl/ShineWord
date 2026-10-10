# Phase 9.5 M3 — Local generation feasibility decision

**Decision date:** 2026-10-10
**Status:** `NOT NEEDED`

## Gate evaluation

M3 starts only if both conditions hold: M2 shows the currently adopted content supply is insufficient for meaningful play, and the existing R69 stage-preparation path cannot provide a useful concrete successor.

M2’s explicit content-gap replay intentionally uses the synthetic fixture’s `stage-2`, which is marked `provisional` and has no bound playable situation. This confirms the new projection reports a real missing-content state instead of fabricating a quest or endlessly repeating a generic action. It does not show that a player’s adopted campaign exhausted its prepared supply.

The existing R69 stage-preparation regression suite covers the observed case: it queues the nearest missing successor while the current stage is active, prepares only that successor, adopts it without resolving the current stage, and keeps future pressure inactive until activation. The suite also covers candidate adoption and scope/recovery boundaries. Those tests use controlled providers and fixed artifacts; they provide evidence that the existing mechanism handles this structural gap.

The gate therefore does not establish that existing supply is failing. No real campaign database or private content was inspected, and no real LLM request or Phase 9 request balance was used. A model-generation experiment would not add decision-quality evidence under the current authorization.

## Reopen condition

Reconsider M3 only after independently authorized player-session evidence shows repeated meaningful-content gaps despite the R69 preparation path producing no usable successor. Start with the V2.0 controlled-model-sample evaluation. Any real-LLM comparison must first have a separately approved budget, sample size and risk plan. Evaluate adoption, player use, causal effects, request cost and latency as well as schema validity.
