import type { ApplicationRecord } from '../../src/types';

/**
 * Per-field change times for an application. Values travel with their change time, so two devices
 * merging the same versions always pick the same winner (last writer wins, field by field).
 */
export const APP_FIELDS = [
  'jobKey',
  'jobId',
  'jobUrl',
  'title',
  'company',
  'location',
  'remoteStatus',
  'technologies',
  'salary',
  'stage',
  'matchScore',
  'tailoredScore',
  'resumeVersion',
  'coverLetterVersion',
  'resumeFileName',
  'coverLetterFileName',
  'keywords',
  'missingQualifications',
  'datePrepared',
  'dateApplied',
  'followUpDate',
  'folderPath',
] as const satisfies readonly (keyof ApplicationRecord)[];

export type AppField = (typeof APP_FIELDS)[number];

export interface AppClock {
  fields: Partial<Record<AppField, string>>;
  /** Note id → when it was removed, so a merge does not bring deleted notes back. */
  removedNotes: Record<string, string>;
}

export const emptyClock = (): AppClock => ({ fields: {}, removedNotes: {} });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function stringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [k, t] of Object.entries(v)) if (typeof t === 'string') out[k] = t;
  return out;
}

export function parseClock(raw: unknown): AppClock | null {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw) return null;
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isObj(v)) return null;
  const fields = stringMap(v.fields) as AppClock['fields'];
  for (const k of Object.keys(fields)) if (!(APP_FIELDS as readonly string[]).includes(k)) delete fields[k as AppField];
  return { fields, removedNotes: stringMap(v.removedNotes) };
}

export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Records which fields changed between the stored record and the one being saved. */
export function stampChanges(clock: AppClock | null, prev: ApplicationRecord | null, next: ApplicationRecord, at: string): AppClock {
  const out: AppClock = { fields: { ...(clock?.fields ?? {}) }, removedNotes: { ...(clock?.removedNotes ?? {}) } };
  for (const f of APP_FIELDS) {
    if (!prev || !same(prev[f], next[f])) out.fields[f] = at;
  }
  if (prev) {
    const keep = new Set((next.notes ?? []).map((n) => n.id));
    for (const n of prev.notes ?? []) if (!keep.has(n.id)) out.removedNotes[n.id] = at;
  }
  return out;
}
