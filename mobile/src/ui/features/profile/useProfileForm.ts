/**
 * useProfileForm — the shared model-endpoint form state for the settings tab
 * and the first-run screen.
 *
 * Resident build (plan P5): adds the 1M preset selector. Choosing a preset
 * pre-fills the model name and stores its capabilities/reasoning/concurrency
 * profile; the persistence path and the Keychain-only secret handling are
 * unchanged (the key is never echoed back into the form after saving).
 */
import { useState } from 'react';
import { MODEL_PRESETS, saveApiProfile } from '../../../profileStore';
import { KeychainSecretStore } from '../../../secureKeyStore';
import { useAppSession } from '../../state/AppSessionContext';

export interface ProfileFormState {
  endpoint: string;
  model: string;
  apiKey: string;
  presetId: string | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  setEndpoint: (value: string) => void;
  setModel: (value: string) => void;
  setApiKey: (value: string) => void;
  choosePreset: (presetId: string) => void;
  clearPreset: () => void;
  submit: (onSaved: () => void) => void;
}

export function useProfileForm(): ProfileFormState {
  const { profile, setProfile } = useAppSession();
  const [endpoint, setEndpoint] = useState(profile?.endpoint ?? '');
  const [model, setModel] = useState(profile?.model ?? '');
  const [apiKey, setApiKey] = useState('');
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
  }

  function clearPreset(): void {
    setPresetId(null);
  }

  function submit(onSaved: () => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    void (async () => {
      try {
        const saved = await saveApiProfile({ endpoint, model, presetId: presetId ?? undefined });
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
    endpoint, model, apiKey, presetId, busy, error, notice,
    setEndpoint, setModel, setApiKey, choosePreset, clearPreset, submit,
  };
}
