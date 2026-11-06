import type { SQLInputValue } from 'node:sqlite';
import type { ApplicationRecord, CareerProfile, JobSession, MasterResume } from '../../src/types';
import { normalizeApplication, type Store } from '../db';
import { formatPhone, phoneDigits } from '../../src/utils/contacts';
import { sha256 } from './archive';
import { parseClock } from './clock';
import type { MergePlan } from './merge';
import {
  POSTING_MARKER_PREFIX,
  REMINDERS_KEY,
  SETTINGS_KEY,
  DEVICE_SETTINGS,
  type Alias,
  type AppEntry,
  type ContactRow,
  type DocRow,
  type ResearchRow,
  type ResumeRow,
  type Snapshot,
  type Tombstone,
  type UsageRow,
} from './types';

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const json = <T>(v: unknown): T => JSON.parse(String(v)) as T;

export interface LocalState {
  snapshot: Snapshot;
  /** Original resume files kept in the database, by content hash. */
  blobs: Map<string, Buffer>;
}

/** Reads everything that synchronises in one transaction, so the snapshot is consistent. */
export function readLocal(store: Store): LocalState {
  const db = store.db;
  const all = (sql: string, ...p: SQLInputValue[]) => db.prepare(sql).all(...p) as Row[];
  const blobs = new Map<string, Buffer>();
  db.exec('BEGIN');
  try {
    const applications: AppEntry[] = all('SELECT data, sync_clock, synced_at FROM applications').map((r) => ({
      record: normalizeApplication(json<ApplicationRecord>(r.data)),
      clock: parseClock(r.sync_clock),
      syncedAt: strOrNull(r.synced_at),
    }));
    const contacts: ContactRow[] = all('SELECT * FROM contacts').map((r) => ({
      id: str(r.id),
      applicationId: str(r.application_id),
      name: str(r.name),
      role: str(r.role),
      phone: str(r.phone),
      email: str(r.email),
      source: r.source === 'job posting' ? 'job posting' : 'you',
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at) || str(r.created_at),
    }));
    const documents: DocRow[] = all('SELECT * FROM documents').map((r) => ({
      id: str(r.id),
      applicationId: strOrNull(r.application_id),
      jobKey: str(r.job_key),
      kind: r.kind as DocRow['kind'],
      version: Number(r.version),
      format: strOrNull(r.format),
      filePath: strOrNull(r.file_path),
      json: str(r.json),
      engine: strOrNull(r.engine),
      model: strOrNull(r.model),
      sentAt: strOrNull(r.sent_at),
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
    }));
    const sessions = all('SELECT data FROM sessions').map((r) => json<JobSession>(r.data));
    const companyResearch: ResearchRow[] = all('SELECT job_key, data, updated_at FROM company_research').map((r) => ({
      jobKey: str(r.job_key),
      data: json<unknown>(r.data),
      updatedAt: str(r.updated_at),
    }));
    const resumes: ResumeRow[] = all('SELECT data, source_data, is_default FROM resumes').map((r) => {
      const resume = { ...json<MasterResume>(r.data), isDefault: Boolean(r.is_default) };
      delete (resume as Partial<MasterResume>).sourceData;
      const blob = r.source_data as Uint8Array | null;
      let sourceSha256: string | null = null;
      if (blob && blob.byteLength) {
        const b = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
        sourceSha256 = sha256(b);
        blobs.set(sourceSha256, Buffer.from(b));
      }
      return { resume, sourceSha256 };
    });
    const p = all("SELECT data FROM profile WHERE id = 'default'")[0];
    const profile = p ? json<CareerProfile>(p.data) : null;
    const usage: UsageRow[] = all('SELECT * FROM usage').map((r) => ({
      gid: str(r.gid),
      jobKey: strOrNull(r.job_key),
      applicationId: strOrNull(r.application_id),
      task: str(r.task),
      model: str(r.model),
      inputTokens: Number(r.input_tokens ?? 0),
      cacheRead: Number(r.cache_read ?? 0),
      cacheWrite: Number(r.cache_write ?? 0),
      outputTokens: Number(r.output_tokens ?? 0),
      at: str(r.at),
    }));
    const kv: Record<string, unknown> = {};
    for (const r of all('SELECT key, value FROM kv WHERE key = ? OR key = ? OR key LIKE ?', SETTINGS_KEY, REMINDERS_KEY, `${POSTING_MARKER_PREFIX}%`)) {
      try {
        kv[str(r.key)] = json<unknown>(r.value);
      } catch {
      }
    }
    const tombstones: Tombstone[] = all('SELECT * FROM sync_tombstones').map((r) => ({
      entity: r.entity as Tombstone['entity'],
      id: str(r.id),
      matchKey: strOrNull(r.match_key),
      deletedAt: str(r.deleted_at),
    }));
    const aliases: Alias[] = all('SELECT * FROM sync_aliases').map((r) => ({ entity: r.entity as Alias['entity'], from: str(r.from_id), to: str(r.to_id) }));
    db.exec('COMMIT');
    return {
      snapshot: { deviceId: store.deviceId, applications, contacts, documents, sessions, companyResearch, resumes, profile, usage, kv, tombstones, aliases },
      blobs,
    };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Settings as exported: device-specific values are dropped. */
export function exportableKv(kv: Record<string, unknown>): Record<string, unknown> {
  const out = { ...kv };
  const s = out[SETTINGS_KEY];
  if (s && typeof s === 'object' && !Array.isArray(s)) {
    const copy = { ...(s as Record<string, unknown>) };
    for (const k of DEVICE_SETTINGS) delete copy[k];
    out[SETTINGS_KEY] = copy;
  }
  return out;
}

// ---- Validation of another device's data -------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 512;
const isIso = (v: unknown): v is string => typeof v === 'string' && v.length <= 40;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Keeps only well-formed records from an imported file and reports how many were dropped. */
export function sanitizeSnapshot(raw: unknown, warnings: string[]): Snapshot {
  if (!isObj(raw)) throw new Error('The file’s data is not in the expected format.');
  let dropped = 0;
  const keep = <T>(list: unknown, ok: (x: Record<string, unknown>) => boolean, map: (x: Record<string, unknown>) => T): T[] => {
    const out: T[] = [];
    for (const x of arr(list)) {
      if (isObj(x) && ok(x)) {
        try {
          out.push(map(x));
          continue;
        } catch {
        }
      }
      dropped++;
    }
    return out;
  };
  const applications = keep(
    raw.applications,
    (x) => isObj(x.record) && isId(x.record.id) && isIso(x.record.updatedAt),
    (x) => {
      const r = x.record as unknown as ApplicationRecord;
      if (!Array.isArray(r.notes)) r.notes = [];
      if (!Array.isArray(r.stageHistory)) r.stageHistory = [];
      if (!Array.isArray(r.files)) r.files = [];
      r.files = r.files.filter((f) => isObj(f) && typeof f.relativePath === 'string');
      r.notes = r.notes.filter((n) => isObj(n) && isId(n.id) && typeof n.text === 'string');
      r.stageHistory = r.stageHistory.filter((h) => isObj(h) && typeof h.stage === 'string' && typeof h.at === 'string');
      return { record: r, clock: parseClock(x.clock), syncedAt: null } as AppEntry;
    },
  );
  const contacts = keep(
    raw.contacts,
    (x) => isId(x.id) && isId(x.applicationId),
    (x) => ({
      id: String(x.id),
      applicationId: String(x.applicationId),
      name: str(x.name).slice(0, 500),
      role: str(x.role).slice(0, 500),
      phone: str(x.phone).slice(0, 60),
      email: str(x.email).slice(0, 320),
      source: x.source === 'job posting' ? 'job posting' : 'you',
      createdAt: str(x.createdAt),
      updatedAt: str(x.updatedAt) || str(x.createdAt),
    }) as ContactRow,
  );
  const documents = keep(
    raw.documents,
    (x) => isId(x.id) && isId(x.jobKey) && (x.kind === 'resume' || x.kind === 'cover_letter') && Number.isInteger(x.version) && typeof x.json === 'string',
    (x) => ({
      id: String(x.id),
      applicationId: isId(x.applicationId) ? x.applicationId : null,
      jobKey: String(x.jobKey),
      kind: x.kind as DocRow['kind'],
      version: Number(x.version),
      format: strOrNull(x.format),
      filePath: null,
      json: String(x.json),
      engine: strOrNull(x.engine),
      model: strOrNull(x.model),
      sentAt: strOrNull(x.sentAt),
      createdAt: str(x.createdAt),
      updatedAt: str(x.updatedAt),
      fileSha256: typeof x.fileSha256 === 'string' && /^[0-9a-f]{64}$/.test(x.fileSha256) ? x.fileSha256 : null,
      fileRelativePath: typeof x.fileRelativePath === 'string' ? x.fileRelativePath : null,
    }),
  );
  const sessions = keep(raw.sessions, (x) => isId(x.jobKey) && isIso(x.updatedAt) && isObj(x.job), (x) => x as unknown as JobSession);
  const companyResearch = keep(raw.companyResearch, (x) => isId(x.jobKey) && 'data' in x, (x) => ({ jobKey: String(x.jobKey), data: x.data, updatedAt: str(x.updatedAt) }));
  const resumes = keep(
    raw.resumes,
    (x) => isObj(x.resume) && isId(x.resume.id) && isIso(x.resume.updatedAt),
    (x) => ({
      resume: x.resume as unknown as ResumeRow['resume'],
      sourceSha256: typeof x.sourceSha256 === 'string' && /^[0-9a-f]{64}$/.test(x.sourceSha256) ? x.sourceSha256 : null,
    }),
  );
  const usage = keep(
    raw.usage,
    (x) => isId(x.gid),
    (x) => ({
      gid: String(x.gid),
      jobKey: strOrNull(x.jobKey),
      applicationId: strOrNull(x.applicationId),
      task: str(x.task),
      model: str(x.model),
      inputTokens: Number(x.inputTokens) || 0,
      cacheRead: Number(x.cacheRead) || 0,
      cacheWrite: Number(x.cacheWrite) || 0,
      outputTokens: Number(x.outputTokens) || 0,
      at: str(x.at),
    }),
  );
  const tombstones = keep(
    raw.tombstones,
    (x) => ['application', 'contact', 'resume', 'session'].includes(String(x.entity)) && isId(x.id) && isIso(x.deletedAt),
    (x) => ({ entity: x.entity as Tombstone['entity'], id: String(x.id), matchKey: isId(x.matchKey) ? x.matchKey : null, deletedAt: String(x.deletedAt) }),
  );
  const aliases = keep(
    raw.aliases,
    (x) => (x.entity === 'application' || x.entity === 'resume') && isId(x.from) && isId(x.to),
    (x) => ({ entity: x.entity as Alias['entity'], from: String(x.from), to: String(x.to) }),
  );
  const kv: Record<string, unknown> = {};
  if (isObj(raw.kv)) {
    for (const [k, v] of Object.entries(raw.kv)) {
      if (k === SETTINGS_KEY || k === REMINDERS_KEY || (k.startsWith(POSTING_MARKER_PREFIX) && k.length < 600)) kv[k] = v;
    }
  }
  const profile = isObj(raw.profile) ? (raw.profile as unknown as CareerProfile) : null;
  if (profile && !Array.isArray(profile.approvedAnswers)) profile.approvedAnswers = [];
  if (dropped) warnings.push(`${dropped} damaged record${dropped === 1 ? ' was' : 's were'} ignored.`);
  return {
    deviceId: str(raw.deviceId),
    applications,
    contacts,
    documents,
    sessions,
    companyResearch,
    resumes,
    profile,
    usage,
    kv,
    tombstones,
    aliases,
  };
}

// ---- Applying a merge plan ---------------------------------------------------------------------

/**
 * Writes a merge plan in a single transaction. If anything throws, nothing is written.
 * `blobs` provides original resume files by content hash.
 */
export function applyPlan(store: Store, plan: MergePlan, blobs: Map<string, Buffer>, now: string, beforeCommit?: () => void): void {
  const db = store.db;
  const run = (sql: string, ...p: SQLInputValue[]) => db.prepare(sql).run(...p);
  const all = (sql: string, ...p: SQLInputValue[]) => db.prepare(sql).all(...p) as Row[];
  const kvGet = (k: string): unknown => {
    const r = all('SELECT value FROM kv WHERE key = ?', k)[0];
    return r ? json<unknown>(r.value) : undefined;
  };
  const kvSet = (k: string, v: unknown) => run('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));

  store.tx(() => {
    for (const { from, to } of plan.apps.renames) {
      run('UPDATE contacts SET application_id = ? WHERE application_id = ?', to, from);
      run('UPDATE documents SET application_id = ? WHERE application_id = ?', to, from);
      run('UPDATE usage SET application_id = ? WHERE application_id = ?', to, from);
      for (const r of all('SELECT job_key, data FROM sessions WHERE data LIKE ?', `%"applicationId":${JSON.stringify(from)}%`)) {
        const s = json<JobSession>(r.data);
        if (s.applicationId !== from) continue;
        run('UPDATE sessions SET data = ? WHERE job_key = ?', JSON.stringify({ ...s, applicationId: to }), str(r.job_key));
      }
      run('DELETE FROM applications WHERE id = ?', from);
      run('DELETE FROM search WHERE application_id = ?', from);
      const rem = kvGet(REMINDERS_KEY) as Record<string, unknown> | undefined;
      if (rem && from in rem) {
        if (!(to in rem)) rem[to] = rem[from];
        delete rem[from];
        kvSet(REMINDERS_KEY, rem);
      }
      if (kvGet(POSTING_MARKER_PREFIX + from) !== undefined) {
        kvSet(POSTING_MARKER_PREFIX + to, true);
        run('DELETE FROM kv WHERE key = ?', POSTING_MARKER_PREFIX + from);
      }
    }

    for (const id of plan.apps.remove) {
      run('DELETE FROM applications WHERE id = ?', id);
      run('DELETE FROM contacts WHERE application_id = ?', id);
      run('DELETE FROM search WHERE application_id = ?', id);
      run('UPDATE documents SET application_id = NULL WHERE application_id = ?', id);
      const rem = kvGet(REMINDERS_KEY) as Record<string, unknown> | undefined;
      if (rem && id in rem) {
        delete rem[id];
        kvSet(REMINDERS_KEY, rem);
      }
    }

    for (const e of plan.apps.put) {
      const r = e.record;
      run(
        `INSERT INTO applications(id, job_key, company, title, location, stage, job_url, date_prepared, date_applied, follow_up_date, data, updated_at, sync_clock, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET job_key = excluded.job_key, company = excluded.company, title = excluded.title, location = excluded.location,
           stage = excluded.stage, job_url = excluded.job_url, date_prepared = excluded.date_prepared, date_applied = excluded.date_applied,
           follow_up_date = excluded.follow_up_date, data = excluded.data, updated_at = excluded.updated_at, sync_clock = excluded.sync_clock,
           synced_at = excluded.synced_at`,
        r.id, r.jobKey, r.company, r.title, r.location, r.stage, r.jobUrl, r.datePrepared, r.dateApplied, r.followUpDate,
        JSON.stringify(r), r.updatedAt, JSON.stringify(e.clock ?? { fields: {}, removedNotes: {} }), e.syncedAt ?? now,
      );
    }
    for (const id of plan.apps.touched) run('UPDATE applications SET synced_at = ? WHERE id = ?', now, id);

    for (const id of plan.contacts.remove) run('DELETE FROM contacts WHERE id = ?', id);
    for (const c of plan.contacts.put) {
      const phone = c.phone ? formatPhone(c.phone) : '';
      run(
        `INSERT INTO contacts(id, application_id, name, role, phone, phone_digits, email, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET application_id = excluded.application_id, name = excluded.name, role = excluded.role, phone = excluded.phone,
           phone_digits = excluded.phone_digits, email = excluded.email, source = excluded.source, created_at = excluded.created_at, updated_at = excluded.updated_at`,
        c.id, c.applicationId, c.name, c.role, phone, phone ? phoneDigits(phone) : '', c.email, c.source, c.createdAt, c.updatedAt,
      );
    }

    for (const d of plan.documents.put) {
      run(
        `INSERT INTO documents(id, application_id, job_key, kind, version, format, file_path, json, engine, model, sent_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET application_id = excluded.application_id, format = excluded.format, file_path = excluded.file_path,
           json = excluded.json, engine = excluded.engine, model = excluded.model, sent_at = excluded.sent_at, created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        d.id, d.applicationId, d.jobKey, d.kind, d.version, d.format ?? null, d.filePath ?? null, d.json, d.engine ?? null, d.model ?? null, d.sentAt ?? null,
        d.createdAt || now, d.updatedAt || now,
      );
    }

    for (const k of plan.sessions.remove) {
      run('DELETE FROM sessions WHERE job_key = ?', k);
      run('DELETE FROM company_research WHERE job_key = ?', k);
    }
    for (const s of plan.sessions.put) {
      run(
        'INSERT INTO sessions(job_key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(job_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
        s.jobKey, JSON.stringify(s), s.updatedAt,
      );
    }
    for (const r of plan.research.put) {
      run(
        'INSERT INTO company_research(job_key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(job_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
        r.jobKey, JSON.stringify(r.data), r.updatedAt || now,
      );
    }

    for (const id of plan.resumes.remove) run('DELETE FROM resumes WHERE id = ?', id);
    for (const { resume, sourceSha256 } of plan.resumes.put) {
      const blob = sourceSha256 ? blobs.get(sourceSha256) ?? null : null;
      run(
        `INSERT INTO resumes(id, name, is_default, data, source_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data,
           source_data = COALESCE(excluded.source_data, resumes.source_data), updated_at = excluded.updated_at`,
        resume.id, resume.name, resume.isDefault ? 1 : 0, JSON.stringify({ ...resume, sourceData: null }), blob ? new Uint8Array(blob) : null, resume.createdAt, resume.updatedAt,
      );
    }
    if (plan.resumes.defaultId) run('UPDATE resumes SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END', plan.resumes.defaultId);
    if (!all('SELECT id FROM resumes WHERE is_default = 1').length) {
      const next = all('SELECT id FROM resumes ORDER BY updated_at DESC LIMIT 1')[0];
      if (next) run('UPDATE resumes SET is_default = 1 WHERE id = ?', str(next.id));
    }

    if (plan.profile) run("INSERT INTO profile(id, data) VALUES ('default', ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data", JSON.stringify(plan.profile));

    for (const u of plan.usage) {
      run(
        `INSERT OR IGNORE INTO usage(job_key, application_id, task, model, input_tokens, cache_read, cache_write, output_tokens, at, gid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        u.jobKey, u.applicationId, u.task, u.model, u.inputTokens, u.cacheRead, u.cacheWrite, u.outputTokens, u.at, u.gid,
      );
    }

    for (const [k, v] of Object.entries(plan.kv)) kvSet(k, v);

    for (const t of plan.tombstones) {
      run(
        `INSERT INTO sync_tombstones(entity, id, match_key, deleted_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(entity, id) DO UPDATE SET match_key = COALESCE(excluded.match_key, sync_tombstones.match_key),
           deleted_at = MAX(excluded.deleted_at, sync_tombstones.deleted_at)`,
        t.entity, t.id, t.matchKey, t.deletedAt,
      );
    }
    for (const t of plan.tombstonesRemove) run('DELETE FROM sync_tombstones WHERE entity = ? AND id = ?', t.entity, t.id);
    for (const a of plan.aliases) {
      run('INSERT OR IGNORE INTO sync_aliases(entity, from_id, to_id, created_at) VALUES (?, ?, ?, ?)', a.entity, a.from, a.to, now);
    }
    beforeCommit?.();
  });
  store.reindexAll();
}
