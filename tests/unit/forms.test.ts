import { describe, expect, it } from 'vitest';
import { detectSensitive, classifyFieldSensitivity } from '@/services/forms/sensitive';
import { scanFields, fillFields } from '@/services/forms/domFields';
import { approvedFor, proposeFieldValues, rememberAnswer, semanticOf } from '@/services/forms/mapper';
import { EMPTY_PROFILE } from '@/storage/repositories';
import type { CareerProfile } from '@/types';
import { tailorLocally } from '@/services/tailoring/localTailor';
import { analyzeJobLocally } from '@/services/analysis/localAnalyzer';
import { classifySkills } from '@/services/matching/evidence';
import { diceAdapter } from '@/services/platforms/dice/adapter';
import { exampleResume, fixture, mockJob } from '../helpers';

function loadQuestions() {
  document.body.innerHTML = fixture('apply-questions.html').replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, '');
  return diceAdapter.findApplicationRoot(document)!;
}

describe('sensitive-field detection', () => {
  it.each([
    ['Are you legally authorized to work in the United States?', 'work_authorization'],
    ['Will you now or in the future require sponsorship for employment visa status?', 'sponsorship'],
    ['Do you require H-1B transfer?', 'sponsorship'],
    ['Security clearance level', 'security_clearance'],
    ['Have you ever been convicted of a felony?', 'criminal_background'],
    ['Disability status', 'disability'],
    ['Protected veteran status', 'veteran'],
    ['Gender', 'demographic'],
    ['Race / Ethnicity (voluntary)', 'demographic'],
    ['Expected salary (USD)', 'salary'],
    ['Desired hourly rate', 'salary'],
    ['Are you willing to relocate to Chicago, IL?', 'relocation'],
    ['Years of experience with Python', 'years_experience'],
    ['How many years have you worked with AWS?', 'years_experience'],
    ['Date of birth', 'date_of_birth'],
    ['I certify that the information provided is true and complete', 'legal_consent'],
  ])('%s → %s', (label, category) => {
    expect(detectSensitive(label)).toBe(category);
  });

  it.each(['First Name', 'Email Address', 'LinkedIn URL', 'Professional Summary', 'Upload your resume'])('%s is not sensitive', (label) => {
    expect(detectSensitive(label)).toBeNull();
  });

  it('uses surrounding text only when the label itself is vague', () => {
    expect(classifyFieldSensitivity('Yes', 'Do you require visa sponsorship?')).toBe('sponsorship');
    expect(classifyFieldSensitivity('Email', 'We sponsor visas for some roles')).toBeNull();
  });
});

