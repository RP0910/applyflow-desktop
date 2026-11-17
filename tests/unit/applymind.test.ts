// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../../electron/db';
import { aesKeyWrapper, decryptString, loadOrCreateDek } from '../../electron/applymind/crypto';
import { blobIsSealed, KnowledgeRepository } from '../../electron/applymind/repository';
import { ApplyMindService } from '../../electron/applymind/service';
import { planMigration } from '@/services/applymind/plan';
import { coldStartUnlocked } from '@/services/applymind/constants';
import { exactVerifiedValue, GENERAL_CONTEXT } from '@/services/applymind/exact';
import { knowledgeSyncMessage, profileSaveFeedback } from '@/services/applymind/syncNotice';
import { canonicalizeQuestion } from '@/services/forms/questionMatch';
import { questionTypeOf } from '@/services/applymind/questionType';
import { predictCategory, rankScore, shouldActivate, trainFromRecords } from '@/services/applymind/train';
import type { ApprovedAnswer, CareerProfile } from '@/types';
import type { LearnedBundle, TrainingRecord } from '@/services/applymind/types';

const SECRET = 'ZEBRA-APPLYMIND-ANSWER';
const openStores: Store[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const s of openStores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function answer(over: Partial<ApprovedAnswer> & Pick<ApprovedAnswer, 'id' | 'questionPattern' | 'answer' | 'category'>): ApprovedAnswer {
  return {
    approvedAt: '2026-11-03T12:00:00.000Z',
    control: 'radio',
    options: ['Yes', 'No'],
    ...over,
  };
}

function profile(answers: ApprovedAnswer[]): CareerProfile {
  return {
    fullName: '', email: '', phone: '', location: '', streetAddress: '', addressLine2: '', city: '', state: '', postalCode: '', country: '',
    headline: '', professionalSummary: '', verifiedSkills: [], workAuthorizationNote: '', preferredTitles: [], preferredLocations: [],
    remotePreference: 'any', salaryPreference: '', availability: '', portfolioLinks: [], linkedinUrl: '', githubUrl: '',
    approvedAnswers: answers, updatedAt: '',
  };
}

function world(): { store: Store; svc: ApplyMindService; wrapper: ReturnType<typeof aesKeyWrapper>; keyFile: string; repo: () => KnowledgeRepository } {
  const root = mkdtempSync(join(tmpdir(), 'applymind-'));
  dirs.push(root);
  const store = new Store(join(root, 'applyflow.sqlite'));
  openStores.push(store);
  const wrapper = aesKeyWrapper(randomBytes(32));
  const keyFile = join(root, 'applymind.key');
  const svc = new ApplyMindService(() => store, keyFile, wrapper);
  return { store, svc, wrapper, keyFile, repo: () => new KnowledgeRepository(store.db, store.deviceId) };
}

const auth = answer({
  id: 'auth',
  catalogId: 'work_auth_us',
  category: 'work_authorization',
  questionPattern: 'Are you legally authorized to work in the United States?',
  answer: 'Yes',
});

describe('migration plan', () => {
  it('keeps user-entered answers as verified and proposes only unambiguous facts', () => {
    const plan = planMigration([
      auth,
      answer({ id: 'move', catalogId: 'relocate', category: 'relocation', questionPattern: 'Are you willing to relocate?', answer: 'No' }),
      answer({ id: 'years', catalogId: 'years_total', category: 'years_experience', questionPattern: 'How many years of professional experience do you have?', answer: '12', control: 'text', options: [] }),
      answer({ id: 'pay1', catalogId: 'salary_expectation', category: 'salary', questionPattern: 'What are your salary expectations?', answer: '100000', control: 'text', options: [] }),
      answer({ id: 'pay2', catalogId: 'salary_expectation', category: 'salary', questionPattern: 'Expected salary', answer: '90000', control: 'text', options: [], approvedAt: '2026-11-04T00:00:00.000Z' }),
      answer({ id: 'custom', category: 'general', questionPattern: 'Which build system does your team use?', answer: 'Bazel', control: 'text', options: [] }),
    ], 'device-1', '2026-11-17T00:00:00.000Z');

    expect(plan.records).toHaveLength(6);
    expect(plan.records.every((r) => r.status === 'verified' && r.provenance.kind === 'user_entered')).toBe(true);
    expect(plan.proposals.map((p) => p.factKey)).toEqual(['work_authorization.US']);
    expect(plan.proposals[0]!.value).toBe('Yes');
    expect(plan.skips.map((s) => s.reason).sort()).toEqual(['computed_from_dates', 'conflicting_values', 'conflicting_values', 'context_dependent', 'custom_wording']);
    const noisy = planMigration([
      answer({ id: 'spouse', category: 'veteran', questionPattern: 'I am a Military or Veteran Spouse', answer: 'I am not a protected veteran', control: 'select', options: ['I am not a protected veteran'] }),
      answer({ id: 'raceblob', category: 'demographic', questionPattern: `${'A person of Cuban, Mexican, Puerto Rican, or other Spanish culture. '.repeat(6)}Asian`, answer: 'Asian', control: 'select', options: ['Asian'] }),
    ], 'device-1', '2026-11-17T00:00:00.000Z');
    expect(noisy.proposals).toEqual([]);
    expect(noisy.records).toHaveLength(2);
    expect(plan.records.find((r) => r.sourceAnswerId === 'pay1')!.freshnessDays).toBe(90);
    expect(plan.records.find((r) => r.sourceAnswerId === 'auth')!.questionType).toBe('availability_authorization');
  });

  it('maps controls onto question types', () => {
    expect(questionTypeOf(auth)).toBe('availability_authorization');
    expect(questionTypeOf(answer({ id: 's', category: 'salary', questionPattern: 'Salary?', answer: '1', control: 'text', options: [] }))).toBe('salary');
    expect(questionTypeOf(answer({ id: 'l', category: 'general', questionPattern: 'Tell us about a project', answer: 'x'.repeat(300), control: 'textarea', options: [] }))).toBe('long_form');
    expect(questionTypeOf(answer({ id: 'd', category: 'general', questionPattern: 'Degree', answer: "Bachelor's", control: 'select', options: ["Bachelor's"] }))).toBe('dropdown');
  });
});

describe('learned layer', () => {
  const samples: TrainingRecord[] = [
    ['Are you legally authorized to work in the United States?', 'work_authorization'],
    ['Do you have the legal right to work in the United States?', 'work_authorization'],
    ['Work authorization status', 'work_authorization'],
    ['Will you now or in the future require visa sponsorship?', 'sponsorship'],
    ['Do you require visa sponsorship?', 'sponsorship'],
    ['Will you require immigration sponsorship to work?', 'sponsorship'],
    ['What are your salary expectations?', 'salary'],
    ['Desired compensation', 'salary'],
    ['Expected annual salary', 'salary'],
  ].map(([original, category], i) => ({
    id: `t${i}`, patternId: `p-${category}`, category: category!, questionType: 'short_text', normalized: original!, original: original!, answer: SECRET,
  }));

  it('learns question categories from verified examples and keeps answer text out of the model', () => {
    const bundle = trainFromRecords(samples, '2026-11-17T00:00:00.000Z', null);
    expect(predictCategory(bundle, 'Do you now or in the future need H-1B sponsorship?').category).toBe('sponsorship');
    expect(predictCategory(bundle, 'Are you authorized to work in the US?').category).toBe('work_authorization');
    expect(bundle.tierAUnlocked).toBe(false);
    expect(JSON.stringify(bundle)).not.toContain(SECRET);
    expect(bundle.classifier.trainAccuracy).toBe(1);
  });

  it('ranks a reworded question with its own pattern', () => {
    const records: TrainingRecord[] = [
      { id: 'a', patternId: 'python', category: 'years_experience', questionType: 'experience', normalized: 'years of python', original: 'How many years of Python experience do you have?', answer: '9' },
      { id: 'b', patternId: 'python', category: 'years_experience', questionType: 'experience', normalized: 'python professionally', original: 'How long have you worked professionally with Python?', answer: '9' },
      { id: 'c', patternId: 'auth', category: 'work_authorization', questionType: 'yes_no', normalized: 'authorized', original: 'Are you legally authorized to work in the United States?', answer: 'Yes' },
    ];
    const bundle = trainFromRecords(records, '2026-11-17T00:00:00.000Z', null);
    const query = records[0]!;
    expect(rankScore(bundle.reranker.weights, query, records[1]!)).toBeGreaterThan(rankScore(bundle.reranker.weights, query, records[2]!));
  });

  it('keeps the current model when a retrained one is worse on held-out questions', () => {
    const current = { reranker: { heldOutTop1: 0.9, trainTop1: 1 } } as LearnedBundle;
    const worse = { reranker: { heldOutTop1: 0.4, trainTop1: 1 } } as LearnedBundle;
    const unmeasured = { reranker: { heldOutTop1: null, trainTop1: 1 } } as LearnedBundle;
    expect(shouldActivate(null, worse)).toBe(true);
    expect(shouldActivate(current, worse)).toBe(false);
    expect(shouldActivate(current, unmeasured)).toBe(false);
    expect(shouldActivate(current, { reranker: { heldOutTop1: 0.9, trainTop1: 0 } } as LearnedBundle)).toBe(true);
  });

  it('unlocks Tier A only after the cold-start gate', () => {
    expect(coldStartUnlocked({ records: 34, patterns: 20, heldOutPatterns: 4, heldOutWrong: 0, heldOutRanked: 4 })).toBe(false);
    expect(coldStartUnlocked({ records: 80, patterns: 25, heldOutPatterns: 20, heldOutWrong: 1, heldOutRanked: 20 })).toBe(false);
    expect(coldStartUnlocked({ records: 80, patterns: 25, heldOutPatterns: 20, heldOutWrong: 0, heldOutRanked: 0 })).toBe(false);
    expect(coldStartUnlocked({ records: 80, patterns: 25, heldOutPatterns: 20, heldOutWrong: 0, heldOutRanked: 20 })).toBe(true);
  });

  it('retrieves a newly verified answer in the same session and retrains on the next one', async () => {
    const { svc, repo } = world();
    const backup = async () => 'backup';
    const first = await svc.syncFromProfile(profile([auth]), { backup });
    expect(first.trained).toBe(true);
    expect(first.modelVersion).toBe('am-lr-1');
    expect(await svc.exact({ question: auth.questionPattern, options: ['Yes', 'No'], control: 'radio' })).toBe('Yes');
    expect(await svc.exact({ question: 'Will you now or in the future require visa sponsorship?', options: ['Yes', 'No'], control: 'radio' })).toBeNull();

    const secondAnswer = answer({ id: 'sponsor', catalogId: 'sponsorship', category: 'sponsorship', questionPattern: 'Will you now or in the future require visa sponsorship?', answer: 'No' });
    const second = await svc.syncFromProfile(profile([auth, secondAnswer]), { backup });
    expect(second.created).toBe(1);
    expect(second.trained).toBe(true);
    expect(second.modelVersion).toBe('am-lr-2');
    expect(repo().countVerified()).toBe(2);
    expect(repo().countActive()).toBe(2);
    expect(await svc.exact({ question: secondAnswer.questionPattern, options: ['Yes', 'No'], control: 'radio' })).toBe('No');

    const again = await svc.syncFromProfile(profile([auth, secondAnswer]), { backup });
    expect(again.created).toBe(0);
    expect(again.trained).toBe(false);
    expect(repo().countActive()).toBe(2);
  });

  it('records a filled answer as accepted and does not reuse it as verified', async () => {
    const { svc, repo } = world();
    await svc.syncFromProfile(profile([auth]), { backup: async () => 'backup' });
    const wrote = await svc.acceptFills([{ question: 'How did you hear about this job?', answer: 'Dice', category: 'general', options: [], control: 'text' }]);
    expect(wrote).toBe(1);
    expect(repo().countVerified()).toBe(1);
    expect(repo().countActive()).toBe(2);
    expect(await svc.exact({ question: 'How did you hear about this job?', options: [], control: 'text' })).toBeNull();
    const skipped = await svc.acceptFills([{ question: auth.questionPattern, answer: 'No', category: 'work_authorization', options: ['Yes', 'No'], control: 'radio' }]);
    expect(skipped).toBe(0);
    expect(await svc.exact({ question: auth.questionPattern, options: ['Yes', 'No'], control: 'radio' })).toBe('Yes');
  });
});

describe('exact verified reuse', () => {
  it('fills only one unambiguous verified answer and ignores a different job', () => {
    const question = 'Are you legally authorized to work in the United States?';
    const verified = {
      normalizedQuestion: canonicalizeQuestion(question),
      answer: 'Yes',
      status: 'verified' as const,
      context: GENERAL_CONTEXT,
    };
    expect(exactVerifiedValue([verified], { question, options: ['Yes', 'No'], control: 'radio' })).toBe('Yes');
    expect(exactVerifiedValue([verified], { question: 'Are you authorized to work in the US?', options: ['Yes', 'No'], control: 'radio' })).toBeNull();
    expect(exactVerifiedValue([{ ...verified, status: 'accepted' }], { question, options: ['Yes', 'No'], control: 'radio' })).toBeNull();
    expect(exactVerifiedValue([verified, { ...verified, answer: 'No' }], { question, options: ['Yes', 'No'], control: 'radio' })).toBeNull();
    expect(exactVerifiedValue([{ ...verified, context: { ...GENERAL_CONTEXT, scope: 'job', jobTitle: 'Architect', platform: 'greenhouse' } }], {
      question,
      options: ['Yes', 'No'],
      control: 'radio',
      context: { scope: 'job', jobTitle: 'Designer', platform: 'greenhouse' },
    })).toBeNull();
  });

  it('tells the screen when the knowledge store did not update', () => {
    expect(knowledgeSyncMessage(new Error('ApplyMind could not read an encrypted value. The key or the data is damaged.'))).toMatch(/damaged/);
    expect(profileSaveFeedback(null)).toEqual({ tone: 'success', text: 'Profile saved.' });
    expect(profileSaveFeedback('ApplyMind could not store that answer.')).toEqual({ tone: 'critical', text: 'ApplyMind could not store that answer.' });
  });
});

describe('encrypted knowledge store', () => {
  it('backs up first, encrypts answer text, and leaves the profile copy in place', async () => {
    const { store, svc, repo, wrapper, keyFile } = world();
    const saved = store.saveProfile(profile([
      auth,
      answer({ id: 'pay', catalogId: 'salary_expectation', category: 'salary', questionPattern: 'What are your salary expectations?', answer: SECRET, control: 'text', options: [] }),
    ]));
    await expect(svc.syncFromProfile(saved)).rejects.toThrow(/backed up/);
    expect(repo().countActive()).toBe(0);

    const backups: string[] = [];
    const report = await svc.syncFromProfile(saved, {
      backup: async () => {
        const dest = join(store.path + '.backup.sqlite');
        store.db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
        backups.push(dest);
        return dest;
      },
    });
    expect(backups).toHaveLength(1);
    expect(report.created).toBe(2);
    expect(report.trained).toBe(true);
    expect(report.tierAUnlocked).toBe(false);
    expect(report.logLine).not.toContain(SECRET);
    expect(JSON.stringify(report)).not.toContain(SECRET);
    expect(store.getProfile()!.approvedAnswers[1]!.answer).toBe(SECRET);

    const backup = new Store(backups[0]!);
    openStores.push(backup);
    expect(new KnowledgeRepository(backup.db, 'x').countActive()).toBe(0);

    const knowledge = repo();
    for (const blob of knowledge.sealedColumns()) {
      expect(blob).not.toContain(SECRET);
      expect(blobIsSealed(blob)).toBe(true);
    }
    expect(JSON.stringify(knowledge.activeModel())).not.toContain(SECRET);
    const keyFileBytes = readFileSync(keyFile);
    const dek = await loadOrCreateDek(keyFile, wrapper);
    expect(keyFileBytes.includes(Buffer.from(dek))).toBe(false);

    const again = await svc.syncFromProfile(saved, { backup: async () => 'nope' });
    expect(again.created).toBe(0);
    expect(again.unchanged).toBe(2);
    expect(again.trained).toBe(false);
    expect(backups).toHaveLength(1);
    expect(knowledge.historyCount('kr_auth')).toBe(1);
    expect((await svc.proposals()).map((p) => p.factKey)).toEqual(['work_authorization.US', 'compensation.expectation']);
    expect((await svc.status()).confirmedFacts).toBe(0);
    expect(svc.confirmFacts(['fp_work_authorization.US'])).toBe(1);
    expect((await svc.proposals()).map((p) => p.factKey)).toEqual(['compensation.expectation']);
    expect((await svc.status()).confirmedFacts).toBe(1);
  });

  it('rejects a tampered ciphertext', async () => {
    const { store, repo, wrapper, keyFile } = world();
    const key = await loadOrCreateDek(keyFile, wrapper);
    const knowledge = repo();
    const plan = planMigration([answer({ ...auth, answer: SECRET })], store.deviceId, '2026-11-17T00:00:00.000Z');
    knowledge.apply(plan, key, '2026-11-17T00:00:00.000Z');
    const sealed = JSON.parse(knowledge.sealedColumns()[0]!) as { iv: string; tag: string; data: string };
    const flipped = Buffer.from(sealed.data, 'base64');
    flipped[0] = flipped[0]! ^ 0xff;
    expect(() => decryptString(key, { ...sealed, data: flipped.toString('base64') })).toThrow(/damaged/);
  });

  it('records a correction without dropping history, and a deletion does not return in training', async () => {
    const { store, svc } = world();
    const first = profile([answer({ ...auth, answer: 'Yes' })]);
    await svc.syncFromProfile(first, { backup: async () => 'backup' });
    const edited = profile([answer({ ...auth, answer: 'No', approvedAt: '2026-11-10T00:00:00.000Z' })]);
    const edit = await svc.syncFromProfile(edited, { backup: async () => 'backup' });
    expect(edit.edited).toBe(1);
    expect(new KnowledgeRepository(store.db, store.deviceId).historyCount('kr_auth')).toBe(2);
    expect((await svc.proposals())[0]!.value).toBe('No');

    const removed = await svc.syncFromProfile(profile([]), { backup: async () => 'backup' });
    expect(removed.deleted).toBe(1);
    expect(new KnowledgeRepository(store.db, store.deviceId).countActive()).toBe(0);
    expect(await svc.retrain()).not.toBeNull();
  });
});

describe('held answers and imported profiles', () => {
  it('does not turn a filler-written answer back into verified from the profile', async () => {
    const { svc, repo } = world();
    const held = answer({ id: 'linked', category: 'general', questionPattern: 'Linkedin', answer: 'https://www.linkedin.com/in/grant-ai', control: 'checkbox', options: [] });
    await svc.syncFromProfile(profile([held]), { backup: async () => 'backup' });
    expect(repo().countVerified()).toBe(1);
    const changed = await svc.holdFillerRecords(async () => 'backup');
    expect(changed).toBe(1);
    expect(repo().countVerified()).toBe(0);
    await svc.syncFromProfile(profile([held]), { corrections: true, backup: async () => 'backup' });
    await svc.syncFromProfile(profile([held]), { corrections: false, alreadyBackedUp: true });
    expect(repo().countVerified()).toBe(0);
    const reviews = await svc.reviews();
    expect(reviews.map((r) => r.question)).toContain('Linkedin');
    await svc.resolve(reviews[0]!.id, 'confirm');
    expect(repo().countVerified()).toBe(1);
    expect(await svc.exact({ question: 'Linkedin', options: [], control: 'text' })).toBe('https://www.linkedin.com/in/grant-ai');
  });

  it('treats an imported text change as a conflict and does not delete a verified answer missing from the profile', async () => {
    const { svc, repo } = world();
    await svc.syncFromProfile(profile([auth]), { backup: async () => 'backup' });
    const changed = profile([answer({ ...auth, answer: 'No' })]);
    const report = await svc.syncFromProfile(changed, { corrections: false, alreadyBackedUp: true });
    expect(report.edited).toBe(0);
    expect(await svc.exact({ question: auth.questionPattern, options: ['Yes', 'No'], control: 'radio' })).toBeNull();
    expect((await svc.reviews()).some((r) => r.kind === 'conflict' && r.answer === 'Yes' && r.otherAnswer === 'No')).toBe(true);

    const gone = await svc.syncFromProfile(profile([]), { corrections: false, alreadyBackedUp: true });
    expect(gone.deleted).toBe(0);
    expect(repo().countVerified()).toBe(1);
    expect((await svc.reviews()).length).toBeGreaterThan(0);
  });
});
