/**
 * Shared conservative token estimate (plan §72): CJK code points cost ~1
 * token each, everything else ~0.3. Same formula as the world-build planner
 * and episodic packing so budgets stay comparable; always recorded as
 * `estimated`, never confused with provider usage.
 */

export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0x3400 && code <= 0x9fff) cjk += 1;
    else other += 1;
  }
  return cjk + Math.floor(other * 0.3);
}

/** Clips text to approximately `budgetTokens` at a sentence boundary. */
export function clipTextToTokens(text: string, budgetTokens: number): string {
  if (budgetTokens <= 0) return '';
  const maxCjk = budgetTokens; // worst case: all CJK
  if (text.length <= maxCjk * 1.2) {
    if (estimateTokens(text) <= budgetTokens) return text;
  }
  const sliced = text.slice(0, Math.max(1, maxCjk));
  const lastBreak = Math.max(
    sliced.lastIndexOf('。'),
    sliced.lastIndexOf('；'),
    sliced.lastIndexOf('！'),
    sliced.lastIndexOf('？'),
    sliced.lastIndexOf('\n'),
    sliced.lastIndexOf('.'),
  );
  const clipped = lastBreak > 0 ? sliced.slice(0, lastBreak + 1) : sliced;
  return estimateTokens(clipped) <= budgetTokens ? clipped : clipped.slice(0, Math.floor(clipped.length * 0.8));
}