describe('field scanning and proposals', () => {
  const profile: CareerProfile = {
    ...EMPTY_PROFILE,
    fullName: 'Jordan Rivera',
    email: 'jordan.rivera@example.com',
    phone: '(312) 555-0148',
    linkedinUrl: 'https://linkedin.com/in/jordan-rivera-example',
    approvedAnswers: [{ id: 'a1', category: 'work_authorization', questionPattern: '', answer: 'Yes', approvedAt: '' }],
  };
  const resume = exampleResume();
  const job = mockJob();
  const analysis = analyzeJobLocally(job, resume);
  const evidence = classifySkills(analysis.requiredSkills, analysis.preferredSkills, resume);
  const tailored = tailorLocally({ master: resume, job, analysis, evidence, length: 'two_pages', version: 1 });

  it('finds visible controls with labels, collapses radio groups and skips hidden inputs', () => {
    const fields = scanFields(loadQuestions());
    const labels = fields.map((f) => f.label);
    expect(labels).toContain('First Name');
    expect(labels).toContain('Are you legally authorized to work in the United States?');
    expect(labels).not.toContain('Hidden');
    const auth = fields.find((f) => f.label.startsWith('Are you legally'))!;
    expect(auth.control).toBe('radio');
    expect(auth.options).toEqual(['Yes', 'No']);
    expect(auth.required).toBe(true);
    expect(fields.find((f) => f.label === 'Mobile phone')!.currentValue).toBe('(555) 000-0000');
  });

  it('leaves file inputs to the upload engine instead of treating them as form fields', () => {
    const fields = scanFields(loadQuestions());
    expect(fields.some((f) => f.control === 'file')).toBe(false);
  });

  it('applies a saved answer only when enabled, only to the matching category, and marks where it came from', () => {
    const fields = scanFields(loadQuestions());
    const ctx = { profile, resume: tailored, coverLetter: null, includeCoverLetter: false, resumeFileName: null, coverLetterFileName: null };
    const on = proposeFieldValues(fields, { ...ctx, useSavedAnswers: true });
    expect(on.find((p) => p.sensitive === 'work_authorization')).toMatchObject({ action: 'answer', proposedValue: 'Yes', source: 'Your saved answer' });
    expect(on.find((p) => p.sensitive === 'sponsorship')).toMatchObject({ action: 'manual', proposedValue: '' });
    const consent = proposeFieldValues(fields, { ...ctx, useSavedAnswers: true, profile: { ...profile, approvedAnswers: [{ id: 'c', category: 'legal_consent', questionPattern: '', answer: 'checked', approvedAt: '' }] } });
    expect(consent.filter((p) => p.sensitive === 'legal_consent').every((p) => p.action === 'manual')).toBe(true);
    expect(consent.some((p) => p.sensitive === 'legal_consent')).toBe(true);
    const off = proposeFieldValues(fields, ctx);
    expect(off.find((p) => p.sensitive === 'work_authorization')).toMatchObject({ action: 'manual', proposedValue: '', approvedSuggestion: 'Yes' });
  });

  it('never proposes a value for a sensitive question', () => {
    const fields = scanFields(loadQuestions());
    const proposals = proposeFieldValues(fields, { profile, resume: tailored, coverLetter: null, includeCoverLetter: false, resumeFileName: 'Jordan-Rivera-Resume.pdf', coverLetterFileName: null });
    for (const p of proposals.filter((x) => x.sensitive)) {
      expect(p.action).toBe('manual');
      expect(p.proposedValue).toBe('');
    }
    const sensitiveCount = proposals.filter((x) => x.sensitive).length;
    expect(sensitiveCount).toBeGreaterThanOrEqual(11);
    expect(proposals.find((p) => p.sensitive === 'work_authorization')!.approvedSuggestion).toBe('Yes');
    expect(proposals.find((p) => p.sensitive === 'sponsorship')!.approvedSuggestion).toBeNull();
  });

  it('fills safe fields from the profile and documents, with source and confidence', () => {
    const fields = scanFields(loadQuestions());
    const proposals = proposeFieldValues(fields, { profile, resume: tailored, coverLetter: null, includeCoverLetter: false, resumeFileName: 'Jordan-Rivera-Resume.pdf', coverLetterFileName: null });
    const by = (label: string) => proposals.find((p) => p.label === label)!;
    expect(by('First Name')).toMatchObject({ action: 'fill', proposedValue: 'Jordan', source: 'Profile → Name', confidence: 'high' });
    expect(by('Last Name').proposedValue).toBe('Rivera');
    expect(by('Email Address').proposedValue).toBe('jordan.rivera@example.com');
    expect(by('Mobile phone')).toMatchObject({ action: 'skip', status: 'skipped' });
    expect(by('LinkedIn URL').proposedValue).toBe('https://linkedin.com/in/jordan-rivera-example');
    expect(by('Professional Summary').action).toBe('fill');
    expect(by('Upload your resume')).toBeUndefined();
    expect(by('What is your favorite programming paradigm?')).toMatchObject({ action: 'manual', semantic: 'unknown' });
  });

  it('fills text inputs the way a user would and refuses to tick choices', () => {
    const root = loadQuestions();
    const fields = scanFields(root);
    const first = fields.find((f) => f.label === 'First Name')!;
    const auth = fields.find((f) => f.label.startsWith('Are you legally'))!;
    let inputEvents = 0;
    document.getElementById('fn')!.addEventListener('input', () => inputEvents++);
    const res = fillFields(document, [
      { fieldId: first.fieldId, kind: 'value', value: 'Jordan' },
      { fieldId: auth.fieldId, kind: 'value', value: 'Yes' },
      { fieldId: 'af-missing', kind: 'value', value: 'x' },
    ]);
    expect(res[0]).toMatchObject({ ok: true, finalValue: 'Jordan' });
    expect(inputEvents).toBe(1);
    expect(res[1]).toMatchObject({ ok: false });
    expect((document.querySelector('input[name=auth]:checked') as HTMLInputElement | null)).toBeNull();
    expect(res[2]!.error).toMatch(/no longer on the page/);
  });

  it('maps field semantics from labels and input types', () => {
    expect(semanticOf({ label: '', name: 'applicant_email', control: 'email' })).toBe('email');
    expect(semanticOf({ label: 'Attach CV', name: '', control: 'file' })).toBe('resume_upload');
    expect(semanticOf({ label: 'Cover letter', name: '', control: 'textarea' })).toBe('cover_letter_text');
  });

  it('reuses similar screening questions and category-only answers', () => {
    const answers = rememberAnswer(
      [{ id: 'g1', category: 'demographic', questionPattern: 'Gender', answer: 'Male', approvedAt: '' }],
      { category: 'veteran', questionPattern: 'protected veteran status', answer: 'Not a Veteran' },
      () => 'a2',
      '2026-01-01',
    );
    expect(approvedFor(answers, { label: 'What is your gender?', context: '', sensitive: 'demographic', options: ['Male', 'Female', 'Decline'], control: 'select' })).toBe('Male');
    expect(approvedFor(answers, { label: 'Veteran Status', context: '', sensitive: 'veteran', options: ['Not a Veteran', 'Veteran'], control: 'select' })).toBe('Not a Veteran');
    expect(approvedFor([{ id: 'r', category: 'demographic', questionPattern: '', answer: 'Asian', approvedAt: '' }], { label: 'Race / Ethnicity', context: '', sensitive: 'demographic', options: ['Asian', 'White'], control: 'select' })).toBe('Asian');
  });
});
