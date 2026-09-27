import type { HttpRequest, HttpResponse, HttpTransport } from './openAICompatible';

export type FaultKind = 'network' | 'http_500' | 'timeout' | 'malformed_body';

export interface FaultScript {
  /** Failures to inject before letting a request through; keyed by substring match on the body. */
  matchBodySubstring?: string;
  faults: FaultKind[];
}

export class FaultInjectionTransport implements HttpTransport {
  private readonly queues = new Map<FaultScript, { remaining: FaultKind[] }>();

  constructor(
    private readonly inner: HttpTransport,
    private readonly scripts: FaultScript[],
  ) {
    for (const script of scripts) {
      this.queues.set(script, { remaining: [...script.faults] });
    }
  }

  remainingFaults(): number {
    let total = 0;
    for (const queue of this.queues.values()) total += queue.remaining.length;
    return total;
  }

  async post(request: HttpRequest): Promise<HttpResponse> {
    for (const [script, queue] of this.queues.entries()) {
      if (queue.remaining.length === 0) continue;
      if (
        script.matchBodySubstring &&
        !request.body.includes(script.matchBodySubstring)
      ) {
        continue;
      }
      const fault = queue.remaining.shift();
      if (!fault) continue;
      switch (fault) {
        case 'network':
          throw new Error('simulated network failure');
        case 'timeout':
          throw new Error('LLM request timed out.');
        case 'http_500':
          return {
            status: 500,
            body: JSON.stringify({ error: { message: 'simulated server error' } }),
          };
        case 'malformed_body':
          return { status: 200, body: 'not-json-at-all' };
      }
    }
    return this.inner.post(request);
  }
}

export interface RetryPolicy {
  /** Total attempts per logical call; first try + (attempts-1) retries. */
  maxAttempts: number;
  backoffMs: (attempt: number) => number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: attempt => attempt * 250,
};

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // Network drops and 5xx are retryable; provider-side JSON/protocol errors
  // and timeouts are NOT (a timeout may have been billed server-side).
  return (
    message.includes('simulated network failure') ||
    /HTTP 5\d\d/.test(message) ||
    message.includes('simulated server error')
  );
}

export async function postWithRetry(
  transport: HttpTransport,
  request: HttpRequest,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<HttpResponse> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      const response = await transport.post(request);
      if (response.status >= 500 && attempt < policy.maxAttempts) {
        lastError = new Error(`LLM provider HTTP ${response.status}.`);
        await sleep(policy.backoffMs(attempt));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < policy.maxAttempts && isRetryable(error)) {
        await sleep(policy.backoffMs(attempt));
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Cancellation: wraps a promise with an AbortSignal-like handle so long LLM
 * calls can be abandoned without killing the turn store state.
 */
export class CancellationToken {
  private cancelled = false;

  cancel(): void {
    this.cancelled = true;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }
}

export async function withCancellation<T>(
  promise: Promise<T>,
  token: CancellationToken,
  onTimeoutMs?: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    if (onTimeoutMs === undefined) return;
    timer = setTimeout(() => reject(new Error('Operation cancelled by timeout.')), onTimeoutMs);
  });
  try {
    const guarded = promise.then(
      value => {
        if (token.isCancelled) throw new Error('Operation cancelled.');
        return value;
      },
      error => {
        if (token.isCancelled) throw new Error('Operation cancelled.');
        throw error;
      },
    );
    return await (onTimeoutMs !== undefined
      ? Promise.race([guarded, timeoutPromise])
      : guarded);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
