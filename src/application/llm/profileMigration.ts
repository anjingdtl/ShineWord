import { normalizeReasoningTier, type ApiProfile, type ReasoningDialect } from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveIntegerOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function reasoningDialectOrUndefined(value: unknown): ReasoningDialect | undefined {
  return value === 'deepseek' || value === 'glm' || value === 'generic' || value === 'unsupported'
    ? value
    : undefined;
}

/** Normalize persisted v1 profiles without touching endpoint/model/keyRef or secrets. */
export function normalizeStoredApiProfile(value: unknown): ApiProfile {
  const raw = asRecord(value);
  if (!raw) throw new Error('Stored API profile is invalid.');
  if (typeof raw.id !== 'string' || !raw.id
    || typeof raw.name !== 'string'
    || typeof raw.endpoint !== 'string' || !raw.endpoint
    || typeof raw.model !== 'string' || !raw.model
    || typeof raw.keyRef !== 'string' || !raw.keyRef) {
    throw new Error('Stored API profile is invalid.');
  }

  const rawCapabilities = asRecord(raw.capabilities);
  if (!rawCapabilities) throw new Error('Stored API profile capabilities are invalid.');
  let contextWindow = positiveIntegerOrUndefined(rawCapabilities.contextWindow);
  let maxOutputTokens = positiveIntegerOrUndefined(rawCapabilities.maxOutputTokens);

  // V1 custom profiles had no capability inputs and always wrote this exact
  // synthetic pair. Drop it when the profile was not one of the named presets.
  // Older preset values and any other explicit positive values are preserved.
  const wasSyntheticCustomCapability = raw.name === 'Default'
    && contextWindow === 128_000
    && maxOutputTokens === 8_192;
  if (wasSyntheticCustomCapability) {
    contextWindow = undefined;
    maxOutputTokens = undefined;
  }

  const capabilities: ApiProfile['capabilities'] = {
    supportsJson: rawCapabilities.supportsJson === true,
    supportsStreaming: rawCapabilities.supportsStreaming === true,
    reportsUsage: rawCapabilities.reportsUsage === true,
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(typeof rawCapabilities.supportsPromptCache === 'boolean'
      ? { supportsPromptCache: rawCapabilities.supportsPromptCache }
      : {}),
  };
  const reasoningTier = normalizeReasoningTier(raw.reasoningTier ?? raw.reasoningEffort);
  const reasoningDialect = reasoningDialectOrUndefined(raw.reasoningDialect);

  const normalized: ApiProfile = {
    id: raw.id,
    name: raw.name,
    endpoint: raw.endpoint,
    model: raw.model,
    keyRef: raw.keyRef,
    capabilities,
    reasoningTier,
    ...(reasoningDialect ? { reasoningDialect } : {}),
    ...(typeof raw.contentOutputTokens === 'number' ? { contentOutputTokens: raw.contentOutputTokens } : {}),
    ...(typeof raw.reasoningReserveTokens === 'number' ? { reasoningReserveTokens: raw.reasoningReserveTokens } : {}),
    ...(typeof raw.concurrency === 'number' ? { concurrency: raw.concurrency } : {}),
    ...(typeof raw.tpm === 'number' ? { tpm: raw.tpm } : {}),
    ...(typeof raw.rpm === 'number' ? { rpm: raw.rpm } : {}),
    ...(typeof raw.inputPricePerMillion === 'number' ? { inputPricePerMillion: raw.inputPricePerMillion } : {}),
    ...(typeof raw.outputPricePerMillion === 'number' ? { outputPricePerMillion: raw.outputPricePerMillion } : {}),
  };
  return normalized;
}
