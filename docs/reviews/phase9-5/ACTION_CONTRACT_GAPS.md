# Phase 9.5 M0 — Action contract gaps blocking a safe L1 fast path

**Audit date:** 2026-10-10
**Source checkpoint:** `a2809bc735cbaace22a87206f509c0387b9bfbd3`

## Current content and proposal contract

`MethodTemplateV1` declares a first step (action kind and optional skill/item/ability/target/destination), requirements (skill/rank/item/knowledge/relationship/actor/condition), tradeoffs/preparation, optional visibility, and engine-owned success/failure effects. Campaign method outcomes may declare all four grade templates and causal effects. The campaign candidate `MethodSpec` likewise requires four outcomes. None of these method schemas declares a difficulty policy or how evidence IDs are selected and bound to a method.

`PlannerProposal.evidenceIds` is a required array field, but validation accepts an empty array without proving it is the method’s intended evidence set. `difficultyBand` is optional for skill checks. The Planner request schema describes those fields as Planner-provided. The compiled `ActionContract` requires evidence IDs and requires a difficulty band for a roll.

## Concrete semantic gap in current compilation

For a selected published method, `compileSelectedProposal` correctly verifies that the explicit method reference is still offered, resolves the actor, and checks alive/location constraints. It then builds the action from the published method but retains Planner-supplied `evidenceIds` and `difficultyBand`. `compileProposalBase` defaults an omitted difficulty band to `normal` when compiling a rolled action.

This prevents a safe local qualification test today:

- A valid skill-check method can be published with a closed action shape and all four outcomes but no authored difficulty. If Planner selected `hard`, a local compiler guessing `normal` changes the roll threshold and may change the grade and all downstream consequences.
- The same method has no authored evidence binding. Replacing the Planner’s evidence IDs with `[]` can suppress a legitimate clue/discovery/quest transition; inventing evidence IDs can grant one. The contract validator only checks array shape, not its relation to the method or visible content.
- A method’s requirement/eligibility checks do not fill those policy gaps. `assessMethod` checks the current snapshot for rules, actor life/conditions, skills/rank, owned items, ability, target, destination, knowledge, relationship, actor location, and conditions; it does not define resolution difficulty or evidence consumption.

The risk is outcome-semantic drift in valid actions, not a hypothetical formatting issue. The M0 RED reference in `tests/phase9-5-baseline.test.cjs` fixes dice and exercises the old Planner-selected difficulty across all four grades. Existing stale explicit method references are already rejected in `compileSelectedProposal`; that check must remain ahead of any local selection path.

## M0 eligibility result

No current Method family can yet be declared L1-safe across the full action contract. A non-roll `talk` method avoids a difficulty field but still has no content-owned evidence policy, and its grade-specific relationships, discoveries, situation transitions, campaign rewards, and delayed consequences still pass through the shared settlement path. A rolled method lacks both complete policy fields. Therefore M0 authorizes no production fast-path behavior.

## Additive protocol RFC required before enabling L1

Before an L1 Method is enabled, extend the authored method protocol and candidate validation with explicit, content-bound resolution policy. At minimum:

1. A closed `difficultyPolicy` for rolled methods that resolves to one supported `DifficultyBand` from validated local facts, or a typed declaration that Planner interpretation remains necessary. Missing/unknown policy must make the method ineligible for L1; it must never imply `normal`.
2. A closed `evidenceBinding` that names allowed evidence IDs and the deterministic selection rule (including an explicit empty set when no evidence is consumed). The compiler must verify selected IDs against the method’s branch-bound content and current visibility/knowledge rules.
3. Protocol/version validation and content hashing so the method, outcomes, difficulty policy, evidence policy, rule binding, and content dependency are frozen together in the ActionContract. Old artifacts without the fields remain on L2 and continue using their existing Planner outputs.
4. Golden L2-vs-L1 tests with identical state, action, fixed dice and content that compare contract hash-relevant fields, grade, relations, discoveries, items, quest progress/rewards, situation/campaign state, delayed consequences, save/fork/restore, recovery, and model request accounting.

This RFC is additive and does not require a database-authority or save-format rewrite on current evidence. It still changes published campaign content protocol and its validation/hash binding, so it must be reviewed as a separate implementation package before any L1 rollout. Do not synthesize values in code to make existing content pass.

## Required invariants for a future readiness check

`LocalCompileReadiness` must be a pure assessment over the current branch snapshot, compiled rules, current published/adopted method, content binding, and action request. It must report all blocking reasons rather than fill missing values. It may return eligible only after:

- the explicit method reference and content/rule binding are current;
- the method remains visible, offered and valid under the exact same state and authorization checks as L2;
- the local method policy resolves a complete action, including explicit difficulty and evidence semantics;
- all four grade outcomes, any campaign effects, and settlement references validate;
- the result enters the existing contract freeze, roll reuse, Narrator, prepared resolution, atomic commit, recovery, and save paths.

An explicit stale choice remains a refusal. It must not become a billed Planner retry. Ineligible current methods remain on L2. No broad Planner bypass or new model agent is justified by this M0 audit.
