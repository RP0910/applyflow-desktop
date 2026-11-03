/**
 * Jobvite (jobs.jobvite.com) — multi-step apply forms with a custom "SELECT" control for resumes.
 * The file input is often hidden until SELECT is pressed, so ApplyFlow must treat the resume
 * section as a dropzone/card even when no <input type=file> is visible yet.
 */
import type { JobSiteAdapter } from '../types';
import { controlLabel, deepQueryAll, visibleText } from '../dom';
import { ATS_SUCCESS_PATTERNS, atsDocumentLocator, atsForms, atsPageErrors, attachedName, findApplyButton, findAtsSubmit, findForm, fieldContainer, hostOf, statusBlocker, visibleCaptcha } from './common';
import { notAJobPage } from './shared';
import type { UploadTarget } from '@/types/messages';
import type { DocumentLocator } from '../types';

const FORM = [
  'form#jv-form',
  'form.jv-form',
  'form[action*="jobvite"]',
  '#jv-application-form',
  'form[id*="apply" i]',
  'form',
];

const RESUME_LABEL = /\b(add\s+)?(resume|cv|curriculum\s+vitae)\b/i;
const COVER_LABEL = /\b(add\s+)?cover[\s_-]?letter\b/i;
const SELECTISH = /^(select|select file|choose file|browse|attach|upload|add file)$/i;

function sectionFor(root: Element, kind: 'resume' | 'cover_letter'): Element | null {
  const re = kind === 'resume' ? RESUME_LABEL : COVER_LABEL;
  const nodes = deepQueryAll<HTMLElement>(root, 'label, legend, h1, h2, h3, h4, span, div, p, td, th', 800);
  for (const el of nodes) {
    const t = visibleText(el, 120);
    if (!t || t.length > 80 || !re.test(t)) continue;
    if (kind === 'resume' && COVER_LABEL.test(t) && !RESUME_LABEL.test(t)) continue;
    if (kind === 'cover_letter' && RESUME_LABEL.test(t) && !COVER_LABEL.test(t)) continue;
    let cur: Element = el;
    for (let i = 0; i < 6 && cur.parentElement && cur.parentElement !== root; i++) {
      cur = cur.parentElement;
      const hasControl =
        cur.querySelector('input[type="file"]') ||
        deepQueryAll<HTMLElement>(cur, 'button, [role="button"], a, label, select', 20).some((b) => SELECTISH.test(controlLabel(b).trim()) || /upload|browse|choose|attach|select/i.test(controlLabel(b)));
      if (hasControl) return cur;
    }
    return fieldContainer(el, root);
  }
  return null;
}

function jobviteLocator(): DocumentLocator {
  const base = atsDocumentLocator({
    resume: /(^|[\s_-])(resume|cv|curriculum)([\s_-]|$)/i,
    cover_letter: /cover/i,
  });
  return {
    findInput: (root, kind) => base.findInput(root, kind),
    findCard: (root, kind) => base.findCard(root, kind) ?? sectionFor(root, kind),
  };
}

const locator = jobviteLocator();

function jobviteUploadTargets(root: Element): { resume: UploadTarget; coverLetter: UploadTarget } {
  const describe = (kind: 'resume' | 'cover_letter'): UploadTarget => {
    const input = locator.findInput(root, kind);
    const card = locator.findCard(root, kind);
    const fromInput = input?.files?.[0]?.name ?? null;
    const shown = fromInput ?? attachedName(card);
    if (input) return { method: 'input', currentFileName: shown };
    // Jobvite's SELECT control: treat as dropzone so the runner will attempt upload.
    if (card) return { method: 'dropzone', currentFileName: shown };
    return { method: null, currentFileName: null };
  };
  return { resume: describe('resume'), coverLetter: describe('cover_letter') };
}

export const jobviteAdapter: JobSiteAdapter = {
  id: 'jobvite',
  displayName: 'Jobvite',
  kind: 'ats',
  hosts: /(^|\.)jobvite\.com$/i,
  classifyPage: (doc, url) => (findForm(doc, FORM) || /\/apply\b/i.test(url) ? 'application' : 'other'),
  extractJob: notAJobPage('Jobvite'),
  jobKeyForUrl: (url) => {
    try {
      const u = new URL(url);
      const id = u.pathname.match(/\/job\/([^/?#]+)/i)?.[1] ?? u.searchParams.get('j') ?? u.searchParams.get('job');
      return id ? `jobvite:${id}` : null;
    } catch {
      return null;
    }
  },
  findApplyControl: (doc) => {
    const el = findApplyButton(doc, /^(apply|apply now|apply for this (job|position|role)|start (your )?application)$/i);
    return el ? { element: el, label: visibleText(el, 60) || 'Apply', external: false, href: el.getAttribute('href') } : null;
  },
  findApplicationRoot: (doc) => findForm(doc, FORM),
  findSubmitControl: findAtsSubmit,
  successPatterns: ATS_SUCCESS_PATTERNS,
  forms: {
    ...atsForms(locator),
    uploadTargets: jobviteUploadTargets,
    documents: locator,
    pageErrors: atsPageErrors,
  },
  blocker: (doc) => statusBlocker(doc, Boolean(findForm(doc, FORM))),
  canSubmit: false,
  parsesResume: true,
  captchaVisible: visibleCaptcha,
};

/** True when this host is Jobvite (used by generic naming). */
export function isJobviteHost(url: string): boolean {
  return /(^|\.)jobvite\.com$/i.test(hostOf(url));
}
