// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Store } from '../../electron/db';
import { SyncService } from '../../electron/sync/service';
import { ArchiveError, packArchive, readBundle, unpackArchive, writeBundle } from '../../electron/sync/archive';
import { recordFromSession } from '@/services/history/history';
import type { ApplicationRecord, ApplicationStage, JobSession } from '@/types';

const dirs: string[] = [];
const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) d.store.close();
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
    }
  }
});

const pause = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function session(jobKey: string, company: string, title: string, description = 'Build data pipelines.'): JobSession {
  const now = new Date().toISOString();
  return {
    jobKey,
    job: {
      jobKey, platform: 'dice', jobId: jobKey, url: `https://www.dice.com/job-detail/${jobKey.replace(/^dice:/, '')}`, applicationUrl: null, title, company, location: 'Chicago, IL', remoteStatus: 'onsite',
      salary: null, employmentType: null, contractDuration: null, datePosted: null, description, requiredSkills: ['Kafka'], preferredSkills: [], responsibilities: [], qualifications: [], benefits: [],
      educationRequirements: [], clearanceRequirements: [], workAuthorizationRequirements: [], sponsorshipLanguage: [], externalApply: false,
    },
    extraction: { confidence: {}, sources: ['structured-data'], uncertain: false, warnings: [] },
    jobConfirmed: true, resumeId: null, analysis: null, evidence: [], masterScore: null, tailoredScore: null, resume: null, coverLetter: null,
    resumeReviewed: false, coverLetterReviewed: false, includeCoverLetter: true, fieldProposals: [], lastScanUrl: null, duplicateAcknowledged: false,
    applicationId: null, submittedAt: null, createdAt: now, updatedAt: now,
  };
}

interface Device {
  name: string;
  root: string;
  base: string;
  store: Store;
  sync: SyncService;
  failNextCommit: boolean;
}

function device(name: string): Device {
  const root = mkdtempSync(join(tmpdir(), `af-sync-${name}-`));
  dirs.push(root);
  const base = join(root, 'Documents');
  mkdirSync(base, { recursive: true });
  const dev = { name, root, base, store: new Store(join(root, 'applyflow.sqlite')), failNextCommit: false } as Device;
  dev.sync = new SyncService({
    store: () => dev.store,
    replaceStore: (s) => {
      dev.store = s;
    },
    userDataDir: root,
    baseDir: () => base,
    appVersion: 'test',
    deviceName: name,
    platform: 'test',
    progress: () => undefined,
    beforeCommit: () => {
      if (dev.failNextCommit) {
        dev.failNextCommit = false;
        throw new Error('simulated crash');
      }
    },
  });
  devices.push(dev);
  return dev;
}

function apply(dev: Device, jobKey: string, company: string, title: string, stage: ApplicationStage = 'Applied', description?: string): ApplicationRecord {
  const s = dev.store.saveSession(session(jobKey, company, title, description));
  return dev.store.saveApplication(recordFromSession(s, stage));
}

async function exportFrom(dev: Device, password: string | null = null): Promise<string> {
  const p = join(dev.root, `export-${Date.now()}-${Math.random().toString(36).slice(2)}.applyflow`);
  await dev.sync.exportTo(p, password);
  return p;
}

async function importInto(dev: Device, file: string, password: string | null = null) {
  const r = await dev.sync.inspect(file, password);
  if (r.status !== 'ready') throw new Error(`inspect failed: ${JSON.stringify(r)}`);
  const out = await dev.sync.apply(r.token, { applySettings: false });
  return { preview: r.report, result: out.report };
}

const jobKeys = (dev: Device) => dev.store.listApplications().map((a) => a.jobKey).sort();
const ids = (dev: Device) => dev.store.listApplications().map((a) => a.id).sort();

