import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ApiProfile, ReasoningDialect, ReasoningTier, SecretStore } from '../../src/application/llm/types';
import { normalizeStoredApiProfile } from '../../src/application/llm/profileMigration';

const PROFILE_KEY = 'shineword.api.profile.v1';
const PROFILES_KEY = 'shineword.api.profiles.v2';

interface ApiProfileCollection {
  activeId: string | null;
  profiles: ApiProfile[];
}

async function loadCollection(): Promise<ApiProfileCollection> {
  const raw = await AsyncStorage.getItem(PROFILES_KEY);
  if (raw) {
    const stored = JSON.parse(raw) as ApiProfileCollection;
    return { activeId: stored.activeId, profiles: stored.profiles.map(normalizeStoredApiProfile) };
  }
  const legacy = await AsyncStorage.getItem(PROFILE_KEY);
  if (!legacy) return { activeId: null, profiles: [] };
  const profile = normalizeStoredApiProfile(JSON.parse(legacy));
  const collection = { activeId: profile.id, profiles: [profile] };
  await persistCollection(collection);
  return collection;
}

async function persistCollection(collection: ApiProfileCollection): Promise<void> {
  await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(collection));
  // Keep the legacy active-profile mirror for older readers; v2 owns selection.
  const active = collection.profiles.find(profile => profile.id === collection.activeId);
  if (active) await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(active));
}

export async function listApiProfiles(): Promise<ApiProfile[]> {
  return (await loadCollection()).profiles;
}

export async function selectApiProfile(id: string): Promise<ApiProfile> {
  const collection = await loadCollection();
  const profile = collection.profiles.find(item => item.id === id);
  if (!profile) throw new Error('这条 API 配置已不存在，请刷新后重试。');
  await persistCollection({ ...collection, activeId: id });
  return profile;
}

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
  const collection = await loadCollection();
  return collection.profiles.find(profile => profile.id === collection.activeId) ?? null;
}

export interface SaveApiProfileInput {
  /** null explicitly creates a record, including another account at the same endpoint. */
  id?: string | null;
  name?: string;
  endpoint: string;
  model: string;
  reasoningTier: ReasoningTier;
  /** Preset capabilities/reasoning/concurrency; custom when omitted. */
  presetId?: string;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  reasoningDialect?: ReasoningDialect;
}

function buildApiProfile(input: SaveApiProfileInput, existing?: ApiProfile, isFirst = true): ApiProfile {
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
    id: existing?.id ?? (isFirst ? 'default' : `api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`),
    name: input.name?.trim() || (preset ? preset.label : model),
    endpoint,
    model,
    keyRef: existing?.keyRef ?? '',
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
  profile.keyRef ||= profile.id === 'default' ? 'llm.default' : `llm.${profile.id}`;
  return profile;
}

async function prepareProfile(input: SaveApiProfileInput): Promise<{ profile: ApiProfile; collection: ApiProfileCollection }> {
  const collection = await loadCollection();
  const existing = input.id
    ? collection.profiles.find(profile => profile.id === input.id)
    : input.id === null ? undefined
      : collection.profiles.find(profile => profile.endpoint === input.endpoint.trim() && profile.model === input.model.trim());
  if (input.id && !existing) throw new Error('这条 API 配置已不存在，请重新添加。');
  return { collection, profile: buildApiProfile(input, existing, collection.profiles.length === 0) };
}

async function publishProfile(profile: ApiProfile, collection: ApiProfileCollection): Promise<void> {
  const profiles = collection.profiles.filter(item => item.id !== profile.id);
  profiles.push(profile);
  await persistCollection({ activeId: profile.id, profiles });
}

export async function saveApiProfile(input: SaveApiProfileInput): Promise<ApiProfile> {
  const { profile, collection } = await prepareProfile(input);
  await publishProfile(profile, collection);
  return profile;
}

/** Publish the profile only after its Keychain credential is available. */
export async function saveConfiguredApiProfile(
  input: SaveApiProfileInput,
  apiKey: string,
  secrets: SecretStore,
): Promise<ApiProfile> {
  const { profile, collection } = await prepareProfile(input);
  const trimmedKey = apiKey.trim();
  if (trimmedKey) {
    await secrets.set(profile.keyRef, trimmedKey);
  } else if (!await secrets.get(profile.keyRef)) {
    throw new Error('请输入 API Key（将只写入系统 Keychain）。');
  }
  await publishProfile(profile, collection);
  return profile;
}
