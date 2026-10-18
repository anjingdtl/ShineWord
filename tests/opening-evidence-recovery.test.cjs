'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldExtendOpeningBootstrap } = require('../dist/application/worldBuild/openingEvidenceRecovery');

test('bounded bootstrap extends after a structured unproven opening-entity publication error', () => {
  const publicationError = Object.assign(
    new Error('Segment publication blocked: opening_entity_unproven:future-person'),
    { errorCodes: ['opening_entity_unproven:future-person'] },
  );

  assert.equal(shouldExtendOpeningBootstrap(publicationError), true);
});

test('bounded bootstrap keeps existing missing-opening signals and ignores unrelated failures', () => {
  assert.equal(shouldExtendOpeningBootstrap(new Error('开局缺少可用的地点证据')), true);
  assert.equal(shouldExtendOpeningBootstrap(new Error('provider_config_error')), false);
  assert.equal(shouldExtendOpeningBootstrap(new Error('outcome_unknown')), false);
});
