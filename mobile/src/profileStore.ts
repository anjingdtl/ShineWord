import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ApiProfile, ReasoningDialect, ReasoningTier } from '../../src/application/llm/types';
import { normalizeStoredApiProfile } from '../../src/application/llm/profileMigration';

const PROFILE_KEY = 'shineword.api.profile.v1';

/**
 * 1M-class model presets (resident-build plan §3/§1): DeepSeek V4.1 Flash
 * and GLM-5.3-Flash. Both start at the user's lowest selectable reasoning tier;
 * the unified policy chooses per-request reserve values.
 * TPM 3M). Context window 1,048,576; content output 16,384/request.
 * Probes may still override cache/ceiling findings at runtime.
 */
export interface ModelPreset {
  id: string;
  label: string;
  model: string;
  profile: Omit<ApiProfile, 'id' | 'name' | 'endpoint' | 'keyRef' | 'model'>;
}

export const MODEL_PRESETS: readonly ModelPreset[] = [
  {
    id: 'deepseek-v4.1-flash',
    label: 'DeepSeek V4.1 Flash（1M）',
    model: 'DeepSeek-V4.1-Flash',
    profile: {
      capabilities: {
        supportsJson: true,
        supportsStreaming: false,
        reportsUsage: true,
        contextWindow: 1_048_576,
        // Conservative gateway ceiling; the official API allows 393,216.
        maxOutputTokens: 131_072,
        supportsPromptCache: true,
      },
      contentOutputTokens: 16_384,
      reasoningTier: 'low',
      concurrency: 3,
    },
  },
  {
    id: 'glm-5.3-flash',
    label: 'GLM-5.3-Flash（1M）',
    model: 'glm-5.3-flash',
    profile: {
      capabilities: {
        supportsJson: true,
        supportsStreaming: false,
        reportsUsage: true,
        contextWindow: 1_048_576,
        maxOutputTokens: 131_072,
        supportsPromptCache: true,
      },
      contentOutputTokens: 16_384,
      reasoningTier: 'low',
      concurrency: 3,
      tpm: 3_000_000,
    },
  },
];

export function presetById(presetId: string | undefined): ModelPreset | null {
  if (!presetId) return null;
  return MODEL_PRESETS.find(preset => preset.id === presetId) ?? null;
}

export async function loadApiProfile(): Promise<ApiProfile | null> {
  const raw = await AsyncStorage.getItem(PROFILE_KEY);
  if (!raw) return null;
  const profile = normalizeStoredApiProfile(JSON.parse(raw));
  const normalized = JSON.stringify(profile);
  if (raw !== normalized) await AsyncStorage.setItem(PROFILE_KEY, normalized);
  return profile;
}

export async function saveApiProfile(input: {
  endpoint: string;
  model: string;
  reasoningTier: ReasoningTier;
  /** Preset capabilities/reasoning/concurrency; custom when omitted. */
  presetId?: string;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  reasoningDialect?: ReasoningDialect;
}): Promise<ApiProfile> {
  const endpoint = input.endpoint.trim();
  const model = input.model.trim();
  if (!endpoint || !model) throw new Error('Endpoint and model are required.');
  if (input.reasoningTier !== 'low' && input.reasoningTier !== 'high' && input.reasoningTier !== 'max') {
    throw new Error('A supported reasoning tier (low, high, max) must be selected before saving.');
  }
  if (input.reasoningDialect !== undefined
    && input.reasoningDialect !== 'deepseek' && input.reasoningDialect !== 'glm'
    && input.reasoningDialect !== 'generic' && input.reasoningDialect !== 'unsupported') {
    throw new Error('The reasoning parameter protocol is invalid.');
  }

  const preset = presetById(input.presetId);
  for (const [label, value] of [
    ['上下文窗口', input.contextWindowTokens],
    ['最大输出 Token', input.maxOutputTokens],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new Error(`${label}必须是大于 0 的整数，留空表示未知。`);
    }
  }
  const profile: ApiProfile = {
    id: 'default',
    name: preset ? preset.label : 'Default',
    endpoint,
    model,
    keyRef: 'llm.default',
    ...(preset
      ? preset.profile
      : {
        capabilities: {
          supportsJson: true,
          supportsStreaming: false,
          reportsUsage: true,
          ...(input.contextWindowTokens === undefined ? {} : { contextWindow: input.contextWindowTokens }),
          ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
        },
      }),
    reasoningTier: input.reasoningTier,
    ...(input.reasoningDialect ? { reasoningDialect: input.reasoningDialect } : {}),
  };
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
}
