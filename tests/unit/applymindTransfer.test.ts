// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../../electron/db';
import { aesKeyWrapper } from '../../electron/applymind/crypto';
import { ApplyMindService } from '../../electron/applymind/service';
import { SyncService } from '../../electron/sync/service';
import { readBundle, writeBundle } from '../../electron/sync/archive';
import { mergeKnowledge, partChecksum, verifySection, withChecksums, type ApplyMindSection, type KnowledgeHistory, type KnowledgeRecord } from '@/services/applymind/transfer';
import { GENERAL_CONTEXT } from '@/services/applymind/exact';
import type { ApprovedAnswer, CareerProfile } from '@/types';

const dirs: string[] = [];
const stores: Store[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function record(over: Partial<KnowledgeRecord> & Pick<KnowledgeRecord, 'id' | 'answer'>): KnowledgeRecord {
  return {
    sourceAnswerId: over.id,
    deviceId: 'device-a',
    patternId: `pattern:${over.id}`,
    originalQuestion: 'Are you legally authorized to work in the United States?',
    normalizedQuestion: ' are you legally authorized to work in the united states ',
    category: 'work_authorization',
    questionType: 'yes_no',
    options: ['Yes', 'No'],
    status: 'verified',
    provenance: { kind: 'user_entered', sourceAnswerId: over.id, catalogId: null, factId: null },
    context: GENERAL_CONTEXT,
    platform: null,
    answeredAt: '2026-11-01T00:00:00.000Z',
    confirmedAt: '2026-11-01T00:00:00.000Z',
    freshnessDays: null,
    deletedAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...over,
  };
}

function section(records: KnowledgeRecord[], history?: KnowledgeHistory[]): ApplyMindSection {
  const rows = history ?? records.map((r, i) => ({
    id: `h-${r.id}-${i}`, recordId: r.id, at: '2026-11-01T00:00:00.000Z', deviceId: r.deviceId, action: 'created', status: r.status, answer: r.answer,
  }));
  return withChecksums({
    schema: 1, appVersion: 'test', deviceId: 'device-a', exportedAt: '2026-11-17T00:00:00.000Z',
    records, history: rows, facts: [], tombstones: [], reviews: [],
    settings: { freshnessDays: 90, coldStart: { minRecords: 80, minPatterns: 25, minHeldOutPatterns: 20 }, autoFillSavedAnswers: true },
    model: null,
  });
}

describe('ApplyMind merge', () => {
  it('skips an identical record, keeps the longer history, and combines the same answer', () => {
    const local = record({ id: 'a', answer: 'Yes' });
    const base = section([local]);
    expect(mergeKnowledge(base, section([local])).skipped).toBe(1);
    const longer = section([local], [
      { id: 'h-a-0', recordId: 'a', at: '2026-11-01T00:00:00.000Z', deviceId: 'device-a', action: 'created', status: 'verified', answer: 'Yes' },
      { id: 'h-a-1', recordId: 'a', at: '2026-11-02T00:00:00.000Z', deviceId: 'device-a', action: 'confirmed', status: 'verified', answer: 'Yes' },
    ]);
    const kept = mergeKnowledge(base, longer);
    expect(kept.history.map((h) => h.id).sort()).toEqual(['h-a-0', 'h-a-1']);
    const otherId = record({ id: 'b', answer: 'Yes', deviceId: 'device-b' });
    const combined = mergeKnowledge(base, section([otherId]));
    expect(combined.records.filter((r) => !r.deletedAt)).toHaveLength(1);
    expect(combined.merged).toBe(1);
  });

  it('keeps different contexts and conflicts on two verified answers', () => {
    const local = record({ id: 'a', answer: 'Yes' });
    const job = record({ id: 'b', answer: 'No', context: { ...GENERAL_CONTEXT, scope: 'job', jobTitle: 'Architect', platform: 'greenhouse' } });
    const differentJob = mergeKnowledge(section([local]), section([job]));
    expect(differentJob.records).toHaveLength(2);
    expect(differentJob.conflicts).toBe(0);
    const clash = record({ id: 'c', answer: 'No', deviceId: 'device-b' });
    const conflicted = mergeKnowledge(section([local]), section([clash]));
    expect(conflicted.conflicts).toBe(1);
    expect(conflicted.records.map((r) => r.answer).sort()).toEqual(['No', 'Yes']);
    const again = mergeKnowledge(section(conflicted.records, conflicted.history), section([clash]));
    expect(again.records.filter((r) => !r.deletedAt)).toHaveLength(2);
  });

  it('lets a verified answer take precedence over an accepted one and keeps a deletion', () => {
    const verified = record({ id: 'a', answer: 'Yes' });
    const accepted = record({ id: 'a', answer: 'No', status: 'accepted', provenance: { kind: 'autofill', sourceAnswerId: 'a', catalogId: null, factId: null } });
    const won = mergeKnowledge(section([accepted]), section([verified]));
    expect(won.records[0]!.status).toBe('verified');
    expect(won.records[0]!.answer).toBe('Yes');
    const tomb = section([], []);
    tomb.tombstones = [{ id: 'tomb_a', sourceAnswerId: 'a', patternId: 'pattern:a', deletedAt: '2026-11-03T00:00:00.000Z', deviceId: 'device-b' }];
    tomb.checksums = { ...tomb.checksums, tombstones: partChecksum(tomb.tombstones) };
    const deleted = mergeKnowledge(section([verified]), verifySection(tomb));
    expect(deleted.records[0]!.deletedAt).toBeTruthy();
  });

  it('refuses a bad checksum and a newer schema', () => {
    const good = section([record({ id: 'a', answer: 'Yes' })]);
    const tampered = { ...good, records: [{ ...good.records[0]!, answer: 'No' }] };
    expect(() => verifySection(tampered)).toThrow(/checksum/);
    expect(() => verifySection({ ...good, schema: 2 })).toThrow(/newer version/);
  });
});

describe('ApplyMind inside a data file', () => {
  function device(name: string) {
    const root = mkdtempSync(join(tmpdir(), `af-mind-${name}-`));
    dirs.push(root);
    const store = new Store(join(root, 'applyflow.sqlite'));
    stores.push(store);
    const svc = new ApplyMindService(() => store, join(root, 'applymind.key'), aesKeyWrapper(randomBytes(32)));
    const sync = new SyncService({
      store: () => store,
      replaceStore: () => undefined,
      userDataDir: root,
      baseDir: () => root,
      appVersion: '2.3.9',
      deviceName: name,
      platform: 'test',
      progress: () => undefined,
      afterCommit: () => svc.syncFromProfile(store.getProfile(), { alreadyBackedUp: true, corrections: false }),
      applyMind: {
        prepareExport: async () => undefined,
        exportSection: () => svc.exportSection({ appVersion: '2.3.9', autoFillSavedAnswers: true }),
        prepareImport: (s) => svc.prepareImport(s),
      },
    });
    return { store, svc, sync, root };
  }

  function saved(id: string, question: string, answer: string): CareerProfile {
    const item: ApprovedAnswer = { id, category: 'general', questionPattern: question, answer, approvedAt: '2026-11-01T00:00:00.000Z', control: 'text', options: [] };
    return {
      fullName: '', email: '', phone: '', location: '', streetAddress: '', addressLine2: '', city: '', state: '', postalCode: '', country: '',
      headline: '', professionalSummary: '', verifiedSkills: [], workAuthorizationNote: '', preferredTitles: [], preferredLocations: [],
      remotePreference: 'any', salaryPreference: '', availability: '', portfolioLinks: [], linkedinUrl: '', githubUrl: '',
      approvedAnswers: [item], updatedAt: '2026-11-01T00:00:00.000Z',
    };
  }

  it('round-trips records without the encryption key, and a second import changes nothing', async () => {
    const a = device('a');
    const profile = saved('q1', 'Where are you currently located?', 'SAINT PETERSBURG, FL');
    a.store.saveProfile(profile);
    await a.svc.syncFromProfile(profile, { backup: async () => 'backup' });
    const file = join(a.root, 'out.applyflow');
    const exported = await a.sync.exportTo(file);
    expect(exported.applymind?.verified).toBe(1);
    const opened = await readBundle(readFileSync(file));
    const raw = JSON.stringify(opened.applymind);
    expect(raw).not.toMatch(/AMKEY|sk-ant|password|session/i);
    expect(raw).not.toMatch(/"weights"/);
    const b = device('b');
    const inspected = await b.sync.inspect(file);
    expect(inspected.status).toBe('ready');
    if (inspected.status !== 'ready') return;
    const imported = await b.sync.apply(inspected.token, { applySettings: false });
    expect(imported.report.applymind?.added).toBeGreaterThan(0);
    expect(imported.report.applymind?.retrained).toBe(true);
    expect(await b.svc.exact({ question: 'Where are you currently located?', options: [], control: 'text' })).toBe('SAINT PETERSBURG, FL');
    expect((await b.svc.status()).verified).toBe(1);
    const again = await b.sync.inspect(file);
    if (again.status !== 'ready') throw new Error('second inspect failed');
    const second = await b.sync.apply(again.token, { applySettings: false });
    expect(second.report.applymind?.added).toBe(0);
    expect((await b.svc.status()).records).toBe(1);
  });

  it('does not create a second record when the profile carries the same answer', async () => {
    const a = device('a');
    await a.svc.syncFromProfile(saved('q1', 'Preferred Name', 'Grant Howard'), { backup: async () => 'backup' });
    const file = join(a.root, 'out.applyflow');
    await a.sync.exportTo(file);
    const b = device('b');
    b.store.saveProfile(saved('q1', 'Preferred Name', 'Grant Howard'));
    await b.svc.syncFromProfile(b.store.getProfile(), { backup: async () => 'backup' });
    const inspected = await b.sync.inspect(file);
    if (inspected.status !== 'ready') throw new Error(inspected.status);
    await b.sync.apply(inspected.token, { applySettings: false });
    expect((await b.svc.status()).records).toBe(1);
  });

  it('imports a version 1 file and refuses a damaged ApplyMind section without changing data', async () => {
    const a = device('a');
    await a.svc.syncFromProfile(saved('q1', 'Preferred Name', 'Grant Howard'), { backup: async () => 'backup' });
    const before = (await a.svc.status()).verified;
    const old = await writeBundle(
      { format: 'applyflow-sync', formatVersion: 1, appVersion: '2.3.8', schemaVersion: 2, exportedAt: '2026-11-17T00:00:00.000Z', device: { id: 'old', name: 'old', platform: 'test' }, counts: {} },
      { deviceId: 'old', applications: [], contacts: [], documents: [], sessions: [], companyResearch: [], resumes: [], profile: null, usage: [], kv: {}, tombstones: [], aliases: [] },
      new Map(),
    );
    const oldPath = join(a.root, 'old.applyflow');
    writeFileSync(oldPath, old);
    const inspected = await a.sync.inspect(oldPath);
    expect(inspected.status).toBe('ready');
    const damaged = await readBundle(await (async () => {
      const file = join(a.root, 'good.applyflow');
      await a.sync.exportTo(file);
      return readFileSync(file);
    })());
    const bad = damaged.applymind as ApplyMindSection;
    bad.records[0]!.answer = 'changed';
    const broken = await writeBundle(
      { format: 'applyflow-sync', formatVersion: 2, appVersion: '2.3.9', schemaVersion: 2, exportedAt: 'now', device: { id: 'x', name: 'x', platform: 'test' }, counts: {} },
      { deviceId: 'x', applications: [], contacts: [], documents: [], sessions: [], companyResearch: [], resumes: [], profile: null, usage: [], kv: {}, tombstones: [], aliases: [] },
      new Map(),
      null,
      [{ name: 'applymind.json', data: Buffer.from(JSON.stringify(bad)) }],
    );
    const badPath = join(a.root, 'bad.applyflow');
    writeFileSync(badPath, broken);
    const refused = await a.sync.inspect(badPath);
    expect(refused.status).toBe('error');
    if (refused.status === 'error') expect(refused.message).toMatch(/checksum/);
    expect((await a.svc.status()).verified).toBe(before);
  });

  it('comes back identical after exporting both ways', async () => {
    const a = device('a');
    const b = device('b');
    const left = saved('q1', 'Preferred Name', 'Grant Howard');
    const right = saved('q2', 'Applicant Initials:', 'GH');
    a.store.saveProfile(left);
    b.store.saveProfile(right);
    await a.svc.syncFromProfile(left, { backup: async () => 'backup' });
    await b.svc.syncFromProfile(right, { backup: async () => 'backup' });
    const ab = join(a.root, 'ab.applyflow');
    await a.sync.exportTo(ab);
    const toB = await b.sync.inspect(ab);
    if (toB.status !== 'ready') throw new Error('inspect failed');
    await b.sync.apply(toB.token, { applySettings: false });
    const ba = join(b.root, 'ba.applyflow');
    await b.sync.exportTo(ba);
    const toA = await a.sync.inspect(ba);
    if (toA.status !== 'ready') throw new Error('inspect failed');
    await a.sync.apply(toA.token, { applySettings: false });
    const fromA = await a.svc.exportSection({ appVersion: '2.3.9', autoFillSavedAnswers: true });
    const fromB = await b.svc.exportSection({ appVersion: '2.3.9', autoFillSavedAnswers: true });
    const key = (s: ApplyMindSection) => s.records.filter((r) => !r.deletedAt).map((r) => `${r.id}|${r.answer}|${r.status}`).sort().join('\n');
    expect(key(fromA)).toBe(key(fromB));
    const hist = (s: ApplyMindSection) => s.history.map((h) => h.id).sort().join('\n');
    expect(hist(fromA)).toBe(hist(fromB));
  });
});
