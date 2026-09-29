import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ApiProfile } from '../../src/application/llm/types';

const PROFILE_KEY = 'shineword.api.profile.v1';

/**
 * 1M-class model presets (resident-build plan §3/§1): DeepSeek V4.1 Flash
 * (non-thinking extraction, near-free prefix cache) and GLM-5.3-Flash
 * (thinking cannot be disabled; low effort + 2048 CoT reserve; Bailian
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
    label: 'DeepSeek V4.1 Flash（1M · 非思考抽取）',
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
      reasoningReserveTokens: 0,
      reasoningEffort: 'off',
      concurrency: 3,
    },
  },
  {
    id: 'glm-5.3-flash',
    label: 'GLM-5.3-Flash（1M · 思考不可关 · low）',
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
      reasoningReserveTokens: 2_048,
      reasoningEffort: 'low',
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
  const value = JSON.parse(raw) as ApiProfile;
  if (!value.id || !value.endpoint || !value.model || !value.keyRef) {
    throw new Error('Stored API profile is invalid.');
  }
  return value;
}

export async function saveApiProfile(input: {
  endpoint: string;
  model: string;
  /** Preset capabilities/reasoning/concurrency; custom when omitted. */
  presetId?: string;
}): Promise<ApiProfile> {
  const endpoint = input.endpoint.trim();
  const model = input.model.trim();
  if (!endpoint || !model) throw new Error('Endpoint and model are required.');

  const preset = presetById(input.presetId);
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
          contextWindow: 128_000,
          maxOutputTokens: 8_192,
        },
      }),
  };
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
}
