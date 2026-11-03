import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, type ApplicationRecord } from '@/types';
import { csvCell, toCsv, toJson, parseImport, findDuplicates, filterApplications, setStage, addNote, duplicateApplication, recordFromSession, isFollowUpDue, hasApplied } from '@/services/history/history';
import { emptySession, mockJob } from '../helpers';

function rec(over: Partial<ApplicationRecord> = {}): ApplicationRecord {
  const base = recordFromSession(emptySession(mockJob()), 'Applied');
  return { ...base, ...over };
}

describe('duplicate detection', () => {
  it('matches the same job by key or normalized URL', () => {
    const r = rec();
    const byKey = findDuplicates([r], r.jobKey, 'https://other', 'X', 'Y');
    expect(byKey.exact?.id).toBe(r.id);
    const other = rec({ jobKey: 'url:something', jobUrl: 'https://www.dice.com/job-detail/zzz' });
    const byUrl = findDuplicates([other], 'dice:new', 'https://dice.com/job-detail/zzz?utm_source=mail#apply', 'X', 'Y');
    expect(byUrl.exact?.id).toBe(other.id);
  });

  it('flags similar applications at the same company', () => {
    const r = rec({ jobKey: 'dice:a', jobUrl: 'https://www.dice.com/job-detail/a', createdAt: '2026-10-20T00:00:00Z' });
    const d = findDuplicates([r], 'dice:b', 'https://www.dice.com/job-detail/b', 'meridian credit analytics llc', 'Senior Architect, AI Engineering and Platforms', new Date('2026-10-30'));
    expect(d.exact).toBeNull();
    expect(d.similar).toHaveLength(1);
  });

  it('knows which stages count as already applied', () => {
    expect(hasApplied(rec({ stage: 'Interview' }))).toBe(true);
    expect(hasApplied(rec({ stage: 'Resume Ready' }))).toBe(false);
  });
});

describe('history records', () => {
  it('creates a record from a session and tracks stage history', () => {
    const r = rec();
    expect(r.stage).toBe('Applied');
    expect(r.dateApplied).toBeTruthy();
    const next = setStage(r, 'Interview');
    expect(next.stageHistory.map((s) => s.stage)).toEqual(['Applied', 'Interview']);
    expect(addNote(next, '  Recruiter call Tuesday ').notes[0]!.text).toBe('Recruiter call Tuesday');
    const dup = duplicateApplication(next);
    expect(dup.id).not.toBe(next.id);
    expect(dup.stage).toBe('Saved');
    expect(dup.files).toEqual([]);
  });

  it('filters by company, status, score, technology, remote status, dates and follow-up', () => {
    const a = rec({ company: 'Acme', stage: 'Interview', tailoredScore: 90, technologies: ['Kubernetes'], remoteStatus: 'remote', dateApplied: '2026-10-01T00:00:00Z', followUpDate: '2026-10-05' });
    const b = rec({ company: 'Globex', stage: 'Rejected', tailoredScore: 50, matchScore: 50, technologies: ['Java'], remoteStatus: 'onsite', dateApplied: '2026-09-01T00:00:00Z' });
    const all = [a, b];
    expect(filterApplications(all, { ...EMPTY_FILTERS, company: 'acm' })).toEqual([a]);
    expect(filterApplications(all, { ...EMPTY_FILTERS, stages: ['Rejected'] })).toEqual([b]);
    expect(filterApplications(all, { ...EMPTY_FILTERS, minScore: 80 })).toEqual([a]);
    expect(filterApplications(all, { ...EMPTY_FILTERS, technology: 'kube' })).toEqual([a]);
    expect(filterApplications(all, { ...EMPTY_FILTERS, remoteStatus: 'onsite' })).toEqual([b]);
    expect(filterApplications(all, { ...EMPTY_FILTERS, dateFrom: '2026-09-15' })).toEqual([a]);
    expect(filterApplications(all, { ...EMPTY_FILTERS, followUpDue: true }, '2026-10-10')).toEqual([a]);
    expect(isFollowUpDue(a, '2026-10-04')).toBe(false);
  });
});

describe('export', () => {
  it('escapes CSV cells and neutralizes formula injection', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(['a', 'b'])).toBe('a; b');
  });

  it('exports CSV with a header row and JSON that round-trips', () => {
    const r = rec({ notes: [{ id: 'n', text: 'Line one\nLine two', createdAt: '' }] });
    const csv = toCsv([r]);
    expect(csv.split('\r\n')[0]).toMatch(/^﻿Application ID,Company,Job title/);
    expect(csv).toContain('"Line one\nLine two"');
    const back = parseImport(toJson([r]));
    expect(back).toEqual([r]);
    expect(() => parseImport('{"foo":1}')).toThrow(/not an ApplyFlow export/);
  });
});
