const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/phase9CampaignFixture.cjs');

test('canon opening adoption does not compare planner skills to omitted actor initialization fields', async () => {
  const h = await fixture({
    protagonistBinding: {
      actorId: 'pc', kind: 'canon', name: '林凡', canonEntityId: 'ent-lin',
      initialSkills: ['skill-observation'],
    },
    adoptionProtagonist: {
      actorId: 'pc', kind: 'canon', name: '林凡', canonEntityId: 'ent-lin',
    },
  });
  try {
    assert.equal(h.campaignId, 'c-t');
    assert.equal(h.branchId, 'c-t-main');
  } finally {
    h.db.close();
  }
});
