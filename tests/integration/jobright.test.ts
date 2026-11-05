import { beforeAll, describe, expect, it } from 'vitest';
import { installFileChooserInterceptor } from '@/content/fileChooserInterceptor';
import { ensureApplicationOpen, INITIAL_RUN, runSteps, type ApplyRunState, type RunnerIO } from '@/services/workflow/applyRunner';
import { DEFAULT_SETTINGS, type CareerProfile, type JobPosting, type JobSession } from '@/types';
import type { PanelToContent } from '@/types/messages';
import { EMPTY_PROFILE, ensureSiteCredential } from '@/storage/repositories';
import { DEFAULT_SITE_PASSWORD } from '@/types';
import { analyzeJobLocally } from '@/services/analysis/localAnalyzer';
import { classifySkills } from '@/services/matching/evidence';
import { tailorLocally } from '@/services/tailoring/localTailor';
import { visibleCaptcha } from '@/services/platforms/ats/common';
import { adapterForUrl } from '@/services/platforms/registry';
import { emptySession, exampleResume } from '../helpers';
import { FakeBrowser } from '../jobrightHarness';

beforeAll(() => installFileChooserInterceptor(HTMLInputElement.prototype));

const PROFILE: CareerProfile = {
  ...EMPTY_PROFILE,
  fullName: 'Grant Howard',
  email: 'grant.howard@example.com',
  phone: '(727) 555-0148',
  location: 'St. Petersburg, FL 33702, US',
  streetAddress: '7109 MEADOWLAWN DR N',
  city: 'St. Petersburg',
  state: 'FL',
  postalCode: '33702',
  country: 'United States',
  linkedinUrl: 'https://www.linkedin.com/in/granthoward',
};
const RESUME = 'Grant-Howard-Resume-v1.pdf';
const LETTER = 'Grant-Howard-Cover-Letter-v1.pdf';

function sessionFor(job: JobPosting, cover = false): JobSession {
  const master = exampleResume();
  const analysis = analyzeJobLocally(job, master);
  const evidence = classifySkills(analysis.requiredSkills, analysis.preferredSkills, master);
  const resume = tailorLocally({ master, job, analysis, evidence, length: 'two_pages', version: 1 });
  const coverLetter = cover ? { version: 1, tone: 'professional' as const, text: 'Dear Hiring Team,\n\nI am excited to apply…', wordCount: 6, issues: [], engine: 'claude' as const, model: 'test', generatedAt: '', editedByUser: false } : null;
  return { ...emptySession(job, master.id), analysis, evidence, resume, coverLetter, includeCoverLetter: cover };
}

async function start(url: string, opts: { cover?: boolean } = {}) {
  const b = new FakeBrowser(url);
  await new Promise((r) => setTimeout(r, 0));
  const ex = await b.send({ type: 'AF_EXTRACT_JOB' });
  expect(ex.ok, ex.failureReason).toBe(true);
  let session: JobSession | null = sessionFor(ex.job!, opts.cover);
  let state: ApplyRunState = INITIAL_RUN;
  const io: RunnerIO = {
    send: ((msg: PanelToContent) => b.send(msg as never)) as RunnerIO['send'],
    session: () => session,
    saveSession: async (s) => {
      session = s;
    },
    settings: { ...DEFAULT_SETTINGS },
    profile: PROFILE,
    ensureSiteCredential: (url, email) => ensureSiteCredential(url, email),
    payload: async (kind) => ({ name: kind === 'resume' ? RESUME : LETTER, mime: 'application/pdf', base64: btoa('%PDF-1.7') }),
    fileName: (kind) => (kind === 'resume' ? RESUME : LETTER),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    aborted: () => false,
    state: () => state,
    report: (s) => {
      state = s;
    },
    pollMs: 150,
  };
  return { b, io, job: ex.job!, state: () => state, session: () => session! };
}

const q = (h: { state: () => ApplyRunState }, re: RegExp) => h.state().questions.find((x) => re.test(x.label));

