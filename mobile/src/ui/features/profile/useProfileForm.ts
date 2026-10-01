/**
 * useProfileForm — the shared model-endpoint form state for the settings tab
 * and the first-run screen.
 *
 * Resident build (plan P5): adds the 1M preset selector. Choosing a preset
 * pre-fills the model name and stores its capabilities. Reasoning tier is
 * selected explicitly, while the v1 profile key and Keychain-only secret
 * handling remain stable (the key is never echoed back after saving).
 *
 * Real-device P0-3: adds a "测试连接" action that runs the production
 * OpenAI-compatible pipeline with the CURRENT form values (an unsaved API
 * key stays in memory for the probe only), so users can verify
 * endpoint/key/model/reasoning compatibility before saving.
 */
import { useState } from 'react';
import { MODEL_PRESETS, saveConfiguredApiProfile } from '../../../profileStore';
import { normalizeReasoningTier, type ReasoningTier } from '../../../../../src/application/llm/types';
import { KeychainSecretStore } from '../../../secureKeyStore';
import { FetchHttpTransport } from '../../../fetchTransport';
import { probeConnection, type ConnectionProbeResult } from '../../../connectionProbe';
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
  probeBusy: boolean;
  probeResult: ConnectionProbeResult | null;
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
  testConnection: () => void;
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
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeResult, setProbeResult] = useState<ConnectionProbeResult | null>(null);

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
        const saved = await saveConfiguredApiProfile({
          endpoint,
          model,
          presetId: presetId ?? undefined,
          reasoningTier,
          contextWindowTokens: parseOptionalPositiveInteger(contextWindowTokens, '上下文窗口'),
          maxOutputTokens: parseOptionalPositiveInteger(maxOutputTokens, '最大输出 Token'),
          reasoningDialect: reasoningParameterSupport === 'unsupported' ? 'unsupported' : undefined,
        }, apiKey, new KeychainSecretStore());
        setApiKey('');
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

  /**
   * Verifies the CURRENT form values with one real chat-completions request.
   * An unsaved API key is used from memory only; when the field is empty the
   * already-saved Keychain key is tried. The key never reaches the result,
   * storage or logs.
   */
  function testConnection() {
    if (probeBusy) return;
    setProbeBusy(true);
    setProbeResult(null);
    void (async () => {
      try {
        const preset = MODEL_PRESETS.find(item => item.id === presetId) ?? null;
        const result = await probeConnection({
          endpoint,
          model,
          reasoningTier,
          reasoningDialect: reasoningParameterSupport === 'unsupported'
            ? 'unsupported'
            : preset?.profile.reasoningDialect,
          apiKey: apiKey.trim() || null,
          keyRef: 'llm.default',
          secretStore: new KeychainSecretStore(),
          transport: new FetchHttpTransport(),
        });
        setProbeResult(result);
      } catch (e) {
        // The probe classifies its own failures; a throw here means local
        // wiring broke - still surfaced honestly, still secret-free.
        setProbeResult({
          ok: false,
          outcome: 'network_error',
          message: e instanceof Error ? e.message : String(e),
          model: model.trim(),
          reasoningTier,
          durationMs: null,
        });
      } finally {
        setProbeBusy(false);
      }
    })();
  }

  return {
    endpoint, model, apiKey, presetId, reasoningTier, contextWindowTokens, maxOutputTokens,
    reasoningParameterSupport, busy, error, notice, probeBusy, probeResult,
    setEndpoint, setModel: updateModel, setApiKey, setReasoningTier, setContextWindowTokens,
    setMaxOutputTokens, setReasoningParameterSupport, choosePreset, clearPreset, submit, testConnection,
  };
}
