/**
 * Best effort on other employer sites (Workday, iCIMS, SmartRecruiters, company sites…).
 * ApplyFlow fills the contact fields it can match, attaches your resume and cover letter, and can
 * move through "Next / Save and continue" steps — but you submit. Sign-in pages stop the run.
 * Some sites are never filled: LinkedIn and Indeed applications are for you to do yourself.
 */
import type { JobSiteAdapter } from '../types';
import { visibleText } from '../dom';
import { findNextControl, findWizardRoot } from '../dice/wizard';
import { ATS_SUCCESS_PATTERNS, atsDocumentLocator, atsPageErrors, atsUploadTargets, embeddedFormUrl, findApplyButton, findAtsSubmit, guessApplicationForm, hostOf, statusBlocker, visibleCaptcha } from './common';
import { notAJobPage } from './shared';

const locator = atsDocumentLocator({ resume: /(^|[\s_-])(resume|cv)([\s_-]|$)/i, cover_letter: /cover/i });

/** Sites whose application flows ApplyFlow leaves to you. */
const HANDS_OFF: { host: RegExp; name: string }[] = [
  { host: /(^|\.)linkedin\.com$/i, name: 'LinkedIn' },
  { host: /(^|\.)indeed\.com$/i, name: 'Indeed' },
  { host: /(^|\.)glassdoor\.com$/i, name: 'Glassdoor' },
  { host: /(^|\.)ziprecruiter\.com$/i, name: 'ZipRecruiter' },
];

/** Friendly names for well-known application systems (shown in the panel). */
const KNOWN: { host: RegExp; name: string }[] = [
  { host: /myworkdayjobs\.com$|myworkdaysite\.com$|workday\.com$/i, name: 'Workday' },
  { host: /icims\.com$/i, name: 'iCIMS' },
  { host: /smartrecruiters\.com$/i, name: 'SmartRecruiters' },
  { host: /workable\.com$/i, name: 'Workable' },
  { host: /bamboohr\.com$/i, name: 'BambooHR' },
  { host: /jobvite\.com$/i, name: 'Jobvite' },
  { host: /taleo\.net$|oraclecloud\.com$/i, name: 'Oracle Taleo' },
  { host: /successfactors\.(com|eu)$/i, name: 'SuccessFactors' },
  { host: /recruitee\.com$/i, name: 'Recruitee' },
  { host: /breezy\.hr$/i, name: 'Breezy HR' },
  { host: /jazzhr\.com$|applytojob\.com$/i, name: 'JazzHR' },
  { host: /rippling\.com$/i, name: 'Rippling' },
  { host: /dover\.com$|dover\.io$/i, name: 'Dover' },
];

export function siteNameFor(url: string): string {
  const host = hostOf(url);
  return [...HANDS_OFF, ...KNOWN].find((k) => k.host.test(host))?.name ?? (host.replace(/^www\./, '') || 'the employer’s site');
}

function root(doc: Document): Element | null {
  // A multi-step flow with a stepper (e.g. Workday) counts too, when it holds fields.
  return guessApplicationForm(doc) ?? findWizardRoot(doc);
}

export const genericAdapter: JobSiteAdapter = {
  id: 'generic',
  displayName: 'Employer site',
  kind: 'ats',
  hosts: /./,
  classifyPage: (doc, url) => {
    if (HANDS_OFF.some((h) => h.host.test(hostOf(url)))) return 'application';
    return root(doc) || embeddedFormUrl(doc) ? 'application' : 'other';
  },
  extractJob: notAJobPage('the employer site'),
  jobKeyForUrl: () => null,
  findApplyControl: (doc) => {
    const el = findApplyButton(doc, /^(apply|apply now|apply for this (job|position|role)|apply to this job|apply manually|start (your )?application|i(['’]m| am) interested)$/i);
    return el ? { element: el, label: visibleText(el, 60) || 'Apply', external: false, href: el.getAttribute('href') } : null;
  },
  findApplicationRoot: root,
  findSubmitControl: findAtsSubmit,
  successPatterns: ATS_SUCCESS_PATTERNS,
  forms: {
    findNextControl,
    uploadTargets: atsUploadTargets(locator),
    documents: locator,
    pageErrors: atsPageErrors,
  },
  blocker: (doc, url) => {
    const hands = HANDS_OFF.find((h) => h.host.test(hostOf(url)));
    if (hands) return { kind: 'unsupported', message: `This job applies through ${hands.name}. ApplyFlow doesn’t fill ${hands.name} applications — your tailored documents are saved, so attach them there yourself.` };
    return statusBlocker(doc, Boolean(root(doc)));
  },
  applicationUrl: (doc) => embeddedFormUrl(doc),
  canSubmit: false,
  parsesResume: true,
  captchaVisible: visibleCaptcha,
};