describe('reading a Jobright job', () => {
  it('reads the job from the page data, the title tag and the visible sections', async () => {
    const b = new FakeBrowser('https://jobright.ai/jobs/info/lever-1?link=1');
    expect(b.ctl.pageState()).toMatchObject({ pageType: 'job-detail', site: 'jobright', siteName: 'Jobright', jobKey: 'jobright:lever-1', hasApplicationForm: false });
    const ex = await b.send({ type: 'AF_EXTRACT_JOB' });
    expect(ex.ok).toBe(true);
    expect(ex.job).toMatchObject({
      platform: 'jobright',
      jobKey: 'jobright:lever-1',
      title: 'PCB Layout Technician',
      company: 'Northwind Avionics',
      location: 'Indianapolis, IN',
      salary: '$72K/yr - $95K/yr',
      employmentType: 'Full-time',
      applicationUrl: 'https://jobs.lever.co/northwind/7c1f2e9a-5b3d-4c8e-9a10-2f6b8e0a5c71',
      externalApply: true,
    });
    expect(ex.job!.responsibilities[0]).toMatch(/^Build, test and troubleshoot/);
    expect(ex.job!.qualifications.join(' ')).toMatch(/Altium Designer/);
    expect(ex.job!.description).not.toMatch(/Funding|Series C/);
    expect(ex.job!.requiredSkills.length).toBeGreaterThan(3);
  });

  it('a Jobright list is a search page; the toolbar/Back logic treats it as your results', () => {
    const b = new FakeBrowser('https://jobright.ai/jobs/recommend');
    expect(b.ctl.pageState()).toMatchObject({ pageType: 'search', site: 'jobright' });
  });
});

describe('Jobright → Lever', () => {
  it('opens the posting, then the form; attaches the resume, lets Lever read it, corrects what it got wrong, picks the location suggestion and puts the cover letter in “Additional information”', async () => {
    const h = await start('https://jobright.ai/jobs/info/lever-1', { cover: true });
    expect(await ensureApplicationOpen(h.io)).toBe('open');
    expect(h.b.url).toBe('https://jobs.lever.co/northwind/7c1f2e9a-5b3d-4c8e-9a10-2f6b8e0a5c71/apply');
    expect(h.b.history).toEqual(['https://jobright.ai/jobs/info/lever-1', 'https://jobs.lever.co/northwind/7c1f2e9a-5b3d-4c8e-9a10-2f6b8e0a5c71', 'https://jobs.lever.co/northwind/7c1f2e9a-5b3d-4c8e-9a10-2f6b8e0a5c71/apply']);

    expect(await runSteps(h.io)).toBe('stopped');
    const form = document.getElementById('application-form') as HTMLFormElement;
    const val = (n: string) => (form.querySelector(`[name="${n}"]`) as HTMLInputElement).value;
    expect(h.b.page.__parsed).toBe(true);
    expect(val('name')).toBe('Grant Howard');
    expect(val('email')).toBe('grant.howard@example.com');
    expect(val('phone')).toBe('(727) 555-0148');
    expect(val('org')).toBe('Raytheon');
    expect(val('location')).toBe('St. Petersburg, FL, USA');
    expect((document.getElementById('selected-location') as HTMLInputElement).value).toMatch(/St\. Petersburg, FL/);
    expect(val('urls[LinkedIn]')).toBe('https://www.linkedin.com/in/granthoward');
    expect(val('comments')).toMatch(/^Dear Hiring Team/);
    expect(h.state().attachments.resume).toMatchObject({ state: 'done', fileName: RESUME });
    expect(h.state().status).toBe('questions');
    expect(h.state().questions.map((x) => x.label)).toEqual(['Are you legally authorized to work in the United States?', 'Will you now or in the future require visa sponsorship?']);
    expect(h.state().questions[0]!.options).toEqual(['Yes', 'No']);
    expect((form.querySelector('[name="eeo[gender]"]') as HTMLSelectElement).value).toBe('');

    await h.b.send({ type: 'AF_ANSWER_FIELD', fieldId: q(h, /authorized/)!.fieldId, value: 'Yes' });
    await h.b.send({ type: 'AF_ANSWER_FIELD', fieldId: q(h, /sponsorship/)!.fieldId, value: 'No' });
    expect(await runSteps(h.io)).toBe('ready');
    expect(h.state()).toMatchObject({ status: 'ready', label: 'Ready to submit' });

    expect(await h.b.send({ type: 'AF_SUBMIT', token: 'nope' })).toMatchObject({ ok: false, outcome: 'refused' });
    expect(h.b.page.__submitted).toBeUndefined();
    await h.b.send({ type: 'AF_ARM_SUBMIT', token: 't1' });
    const sent = h.b.send({ type: 'AF_SUBMIT', token: 't1' });
    await new Promise((r) => setTimeout(r, 50));
    expect(h.b.page.__submitted).toMatchObject({ name: 'Grant Howard', email: 'grant.howard@example.com', resume: RESUME });
    await sent;
    await new Promise((r) => setTimeout(r, 700));
    expect(h.b.url).toMatch(/\/thanks$/);
    expect(h.b.ctl.successHere()).toBe(true);
  });

  it('a CAPTCHA challenge after Submit: not recorded as applied, the person completes it', async () => {
    const h = await start('https://jobright.ai/jobs/info/lever-1');
    expect(await ensureApplicationOpen(h.io)).toBe('open');
    h.b.load(`${h.b.url}?captcha=1`);
    for (const [label, v] of [[/authorized/, 'Yes'], [/sponsorship/, 'No']] as const) {
      await runSteps(h.io);
      const field = q(h, label);
      if (field) await h.b.send({ type: 'AF_ANSWER_FIELD', fieldId: field.fieldId, value: v });
    }
    expect(await runSteps(h.io)).toBe('ready');
    expect(visibleCaptcha(document)).toBe(false);
    await h.b.send({ type: 'AF_ARM_SUBMIT', token: 't2' });
    const res = await h.b.send({ type: 'AF_SUBMIT', token: 't2' });
    expect(res).toMatchObject({ ok: true, outcome: 'clicked', successDetected: false, needsUser: true });
    expect((res as { message: string }).message).toMatch(/CAPTCHA/);
  });
});

