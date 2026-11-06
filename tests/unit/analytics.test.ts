import { describe, expect, it } from 'vitest';
import type { ApplicationRecord } from '@/types';
import { buildAnalytics, rangeStartIso } from '@/services/history/analytics';
import { addDays, todayLocal } from '@/utils/dates';

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
    expect(snap.activity.at(-1)?.current).toBe(true);
    expect(snap.activity.at(-1)?.key).toBe(todayLocal(new Date(now)));
    const start = rangeStartIso('7d', now)!;
    expect(todayLocal(new Date(start))).toBe(addDays(todayLocal(new Date(now)), -6));
    expect(new Date(start).getHours()).toBe(0);
  });

  it('includes an application saved at the current time and ignores closed jobs as replies', () => {
    const now = Date.parse('2026-11-06T15:45:00.000Z');
    const today = new Date(now).toISOString();
    const todayDay = todayLocal(new Date(now));
    const windowStart = addDays(todayDay, -6);
    const earlier = new Date(now - 2 * 86_400_000).toISOString();
    const records = [
      app({ id: 'now', stage: 'Applied', dateApplied: today, datePrepared: today, createdAt: today, updatedAt: today }),
      app({ id: 'edge', stage: 'Saved', datePrepared: windowStart, dateApplied: null, createdAt: windowStart, updatedAt: windowStart }),
      app({
        id: 'closed',
        stage: 'Closed Job',
        dateApplied: earlier,
        datePrepared: earlier,
        createdAt: earlier,
        updatedAt: today,
        stageHistory: [{ stage: 'Closed Job', at: today }],
      }),
      app({ id: 'silent', stage: 'No Response', dateApplied: earlier, datePrepared: earlier, createdAt: earlier, updatedAt: earlier }),
    ];
    const snap = buildAnalytics(records, { range: '7d', now });
    expect(snap.inRange).toBe(4);
    expect(snap.appliedToday).toBe(1);
    expect(snap.activity.at(-1)?.applied).toBe(1);
    expect(snap.activity[0]?.key).toBe(snap.rangeStart);
    expect(snap.closedJobs).toBe(1);
    expect(snap.replies).toBe(0);
    expect(snap.responseRate).toBe(0);
    expect(snap.byStage.some((s) => s.stage === 'Closed Job' && s.count === 1)).toBe(true);
    expect(snap.insights.some((line) => /today|Closed Job|reply/i.test(line))).toBe(true);
  });
});
