// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Store } from '../../electron/db';
import { recordFromSession } from '@/services/history/history';
import { addNote } from '@/services/history/history';
import type { JobSession } from '@/types';
import { buildMasterResume } from '@/services/resume/facts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

function session(company: string, title: string, description: string, jobKey: string): JobSession {
  const now = new Date().toISOString();
  return {
    jobKey,
    job: {
      jobKey, platform: 'dice', jobId: jobKey, url: `https://www.dice.com/job-detail/${jobKey}`, applicationUrl: null, title, company, location: 'Chicago, IL', remoteStatus: 'onsite',
      salary: null, employmentType: null, contractDuration: null, datePosted: null, description, requiredSkills: ['Kafka'], preferredSkills: [], responsibilities: [], qualifications: [], benefits: [],
      educationRequirements: [], clearanceRequirements: [], workAuthorizationRequirements: [], sponsorshipLanguage: [], externalApply: false,
    },
    extraction: { confidence: {}, sources: ['structured-data'], uncertain: false, warnings: [] },
    jobConfirmed: true, resumeId: null, analysis: null, evidence: [], masterScore: null, tailoredScore: null, resume: null, coverLetter: null,
    resumeReviewed: false, coverLetterReviewed: false, includeCoverLetter: true, fieldProposals: [], lastScanUrl: null, duplicateAcknowledged: false,
    applicationId: null, submittedAt: null, createdAt: now, updatedAt: now,
  };
}

describe('SQLite store', () => {
  it('keeps master resumes with their original file and one default', () => {
    const db = new Store(':memory:');
    const text = readFileSync(resolve(ROOT, 'docs/examples/example-master-resume.txt'), 'utf8');
    const a = db.saveResume({ ...buildMasterResume('A', text, 'text', 'a.txt'), sourceData: new Uint8Array([1, 2, 3]).buffer });
    const b = db.saveResume(buildMasterResume('B', text, 'text', null));
    expect(db.listResumes().map((r) => [r.name, r.isDefault])).toEqual([['A', true], ['B', false]]);
    expect(new Uint8Array(db.getResume(a.id)!.sourceData!)).toEqual(new Uint8Array([1, 2, 3]));
    db.setDefaultResume(b.id);
    expect(db.listResumes()[0]!.name).toBe('B');
    db.deleteResume(b.id);
    expect(db.listResumes()[0]!.isDefault).toBe(true);
  });

  it('finds an application by any part of a phone number, a recruiter, the company or a word in the posting', () => {
    const db = new Store(':memory:');
    const s1 = db.saveSession(session('Meridian Credit Analytics LLC', 'Senior Architect', 'Build event-driven systems on Apache Kafka. Questions? Call Dana Whitfield at (312) 555-0147 or dana@meridian-example.com.', 'dice:1'));
    const s2 = db.saveSession(session('Northwind Media', 'Video Engineer', 'HLS and DASH playback for connected TV. Salary $120,000-150,000.', 'dice:2'));
    const r1 = db.saveApplication(recordFromSession(s1, 'Applied'));
    const r2 = db.saveApplication(recordFromSession(s2, 'Applied'));

    expect(db.listContacts(r1.id).map((c) => c.phone || c.email)).toEqual(['(312) 555-0147', 'dana@meridian-example.com']);
    expect(db.listContacts(r2.id)).toEqual([]);

    for (const q of ['3125550147', '555-0147', '+1 312 555 0147', '(312) 555']) {
      const hits = db.search(q);
      expect(hits[0]?.application.id, q).toBe(r1.id);
      expect(hits[0]!.matchedOn).toContain('phone');
    }
    expect(db.search('northwind')[0]!.application.id).toBe(r2.id);
    expect(db.search('kafka')[0]!.application.id).toBe(r1.id);
    expect(db.search('connected tv')[0]!.application.id).toBe(r2.id);
    expect(db.search('dana@meridian')[0]!.matchedOn).toContain('email');

    db.saveContact({ id: '', applicationId: r2.id, name: 'Priya Natarajan', role: 'Recruiter', phone: '646.555.0199', email: '', source: 'you', createdAt: '' });
    expect(db.search('priya')[0]!.application.id).toBe(r2.id);
    expect(db.search('6465550199')[0]!.application.id).toBe(r2.id);

    db.saveApplication(addNote(db.getApplication(r2.id)!, 'Phone screen with hiring manager on Friday'));
    expect(db.search('hiring manager')[0]!.application.id).toBe(r2.id);
    expect(db.search('').length).toBe(2);
    expect(() => db.search('"(*^')).not.toThrow();
  });

  it('keeps every document version with its JSON, and marks the newest one as sent', () => {
    const db = new Store(':memory:');
    const s = db.saveSession(session('Acme', 'Engineer', 'x', 'dice:9'));
    db.upsertDocument({ applicationId: null, jobKey: s.jobKey, kind: 'resume', version: 1, json: '{"v":1}', engine: 'claude', model: 'claude-sonnet-5-5' });
    db.upsertDocument({ applicationId: null, jobKey: s.jobKey, kind: 'resume', version: 2, json: '{"v":2}', engine: 'claude', model: 'claude-sonnet-5-5' });
    db.upsertDocument({ applicationId: null, jobKey: s.jobKey, kind: 'resume', version: 2, json: '{"v":2}', engine: null, model: null, filePath: 'C:/x/resume_tailored.pdf', format: 'pdf' });
    const rec = db.saveApplication(recordFromSession(s, 'Applied'));
    db.markSent(rec.id, s.jobKey);
    const docs = db.listDocuments({ applicationId: rec.id });
    expect(docs.map((d) => [d.version, Boolean(d.sentAt), d.filePath, d.model])).toEqual([
      [2, true, 'C:/x/resume_tailored.pdf', 'claude-sonnet-5-5'],
      [1, false, null, 'claude-sonnet-5-5'],
    ]);
    expect(docs.every((d) => d.applicationId === rec.id)).toBe(true);
  });

  it('adds up Claude token usage per job', () => {
    const db = new Store(':memory:');
    db.addUsage({ jobKey: 'dice:1', applicationId: null, task: 'application', model: 'm', inputTokens: 1200, cacheReadTokens: 4000, cacheWriteTokens: 0, outputTokens: 1800 });
    db.addUsage({ jobKey: 'dice:2', applicationId: null, task: 'application', model: 'm', inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 4000, outputTokens: 1700 });
    expect(db.usageSummary({ jobKey: 'dice:1' })).toEqual({ calls: 1, inputTokens: 1200, cacheReadTokens: 4000, cacheWriteTokens: 0, outputTokens: 1800 });
    expect(db.usageSummary({}).calls).toBe(2);
  });

  it('stores settings as JSON values', () => {
    const db = new Store(':memory:');
    db.kvSet('k', { a: 1 });
    expect(db.kvGet('k')).toEqual({ a: 1 });
    db.kvRemove('k');
    expect(db.kvGet('k')).toBeUndefined();
  });
});