describe('Jobright → careers page → Greenhouse (classic, in a frame)', () => {
  it('follows the frame to the form, fills it, ignores the invisible reCAPTCHA badge, and leaves self-identification to you', async () => {
    const h = await start('https://jobright.ai/jobs/info/gh-1', { cover: true });
    expect(await ensureApplicationOpen(h.io)).toBe('open');
    expect(h.b.history.map((u) => new URL(u).hostname)).toEqual(['jobright.ai', 'careers.acme-robotics.com', 'boards.greenhouse.io']);
    expect(h.b.ctl.pageState()).toMatchObject({ site: 'greenhouse', captchaDetected: false, hasApplicationForm: true });
    expect(await runSteps(h.io)).toBe('stopped');
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
    expect([v('first_name'), v('last_name'), v('email'), v('phone')]).toEqual(['Grant', 'Howard', 'grant.howard@example.com', '(727) 555-0148']);
    expect(v('job_application_answers_attributes_0_text_value')).toBe('https://www.linkedin.com/in/granthoward');
    expect(document.getElementById('resume_filename')!.textContent).toContain(RESUME);
    expect(document.getElementById('cover_letter_filename')!.textContent).toContain(LETTER);
    expect(h.state().attachments).toMatchObject({ resume: { state: 'done' }, coverLetter: { state: 'done' } });
    expect(h.state().questions.map((x) => x.label)).toEqual([
      'Are you legally authorized to work in the United States?',
      'Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status)?',
      'I acknowledge that I have read the Acme Robotics Applicant Privacy Notice.',
    ]);
    expect(h.state().optional.map((x) => x.label)).toEqual(expect.arrayContaining(['Gender', 'Veteran Status', 'Disability Status', 'How did you hear about this job?']));
    expect((document.getElementById('job_application_gender') as HTMLSelectElement).value).toBe('');
    expect((document.getElementById('privacy_ack') as HTMLInputElement).checked).toBe(false);

    await h.b.send({ type: 'AF_ANSWER_FIELD', fieldId: q(h, /authorized/)!.fieldId, value: 'Yes' });
    await h.b.send({ type: 'AF_ANSWER_FIELD', fieldId: q(h, /sponsorship/)!.fieldId, value: 'No' });
    await h.b.send({ type: 'AF_ANSWER_FIELD', fieldId: q(h, /acknowledge/)!.fieldId, value: 'Yes' });
    expect(await runSteps(h.io)).toBe('ready');
    await h.b.send({ type: 'AF_ARM_SUBMIT', token: 't3' });
    const res = await h.b.send({ type: 'AF_SUBMIT', token: 't3' });
    expect(res).toMatchObject({ ok: true, successDetected: true });
    expect(h.b.page.__submitted).toMatchObject({ first: 'Grant', email: 'grant.howard@example.com', resume: RESUME });
  });

  it('a closed Greenhouse job stops with the reason, before anything is filled', async () => {
    const h = await start('https://jobright.ai/jobs/info/closed-1');
    expect(await ensureApplicationOpen(h.io)).toBe('stopped');
    expect(h.state()).toMatchObject({ status: 'attention', label: 'Job closed' });
    expect(h.state().message).toMatch(/no longer open/);
  });
});

