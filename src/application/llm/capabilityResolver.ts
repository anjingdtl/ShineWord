/**
 * Capability resolution with source precedence (infrastructure plan §7).
 *
 *   user_declared > provider_documented > provider_probe > unknown
 *
 * Hard rules:
 *   - unknown is never coerced into a number (the kernel fails closed);
 *   - a derived runtime value is marked 'derived' and never written back to
 *     the user profile;
 *   - probes cannot discover the true context window, so probe evidence for
 *     it is structurally absent.
 */

import type { CapabilitySource, FrozenModelCapabilities } from './requestPlan';

export interface CapabilityEvidence {
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  supportsJsonMode?: boolean;
  reportsUsage?: boolean;
  supportsPromptCache?: boolean;
  reasoningUsageReported?: boolean;
}

export interface CapabilityResolutionInput {
  /** User profile declarations (presets / manual settings). */
  declared?: CapabilityEvidence;
  /** Provider documentation table lookups. */
  documented?: CapabilityEvidence;
  /** Live probe results. */
  probed?: CapabilityEvidence;
  reasoningMode?: FrozenModelCapabilities['reasoningMode'];
}

interface Resolved<T> {
  value: T | null;
  source: CapabilitySource;
}

function resolveNumber(
  sources: Array<{ source: CapabilitySource; evidence: CapabilityEvidence | undefined; key: 'contextWindowTokens' | 'maxOutputTokens' }>,
): Resolved<number> {
  for (const { source, evidence, key } of sources) {
    const raw = evidence?.[key];
    if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) {
      return { value: raw, source };
    }
  }
  return { value: null, source: 'unknown' };
}

function resolveBoolean(
  sources: Array<{ source: CapabilitySource; evidence: CapabilityEvidence | undefined; key: 'supportsJsonMode' | 'reportsUsage' | 'supportsPromptCache' | 'reasoningUsageReported' }>,
): boolean {
  // Declared profile settings win; absent that, probe evidence is the only
  // trustworthy signal (documentation is optimistic by nature).
  const declared = sources.find(item => item.source === 'user_declared');
  if (typeof declared?.evidence?.[declared.key] === 'boolean') {
    return declared.evidence[declared.key] as boolean;
  }
  const probed = sources.find(item => item.source === 'provider_probe');
  if (typeof probed?.evidence?.[probed.key] === 'boolean') {
    return probed.evidence[probed.key] as boolean;
  }
  return false;
}

export function resolveModelCapabilities(input: CapabilityResolutionInput): FrozenModelCapabilities {
  const ordered = [
    { source: 'user_declared' as const, evidence: input.declared },
    { source: 'provider_documented' as const, evidence: input.documented },
    { source: 'provider_probe' as const, evidence: input.probed },
  ];

  const contextWindow = resolveNumber(
    ordered.map(item => ({ ...item, key: 'contextWindowTokens' as const })),
  );
  const maxOutput = resolveNumber(
    ordered.map(item => ({ ...item, key: 'maxOutputTokens' as const })),
  );

  return {
    contextWindowTokens: contextWindow.value,
    contextWindowSource: contextWindow.source,
    maxOutputTokens: maxOutput.value,
    maxOutputSource: maxOutput.source,
    reportsUsage: resolveBoolean(
      ordered.map(item => ({ ...item, key: 'reportsUsage' as const })),
    ),
    supportsJsonMode: resolveBoolean(
      ordered.map(item => ({ ...item, key: 'supportsJsonMode' as const })),
    ),
    supportsPromptCache: resolveBoolean(
      ordered.map(item => ({ ...item, key: 'supportsPromptCache' as const })),
    ),
    reasoningMode: input.reasoningMode ?? 'unknown',
    reasoningUsageReported: resolveBoolean(
      ordered.map(item => ({ ...item, key: 'reasoningUsageReported' as const })),
    ),
  };
}

/**
 * Runtime-safe output ceiling when nobody declared one (plan §7 rule 2):
 * a quarter of the context window clamped into [1024, 16384]. The value is
 * derived, never persisted, and never overwrites a declared capability.
 */
export function deriveMaxOutputTokens(contextWindowTokens: number): number {
  if (!Number.isInteger(contextWindowTokens) || contextWindowTokens <= 0) {
    throw new Error('deriveMaxOutputTokens requires a positive integer context window.');
  }
  return Math.min(16_384, Math.max(1_024, Math.floor(contextWindowTokens / 4)));
}
