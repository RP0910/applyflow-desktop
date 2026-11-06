import { createHash } from 'node:crypto';
import type { ApplicationRecord, ApprovedAnswer, CareerProfile, JobSession } from '../../src/types';
import { emptyReport, type SyncConflict, type SyncEntity, type SyncReport } from '../../src/platform/syncTypes';
import { normalizeJobUrl } from '../../src/utils/jobKey';
import { phoneDigits } from '../../src/utils/contacts';
import { normalizeApplication } from '../db';
import { APP_FIELDS, emptyClock, same, type AppClock } from './clock';
import {
  DEVICE_SETTINGS,
  POSTING_MARKER_PREFIX,
  REMINDERS_KEY,
  SETTINGS_KEY,
  type Alias,
  type AppEntry,
  type ContactRow,
  type DocRow,
  type ResearchRow,
  type ResumeRow,
  type Snapshot,
  type SyncSavedFile,
  type Tombstone,
  type TombstoneEntity,
  type UsageRow,
} from './types';

export interface MergeOptions {
  /** Timestamp recorded as this merge's sync point. */
  now: string;
  /** Local absolute path that will hold the file with this content hash, or null if it is not available. */
  fileFor: (sha: string | null | undefined) => string | null;
  /** Also take the other device's preferences (device-specific settings are never taken). */
  applySettings: boolean;
  /** When this device last wrote an export; values older than that may already be on the other device. */
  lastExportAt: string | null;
}

export interface MergePlan {
  apps: { put: AppEntry[]; renames: { from: string; to: string }[]; remove: string[]; touched: string[] };
  contacts: { put: ContactRow[]; remove: string[] };
  documents: { put: DocRow[] };
  sessions: { put: JobSession[]; remove: string[] };
  research: { put: ResearchRow[] };
  resumes: { put: ResumeRow[]; remove: string[]; defaultId: string | null };
  profile: CareerProfile | null;
  usage: UsageRow[];
  kv: Record<string, unknown>;
  tombstones: Tombstone[];
  tombstonesRemove: { entity: TombstoneEntity; id: string }[];
  aliases: Alias[];
  report: SyncReport;
}

const EMPTY = (v: unknown): boolean => v === null || v === undefined || v === '' || v === 'unknown' || (Array.isArray(v) && v.length === 0);
const maxIso = (a: string | null | undefined, b: string | null | undefined): string | undefined => ((a ?? '') >= (b ?? '') ? a ?? undefined : b ?? undefined);
const minIso = (a: string | null | undefined, b: string | null | undefined): string | null => {
  if (!a) return b ?? null;
  if (!b) return a;
  return a <= b ? a : b;
};
const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex');
const show = (v: unknown): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
};
const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const DAY = 86_400_000;

/** Union-find over identifiers; the smallest identifier of a group is the canonical one on every device. */
class AliasMap {
  private readonly parent = new Map<string, string>();
  readonly added: Alias[] = [];

  constructor(
    private readonly entity: Alias['entity'],
    list: Alias[],
  ) {
    for (const a of list) if (a.entity === entity) this.link(a.from, a.to, false);
  }

  resolve(id: string): string {
    let cur = id;
    for (let i = 0; i < 64; i++) {
      const next = this.parent.get(cur);
      if (!next || next === cur) break;
      cur = next;
    }
    return cur;
  }

  /** Joins two identifiers; returns the canonical one. */
  link(a: string, b: string, record = true): string {
    if (!a || !b) return a || b;
    const ra = this.resolve(a);
    const rb = this.resolve(b);
    if (ra === rb) return ra;
    const [lo, hi] = ra < rb ? [ra, rb] : [rb, ra];
    this.parent.set(hi, lo);
    if (record) this.added.push({ entity: this.entity, from: hi, to: lo });
    return lo;
  }
}

interface Slot {
  entry: AppEntry;
  localIds: Set<string>;
  isNew: boolean;
  changed: boolean;
  touched: boolean;
}

function appLabel(r: Pick<ApplicationRecord, 'title' | 'company'>): string {
  return `${r.title || 'Untitled role'} at ${r.company || 'unknown company'}`;
}

