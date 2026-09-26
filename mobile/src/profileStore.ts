import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ApiProfile } from '../../src/application/llm/types';

const PROFILE_KEY = 'shineword.api.profile.v1';

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
}): Promise<ApiProfile> {
  const endpoint = input.endpoint.trim();
  const model = input.model.trim();
  if (!endpoint || !model) throw new Error('Endpoint and model are required.');

  const profile: ApiProfile = {
    id: 'default',
    name: 'Default',
    endpoint,
    model,
    keyRef: 'llm.default',
    capabilities: {
      supportsJson: true,
      supportsStreaming: false,
      reportsUsage: true,
      contextWindow: 128000,
      maxOutputTokens: 8192,
    },
  };
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
}
