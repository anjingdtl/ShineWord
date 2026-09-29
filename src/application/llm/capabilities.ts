import type { HttpTransport } from './openAICompatible';
import type { LlmProviderCapabilities } from './types';

export interface CapabilityProbeTransport extends HttpTransport {}

export interface ProbeOutcome {
  capabilities: LlmProviderCapabilities;
  probes: {
    jsonMode: boolean;
    usage: boolean;
    /**
     * Prefix-cache support (probe v2, 1M plan §4.2): the SAME long prompt
     * (>=1024 tokens) is sent twice; a cached_tokens > 0 on the repeat
     * proves the provider forwards prefix-cache accounting.
     */
    promptCache: boolean;
    /** Whether usage reports completion_tokens_details.reasoning_tokens. */
    reasoningTokens: boolean;
    /** Output-ceiling behaviour: the declared cap was accepted by the API. */
    outputCeiling: { requested: number; accepted: boolean; message?: string };
    errorMessages: string[];
  };
}

/** Kept as the historical name for existing callers. */
export type ProbedProfile = ProbeOutcome;

interface ProbeChatResponse {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string };
}

function readText(content: string | Array<{ text?: string }> | undefined): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => part?.text ?? '').join('');
  return '';
}

/** Deterministic long prompt: ~1.4k CJK code points >= 1024 conservative tokens. */
const CACHE_PROBE_PROMPT =
  '请逐字记住以下段落，然后只回复 json: {"ok":true}\n'
  + '缥缈录章回体志怪小说存档，山门旧事与江湖历险尽录于此。'.repeat(120);

/**
 * Capability probing instead of brand hardcoding (construction plan §13):
 * real tiny requests tell us JSON mode, usage reporting, prefix-cache
 * support and the output-ceiling behaviour far more reliably than vendor
 * tables. Fields a probe cannot discover (context window, true output
 * ceiling) stay at their declared defaults and may be overridden by the
 * saved profile (1M plan §4.2: "探测不出的字段允许 profile 手工声明").
 */
export async function probeCapabilities(input: {
  transport: HttpTransport;
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
  /** Profile-declared output ceiling whose API acceptance is verified. */
  declaredMaxOutputTokens?: number;
}): Promise<ProbeOutcome> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const errorMessages: string[] = [];
  let reasoningTokens = false;

  const chat = async (body: Record<string, unknown>): Promise<{ status: number; payload: ProbeChatResponse }> => {
    const response = await input.transport.post({
      url: `${input.endpoint.replace(/\/+$/, '')}/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify(body),
      timeoutMs,
    });
    let payload: ProbeChatResponse = {};
    try {
      payload = JSON.parse(response.body) as ProbeChatResponse;
    } catch {
      payload = {};
    }
    if (payload.usage?.completion_tokens_details?.reasoning_tokens !== undefined) {
      reasoningTokens = true;
    }
    return { status: response.status, payload };
  };

  // Probe 1: JSON mode support. Some providers (DeepSeek) require the literal
  // word "json" in the prompt to accept response_format — the probe prompt
  // includes it so capability detection tests the documented contract.
  let jsonMode = false;
  let usage = false;
  try {
    const { status, payload } = await chat({
      model: input.model,
      messages: [{ role: 'user', content: 'Reply with json: exactly {"ok":true}' }],
      max_tokens: 2048,
      response_format: { type: 'json_object' },
      stream: false,
    });
    const text = readText(payload.choices?.[0]?.message?.content).trim();
    if (status >= 200 && status < 300 && text.startsWith('{') && text.includes('ok')) {
      jsonMode = true;
    } else if (payload.error?.message) {
      errorMessages.push(payload.error.message);
    }
  } catch (error) {
    errorMessages.push(error instanceof Error ? error.message : String(error));
  }

  // Probe 2: plain request for usage reporting (independent of JSON mode).
  try {
    const { payload } = await chat({
      model: input.model,
      messages: [{ role: 'user', content: 'Say OK.' }],
      max_tokens: 32,
      stream: false,
    });
    if (payload.usage?.prompt_tokens !== undefined || payload.usage?.completion_tokens !== undefined) {
      usage = true;
    }
  } catch (error) {
    errorMessages.push(error instanceof Error ? error.message : String(error));
  }

  // Probe 3 (v2): prefix-cache support - the same long prompt twice; the
  // repeat must report cached_tokens > 0 (1M plan §4.2).
  let promptCache = false;
  try {
    const cacheBody = {
      model: input.model,
      messages: [{ role: 'user', content: CACHE_PROBE_PROMPT }],
      max_tokens: 64,
      stream: false,
    };
    await chat(cacheBody);
    const { payload } = await chat(cacheBody);
    const cached = payload.usage?.prompt_tokens_details?.cached_tokens;
    if (typeof cached === 'number' && cached > 0) {
      promptCache = true;
    }
  } catch (error) {
    errorMessages.push(error instanceof Error ? error.message : String(error));
  }

  // Probe 4 (v2): output-ceiling behaviour - a tiny completion with
  // max_tokens at the declared ceiling. A 4xx rejection here surfaces the
  // message so the user can correct the declared profile value.
  const requestedCeiling = input.declaredMaxOutputTokens ?? 8_192;
  const outputCeiling: ProbeOutcome['probes']['outputCeiling'] = {
    requested: requestedCeiling,
    accepted: true,
  };
  try {
    const { status, payload } = await chat({
      model: input.model,
      messages: [{ role: 'user', content: 'Say OK.' }],
      max_tokens: requestedCeiling,
      stream: false,
    });
    if (status < 200 || status >= 300) {
      outputCeiling.accepted = false;
      outputCeiling.message = payload.error?.message ?? `HTTP ${status}`;
      if (payload.error?.message) errorMessages.push(payload.error.message);
    }
  } catch (error) {
    outputCeiling.accepted = false;
    outputCeiling.message = error instanceof Error ? error.message : String(error);
    errorMessages.push(outputCeiling.message);
  }

  const capabilities: LlmProviderCapabilities = {
    supportsJson: jsonMode,
    supportsStreaming: false,
    reportsUsage: usage,
    contextWindow: 128_000,
    maxOutputTokens: requestedCeiling,
    supportsPromptCache: promptCache,
  };

  return {
    capabilities,
    probes: { jsonMode, usage, promptCache, reasoningTokens, outputCeiling, errorMessages },
  };
}