function urlKey(u: string): string | null {
  if (!/^https?:\/\//i.test(u ?? '')) return null;
  return normalizeJobUrl(u).toLowerCase();
}

interface FieldConflict {
  field: string;
  local: string;
  incoming: string;
  chosen: 'local' | 'incoming';
}

/** Field-by-field merge of two copies of one application. `a` is this device's copy. */
export function mergeApplication(a: AppEntry, b: AppEntry, since: string): { entry: AppEntry; conflicts: FieldConflict[] } {
  const ra = a.record;
  const rb = b.record;
  const ca = a.clock ?? emptyClock();
  const cb = b.clock ?? emptyClock();
  const out = { ...ra } as ApplicationRecord;
  const target = out as unknown as Record<string, unknown>;
  const clock: AppClock = { fields: {}, removedNotes: { ...ca.removedNotes } };
  for (const [k, t] of Object.entries(cb.removedNotes)) clock.removedNotes[k] = maxIso(clock.removedNotes[k], t) ?? t;
  const conflicts: FieldConflict[] = [];

  for (const f of APP_FIELDS) {
    const va = ra[f];
    const vb = rb[f];
    const ta = ca.fields[f];
    const tb = cb.fields[f];
    if (f === 'datePrepared') {
      target[f] = minIso(va as string, vb as string) ?? va;
      const t = maxIso(ta, tb);
      if (t) clock.fields[f] = t;
      continue;
    }
    if (same(va, vb)) {
      target[f] = va;
      const t = maxIso(ta, tb);
      if (t) clock.fields[f] = t;
      continue;
    }
    const tA = ta ?? ra.updatedAt;
    const tB = tb ?? rb.updatedAt;
    let pickB: boolean;
    // Without a real change time on one side, an empty value never replaces a filled one.
    if ((!ta || !tb) && EMPTY(va) !== EMPTY(vb)) pickB = EMPTY(va);
    else pickB = tB > tA || (tB === tA && JSON.stringify(vb ?? null) > JSON.stringify(va ?? null));
    target[f] = pickB ? vb : va;
    const tw = pickB ? tb : ta;
    if (tw) clock.fields[f] = tw;
    if (!EMPTY(va) && !EMPTY(vb) && tA > since && tB > since) conflicts.push({ field: f, local: show(va), incoming: show(vb), chosen: pickB ? 'incoming' : 'local' });
  }

  const noteIds = new Set(ra.notes.map((n) => n.id));
  const noteSig = new Set(ra.notes.map((n) => `${n.createdAt}|${n.text}`));
  const notes = [...ra.notes];
  let addedNote = false;
  for (const n of rb.notes) {
    if (noteIds.has(n.id) || noteSig.has(`${n.createdAt}|${n.text}`)) continue;
    notes.push(n);
    noteIds.add(n.id);
    addedNote = true;
  }
  out.notes = notes.filter((n) => !clock.removedNotes[n.id]);
  if (addedNote) out.notes.sort((x, y) => x.createdAt.localeCompare(y.createdAt));

  const stageKeys = new Set(ra.stageHistory.map((h) => `${h.stage}|${h.at}`));
  const history = [...ra.stageHistory];
  let addedStage = false;
  for (const h of rb.stageHistory) {
    const k = `${h.stage}|${h.at}`;
    if (stageKeys.has(k)) continue;
    stageKeys.add(k);
    history.push(h);
    addedStage = true;
  }
  if (addedStage) history.sort((x, y) => x.at.localeCompare(y.at));
  out.stageHistory = history;

  const fileKey = (f: SyncSavedFile) => `${f.kind}|${f.format}|${f.relativePath}`;
  const files = [...(ra.files as SyncSavedFile[])];
  const byKey = new Map(files.map((f, i) => [fileKey(f), i]));
  for (const f of rb.files as SyncSavedFile[]) {
    const i = byKey.get(fileKey(f));
    if (i === undefined) {
      byKey.set(fileKey(f), files.length);
      files.push(f);
      continue;
    }
    const mine = files[i]!;
    if (!mine.absolutePath && f.absolutePath) files[i] = { ...mine, absolutePath: f.absolutePath, state: f.state, sha256: f.sha256 ?? mine.sha256 };
  }
  out.files = files;
  out.createdAt = minIso(ra.createdAt, rb.createdAt) ?? ra.createdAt;
  out.updatedAt = maxIso(ra.updatedAt, rb.updatedAt) ?? ra.updatedAt;
  return { entry: { record: out, clock, syncedAt: a.syncedAt }, conflicts };
}

function mergeProfile(a: CareerProfile, b: CareerProfile): CareerProfile {
  const bNewer = (b.updatedAt ?? '') > (a.updatedAt ?? '');
  const newer = (bNewer ? b : a) as unknown as Record<string, unknown>;
  const older = (bNewer ? a : b) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...older, ...newer };
  for (const k of Object.keys(out)) if (EMPTY(newer[k]) && !EMPTY(older[k])) out[k] = older[k];
  const answers = new Map<string, ApprovedAnswer>();
  const stamp = (x: ApprovedAnswer) => maxIso(x.lastUsedAt, x.approvedAt) ?? '';
  for (const list of [a.approvedAnswers ?? [], b.approvedAnswers ?? []]) {
    for (const ans of list) {
      const cur = answers.get(ans.id);
      if (!cur) answers.set(ans.id, ans);
      else {
        const win = stamp(ans) > stamp(cur) ? ans : cur;
        answers.set(ans.id, { ...win, useCount: Math.max(cur.useCount ?? 0, ans.useCount ?? 0) || win.useCount });
      }
    }
  }
  out.approvedAnswers = [...answers.values()];
  out.updatedAt = maxIso(a.updatedAt, b.updatedAt) ?? a.updatedAt;
  return out as unknown as CareerProfile;
}

