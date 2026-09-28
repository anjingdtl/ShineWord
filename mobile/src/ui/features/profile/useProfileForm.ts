/**
 * useProfileForm — the shared model-endpoint form state for the settings tab
 * and the first-run screen.
 *
 * P3.4 only moves this hook out of the screen file: the persistence path is
 * untouched (same `saveApiProfile`, same Keychain-only secret, the key is
 * never echoed back into the form after saving).
 */
import { useState } from 'react';
import { saveApiProfile } from '../../../profileStore';
import { KeychainSecretStore } from '../../../secureKeyStore';
import { useAppSession } from '../../state/AppSessionContext';

export interface ProfileFormState {
  endpoint: string;
  model: string;
  apiKey: string;
  busy: boolean;
  error: string | null;
  notice: string | null;
  setEndpoint: (value: string) => void;
  setModel: (value: string) => void;
  setApiKey: (value: string) => void;
  submit: (onSaved: () => void) => void;
}

export function useProfileForm(): ProfileFormState {
  const { profile, setProfile } = useAppSession();
  const [endpoint, setEndpoint] = useState(profile?.endpoint ?? '');
  const [model, setModel] = useState(profile?.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function submit(onSaved: () => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    void (async () => {
      try {
        const saved = await saveApiProfile({ endpoint, model });
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

  return { endpoint, model, apiKey, busy, error, notice, setEndpoint, setModel, setApiKey, submit };
}