describe('Jobright → Greenhouse (redesigned: dropdowns are comboboxes)', () => {
  it('chooses the country and searches the location in the dropdowns, and offers the dropdowns’ own choices as answers', async () => {
    const h = await start('https://jobright.ai/jobs/info/ghnew-1');
    expect(await ensureApplicationOpen(h.io)).toBe('open');
    expect(h.b.url).toBe('https://job-boards.greenhouse.io/acmerobotics/jobs/4019999');
    expect(await runSteps(h.io)).toBe('stopped');
    const chosen = (id: string) => document.querySelector(`[data-combo="${id}"] input[type=hidden]`)!.getAttribute('value') ?? (document.querySelector(`[data-combo="${id}"] input[type=hidden]`) as HTMLInputElement).value;
    expect((document.querySelector('[data-combo="country"] input[type=hidden]') as HTMLInputElement).value).toBe('United States');
    expect((document.querySelector('[data-combo="candidate-location"] input[type=hidden]') as HTMLInputElement).value).toBe('St. Petersburg, Florida, United States');
    expect(chosen('gender')).toBe('');
    expect(document.getElementById('resume-filename')!.textContent).toContain(RESUME);
    const auth = q(h, /authorized/)!;
    expect(auth.options).toEqual(['Yes', 'No']);
    expect(h.state().questions.map((x) => x.label)).toEqual([
      'Are you legally authorized to work in the United States?',
      'Will you now or in the future require sponsorship for employment visa status?',
      'Do you have hands-on experience with Altium Designer?',
    ]);
    for (const [re, v] of [[/authorized/, 'Yes'], [/sponsorship/, 'No'], [/Altium/, 'Yes']] as const) await h.b.send({ type: 'AF_ANSWER_FIELD', fieldId: q(h, re)!.fieldId, value: v });
    expect((document.querySelector('[data-combo="question_30004"] input[type=hidden]') as HTMLInputElement).value).toBe('Yes');
    expect(await runSteps(h.io)).toBe('ready');
    await h.b.send({ type: 'AF_ARM_SUBMIT', token: 't4' });
    expect(await h.b.send({ type: 'AF_SUBMIT', token: 't4' })).toMatchObject({ ok: true, successDetected: true });
    expect(h.b.page.__submitted).toMatchObject({ country: 'United States', 'candidate-location': 'St. Petersburg, Florida, United States', question_30002: 'Yes', question_30003: 'No', first_name: 'Grant' });
  });
});

