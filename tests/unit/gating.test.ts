import { describe, expect, it } from 'vitest';
import { submitBlockers, unresolvedCritical } from '@/services/workflow/gating';
import { INITIAL_RUN, type ApplyRunState } from '@/services/workflow/applyRunner';
import type { FieldProposal, JobSession, TailoredResume } from '@/types';
import { emptySession, mockJob } from '../helpers';

const resume = { version: 1, issues: [], engine: 'local', model: null } as unknown as TailoredResume;
const ready = (): JobSession => ({ ...emptySession(mockJob()), resume, includeCoverLetter: false });
const run = (over: Partial<ApplyRunState> = {}): ApplyRunState => ({ ...INITIAL_RUN, status: 'ready', ...over });

describe('submit gate', () => {
  it('is open only when Dice’s final step is on screen and nothing blocks it', () => {
    expect(submitBlockers({ session: ready(), run: run(), duplicateApplied: false })).toEqual([]);
  });

  it('stays closed before the Submit step, without documents, or with no job', () => {
    expect(submitBlockers({ session: null, run: run(), duplicateApplied: false })).toEqual(['Open a Dice job first.']);
    expect(submitBlockers({ session: ready(), run: run({ status: 'attention' }), duplicateApplied: false })).toEqual([expect.stringMatching(/final step/)]);
    expect(submitBlockers({ session: { ...ready(), resume: null }, run: run(), duplicateApplied: false })[0]).toMatch(/hasn’t been written/);
    expect(submitBlockers({ session: { ...ready(), submittedAt: '2026-10-30T10:00:00Z' }, run: run(), duplicateApplied: false })).toEqual(['Already submitted.']);
  });

  it('blocks on unverifiable lines, open questions and an unacknowledged duplicate', () => {
    const bad = { ...ready(), resume: { ...resume, issues: [{ id: '1', severity: 'critical', kind: 'invented_metric', message: 'x', autoFixable: true }] } as unknown as TailoredResume };
    expect(unresolvedCritical(bad)).toHaveLength(1);
    expect(submitBlockers({ session: bad, run: run(), duplicateApplied: false })[0]).toMatch(/couldn’t be verified/);
    expect(submitBlockers({ session: ready(), run: run({ questions: [{ fieldId: 'q' } as FieldProposal] }), duplicateApplied: false })[0]).toMatch(/questions/);
    expect(submitBlockers({ session: ready(), run: run(), duplicateApplied: true })[0]).toMatch(/already applied/);
    expect(submitBlockers({ session: { ...ready(), duplicateAcknowledged: true }, run: run(), duplicateApplied: true })).toEqual([]);
  });

  it('only counts cover-letter issues when a cover letter is included', () => {
    const cl = { issues: [{ id: '2', severity: 'critical', kind: 'invented_employer', message: 'x', autoFixable: false }] };
    const s = { ...ready(), coverLetter: cl } as unknown as JobSession;
    expect(submitBlockers({ session: s, run: run(), duplicateApplied: false })).toEqual([]);
    expect(submitBlockers({ session: { ...s, includeCoverLetter: true }, run: run(), duplicateApplied: false })).toHaveLength(1);
  });
});