describe('.applyflow archive', () => {
  it('round-trips data and files, with and without a password', async () => {
    const pdf = Buffer.from('%PDF-1.7 test');
    const { createHash } = await import('node:crypto');
    const sha = createHash('sha256').update(pdf).digest('hex');
    const files = new Map([[sha, pdf]]);
    const manifest = { format: 'applyflow-sync' as const, formatVersion: 1, appVersion: 't', schemaVersion: 2, exportedAt: 'now', device: { id: 'd', name: 'n', platform: 'p' }, counts: {} };
    for (const pw of [null, 'correct horse battery']) {
      const buf = await writeBundle(manifest, { hello: 'world' }, files, pw);
      const opened = await readBundle(buf, pw);
      expect(opened.data).toEqual({ hello: 'world' });
      expect(opened.files.get(sha)!.equals(pdf)).toBe(true);
    }
    const enc = await writeBundle(manifest, { secret: 1 }, files, 'pw-one-two');
    expect(enc.includes(Buffer.from('secret'))).toBe(false);
    await expect(readBundle(enc, null)).rejects.toMatchObject({ code: 'password-required' });
    await expect(readBundle(enc, 'wrong password')).rejects.toMatchObject({ code: 'bad-password' });
    const tampered = Buffer.from(enc);
    tampered[tampered.length - 40]! ^= 0xff;
    await expect(readBundle(tampered, 'pw-one-two')).rejects.toMatchObject({ code: 'bad-password' });
  });

  it('rejects damaged files and entries that try to escape', async () => {
    await expect(unpackArchive(Buffer.from('PK\u0003\u0004 not ours'))).rejects.toMatchObject({ code: 'not-applyflow' });
    const plain = await packArchive([{ name: 'data.json', data: Buffer.from('{}') }]);
    const cut = plain.subarray(0, plain.length - 6);
    await expect(unpackArchive(cut)).rejects.toBeInstanceOf(ArchiveError);
    const name = Buffer.from('../evil.txt');
    const entry = Buffer.alloc(2 + name.length + 8);
    entry.writeUInt16BE(name.length, 0);
    name.copy(entry, 2);
    entry.writeBigUInt64BE(1n, 2 + name.length);
    const evil = Buffer.concat([Buffer.from('APPLYFLW'), Buffer.from([1, 0]), gzipSync(Buffer.concat([entry, Buffer.from('x')]))]);
    await expect(unpackArchive(evil)).rejects.toMatchObject({ code: 'corrupt' });
    const newer = Buffer.concat([Buffer.from('APPLYFLW'), Buffer.from([9, 0]), gzipSync(Buffer.alloc(0))]);
    await expect(unpackArchive(newer)).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('offline sync between computers', () => {
  it('combines three computers into one history without duplicates, and repeated imports change nothing', async () => {
    const a = device('A');
    const b = device('B');
    const c = device('C');
    apply(a, 'dice:1', 'Acme', 'Data Engineer');
    apply(a, 'dice:2', 'Globex', 'Platform Engineer');
    apply(b, 'dice:2', 'Globex', 'Platform Engineer');
    apply(b, 'dice:3', 'Initech', 'SRE');
    apply(c, 'dice:3', 'Initech', 'SRE');
    apply(c, 'dice:4', 'Umbrella', 'Architect');

    const fb = await exportFrom(b);
    const fc = await exportFrom(c);
    const r1 = await importInto(a, fb);
    expect(r1.result.entities.applications).toMatchObject({ added: 1, merged: 1 });
    await importInto(a, fc);
    expect(jobKeys(a)).toEqual(['dice:1', 'dice:2', 'dice:3', 'dice:4']);

    const again = await importInto(a, fb);
    expect(again.result.entities.applications.added).toBe(0);
    expect(again.result.entities.applications.updated).toBe(0);
    expect(jobKeys(a)).toHaveLength(4);

    // Back to B and C: everyone converges on the same records and the same identifiers.
    const fa = await exportFrom(a);
    await importInto(b, fa);
    await importInto(c, fa);
    expect(jobKeys(b)).toEqual(jobKeys(a));
    expect(jobKeys(c)).toEqual(jobKeys(a));
    expect(ids(b)).toEqual(ids(a));
    expect(ids(c)).toEqual(ids(a));
    const fb2 = await exportFrom(b);
    const echo = await importInto(a, fb2);
    expect(echo.result.entities.applications).toMatchObject({ added: 0, updated: 0, merged: 0, deleted: 0 });
  });

  it('merges 100 + 150 + 200 applications with overlaps into exactly the unique set', async () => {
    const a = device('A');
    const b = device('B');
    const c = device('C');
    const fill = (d: Device, from: number, to: number) => {
      for (let i = from; i < to; i++) apply(d, `dice:${i}`, `Company ${i}`, `Role ${i}`);
    };
    fill(a, 0, 100);
    fill(b, 50, 200);
    fill(c, 150, 350);
    await importInto(a, await exportFrom(b));
    await importInto(a, await exportFrom(c));
    expect(a.store.listApplications()).toHaveLength(350);
    await importInto(c, await exportFrom(a));
    expect(c.store.listApplications()).toHaveLength(350);
    expect(ids(c)).toEqual(ids(a));
  }, 60_000);

  it('carries deletions both ways and an old export does not bring a deleted application back', async () => {
    const a = device('A');
    const b = device('B');
    apply(a, 'dice:1', 'Acme', 'Data Engineer');
    const doomed = apply(a, 'dice:9', 'Hooli', 'ML Engineer');
    const oldExport = await exportFrom(a);
    await importInto(b, oldExport);
    expect(jobKeys(b)).toEqual(['dice:1', 'dice:9']);

    await pause();
    b.store.deleteApplication(doomed.id);
    const fromB = await exportFrom(b);
    const r = await importInto(a, fromB);
    expect(r.result.entities.applications.deleted).toBe(1);
    expect(jobKeys(a)).toEqual(['dice:1']);

    const stale = await importInto(a, oldExport);
    expect(stale.result.entities.applications.skipped).toBe(1);
    expect(jobKeys(a)).toEqual(['dice:1']);
  });

  it('keeps the most recent status change, merges notes and status history, and reports the conflict', async () => {
    const a = device('A');
    const b = device('B');
    const ra = apply(a, 'dice:5', 'Acme', 'Data Engineer', 'Applied');
    await importInto(b, await exportFrom(a));
    const rb = b.store.getApplication(ra.id)!;

    await pause();
    b.store.saveApplication({ ...rb, stage: 'Rejected', stageHistory: [...rb.stageHistory, { stage: 'Rejected', at: new Date().toISOString() }], notes: [{ id: 'n-b', text: 'Auto reject email', createdAt: new Date().toISOString() }] });
    await pause();
    const cur = a.store.getApplication(ra.id)!;
    a.store.saveApplication({ ...cur, stage: 'Interview', stageHistory: [...cur.stageHistory, { stage: 'Interview', at: new Date().toISOString() }], notes: [{ id: 'n-a', text: 'Recruiter called', createdAt: new Date().toISOString() }] });

    const r = await importInto(a, await exportFrom(b));
    const merged = a.store.getApplication(ra.id)!;
    expect(merged.stage).toBe('Interview');
    expect(merged.notes.map((n) => n.id).sort()).toEqual(['n-a', 'n-b']);
    expect(merged.stageHistory.map((h) => h.stage)).toEqual(expect.arrayContaining(['Rejected', 'Interview']));
    expect(r.result.conflicts.some((c) => c.field === 'stage')).toBe(true);

    await importInto(b, await exportFrom(a));
    expect(b.store.getApplication(ra.id)!.stage).toBe('Interview');
    expect(b.store.getApplication(ra.id)!.notes).toHaveLength(2);
  });

  it('restores resume files into this computer’s folder, reuses identical files and keeps documents openable', async () => {
    const a = device('A');
    const b = device('B');
    const rec = apply(a, 'dice:7', 'Acme', 'Data Engineer');
    const rel = 'ApplyFlow/Acme/2026-11-06_Data Engineer/resume_tailored.pdf';
    const abs = join(a.base, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, Buffer.from('%PDF-1.7 tailored resume'));
    a.store.saveApplication({ ...rec, files: [{ kind: 'resume', format: 'pdf', relativePath: rel, absolutePath: abs, downloadId: null, state: 'complete' }] });
    a.store.upsertDocument({ applicationId: rec.id, jobKey: 'dice:7', kind: 'resume', version: 1, json: '{"v":1}', engine: 'claude', model: 'm', filePath: abs, format: 'pdf' });

    const f = await exportFrom(a);
    const r = await importInto(b, f);
    expect(r.result.files.added).toBe(1);
    const target = join(b.base, rel);
    expect(readFileSync(target, 'utf8')).toBe('%PDF-1.7 tailored resume');
    expect(b.store.getApplication(rec.id)!.files[0]!.absolutePath).toBe(target);
    expect(b.store.listDocuments({ applicationId: rec.id })[0]!.filePath).toBe(target);

    const again = await importInto(b, f);
    expect(again.result.files).toMatchObject({ added: 0, reused: 1 });
    expect(readdirSync(join(target, '..'))).toEqual(['resume_tailored.pdf']);
  });

  it('keeps both versions when two computers wrote different documents with the same version number', async () => {
    const a = device('A');
    const b = device('B');
    apply(a, 'dice:8', 'Acme', 'Engineer');
    apply(b, 'dice:8', 'Acme', 'Engineer');
    a.store.upsertDocument({ applicationId: null, jobKey: 'dice:8', kind: 'resume', version: 1, json: '{"from":"A"}', engine: null, model: null });
    b.store.upsertDocument({ applicationId: null, jobKey: 'dice:8', kind: 'resume', version: 1, json: '{"from":"B"}', engine: null, model: null });
    await importInto(a, await exportFrom(b));
    expect(a.store.listDocuments({ jobKey: 'dice:8' }).map((d) => d.json).sort()).toEqual(['{"from":"A"}', '{"from":"B"}']);
    await importInto(a, await exportFrom(b));
    expect(a.store.listDocuments({ jobKey: 'dice:8' })).toHaveLength(2);
  });

  it('does not duplicate recruiter contacts found on both computers or double-count usage', async () => {
    const a = device('A');
    const b = device('B');
    const desc = 'Call Dana at (312) 555-0147 or dana@acme-example.com.';
    apply(a, 'dice:11', 'Acme', 'Engineer', 'Applied', desc);
    apply(b, 'dice:11', 'Acme', 'Engineer', 'Applied', desc);
    const u = { jobKey: 'dice:11', applicationId: null, task: 'resume', model: 'm', inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10 };
    a.store.addUsage(u);
    a.store.addUsage(u);
    b.store.addUsage(u);
    const fa = await exportFrom(a);
    await importInto(b, fa);
    await importInto(b, fa);
    const app = b.store.listApplications();
    expect(app).toHaveLength(1);
    expect(b.store.listContacts(app[0]!.id)).toHaveLength(2);
    expect(b.store.usageSummary({}).calls).toBe(3);
    expect(b.store.search('555-0147').map((h) => h.application.jobKey)).toEqual(['dice:11']);
  });

  it('leaves the database and the documents folder untouched when an import fails part-way', async () => {
    const a = device('A');
    const b = device('B');
    const rec = apply(a, 'dice:12', 'Acme', 'Engineer');
    const rel = 'ApplyFlow/Acme/cover_letter.pdf';
    mkdirSync(join(a.base, 'ApplyFlow/Acme'), { recursive: true });
    writeFileSync(join(a.base, rel), 'cover');
    a.store.saveApplication({ ...rec, files: [{ kind: 'cover_letter', format: 'pdf', relativePath: rel, absolutePath: join(a.base, rel), downloadId: null, state: 'complete' }] });
    apply(b, 'dice:13', 'Other', 'Job');
    const f = await exportFrom(a);
    const preview = await b.sync.inspect(f, null);
    if (preview.status !== 'ready') throw new Error('no preview');
    b.failNextCommit = true;
    await expect(b.sync.apply(preview.token, { applySettings: false })).rejects.toThrow(/nothing was changed/);
    expect(jobKeys(b)).toEqual(['dice:13']);
    expect(existsSync(join(b.base, rel))).toBe(false);
    expect(b.sync.history()[0]).toMatchObject({ kind: 'import', ok: false });
    expect(b.sync.listBackups().some((x) => x.reason === 'before-import')).toBe(true);
  });

  it('opens password-protected exports only with the password and restores a backup', async () => {
    const a = device('A');
    const b = device('B');
    apply(a, 'dice:20', 'Acme', 'Engineer');
    apply(b, 'dice:21', 'Initech', 'Engineer');
    const f = await exportFrom(a, 'a long password');
    expect((await b.sync.inspect(f, null)).status).toBe('password-required');
    const bad = await b.sync.inspect(f, 'nope');
    expect(bad.status).toBe('password-required');
    await importInto(b, f, 'a long password');
    expect(jobKeys(b)).toEqual(['dice:20', 'dice:21']);

    const before = b.sync.listBackups().find((x) => x.reason === 'before-import')!;
    await b.sync.restore(before.name);
    expect(jobKeys(b)).toEqual(['dice:21']);
    expect(b.sync.listBackups().some((x) => x.reason === 'before-restore')).toBe(true);
  });

  it('upgrades a database from 2.3.2 and syncs its existing records', async () => {
    const root = mkdtempSync(join(tmpdir(), 'af-sync-old-'));
    dirs.push(root);
    const path = join(root, 'applyflow.sqlite');
    const { DatabaseSync } = await import('node:sqlite');
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta VALUES ('schema', '1');
      CREATE TABLE applications (id TEXT PRIMARY KEY, job_key TEXT, company TEXT, title TEXT, location TEXT, stage TEXT,
        job_url TEXT, date_prepared TEXT, date_applied TEXT, follow_up_date TEXT, data TEXT NOT NULL, updated_at TEXT);
      CREATE TABLE contacts (id TEXT PRIMARY KEY, application_id TEXT NOT NULL, name TEXT, role TEXT, phone TEXT,
        phone_digits TEXT, email TEXT, source TEXT, created_at TEXT);
      CREATE TABLE usage (id INTEGER PRIMARY KEY AUTOINCREMENT, job_key TEXT, application_id TEXT, task TEXT, model TEXT,
        input_tokens INTEGER, cache_read INTEGER, cache_write INTEGER, output_tokens INTEGER, at TEXT);
      INSERT INTO usage(task, model, input_tokens, cache_read, cache_write, output_tokens, at) VALUES ('resume', 'm', 1, 0, 0, 1, '2026-01-01T00:00:00.000Z');
    `);
    const legacy = { id: 'app_legacy', jobKey: 'dice:legacy', title: 'Old Role', company: 'Oldco', stage: 'Applied', datePrepared: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    old.prepare('INSERT INTO applications(id, job_key, company, title, stage, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(legacy.id, legacy.jobKey, legacy.company, legacy.title, legacy.stage, JSON.stringify(legacy), legacy.updatedAt);
    old.prepare("INSERT INTO contacts(id, application_id, name, created_at) VALUES ('ct_1', 'app_legacy', 'Dana', '2026-01-01T00:00:00.000Z')").run();
    old.close();

    const upgraded = new Store(path);
    try {
      expect(upgraded.deviceId).toMatch(/^[0-9a-f-]{36}$/);
      expect((upgraded.db.prepare('SELECT gid FROM usage').get() as { gid: string }).gid).toBe(`${upgraded.deviceId}:1`);
      expect(upgraded.metaGet('schema')).toBe('2');
      const b = device('B');
      const tmp = device('tmp');
      tmp.store.close();
      tmp.store = upgraded;
      devices.splice(devices.indexOf(tmp), 1);
      await importInto(b, await exportFrom(tmp));
      expect(b.store.getApplication('app_legacy')!.company).toBe('Oldco');
      expect(b.store.listContacts('app_legacy').map((c) => c.name)).toEqual(['Dana']);
    } finally {
      upgraded.close();
    }
  });

  it('never exports secrets', async () => {
    const a = device('A');
    a.store.kvSet('applyflow.secret.anthropicApiKey.enc', { v: 'SECRET-KEY', enc: false });
    a.store.saveSiteCredential({ host: 'dice.com', url: 'https://dice.com', email: 'me@example.com', password: 'hunter2-password', updatedAt: '' });
    a.store.kvSet('applyflow.settings.v1', { saveLocation: 'C:\\Users\\me\\Docs', resumeOutputFormats: ['pdf'] });
    const f = await exportFrom(a);
    const opened = await readBundle(readFileSync(f));
    const text = JSON.stringify(opened.data);
    expect(text).not.toContain('SECRET-KEY');
    expect(text).not.toContain('hunter2-password');
    expect(text).not.toContain('C:\\\\Users\\\\me');
    expect(text).toContain('resumeOutputFormats');
  });
});
