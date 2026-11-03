import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, FALLBACK_MODELS, type ModelOption, type Settings } from '@/types';
import { deleteApiKey, getApiKey, getSettings, onApiKeyChanged, onSettingsChanged, saveSettings, setApiKey } from '@/storage/settingsStore';
import { ClaudeProvider } from '@/services/claude/provider';
import { ClaudeError } from '@/services/claude/errors';
import { maskApiKey } from '@/utils/logger';
import { nowIso } from '@/utils/dates';

export interface KeyStatus {
  tone: 'success' | 'critical' | 'info' | 'warning';
  text: string;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [masked, setMasked] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [busy, setBusy] = useState<null | 'test' | 'models' | 'save'>(null);

  const refreshKey = useCallback(async () => {
    const k = await getApiKey();
    setHasKey(Boolean(k));
    setMasked(maskApiKey(k));
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await getSettings();
      if (!alive) return;
      setSettings(s);
      await refreshKey();
      setLoaded(true);
    })();
    const off1 = onSettingsChanged((s) => alive && setSettings(s));
    const off2 = onApiKeyChanged(() => void refreshKey());
    return () => {
      alive = false;
      off1();
      off2();
    };
  }, [refreshKey]);

  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    await saveSettings(patch);
  }, []);

  const saveKey = useCallback(async (key: string) => {
    const k = key.trim();
    if (!/^sk-ant-/.test(k)) {
      setKeyStatus({ tone: 'warning', text: 'That doesn’t look like an Anthropic API key (they start with “sk-ant-”). It was not saved.' });
      return false;
    }
    setBusy('save');
    try {
      await setApiKey(k);
      await refreshKey();
      setKeyStatus({ tone: 'info', text: 'Key saved on this device only. Use “Test API key” to confirm it works with the selected model.' });
      return true;
    } finally {
      setBusy(null);
    }
  }, [refreshKey]);

  const removeKey = useCallback(async () => {
    await deleteApiKey();
    await refreshKey();
    setKeyStatus({ tone: 'info', text: 'API key deleted from this browser. ApplyFlow will use the local engine until you add a key.' });
  }, [refreshKey]);

  const testKey = useCallback(async () => {
    setBusy('test');
    setKeyStatus(null);
    try {
      const key = await getApiKey();
      const s = await getSettings();
      const p = new ClaudeProvider(key, s);
      const r = await p.testConnection();
      setKeyStatus({ tone: 'success', text: `Connected. ${r.model} answered in ${(r.latencyMs / 1000).toFixed(1)} s.` });
    } catch (e: unknown) {
      setKeyStatus({ tone: 'critical', text: e instanceof ClaudeError ? e.userMessage : 'Your API key could not be verified. Check the key and selected model.' });
    } finally {
      setBusy(null);
    }
  }, []);

  const refreshModels = useCallback(async () => {
    setBusy('models');
    try {
      const key = await getApiKey();
      const s = await getSettings();
      const list = await new ClaudeProvider(key, s).listModels();
      if (!list.length) throw new ClaudeError('bad_request', { detail: 'empty model list' });
      const manual = s.availableModels.filter((m) => m.source === 'manual' && !list.some((l) => l.id === m.id));
      const next: ModelOption[] = [...list, ...manual];
      const model = next.some((m) => m.id === s.model) ? s.model : list[0]!.id;
      await update({ availableModels: next, model, modelsRefreshedAt: nowIso() });
      setKeyStatus({ tone: 'success', text: `Loaded ${list.length} models available to your key.${model !== s.model ? ` Switched to ${model} because the previous model isn’t available.` : ''}` });
    } catch (e: unknown) {
      setKeyStatus({
        tone: 'warning',
        text: `${e instanceof ClaudeError ? e.userMessage : 'Could not load the model list.'} You can still type a model ID manually.`,
      });
    } finally {
      setBusy(null);
    }
  }, [update]);

  const addManualModel = useCallback(
    async (id: string) => {
      const m = id.trim();
      if (!/^[a-z0-9][a-z0-9.\-_:@]{2,80}$/i.test(m)) {
        setKeyStatus({ tone: 'warning', text: 'Model IDs contain only letters, numbers, dots and dashes (for example “claude-sonnet-5-5”).' });
        return;
      }
      const exists = settings.availableModels.some((x) => x.id === m);
      await update({
        model: m,
        availableModels: exists ? settings.availableModels : [...settings.availableModels, { id: m, displayName: m, lifecycle: 'unknown', source: 'manual' }],
      });
      setKeyStatus({ tone: 'info', text: `Using “${m}”. Test the API key to confirm the model is available.` });
    },
    [settings.availableModels, update],
  );

  const resetModels = useCallback(() => update({ availableModels: FALLBACK_MODELS }), [update]);

  return { settings, loaded, update, hasKey, masked, keyStatus, setKeyStatus, busy, saveKey, removeKey, testKey, refreshModels, addManualModel, resetModels };
}

export type SettingsController = ReturnType<typeof useSettings>;
