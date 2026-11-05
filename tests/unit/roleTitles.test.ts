import { describe, expect, it } from 'vitest';
import {
  applyTitlesWithVerifiedExperience,
  suggestedTitleAcceptable,
  validateRoleTitlePlan,
  RoleTitleValidationError,
} from '@/services/workflow/cvRoleTitles';
import { buildMasterFromForm, emptyBuilder } from '@/services/resume/builder';
import { EMPTY_PROFILE } from '@/storage/repositories';

describe('role title validation', () => {
  it('accepts a posting-aligned title ladder from the JD step', () => {
    const titles = validateRoleTitlePlan(
      [
        { periodIndex: 0, role_title: 'Senior Backend Engineer' },
        { periodIndex: 1, role_title: 'Backend Engineer' },
      ],
      2,
      'Senior Backend Engineer',
    );
    expect(titles[0]).toBe('Senior Backend Engineer');
  });

  it('rejects seniority that increases for older periods', () => {
    expect(() =>
      validateRoleTitlePlan(
        [
          { periodIndex: 0, role_title: 'Software Engineer' },
          { periodIndex: 1, role_title: 'Staff Engineer' },
        ],
        2,
        'Software Engineer',
      ),
    ).toThrow(RoleTitleValidationError);
  });

  it('keeps verified titles when JD suggestions are not acceptable', () => {
    const profile = { ...EMPTY_PROFILE, fullName: 'Test' };
    const form = emptyBuilder();
    form.jobs[0] = { ...form.jobs[0]!, company: 'Acme', title: 'Senior Software Engineer', start: '2020-01', current: true };
    const master = buildMasterFromForm(form, profile, 'Candidate');
    expect(suggestedTitleAcceptable('Principal Staff Engineer', 'Senior Software Engineer', 'Senior Backend Engineer', 0)).toBe(false);
    const { titles, keptVerified } = applyTitlesWithVerifiedExperience(
      ['Principal Staff Engineer'],
      'Senior Backend Engineer',
      master,
      profile,
    );
    expect(titles[0]).toBe('Senior Software Engineer');
    expect(keptVerified).toBe(1);
  });
});
