/**
 * The Quick Apply runner against the mock Dice wizard, through the real content controller:
 * attach → fill → stop for the user's answers → Next → stop at Submit. Never submits.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createContentController } from '@/content/controller';
import { installFileChooserInterceptor } from '@/content/fileChooserInterceptor';
import { INITIAL_RUN, runSteps, type ApplyRunState, type RunnerIO } from '@/services/workflow/applyRunner';
import { DEFAULT_SETTINGS, type CareerProfile, type JobSession, type Settings } from '@/types';
import { EMPTY_PROFILE } from '@/storage/repositories';
import { analyzeJobLocally } from '@/services/analysis/localAnalyzer';
import { classifySkills } from '@/services/matching/evidence';
import { tailorLocally } from '@/services/tailoring/localTailor';
import type { PanelToContent } from '@/types/messages';
import { emptySession, exampleResume, mockJob, APPLY_URL } from '../helpers';
import { mountDiceWizard, testUploadDeps } from '../wizardHelpers';
import { uploadDocument } from '@/services/forms/upload';
import { findWizardRoot } from '@/services/platforms/dice/wizard';

beforeAll(() => installFileChooserInterceptor(HTMLInputElement.prototype));

function tailoredSession(): JobSession {
  const master = exampleResume();
  const job = mockJob();
  const analysis = analyzeJobLocally(job, master);
  const evidence = classifySkills(analysis.requiredSkills, analysis.preferredSkills, master);
  const resume = tailorLocally({ master, job, analysis, evidence, length: 'two_pages', version: 1 });
  return { ...emptySession(job, master.id), analysis, evidence, resume, includeCoverLetter: false };
}

function harness(profile: CareerProfile, settings: Partial<Settings> = {}, wizard: Record<string, unknown> = {}) {
  const doc = document.implementation.createHTMLDocument('dice');
  const wiz = mountDiceWizard(doc, wizard);
  const ctl = createContentController({ doc, url: () => APPLY_URL, version: 'test', stepTimeoutMs: 300, uploadDeps: testUploadDeps, sleep: () => Promise.resolve() });
  let session: JobSession | null = tailoredSession();
  let state: ApplyRunState = INITIAL_RUN;
  const sent: PanelToContent['type'][] = [];
  const io: RunnerIO = {
    send: async (msg) => {
      sent.push(msg.type);
      return (await ctl.handle(msg as never)) as never;
    },
    session: () => session,
    saveSession: async (s) => {
      session = s;
    },
    settings: { ...DEFAULT_SETTINGS, ...settings },
    profile,
    payload: async (kind) => ({ name: kind === 'resume' ? 'Jordan-Rivera-Resume.pdf' : 'Jordan-Rivera-Cover-Letter.pdf', mime: 'application/pdf', base64: btoa('%PDF') }),
    fileName: (kind) => (kind === 'resume' ? 'Jordan-Rivera-Resume.pdf' : 'Jordan-Rivera-Cover-Letter.pdf'),
    sleep: () => Promise.resolve(),
    aborted: () => false,
    state: () => state,
    report: (s) => {
      state = s;
    },
    pollMs: 1,
  };
  return { doc, wiz, ctl, io, sent, state: () => state, session: () => session! };
}

describe('Quick Apply runner', () => {
  it('attaches the resume, stops only for questions the user must answer, then reaches Submit without pressing it', async () => {
    const h = harness({ ...EMPTY_PROFILE, fullName: 'Jordan Rivera' });
    expect(await runSteps(h.io)).toBe('stopped');
    expect(h.wiz.state.resume).toBe('Jordan-Rivera-Resume.pdf');
    expect(h.state().attachments.resume).toMatchObject({ state: 'done', fileName: 'Jordan-Rivera-Resume.pdf' });
    expect(h.state().attachments.coverLetter.state).toBe('skipped'); // cover letter turned off for this job
    expect(h.state().status).toBe('questions');
    expect(h.state().questions.map((q) => q.label)).toEqual([
      'Are you legally authorized to work in the United States?',
      'Will you now or in the future require visa sponsorship?',
      'How many years of experience do you have with Java?',
    ]);
    expect(h.state().questions[0]!.options).toEqual(['Yes', 'No']);
    expect(h.state().optional.map((q) => q.label)).toEqual(['How did you hear about this job?']);
    expect(h.wiz.state.answers).toMatchObject({ q_auth: '', q_spon: '', q_years: '' }); // nothing guessed

    // The user answers (in the panel); the runner continues to the review step and stops.
    for (const [i, v] of [[0, 'Yes'], [1, 'No'], [2, '8']] as const) await h.ctl.handle({ type: 'AF_ANSWER_FIELD', fieldId: h.state().questions[i]!.fieldId, value: v });
    expect(await runSteps(h.io)).toBe('ready');
    expect(h.state()).toMatchObject({ status: 'ready', step: { current: 3, total: 3 } });
    expect(h.wiz.state.submitClicks).toBe(0);
    expect(h.sent).not.toContain('AF_SUBMIT');
  });

  it('fills saved answers itself, so a repeat application needs no questions', async () => {
    const h = harness({
      ...EMPTY_PROFILE,
      approvedAnswers: [
        { id: '1', category: 'work_authorization', questionPattern: 'Are you legally authorized to work in the United States?', answer: 'Yes', approvedAt: '' },
        { id: '2', category: 'sponsorship', questionPattern: 'Will you now or in the future require visa sponsorship?', answer: 'No', approvedAt: '' },
        { id: '3', category: 'years_experience', questionPattern: 'How many years of experience do you have with Java?', answer: '8', approvedAt: '' },
      ],
    });
    expect(await runSteps(h.io)).toBe('ready');
    expect(h.wiz.state.answers).toMatchObject({ q_auth: 'yes', q_spon: 'no', q_years: '8', q_hear: '' });
    const answered = h.session().fieldProposals.filter((p) => p.action === 'answer');
    expect(answered.map((p) => [p.label, p.proposedValue, p.source])).toEqual([
      ['Are you legally authorized to work in the United States?', 'Yes', 'Your saved answer'],
      ['Will you now or in the future require visa sponsorship?', 'No', 'Your saved answer'],
      ['How many years of experience do you have with Java?', '8', 'Your saved answer'],
    ]);
    expect(h.wiz.state.submitClicks).toBe(0);
  });

  it('does not use saved answers when that setting is off, and never answers a different question', async () => {
    const saved = { id: '1', category: 'work_authorization' as const, questionPattern: 'Are you legally authorized to work in the United States?', answer: 'Yes', approvedAt: '' };
    const off = harness({ ...EMPTY_PROFILE, approvedAnswers: [saved] }, { autoFillSavedAnswers: false });
    await runSteps(off.io);
    expect(off.wiz.state.answers.q_auth).toBe('');
    const other = harness({ ...EMPTY_PROFILE, approvedAnswers: [{ ...saved, category: 'general', questionPattern: 'Do you like pizza?' }] });
    await runSteps(other.io);
    expect(other.wiz.state.answers.q_auth).toBe('');
  });

  it('waits on each step when automatic Next is turned off', async () => {
    const h = harness(EMPTY_PROFILE, { autoAdvanceSteps: false });
    expect(await runSteps(h.io)).toBe('stopped');
    expect(h.state()).toMatchObject({ status: 'attention', label: 'Step complete' });
    expect(h.wiz.state.step).toBe(1);
    expect(h.wiz.state.resume).toBe('Jordan-Rivera-Resume.pdf');
  });

  it('on Dice’s two-step application: replaces the resume, then stops at Review — never before', async () => {
    const h = harness(EMPTY_PROFILE, {}, { header: 'slim', steps: 2, profileResume: 'Grant-Howard-FlowCV-Resume-20251222.pdf' });
    expect(await runSteps(h.io)).toBe('ready');
    expect(h.wiz.state.resume).toBe('Jordan-Rivera-Resume.pdf');
    expect(h.state().originalFiles.resume).toBe('Grant-Howard-FlowCV-Resume-20251222.pdf');
    expect(h.state()).toMatchObject({ status: 'ready', step: { current: 2, total: 2 } });
    expect(h.wiz.state.submitClicks).toBe(0);
  });

  it('arriving on the review page with the old resume, goes back, replaces it and returns', async () => {
    const h = harness(EMPTY_PROFILE, {}, { header: 'slim', steps: 2 });
    (h.doc.querySelector('.btn-next') as HTMLElement).click(); // the user clicked Next on Dice first
    expect(h.wiz.state.step).toBe(2);
    expect(await runSteps(h.io)).toBe('ready');
    expect(h.wiz.state.resume).toBe('Jordan-Rivera-Resume.pdf');
    expect(h.wiz.state.step).toBe(2);
    expect(h.wiz.state.submitClicks).toBe(0);
  });

  it('when the resume can’t be replaced, stops on that step (no Next) and says what to do; accepts the exact current tailored file supplied by the user', async () => {
    const h = harness(EMPTY_PROFILE, {}, { header: 'slim', steps: 2 });
    const proto = HTMLInputElement.prototype;
    const patched = proto.click;
    proto.click = function () {
      /* the page helper didn't load: Dice's chooser can't open without a user gesture */
    };
    try {
      expect(await runSteps(h.io)).toBe('stopped');
    } finally {
      proto.click = patched;
    }
    expect(h.state()).toMatchObject({ status: 'attention', need: 'resume', label: 'Attach your tailored resume' });
    expect(h.wiz.state.step).toBe(1); // Next was not pressed with the old resume attached
    expect(h.wiz.state.resume).toBe('Jordan_Rivera_Resume_2025.pdf');
    expect(h.sent).not.toContain('AF_NEXT_STEP');

    // The user picks the tailored copy from Downloads with Dice's own Replace.
    await uploadDocument(h.doc, findWizardRoot(h.doc)!, 'resume', { name: 'Jordan-Rivera-Resume.pdf', mime: 'application/pdf', base64: btoa('%PDF') }, testUploadDeps);
    expect(await runSteps(h.io)).toBe('ready');
    expect(h.state().attachments.resume).toMatchObject({ state: 'done', fileName: 'Jordan-Rivera-Resume.pdf' });
  });

  it('can send the resume already on Dice when the user chooses to', async () => {
    const h = harness(EMPTY_PROFILE, {}, { header: 'slim', steps: 2 });
    h.io.report({ ...h.state(), allowOriginalResume: true });
    expect(await runSteps(h.io)).toBe('ready');
    expect(h.wiz.state.resume).toBe('Jordan_Rivera_Resume_2025.pdf');
  });
});