describe('Jobright → Ashby', () => {
  it('goes from the overview to the Application tab, uses the resume field (not “Autofill from resume”), answers nothing it shouldn’t, and offers Yes/No buttons as answers', async () => {
    const h = await start('https://jobright.ai/jobs/info/ashby-1');
    expect(await ensureApplicationOpen(h.io)).toBe('open');
    expect(h.b.url).toBe('https://jobs.ashbyhq.com/helio/3b9e1d2c-8a7f-4e6d-b5c4-1a2b3c4d5e6f/application');
    expect(await runSteps(h.io)).toBe('stopped');
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
    expect([v('_systemfield_name'), v('_systemfield_email'), v('9f2c-phone'), v('1b7d-linkedin')]).toEqual(['Grant Howard', 'grant.howard@example.com', '(727) 555-0148', 'https://www.linkedin.com/in/granthoward']);
    expect(v('loc-value')).toBe('St. Petersburg, FL, United States');
    expect(document.querySelector('._fileName')!.textContent).toBe(RESUME);
    expect(h.b.page.__autofillUsed).toBeUndefined();
    expect(h.state().questions.map((x) => [x.label, x.options])).toEqual([
      ['Are you legally authorized to work in the United States?', ['Yes', 'No']],
      ['Will you now or in the future require visa sponsorship?', ['Yes', 'No']],
    ]);
    expect(h.state().optional.map((x) => x.label)).toEqual(expect.arrayContaining(['Do you hold a current IPC-A-610 certification?', 'Why are you interested in Helio Systems?']));
    await h.b.send({ type: 'AF_ANSWER_FIELD', fieldId: q(h, /authorized/)!.fieldId, value: 'Yes' });
    await h.b.send({ type: 'AF_ANSWER_FIELD', fieldId: q(h, /sponsorship/)!.fieldId, value: 'No' });
    expect(await runSteps(h.io)).toBe('ready');
    await h.b.send({ type: 'AF_ARM_SUBMIT', token: 't5' });
    expect(await h.b.send({ type: 'AF_SUBMIT', token: 't5' })).toMatchObject({ ok: true, successDetected: true });
    expect(h.b.page.__submitted).toMatchObject({ name: 'Grant Howard', auth: 'Yes', spons: 'No', resume: RESUME, autofillUsed: false });
  });
});

describe('stops that need you', () => {
  it('signed out of Jobright: asks you to sign in', async () => {
    const h = await start('https://jobright.ai/jobs/info/lever-1?signedout=1');
    expect(await ensureApplicationOpen(h.io)).toBe('stopped');
    expect(h.state()).toMatchObject({ status: 'attention', label: 'Sign in to Jobright' });
  });

  it('a Jobright referral role: documents only, no employer form', async () => {
    const h = await start('https://jobright.ai/jobs/info/tnt-1');
    expect(await ensureApplicationOpen(h.io)).toBe('external');
    expect(h.state()).toMatchObject({ status: 'external', label: 'Jobright referral role' });
  });

  it('LinkedIn: left to you, with your documents ready', async () => {
    const h = await start('https://jobright.ai/jobs/info/linkedin-1');
    expect(await ensureApplicationOpen(h.io)).toBe('external');
    expect(h.state().message).toMatch(/LinkedIn/);
    expect((document.querySelector('[name=firstName]') as HTMLInputElement).value).toBe('');
  });

  it('Workday: presses Apply → Autofill with Resume, then signs in with stored credentials', async () => {
    const h = await start('https://jobright.ai/jobs/info/workday-1');
    expect(await ensureApplicationOpen(h.io)).toBe('stopped');
    expect(document.querySelector('[data-automation-id="signInContent"]')).not.toBeNull();
    expect((document.getElementById('em') as HTMLInputElement).value).toBe(PROFILE.email);
    expect((document.getElementById('pw') as HTMLInputElement).value).toBe(DEFAULT_SITE_PASSWORD);
    expect(h.state().label).toMatch(/Sign in to Workday/);
  });

  it('employer sites: Greenhouse, Lever, Ashby get full support; others best effort and never Submit', () => {
    expect(adapterForUrl('https://boards.greenhouse.io/x/jobs/1')).toMatchObject({ id: 'greenhouse', canSubmit: true });
    expect(adapterForUrl('https://jobs.lever.co/x/y/apply')).toMatchObject({ id: 'lever', canSubmit: true, parsesResume: true });
    expect(adapterForUrl('https://jobs.ashbyhq.com/x/y/application')).toMatchObject({ id: 'ashby', canSubmit: true });
    expect(adapterForUrl('https://acme.wd5.myworkdayjobs.com/x')).toMatchObject({ id: 'generic', canSubmit: false });
  });
});

