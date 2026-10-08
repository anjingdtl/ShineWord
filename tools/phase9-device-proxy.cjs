/** Dedicated emulator QA proxy: reserve the shared cap before each HTTP. */
const http = require('node:http');
const { postQaHttp } = require('./phase9-http.cjs');
function createQaProxy({ endpoint, reserve, log = () => {}, timeoutMs = 1200000 }) {
  endpoint = endpoint.replace(/\/+$/, '');
  const report = metric => { try { log({ at: new Date().toISOString(), ...metric }); } catch { /* telemetry is not transport */ } };
  return http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/chat/completions') { res.writeHead(404); res.end(); return; }
  let reserved = false;
  const started = Date.now();
  res.on('close', () => {
    if (!res.writableFinished) report({ phase: 'downstream_closed', dispatched: reserved, ms: Date.now() - started });
  });
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    try { reserve('android-ui'); reserved = true; }
    catch {
      report({ status: 429, failure: 'qa_dispatch_denied', dispatched: false });
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'QA request reservation denied before upstream dispatch' }));
      return;
    }
    // The app owns its operation deadline; this ceiling must not impose an
    // earlier hidden five-minute fetch limit on high-effort planning.
    const response = await postQaHttp({ url: `${endpoint}/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '' },
      body: Buffer.concat(chunks), timeoutMs,
      onHeaders: ({ status, headers, responseHeadersMs }) => {
        res.writeHead(status, { 'Content-Type': headers['content-type'] || 'application/json',
          ...(headers['retry-after'] ? { 'Retry-After': headers['retry-after'] } : {}) });
        report({ phase: 'response_headers', status, responseHeadersMs, dispatched: true });
      },
      onChunk: chunk => { if (!res.destroyed) res.write(chunk); },
    });
    const body = response.body;
    res.end();
    report({ status: response.status, bytes: Buffer.byteLength(body), dispatched: true, ms: Date.now() - started });
  } catch {
    // Once dispatch is possible, a lost response is unknown, not a known 503.
    // Preserve the network failure so the production ledger forbids replay.
    report({ status: null, failure: reserved ? 'qa_transport_unknown' : 'qa_input_failed', dispatched: reserved, ms: Date.now() - started });
    res.destroy();
  }
  });
}
module.exports = { createQaProxy };
if (require.main === module) {
  const fs = require('node:fs');
  const { reservePhysicalRequest, manifestPath } = require('./phase9-budget.cjs');
  const endpoint = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).inputs.llm.endpoint;
  const server = createQaProxy({ endpoint, reserve: reservePhysicalRequest, log: metric => console.log(JSON.stringify(metric)) });
  const port = Number(process.env.PHASE9_PROXY_PORT || 18591);
  server.listen(port, '0.0.0.0', () => console.log(`Phase9 QA proxy ready on port ${port}; credentials and request content are never logged.`));
}
