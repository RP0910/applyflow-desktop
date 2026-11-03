import { describe, expect, it } from 'vitest';
import type { ApplicationRecord } from '@/types';
import { buildAnalytics, rangeStartIso } from '@/services/history/analytics';

function app(partial: Partial<ApplicationRecord> & Pick<ApplicationRecord, 'id' | 'stage'>): ApplicationRecord {
  const now = '2026-11-01T12:00:00.000Z';
  return {
    jobKey: partial.id,
    jobId: null,
    jobUrl: '',
    title: 'Engineer',
    company: 'Acme',
    location: '',
    remoteStatus: 'remote',
    technologies: [],
    salary: null,
    matchScore: 70,
    tailoredScore: 80,
    resumeVersion: 1,
    coverLetterVersion: 0,
    resumeFileName: null,
    coverLetterFileName: null,
    keywords: [],
    missingQualifications: [],
    datePrepared: now,
    dateApplied: null,
    followUpDate: null,
    notes: [],
    folderPath: null,
    files: [],
    stageHistory: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

describe('application analytics', () => {
  it('computes pipeline and response rate for a window', () => {
    const now = Date.parse('2026-11-03T12:00:00.000Z');
    const records = [
      app({ id: '1', stage: 'Applied', company: 'Acme', dateApplied: '2026-10-20T12:00:00.000Z', datePrepared: '2026-10-19T12:00:00.000Z' }),
      app({ id: '2', stage: 'Interview', company: 'Acme', dateApplied: '2026-10-25T12:00:00.000Z', datePrepared: '2026-10-24T12:00:00.000Z', matchScore: 90 }),
      app({ id: '3', stage: 'Offer', company: 'Beta', dateApplied: '2026-10-28T12:00:00.000Z', datePrepared: '2026-10-27T12:00:00.000Z' }),
      app({ id: '4', stage: 'Saved', company: 'Old Co', datePrepared: '2026-01-01T12:00:00.000Z', createdAt: '2026-01-01T12:00:00.000Z' }),
    ];
    const snap = buildAnalytics(records, { range: '30d', now, answers: [{ id: 'a', category: 'general', questionPattern: 'hear', answer: 'Indeed', approvedAt: now.toString() }] });
    expect(snap.inRange).toBe(3);
    expect(snap.applied).toBe(3);
    expect(snap.interviews).toBe(1);
    expect(snap.offers).toBe(1);
    expect(snap.topCompanies[0]).toMatchObject({ name: 'Acme', count: 2 });
    expect(snap.screeningAnswers).toBe(1);
    expect(snap.responseRate).toBeGreaterThan(0);
    expect(rangeStartIso('7d', now)).toMatch(/^2026-10-27/);
  });
});
