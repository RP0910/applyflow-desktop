/**
 * Lever — jobs.lever.co/<company>/<posting> (job page) and …/apply (the form).
 *   form#application-form: resume input[name=resume] ("ATTACH RESUME/CV"; Lever then reads it and fills
 *   name, email, phone and current company itself), name, email, phone, location (with suggestions),
 *   org, urls[LinkedIn]…, the employer's question cards, "Additional information" (comments), EEO
 *   selects, hCaptcha on submit, #btn-submit "Submit application". Required marks are "✱".
 * Success: …/thanks — "Application submitted!". Closed: "Sorry, we couldn't find anything here".
 */
import type { JobSiteAdapter } from '../types';
import { visibleText } from '../dom';
import { ATS_SUCCESS_PATTERNS, atsDocumentLocator, atsForms, findApplyButton, findAtsSubmit, findForm, pathOf, statusBlocker, visibleCaptcha } from './common';
import { notAJobPage } from './shared';

const locator = atsDocumentLocator({ resume: /(^|[\s_-])resume([\s_-]|$)|resume-upload|^resume$/i, cover_letter: /cover/i });
const FORM = ['form#application-form', 'form.application-form', 'form[action$="/apply"]', 'form[action*="/apply?"]'];

export const leverAdapter: JobSiteAdapter = {
  id: 'lever',
  displayName: 'Lever',
  kind: 'ats',
  hosts: /(^|\.)lever\.co$/i,
  classifyPage: () => 'application',
  extractJob: notAJobPage('Lever'),
  jobKeyForUrl: (url) => {
    const m = pathOf(url).match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
    return m ? `lever:${m[2]!.toLowerCase()}` : null;
  },
  findApplyControl: (doc) => {
    const el = findApplyButton(doc, /^(apply for this job|apply now|apply)$/i);
    return el ? { element: el, label: visibleText(el, 60) || 'Apply', external: false, href: el.getAttribute('href') } : null;
  },
  findApplicationRoot: (doc) => findForm(doc, FORM),
  findSubmitControl: findAtsSubmit,
  successPatterns: [...ATS_SUCCESS_PATTERNS, /application submitted!?/i],
  forms: atsForms(locator),
  blocker: (doc) => statusBlocker(doc, Boolean(findForm(doc, FORM))),
  // The posting page links to the form at …/apply.
  applicationUrl: (doc, url) => {
    if (findForm(doc, FORM)) return null;
    try {
      const u = new URL(url);
      const m = u.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})\/?$/i);
      if (m) return `${u.origin}/${m[1]}/${m[2]}/apply${u.search}`;
    } catch {
      /* not a URL */
    }
    return null;
  },
  canSubmit: true,
  parsesResume: true,
  captchaVisible: visibleCaptcha,
};
