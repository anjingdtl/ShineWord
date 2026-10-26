/**
 * LLM usage census (startup convergence plan W0, acceptance C-01).
 *
 * Parses the `LlmRequestKind` union from source and requires every value to
 * carry an entry in `LLM_USAGE_POLICY` (W1). Adding a request kind without
 * registering its tier/blocking policy fails here, so LLM work cannot creep
 * back onto a blocking path unnoticed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { LLM_USAGE_POLICY } = require('../dist/application/llm/usagePolicy');

function readRequestKindValues() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'application', 'llm', 'types.ts'),
    'utf8',
  );
  const match = source.match(/export type LlmRequestKind =([\s\S]*?);/);
  assert.ok(match, 'LlmRequestKind union not found in src/application/llm/types.ts');
  const values = [...match[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  assert.ok(values.length >= 14, `expected the known 14+ request kinds, parsed ${values.length}`);
  return values;
}

test('every LlmRequestKind value has a usage policy entry (C-01)', () => {
  const kinds = readRequestKindValues();
  for (const kind of kinds) {
    assert.ok(kind in LLM_USAGE_POLICY, `request kind '${kind}' has no LLM_USAGE_POLICY entry`);
    const entry = LLM_USAGE_POLICY[kind];
    assert.ok(
      entry.tier === 'creative_once' || entry.tier === 'foreground_degradable' || entry.tier === 'background_enhance',
      `policy for '${kind}' has invalid tier ${entry.tier}`,
    );
    assert.equal(typeof entry.uiBlockingAllowed, 'boolean', `policy for '${kind}' must declare uiBlockingAllowed:boolean`);
    assert.equal(typeof entry.owner, 'string', `policy for '${kind}' must declare an owner`);
    assert.ok(entry.owner.length > 0, `policy for '${kind}' has an empty owner`);
  }
});

test('background_enhance kinds never allow UI blocking (plan §5.1)', () => {
  const kinds = readRequestKindValues();
  for (const kind of kinds) {
    const entry = LLM_USAGE_POLICY[kind];
    if (!entry) continue;
    if (entry.tier === 'background_enhance') {
      assert.equal(
        entry.uiBlockingAllowed,
        false,
        `background_enhance kind '${kind}' must not allow UI blocking`,
      );
    }
  }
});

test('startup path stays LLM-free: opening_goal and campaign_plan are non-blocking background kinds (K2)', () => {
  assert.equal(LLM_USAGE_POLICY.opening_goal.tier, 'background_enhance');
  assert.equal(LLM_USAGE_POLICY.opening_goal.uiBlockingAllowed, false);
  assert.equal(LLM_USAGE_POLICY.campaign_plan.tier, 'background_enhance');
  assert.equal(LLM_USAGE_POLICY.campaign_plan.uiBlockingAllowed, false);
});

test('policy table registers no kinds outside the parsed union', () => {
  const kinds = new Set(readRequestKindValues());
  for (const key of Object.keys(LLM_USAGE_POLICY)) {
    assert.ok(kinds.has(key), `LLM_USAGE_POLICY has entry '${key}' that is not an LlmRequestKind`);
  }
});
