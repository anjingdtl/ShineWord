import type { HttpTransport } from './openAICompatible';
import type { LlmProviderCapabilities } from './types';

export interface CapabilityProbeTransport extends HttpTransport {}

export interface ProbedProfile {
  capabilities: LlmProviderCapabilities;
  probes: {
    jsonMode: boolean;
    usage: boolean;
    errorMessages: string[];
  };
}

interface ProbeChatResponse {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

function readText(content: string | Array<{ text?: string }> | undefined): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => part?.text ?? '').join('');
  return '';
}

/**
 * Capability probing instead of brand hardcoding (construction plan §13):
 * one real tiny request tells us JSON mode, usage reporting and the output
 * ceiling behaviour far more reliably than vendor tables.
 */
export async function probeCapabilities(input: {
  transport: HttpTransport;
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
}): Promise<ProbedProfile> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const errorMessages: string[] = [];

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

  const capabilities: LlmProviderCapabilities = {
    supportsJson: jsonMode,
    supportsStreaming: false,
    reportsUsage: usage,
    contextWindow: 128_000,
    maxOutputTokens: 8192,
  };

  return { capabilities, probes: { jsonMode, usage, errorMessages } };
}
