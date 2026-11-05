import { describe, expect, it, vi } from 'vitest';
import { backTargetIndex, isDiceApplicationUrl, isDiceSearchUrl, searchIndex } from '@/services/platforms/dice/navigation';
import { SUCCESS_PATTERNS } from '@/services/platforms/dice/selectors';

const SEARCH = 'https://www.dice.com/jobs?q=devops&location=Seattle,%20WA&page=2';
const JOB = 'https://www.dice.com/job-detail/20b7c7bc-af56-4582-9c68-fa8d3fac3e1f';
const WIZ = 'https://www.dice.com/job-applications/20b7c7bc-af56-4582-9c68-fa8d3fac3e1f/wizard';
const DONE = 'https://www.dice.com/job-applications/20b7c7bc-af56-4582-9c68-fa8d3fac3e1f/wizard/success';

describe('Dice page kinds', () => {
  it('recognizes search results, not job pages or other sites', () => {
    expect(isDiceSearchUrl(SEARCH)).toBe(true);
    expect(isDiceSearchUrl('https://www.dice.com/jobs')).toBe(true);
    expect(isDiceSearchUrl('https://www.dice.com/jobs/q-devops-jobs')).toBe(true);
    expect(isDiceSearchUrl(JOB)).toBe(false);
    expect(isDiceSearchUrl('https://www.dice.com/jobs/detail/abc')).toBe(false);
    expect(isDiceSearchUrl('https://evil.example/jobs?q=x')).toBe(false);
    expect(isDiceApplicationUrl(WIZ)).toBe(true);
    expect(isDiceApplicationUrl(DONE)).toBe(true);
    expect(isDiceApplicationUrl(JOB)).toBe(false);
  });
});

describe('Back and Search results', () => {
  const history = [SEARCH, JOB, WIZ, WIZ, DONE];
  it('Back leaves all application pages in one step, landing on the job', () => {
    expect(backTargetIndex(history, 4)).toBe(1);
    expect(backTargetIndex(history, 2)).toBe(1);
    expect(backTargetIndex(history, 1)).toBe(0);
    expect(backTargetIndex(history, 0)).toBe(-1);
    expect(backTargetIndex([WIZ, DONE], 1)).toBe(-1);
  });
  it('finds the latest search results behind the current page', () => {
    expect(searchIndex(history, 4)).toBe(0);
    expect(searchIndex([SEARCH, JOB, SEARCH.replace('page=2', 'page=3'), JOB, WIZ, DONE], 5)).toBe(2);
    expect(searchIndex([JOB, WIZ, DONE], 2)).toBe(-1);
  });
  it('recognizes Dice’s confirmation page text', () => {
    expect(SUCCESS_PATTERNS.some((p) => p.test('Fantastic! Your application is on its way.'))).toBe(true);
  });
});

describe('after applying, the panel leads back to the search', () => {
  it('desktop: the main action returns to the search results', async () => {
    const { primaryAction } = await import('@/sidepanel/PanelApp');
    const { INITIAL_RUN } = await import('@/services/workflow/applyRunner');
    const invoke = vi.fn(async () => undefined);
    (window as unknown as { applyflow?: unknown }).applyflow = { invoke, on: () => () => undefined };
    try {
      const wf = { session: { submittedAt: '2026-11-02T15:21:00Z', job: { company: 'AaraTechnologies Inc' } }, run: { ...INITIAL_RUN, status: 'submitted' } } as never;
      const p = primaryAction(wf, true);
      expect(p).toMatchObject({ label: 'Back to search results' });
      expect(p.disabled).toBeFalsy();
      p.run!();
      expect(invoke).toHaveBeenCalledWith('dice.backToSearch');
    } finally {
      delete (window as unknown as { applyflow?: unknown }).applyflow;
    }
  });
});