describe('safety (independent review findings)', () => {
  it('a run is tied to the form it opened: another job’s form is neither filled nor submitted', async () => {
    const h = await start('https://jobright.ai/jobs/info/lever-1');
    expect(await ensureApplicationOpen(h.io)).toBe('open');
    await runSteps(h.io);
    expect(h.state().formKey).toBe('lever:7c1f2e9a-5b3d-4c8e-9a10-2f6b8e0a5c71');
    h.b.load('https://boards.greenhouse.io/embed/job_app?for=acmerobotics&token=4012345');
    expect(await ensureApplicationOpen(h.io)).toBe('stopped');
    expect(h.state().label).toBe('Different application');
    expect((document.getElementById('first_name') as HTMLInputElement).value).toBe('');
    await h.b.send({ type: 'AF_ARM_SUBMIT', token: 'x' });
    expect(await h.b.send({ type: 'AF_SUBMIT', token: 'x', expectKey: h.state().formKey })).toMatchObject({ ok: false, outcome: 'refused' });
    expect(h.b.page.__submitted).toBeUndefined();
  });

  it('“thank you for applying” in a job description is not a confirmation while the form is still there', async () => {
    const b = new FakeBrowser('https://boards.greenhouse.io/embed/job_app?for=acmerobotics&token=4012345');
    document.getElementById('content')!.insertAdjacentHTML('beforeend', '<p>Thank you for applying! We review every application received.</p>');
    expect(b.ctl.successHere()).toBe(false);
    await b.send({ type: 'AF_ARM_SUBMIT', token: 'y' });
    const res = await b.send({ type: 'AF_SUBMIT', token: 'y' });
    expect(res).toMatchObject({ ok: false, successDetected: false });
    expect((res as { message: string }).message).toMatch(/didn’t accept the form/);
  });

  it('never presses a form’s own “Apply” submit button while opening an application, nor guesses between several jobs', async () => {
    const { findApplyButton } = await import('@/services/platforms/ats/common');
    document.body.innerHTML = '<form><input name="email"><button type="submit">Apply</button></form>';
    expect(findApplyButton(document, /^apply$/i)).toBeNull();
    document.body.innerHTML = '<div><a href="/jobs/1">Apply</a></div><div><a href="/jobs/2">Apply</a></div>';
    expect(findApplyButton(document, /^apply$/i)).toBeNull();
    document.body.innerHTML = '<a href="/jobs/1/apply">Apply</a><a href="/jobs/1/apply">Apply</a>';
    expect(findApplyButton(document, /^apply$/i)?.getAttribute('href')).toBe('/jobs/1/apply');
  });
});

