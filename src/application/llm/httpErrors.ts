/** Only the transport's own elapsed deadline may produce this marker.
 * A response abort, socket reset or user cancellation proves no duration. */
export class HttpRequestTimeoutError extends Error {
  readonly code = 'LLM_HTTP_DEADLINE_EXCEEDED';
  constructor(readonly timeoutMs: number, readonly deadlineKind: 'absolute' | 'sse_idle' = 'absolute') {
    super(deadlineKind === 'sse_idle' ? 'LLM SSE stream had no complete event before its activity deadline.' : 'LLM request timed out.');
    this.name = 'HttpRequestTimeoutError';
  }
}

/** The structured contract also works across transport/module boundaries. */
export function elapsedHttpDeadline(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const value = error as { code?: unknown; timeoutMs?: unknown };
  return value.code === 'LLM_HTTP_DEADLINE_EXCEEDED'
    && typeof value.timeoutMs === 'number' && Number.isSafeInteger(value.timeoutMs) && value.timeoutMs > 0
    ? value.timeoutMs : null;
}
