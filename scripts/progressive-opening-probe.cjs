#!/usr/bin/env node
/*
 * Bounded, redacted diagnostic for the progressive-opening real endpoint.
 * Sends one tiny JSON request, then one request each with 1k/4k/12k code-point
 * slices from a supplied TXT. It never writes prompts, source, keys, response
 * bodies, endpoint URLs, or Authorization headers to disk or stdout.
 */
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const DEFAULT_MODEL = 'GLM-5.3-Flash';
let MODEL = DEFAULT_MODEL;
const ENDPOINT = 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions';
const MAX_ATTEMPTS_PER_SAMPLE = 1;
const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;
const DEFAULT_TOTAL_DEADLINE_MS = 360_000;
const OPENING_REQUEST_TIMEOUT_MS = 120_000;
const OPENING_TOTAL_DEADLINE_MS = 300_000;

function argsOf(argv) {
  const values = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error('usage');
    const equals = key.indexOf('=');
    if (equals > 0) values[key.slice(2, equals)] = key.slice(equals + 1);
    else values[key.slice(2)] = argv[++i];
  }
  return values;
}

function readKey(configPath) {
  const config = fs.readFileSync(configPath, 'utf8');
  const match = config.match(/^\s*(?:api[_ -]?key|key)\s*[：:=]\s*(\S+)\s*$/im);
  if (!match || !match[1]) throw new Error('config_missing_key');
  return match[1];
}

function makeSample(label, source, codePoints, maxOutputTokens) {
  const system = [
    '你是小说资料整理器。只根据给定原文返回 JSON，不补写原文未证实的设定。',
    'schema: {"entities":[{"name":string,"aliases":string[],"kind":"person|place|other"}],"facts":[{"subject":string,"relation":string,"object":string,"evidence":string}],"unknowns":string[]}',
    '最多 5 个实体、8 条事实、5 个未知项。每条事实 evidence 必须是原文逐字连续引文；不确定就放入 unknowns。',
  ].join('\n');
  const user = `整理以下开篇资料，保持 JSON 格式。\n\n<原文>\n${source}\n</原文>`;
  return {
    label,
    inputCodePoints: codePoints,
    maxOutputTokens,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    source,
  };
}

function safeFailure(error, status) {
  if (status !== undefined && (status < 200 || status >= 300)) return `http_${status}`;
  const code = String(error && error.code || '').toUpperCase();
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'network_timeout';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns_failure';
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EHOSTUNREACH') return 'connection_failure';
  if (error && error.name === 'TimeoutError') return 'request_timeout';
  return 'transport_or_protocol_failure';
}

function parseSseBlock(block, state, now) {
  const data = block.split(/\r?\n/).filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart()).join('\n');
  if (!data || data === '[DONE]') return;
  let event;
  try { event = JSON.parse(data); } catch { state.protocolErrors += 1; return; }
  const usage = event.usage;
  if (usage && typeof usage === 'object') {
    state.usage = {
      inputTokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null,
      outputTokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null,
      reasoningTokens: Number.isFinite(usage.completion_tokens_details?.reasoning_tokens)
        ? usage.completion_tokens_details.reasoning_tokens : null,
    };
  }
  const choice = event.choices?.[0];
  if (!choice) return;
  if (typeof choice.finish_reason === 'string') state.finishReason = choice.finish_reason;
  const delta = choice.delta || {};
  const text = typeof delta.content === 'string' ? delta.content : '';
  const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';
  if (text && state.firstTextMs === null) state.firstTextMs = now();
  if (reasoning && state.firstReasoningMs === null) state.firstReasoningMs = now();
  state.outputChars += Array.from(text).length;
  state.reasoningChars += Array.from(reasoning).length;
  state.textParts.push(text);
}

