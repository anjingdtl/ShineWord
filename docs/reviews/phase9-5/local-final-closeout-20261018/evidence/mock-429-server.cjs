'use strict';

const fs = require('node:fs');
const http = require('node:http');

const host = process.env.P95_MOCK_HOST || '0.0.0.0';
const port = Number(process.env.P95_MOCK_PORT || 8765);
const summaryPath = process.env.P95_MOCK_SUMMARY;
if (!Number.isInteger(port) || port < 1 || port > 65535 || !summaryPath) {
  throw new Error('Set P95_MOCK_PORT and P95_MOCK_SUMMARY to run this bounded fixture.');
}
let requests = 0;
const server = http.createServer((req, res) => {
  requests += 1;
  const method = req.method || 'UNKNOWN';
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  req.on('data', () => {}); // Discard request content; never persist prompts or credentials.
  req.on('end', () => {
    const record = {
      requestCount: requests,
      method,
      path: pathname,
      responseStatus: 429,
      responseKind: 'synthetic-local-rate-limit',
      requestBodyStored: false,
      authorizationLogged: false,
      at: new Date().toISOString(),
    };
    fs.writeFileSync(summaryPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    res.writeHead(429, {
      'content-type': 'application/json',
      'retry-after': '120',
      connection: 'close',
    });
    res.end(JSON.stringify({
      error: {
        message: 'Synthetic local 429 for Phase 9.5 recovery verification.',
        type: 'rate_limit_error',
        code: 'rate_limit_exceeded',
      },
    }));
    server.close();
  });
});
server.listen(port, host, () => {
  process.stdout.write(`Bounded local 429 fixture listening on ${host}:${port}; one response only.\n`);
});
