/** Return a safe message for thrown values that may come from native modules. */
export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string') return error.trim() || fallback;
  if (error instanceof Error) return error.message.trim() || fallback;
  return fallback;
}
