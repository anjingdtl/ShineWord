/**
 * useProfileForm — the shared model-endpoint form state for the settings tab
 * and the first-run screen.
 *
 * Resident build (plan P5): adds the 1M preset selector. Choosing a preset
 * pre-fills the model name and stores its capabilities. Reasoning tier is
 * selected explicitly, while the v1 profile key and Keychain-only secret
 * handling remain stable (the key is never echoed back after saving).
 */
import { useState } from 'react';
import { MODEL_PRESETS, saveApiProfile } from '../../../profileStore';
import { normalizeReasoningTier, type ReasoningTier } from '../../../../../src/application/llm/types';
import { KeychainSecretStore } from '../../../secureKeyStore';
import { useAppSession } from '../../state/AppSessionContext';

export interface ProfileFormState {
  endpoint: string;
  model: string;
  apiKey: string;
  presetId: string | null;
  reasoningTier: ReasoningTier;
  contextWindowTokens: string;
  maxOutputTokens: string;
  reasoningParameterSupport: 'automatic' | 'unsupported';
  busy: boolean;
  error: string | null;
  notice: string | null;
  setEndpoint: (value: string) => void;
  setModel: (value: string) => void;
  setApiKey: (value: string) => void;
  setReasoningTier: (value: ReasoningTier) => void;
  setContextWindowTokens: (value: string) => void;
  setMaxOutputTokens: (value: string) => void;
  setReasoningParameterSupport: (value: 'automatic' | 'unsupported') => void;
  choosePreset: (presetId: string) => void;
  clearPreset: () => void;
  submit: (onSaved: () => void) => void;
}

export function useProfileForm(): ProfileFormState {
  const { profile, setProfile } = useAppSession();
  const [endpoint, setEndpoint] = useState(profile?.endpoint ?? '');
  const [model, setModel] = useState(profile?.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [reasoningTier, setReasoningTier] = useState<ReasoningTier>(
    normalizeReasoningTier(profile?.reasoningTier ?? profile?.reasoningEffort),
  );
  const [contextWindowTokens, setContextWindowTokens] = useState(
    profile?.capabilities?.contextWindow?.toString() ?? '',
  );
  const [maxOutputTokens, setMaxOutputTokens] = useState(
    profile?.capabilities?.maxOutputTokens?.toString() ?? '',
  );
  const [reasoningParameterSupport, setReasoningParameterSupport] = useState<'automatic' | 'unsupported'>(
    profile?.reasoningDialect === 'unsupported' ? 'unsupported' : 'automatic',
  );
  const [presetId, setPresetId] = useState<string | null>(
    profile?.capabilities?.contextWindow === 1_048_576
      ? MODEL_PRESETS.find(p => p.model === profile?.model)?.id ?? null
      : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function choosePreset(id: string): void {
    const preset = MODEL_PRESETS.find(item => item.id === id);
    if (!preset) return;
    setPresetId(preset.id);
    setModel(preset.model);
    setContextWindowTokens(preset.profile.capabilities.contextWindow?.toString() ?? '');
    setMaxOutputTokens(preset.profile.capabilities.maxOutputTokens?.toString() ?? '');
  }

  function clearPreset(): void {
    setPresetId(null);
    setContextWindowTokens('');
    setMaxOutputTokens('');
  }

  function updateModel(value: string): void {
    setModel(value);
    if (presetId) {
      const preset = MODEL_PRESETS.find(item => item.id === presetId);
      if (preset && value.trim() !== preset.model) {
        setPresetId(null);
        setContextWindowTokens('');
        setMaxOutputTokens('');
      }
    }
  }

  function parseOptionalPositiveInteger(value: string, label: string): number | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new Error(`${label}必须是大于 0 的整数，留空表示未知。`);
    }
    return parsed;
  }

  function submit(onSaved: () => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    void (async () => {
      try {
        const saved = await saveApiProfile({
          endpoint,
          model,
          presetId: presetId ?? undefined,
          reasoningTier,
          contextWindowTokens: parseOptionalPositiveInteger(contextWindowTokens, '上下文窗口'),
          maxOutputTokens: parseOptionalPositiveInteger(maxOutputTokens, '最大输出 Token'),
          reasoningDialect: reasoningParameterSupport === 'unsupported' ? 'unsupported' : undefined,
        });
        const trimmedKey = apiKey.trim();
        const keyStore = new KeychainSecretStore();
        if (trimmedKey) {
          await keyStore.set(saved.keyRef, trimmedKey);
          setApiKey('');
        } else {
          const existing = await keyStore.get(saved.keyRef);
          if (!existing) throw new Error('请输入 API Key（将只写入系统 Keychain）。');
        }
        setProfile(saved);
        setNotice('已保存。密钥只存放在系统 Keychain 中。');
        onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  }

  return {
    endpoint, model, apiKey, presetId, reasoningTier, contextWindowTokens, maxOutputTokens,
    reasoningParameterSupport, busy, error, notice,
    setEndpoint, setModel: updateModel, setApiKey, setReasoningTier, setContextWindowTokens,
    setMaxOutputTokens, setReasoningParameterSupport, choosePreset, clearPreset, submit,
  };
}
