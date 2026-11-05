import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { CompanyResearchReply } from '../src/prompts/companyResearch';
import type { ApplicationRecord, CareerProfile, JobSession, MasterResume, SiteCredential } from '../src/types';
import type { Contact, SearchHit, StoredDocument, StoredDocumentInput, UsageInput, UsageSummary } from '../src/platform/bridge';
import { extractContacts, formatPhone, phoneDigits } from '../src/utils/contacts';
import { withSyncedLocation } from '../src/utils/address';

const SCHEMA_VERSION = 1;

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
const rid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function parse<T>(s: unknown): T {
  return JSON.parse(String(s)) as T;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(readonly path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS resumes (
        id TEXT PRIMARY KEY, name TEXT, is_default INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL, source_data BLOB, created_at TEXT, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS profile (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (job_key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS company_research (job_key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS applications (
        id TEXT PRIMARY KEY, job_key TEXT, company TEXT, title TEXT, location TEXT, stage TEXT,
        job_url TEXT, date_prepared TEXT, date_applied TEXT, follow_up_date TEXT,
        data TEXT NOT NULL, updated_at TEXT);
      CREATE INDEX IF NOT EXISTS applications_job_key ON applications(job_key);
      CREATE INDEX IF NOT EXISTS applications_company ON applications(company COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, application_id TEXT, job_key TEXT NOT NULL, kind TEXT NOT NULL,
        version INTEGER NOT NULL, format TEXT, file_path TEXT, json TEXT NOT NULL,
        engine TEXT, model TEXT, sent_at TEXT, created_at TEXT, updated_at TEXT);
      CREATE INDEX IF NOT EXISTS documents_job ON documents(job_key);
      CREATE INDEX IF NOT EXISTS documents_app ON documents(application_id);
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY, application_id TEXT NOT NULL, name TEXT, role TEXT, phone TEXT,
        phone_digits TEXT, email TEXT, source TEXT, created_at TEXT);
      CREATE INDEX IF NOT EXISTS contacts_app ON contacts(application_id);
      CREATE INDEX IF NOT EXISTS contacts_phone ON contacts(phone_digits);
      CREATE TABLE IF NOT EXISTS usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_key TEXT, application_id TEXT, task TEXT, model TEXT,
        input_tokens INTEGER, cache_read INTEGER, cache_write INTEGER, output_tokens INTEGER, at TEXT);
      CREATE TABLE IF NOT EXISTS site_credentials (
        host TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        email TEXT NOT NULL,
        password TEXT NOT NULL,
        updated_at TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(
        application_id UNINDEXED, company, title, people, body,
        tokenize = 'unicode61 remove_diacritics 2');
    `);
    this.db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run('schema', String(SCHEMA_VERSION));
  }

  private all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  private one(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }

  private run(sql: string, ...params: SQLInputValue[]): void {
    this.db.prepare(sql).run(...params);
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  kvGet(key: string): unknown {
    const r = this.one('SELECT value FROM kv WHERE key = ?', key);
    return r ? parse(r.value) : undefined;
  }
  kvSet(key: string, value: unknown): void {
    if (value === undefined) return this.kvRemove(key);
    this.run('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  }
  kvRemove(key: string): void {
    this.run('DELETE FROM kv WHERE key = ?', key);
  }

  private resumeFromRow(r: Row): MasterResume {
    const out = parse<MasterResume>(r.data);
    const blob = r.source_data as Uint8Array | null;
    out.sourceData = blob ? blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) as ArrayBuffer : null;
    out.isDefault = Boolean(r.is_default);
    return out;
  }
  listResumes(): MasterResume[] {
    return this.all('SELECT * FROM resumes ORDER BY is_default DESC, updated_at DESC').map((r) => this.resumeFromRow(r));
  }
  getResume(id: string): MasterResume | null {
    const r = this.one('SELECT * FROM resumes WHERE id = ?', id);
    return r ? this.resumeFromRow(r) : null;
  }
  saveResume(resume: MasterResume): MasterResume {
    return this.tx(() => {
      const count = Number(this.one('SELECT COUNT(*) AS n FROM resumes')!.n);
      const next: MasterResume = { ...resume, updatedAt: now() };
      if (count === 0 || (count === 1 && this.one('SELECT id FROM resumes WHERE id = ?', resume.id))) next.isDefault = true;
      if (next.isDefault) this.run('UPDATE resumes SET is_default = 0 WHERE id <> ?', next.id);
      const { sourceData, ...rest } = next;
      const bytes = sourceData ? new Uint8Array(sourceData) : null;
      this.run(
        `INSERT INTO resumes(id, name, is_default, data, source_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_default = excluded.is_default, data = excluded.data,
           source_data = excluded.source_data, updated_at = excluded.updated_at`,
        next.id, next.name, next.isDefault ? 1 : 0, JSON.stringify({ ...rest, sourceData: null }), bytes, next.createdAt, next.updatedAt,
      );
      return next;
    });
  }
  setDefaultResume(id: string): void {
    this.run('UPDATE resumes SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END', id);
  }
  deleteResume(id: string): void {
    this.tx(() => {
      const wasDefault = this.one('SELECT is_default FROM resumes WHERE id = ?', id)?.is_default;
      this.run('DELETE FROM resumes WHERE id = ?', id);
      if (wasDefault) {
        const next = this.one('SELECT id FROM resumes ORDER BY updated_at DESC LIMIT 1');
        if (next) this.run('UPDATE resumes SET is_default = 1 WHERE id = ?', String(next.id));
      }
    });
  }

  getProfile(): CareerProfile | null {
    const r = this.one("SELECT data FROM profile WHERE id = 'default'");
    return r ? parse<CareerProfile>(r.data) : null;
  }
  saveProfile(p: CareerProfile): CareerProfile {
    const next = { ...withSyncedLocation(p), updatedAt: now() };
    this.run("INSERT INTO profile(id, data) VALUES ('default', ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data", JSON.stringify(next));
    return next;
  }

  listSiteCredentials(): SiteCredential[] {
    return this.all('SELECT host, url, email, password, updated_at FROM site_credentials ORDER BY host').map((r) => ({
      host: String(r.host),
      url: String(r.url),
      email: String(r.email),
      password: String(r.password),
      updatedAt: String(r.updated_at),
    }));
  }
  getSiteCredential(host: string): SiteCredential | null {
    const r = this.one('SELECT host, url, email, password, updated_at FROM site_credentials WHERE host = ?', host.toLowerCase());
    return r
      ? { host: String(r.host), url: String(r.url), email: String(r.email), password: String(r.password), updatedAt: String(r.updated_at) }
      : null;
  }
  saveSiteCredential(c: SiteCredential): SiteCredential {
    const next: SiteCredential = { ...c, host: c.host.toLowerCase(), updatedAt: now() };
    this.run(
      `INSERT INTO site_credentials(host, url, email, password, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(host) DO UPDATE SET url = excluded.url, email = excluded.email, password = excluded.password, updated_at = excluded.updated_at`,
      next.host, next.url, next.email, next.password, next.updatedAt,
    );
    return next;
  }
  deleteSiteCredential(host: string): void {
    this.run('DELETE FROM site_credentials WHERE host = ?', host.toLowerCase());
  }

  getSession(jobKey: string): JobSession | null {
    const r = this.one('SELECT data FROM sessions WHERE job_key = ?', jobKey);
    return r ? parse<JobSession>(r.data) : null;
  }
  saveSession(s: JobSession): JobSession {
    const next = { ...s, updatedAt: now() };
    this.run(
      'INSERT INTO sessions(job_key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(job_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
      next.jobKey, JSON.stringify(next), next.updatedAt,
    );
    if (next.applicationId) this.reindex(next.applicationId);
    return next;
  }
  latestSession(withinMs: number): JobSession | null {
    const cutoff = new Date(Date.now() - withinMs).toISOString();
    const r = this.one('SELECT data FROM sessions WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT 1', cutoff);
    return r ? parse<JobSession>(r.data) : null;
  }
  deleteSession(jobKey: string): void {
    this.run('DELETE FROM sessions WHERE job_key = ?', jobKey);
    this.run('DELETE FROM company_research WHERE job_key = ?', jobKey);
  }

  getCompanyResearch(jobKey: string): CompanyResearchReply | null {
    const r = this.one('SELECT data FROM company_research WHERE job_key = ?', jobKey);
    return r ? parse<CompanyResearchReply>(r.data) : null;
  }

  saveCompanyResearch(jobKey: string, research: CompanyResearchReply): CompanyResearchReply {
    const at = now();
    this.run(
      'INSERT INTO company_research(job_key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(job_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
      jobKey,
      JSON.stringify(research),
      at,
    );
    return research;
  }

  listApplications(): ApplicationRecord[] {
    return this.all('SELECT data FROM applications ORDER BY COALESCE(date_applied, date_prepared) DESC').map((r) => parse<ApplicationRecord>(r.data));
  }
  getApplication(id: string): ApplicationRecord | null {
    const r = this.one('SELECT data FROM applications WHERE id = ?', id);
    return r ? parse<ApplicationRecord>(r.data) : null;
  }
  applicationsByJobKey(jobKey: string): ApplicationRecord[] {
    return this.all('SELECT data FROM applications WHERE job_key = ?', jobKey).map((r) => parse<ApplicationRecord>(r.data));
  }
  private normalize(r: ApplicationRecord): ApplicationRecord {
    const t = now();
    return {
      ...r,
      jobKey: r.jobKey ?? `import:${r.id}`,
      jobId: r.jobId ?? null,
      jobUrl: r.jobUrl ?? '',
      title: r.title ?? '',
      company: r.company ?? '',
      location: r.location ?? '',
      remoteStatus: r.remoteStatus ?? 'unknown',
      technologies: Array.isArray(r.technologies) ? r.technologies : [],
      salary: r.salary ?? null,
      matchScore: r.matchScore ?? null,
      tailoredScore: r.tailoredScore ?? null,
      resumeVersion: r.resumeVersion ?? 0,
      coverLetterVersion: r.coverLetterVersion ?? 0,
      resumeFileName: r.resumeFileName ?? null,
      coverLetterFileName: r.coverLetterFileName ?? null,
      keywords: Array.isArray(r.keywords) ? r.keywords : [],
      missingQualifications: Array.isArray(r.missingQualifications) ? r.missingQualifications : [],
      datePrepared: r.datePrepared ?? r.createdAt ?? t,
      dateApplied: r.dateApplied ?? null,
      followUpDate: r.followUpDate ?? null,
      notes: Array.isArray(r.notes) ? r.notes : [],
      folderPath: r.folderPath ?? null,
      files: Array.isArray(r.files) ? r.files : [],
      stageHistory: Array.isArray(r.stageHistory) ? r.stageHistory : [],
      createdAt: r.createdAt ?? t,
      updatedAt: r.updatedAt ?? t,
    };
  }

  private putApplication(input: ApplicationRecord): void {
    const rec = this.normalize(input);
    this.run(
      `INSERT INTO applications(id, job_key, company, title, location, stage, job_url, date_prepared, date_applied, follow_up_date, data, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET job_key = excluded.job_key, company = excluded.company, title = excluded.title,
         location = excluded.location, stage = excluded.stage, job_url = excluded.job_url, date_prepared = excluded.date_prepared,
         date_applied = excluded.date_applied, follow_up_date = excluded.follow_up_date, data = excluded.data, updated_at = excluded.updated_at`,
      rec.id, rec.jobKey, rec.company, rec.title, rec.location, rec.stage, rec.jobUrl, rec.datePrepared, rec.dateApplied, rec.followUpDate, JSON.stringify(rec), rec.updatedAt,
    );
    this.run('UPDATE documents SET application_id = ? WHERE job_key = ? AND application_id IS NULL', rec.id, rec.jobKey);
  }
  saveApplication(record: ApplicationRecord): ApplicationRecord {
    const next = this.normalize({ ...record, updatedAt: now() });
    this.tx(() => {
      this.putApplication(next);
      this.addPostingContacts(next);
      this.reindex(next.id);
    });
    return next;
  }
  deleteApplication(id: string): void {
    this.tx(() => {
      this.run('DELETE FROM applications WHERE id = ?', id);
      this.run('DELETE FROM contacts WHERE application_id = ?', id);
      this.run('DELETE FROM search WHERE application_id = ?', id);
      this.run('UPDATE documents SET application_id = NULL WHERE application_id = ?', id);
    });
  }
  importApplications(records: ApplicationRecord[]): number {
    this.tx(() => {
      for (const r of records) {
        this.putApplication(r);
        this.reindex(r.id);
      }
    });
    return records.length;
  }

  private addPostingContacts(rec: ApplicationRecord): void {
    const marker = `contacts.fromPosting.${rec.id}`;
    if (this.kvGet(marker)) return;
    const s = this.getSession(rec.jobKey);
    const text = s?.job.description ?? '';
    if (!text) return;
    this.kvSet(marker, true);
    const found = extractContacts(text);
    const existing = this.listContacts(rec.id);
    for (const p of found.phones) {
      if (existing.some((c) => c.phone && phoneDigits(c.phone) === phoneDigits(p))) continue;
      this.saveContact({ id: rid('ct'), applicationId: rec.id, name: '', role: 'From the job posting', phone: p, email: '', source: 'job posting', createdAt: now() }, false);
    }
    for (const e of found.emails) {
      if (existing.some((c) => c.email.toLowerCase() === e)) continue;
      this.saveContact({ id: rid('ct'), applicationId: rec.id, name: '', role: 'From the job posting', phone: '', email: e, source: 'job posting', createdAt: now() }, false);
    }
  }

  listContacts(applicationId: string): Contact[] {
    return this.all('SELECT * FROM contacts WHERE application_id = ? ORDER BY source DESC, created_at', applicationId).map((r) => ({
      id: String(r.id),
      applicationId: String(r.application_id),
      name: String(r.name ?? ''),
      role: String(r.role ?? ''),
      phone: String(r.phone ?? ''),
      email: String(r.email ?? ''),
      source: (r.source === 'job posting' ? 'job posting' : 'you') as Contact['source'],
      createdAt: String(r.created_at ?? ''),
    }));
  }
  saveContact(c: Contact, reindex = true): Contact {
    const next = { ...c, id: c.id || rid('ct'), phone: c.phone ? formatPhone(c.phone) : '', createdAt: c.createdAt || now() };
    this.run(
      `INSERT INTO contacts(id, application_id, name, role, phone, phone_digits, email, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, phone = excluded.phone, phone_digits = excluded.phone_digits, email = excluded.email`,
      next.id, next.applicationId, next.name, next.role, next.phone, next.phone ? phoneDigits(next.phone) : '', next.email, next.source, next.createdAt,
    );
    if (reindex) this.reindex(next.applicationId);
    return next;
  }
  deleteContact(id: string): void {
    const r = this.one('SELECT application_id FROM contacts WHERE id = ?', id);
    this.run('DELETE FROM contacts WHERE id = ?', id);
    if (r) this.reindex(String(r.application_id));
  }

  private docFromRow(r: Row): StoredDocument {
    return {
      id: String(r.id),
      applicationId: (r.application_id as string | null) ?? null,
      jobKey: String(r.job_key),
      kind: r.kind as StoredDocument['kind'],
      version: Number(r.version),
      format: (r.format as string | null) ?? null,
      filePath: (r.file_path as string | null) ?? null,
      json: String(r.json),
      engine: (r.engine as string | null) ?? null,
      model: (r.model as string | null) ?? null,
      sentAt: (r.sent_at as string | null) ?? null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }
  upsertDocument(input: StoredDocumentInput): StoredDocument {
    let d = input;
    let id = `${d.jobKey}|${d.kind}|v${d.version}`;
    const t = now();
    const prev = this.one('SELECT json, sent_at FROM documents WHERE id = ?', id);
    if (prev && prev.sent_at && String(prev.json) !== d.json) {
      const max = Number(this.one('SELECT MAX(version) AS v FROM documents WHERE job_key = ? AND kind = ?', d.jobKey, d.kind)?.v ?? d.version);
      d = { ...d, version: max + 1 };
      id = `${d.jobKey}|${d.kind}|v${d.version}`;
    }
    const appId = d.applicationId ?? (this.one('SELECT id FROM applications WHERE job_key = ? ORDER BY updated_at DESC LIMIT 1', d.jobKey)?.id as string | undefined) ?? null;
    this.run(
      `INSERT INTO documents(id, application_id, job_key, kind, version, format, file_path, json, engine, model, sent_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET application_id = COALESCE(excluded.application_id, documents.application_id),
         format = COALESCE(excluded.format, documents.format), file_path = COALESCE(excluded.file_path, documents.file_path),
         json = excluded.json, engine = COALESCE(excluded.engine, documents.engine), model = COALESCE(excluded.model, documents.model),
         updated_at = excluded.updated_at`,
      id, appId, d.jobKey, d.kind, d.version, d.format ?? null, d.filePath ?? null, d.json, d.engine ?? null, d.model ?? null, t, t,
    );
    return this.getDocument(id)!;
  }
  getDocument(id: string): StoredDocument | null {
    const r = this.one('SELECT * FROM documents WHERE id = ?', id);
    return r ? this.docFromRow(r) : null;
  }
  listDocuments(filter: { applicationId?: string; jobKey?: string }): StoredDocument[] {
    if (filter.applicationId) {
      const jk = this.one('SELECT job_key FROM applications WHERE id = ?', filter.applicationId)?.job_key as string | undefined;
      return this.all('SELECT * FROM documents WHERE application_id = ? OR job_key = ? ORDER BY kind, version DESC', filter.applicationId, jk ?? '').map((r) => this.docFromRow(r));
    }
    if (filter.jobKey) return this.all('SELECT * FROM documents WHERE job_key = ? ORDER BY kind, version DESC', filter.jobKey).map((r) => this.docFromRow(r));
    return this.all('SELECT * FROM documents ORDER BY updated_at DESC LIMIT 200').map((r) => this.docFromRow(r));
  }
  markSent(applicationId: string, jobKey: string, versions: { resume?: number | null; cover_letter?: number | null } = {}): void {
    const t = now();
    for (const kind of ['resume', 'cover_letter'] as const) {
      const v = versions[kind];
      if (v === null) continue;
      const r = v === undefined
        ? this.one('SELECT id FROM documents WHERE job_key = ? AND kind = ? ORDER BY version DESC LIMIT 1', jobKey, kind)
        : this.one('SELECT id FROM documents WHERE job_key = ? AND kind = ? AND version = ? ORDER BY updated_at DESC LIMIT 1', jobKey, kind, v);
      if (r) this.run('UPDATE documents SET sent_at = ?, application_id = ? WHERE id = ?', t, applicationId, String(r.id));
    }
  }

  addUsage(u: UsageInput): void {
    this.run(
      'INSERT INTO usage(job_key, application_id, task, model, input_tokens, cache_read, cache_write, output_tokens, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      u.jobKey, u.applicationId, u.task, u.model, u.inputTokens, u.cacheReadTokens, u.cacheWriteTokens, u.outputTokens, now(),
    );
  }
  usageSummary(filter: { jobKey?: string; sinceIso?: string }): UsageSummary {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.jobKey) {
      where.push('job_key = ?');
      params.push(filter.jobKey);
    }
    if (filter.sinceIso) {
      where.push('at >= ?');
      params.push(filter.sinceIso);
    }
    const r = this.one(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(cache_read),0) AS cr, COALESCE(SUM(cache_write),0) AS cw, COALESCE(SUM(output_tokens),0) AS o
       FROM usage ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
      ...params,
    )!;
    return { calls: Number(r.calls), inputTokens: Number(r.i), cacheReadTokens: Number(r.cr), cacheWriteTokens: Number(r.cw), outputTokens: Number(r.o) };
  }

  isKnownFile(path: string): boolean {
    if (this.one('SELECT 1 AS x FROM documents WHERE file_path = ? LIMIT 1', path)) return true;
    return this.all('SELECT data FROM applications').some((r) => parse<ApplicationRecord>(r.data).files?.some((f) => f.absolutePath === path));
  }

  reindex(applicationId: string): void {
    const rec = this.getApplication(applicationId);
    this.run('DELETE FROM search WHERE application_id = ?', applicationId);
    if (!rec) return;
    const s = this.getSession(rec.jobKey);
    const contacts = this.listContacts(applicationId);
    const people = contacts.map((c) => [c.name, c.role, c.email, c.phone, c.phone ? phoneDigits(c.phone) : ''].filter(Boolean).join(' ')).join(' ; ');
    const body = [
      rec.location,
      rec.salary ?? '',
      rec.technologies.join(', '),
      rec.keywords.join(', '),
      rec.notes.map((n) => n.text).join('\n'),
      rec.jobUrl,
      s?.job.description ?? '',
      s?.resume ? [s.resume.headline, s.resume.summary].join('\n') : '',
    ].join('\n');
    this.run('INSERT INTO search(application_id, company, title, people, body) VALUES (?, ?, ?, ?, ?)', applicationId, rec.company, rec.title, people, body);
  }

  reindexAll(): void {
    this.tx(() => {
      this.run('DELETE FROM search');
      for (const r of this.all('SELECT id FROM applications')) this.reindex(String(r.id));
    });
  }

  search(q: string, limit = 50): SearchHit[] {
    const query = q.trim();
    const hits = new Map<string, { score: number; matchedOn: Set<SearchHit['matchedOn'][number]>; snippet: string | null }>();
    const add = (id: string, score: number, on: SearchHit['matchedOn'][number], snippet: string | null = null) => {
      const h = hits.get(id) ?? { score: 0, matchedOn: new Set(), snippet: null };
      h.score += score;
      h.matchedOn.add(on);
      if (snippet && !h.snippet) h.snippet = snippet;
      hits.set(id, h);
    };
    if (!query) {
      return this.all('SELECT id FROM applications ORDER BY COALESCE(date_applied, date_prepared) DESC LIMIT ?', limit)
        .map((r) => this.hit(String(r.id), [], null))
        .filter((h): h is SearchHit => h !== null);
    }
    const digits = query.replace(/\D/g, '');
    if (digits.length >= 4 && digits.length >= query.replace(/\s/g, '').length * 0.6) {
      const d = digits.length > 10 ? digits.slice(-10) : digits;
      for (const r of this.all('SELECT application_id FROM contacts WHERE phone_digits LIKE ?', `%${d}%`)) add(String(r.application_id), 100, 'phone');
    }
    if (query.includes('@')) {
      for (const r of this.all('SELECT application_id FROM contacts WHERE email LIKE ?', `%${query.toLowerCase()}%`)) add(String(r.application_id), 90, 'email');
    }
    for (const r of this.all('SELECT id FROM applications WHERE company LIKE ? COLLATE NOCASE', `%${query}%`)) add(String(r.id), 40, 'company');
    for (const r of this.all('SELECT id FROM applications WHERE title LIKE ? COLLATE NOCASE', `%${query}%`)) add(String(r.id), 15, 'title');
    for (const r of this.all('SELECT application_id FROM contacts WHERE name LIKE ? COLLATE NOCASE', `%${query}%`)) add(String(r.application_id), 60, 'contact');
    const terms = query
      .split(/\s+/)
      .map((t) => t.replace(/["*^():]/g, '').trim())
      .filter((t) => t.length > 1);
    if (terms.length) {
      const fts = terms.map((t) => `"${t}"*`).join(' AND ');
      try {
        for (const r of this.all(
          `SELECT application_id, bm25(search, 0, 8, 4, 6, 1) AS rank, snippet(search, 4, '[', ']', '…', 14) AS snip
           FROM search WHERE search MATCH ? ORDER BY rank LIMIT ?`,
          fts, limit,
        )) add(String(r.application_id), Math.max(1, 20 - Number(r.rank)), 'text', String(r.snip ?? '') || null);
      } catch {
      }
    }
    return [...hits.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit)
      .map(([id, h]) => this.hit(id, [...h.matchedOn], h.snippet))
      .filter((h): h is SearchHit => h !== null);
  }

  private hit(id: string, matchedOn: SearchHit['matchedOn'], snippet: string | null): SearchHit | null {
    const application = this.getApplication(id);
    if (!application) return null;
    return { application, matchedOn, snippet, contacts: this.listContacts(id) };
  }
}
