/**
 * Dice's real application wizard: finding the application (not the site's search bar),
 * attaching documents through hidden inputs and the "…" → Replace menu, step navigation,
 * and answering questions with values the user chose.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createContentController } from '@/content/controller';
import { installFileChooserInterceptor } from '@/content/fileChooserInterceptor';
import { describeWizard, findNextControl, findSubmitButton, findWizardRoot, navKind, normalizeLabel, shownFileName, wizardStep } from '@/services/platforms/dice/wizard';
import { isPageChrome } from '@/services/platforms/dom';
import { answerField, scanFields } from '@/services/forms/domFields';
import { uploadDocument } from '@/services/forms/upload';
import { detectSignals } from '@/services/extraction/sections';
import { fixture, JOB_URL, APPLY_URL } from '../helpers';
import { mountDiceWizard, testUploadDeps } from '../wizardHelpers';

const pdf = (name: string) => ({ name, mime: 'application/pdf', base64: btoa('%PDF-1.7 test') });

function wizardTab() {
  const doc = document.implementation.createHTMLDocument('dice');
  const wiz = mountDiceWizard(doc, { title: 'Senior Software Engineer' });
  const ctl = createContentController({ doc, url: () => APPLY_URL, version: 'test', stepTimeoutMs: 300, successTimeoutMs: 30, uploadDeps: testUploadDeps, sleep: () => Promise.resolve() });
  return { doc, wiz, ctl };
}

beforeAll(() => {
  // What the page-world script does on dice.com (manifest "world": "MAIN").
  installFileChooserInterceptor(HTMLInputElement.prototype);
});

describe('finding the application on Dice', () => {
  it('anchors on the wizard, never the site header search or footer', () => {
    const { doc } = wizardTab();
    const root = findWizardRoot(doc)!;
    expect(root).not.toBeNull();
    expect(root.textContent).toMatch(/Step 1 of 3/);
    expect(root.contains(doc.querySelector('.site-header'))).toBe(false);
    expect(isPageChrome(doc.querySelector('input[name=q]')!)).toBe(true);
    expect(isPageChrome(doc.querySelector('.site-footer a')!)).toBe(true);
    // The wizard's own footer with Back/Next is not site chrome.
    expect(isPageChrome(doc.querySelector('.btn-next')!)).toBe(false);
    expect(wizardStep(doc)).toEqual({ current: 1, total: 3 });
  });

  it('does not treat a job page with a carousel "Next" and an alert sign-up as an application', () => {
    const doc = document.implementation.createHTMLDocument('dice');
    doc.documentElement.innerHTML = fixture('job-detail-jsonld.html').replace(/^<!doctype html>/i, '');
    doc.querySelector('main')!.insertAdjacentHTML(
      'beforeend',
      '<section><h2>Similar jobs</h2><button type="button">Next</button></section><form><label for="al">Email me jobs like this</label><input id="al" type="email"><button>Create alert</button></form>',
    );
    expect(findWizardRoot(doc)).toBeNull();
    const ctl = createContentController({ doc, url: () => JOB_URL, version: 'test' });
    expect(ctl.pageState()).toMatchObject({ pageType: 'job-detail', hasApplicationForm: false });
  });

  it('reports the step, its upload slots, and that Submit is not on this step yet', () => {
    const { ctl, doc } = wizardTab();
    const scan = ctl.scan();
    expect(scan).toMatchObject({ ok: true, formFound: true, fields: [], submitControlFound: false, nextControlLabel: 'Next', step: { current: 1, total: 3 } });
    expect(scan.uploads.resume).toEqual({ method: 'replace-menu', currentFileName: 'Jordan_Rivera_Resume_2025.pdf' });
    expect(scan.uploads.coverLetter.method).toBe('input');
    const root = findWizardRoot(doc)!;
    expect(findSubmitButton(root)).toMatchObject({ el: null, reason: expect.stringMatching(/no Submit button yet/) });
    expect(findNextControl(root).el?.textContent).toBe('Next');
    expect(ctl.pageState()).toMatchObject({ pageType: 'application', hasApplicationForm: true, step: { current: 1, total: 3 } });
  });

  it('reads the file name a card shows, not the words around it', () => {
    const doc = document.implementation.createHTMLDocument('x');
    doc.body.innerHTML = '<div><h3>Resume</h3><a href="#">My Resume (final).pdf</a><span>Uploaded</span></div>';
    expect(shownFileName(doc.body.firstElementChild!)).toBe('My Resume (final).pdf');
  });
});

describe('attaching documents on Dice', () => {
  it('replaces the profile resume through the “…” menu without opening a file chooser', async () => {
    const { doc, wiz } = wizardTab();
    const res = await uploadDocument(doc, findWizardRoot(doc)!, 'resume', pdf('Jordan-Rivera-Resume.pdf'), testUploadDeps);
    expect(res).toMatchObject({ ok: true, verified: true, method: 'replace-menu', fileName: 'Jordan-Rivera-Resume.pdf' });
    expect(wiz.state.resume).toBe('Jordan-Rivera-Resume.pdf');
    expect(wiz.state.nativePickerOpened).toBe(0);
    expect(doc.documentElement.hasAttribute('data-applyflow-intercept')).toBe(false); // switched off again
    expect(doc.querySelector('.file-link')!.textContent).toBe('Jordan-Rivera-Resume.pdf');
  });

  it('attaches the cover letter through the drop area’s hidden input', async () => {
    const { wiz, ctl } = wizardTab();
    const res = (await ctl.handle({ type: 'AF_UPLOAD_DOCUMENT', kind: 'cover_letter', file: pdf('Jordan-Rivera-Cover-Letter.pdf') })) as { ok: boolean; verified: boolean; method: string };
    expect(res).toMatchObject({ ok: true, verified: true, method: 'input' });
    expect(wiz.state.coverLetter).toBe('Jordan-Rivera-Cover-Letter.pdf');
    expect(ctl.scan().uploads.coverLetter.currentFileName).toBe('Jordan-Rivera-Cover-Letter.pdf');
  });

  it('fails safely, with instructions, when the page-world helper is missing', async () => {
    const { doc, wiz } = wizardTab();
    // Simulate the helper not running: the menu's input.click() is never intercepted.
    const proto = HTMLInputElement.prototype;
    const patched = proto.click;
    proto.click = function () {
      /* chooser blocked: no user gesture */
    };
    try {
      const res = await uploadDocument(doc, findWizardRoot(doc)!, 'resume', pdf('Jordan-Rivera-Resume.pdf'), testUploadDeps);
      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/couldn’t replace the resume/);
      expect(wiz.state.resume).toBe('Jordan_Rivera_Resume_2025.pdf');
    } finally {
      proto.click = patched;
    }
  });
});

