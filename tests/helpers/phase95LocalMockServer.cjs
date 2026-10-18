/**
 * Deterministic OpenAI-compatible endpoint for isolated Phase 9.5 Android QA.
 * It never calls an external provider and writes only redacted request metadata.
 * Usage: node tests/helpers/phase95LocalMockServer.cjs <request-log.jsonl>
 */
const http = require('node:http');
const fs = require('node:fs');
const { candidateModel } = require('./phase9CampaignFixture.cjs');

const logPath = process.argv[2];
if (!logPath) throw new Error('Provide a path for the redacted JSONL request log.');

const PORT = Number(process.env.PHASE95_MOCK_PORT ?? 18591);
const SITUATION_ID = 'camp-sit-open';
let requestNo = 0;

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function outcomeText(grade) {
  switch (grade) {
    case 'full_success': return '你认真检查了青石巷，确认货箱周围的痕迹值得继续追查。';
    case 'success': return '你检查了现场，找到一些可供继续调查的线索。';
    case 'failure': return '你检查了现场，但没有发现额外线索。';
    case 'severe_failure': return '你检查现场时弄出声响，附近的人似乎察觉到了动静。';
    default: return '你完成了这次行动。';
  }
}

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { ok: true, mode: 'synthetic-local' });
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    sendJson(response, 404, { error: { message: 'route not found' } });
    return;
  }

  const chunks = [];
  let byteLength = 0;
  request.on('data', chunk => {
    byteLength += chunk.length;
    if (byteLength > 4_000_000) request.destroy();
    else chunks.push(chunk);
  });
  request.on('end', () => {
    const no = ++requestNo;
    try {
      const wire = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const messages = Array.isArray(wire.messages) ? wire.messages : [];
      const system = String(messages.find(item => item.role === 'system')?.content ?? '');
      const userText = String(messages.find(item => item.role === 'user')?.content ?? '{}');
      let user = {};
      try { user = JSON.parse(userText); } catch { /* response still fails contract validation */ }

      const requestKind = String(request.headers['x-phase9-request-kind'] ?? 'unknown');
      let assistantText;
      let role;
      if (requestKind === 'campaign_plan') {
        role = 'WorldMapper';
        const candidate = candidateModel();
        // The imported opening is scope-limited and has no campaign-known
        // knowledge entry, so the QA model must not award package lore.
        candidate.rewards = [];
        assistantText = JSON.stringify(candidate);
      } else if (requestKind === 'planner' || system.includes('ShineWord Planner (V2)')) {
        role = 'Planner';
        const intent = String(user.playerIntent ?? '');
        const isAskingLin = intent.includes('打听') || intent.includes('林凡');
        assistantText = JSON.stringify({
          proposalVersion: '2.0',
          turnId: user.turnId,
          expectedStateVersion: user.expectedStateVersion,
          actorId: 'pc',
          actionKind: isAskingLin ? 'talk' : 'skill_check',
          ...(!isAskingLin ? { skillId: 'skill-observation', difficultyBand: 'normal' } : {}),
          evidenceIds: [],
          intent: intent || '仔细查看青石巷现场',
          candidateRef: `method:${SITUATION_ID}:${isAskingLin ? 'ask-lin' : 'sweep'}`,
        });
      } else if (requestKind.startsWith('narrator') || system.includes('You are ShineWord Narrator')) {
        role = 'Narrator';
        const grade = String(user.outcomeGrade ?? 'success');
        const narrative = { turnId: user.turnId, outcomeGrade: grade, text: outcomeText(grade) };
        if (system.includes('situationSummary')) {
          narrative.situationSummary = { changes: [], opportunities: [], pressures: [] };
          narrative.nextSteps = [];
        }
        assistantText = JSON.stringify(narrative);
      } else {
        role = 'Summarizer';
        assistantText = JSON.stringify({ summary: '合成端点测试响应。' });
      }

      // Deliberately exclude prompts, novel/story text, Authorization and raw
      // provider bodies. The test needs identity/count evidence only.
      fs.appendFileSync(logPath, `${JSON.stringify({
        at: new Date().toISOString(), n: no, requestKind, role,
        model: String(wire.model ?? ''),
        logicalRequestId: request.headers['x-phase9-logical-request-id'] ?? null,
        attemptId: request.headers['x-phase9-attempt-id'] ?? null,
        attemptNo: request.headers['x-phase9-attempt-no'] ?? null,
        campaignId: request.headers['x-phase9-campaign-id'] ?? null,
        branchId: request.headers['x-phase9-branch-id'] ?? null,
        stateVersion: request.headers['x-phase9-state-version'] ?? null,
        status: 200,
      })}\n`, 'utf8');

      sendJson(response, 200, {
        id: `local-${no}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: String(wire.model ?? 'phase95-mock'),
        choices: [{ index: 0, message: { role: 'assistant', content: assistantText }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 128, completion_tokens: 64, total_tokens: 192 },
      });
    } catch (error) {
      fs.appendFileSync(logPath, `${JSON.stringify({
        at: new Date().toISOString(), n: no,
        requestKind: String(request.headers['x-phase9-request-kind'] ?? 'unknown'),
        status: 500, errorClass: error?.name ?? 'Error',
      })}\n`, 'utf8');
      sendJson(response, 500, { error: { message: 'synthetic endpoint failure' } });
    }
  });
});

server.on('error', error => {
  process.stderr.write(`${error.name}: local mock server failed to listen\n`);
  process.exitCode = 1;
});
server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`synthetic-local mock listening on 127.0.0.1:${PORT}\n`);
});