function requestSample(apiKey, sample, timeoutMs, deadlineAt) {
  return new Promise(resolve => {
    const started = performance.now();
    const state = {
      status: null, headersMs: null, queueMs: null, dnsMs: null, tcpMs: null,
      tlsMs: null, firstTextMs: null, firstReasoningMs: null, finishReason: null,
      usage: { inputTokens: null, outputTokens: null, reasoningTokens: null },
      outputChars: 0, reasoningChars: 0, protocolErrors: 0, textParts: [],
      serverQueueMs: null, connectionReused: null,
    };
    const elapsed = () => Math.round(performance.now() - started);
    let socketAt = null;
    let lookupAt = null;
    let connectAt = null;
    let secureAt = null;
    let body = '';
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = state.textParts.join('');
      let parsed = null;
      if (text.trim()) {
        try { parsed = JSON.parse(text); } catch { /* response content is never emitted */ }
      }
      const dossierEvidence = sample.kind === 'opening-dossier'
        ? ['locationQuote', 'settingQuote', 'situationQuote', 'goalQuote']
          .map(key => parsed?.[key]).filter(value => typeof value === 'string')
        : null;
      const evidence = dossierEvidence ?? (Array.isArray(parsed?.facts)
        ? parsed.facts.filter(f => typeof f?.evidence === 'string')
        : []);
      const openingQuotes = sample.kind === 'opening-dossier'
        ? ['locationQuote', 'settingQuote', 'situationQuote', 'goalQuote']
          .map(key => parsed?.[key]).filter(value => typeof value === 'string')
        : [];
      const firstScene = sample.kind === 'opening-dossier'
        ? Array.from(sample.source).slice(0, 1600).join('') : sample.source;
      const quoteHits = sample.kind === 'opening-dossier'
        ? openingQuotes.filter(value => firstScene.includes(value)).length
        : evidence.filter(f => sample.source && sample.source.includes(f.evidence)).length;
      const dossierShapeValid = sample.kind !== 'opening-dossier' || parsed !== null
        && ['locationName', 'locationQuote', 'setting', 'settingQuote', 'situation', 'situationQuote',
          'initialGoal', 'goalQuote'].every(key => typeof parsed[key] === 'string');
      const summary = {
          sample: sample.label,
          inputCodePoints: sample.inputCodePoints,
          requestBodyBytes: Buffer.byteLength(JSON.stringify(payload)),
          physicalRequests: 1,
          status: state.status,
          connectionReused: state.connectionReused,
          failureCategory: result.failureCategory ?? null,
          timingsMs: {
            localQueue: state.queueMs,
            dns: state.dnsMs,
            tcp: state.tcpMs,
            tls: state.tlsMs,
            responseHeaders: state.headersMs,
            firstReasoningDelta: state.firstReasoningMs,
            firstTextToken: state.firstTextMs,
            completeResponse: elapsed(),
            providerQueue: state.serverQueueMs,
          },
          finishReason: state.finishReason,
          usage: state.usage,
          outputChars: state.outputChars,
          reasoningChars: state.reasoningChars,
          jsonParsed: parsed !== null,
          simpleJsonValid: sample.label === 'micro-json' ? parsed?.ok === true : null,
          schemaShapeValid: sample.kind === 'opening-dossier' ? dossierShapeValid
            : sample.label === 'micro-json' ? null : parsed !== null
              && Array.isArray(parsed.entities) && Array.isArray(parsed.facts) && Array.isArray(parsed.unknowns),
          evidenceQuoteCount: sample.kind === 'opening-dossier' ? openingQuotes.length : evidence.length,
          evidenceExactHits: quoteHits,
          protocolErrors: state.protocolErrors,
          businessTextBytes: Buffer.byteLength(text),
          ...result,
        };
      resolve({ summary, internal: { responseText: text } });
    };
    const payload = {
      model: MODEL,
      messages: sample.messages,
      max_tokens: sample.maxOutputTokens,
      stream: true,
      stream_options: { include_usage: true },
      response_format: { type: 'json_object' },
    };
    const serialized = JSON.stringify(payload);
    const url = new URL(ENDPOINT);
    const req = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        accept: 'text/event-stream',
        'content-length': Buffer.byteLength(serialized),
      },
    });
    req.on('socket', socket => {
      socketAt = performance.now();
      state.queueMs = Math.round(socketAt - started);
      state.connectionReused = !socket.connecting;
      socket.once('lookup', (error, address, family, duration) => {
        lookupAt = performance.now();
        state.dnsMs = Number.isFinite(duration) ? duration : Math.round(lookupAt - socketAt);
      });
      socket.once('connect', () => {
        connectAt = performance.now();
        if (lookupAt !== null) state.tcpMs = Math.round(connectAt - lookupAt);
      });
      socket.once('secureConnect', () => {
        secureAt = performance.now();
        if (connectAt !== null) state.tlsMs = Math.round(secureAt - connectAt);
      });
    });
    req.on('response', response => {
      state.status = response.statusCode ?? null;
      state.headersMs = elapsed();
      const timingHeader = response.headers['server-timing'];
      if (typeof timingHeader === 'string') {
        const match = timingHeader.match(/(?:queue|queued|wait)[^,;]*;dur=([0-9.]+)/i);
        if (match) state.serverQueueMs = Number(match[1]);
      }
      const queueHeader = response.headers['x-queue-time-ms'] || response.headers['x-request-queue-ms'];
      if (typeof queueHeader === 'string' && /^\d+(?:\.\d+)?$/.test(queueHeader)) {
        state.serverQueueMs = Number(queueHeader);
      }
      if (state.status < 200 || state.status >= 300) {
        response.resume();
        response.once('end', () => finish({ failureCategory: `http_${state.status}` }));
        return;
      }
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        for (;;) {
          const boundary = body.search(/\r?\n\r?\n/);
          if (boundary < 0) break;
          const block = body.slice(0, boundary);
          const width = body.slice(boundary).startsWith('\r\n\r\n') ? 4 : 2;
          body = body.slice(boundary + width);
          parseSseBlock(block, state, elapsed);
        }
      });
      response.on('end', () => finish({
        failureCategory: state.protocolErrors > 0 ? 'invalid_sse_json' : null,
      }));
      response.on('error', error => finish({ failureCategory: safeFailure(error, state.status) }));
    });
    req.on('error', error => finish({ failureCategory: safeFailure(error, state.status) }));
    const remaining = Math.max(1, Math.min(timeoutMs, deadlineAt - Date.now()));
    const timer = setTimeout(() => {
      req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
      finish({ failureCategory: Date.now() >= deadlineAt ? 'total_deadline' : 'request_timeout' });
    }, remaining);
    req.write(serialized);
    req.end();
  });
}

