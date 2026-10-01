import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ApiProfile, ReasoningDialect, ReasoningTier, SecretStore } from '../../src/application/llm/types';
import { normalizeStoredApiProfile } from '../../src/application/llm/profileMigration';

const PROFILE_KEY = 'shineword.api.profile.v1';

/**
 * 1M-class presets start at the lowest product reasoning tier. The unified
 * policy and request budget kernel choose per-request reserve/output grants.
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
    // Official display name != wire ID. Verified 2026-09-30:
    // https://api-docs.deepseek.com/api/list-models/
    // https://api-docs.deepseek.com/api/create-chat-completion/
    model: 'deepseek-flash',
    profile: {
      capabilities: {
        supportsJson: true,
        supportsStreaming: false,
        reportsUsage: true,
        contextWindow: 1_048_576,
        maxOutputTokens: 393_216,
        supportsPromptCache: true,
      },
      contentOutputTokens: 16_384,
      reasoningTier: 'low',
      reasoningDialect: 'deepseek',
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

export interface SaveApiProfileInput {
  endpoint: string;
  model: string;
  reasoningTier: ReasoningTier;
  /** Preset capabilities/reasoning/concurrency; custom when omitted. */
  presetId?: string;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  reasoningDialect?: ReasoningDialect;
}

function buildApiProfile(input: SaveApiProfileInput): ApiProfile {
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
  return profile;
}

export async function saveApiProfile(input: SaveApiProfileInput): Promise<ApiProfile> {
  const profile = buildApiProfile(input);
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
}

/** Publish the profile only after its Keychain credential is available. */
export async function saveConfiguredApiProfile(
  input: SaveApiProfileInput,
  apiKey: string,
  secrets: SecretStore,
): Promise<ApiProfile> {
  const profile = buildApiProfile(input);
  const trimmedKey = apiKey.trim();
  if (trimmedKey) {
    await secrets.set(profile.keyRef, trimmedKey);
  } else if (!await secrets.get(profile.keyRef)) {
    throw new Error('请输入 API Key（将只写入系统 Keychain）。');
  }
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
}
