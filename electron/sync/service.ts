import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION, Store } from '../db';
import {
  emptyReport,
  type SyncBackupInfo,
  SyncExportResult,
  SyncImportResult,
  SyncInspectResult,
  SyncLogEntry,
  SyncProgress,
  SyncReport,
  SyncSourceInfo,
} from '../../src/platform/syncTypes';
import { ArchiveError, FORMAT_ID, FORMAT_VERSION, isApplyFlowArchive, isEncryptedArchive, MAX_ARCHIVE_BYTES, readBundle, sha256, writeBundle, type ArchiveManifest } from './archive';
import { applyPlan, exportableKv, readLocal, sanitizeSnapshot } from './local';
import { mergeSnapshots, planIsEmpty, type MergePlan } from './merge';
import { SETTINGS_KEY, type Snapshot, type SyncSavedFile } from './types';

export const SYNC_EXTENSION = 'applyflow';
const MAX_FILE_BYTES = 256 * 1024 * 1024;
/** Only document-like files are ever written from an import. */
const RESTORABLE = /\.(pdf|docx?|txt|md|json|csv|rtf|odt|html?)$/i;
const AUTO_BACKUPS_KEPT = 15;
const LAST_EXPORT_META = 'sync.lastExportAt';

export interface SyncHost {
  store(): Store;
  /** Swaps in a reopened database after a restore. */
  replaceStore(next: Store): void;
  userDataDir: string;
  baseDir(): string;
  appVersion: string;
  deviceName: string;
  platform: string;
  progress(p: SyncProgress): void;
  /** Test hook: runs inside the import transaction just before it commits. */
  beforeCommit?: () => void;
}

class OpLog {
  readonly lines: string[] = [];
  constructor(readonly kind: string) {
    this.add(`ApplyFlow ${kind}`);
  }
  add(line: string): void {
    this.lines.push(`${new Date().toISOString()}  ${line}`);
  }
}

interface FilePlan {
  map: Map<string, string>;
  writes: { sha: string; path: string }[];
}

