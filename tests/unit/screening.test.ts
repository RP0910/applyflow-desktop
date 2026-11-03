import { describe, expect, it } from 'vitest';
import { approvedFor, rememberAnswer } from '@/services/forms/mapper';
import { canonicalizeQuestion, matchOption, questionSimilarity, scoreAgainstPatterns } from '@/services/forms/questionMatch';
import { SCREENING_CATALOG, savedForCatalog } from '@/services/forms/screeningCatalog';
import type { ApprovedAnswer } from '@/types';

describe('screening question matching', () => {
  it('treats common rephrasings of “how did you hear” as the same question', () => {
    expect(questionSimilarity('How did you hear about this job?', 'How did you learn about this role?')).toBeGreaterThanOrEqual(0.5);
    expect(scoreAgainstPatterns('Where did you hear about this opportunity?', ['How did you hear about us?'])).toBeGreaterThanOrEqual(0.42);
  });

  it('matches visa sponsorship variants to a saved answer', () => {
    const answers: ApprovedAnswer[] = [
      {
        id: 's1',
        category: 'sponsorship',
        questionPattern: 'Will you now or in the future require visa sponsorship for employment?',
        answer: 'No',
        approvedAt: '',
        control: 'radio',
        options: ['Yes', 'No'],
        aliases: ['Do you require visa sponsorship?', 'Do you need H-1B sponsorship?'],
      },
    ];
    expect(
      approvedFor(answers, {
        label: 'Will you now or in the future require sponsorship for employment visa status?',
        context: '',
        sensitive: 'sponsorship',
        options: ['Yes', 'No'],
        control: 'radio',
      }),
    ).toBe('No');
    expect(
      approvedFor(answers, {
        label: 'Do you require H-1B sponsorship?',
        context: '',
        sensitive: 'sponsorship',
        options: ['Yes', 'No'],
        control: 'select',
      }),
    ).toBe('No');
  });

  it('maps saved answers onto differently worded select options', () => {
    expect(matchOption(['I am not a protected veteran', 'I identify as a protected veteran', 'Prefer not to say'], 'Not a Veteran')).toBeTruthy();
    expect(matchOption(['Yes', 'No'], 'yes')).toBe('Yes');
  });

  it('canonicalizes synonym phrases for overlap', () => {
    const a = canonicalizeQuestion('How did you hear about this job?');
    const b = canonicalizeQuestion('How did you learn about this role?');
    expect(a).toContain('hear_about');
    expect(b).toContain('hear_about'); // learn about → same canonical phrase
    expect(questionSimilarity('How did you hear about this job?', 'How did you learn about this role?')).toBeGreaterThan(0.4);
  });

  it('dedupes similar patterns when remembering, preserving control and options', () => {
    const once = rememberAnswer(
      [],
      {
        category: 'general',
        questionPattern: 'How did you hear about us?',
        answer: 'Indeed',
        control: 'combobox',
        options: ['Indeed', 'LinkedIn', 'Referral'],
        aliases: ['How did you find this position?'],
      },
      () => 'a1',
      '2026-01-01',
    );
    const twice = rememberAnswer(
      once,
      {
        category: 'general',
        questionPattern: 'How did you learn about this role?',
        answer: 'LinkedIn',
        control: 'select',
        options: ['LinkedIn', 'Indeed'],
      },
      () => 'a2',
      '2026-01-02',
    );
    expect(twice).toHaveLength(1);
    expect(twice[0]!.answer).toBe('LinkedIn');
    expect(twice[0]!.control).toBe('select');
    expect(twice[0]!.options).toEqual(['LinkedIn', 'Indeed']);
  });

  it('links catalog entries to saved answers by catalogId or wording', () => {
    const hear = SCREENING_CATALOG.find((q) => q.id === 'hear_about')!;
    const saved: ApprovedAnswer[] = [
      {
        id: 'x',
        category: 'general',
        questionPattern: hear.prompt,
        answer: 'Dice',
        approvedAt: '',
        catalogId: 'hear_about',
        control: 'combobox',
      },
    ];
    expect(savedForCatalog(saved, hear)?.answer).toBe('Dice');
    expect(SCREENING_CATALOG.length).toBeGreaterThanOrEqual(25);
  });
});
