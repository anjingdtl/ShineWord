/**
 * M6c: large-novel pressure boundary on 《凡人修仙传》 (22.5MB).
 *
 * Local: full TXT import (chapters/chunks/codepoints/timing/token estimate).
 * Real API (bounded, 2 requests): one LARGE-context planner probe (~60K CJK
 * tokens) and one JSON-fence probe on the same big prefix to observe
 * prefix-cache behaviour. No full-novel LLM runs (cost guard, plan §57).
 *
 * Usage: node tools/real-glm-fanren.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const D = relative => require(path.join(ROOT, 'dist', relative));
const { importTxtSource } = D('application/import/txtImport');
const { OpenAICompatibleProvider } = D('application/llm/openAICompatible');
const { MemorySecretStore } = D('application/llm/memorySecretStore');
const { parseStructuredOutput } = D('application/llm/structuredOutput');
const { estimateTokens } = D('application/context/tokenEstimate');

const NOVEL_PATH = 'C:/Users/anjin/Desktop/Ai工作坊/凡人修仙传.txt';
const KEY_FILE = 'C:/Users/anjin/Desktop/Ai工作坊/Test-API/GLM-TEST-KEY.TXT';
const MAX_PHYSICAL_REQUESTS = 3;
const BIG_CONTEXT_CODE_POINTS = 60_000;

class FetchTransport {
  async post(request) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: 'POST', headers: request.headers, body: request.body, signal: controller.signal,
      });
      return { status: response.status, body: await response.text() };
    } finally { clearTimeout(timer); }
  }
}

const sha = {
  sha256Hex: value => crypto.createHash('sha256').update(value, 'utf8').digest('hex'),
  sha256BytesHex: bytes => crypto.createHash('sha256').update(bytes).digest('hex'),
};

function parseKeyFile() {
  const info = {};
  for (const line of fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^：:]+)[：:]\s*(.+)$/);
    if (m) info[m[1].trim()] = m[2].trim();
  }
  return { key: info['api key'], endpoint: info['端点'], model: info['模型'] };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const { key, endpoint, model } = parseKeyFile();
  console.log(`credentialLoaded=true model=${model}`);
  const report = { generatedAt: new Date().toISOString(), novel: null, probes: [] };

  // ------------------------------------------------------------- local import
  const bytes = fs.readFileSync(NOVEL_PATH);
  const importStart = Date.now();
  const parsed = await importTxtSource(new Uint8Array(bytes), sha, {
    decode(raw, encoding) { return new TextDecoder(encoding).decode(raw); },
  });
  const importMs = Date.now() - importStart;
  report.novel = {
    file: path.basename(NOVEL_PATH),
    sha256: parsed.sourceSha256Hex,
    bytes: bytes.length,
    codePoints: parsed.codePointCount,
    estimatedTokens: estimateTokens(parsed.text),
    chapters: parsed.chapters.length,
    chunks: parsed.chunks.length,
    splitStrategy: parsed.splitStrategy,
    importMs,
  };
  console.log(`[import] ${importMs}ms chapters=${parsed.chapters.length} chunks=${parsed.chunks.length} cp=${parsed.codePointCount} estTokens=${report.novel.estimatedTokens}`);

  // ------------------------------------------------------------ real probes
  const secrets = new MemorySecretStore();
  await secrets.set('glm.test', key);
  const profile = {
    id: 'glm-test', name: 'GLM test', endpoint, model, keyRef: 'glm.test',
    capabilities: { supportsJson: true, supportsStreaming: false, reportsUsage: true, contextWindow: 1_048_576, maxOutputTokens: 32_768 },
    reasoningEffort: 'low', reasoningReserveTokens: 2_048,
  };
  const provider = new OpenAICompatibleProvider(profile, secrets, new FetchTransport(), 300_000);
  let physical = 0;

  const bigPrefix = Array.from(parsed.text).slice(0, BIG_CONTEXT_CODE_POINTS).join('');
  const bigTokens = estimateTokens(bigPrefix);
  const system = 'You are a story analyst. Answer only in the requested JSON shape.';
  const user = bigPrefix
    + '\n\n以上是小说开头的长文。请只输出 JSON：{"chapterEstimate": number(你判断以上内容大约覆盖了多少章),"protagonistName": string,"ok": true}。不要其他文字。';

  // Probe 1: large-context JSON completion (single shot).
  {
    physical += 1;
    if (physical > MAX_PHYSICAL_REQUESTS) throw new Error('budget');
    const started = Date.now();
    const response = await provider.complete({
      role: 'Checker', system, user, maxOutputTokens: 4_000, jsonMode: true,
    });
    const parsedAnswer = parseStructuredOutput(response.text, { label: 'big-context json' }).value;
    const ok = parsedAnswer.ok === true && typeof parsedAnswer.protagonistName === 'string';
    report.probes.push({
      probe: 'big_context_json', pass: ok, ms: Date.now() - started,
      contextCodePoints: BIG_CONTEXT_CODE_POINTS, contextTokensEstimate: bigTokens,
      usage: response.usage ?? null,
    });
    console.log(`[probe1 big-context] ${ok ? 'PASS' : 'FAIL'} ${Date.now() - started}ms estTokens=${bigTokens} usage=${JSON.stringify(response.usage)}`);
  }

  // Probe 2: same prefix again -> prefix-cache observation (cached_tokens).
  await sleep(2_000);
  {
    physical += 1;
    if (physical > MAX_PHYSICAL_REQUESTS) throw new Error('budget');
    const started = Date.now();
    const response = await provider.complete({
      role: 'Checker', system,
      user: user.replace('"ok": true', '"ok": true, "second": true'),
      maxOutputTokens: 4_000, jsonMode: true,
    });
    const parsedAnswer = parseStructuredOutput(response.text, { label: 'big-context json 2' }).value;
    report.probes.push({
      probe: 'prefix_cache_repeat', pass: parsedAnswer.ok === true, ms: Date.now() - started,
      usage: response.usage ?? null,
      cachedRatio: response.usage?.inputTokens && response.usage?.cachedInputTokens
        ? Number((response.usage.cachedInputTokens / response.usage.inputTokens).toFixed(3))
        : null,
    });
    console.log(`[probe2 cache-repeat] ${Date.now() - started}ms usage=${JSON.stringify(response.usage)}`);
  }

  const artifactsDir = path.join(ROOT, 'docs/reviews/llm-memory/artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });
  const outPath = path.join(artifactsDir, 'm6c-fanren-pressure.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`report -> ${path.relative(ROOT, outPath)}`);
}

main().catch(error => {
  console.error('m6c harness error:', error.message);
  process.exitCode = 1;
});
