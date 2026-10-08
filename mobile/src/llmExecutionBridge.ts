import { NativeModules, Platform } from 'react-native';
import { HttpRequestNotSentError } from '../../src/application/llm/openAICompatible';
import type { HttpRequest } from '../../src/application/llm/openAICompatible';

interface ExecutionNative {
  acquire(token: string, timeoutMs: number): Promise<boolean>;
}

let sequence = 0;
const pending = new Map<string, { finished: Promise<void>; finish: () => void }>();

/** The headless task keeps RN timers alive; it never executes/replays a job. */
export async function llmRequestKeepAlive({ token }: { token: string }): Promise<void> {
  await pending.get(token)?.finished;
}

/** Protect the physical planning request through its complete body and timeout.
 * SQL job leases and the request ledger remain the sole execution authority. */
export async function acquireLlmExecution(request: HttpRequest): Promise<() => void> {
  if (Platform.OS !== 'android' || request.requestKind !== 'campaign_plan') return () => {};
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 1_200_000) {
    throw executionUnavailable();
  }
  return acquireExecution(request.timeoutMs);
}

/** Covers the two bounded physical attempts plus queueing and local commit.
 * The native task only keeps this caller alive; it cannot execute a job. */
export async function acquirePlanningExecution(): Promise<() => void> {
  if (Platform.OS !== 'android') return () => {};
  return acquireExecution(2_700_000);
}

function executionUnavailable(): HttpRequestNotSentError {
  return new HttpRequestNotSentError('无法启动冒险规划的后台执行保护；本次请求尚未发送，请返回应用后重试。');
}

async function acquireExecution(timeoutMs: number): Promise<() => void> {
  const native = NativeModules.LlmRequestExecution as ExecutionNative | undefined;
  if (!native) throw executionUnavailable();
  const token = `llm-${Date.now().toString(36)}-${++sequence}`;
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  pending.set(token, { finished, finish });
  const release = () => { pending.get(token)?.finish(); pending.delete(token); };
  try {
    if (!await native.acquire(token, timeoutMs)) throw Error('Execution protection unavailable');
    return release;
  } catch {
    release();
    throw executionUnavailable();
  }
}
