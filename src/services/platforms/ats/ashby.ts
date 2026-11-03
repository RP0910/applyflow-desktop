/**
 * Ashby — jobs.ashbyhq.com/<org>/<job id> (Overview) and …/application (the form, a React app).
 *   Fields have ids like _systemfield_name, _systemfield_email, _systemfield_resume (file),
 *   _systemfield_location (combobox); the employer's questions use generated ids; Yes/No questions
 *   are two buttons; an "Autofill from resume" box at the top has its own file input (never used
 *   for the resume field itself). Submit: "Submit Application". Invisible reCAPTCHA.
 */
import type { JobSiteAdapter } from '../types';
import { deepQueryAll, isVisible, visibleText } from '../dom';
import { ATS_SUCCESS_PATTERNS, atsDocumentLocator, atsForms, findApplyButton, findAtsSubmit, findForm, pathOf, statusBlocker, visibleCaptcha } from './common';
import { notAJobPage } from './shared';

const locator = atsDocumentLocator({ resume: /_systemfield_resume|(^|[\s_-])resume([\s_-]|$)/i, cover_letter: /_systemfield_cover_letter|cover[_-]?letter/i });

function ashbyForm(doc: Document): Element | null {
  const byForm = findForm(doc, ['form.ashby-application-form', 'form[class*="application-form" i]', '.ashby-application-form-container form']);
  if (byForm) return byForm;
  // Some versions render the fields without a <form>: the container holding _systemfield_ inputs and Submit.
  const name = deepQueryAll<HTMLElement>(doc, '[id^="_systemfield_"], [name^="_systemfield_"]', 5).find(isVisible);
  if (!name) return null;
  let cur: Element | null = name.parentElement;
  for (let d = 0; cur && d < 12; d++, cur = cur.parentElement) {
    if (/submit application/i.test(visibleText(cur, 20000)) && cur.querySelector('button')) return cur;
  }
  return null;
}

export const ashbyAdapter: JobSiteAdapter = {
  id: 'ashby',
  displayName: 'Ashby',
  kind: 'ats',
  hosts: /(^|\.)ashbyhq\.com$/i,
  classifyPage: () => 'application',
  extractJob: notAJobPage('Ashby'),
  jobKeyForUrl: (url) => {
    const m = pathOf(url).match(/^\/[^/]+\/([0-9a-f-]{36})/i);
    return m ? `ashby:${m[1]!.toLowerCase()}` : null;
  },
  findApplyControl: (doc) => {
    const el = findApplyButton(doc, /^(application|apply|apply for this job|apply now)$/i);
    return el ? { element: el, label: visibleText(el, 60) || 'Apply', external: false, href: el.getAttribute('href') } : null;
  },
  findApplicationRoot: ashbyForm,
  findSubmitControl: findAtsSubmit,
  successPatterns: ATS_SUCCESS_PATTERNS,
  forms: atsForms(locator),
  blocker: (doc) => statusBlocker(doc, Boolean(ashbyForm(doc))),
  // The job page's "Application" tab is at …/application.
  applicationUrl: (doc, url) => {
    if (ashbyForm(doc)) return null;
    try {
      const u = new URL(url);
      const m = u.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})\/?$/i);
      if (m) return `${u.origin}/${m[1]}/${m[2]}/application${u.search}`;
    } catch {
      /* not a URL */
    }
    return null;
  },
  canSubmit: true,
  parsesResume: false,
  captchaVisible: visibleCaptcha,
};