interface Pending {
  token: string;
  path: string;
  manifest: ArchiveManifest;
  incoming: Snapshot;
  files: Map<string, Buffer>;
  warnings: string[];
}

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function summarize(r: SyncReport): string {
  const e = r.entities.applications;
  const parts = [`Applications: ${e.added} new, ${e.updated} updated, ${e.merged} merged, ${e.deleted} deleted, ${e.unchanged} unchanged`];
  const others = (['contacts', 'documents', 'sessions', 'resumes'] as const)
    .map((k) => [k, r.entities[k].added + r.entities[k].updated + r.entities[k].merged] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`);
  if (others.length) parts.push(`also ${others.join(', ')} added or updated`);
  parts.push(`files: ${r.files.added} added, ${r.files.reused} already here`);
  const conflicts = Object.values(r.entities).reduce((n, c) => n + c.conflicts, 0);
  if (conflicts) parts.push(`${conflicts} conflict${conflicts === 1 ? '' : 's'} resolved`);
  return parts.join('; ');
}

export class SyncService {
  private pending: Pending | null = null;
  private busy = false;

  constructor(private readonly host: SyncHost) {}

  get backupsDir(): string {
    return join(this.host.userDataDir, 'backups');
  }
  get logsDir(): string {
    return join(this.host.userDataDir, 'sync-logs');
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('Another export, import or restore is still running.');
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }

  private progress(op: SyncProgress['op'], step: string, done = 0, total = 0): void {
    this.host.progress({ op, step, done, total });
  }

  private async writeLog(log: OpLog): Promise<string | null> {
    try {
      await mkdir(this.logsDir, { recursive: true });
      const p = join(this.logsDir, `${stamp()}-${log.kind}.txt`);
      await writeFile(p, `${log.lines.join('\n')}\n`, 'utf8');
      return p;
    } catch {
      return null;
    }
  }

  private record(kind: SyncLogEntry['kind'], ok: boolean, file: string | null, peer: string | null, summary: string, logPath: string | null, error: string | null): void {
    try {
      this.host
        .store()
        .db.prepare('INSERT INTO sync_log(at, kind, ok, file, peer, summary, log_path, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(new Date().toISOString(), kind, ok ? 1 : 0, file, peer, summary, logPath, error);
    } catch {
    }
  }

  history(limit = 100): SyncLogEntry[] {
    const rows = this.host.store().db.prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT ?').all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      at: String(r.at),
      kind: r.kind as SyncLogEntry['kind'],
      ok: Boolean(r.ok),
      file: (r.file as string | null) ?? null,
      peer: (r.peer as string | null) ?? null,
      summary: String(r.summary ?? ''),
      logPath: (r.log_path as string | null) ?? null,
      error: (r.error as string | null) ?? null,
    }));
  }

  // ---- Files ---------------------------------------------------------------------------------------

  private safeTarget(rel: string): string | null {
    const clean = normalize(String(rel).replace(/\\/g, '/').replace(/^[/\\]+/, ''));
    if (!clean || clean.startsWith('..') || isAbsolute(clean) || /(^|[/\\])\.\.([/\\]|$)/.test(clean) || /[\0:*?"<>|]/.test(clean.replace(/^[A-Za-z]:/, ''))) return null;
    const base = resolve(this.host.baseDir());
    const target = resolve(base, clean);
    const r = relative(base, target);
    if (!r || r.startsWith('..') || isAbsolute(r)) return null;
    return target;
  }

  /** The path of a stored file relative to the save folder, so another computer can put it in its own save folder. */
  private relativeFor(abs: string, hint: string | null | undefined): string {
    if (hint && this.safeTarget(hint)) return hint.replace(/\\/g, '/');
    const r = relative(resolve(this.host.baseDir()), resolve(abs));
    if (r && !r.startsWith('..') && !isAbsolute(r)) return r.replace(/\\/g, '/');
    return `ApplyFlow/Imported/${basename(abs)}`;
  }

  private async hashIfFile(p: string): Promise<{ sha: string; bytes: Buffer } | null> {
    try {
      const s = await stat(p);
      if (!s.isFile() || s.size > MAX_FILE_BYTES) return null;
      const bytes = await readFile(p);
      return { sha: sha256(bytes), bytes };
    } catch {
      return null;
    }
  }

  /** Decides where each incoming file goes, reusing identical files already on this computer. Writes nothing. */
  private async planFiles(local: Snapshot, incoming: Snapshot, available: Map<string, Buffer>, report: SyncReport): Promise<FilePlan> {
    const wanted = new Map<string, string>();
    for (const a of incoming.applications) for (const f of a.record.files as SyncSavedFile[]) if (f.sha256 && !wanted.has(f.sha256)) wanted.set(f.sha256, f.relativePath);
    for (const d of incoming.documents) if (d.fileSha256 && !wanted.has(d.fileSha256)) wanted.set(d.fileSha256, d.fileRelativePath ?? `ApplyFlow/Imported/${d.id.replace(/[^\w.-]+/g, '_')}.${d.format ?? 'pdf'}`);

    const sizes = new Set([...wanted.keys()].map((sha) => available.get(sha)?.length).filter((n): n is number => n !== undefined));
    const localIndex = new Map<string, string>();
    const localPaths = new Set<string>();
    for (const a of local.applications) for (const f of a.record.files) if (f.absolutePath) localPaths.add(f.absolutePath);
    for (const d of local.documents) if (d.filePath) localPaths.add(d.filePath);
    for (const p of localPaths) {
      try {
        const s = statSync(p);
        if (!s.isFile() || !sizes.has(s.size)) continue;
      } catch {
        continue;
      }
      const h = await this.hashIfFile(p);
      if (h && !localIndex.has(h.sha)) localIndex.set(h.sha, p);
    }

    const plan: FilePlan = { map: new Map(), writes: [] };
    const claimed = new Set<string>();
    for (const [sha, rel] of wanted) {
      const bytes = available.get(sha);
      if (!bytes) {
        report.files.missing++;
        continue;
      }
      const have = localIndex.get(sha);
      if (have) {
        plan.map.set(sha, have);
        report.files.reused++;
        continue;
      }
      const target = this.safeTarget(rel);
      if (!target || !RESTORABLE.test(target)) {
        report.files.skipped++;
        report.warnings.push(`Skipped a file with an unsafe name or type: ${String(rel).slice(0, 120)}`);
        continue;
      }
      const ext = extname(target);
      const stem = target.slice(0, target.length - ext.length);
      let chosen: string | null = null;
      for (let i = 0; i < 1000 && !chosen; i++) {
        const candidate = i === 0 ? target : `${stem} (${i})${ext}`;
        if (claimed.has(candidate.toLowerCase())) continue;
        if (!existsSync(candidate)) {
          chosen = candidate;
          break;
        }
        const h = await this.hashIfFile(candidate);
        if (h?.sha === sha) {
          plan.map.set(sha, candidate);
          report.files.reused++;
          break;
        }
      }
      if (plan.map.has(sha)) continue;
      if (!chosen) {
        report.files.skipped++;
        continue;
      }
      claimed.add(chosen.toLowerCase());
      plan.map.set(sha, chosen);
      plan.writes.push({ sha, path: chosen });
      if (chosen === target) report.files.added++;
      else report.files.renamed++;
    }
    return plan;
  }

  // ---- Export --------------------------------------------------------------------------------------

  async exportTo(filePath: string, password?: string | null): Promise<SyncExportResult> {
    return this.exclusive(async () => {
      const log = new OpLog('export');
      try {
        this.progress('export', 'Reading the database');
        const { snapshot, blobs } = readLocal(this.host.store());
        log.add(`Device ${snapshot.deviceId}; ${snapshot.applications.length} applications, ${snapshot.documents.length} documents, ${snapshot.contacts.length} contacts.`);

        const paths = new Map<string, string | null | undefined>();
        for (const a of snapshot.applications) for (const f of a.record.files) if (f.absolutePath) paths.set(f.absolutePath, f.relativePath);
        for (const d of snapshot.documents) if (d.filePath && !paths.has(d.filePath)) paths.set(d.filePath, null);
        const files = new Map<string, Buffer>(blobs);
        const refs = new Map<string, { sha: string; rel: string }>();
        let missing = 0;
        let i = 0;
        for (const [abs, hint] of paths) {
          this.progress('export', 'Collecting documents', ++i, paths.size);
          const h = await this.hashIfFile(abs);
          if (!h) {
            missing++;
            log.add(`Missing or unreadable, not included: ${abs}`);
            continue;
          }
          files.set(h.sha, h.bytes);
          refs.set(abs, { sha: h.sha, rel: this.relativeFor(abs, hint) });
        }

        const data: Snapshot = {
          ...snapshot,
          applications: snapshot.applications.map((a) => ({
            record: {
              ...a.record,
              files: a.record.files.map((f) => {
                const ref = f.absolutePath ? refs.get(f.absolutePath) : undefined;
                return { ...f, absolutePath: null, sha256: ref?.sha ?? null } as SyncSavedFile;
              }),
            },
            clock: a.clock,
            syncedAt: null,
          })),
          documents: snapshot.documents.map((d) => {
            const ref = d.filePath ? refs.get(d.filePath) : undefined;
            return { ...d, filePath: null, fileSha256: ref?.sha ?? null, fileRelativePath: ref?.rel ?? null };
          }),
          kv: exportableKv(snapshot.kv),
        };
        const counts = {
          applications: data.applications.length,
          contacts: data.contacts.length,
          documents: data.documents.length,
          sessions: data.sessions.length,
          resumes: data.resumes.length,
          usage: data.usage.length,
          deletions: data.tombstones.length,
        };
        const exportedAt = new Date().toISOString();
        this.progress('export', 'Compressing');
        const buf = await writeBundle(
          {
            format: FORMAT_ID,
            formatVersion: FORMAT_VERSION,
            appVersion: this.host.appVersion,
            schemaVersion: SCHEMA_VERSION,
            exportedAt,
            device: { id: snapshot.deviceId, name: this.host.deviceName, platform: this.host.platform },
            counts,
          },
          data,
          files,
          password,
        );
        if (buf.length > MAX_ARCHIVE_BYTES) throw new Error('The export is larger than ApplyFlow can import on another computer.');

        this.progress('export', 'Checking the file');
        const check = await readBundle(buf, password);
        if ((check.data as Snapshot).applications.length !== counts.applications || check.files.size !== files.size) throw new Error('The export did not pass its own check. Nothing was saved.');

        this.progress('export', 'Saving');
        const part = `${filePath}.part`;
        await writeFile(part, buf);
        await rename(part, filePath);
        this.host.store().metaSet(LAST_EXPORT_META, exportedAt);
        log.add(`Wrote ${buf.length} bytes with ${files.size} files (${missing} missing) to ${filePath}${password ? ' (password protected)' : ''}.`);
        const logPath = await this.writeLog(log);
        const summary = `${counts.applications} applications, ${files.size} files${missing ? `, ${missing} missing files skipped` : ''}${password ? ', password protected' : ''}`;
        this.record('export', true, filePath, null, summary, logPath, null);
        return { path: filePath, bytes: buf.length, counts, files: files.size, missingFiles: missing, encrypted: Boolean(password) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.add(`FAILED: ${msg}`);
        await rm(`${filePath}.part`, { force: true }).catch(() => undefined);
        this.record('export', false, filePath, null, 'Export failed', await this.writeLog(log), msg);
        throw new Error(`Export failed: ${msg}`);
      } finally {
        this.progress('export', 'Done', 1, 1);
      }
    });
  }

  // ---- Import --------------------------------------------------------------------------------------

  private sourceInfo(m: ArchiveManifest, encrypted: boolean): SyncSourceInfo {
    return {
      deviceId: String(m.device?.id ?? ''),
      deviceName: String(m.device?.name ?? 'Unknown computer'),
      platform: String(m.device?.platform ?? ''),
      appVersion: String(m.appVersion ?? ''),
      schemaVersion: Number(m.schemaVersion ?? 0),
      exportedAt: String(m.exportedAt ?? ''),
      encrypted,
      sameDevice: m.device?.id === this.host.store().deviceId,
      counts: (m.counts ?? {}) as Record<string, number>,
    };
  }

  private async computePlan(p: Pending, applySettings: boolean): Promise<{ plan: MergePlan; files: FilePlan; blobs: Map<string, Buffer> }> {
    const store = this.host.store();
    const { snapshot: local } = readLocal(store);
    const report0 = emptyReport();
    const files = await this.planFiles(local, p.incoming, p.files, report0);
    const plan = mergeSnapshots(local, p.incoming, {
      now: new Date().toISOString(),
      fileFor: (sha) => (sha ? files.map.get(sha) ?? null : null),
      applySettings,
      lastExportAt: store.metaGet(LAST_EXPORT_META),
    });
    plan.report.files = report0.files;
    plan.report.warnings.push(...p.warnings, ...report0.warnings);
    const blobs = new Map<string, Buffer>();
    for (const r of p.incoming.resumes) if (r.sourceSha256 && p.files.has(r.sourceSha256)) blobs.set(r.sourceSha256, p.files.get(r.sourceSha256)!);
    return { plan, files, blobs };
  }

  async inspect(path: string, password?: string | null): Promise<SyncInspectResult> {
    return this.exclusive(async () => {
      this.pending = null;
      try {
        this.progress('inspect', 'Reading the file');
        const s = await stat(path);
        if (s.size > MAX_ARCHIVE_BYTES) return { status: 'error', path, message: 'The file is larger than ApplyFlow can import.' };
        const head = Buffer.alloc(16);
        const fh = await open(path, 'r');
        try {
          await fh.read(head, 0, 16, 0);
        } finally {
          await fh.close();
        }
        if (!isApplyFlowArchive(head)) return { status: 'error', path, message: 'This is not an ApplyFlow data file.' };
        const encrypted = isEncryptedArchive(head);
        if (encrypted && !password) return { status: 'password-required', path };
        const buf = await readFile(path);
        this.progress('inspect', encrypted ? 'Decrypting and checking' : 'Checking');
        const opened = await readBundle(buf, password);
        const warnings: string[] = [];
        const incoming = sanitizeSnapshot(opened.data, warnings);
        if (opened.manifest.schemaVersion > SCHEMA_VERSION) warnings.push(`The file came from a newer ApplyFlow (${opened.manifest.appVersion}). Data this version does not understand is kept as it is.`);
        const pending: Pending = { token: randomUUID(), path, manifest: opened.manifest, incoming, files: opened.files, warnings };
        this.progress('inspect', 'Comparing with this computer');
        const { plan } = await this.computePlan(pending, false);
        this.pending = pending;
        return {
          status: 'ready',
          path,
          token: pending.token,
          source: this.sourceInfo(opened.manifest, encrypted),
          report: plan.report,
          hasSettings: Boolean(incoming.kv[SETTINGS_KEY]),
        };
      } catch (e) {
        if (e instanceof ArchiveError && e.code === 'password-required') return { status: 'password-required', path };
        if (e instanceof ArchiveError && e.code === 'bad-password') return { status: 'password-required', path, message: e.message };
        return { status: 'error', path, message: e instanceof Error ? e.message : String(e) };
      } finally {
        this.progress('inspect', 'Done', 1, 1);
      }
    });
  }

  discard(token: string): void {
    if (this.pending?.token === token) this.pending = null;
  }

  async apply(token: string, opts: { applySettings: boolean }): Promise<SyncImportResult> {
    return this.exclusive(async () => {
      const p = this.pending;
      if (!p || p.token !== token) throw new Error('The import preview has expired. Choose the file again.');
      const log = new OpLog('import');
      const peer = `${p.manifest.device?.name ?? 'Unknown'} (${String(p.manifest.device?.id ?? '').slice(0, 8)})`;
      log.add(`File ${p.path}, exported ${p.manifest.exportedAt} by ApplyFlow ${p.manifest.appVersion} on ${peer}.`);
      const written: string[] = [];
      let backup: SyncBackupInfo | null = null;
      try {
        this.progress('import', 'Backing up this computer’s data');
        backup = await this.backupInternal('before-import');
        log.add(`Backup: ${backup.path}`);

        this.progress('import', 'Planning the merge');
        const { plan, files, blobs } = await this.computePlan(p, opts.applySettings);

        let i = 0;
        for (const w of files.writes) {
          this.progress('import', 'Restoring documents', ++i, files.writes.length);
          const bytes = p.files.get(w.sha)!;
          await mkdir(dirname(w.path), { recursive: true });
          const part = `${w.path}.applyflow-part`;
          await writeFile(part, bytes);
          if (existsSync(w.path)) {
            await rm(part, { force: true });
            throw new Error(`A file appeared while importing, so it was not overwritten: ${w.path}`);
          }
          await rename(part, w.path);
          written.push(w.path);
          log.add(`Restored ${w.path}`);
        }

        this.progress('import', 'Merging records');
        if (!planIsEmpty(plan) || plan.apps.touched.length || plan.tombstones.length || plan.aliases.length) {
          applyPlan(this.host.store(), plan, blobs, new Date().toISOString(), this.host.beforeCommit);
        }
        for (const c of plan.report.conflicts) log.add(`Conflict: ${c.label}${c.field ? ` [${c.field}]` : ''}: here “${c.local ?? ''}”, other “${c.incoming ?? ''}”. ${c.resolution}`);
        for (const w of plan.report.warnings) log.add(`Warning: ${w}`);
        const summary = summarize(plan.report);
        log.add(summary);
        const logPath = await this.writeLog(log);
        this.record('import', true, p.path, peer, summary, logPath, null);
        this.pending = null;
        return { report: plan.report, backup, logPath };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.add(`FAILED: ${msg}. The database was left unchanged.`);
        for (const w of written) {
          await rm(w, { force: true }).catch(() => undefined);
          log.add(`Removed ${w}`);
        }
        const logPath = await this.writeLog(log);
        this.record('import', false, p.path, peer, 'Import failed; nothing was changed', logPath, msg);
        throw new Error(`Import failed and nothing was changed: ${msg}${backup ? ` A backup from just before the import is in ${backup.path}.` : ''}`);
      } finally {
        this.progress('import', 'Done', 1, 1);
      }
    });
  }

  // ---- Backups -------------------------------------------------------------------------------------

  private async backupInternal(reason: string): Promise<SyncBackupInfo> {
    mkdirSync(this.backupsDir, { recursive: true });
    const name = `applyflow-${stamp()}-${reason.replace(/[^a-z-]/g, '')}.sqlite`;
    const target = join(this.backupsDir, name);
    if (existsSync(target)) await rm(target, { force: true });
    this.host.store().db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    this.prune();
    const s = statSync(target);
    return { name, path: target, createdAt: new Date().toISOString(), bytes: s.size, reason };
  }

  private prune(): void {
    const auto = this.listBackups().filter((b) => b.reason !== 'manual');
    for (const b of auto.slice(AUTO_BACKUPS_KEPT)) void rm(b.path, { force: true }).catch(() => undefined);
  }

  listBackups(): SyncBackupInfo[] {
    if (!existsSync(this.backupsDir)) return [];
    const out: SyncBackupInfo[] = [];
    for (const name of readdirSync(this.backupsDir)) {
      const m = /^applyflow-(\d{8}T\d{6}Z)-([a-z-]+)\.sqlite$/.exec(name);
      if (!m) continue;
      const p = join(this.backupsDir, name);
      try {
        const s = statSync(p);
        const t = m[1]!;
        const iso = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}Z`;
        out.push({ name, path: p, createdAt: iso, bytes: s.size, reason: m[2]! });
      } catch {
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
  }

  async backupNow(): Promise<SyncBackupInfo> {
    return this.exclusive(async () => {
      this.progress('backup', 'Backing up');
      try {
        const b = await this.backupInternal('manual');
        this.record('backup', true, b.path, null, `Backup ${b.name}`, null, null);
        return b;
      } finally {
        this.progress('backup', 'Done', 1, 1);
      }
    });
  }

  /** Replaces the database with a backup. The current database is backed up first, so this can be undone. */
  async restore(name: string): Promise<{ restored: SyncBackupInfo; safetyBackup: SyncBackupInfo }> {
    return this.exclusive(async () => {
      const source = this.listBackups().find((b) => b.name === basename(name));
      if (!source) throw new Error('That backup no longer exists.');
      this.progress('restore', 'Checking the backup');
      try {
        const check = new DatabaseSync(source.path, { readOnly: true });
        try {
          const ok = (check.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined)?.integrity_check;
          if (ok !== 'ok') throw new Error('The backup is damaged.');
          check.prepare('SELECT COUNT(*) AS n FROM applications').get();
        } finally {
          check.close();
        }
      } catch (e) {
        throw new Error(`That backup cannot be restored: ${e instanceof Error ? e.message : String(e)}`);
      }
      this.progress('restore', 'Backing up the current data');
      const safety = await this.backupInternal('before-restore');
      const dbPath = this.host.store().path;
      this.progress('restore', 'Restoring');
      this.host.store().close();
      let failure: unknown = null;
      try {
        const part = `${dbPath}.restore-part`;
        await copyFile(source.path, part);
        await rm(`${dbPath}-wal`, { force: true });
        await rm(`${dbPath}-shm`, { force: true });
        await rename(part, dbPath);
      } catch (e) {
        failure = e;
      }
      this.host.replaceStore(new Store(dbPath));
      this.progress('restore', 'Done', 1, 1);
      if (failure) {
        const msg = failure instanceof Error ? failure.message : String(failure);
        this.record('restore', false, source.path, null, 'Restore failed; the data was left as it was', null, msg);
        throw new Error(`Restore failed and your data was left as it was: ${msg}`);
      }
      this.record('restore', true, source.path, null, `Restored ${source.name}; the data from before is in ${safety.name}`, null, null);
      return { restored: source, safetyBackup: safety };
    });
  }
}
