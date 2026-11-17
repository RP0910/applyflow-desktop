// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../../electron/db';
import { aesKeyWrapper } from '../../electron/applymind/crypto';
import { KnowledgeRepository } from '../../electron/applymind/repository';
import { ApplyMindService } from '../../electron/applymind/service';
import { classifyCapture, isExcludedCapture, isLongFormQuestion, type PageLearnItem } from '@/services/applymind/capture';
import { mapFactToOptions, matchFactQuestion, proposeFactFill, type StoredFact } from '@/services/applymind/factRules';
import { proposeFieldValues } from '@/services/forms/mapper';
import { canonicalizeQuestion } from '@/services/forms/questionMatch';
import { EMPTY_PROFILE } from '@/storage/repositories';
import type { ApprovedAnswer, CareerProfile } from '@/types';
import type { FormFieldDescriptor } from '@/types/fields';

const dirs: string[] = [];
const stores: Store[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function world() {
  const root = mkdtempSync(join(tmpdir(), 'applymind-learn-'));
  dirs.push(root);
  const store = new Store(join(root, 'applyflow.sqlite'));
  stores.push(store);
  const svc = new ApplyMindService(() => store, join(root, 'applymind.key'), aesKeyWrapper(randomBytes(32)));
  return { store, svc, repo: () => new KnowledgeRepository(store.db, store.deviceId) };
}

function answer(over: Partial<ApprovedAnswer> & Pick<ApprovedAnswer, 'id' | 'questionPattern' | 'answer'>): ApprovedAnswer {
  return { approvedAt: '2026-11-03T12:00:00.000Z', control: 'radio', options: ['Yes', 'No'], category: 'general', ...over };
}

function profile(answers: ApprovedAnswer[]): CareerProfile {
  return { ...EMPTY_PROFILE, approvedAnswers: answers };
}

function field(label: string, options: string[] = []): FormFieldDescriptor {
  return {
    fieldId: 'f', label, context: label, control: options.length ? 'select' : 'text', name: '', required: true,
    options, currentValue: '', accept: '', sensitive: null,
  };
}

function fact(over: Partial<StoredFact> & Pick<StoredFact, 'factKey' | 'value'>): StoredFact {
  return { family: 'sponsorship', country: 'US', wordings: [], choices: [], ...over };
}

const baseItem = (over: Partial<PageLearnItem>): PageLearnItem => ({
  kind: 'verified', question: 'Gender', answer: 'Decline to self-identify', control: 'select', options: ['Decline to self-identify', 'Woman'],
  category: 'demographic', longForm: false, platform: 'workday', jobTitle: 'Engineer', company: 'Example', country: null,
  factKey: 'eeo.gender', factLabel: 'Gender', optionsKey: 'decline to self-identify|woman', ...over,
});

describe('what a step stores', () => {
  it('classifies my edit, a correction, a filler value, and a site pre-fill', () => {
    const row = (over: Partial<Parameters<typeof classifyCapture>[0]>) => classifyCapture({
      fieldId: 'f', label: 'City', control: 'text', options: [], sensitive: null, baseline: '', finalValue: 'Tampa', fillerValue: null, touched: false, rejected: false, ...over,
    });
    expect(row({ touched: true })).toBe('verified');
    expect(row({ touched: true, fillerValue: 'Austin', finalValue: 'Tampa' })).toBe('correction');
    expect(row({ fillerValue: 'Tampa', finalValue: 'Tampa' })).toBe('accepted');
    expect(row({ baseline: 'Tampa', finalValue: 'Tampa' })).toBe('prefill');
    expect(row({ rejected: true, touched: true })).toBe('rejected');
    expect(row({ label: 'Password', touched: true, finalValue: 'secret' })).toBe('excluded');
    expect(isExcludedCapture('I agree to the terms', 'legal_consent', 'checkbox')).toBe(true);
    expect(isExcludedCapture('I certify this application', null, 'checkbox')).toBe(true);
    expect(isLongFormQuestion('Explain why you believe you are the ideal candidate', 'textarea')).toBe(true);
    expect(isLongFormQuestion('Cover letter', 'textarea')).toBe(false);
  });
});

describe('confirmed facts', () => {
  const yesNo = ['Yes', 'No'];
  it('matches sponsorship in both directions and refuses an uncertain one', () => {
    expect(matchFactQuestion('Will you now or in the future require visa sponsorship?')?.direction).toBe('yes_is_true');
    expect(matchFactQuestion('Do you require sponsorship to work?')?.direction).toBe('yes_is_true');
    expect(matchFactQuestion('Are you able to work without sponsorship?')?.direction).toBe('yes_is_false');
    expect(matchFactQuestion('Sponsorship')).toBeNull();
  });

  it('maps a known list, one option, no option, and more than one option', () => {
    expect(mapFactToOptions('Yes', yesNo, 'Yes', 'yes_is_true').reason).toBe('known-list');
    expect(mapFactToOptions('Yes', ['Yes', 'No', 'Prefer not to say'], null, 'yes_is_true')).toMatchObject({ value: 'Yes', reason: 'single' });
    expect(mapFactToOptions('Yes', ['Maybe', 'Later'], null, 'yes_is_true').reason).toBe('none');
    expect(mapFactToOptions('Yes', ['Yes', 'yes'], null, 'yes_is_true').reason).toBe('many');
    expect(mapFactToOptions('Yes', yesNo, null, 'yes_is_false')).toMatchObject({ value: 'No' });
  });

  it('never fills a US fact for another country or an unknown job country', () => {
    const saved = [fact({ factKey: 'sponsorship.US', value: 'No', wordings: ['will you require sponsorship'] })];
    expect(proposeFactFill('Will you require sponsorship to work in Canada?', yesNo, saved, 'CA', true, 'will you require sponsorship')).toBeNull();
    expect(proposeFactFill('Will you require sponsorship for the country in which this job is located?', yesNo, saved, null, true, 'job country')?.action).toBe('ask');
    const us = proposeFactFill('Will you require sponsorship to work in the United States?', yesNo, saved, 'US', true, 'will you require sponsorship');
    expect(us).toMatchObject({ action: 'fill', value: 'No', needsReview: false });
    const fresh = proposeFactFill('Would you require visa sponsorship in the United States?', yesNo, saved, 'US', true, 'a new wording');
    expect(fresh).toMatchObject({ action: 'fill', needsReview: true });
  });

  it('does not fill gender when that setting is off, and does not fill from an unconfirmed fact', () => {
    const gender = [fact({ factKey: 'eeo.gender', family: 'gender', country: null, value: 'Decline to self-identify', wordings: ['gender'] })];
    expect(proposeFactFill('Gender', ['Decline to self-identify', 'Woman'], gender, null, false, 'gender')?.action).toBe('ask');
    expect(proposeFactFill('Gender', ['Decline to self-identify', 'Woman'], [], null, true, 'gender')).toBeNull();
    const proposal = proposeFieldValues(
      [field('Gender', ['Decline to self-identify', 'Woman'])],
      { profile: EMPTY_PROFILE, resume: null, coverLetter: null, includeCoverLetter: false, resumeFileName: null, coverLetterFileName: null, useSavedAnswers: true, facts: [], learnDemographics: false },
    );
    expect(proposal[0]).toMatchObject({ action: 'manual' });
  });
});

describe('learning a page', () => {
  it('shows proposals until they are confirmed, then fills from the fact', async () => {
    const { svc } = world();
    await svc.syncFromProfile(profile([answer({ id: 'auth', catalogId: 'work_auth_us', category: 'work_authorization', questionPattern: 'Are you legally authorized to work in the United States?', answer: 'Yes' })]), { backup: async () => 'backup' });
    const open = await svc.reviews();
    const proposal = open.find((r) => r.kind === 'fact');
    expect(proposal?.normalizedQuestion).toBe('work_authorization.US');
    expect((await svc.fillContext()).facts).toHaveLength(0);
    await svc.resolve(proposal!.id, 'delete');
    expect((await svc.reviews()).some((r) => r.id === proposal!.id)).toBe(false);
  });

  it('creates a demographic fact only after one confirmation', async () => {
    const { svc } = world();
    const first = await svc.learnPage([baseItem({})], true);
    expect(first.prompts.map((p) => p.factKey)).toEqual(['eeo.gender']);
    expect(first.profileAnswers).toHaveLength(1);
    await svc.decideFact({ factKey: 'eeo.gender', accept: true, label: 'Gender', kind: 'gender', country: null, value: 'Decline to self-identify', question: 'Gender' });
    const second = await svc.learnPage([baseItem({})], true);
    expect(second.prompts).toHaveLength(0);
    const off = await svc.learnPage([baseItem({ factKey: 'eeo.pronouns', question: 'What pronouns do you use?' })], false);
    expect(off.profileAnswers).toHaveLength(0);
    expect(off.prompts).toHaveLength(0);
  });

  it('a page answer resolves the matching review and a long answer retrains without silent reuse', async () => {
    const { svc, repo } = world();
    const veteran = answer({ id: 'vet', category: 'veteran', questionPattern: 'Veteran Status', answer: 'I am not a protected veteran', control: 'select', options: [] });
    await svc.syncFromProfile(profile([veteran]), { backup: async () => 'backup' });
    expect(await svc.holdFillerRecords(async () => 'backup')).toBe(1);
    const learned = await svc.learnPage([baseItem({
      question: 'Veteran Status', answer: 'I am not a protected veteran', factKey: 'eeo.veteran', factLabel: 'Veteran Status', category: 'veteran', options: [], optionsKey: null,
    })], true);
    expect(learned.trained).toBe(true);
    expect((await svc.reviews()).some((r) => r.kind === 'review' && r.question === 'Veteran Status')).toBe(false);
    expect(await svc.exact({ question: 'Veteran Status', options: [], control: 'select' })).toBe('I am not a protected veteran');

    const essay = await svc.learnPage([baseItem({
      question: 'Explain why you are the ideal candidate', answer: 'Because of the work I have done.', longForm: true, factKey: null, factLabel: null, control: 'textarea', category: 'general',
    })], true);
    expect(essay.longFormIds).toHaveLength(1);
    expect(essay.profileAnswers).toHaveLength(0);
    expect(await svc.exact({ question: 'Explain why you are the ideal candidate', options: [], control: 'textarea' })).toBeNull();
    expect((await svc.fillContext()).drafts[canonicalizeQuestion('Explain why you are the ideal candidate')]).toBe('Because of the work I have done.');
    await svc.undoLearn(essay.longFormIds);
    expect(repo().countVerified()).toBe(1);
  });

  it('keeps an untouched generated answer as a draft and does not reuse it silently', async () => {
    const { svc } = world();
    const question = 'Explain why you are the ideal candidate';
    await svc.learnPage([baseItem({ kind: 'accepted', longForm: true, factKey: null, factLabel: null, question, answer: 'Draft text for the role.', control: 'textarea', category: 'general', options: [], optionsKey: null })], true);
    expect((await svc.fillContext()).drafts[canonicalizeQuestion(question)]).toBe('Draft text for the role.');
    expect(await svc.exact({ question, options: [], control: 'textarea' })).toBeNull();
  });
});
