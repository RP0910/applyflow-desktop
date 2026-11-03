import { DEFAULT_SETTINGS, type Settings } from '@/types';
import { onStorageChange, storageGet, storageRemove, storageSet } from './chromeStorage';
import { bridge } from '@/platform/bridge';

const SETTINGS_KEY = 'applyflow.settings.v1';
/** Kept separate from settings so the key is never serialized with them, exported, or sent to a page. */
const API_KEY_SLOT = 'applyflow.secret.anthropicApiKey';

const SCHEMA = 3;

/** One-time upgrades for settings saved by older versions. */
export function migrateSettings(stored: Partial<Settings> & { schema?: number }): Partial<Settings> & { schema: number } {
  if ((stored.schema ?? 1) >= SCHEMA) return stored as Partial<Settings> & { schema: number };
  const from = stored.schema ?? 1;
  const next = { ...stored, schema: SCHEMA };
  // 2.0: one Claude request per job. The refine pass (a second full request) becomes opt-in.
  if (from < 3) next.atsRefinePass = false;
  // v1.0 used 8,000 tokens, which thinking can exhaust before the answer is written.
  if (typeof next.maxOutputTokens === 'number' && next.maxOutputTokens < 16000) next.maxOutputTokens = 16000;
  return next;
}

export async function getSettings(): Promise<Settings> {
  const raw = (await storageGet<Partial<Settings> & { schema?: number }>(SETTINGS_KEY)) ?? {};
  const stored = migrateSettings(raw);
  if (stored !== raw && Object.keys(raw).length) await storageSet(SETTINGS_KEY, stored);
  const { schema: _schema, ...rest } = stored;
  void _schema;
  return { ...DEFAULT_SETTINGS, ...rest, resumeFormat: { ...DEFAULT_SETTINGS.resumeFormat, ...(rest.resumeFormat ?? {}) } };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  // Defensive: never allow a secret to ride along in settings.
  delete (next as Record<string, unknown>).apiKey;
  await storageSet(SETTINGS_KEY, { ...next, schema: SCHEMA });
  return next;
}

export async function resetSettings(): Promise<Settings> {
  await storageSet(SETTINGS_KEY, DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  return onStorageChange((changes) => {
    if (SETTINGS_KEY in changes) {
      const next = (changes[SETTINGS_KEY] as Partial<Settings>) ?? {};
      cb({ ...DEFAULT_SETTINGS, ...next, resumeFormat: { ...DEFAULT_SETTINGS.resumeFormat, ...(next.resumeFormat ?? {}) } });
    }
  });
}

export async function getApiKey(): Promise<string | null> {
  const b = bridge();
  const k = b ? await b.invoke('secret.get') : await storageGet<string>(API_KEY_SLOT);
  return k && k.trim() ? k.trim() : null;
}

export async function setApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('The API key is empty.');
  const b = bridge();
  // Desktop: encrypted with the operating system's keychain (Windows DPAPI) — never stored in plain text.
  if (b) {
    await b.invoke('secret.set', trimmed);
    keyListeners.forEach((l) => l(true));
    return;
  }
  await storageSet(API_KEY_SLOT, trimmed);
}

export async function deleteApiKey(): Promise<void> {
  const b = bridge();
  if (b) {
    await b.invoke('secret.remove');
    keyListeners.forEach((l) => l(false));
    return;
  }
  await storageRemove(API_KEY_SLOT);
}

export async function hasApiKey(): Promise<boolean> {
  return (await getApiKey()) !== null;
}

const keyListeners = new Set<(present: boolean) => void>();

export function onApiKeyChanged(cb: (present: boolean) => void): () => void {
  keyListeners.add(cb);
  const off = onStorageChange((changes) => {
    if (API_KEY_SLOT in changes) cb(Boolean(changes[API_KEY_SLOT]));
  });
  return () => {
    keyListeners.delete(cb);
    off();
  };
}
