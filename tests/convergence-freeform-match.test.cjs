/**
 * Free-input method matching (convergence W4a, acceptance C-11).
 *
 * Golden samples pin the two-sided contract: text that names a method binds
 * at high confidence, and near-miss text that could name more than one
 * method (or names none distinctly) must NOT bind — zero mis-binding.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchFreeformIntentToMethod } = require('../dist/application/game/freeformMethodMatch');

const methods = [
  { methodId: 'survey', title: '查看现场', goal: '弄清眼前的局面和可用的线索',
    firstStep: { intent: '仔细查看现场，寻找值得注意的细节与线索', actionKind: 'skill_check' }, requires: {}, tradeoffs: '', preparation: '' },
  { methodId: 'ask', title: '向在场者打听', goal: '从在场的人那里了解发生了什么',
    firstStep: { intent: '向在场的人打听情形', actionKind: 'talk' }, requires: {}, tradeoffs: '', preparation: '' },
  { methodId: 'engage', title: '着手处理眼前的事', goal: '推进：处理最要紧的事',
    firstStep: { intent: '着手处理眼前最紧要的事', actionKind: 'interact' }, requires: {}, tradeoffs: '', preparation: '' },
];

test('exact first-step phrasing binds with exact confidence', () => {
  const hit = matchFreeformIntentToMethod({ intent: '仔细查看现场，寻找值得注意的细节与线索', methods });
  assert.equal(hit?.index, 0);
  assert.equal(hit?.confidence, 'exact');
});

test('free text containing a unique method title binds', () => {
  assert.equal(matchFreeformIntentToMethod({ intent: '我要查看现场', methods })?.index, 0);
  assert.equal(matchFreeformIntentToMethod({ intent: '先向在场者打听一下', methods })?.index, 1);
});

test('distinctive keyword run binds uniquely', () => {
  // '最要紧的事' is a ≥4-char run shared ONLY with the engage method's goal;
  // the input is not a title containment, so it exercises tier 3.
  const hit = matchFreeformIntentToMethod({ intent: '处理眼前最要紧的事', methods });
  assert.equal(hit?.index, 2);
  assert.equal(hit?.confidence, 'keyword');
});

test('paraphrased text that diverges from every method wording stays unbound', () => {
  // '最紧要' vs '最要紧': below every tier — the Planner is the honest route.
  assert.equal(matchFreeformIntentToMethod({ intent: '把眼前最紧要的事处理掉再说', methods }), null);
});

test('GOLDEN zero-misbinding: ambiguous and unrelated text never binds', () => {
  const goldenNoBind = [
    '随便看看',            // below every confidence tier
    '再想想',              // no method named
    '查看一下那个东西',      // 2-char run only, not a title containment
    '',                    // empty
  ];
  for (const intent of goldenNoBind) {
    const hit = matchFreeformIntentToMethod({ intent, methods });
    assert.equal(hit, null, `intent ${JSON.stringify(intent)} must not bind`);
  }
});

test('text naming two methods at title tier stays unbound (ambiguity refuses)', () => {
  const overlapping = [
    ...methods,
    { methodId: 'detail', title: '现场细节', goal: '补充查看细节',
      firstStep: { intent: '再查看现场细节', actionKind: 'observe' }, requires: {}, tradeoffs: '', preparation: '' },
  ];
  // '查看现场细节' contains BOTH '查看现场' (survey) and '现场细节' (detail)
  // titles → tier-2 ambiguity → the matcher must refuse.
  const hit = matchFreeformIntentToMethod({ intent: '查看现场细节', methods: overlapping });
  assert.equal(hit, null, 'ambiguous titles must not bind');
});

test('planner-policy decision is downstream of matching (matcher is policy-agnostic)', () => {
  // The matcher must bind purely on text; whether the bound method then goes
  // L1 or Planner is evaluateLocalCompileReadiness's call, verified in the
  // phase 9.5 suite. Here: a planner_required-titled method still matches.
  const withPlanner = [...methods, { methodId: 'risky', title: '孤注一掷说服守卫', goal: '高风险说服',
    firstStep: { intent: '尝试孤注一掷说服守卫', actionKind: 'skill_check' }, requires: {}, tradeoffs: '', preparation: '' }];
  assert.equal(matchFreeformIntentToMethod({ intent: '孤注一掷说服守卫试试', methods: withPlanner })?.index, 3);
});
