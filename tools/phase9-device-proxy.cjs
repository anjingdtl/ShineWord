/** Dedicated emulator QA proxy: reserve the shared cap before each HTTP. */
const http = require('node:http');
const fs = require('node:fs');
const { reservePhysicalRequest, manifestPath } = require('./phase9-budget.cjs');
const endpoint = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).inputs.llm.endpoint.replace(/\/+$/, '');
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/chat/completions') { res.writeHead(404); res.end(); return; }
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    reservePhysicalRequest('android-ui');
    const response = await fetch(`${endpoint}/chat/completions`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '' },
      body: Buffer.concat(chunks), signal: AbortSignal.timeout(300000) });
    const body = await response.text();
    res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(body);
    console.log(JSON.stringify({ at: new Date().toISOString(), status: response.status, bytes: Buffer.byteLength(body) }));
  } catch (error) { res.writeHead(503); res.end(JSON.stringify({ error: 'QA transport failed or budget exhausted' })); }
});
const port = Number(process.env.PHASE9_PROXY_PORT || 18591);
server.listen(port, '0.0.0.0', () => console.log(`Phase9 QA proxy ready on port ${port}; credentials and request content are never logged.`));
