/**
 * Final-closeout V1.1.1 diagnostic capture driver (R4 MiniMax world-extract
 * compatibility, authorized budget scope `final-closeout-v111`, cap 30).
 *
 * Runs the PRODUCTION progressive import against the real MiniMax endpoint and
 * captures the raw wire request/response of world_extract calls under
 * .tmp/final-closeout/captures/ (gitignored). Nothing secret is printed; the
 * endpoint key stays in memory. Budget reserve/mark/finish wrap every physical
 * dispatch exactly like tools/convergence-real-journey.cjs.
 *
 * Env: CAPTURE_MAX_EXTRACTS (default 2) caps how many world_extract HTTP calls
 * this process may make before refusing further dispatch.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const requireP = p => require(path.join(ROOT, p));

const SCOPE_FILE = process.env.CLOSEOUT_SCOPE_FILE
  ? path.resolve(ROOT, process.env.CLOSEOUT_SCOPE_FILE)
  : path.join(ROOT, '.tmp/final-closeout/budget-scope.json');
const SCOPE_ID = process.env.CLOSEOUT_SCOPE_ID || 'final-closeout-v111';
const CAP = Number(process.env.CLOSEOUT_SCOPE_CAP || 30);
const KEY_FILE = process.env.CONVERGENCE_KEY_FILE || 'C:/Users/anjin/Desktop/Ai工作坊/Test-API/Minimax-TEST-KEY.txt';
const NOVEL_PATH = process.env.CONVERGENCE_NOVEL || 'C:/Users/anjin/Desktop/Ai工作坊/放开那个女巫.txt';
const WORK = '.tmp/final-closeout';
const CAPTURES = path.join(WORK, 'captures');
const MAX_EXTRACTS = Number(process.env.CAPTURE_MAX_EXTRACTS || 2);

function readCredentials() {
  const fields = {};
  for (const line of fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^：:]{1,40})[：:]\s*(.+)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  const endpoint = fields['base_url（OpenAI 兼容）'] || fields['base_url'] || fields.endpoint;
  const model = fields['模型'] || fields.model;
  const key = fields['key'] || fields['api key'] || fields['密钥'];
  if (!endpoint || !model || !key) throw new Error('credential file incomplete');
  return { endpoint: endpoint.replace(/\/+$/, ''), model, key };
}

// Scoped budget: initialize the manifest BEFORE any require of the budget
// module (module-level authority reads the manifest at load; Node caches the
// first instance, so the env pin must precede the first require).
fs.mkdirSync(path.dirname(SCOPE_FILE), { recursive: true });
const budgetModulePath = require.resolve(path.join(ROOT, 'tools/phase9-budget.cjs'));
const pristineModule = require(budgetModulePath);
let existed = true;
try {
  pristineModule.initializeScopedBudgetManifest({ filePath: SCOPE_FILE, scopeId: SCOPE_ID,
    capPhysicalRequests: CAP, inputs: { round: 'final-closeout-v111', authorized: '2026-10-29 user task',
      note: 'new independent ledger; historical scopes are NOT reusable' } });
  existed = false;
} catch (error) {
  if (!/already exists/.test(String(error?.message))) throw error;
}
delete require.cache[budgetModulePath];
process.env.PHASE9_BUDGET_SCOPE_FILE = SCOPE_FILE;
process.env.PHASE9_BUDGET_SCOPE_CAP = String(CAP);
process.env.PHASE9_BUDGET_SCOPE_ID = SCOPE_ID;
const budget = require(budgetModulePath);
const { postQaHttp } = requireP('tools/phase9-http.cjs');

function profileFor(endpoint) {
  // Mirrors tools/convergence-real-journey.cjs profileFor (QA high tier) so the
  // reproduction matches the C-17 host path that failed 18/18.
  return {
    id: 'closeout-host', name: 'closeout-host', endpoint, model: 'MiniMax-M3.1-Flash', keyRef: 'memory',
    reasoningTier: 'high', reasoningDialect: 'generic', contentOutputTokens: 16_384,
    capabilities: { supportsJson: false, supportsStreaming: true, reportsUsage: true,
      contextWindow: 1_000_000, maxOutputTokens: 524_288, supportsPromptCache: true },
  };
}

const jsonl = path.join(WORK, 'capture.jsonl');
function log(event) { fs.appendFileSync(jsonl, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); }

let extractCaptures = 0;
function capturePaths(n) {
  return { req: path.join(CAPTURES, `extract-${String(n).padStart(2, '0')}-request.json`),
    res: path.join(CAPTURES, `extract-${String(n).padStart(2, '0')}-response-wire.txt`) };
}

async function main() {
  fs.mkdirSync(CAPTURES, { recursive: true });
  const creds = readCredentials();
  const profile = profileFor(creds.endpoint);
  const manifest = budget.readManifest();
  console.log(`[budget] scope=${manifest.scopeId} spent=${manifest.spentPhysicalRequests}/${manifest.capPhysicalRequests}${existed ? ' (reused existing ledger)' : ' (initialized)'}`);

  const transport = { async post(request) {
    const isExtract = request.requestKind === 'world_extract';
    if (isExtract && extractCaptures >= MAX_EXTRACTS) {
      const error = new Error(`capture cap reached (${MAX_EXTRACTS} world_extract calls)`);
      error.name = 'HttpRequestNotSentError'; error.code = 'ECONNREFUSED';
      throw error;
    }
    const reservationId = budget.reservePhysicalRequest({ owner: 'host:closeout-capture',
      requestKind: request.requestKind || 'android_unknown',
      logicalRequestId: request.logicalRequestId, attemptId: request.attemptId, attemptNo: request.attemptNo,
      profileFingerprint: request.profileFingerprint });
    let dispatched = false;
    const captureNo = isExtract ? extractCaptures + 1 : null;
    try {
      const response = await postQaHttp({
        url: request.url, headers: request.headers, body: request.body,
        timeoutMs: request.timeoutMs ?? 300_000,
        ...(request.streamActivityTimeoutMs ? { streamActivityTimeoutMs: request.streamActivityTimeoutMs } : {}),
        onDispatch: () => { dispatched = true; budget.markPhysicalRequestDispatched(reservationId); },
      });
      budget.finishPhysicalRequest(reservationId, { outcome: 'completed', httpStatus: response.status });
      if (isExtract && captureNo !== null) {
        const paths = capturePaths(captureNo);
        fs.writeFileSync(paths.req, request.body, 'utf8');
        fs.writeFileSync(paths.res, response.body, 'utf8');
        extractCaptures += 1;
        console.log(`[capture] #${captureNo} world_extract http=${response.status} wireBytes=${response.body.length} -> ${paths.res}`);
        log({ kind: 'capture', n: captureNo, httpStatus: response.status, wireBytes: response.body.length });
      }
      return { status: response.status, body: response.body, headers: response.headers ?? {} };
    } catch (error) {
      const notSent = error?.name === 'HttpRequestNotSentError';
      budget.finishPhysicalRequest(reservationId, { outcome: notSent ? 'not_sent' : 'outcome_unknown',
        failureClass: notSent ? 'not_sent' : (error?.name || 'unknown') });
      throw error;
    }
  } };

  const bytes = fs.readFileSync(NOVEL_PATH);
  const { createMobileHarness } = requireP('tests/helpers/mobileHarness.cjs');
  const h = await createMobileHarness({ bytes, dbPath: path.join(WORK, 'capture.sqlite'), transport,
    secrets: { async get() { return creds.key; } } });
  try {
    console.log('[import] production progressive import starting…');
    const existingWorlds = await h.adapter.queryAll('SELECT world_id FROM worlds');
    const imported = await h.sourceImport.importNovelUnified('memory://novel', path.basename(NOVEL_PATH), profile, 'progressive',
      progress => { if (progress.message) process.stdout.write(`\r[import] ${progress.message.slice(0, 60).padEnd(60)}`); });
    process.stdout.write('\n');
    console.log(`[import] worldId=${imported.worldId} runs=${imported.runIds.length} (worlds in db: ${existingWorlds.map(w => w.world_id.slice(-8)).join(',') || 'none'})`);
    // A re-import attaches to the same content-hash world without new runs;
    // resume the world's existing non-terminal runs instead.
    const runIds = imported.runIds.length > 0 ? imported.runIds
      : (await h.adapter.queryAll("SELECT run_id FROM world_build_runs WHERE world_id=? AND status NOT IN ('completed','canceled','failed_terminal') ORDER BY created_at DESC", [imported.worldId])).map(r => r.run_id);
    console.log(`[resume] runs: ${runIds.join(', ') || 'none'}`);
    let lastBlocker = null;
    for (const runId of runIds) {
      for (let cycle = 0; cycle < 4; cycle += 1) {
        if (extractCaptures >= MAX_EXTRACTS) { console.log('[capture] extract cap reached; stopping extraction cycles'); break; }
        await h.sourceImport.requestSegmentRunControl(runId, 'resume');
        const result = await h.sourceImport.runExtraction(runId, profile, info => {
          if (info?.message) process.stdout.write(`\r[extract] ${info.message.slice(0, 60).padEnd(60)}`);
        });
        process.stdout.write('\n');
        console.log(`[extract] cycle=${cycle} completed=${result.completed}`);
        if (result.completed) break;
        const issues = await h.runtime.worldStore.listReviewIssues(imported.worldId, 'open');
        if (issues.length === 0) { lastBlocker = `run ${runId} blocked without review issues (cycle ${cycle})`; continue; }
        for (const issue of issues) {
          console.log(`[review] ${issue.kind}/${issue.severity} ${issue.issueId.slice(0, 60)}`);
          if (issue.kind === 'canon_conflict') {
            const detail = JSON.parse(issue.detailJson ?? '{}');
            for (const factId of detail.factIds ?? []) {
              await h.runtime.worldStore.resolveCanonFactConflict(imported.worldId, factId, 'complementary');
            }
          }
          await h.runtime.worldStore.resolveReviewIssue(imported.worldId, issue.issueId, 'resolved', true);
        }
      }
    }
    const revision = await h.runtime.worldStore.getPublishedPackageRevision(imported.worldId);
    const units = await h.adapter.queryAll("SELECT unit_id,status,attempt,error_code,substr(coalesce(error_message,''),1,200) em FROM world_build_units");
    const runs = await h.adapter.queryAll('SELECT * FROM world_build_runs');
    const attempts = await h.adapter.queryAll('SELECT attempt_id,request_kind,status,failure_class,http_status,input_tokens,output_tokens,reasoning_tokens FROM llm_request_attempts');
    const summary = { worldId: imported.worldId, publishedRevision: revision, units, runs, attempts, extractCaptures };
    fs.writeFileSync(path.join(WORK, 'capture-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log(`[result] published=${revision ?? 'NO'} extractCaptures=${extractCaptures} attempts=${attempts.length}`);
    for (const unit of units) console.log(`  unit ${unit.unit_id.slice(-24)} status=${unit.status} attempt=${unit.attempt} err=${unit.error_code ?? '-'} ${unit.em ?? ''}`);
    log({ kind: 'done', published: revision ?? null, extractCaptures });
  } finally {
    h.db.close();
  }
}

main().catch(error => {
  console.error('CAPTURE FAILED:', error instanceof Error ? error.message : String(error));
  const spent = (() => { try { return budget.readManifest().spentPhysicalRequests; } catch { return '?'; } })();
  console.error(`[budget] spent=${spent}/${CAP}`);
  process.exit(1);
});