describe('moving through steps and answering questions', () => {
  it('presses Next, then reports Dice’s validation message instead of guessing answers', async () => {
    const { ctl, doc } = wizardTab();
    const moved = await ctl.nextStep();
    expect(moved).toMatchObject({ ok: true, advanced: true, label: 'Next' });
    expect(wizardStep(doc)).toEqual({ current: 2, total: 3 });
    const blocked = await ctl.nextStep();
    expect(blocked).toMatchObject({ advanced: false, pageErrors: ['Please answer all required questions.'] });
    expect(wizardStep(doc)).toEqual({ current: 2, total: 3 });
  });

  it('reads Dice’s questions with their real wording and required flags', async () => {
    const { ctl, doc } = wizardTab();
    await ctl.nextStep();
    const fields = scanFields(findWizardRoot(doc)!);
    const by = (re: RegExp) => fields.find((f) => re.test(f.label))!;
    expect(fields.map((f) => f.label)).toEqual([
      'Are you legally authorized to work in the United States?',
      'Will you now or in the future require visa sponsorship?',
      'How many years of experience do you have with Java?',
      'How did you hear about this job?',
    ]);
    expect(by(/authorized/)).toMatchObject({ control: 'radio', options: ['Yes', 'No'], required: true, sensitive: 'work_authorization' });
    expect(by(/sponsorship/)).toMatchObject({ required: true, sensitive: 'sponsorship' });
    expect(by(/years/)).toMatchObject({ control: 'text', required: true, sensitive: 'years_experience' });
    expect(by(/hear/)).toMatchObject({ control: 'select', required: false, sensitive: null });
    // None of the site's search inputs leak in.
    expect(fields.some((f) => /keyword|location/i.test(f.label))).toBe(false);
  });

  it('applies answers the user chose: radio by label, select by text, free text', async () => {
    const { ctl, doc, wiz } = wizardTab();
    await ctl.nextStep();
    const fields = scanFields(findWizardRoot(doc)!);
    const id = (re: RegExp) => fields.find((f) => re.test(f.label))!.fieldId;
    expect(answerField(doc, id(/authorized/), 'Yes')).toMatchObject({ ok: true, finalValue: 'Yes' });
    expect(answerField(doc, id(/sponsorship/), 'No')).toMatchObject({ ok: true });
    expect(answerField(doc, id(/years/), '8')).toMatchObject({ ok: true, finalValue: '8' });
    expect(answerField(doc, id(/hear/), 'Dice')).toMatchObject({ ok: true, finalValue: 'Dice' });
    expect(answerField(doc, id(/authorized/), 'Maybe')).toMatchObject({ ok: false });
    expect(wiz.state.answers).toMatchObject({ q_auth: 'yes', q_spon: 'no', q_years: '8', q_hear: 'Dice' });
    expect((await ctl.nextStep()).advanced).toBe(true);
    const review = ctl.scan();
    expect(review).toMatchObject({ ok: true, submitControlFound: true, submitControlLabel: 'Submit', nextControlLabel: null, step: { current: 3, total: 3 } });
  });

  it('never clicks Submit through the Next message', async () => {
    const { ctl, wiz, doc } = wizardTab();
    await ctl.nextStep();
    const fields = scanFields(findWizardRoot(doc)!);
    for (const [re, v] of [[/authorized/, 'Yes'], [/sponsorship/, 'No'], [/years/, '5']] as const) answerField(doc, fields.find((f) => re.test(f.label))!.fieldId, v);
    await ctl.nextStep();
    const r = await ctl.nextStep();
    expect(r.ok).toBe(false);
    expect(wiz.state.submitClicks).toBe(0);
  });
});

