/**
 * Real API connection probe (real-device P0-3).
 *
 * "Saved" only ever meant "written to storage" - it proved nothing about the
 * endpoint, the key, the model name, the /chat/completions path or whether
 * the reasoning parameters are accepted. The probe runs the EXACT production
 * pipeline (OpenAICompatibleProvider -> /chat/completions with the currently
 * selected reasoning tier and dialect) with one tiny prompt, then classifies
 * the failure so the UI can tell the user what to fix.
 *
 * Secret handling: an unsaved form key lives only in the in-memory secret
 * store below for the duration of the probe; it is never persisted, logged,
 * or echoed in the result object. An empty form key falls back to whatever
 * Keychain already holds.
 */
import { OpenAICompatibleProvider } from '../../src/application/llm/openAICompatible';
import type { HttpTransport } from '../../src/application/llm/openAICompatible';
import { LlmRequestFailure } from '../../src/application/llm/types';
import type { ApiProfile, ReasoningTier, SecretStore } from '../../src/application/llm/types';
import { ReasoningDialectUnsupportedError } from '../../src/application/llm/reasoningPolicy';

export type ConnectionProbeOutcome =
  | 'success'
  | 'unauthorized'
  | 'not_found'
  | 'bad_request'
  | 'reasoning_unsupported'
  | 'reasoning_only'
  | 'rate_limited'
  | 'server_error'
  | 'timeout'
  | 'network_error'
  | 'invalid_response'
  | 'missing_key'
  | 'invalid_input'
  | 'invalid_endpoint';

export interface ConnectionProbeResult {
  ok: boolean;
  outcome: ConnectionProbeOutcome;
  /** Friendly, already-localized display message (secret-free). */
  message: string;
  model: string;
  reasoningTier: ReasoningTier;
  /** Wall time of the probe; null when no request was attempted. */
  durationMs: number | null;
}