describe('SQLite store — history safety', () => {
  it('keeps a sent version when new content arrives under the same number, and marks exact versions', () => {
    const db = new Store(':memory:');
    const s = db.saveSession(session('Acme', 'Engineer', 'x', 'dice:7'));
    const rec = db.saveApplication(recordFromSession(s, 'Applied'));
    db.upsertDocument({ applicationId: rec.id, jobKey: s.jobKey, kind: 'resume', version: 1, json: '{"a":1}', engine: 'local', model: null });
    db.upsertDocument({ applicationId: rec.id, jobKey: s.jobKey, kind: 'cover_letter', version: 1, json: '{"c":1}', engine: 'local', model: null });
    db.markSent(rec.id, s.jobKey, { resume: 1, cover_letter: null });
    const d = db.upsertDocument({ applicationId: rec.id, jobKey: s.jobKey, kind: 'resume', version: 1, json: '{"a":2}', engine: 'local', model: null });
    expect(d.version).toBe(2);
    const docs = db.listDocuments({ applicationId: rec.id });
    expect(docs.find((x) => x.kind === 'resume' && x.version === 1)!.json).toBe('{"a":1}');
    expect(docs.find((x) => x.kind === 'resume' && x.version === 1)!.sentAt).not.toBeNull();
    expect(docs.find((x) => x.kind === 'cover_letter')!.sentAt).toBeNull();
  });

  it('imports records from older exports with missing fields', () => {
    const db = new Store(':memory:');
    const partial = { id: 'old1', company: 'Old Co', title: 'Dev', stage: 'Applied' } as never;
    expect(db.importApplications([partial])).toBe(1);
    expect(db.search('old co')[0]!.application.technologies).toEqual([]);
  });

  it('keeps phone extensions out of the number', () => {
    const db = new Store(':memory:');
    const s = db.saveSession(session('Ext Co', 'Dev', 'Call (555) 234-5678 x12.', 'dice:8'));
    const rec = db.saveApplication(recordFromSession(s, 'Applied'));
    expect(db.listContacts(rec.id)[0]!.phone).toBe('(555) 234-5678 x12');
    expect(db.search('5552345678')[0]!.application.id).toBe(rec.id);
  });
});