describe('job description signals', () => {
  it('ignores equal-opportunity statements when looking for requirements', () => {
    const s = detectSignals(
      'Requirements: 5+ years of Java experience.\nWe are an equal opportunity employer; all qualified applicants will receive consideration without regard to race, religion, citizenship, disability or protected veteran status.\nMust be authorized to work in the U.S.',
    );
    expect(s.workAuthorization).toEqual(['Must be authorized to work in the U.S.']);
    expect(JSON.stringify(s)).not.toMatch(/equal opportunity/i);
  });
});

describe('Dice wizard as seen in the latest screenshots', () => {
  it('finds the whole application even when an upload area looks like a wizard container', () => {
    const doc = document.implementation.createHTMLDocument('dice');
    mountDiceWizard(doc, { header: 'slim', steps: 2 });
    const trap = doc.querySelector('[data-testid="wizard-cover-letter-upload"]')!;
    const root = findWizardRoot(doc)!;
    expect(root).not.toBe(trap);
    expect(root.contains(trap)).toBe(true);
    expect(root.contains(doc.querySelector('.btn-next'))).toBe(true);
    expect(root.textContent).toMatch(/Resume \*/);
    expect(root.contains(doc.querySelector('.site-header'))).toBe(false);
    expect(findNextControl(root).el?.textContent).toBe('Next');
  });

  it('reads the Resume card even with a required marker and screen-reader text in its heading', () => {
    const doc = document.implementation.createHTMLDocument('dice');
    mountDiceWizard(doc, { header: 'slim', steps: 2, profileResume: 'Grant-Howard-FlowCV-Resume-20251222.pdf' });
    const ctl = createContentController({ doc, url: () => APPLY_URL, version: 'test' });
    expect(ctl.scan().uploads.resume).toEqual({ method: 'replace-menu', currentFileName: 'Grant-Howard-FlowCV-Resume-20251222.pdf' });
  });

  it('replaces the resume through a menu rendered outside the wizard, never using the cover-letter Upload button', async () => {
    const doc = document.implementation.createHTMLDocument('dice');
    const wiz = mountDiceWizard(doc, { header: 'slim', steps: 2 });
    const res = await uploadDocument(doc, findWizardRoot(doc)!, 'resume', pdf('Jordan-Rivera-Resume.pdf'), testUploadDeps);
    expect(res).toMatchObject({ ok: true, verified: true, method: 'replace-menu' });
    expect(wiz.state.resume).toBe('Jordan-Rivera-Resume.pdf');
    expect(wiz.state.coverLetter).toBeNull();
    expect(doc.querySelector('.portal-menu')).toBeNull();
  });

  it('on the review page, uses the Resume card’s edit button to go back and reports that Dice moved', async () => {
    const doc = document.implementation.createHTMLDocument('dice');
    const wiz = mountDiceWizard(doc, { header: 'slim', steps: 2 });
    (doc.querySelector('.btn-next') as HTMLElement).click();
    expect(wizardStep(doc)).toEqual({ current: 2, total: 2 });
    const ctl = createContentController({ doc, url: () => APPLY_URL, version: 'test', uploadDeps: testUploadDeps, sleep: () => Promise.resolve() });
    expect(ctl.scan()).toMatchObject({ submitControlFound: true, uploads: { resume: { currentFileName: 'Jordan_Rivera_Resume_2025.pdf' } } });
    const res = await uploadDocument(doc, findWizardRoot(doc)!, 'resume', pdf('Jordan-Rivera-Resume.pdf'), testUploadDeps);
    expect(res).toMatchObject({ ok: false, navigated: true });
    expect(wiz.state.step).toBe(1);
    expect(wiz.state.submitClicks).toBe(0);
  });

  it('recognizes Next and Submit by their words, icons stripped, or by attributes on icon-only buttons', () => {
    const doc = document.implementation.createHTMLDocument('x');
    doc.body.innerHTML =
      '<button id="a">Nextarrow_forward</button><button id="b" aria-label="Go to next step"></button><button id="c" data-testid="next-button"><svg></svg></button>' +
      '<button id="d"><span>Submit Application</span></button><button id="e">Next job</button><button id="f">Edit resume</button>';
    const k = (id: string) => navKind(doc.getElementById(id)!);
    expect([k('a'), k('b'), k('c'), k('d'), k('e'), k('f')]).toEqual(['next', 'next', 'next', 'submit', null, null]);
    expect(normalizeLabel('  NEXT →  ')).toBe('next');
  });

  it('describes the page for troubleshooting without file names, emails or phone numbers', () => {
    const doc = document.implementation.createHTMLDocument('dice');
    mountDiceWizard(doc, { header: 'slim', steps: 2, profileResume: 'Grant-Howard-Resume.pdf' });
    doc.querySelector('.wizard-head')!.insertAdjacentHTML('beforeend', '<a href="mailto:x">grant@example.com</a><button>Call +1 202 964 3643</button>');
    const out = describeWizard(doc);
    expect(out).toMatch(/root: div/);
    expect(out).toMatch(/\{next\}/);
    expect(out).toMatch(/\[file\.pdf\]/);
    expect(out).not.toMatch(/Grant-Howard|grant@example\.com|964/);
  });
});