export interface ConnectionProbeInput {
  endpoint: string;
  model: string;
  reasoningTier: ReasoningTier;
  /** 'unsupported' mirrors the form's "端点不支持" reasoning-protocol choice. */
  reasoningDialect?: 'deepseek' | 'glm' | 'generic' | 'unsupported';
  /** Form key (memory-only); when null the secretStore's value is used. */
  apiKey: string | null;
  keyRef: string;
  secretStore: SecretStore;
  transport: HttpTransport;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

const PROBE_SYSTEM = '你是 ShineWord 的连接测试助手。';
const PROBE_USER = '连接测试：请只回复四个汉字「连接成功」，不要输出任何其他内容。';

function memorySecretStore(key: string): SecretStore {
  return {
    async set() { throw new Error('probe secrets are read-only'); },
    async get(keyRef: string) { return keyRef === 'probe' ? key : null; },
    async delete() { throw new Error('probe secrets are read-only'); },
  };
}

const OUTCOME_MESSAGES: Record<ConnectionProbeOutcome, (durationMs: number | null) => string> = {
  success: durationMs => `API 连接成功，模型返回正常（${durationMs ?? '?'} ms）`,
  unauthorized: () => 'API Key 无效或无权限（401/403）',
  not_found: () => 'Endpoint 路径或模型名称可能错误（404）',
  bad_request: () => '请求参数被拒绝（400），请检查端点协议与模型名称',
  reasoning_unsupported: () => '端点不接受思考参数（reasoning_effort/thinking），与当前思考档位不兼容',
  reasoning_only: () => '端点可达，但模型只返回了思考内容，未输出正文；建议提高最大输出 Token 或降低思考强度',
  rate_limited: () => '服务商限流（429），请稍后重试',
  server_error: () => '模型服务端异常（5xx），请稍后重试',
  timeout: () => '请求超时，端点响应太慢或不可达',
  network_error: () => '网络连接失败，请检查网络或端点地址',
  invalid_response: () => '服务返回内容无法解析（非 JSON 响应）',
  missing_key: () => '请先填写 API Key（测试只使用内存中的值，不会保存）',
  invalid_input: () => '请先填写端点和模型名称',
  invalid_endpoint: () => '端点必须是 HTTPS 地址（本地调试地址除外）',
};

function classifyFailure(error: unknown): ConnectionProbeOutcome {
  if (error instanceof LlmRequestFailure) {
    const metric = error.requestMetrics[error.requestMetrics.length - 1];
    const message = error.message;
    // Transport-level facts first: a timeout message may legitimately contain
    // the word "思维链" (chain-of-thought hint), so never classify by text
    // before the recorded error category.
    if (metric?.errorCategory === 'timeout') return 'timeout';
    if (metric?.errorCategory === 'network') return 'network_error';
    if (metric?.errorCategory === 'invalid_response' || metric?.outcome === 'invalid_response') {
      return 'invalid_response';
    }
    if (/思考档位参数|reasoning_effort\/thinking/.test(message)) return 'reasoning_unsupported';
    if (metric?.completionState === 'reasoning_only' || /思维链|正文未完成|未产生正文/.test(message)) {
      return 'reasoning_only';
    }
    const status = metric?.httpStatus ?? null;
    if (status === 401 || status === 403) return 'unauthorized';
    if (status === 404) return 'not_found';
    if (status === 400) return 'bad_request';
    if (status === 429) return 'rate_limited';
    if (status !== null && status >= 500) return 'server_error';
    if (/非 ?JSON|non-JSON/i.test(message)) return 'invalid_response';
    if (/超时|timed out/i.test(message)) return 'timeout';
    return 'network_error';
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTPS/i.test(message)) return 'invalid_endpoint';
  return 'network_error';
}

/** Runs one real chat-completions round trip and classifies the outcome. */
export async function probeConnection(input: ConnectionProbeInput): Promise<ConnectionProbeResult> {
  const endpoint = input.endpoint.trim();
  const model = input.model.trim();
  if (!endpoint || !model) {
    return { ok: false, outcome: 'invalid_input', message: OUTCOME_MESSAGES.invalid_input(null), model, reasoningTier: input.reasoningTier, durationMs: null };
  }
  if (input.reasoningDialect === 'unsupported') {
    // Same refusal as the production pipeline: the configured endpoint
    // declares it does not accept reasoning parameters.
    return {
      ok: false, outcome: 'reasoning_unsupported',
      message: OUTCOME_MESSAGES.reasoning_unsupported(null),
      model, reasoningTier: input.reasoningTier, durationMs: null,
    };
  }

  let secrets: SecretStore;
  const formKey = input.apiKey?.trim() ?? '';
  if (formKey) {
    secrets = memorySecretStore(formKey);
  } else {
    const stored = await input.secretStore.get(input.keyRef).catch(() => null);
    if (!stored) {
      return { ok: false, outcome: 'missing_key', message: OUTCOME_MESSAGES.missing_key(null), model, reasoningTier: input.reasoningTier, durationMs: null };
    }
    secrets = input.secretStore;
  }

  const profile: ApiProfile = {
    id: 'probe',
    name: 'connection-probe',
    endpoint,
    model,
    keyRef: formKey ? 'probe' : input.keyRef,
    capabilities: { supportsJson: false, supportsStreaming: false, reportsUsage: true },
    reasoningTier: input.reasoningTier,
    // The 'unsupported' case already returned above; a concrete dialect is
    // set explicitly, otherwise the provider infers it from the model name.
    ...(input.reasoningDialect ? { reasoningDialect: input.reasoningDialect } : {}),
  };
  const provider = new OpenAICompatibleProvider(
    profile, secrets, input.transport,
    input.timeoutMs ?? 30_000,
    { maxPhysicalRequests: 1 },
  );

  const startedAt = Date.now();
  try {
    const response = await provider.complete({
      role: 'Summarizer',
      system: PROBE_SYSTEM,
      user: PROBE_USER,
      maxOutputTokens: input.maxOutputTokens ?? 2_048,
      reasoningTier: input.reasoningTier,
      maxPhysicalRequests: 1,
    });
    const metric = response.requestMetrics?.[response.requestMetrics.length - 1];
    const durationMs = metric?.durationMs ?? (Date.now() - startedAt);
    return {
      ok: true,
      outcome: 'success',
      message: OUTCOME_MESSAGES.success(durationMs),
      model,
      reasoningTier: input.reasoningTier,
      durationMs,
    };
  } catch (error) {
    if (error instanceof ReasoningDialectUnsupportedError) {
      return {
        ok: false, outcome: 'reasoning_unsupported',
        message: OUTCOME_MESSAGES.reasoning_unsupported(null),
        model, reasoningTier: input.reasoningTier, durationMs: null,
      };
    }
    const outcome = classifyFailure(error);
    let durationMs: number | null = null;
    if (error instanceof LlmRequestFailure) {
      const metric = error.requestMetrics[error.requestMetrics.length - 1];
      durationMs = metric?.durationMs ?? null;
    }
    return {
      ok: false,
      outcome,
      message: OUTCOME_MESSAGES[outcome](durationMs),
      model,
      reasoningTier: input.reasoningTier,
      durationMs,
    };
  }
}
