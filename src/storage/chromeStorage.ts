/**
 * Key/value storage for settings. In the desktop app values live in the SQLite `kv` table
 * (through the bridge); elsewhere (tests, design previews) an in-memory map is used.
 * The file keeps its old name so existing imports and tests stay stable.
 */
import { bridge } from '@/platform/bridge';

const memory = new Map<string, unknown>();
const listeners = new Set<(changes: Record<string, unknown>) => void>();

const notify = (changes: Record<string, unknown>) => listeners.forEach((l) => l(changes));

export async function storageGet<T>(key: string): Promise<T | undefined> {
  const b = bridge();
  if (b) return ((await b.invoke('kv.get', key)) ?? undefined) as T | undefined;
  return memory.get(key) as T | undefined;
}

export async function storageSet(key: string, value: unknown): Promise<void> {
  const b = bridge();
  if (b) await b.invoke('kv.set', key, value);
  else memory.set(key, value);
  notify({ [key]: value });
}

export async function storageRemove(key: string): Promise<void> {
  const b = bridge();
  if (b) await b.invoke('kv.remove', key);
  else memory.delete(key);
  notify({ [key]: undefined });
}

export function onStorageChange(cb: (changes: Record<string, unknown>) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Test helper. */
export function __resetMemoryStorage(): void {
  memory.clear();
}
