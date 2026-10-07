/** QA transport with one deadline covering connection, headers and the full body.
 * Node fetch has an independent five-minute headers limit, which would otherwise
 * invalidate long-request acceptance even when the application allows more time. */
const http = require('node:http');
const https = require('node:https');
function postQaHttp({ url, headers, body, timeoutMs, onHeaders, onChunk }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1200000) throw Error('Invalid QA HTTP deadline');
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol)) throw Error('Invalid QA HTTP protocol');
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const request = (target.protocol === 'https:' ? https : http).request(target,
      { method: 'POST', headers }, response => {
        const responseHeadersMs = Date.now() - started;
        const responseHeaders = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value ?? '']));
        onHeaders?.({ status: response.statusCode, headers: responseHeaders, responseHeadersMs });
        const chunks = [];
        response.on('data', chunk => { chunks.push(chunk); onChunk?.(chunk); });
        response.on('error', reject);
        response.on('aborted', () => reject(new Error('QA HTTP response aborted')));
        response.on('end', () => resolve({ status: response.statusCode,
          headers: responseHeaders,
          body: Buffer.concat(chunks).toString('utf8'),
          timings: { responseHeadersMs, completeResponseMs: Date.now() - started } }));
      });
    const timer = setTimeout(() => request.destroy(new Error('QA HTTP request timed out')), timeoutMs);
    request.on('error', reject);
    // Keep the deadline through response body consumption; socket inactivity
    // timers do not cover a server that keeps sending incomplete output.
    request.on('close', () => clearTimeout(timer));
    request.end(body);
  });
}
module.exports = { postQaHttp };