function safeSummary(samples, startedAt, totalMs) {
  return {
    schemaVersion: 1,
    startedAt,
    model: MODEL,
    reasoningPolicy: 'enabled; no thinking opt-out sent',
    samples,
    totalPhysicalRequests: samples.reduce((sum, sample) => sum + sample.physicalRequests, 0),
    totalElapsedMs: totalMs,
    budget: { attemptsPerSample: MAX_ATTEMPTS_PER_SAMPLE, requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      totalDeadlineMs: DEFAULT_TOTAL_DEADLINE_MS },
    redaction: 'No source text, prompt, key, Authorization, endpoint, or response body persisted.',
  };
}

async function main() {
  const args = argsOf(process.argv);
  if (!args.config || !args.source || !args.out) throw new Error('usage');
  if (args.model !== undefined) {
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(args.model)) throw new Error('usage');
    MODEL = args.model;
  }
  const key = readKey(args.config);
  if (args['opening-dossier'] === 'true') {
    const { extractOpeningDossier } = require('../dist/application/worldPackage/progressiveOpening');
    const { importTxtSource, sliceByCodePoints } = require('../dist/application/import/txtImport');
    const bytes = fs.readFileSync(args.source);
    const sha = { sha256BytesHex: async value => require('node:crypto').createHash('sha256').update(value).digest('hex') };
    const decoder = { decode: (value, encoding) => new TextDecoder(encoding === 'utf-8-sig' ? 'utf-8' : encoding).decode(value) };
    const parsed = await importTxtSource(bytes, sha, decoder);
    const inputCodePoints = Math.min(parsed.codePointCount, 8_000);
    const outputTokens = Number(args['dossier-output-tokens'] || 8_000);
    if (!Number.isInteger(outputTokens) || outputTokens < 1 || outputTokens > 8_000) throw new Error('usage');
    const sourceExcerpt = sliceByCodePoints(parsed.text, 0, inputCodePoints);
    const startedAt = new Date().toISOString();
    const runStarted = Date.now();
    const deadlineAt = runStarted + OPENING_TOTAL_DEADLINE_MS;
    const samples = [];
    let physicalRequests = 0;
    let dossierValid = false;
    let safeError = null;
    try {
      await extractOpeningDossier({
        sourceExcerpt,
        maxOutputTokens: outputTokens,
        provider: {
          complete: async request => {
            if (physicalRequests >= 2) throw new Error('physical_request_cap');
            physicalRequests += 1;
            const sample = {
              label: `opening-dossier-${physicalRequests}`,
              kind: 'opening-dossier',
              inputCodePoints,
              maxOutputTokens: request.maxOutputTokens,
              messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
              source: sourceExcerpt,
            };
            const live = await requestSample(key, sample, OPENING_REQUEST_TIMEOUT_MS, deadlineAt);
            samples.push(live.summary);
            const metric = live.summary;
            const outcome = metric.status !== null && (metric.status < 200 || metric.status >= 300)
              ? 'http_error'
              : metric.failureCategory ? 'transport_error'
                : live.internal.responseText.trim() ? 'completed'
                  : metric.reasoningChars > 0 ? 'reasoning_only' : 'invalid_response';
            const completionState = metric.finishReason === 'length' && !live.internal.responseText.trim()
              ? 'reasoning_only'
              : metric.finishReason === 'content_filter' ? 'content_filter' : undefined;
            return {
              text: live.internal.responseText,
              usage: {
                ...(typeof metric.usage.inputTokens === 'number' ? { inputTokens: metric.usage.inputTokens } : {}),
                ...(typeof metric.usage.outputTokens === 'number' ? { outputTokens: metric.usage.outputTokens } : {}),
                ...(typeof metric.usage.reasoningTokens === 'number' ? { reasoningTokens: metric.usage.reasoningTokens } : {}),
                estimated: false,
              },
              requestMetrics: [{
                attempt: physicalRequests,
                durationMs: metric.timingsMs.completeResponse ?? 0,
                httpStatus: metric.status,
                outcome,
                ...(completionState ? { completionState } : {}),
                ...(metric.failureCategory ? { errorCategory: metric.failureCategory.includes('timeout') ? 'timeout'
                  : metric.failureCategory.includes('connection') || metric.failureCategory.includes('dns') ? 'network'
                    : metric.status !== null ? 'provider_http' : 'network' } : {}),
                timings: {
                  responseHeadersMs: metric.timingsMs.responseHeaders,
                  firstBodyByteMs: null,
                  completeResponseMs: metric.timingsMs.completeResponse,
                  providerQueueMs: metric.timingsMs.providerQueue,
                },
              }],
            };
          },
        },
      });
      dossierValid = true;
    } catch (error) {
      const category = error && typeof error.category === 'string' ? error.category : 'probe_failed';
      safeError = /^[a-z_]+$/.test(category) ? category : 'probe_failed';
    }
    const summary = {
      schemaVersion: 1,
      mode: 'opening-dossier',
      startedAt,
      model: MODEL,
      reasoningPolicy: 'enabled; no thinking opt-out sent',
      inputCodePoints,
      sourceBudgetCodePoints: 8_000,
      maxOutputTokens: outputTokens,
      dossierValid,
      failureCategory: safeError,
      physicalRequests,
      requestCap: 2,
      requestTimeoutMs: OPENING_REQUEST_TIMEOUT_MS,
      totalDeadlineMs: OPENING_TOTAL_DEADLINE_MS,
      totalElapsedMs: Date.now() - runStarted,
      samples,
      redaction: 'Only redacted timing/usage/schema checks persisted; no source, prompt, key, response text, or Authorization.',
    };
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  const decoded = fs.readFileSync(args.source, 'utf8').replace(/^\uFEFF/, '');
  const points = Array.from(decoded);
  const startedAt = new Date().toISOString();
  const runStarted = Date.now();
  const deadlineAt = runStarted + DEFAULT_TOTAL_DEADLINE_MS;
  const samples = [];
  const tiny = {
    label: 'micro-json', inputCodePoints: 0, maxOutputTokens: 128,
    messages: [
      { role: 'system', content: '只返回一个 JSON 对象。' },
      { role: 'user', content: '返回 {"ok":true}。' },
    ],
    source: '',
  };
  const cases = [tiny, ...[1000, 4000, 12000].map(size =>
    makeSample(`${size}cp`, points.slice(0, size).join(''), size, size === 1000 ? 512 : size === 4000 ? 768 : 1024))];
  const selectedCases = args.only ? cases.filter(sample => sample.label === args.only) : cases;
  if (args.only && selectedCases.length !== 1) throw new Error('usage');
  if (args['output-tokens']) {
    const outputTokens = Number(args['output-tokens']);
    if (!Number.isInteger(outputTokens) || outputTokens < 1 || outputTokens > 8192) throw new Error('usage');
    for (const sample of selectedCases) sample.maxOutputTokens = outputTokens;
  }
  for (const sample of selectedCases) {
    if (Date.now() >= deadlineAt) {
      samples.push({ sample: sample.label, inputCodePoints: sample.inputCodePoints, physicalRequests: 0,
        status: null, failureCategory: 'total_deadline_before_request' });
      continue;
    }
    // Keep evidence validation in memory and discard it with the prompt.
    const result = await requestSample(key, sample, DEFAULT_REQUEST_TIMEOUT_MS, deadlineAt);
    samples.push(result.summary);
    sample.source = '';
  }
  const summary = safeSummary(samples, startedAt, Date.now() - runStarted);
  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch(error => {
  const category = error && typeof error.message === 'string' && /^[a-z_]+$/.test(error.message)
    ? error.message : 'probe_setup_failed';
  process.stderr.write(`${JSON.stringify({ failureCategory: category })}\n`);
  process.exitCode = 1;
});
