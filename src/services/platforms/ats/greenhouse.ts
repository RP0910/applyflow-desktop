import type { JobSiteAdapter } from '../types';
import { visibleText } from '../dom';
import { ATS_SUCCESS_PATTERNS, atsDocumentLocator, atsForms, findApplyButton, findAtsSubmit, findForm, statusBlocker, visibleCaptcha } from './common';
import { notAJobPage } from './shared';

const locator = atsDocumentLocator({ resume: /(^|[\s_-])resume(_file|_text)?($|[\s_-])|^resume$/i, cover_letter: /cover[_-]?letter/i });
const FORM = ['form#application-form', 'form#application_form', 'form.application--form', '#application form', 'form[action*="greenhouse"]', 'form[action*="/applications"]'];

export const greenhouseAdapter: JobSiteAdapter = {
  id: 'greenhouse',
  displayName: 'Greenhouse',
  kind: 'ats',
  hosts: /(^|\.)greenhouse\.io$/i,
  classifyPage: () => 'application',
  extractJob: notAJobPage('Greenhouse'),
  jobKeyForUrl: (url) => {
    try {
      const u = new URL(url);
      const id = u.searchParams.get('token') ?? u.searchParams.get('gh_jid') ?? u.pathname.match(/\/jobs\/(\d+)/)?.[1];
      return id ? `greenhouse:${id}` : null;
    } catch {
      return null;
    }
  },
  findApplyControl: (doc) => {
    const el = findApplyButton(doc, /^(apply|apply now|apply for this job|apply to this job)$/i);
    return el ? { element: el, label: visibleText(el, 60) || 'Apply', external: false } : null;
  },
  findApplicationRoot: (doc) => findForm(doc, FORM),
  findSubmitControl: findAtsSubmit,
  successPatterns: ATS_SUCCESS_PATTERNS,
  forms: atsForms(locator),
  blocker: (doc, url) => {
    if (/[?&]error=true\b/.test(url) && !findForm(doc, FORM)) return { kind: 'closed', message: 'Greenhouse says this job is no longer open.' };
    return statusBlocker(doc, Boolean(findForm(doc, FORM)));
  },
  canSubmit: true,
  parsesResume: false,
  captchaVisible: visibleCaptcha,
};