describe('Jobright as it really behaves (2.2.1)', () => {
  it('reads the clean title and brand name from Jobright’s “… Job Details | Company LLC” titles', async () => {
    const b = new FakeBrowser('https://jobright.ai/jobs/info/lever-1?nolink=1');
    expect(document.title).toBe('PCB Layout Technician Job Details | Northwind Avionics LLC @ Northwind Avionics | Jobright.ai');
    const ex = await b.send({ type: 'AF_EXTRACT_JOB' });
    expect(ex.job).toMatchObject({ title: 'PCB Layout Technician', company: 'Northwind Avionics', applicationUrl: null });
  });

  it('answers “Customize Your Resume” with “Apply Without Customizing”, follows the blank new tab to the employer, and never ticks “Do not remind me again”', async () => {
    const h = await start('https://jobright.ai/jobs/info/lever-1?nolink=1', { cover: true });
    expect(await ensureApplicationOpen(h.io)).toBe('open');
    expect(h.b.url).toBe('https://jobs.lever.co/northwind/7c1f2e9a-5b3d-4c8e-9a10-2f6b8e0a5c71/apply');
    expect(h.b.opened).toContain('');
    expect(h.b.history[1]).toBe('https://jobs.lever.co/northwind/7c1f2e9a-5b3d-4c8e-9a10-2f6b8e0a5c71');
  });

  it('never presses “Fix My Resume Now” nor ticks the checkbox', async () => {
    const b = new FakeBrowser('https://jobright.ai/jobs/info/ashby-1?nolink=1');
    expect(b.ctl.pageState().pendingChoice).toBeNull();
    expect(await b.send({ type: 'AF_OPEN_APPLICATION' })).toMatchObject({ ok: true, message: 'Pressed “APPLY WITH AUTOFILL” on Jobright.' });
    expect(b.ctl.pageState().pendingChoice).toBe('Apply Without Customizing');
    const page = b.page;
    expect(await b.send({ type: 'AF_OPEN_APPLICATION' })).toMatchObject({ ok: true, message: 'Pressed “Apply Without Customizing” on Jobright.' });
    expect(page.__fixClicked).toBeUndefined();
    expect(page.__noRemind).toBeUndefined();
    expect((document.getElementById('noremind') as HTMLInputElement | null)?.checked ?? false).toBe(false);
    await new Promise((r) => setTimeout(r, 120));
    expect(b.url).toBe('https://jobs.ashbyhq.com/helio/3b9e1d2c-8a7f-4e6d-b5c4-1a2b3c4d5e6f');
  });

  it('the “Sign Up to Apply” dialog (an Email box of type text, no password) counts as “sign in”', async () => {
    const b = new FakeBrowser('https://jobright.ai/jobs/info/lever-1?signedout=1&nolink=1');
    await b.send({ type: 'AF_OPEN_APPLICATION' });
    expect(document.querySelector('input[type=password]')).toBeNull();
    expect(b.ctl.pageState()).toMatchObject({ loginRequired: true, pendingChoice: null });
  });

  it('Apply that does nothing: stops after two tries with what to do, instead of retrying', async () => {
    const h = await start('https://jobright.ai/jobs/info/lever-1?dead=1&nolink=1');
    expect(await ensureApplicationOpen(h.io)).toBe('stopped');
    expect(h.state()).toMatchObject({ status: 'attention', label: 'Open the application on Jobright' });
    expect(h.state().message).toMatch(/Apply Without Customizing/);
    expect(h.b.history).toEqual(['https://jobright.ai/jobs/info/lever-1?dead=1&nolink=1']);
  });

  it('dismisses Jobright’s premature “Did you apply?” while opening (clicks No), and only presses Yes via AF_CONFIRM_JOBRIGHT_APPLIED', async () => {
    const b = new FakeBrowser('https://jobright.ai/jobs/info/lever-1?askapplied=1&link=1');
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toMatch(/Did you apply/i);
    expect(await b.send({ type: 'AF_CONFIRM_JOBRIGHT_APPLIED' })).toMatchObject({ ok: true, clicked: true });
    expect((b.page as { __jobrightApplied?: boolean }).__jobrightApplied).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    const b2 = new FakeBrowser('https://jobright.ai/jobs/info/lever-1?askapplied=1&link=1');
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toMatch(/Did you apply/i);
    expect(await b2.send({ type: 'AF_OPEN_APPLICATION' })).toMatchObject({ ok: true, message: /Opening the employer/ });
    expect((b2.page as { __jobrightApplied?: boolean }).__jobrightApplied).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
