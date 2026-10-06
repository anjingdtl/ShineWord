/** Retry the queued replan job on the J4-A branch with the real GLM. */
const path = require('node:path');
const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const requireP = p => require(path.join(ROOT, p));
const { createMobileHarness } = require(path.join(ROOT, 'tests/helpers/mobileHarness.cjs'));
const { SqliteCampaignPlanStore } = requireP('dist/infra/sqlite/sqliteCampaignPlanStore');
const { runReplanJob, adoptReplanCandidate } = requireP('dist/application/campaignPlan/replanService');
const { OpenAICompatibleProvider } = requireP('dist/application/llm/openAICompatible');
const { LedgeredProvider } = requireP('dist/application/llm/requestLedger');
const { RateScheduledProvider } = requireP('dist/application/llm/scheduledProvider');
const { GlobalRateScheduler, endpointBucketId } = requireP('dist/application/worldBuild/rateScheduler');
const { SqliteLlmLedgerStore } = requireP('dist/infra/sqlite/sqliteLlmLedgerStore');
const { MemorySecretStore } = requireP('dist/application/llm/memorySecretStore');
const { llmModelProfileFingerprint } = requireP('dist/application/llm/profileFingerprint');
const { SqliteTurnStore } = requireP('dist/infra/sqlite/sqliteTurnStore');

const KEY_FILE = 'C:/Users/Administrator/Desktop/AIstudio/Test-key/GLM-TEST.txt';
function parseConfig() {
  const lines = fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let endpoint = '', model = '', key = '';
  for (const line of lines) {
    const m = line.match(/^(endpoint|url|key|model|api_key)\s*[：:=]?\s*(.*)$/i);
    if (!m) continue;
    const name = m[1].toLowerCase(); const value = m[2].replace(/^[：:=]\s*/, '').trim();
    if (name === 'endpoint' || name === 'url') endpoint = value;
    else if (name === 'key' || name === 'api_key') key = value;
    else if (name === 'model') model = value;
  }
  if (!endpoint) { const urlLine = lines.find(l => /^https?:\/\//.test(l)); if (urlLine) endpoint = urlLine.trim(); }
  return { endpoint: endpoint.replace(/\/+$/, ''), model, key };
}

(async () => {
  const config = parseConfig();
  const profile = {
    id: 'glm-phase9', name: 'GLM phase9', endpoint: config.endpoint, model: config.model, keyRef: 'glm.phase9',
    capabilities: { supportsJson: true, supportsStreaming: false, reportsUsage: true, contextWindow: 1_048_576, maxOutputTokens: 32_768 },
    reasoningDialect: 'glm', reasoningTier: 'low', contentOutputTokens: 16_384, concurrency: 2,
  };
  const secrets = new MemorySecretStore();
  await secrets.set(profile.keyRef, config.key);
  const transport = { async post(request) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 300_000);
    try {
      const response = await fetch(request.url, { method: 'POST', headers: request.headers, body: request.body, signal: controller.signal });
      return { status: response.status, body: await response.text(), headers: Object.fromEntries(response.headers.entries()) };
    } finally { clearTimeout(timer); }
  } };
  const bytes = fs.readFileSync('C:/Users/Administrator/Desktop/AIstudio/放开那个女巫.txt');
  const h = await createMobileHarness({ bytes, dbPath: '.tmp/phase9/phase9.sqlite', transport, secrets });
  const planStore = new SqliteCampaignPlanStore(h.adapter);
  const world = JSON.parse(fs.readFileSync('.tmp/phase9/world.json', 'utf8'));
  const job = (await h.adapter.queryAll(
    "SELECT job_id FROM campaign_plan_jobs WHERE job_kind='replan' AND branch_id='camp-j2-muw7eyo4-j4a' AND status IN ('queued','retryable_failed') ORDER BY created_at DESC LIMIT 1"))[0];
  if (!job) { console.log('no queued replan job'); h.db.close(); return; }
  const inner = new OpenAICompatibleProvider(profile, secrets, transport, 300_000);
  const provider = new RateScheduledProvider(
    new LedgeredProvider(inner, new SqliteLlmLedgerStore(h.adapter), { modelProfileFingerprint: llmModelProfileFingerprint(profile) }),
    new GlobalRateScheduler({ maxConcurrent: 2, endpointBucketId: endpointBucketId(profile.endpoint) }));
  const pkg = await h.runtime.worldStore.getWorldPackage(world.worldId, world.revision);
  const intent = {
    schemaVersion: 'campaign-intent-1', setupId: 'replan-j4', intentRevision: 2,
    rawIntent: '护送关键证人离开小镇，避开追捕', normalizedIntent: '护送关键证人离开小镇，避开追捕', goalMode: 'declared',
    protagonistBinding: { actorId: 'actor-player', kind: 'original', name: '旅人' },
    openingAnchor: { worldTimeOrder: 1, locationId: '' }, companionBindings: [], lengthPreference: 'short',
    userConstraints: [], requestedCanonTargets: [], knowledgePolicy: 'anchor_projection',
    sourceCoverageBinding: { worldId: world.worldId, packageRevision: world.revision,
      coverageWorldTimeOrder: 1, packageContentHash: pkg.manifest.contentHash },
    createdAt: new Date().toISOString(),
  };
  try {
    const run = await runReplanJob({ db: h.adapter, planStore, worldStore: h.runtime.worldStore, provider, profile },
      job.job_id, { intent, protagonistSkills: [], anchorTitle: '序1', playerName: '旅人' });
    console.log('replan run:', JSON.stringify(run));
    if (run.status === 'candidate_ready') {
      const turns = new SqliteTurnStore(h.adapter);
      const adopted = await adoptReplanCandidate({ db: h.adapter, planStore, turns,
        campaignId: 'camp-j2-muw7eyo4', branchId: 'camp-j2-muw7eyo4-j4a', candidateId: run.candidateId });
      console.log('adoption:', JSON.stringify(adopted));
      fs.appendFileSync('.tmp/phase9/journey-J4.jsonl', JSON.stringify({ kind: 'replan', journey: 'A(retry)',
        branchId: 'camp-j2-muw7eyo4-j4a', run: run.status, adoption: adopted }) + '\n');
    }
  } catch (error) {
    console.error('replan retry error:', error instanceof Error ? error.stack : String(error));
  } finally {
    h.db.close();
  }
})().catch(e => { console.error('[fatal]', e.message); process.exit(1); });