function contactKeyMatch(a: ContactRow, b: ContactRow): boolean {
  const pa = a.phone ? phoneDigits(a.phone) : '';
  const pb = b.phone ? phoneDigits(b.phone) : '';
  if (pa && pb && pa.slice(-10) === pb.slice(-10)) return true;
  if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) return true;
  if (!pa && !pb && !a.email && !b.email && norm(a.name) && norm(a.name) === norm(b.name) && norm(a.role) === norm(b.role)) return true;
  return false;
}

/**
 * Merges another device's snapshot into this device's snapshot and returns the changes to apply.
 * Pure: it reads only its arguments, so it can run for a preview and again for the real import.
 */
export function mergeSnapshots(local: Snapshot, incoming: Snapshot, opt: MergeOptions): MergePlan {
  const report = emptyReport();
  const conflictRecords = new Set<string>();
  const addConflict = (c: SyncConflict) => {
    if (report.conflicts.length < 500) report.conflicts.push(c);
    const k = `${c.entity}|${c.id}`;
    if (!conflictRecords.has(k)) {
      conflictRecords.add(k);
      report.entities[c.entity].conflicts++;
    }
  };
  const count = (e: SyncEntity) => report.entities[e];
  const plan: MergePlan = {
    apps: { put: [], renames: [], remove: [], touched: [] },
    contacts: { put: [], remove: [] },
    documents: { put: [] },
    sessions: { put: [], remove: [] },
    research: { put: [] },
    resumes: { put: [], remove: [], defaultId: null },
    profile: null,
    usage: [],
    kv: {},
    tombstones: [],
    tombstonesRemove: [],
    aliases: [],
    report,
  };

  // Identifiers and deletions known on either device.
  const appAlias = new AliasMap('application', local.aliases);
  for (const a of incoming.aliases) if (a.entity === 'application') appAlias.link(a.from, a.to);

  const tombs = new Map<string, Tombstone>();
  const tombsByKey = new Map<string, Tombstone>();
  const tk = (e: string, id: string) => `${e}|${id}`;
  const remember = (t: Tombstone) => {
    tombs.set(tk(t.entity, t.id), t);
    if (t.matchKey) {
      const cur = tombsByKey.get(tk(t.entity, t.matchKey));
      if (!cur || cur.deletedAt < t.deletedAt) tombsByKey.set(tk(t.entity, t.matchKey), t);
    }
  };
  for (const t of local.tombstones) remember(t);
  for (const t of incoming.tombstones) {
    const cur = tombs.get(tk(t.entity, t.id));
    if (!cur || cur.deletedAt < t.deletedAt) {
      remember(t);
      plan.tombstones.push(t);
    }
  }
  const tombFor = (e: TombstoneEntity, ...ids: string[]) => {
    let best: Tombstone | undefined;
    for (const id of ids) {
      const t = tombs.get(tk(e, id));
      if (t && (!best || t.deletedAt > best.deletedAt)) best = t;
    }
    return best;
  };
  const sinceFor = (syncedAt: string | null) => maxIso(syncedAt, opt.lastExportAt) ?? '';

  // ---- Applications ----------------------------------------------------------------------------
  const slots = new Map<string, Slot>();
  for (const e of local.applications) {
    const id = appAlias.resolve(e.record.id);
    const entry: AppEntry = { record: { ...e.record, id }, clock: e.clock ?? emptyClock(), syncedAt: e.syncedAt };
    const cur = slots.get(id);
    if (!cur) {
      slots.set(id, { entry, localIds: new Set([e.record.id]), isNew: false, changed: e.record.id !== id, touched: false });
      continue;
    }
    // Two local rows that another device already identified as the same application.
    cur.entry = mergeApplication(cur.entry, entry, sinceFor(cur.entry.syncedAt)).entry;
    cur.localIds.add(e.record.id);
    cur.changed = true;
    count('applications').merged++;
  }

  const index = new Map<string, Set<string>>();
  const ctIndex = new Map<string, Set<string>>();
  const indexSlot = (id: string, r: ApplicationRecord) => {
    const add = (m: Map<string, Set<string>>, k: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(id);
    if (r.jobKey && !r.jobKey.startsWith('import:')) add(index, `jk:${r.jobKey}`);
    const u = urlKey(r.jobUrl);
    if (u) add(index, `url:${u}`);
    if (norm(r.company) && norm(r.title)) add(ctIndex, `${norm(r.company)}|${norm(r.title)}`);
  };
  for (const [id, s] of slots) indexSlot(id, s.entry.record);

  const findDuplicate = (r: ApplicationRecord): Slot | undefined => {
    const keys: string[] = [];
    if (r.jobKey && !r.jobKey.startsWith('import:')) keys.push(`jk:${r.jobKey}`);
    const u = urlKey(r.jobUrl);
    if (u) keys.push(`url:${u}`);
    for (const k of keys) {
      for (const id of index.get(k) ?? []) {
        const s = slots.get(appAlias.resolve(id));
        if (s && !s.isNew) return s;
      }
    }
    const ct = norm(r.company) && norm(r.title) ? `${norm(r.company)}|${norm(r.title)}` : null;
    if (!ct) return undefined;
    const when = Date.parse(r.dateApplied || r.datePrepared);
    let best: Slot | undefined;
    let bestGap = Infinity;
    for (const id of ctIndex.get(ct) ?? []) {
      const s = slots.get(appAlias.resolve(id));
      if (!s || s.isNew) continue;
      const other = Date.parse(s.entry.record.dateApplied || s.entry.record.datePrepared);
      const gap = Math.abs(when - other);
      if (Number.isFinite(gap) && gap <= 14 * DAY && gap < bestGap) {
        best = s;
        bestGap = gap;
      }
    }
    return best;
  };

  const withLocalFiles = (r: ApplicationRecord): ApplicationRecord => ({
    ...r,
    files: (Array.isArray(r.files) ? r.files : []).map((f: SyncSavedFile) => {
      const p = opt.fileFor(f.sha256);
      return { ...f, absolutePath: p, state: p ? 'complete' : f.state === 'complete' ? 'failed' : f.state, error: p ? undefined : f.state === 'complete' ? 'The file was not in the imported data.' : f.error };
    }),
  });

  for (const inc of incoming.applications) {
    const rec = normalizeApplication(withLocalFiles(inc.record));
    const label = appLabel(rec);
    const id = appAlias.resolve(rec.id);
    const tomb = tombFor('application', rec.id, id);
    if (tomb && tomb.deletedAt >= rec.updatedAt) {
      count('applications').skipped++;
      continue;
    }
    const slot = slots.get(id) ?? findDuplicate(rec);
    if (!slot) {
      const byKey = !rec.jobKey.startsWith('import:') ? tombsByKey.get(tk('application', rec.jobKey)) : undefined;
      if (byKey && byKey.deletedAt >= rec.updatedAt) {
        count('applications').skipped++;
        continue;
      }
      if (tomb) {
        addConflict({ entity: 'applications', id, label, field: null, local: 'Deleted on this device', incoming: 'Changed on the other device after that', resolution: 'Restored the other device’s newer copy.' });
        plan.tombstonesRemove.push({ entity: 'application', id: tomb.id });
      }
      const fresh: Slot = { entry: { record: { ...rec, id }, clock: inc.clock ?? emptyClock(), syncedAt: opt.now }, localIds: new Set(), isNew: true, changed: true, touched: true };
      slots.set(id, fresh);
      count('applications').added++;
      continue;
    }
    const before = slot.entry;
    const dup = before.record.id !== id;
    const canon = dup ? appAlias.link(before.record.id, id) : id;
    const merged = mergeApplication(before, { record: { ...rec, id: before.record.id }, clock: inc.clock ?? emptyClock(), syncedAt: null }, sinceFor(before.syncedAt));
    merged.entry.record.id = canon;
    const changed = canon !== before.record.id || !same(merged.entry.record, before.record) || !same(merged.entry.clock, before.clock);
    if (canon !== before.record.id) {
      slots.delete(before.record.id);
      slots.set(canon, slot);
    }
    slot.entry = { ...merged.entry, syncedAt: opt.now };
    slot.touched = true;
    if (changed) slot.changed = true;
    if (dup) count('applications').merged++;
    else if (changed) count('applications').updated++;
    else count('applications').unchanged++;
    for (const c of merged.conflicts) {
      addConflict({
        entity: 'applications',
        id: canon,
        label,
        field: c.field,
        local: c.local,
        incoming: c.incoming,
        resolution: c.chosen === 'incoming' ? 'Used the other device’s value (changed more recently).' : 'Kept this device’s value (changed more recently).',
      });
    }
  }

  for (const t of incoming.tombstones) {
    if (t.entity !== 'application') continue;
    const id = appAlias.resolve(t.id);
    const slot = slots.get(id);
    if (!slot || slot.isNew) continue;
    if (slot.entry.record.updatedAt <= t.deletedAt) {
      for (const lid of slot.localIds) plan.apps.remove.push(lid);
      slots.delete(id);
      count('applications').deleted++;
    } else {
      addConflict({
        entity: 'applications',
        id,
        label: appLabel(slot.entry.record),
        field: null,
        local: 'Changed on this device',
        incoming: 'Deleted on the other device before that change',
        resolution: 'Kept it, because it changed here after it was deleted there.',
      });
    }
  }

  for (const [id, slot] of slots) {
    if (slot.isNew || slot.changed) plan.apps.put.push(slot.entry);
    else if (slot.touched) plan.apps.touched.push(id);
    for (const lid of slot.localIds) if (lid !== id) plan.apps.renames.push({ from: lid, to: id });
  }
  const appIds = new Set(slots.keys());
  const resolveApp = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const r = appAlias.resolve(id);
    return appIds.has(r) ? r : null;
  };
  plan.aliases.push(...appAlias.added);

  // ---- Contacts --------------------------------------------------------------------------------
  const removedApps = new Set(plan.apps.remove);
  const contactsById = new Map<string, ContactRow>();
  const contactsByApp = new Map<string, ContactRow[]>();
  for (const c of local.contacts) {
    if (removedApps.has(c.applicationId)) continue;
    const row = { ...c, applicationId: appAlias.resolve(c.applicationId) };
    contactsById.set(c.id, row);
    (contactsByApp.get(row.applicationId) ?? contactsByApp.set(row.applicationId, []).get(row.applicationId)!).push(row);
  }
  for (const inc of incoming.contacts) {
    const appId = resolveApp(inc.applicationId);
    const tomb = tombFor('contact', inc.id);
    if (!appId || (tomb && tomb.deletedAt >= (inc.updatedAt || inc.createdAt))) {
      count('contacts').skipped++;
      continue;
    }
    const c: ContactRow = { ...inc, applicationId: appId, updatedAt: inc.updatedAt || inc.createdAt };
    const existing = contactsById.get(c.id) ?? (contactsByApp.get(appId) ?? []).find((x) => contactKeyMatch(x, c));
    if (!existing) {
      plan.contacts.put.push(c);
      contactsById.set(c.id, c);
      (contactsByApp.get(appId) ?? contactsByApp.set(appId, []).get(appId)!).push(c);
      count('contacts').added++;
      continue;
    }
    const cNewer = c.updatedAt > existing.updatedAt;
    const newer = cNewer ? c : existing;
    const older = cNewer ? existing : c;
    const merged: ContactRow = {
      ...existing,
      name: newer.name || older.name,
      role: newer.role || older.role,
      phone: newer.phone || older.phone,
      email: newer.email || older.email,
      source: existing.source === 'you' || c.source === 'you' ? 'you' : existing.source,
      createdAt: minIso(existing.createdAt, c.createdAt) ?? existing.createdAt,
      updatedAt: maxIso(existing.updatedAt, c.updatedAt) ?? existing.updatedAt,
    };
    const isDup = existing.id !== c.id;
    const unchangedFields = ['name', 'role', 'phone', 'email', 'source'].every((k) => same(merged[k as keyof ContactRow], existing[k as keyof ContactRow]));
    if (!unchangedFields) {
      plan.contacts.put.push(merged);
      contactsById.set(existing.id, merged);
      const list = contactsByApp.get(appId)!;
      list[list.indexOf(existing)] = merged;
    }
    if (isDup) count('contacts').merged++;
    else if (!unchangedFields) count('contacts').updated++;
    else count('contacts').unchanged++;
  }
  for (const t of incoming.tombstones) {
    if (t.entity !== 'contact') continue;
    const c = contactsById.get(t.id);
    if (c && (c.updatedAt || c.createdAt) <= t.deletedAt) {
      plan.contacts.remove.push(c.id);
      count('contacts').deleted++;
    }
  }

  // ---- Generated documents (content-addressed: the same JSON is the same document) ---------------
  const docById = new Map<string, DocRow>();
  const docByContent = new Map<string, DocRow>();
  const maxVersion = new Map<string, number>();
  const contentKey = (d: Pick<DocRow, 'jobKey' | 'kind' | 'json'>) => `${d.jobKey}|${d.kind}|${sha1(d.json)}`;
  const trackDoc = (d: DocRow) => {
    docById.set(d.id, d);
    docByContent.set(contentKey(d), d);
    const vk = `${d.jobKey}|${d.kind}`;
    maxVersion.set(vk, Math.max(maxVersion.get(vk) ?? 0, d.version));
  };
  for (const d of local.documents) trackDoc(d);
  for (const inc of incoming.documents) {
    const appId = resolveApp(inc.applicationId);
    const filePath = opt.fileFor(inc.fileSha256);
    const existing = docByContent.get(contentKey(inc));
    if (existing) {
      const merged: DocRow = {
        ...existing,
        applicationId: existing.applicationId ?? appId,
        filePath: existing.filePath ?? filePath,
        format: existing.format ?? inc.format ?? null,
        engine: existing.engine ?? inc.engine,
        model: existing.model ?? inc.model,
        sentAt: minIso(existing.sentAt, inc.sentAt),
        createdAt: minIso(existing.createdAt, inc.createdAt) ?? existing.createdAt,
      };
      if (same(merged, existing)) count('documents').unchanged++;
      else {
        plan.documents.put.push(merged);
        trackDoc(merged);
        count('documents').updated++;
      }
      continue;
    }
    let { id, version } = inc;
    if (docById.has(id)) {
      version = (maxVersion.get(`${inc.jobKey}|${inc.kind}`) ?? 0) + 1;
      id = `${inc.jobKey}|${inc.kind}|v${version}`;
      addConflict({
        entity: 'documents',
        id,
        label: `${inc.kind === 'resume' ? 'Resume' : 'Cover letter'} for ${inc.jobKey}`,
        field: 'version',
        local: `version ${inc.version}`,
        incoming: `a different version ${inc.version}`,
        resolution: `Kept both; the other device’s copy is version ${version} here.`,
      });
    }
    const row: DocRow = { ...inc, id, version, applicationId: appId, filePath, fileSha256: undefined, fileRelativePath: undefined };
    plan.documents.put.push(row);
    trackDoc(row);
    count('documents').added++;
  }

  // ---- Master resumes --------------------------------------------------------------------------
  const resumeMap = new Map<string, string>();
  const resumesById = new Map(local.resumes.map((r) => [r.resume.id, r]));
  const resumeContent = (r: ResumeRow) => `${norm(r.resume.name)}|${sha1(r.resume.rawText ?? '')}`;
  const resumesByContent = new Map(local.resumes.map((r) => [resumeContent(r), r]));
  for (const inc of incoming.resumes) {
    const tomb = tombFor('resume', inc.resume.id);
    if (tomb && tomb.deletedAt >= inc.resume.updatedAt) {
      count('resumes').skipped++;
      continue;
    }
    const mine = resumesById.get(inc.resume.id) ?? resumesByContent.get(resumeContent(inc));
    if (!mine) {
      const row: ResumeRow = { resume: { ...inc.resume, isDefault: false }, sourceSha256: inc.sourceSha256 };
      plan.resumes.put.push(row);
      resumesById.set(row.resume.id, row);
      resumesByContent.set(resumeContent(row), row);
      count('resumes').added++;
      continue;
    }
    if (mine.resume.id !== inc.resume.id) {
      resumeMap.set(inc.resume.id, mine.resume.id);
      count('resumes').merged++;
      continue;
    }
    const strip = (r: ResumeRow) => ({ ...r.resume, isDefault: false });
    if (same(strip(mine), strip(inc)) && (mine.sourceSha256 ?? null) === (inc.sourceSha256 ?? null)) count('resumes').unchanged++;
    else if (inc.resume.updatedAt > mine.resume.updatedAt) {
      plan.resumes.put.push({ resume: { ...inc.resume, isDefault: mine.resume.isDefault }, sourceSha256: inc.sourceSha256 });
      count('resumes').updated++;
    } else count('resumes').skipped++;
  }
  for (const t of incoming.tombstones) {
    if (t.entity !== 'resume') continue;
    const mine = local.resumes.find((r) => r.resume.id === t.id);
    if (mine && mine.resume.updatedAt <= t.deletedAt) {
      plan.resumes.remove.push(t.id);
      count('resumes').deleted++;
    }
  }
  if (!local.resumes.length) plan.resumes.defaultId = incoming.resumes.find((r) => r.resume.isDefault)?.resume.id ?? null;

  // ---- Job sessions and company research (whole-record, newest wins) -----------------------------
  const sessionsByKey = new Map(local.sessions.map((s) => [s.jobKey, s]));
  for (const inc of incoming.sessions) {
    const tomb = tombFor('session', inc.jobKey);
    if (tomb && tomb.deletedAt >= inc.updatedAt) {
      count('sessions').skipped++;
      continue;
    }
    const s: JobSession = {
      ...inc,
      applicationId: resolveApp(inc.applicationId),
      resumeId: inc.resumeId ? resumeMap.get(inc.resumeId) ?? inc.resumeId : inc.resumeId,
    };
    const mine = sessionsByKey.get(s.jobKey);
    if (!mine) {
      plan.sessions.put.push(s);
      count('sessions').added++;
    } else if (same(mine, s)) count('sessions').unchanged++;
    else if (s.updatedAt > mine.updatedAt) {
      plan.sessions.put.push(s);
      count('sessions').updated++;
    } else count('sessions').skipped++;
  }
  for (const t of incoming.tombstones) {
    if (t.entity !== 'session') continue;
    const mine = sessionsByKey.get(t.id);
    if (mine && mine.updatedAt <= t.deletedAt && !plan.sessions.put.some((s) => s.jobKey === t.id)) {
      plan.sessions.remove.push(t.id);
      count('sessions').deleted++;
    }
  }
  const researchByKey = new Map(local.companyResearch.map((r) => [r.jobKey, r]));
  for (const inc of incoming.companyResearch) {
    const tomb = tombFor('session', inc.jobKey);
    if (tomb && tomb.deletedAt >= inc.updatedAt) {
      count('companyResearch').skipped++;
      continue;
    }
    const mine = researchByKey.get(inc.jobKey);
    if (!mine) {
      plan.research.put.push(inc);
      count('companyResearch').added++;
    } else if (same(mine.data, inc.data)) count('companyResearch').unchanged++;
    else if (inc.updatedAt > mine.updatedAt) {
      plan.research.put.push(inc);
      count('companyResearch').updated++;
    } else count('companyResearch').skipped++;
  }

  // ---- Profile ---------------------------------------------------------------------------------
  if (incoming.profile) {
    if (!local.profile) {
      plan.profile = incoming.profile;
      count('profile').added++;
    } else {
      const merged = mergeProfile(local.profile, incoming.profile);
      if (same(merged, local.profile)) count('profile').unchanged++;
      else {
        plan.profile = merged;
        count('profile').updated++;
      }
    }
  }

  // ---- Usage (each call has a global id, so totals are never double-counted) ---------------------
  const gids = new Set(local.usage.map((u) => u.gid));
  for (const u of incoming.usage) {
    if (!u.gid || gids.has(u.gid)) {
      count('usage').unchanged++;
      continue;
    }
    gids.add(u.gid);
    plan.usage.push({ ...u, applicationId: u.applicationId ? appAlias.resolve(u.applicationId) : null });
    count('usage').added++;
  }

  // ---- Preferences -----------------------------------------------------------------------------
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const localRem = isObj(local.kv[REMINDERS_KEY]) ? (local.kv[REMINDERS_KEY] as Record<string, unknown>) : {};
  const incRem = isObj(incoming.kv[REMINDERS_KEY]) ? (incoming.kv[REMINDERS_KEY] as Record<string, unknown>) : {};
  const rem = { ...localRem };
  let remChanged = false;
  for (const [id, r] of Object.entries(incRem)) {
    const appId = resolveApp(id);
    if (appId && !(appId in rem) && !(id in rem) && isObj(r) && typeof r.whenIso === 'string') {
      rem[appId] = { whenIso: r.whenIso, label: String(r.label ?? '') };
      remChanged = true;
    }
  }
  if (remChanged) plan.kv[REMINDERS_KEY] = rem;
  for (const k of Object.keys(incoming.kv)) {
    if (!k.startsWith(POSTING_MARKER_PREFIX)) continue;
    const appId = resolveApp(k.slice(POSTING_MARKER_PREFIX.length));
    if (appId && local.kv[POSTING_MARKER_PREFIX + appId] === undefined) plan.kv[POSTING_MARKER_PREFIX + appId] = true;
  }
  if (opt.applySettings && isObj(incoming.kv[SETTINGS_KEY])) {
    const theirs = { ...(incoming.kv[SETTINGS_KEY] as Record<string, unknown>) };
    for (const k of DEVICE_SETTINGS) delete theirs[k];
    const mine = isObj(local.kv[SETTINGS_KEY]) ? (local.kv[SETTINGS_KEY] as Record<string, unknown>) : {};
    plan.kv[SETTINGS_KEY] = { ...mine, ...theirs };
    report.settingsApplied = true;
  }

  return plan;
}

export function planIsEmpty(p: MergePlan): boolean {
  return (
    !p.apps.put.length &&
    !p.apps.renames.length &&
    !p.apps.remove.length &&
    !p.contacts.put.length &&
    !p.contacts.remove.length &&
    !p.documents.put.length &&
    !p.sessions.put.length &&
    !p.sessions.remove.length &&
    !p.research.put.length &&
    !p.resumes.put.length &&
    !p.resumes.remove.length &&
    !p.profile &&
    !p.usage.length &&
    !Object.keys(p.kv).length
  );
}
