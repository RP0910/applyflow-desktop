/**
 * Shared logic for employer application forms (Greenhouse, Lever, Ashby and best-effort sites).
 * These are one-page forms: contact details, resume/cover letter, the employer's questions,
 * voluntary self-identification, and one Submit button.
 */
import type { PageBlocker } from '@/types';
import type { UploadTarget } from '@/types/messages';
import { controlLabel, deepQueryAll, isPageChrome, isVisible, visibleText } from '../dom';
import { classifyFileInput, clickables, fileInputs, navKind, pageErrors as wizardPageErrors } from '../dice/wizard';
import type { DocumentLocator, FormSupport } from '../types';

export const FILE_NAME_RE = /[^\s/\\:*?"<>|]{1,160}\.(?:pdf|docx?|rtf|txt|odt)\b/i;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/** The page's visible text (bounded), for status checks such as "no longer accepting applications". */
export function pageText(doc: Document, max = 30000): string {
  return visibleText(doc.body, max);
}

// ---------------------------------------------------------------- CAPTCHA

const CAPTCHA_FRAME = /recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha/i;

/**
 * A CAPTCHA the person must solve is on screen. Employer forms load invisible reCAPTCHA/hCaptcha
 * on every page (and reCAPTCHA's small corner badge); those don't count — only a visible
 * challenge or checkbox widget does.
 */
export function visibleCaptcha(doc: Document): boolean {
  const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
  const frames = deepQueryAll<HTMLIFrameElement>(doc, 'iframe', 200).filter((f) => CAPTCHA_FRAME.test(f.getAttribute('src') ?? '') || /captcha|challenge/i.test(f.getAttribute('title') ?? ''));
  for (const f of frames) {
    if (f.closest('.grecaptcha-badge, [data-size="invisible"]')) continue;
    if (!isVisible(f)) continue;
    // Hidden inline (e.g. an invisible hCaptcha's frame), even where styles can't be computed.
    let hidden = false;
    for (let el: HTMLElement | null = f; el && !hidden; el = el.parentElement) hidden = el.style?.display === 'none' || el.style?.visibility === 'hidden';
    if (hidden) continue;
    if (isJsdom) {
      // No layout in tests: a frame marked as a challenge or a widget counts.
      if (/challenge|bframe|checkbox|anchor/i.test(`${f.getAttribute('src') ?? ''} ${f.getAttribute('title') ?? ''}`)) return true;
      continue;
    }
    const r = f.getBoundingClientRect();
    if (r.width >= 100 && r.height >= 60) return true;
  }
  return false;
}

// ---------------------------------------------------------------- status texts

export const CLOSED_PATTERNS = [
  /no longer (?:open|available|accepting (?:new )?applications|taking applications)/i,
  /(?:job|position|posting|role|requisition)(?: you(?:['’]re| are) looking for)? (?:is|has been|was) (?:closed|filled|removed|expired|no longer)/i,
  /(?:this|the) (?:job|position|posting) (?:has )?(?:closed|expired)/i,
  /applications? (?:are |is )?(?:now )?closed/i,
  /sorry,? we couldn['’]t find anything here/i,
  /(?:job|page|posting) not found/i,
];

export const APPLIED_PATTERNS = [/you(?:['’]ve| have) already (?:applied|submitted (?:an|your) application)/i, /already (?:applied|submitted an application) (?:to|for) this/i];

export const ATS_SUCCESS_PATTERNS = [
  /thank(?:s| you) for (?:applying|your application)\b/i,
  /application (?:has been |was )?(?:successfully )?(?:submitted|received|sent)/i,
  /we(?:['’]ve| have) received your application/i,
  /your application (?:is on its way|has been submitted|was submitted)/i,
];

/** Closed / already-applied messages, but only while no application form is on the page. */
export function statusBlocker(doc: Document, hasForm: boolean): PageBlocker | null {
  const text = pageText(doc, 12000);
  if (APPLIED_PATTERNS.some((p) => p.test(text))) return { kind: 'applied', message: 'The employer’s site says you already applied to this job.' };
  if (!hasForm && CLOSED_PATTERNS.some((p) => p.test(text))) return { kind: 'closed', message: 'The employer’s site says this job is no longer accepting applications.' };
  return null;
}

// ---------------------------------------------------------------- the form

/** The application form: the first visible match of `selectors`, else a form with a file input and an email field. */
export function findForm(doc: Document, selectors: string[]): Element | null {
  for (const sel of selectors) {
    const hit = deepQueryAll(doc, sel, 5).find((el) => isVisible(el) && !isPageChrome(el));
    if (hit) return hit;
  }
  return guessApplicationForm(doc);
}

/** A form that looks like a job application: a file input or an email field, plus a few other fields; never search or sign-in forms. */
export function guessApplicationForm(doc: Document): Element | null {
  const forms = deepQueryAll<HTMLFormElement>(doc, 'form', 30).filter((f) => isVisible(f) && !isPageChrome(f) && !f.querySelector('input[type="password"]') && f.getAttribute('role') !== 'search');
  const score = (f: Element) => {
    const inputs = Array.from(f.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'));
    const file = f.querySelector('input[type="file"]') ? 3 : 0;
    const email = f.querySelector('input[type="email"], input[name*="email" i], input[id*="email" i]') ? 2 : 0;
    return inputs.length >= 3 && (file || email) ? inputs.length + file + email : 0;
  };
  const best = forms.map((f) => ({ f, s: score(f) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0];
  return best?.f ?? null;
}

/** The one Submit button of a one-page form. */
export function findAtsSubmit(root: Element): { match: { element: HTMLElement; label: string } | null; reason: string | null } {
  const labelled = clickables(root, 200).filter((b) => navKind(b) === 'submit' || /^(submit|submit application|submit your application|send application|apply|apply now|submit my application)$/i.test(controlLabel(b).trim()));
  let pool = labelled;
  if (!pool.length) {
    pool = deepQueryAll<HTMLElement>(root, 'button[type="submit"], input[type="submit"]', 10).filter((b) => isVisible(b) && /submit|apply|send/i.test(controlLabel(b)));
  }
  const usable = pool.filter((b) => !(b as HTMLButtonElement).disabled && b.getAttribute('aria-disabled') !== 'true');
  if (usable.length === 1) return { match: { element: usable[0]!, label: controlLabel(usable[0]!) || 'Submit' }, reason: null };
  if (usable.length > 1) return { match: null, reason: 'More than one Submit button is on the page, so ApplyFlow won’t choose one. Click it yourself.' };
  if (pool.length) return { match: null, reason: 'The Submit button is disabled — a required field is probably still empty.' };
  return { match: null, reason: 'No Submit button was found on this page.' };
}

/** Nothing to press between steps: these forms are one page. */
export const noNextControl = (): { el: HTMLElement | null; reason: string | null } => ({ el: null, reason: null });

/** The field container around an input (its label, button and the attached file's name). */
export function fieldContainer(input: Element, root: Element): Element {
  let cur: Element = input;
  for (let i = 0; i < 5 && cur.parentElement && cur.parentElement !== root; i++) {
    cur = cur.parentElement;
    if (cur.matches('fieldset, .field, [class*="field" i], .application-question, [class*="question" i], li')) break;
  }
  return cur;
}

/** The file name a field shows after a file was attached. */
export function attachedName(container: Element | null): string | null {
  if (!container) return null;
  const leaf = deepQueryAll<HTMLElement>(container, 'a, span, p, div, strong, li, button', 200).find((el) => {
    const t = visibleText(el, 200);
    return FILE_NAME_RE.test(t) && t.length < 200 && !Array.from(el.children).some((c) => FILE_NAME_RE.test(visibleText(c, 200)));
  });
  return leaf ? (visibleText(leaf, 200).match(FILE_NAME_RE)?.[0] ?? null) : null;
}

/**
 * File inputs by slot. `ids` match the input's id/name exactly or as a word; inputs inside
 * "autofill from resume" helpers (Ashby, Greenhouse) are never used for the resume itself.
 */
/** Label text that marks a resume / cover-letter section when the file input is still hidden. */
const SECTION_LABEL: Record<'resume' | 'cover_letter', RegExp> = {
  resume: /\b(add\s+)?(resume|cv|curriculum\s+vitae)\b/i,
  cover_letter: /\b(add\s+)?cover[\s_-]?letter\b/i,
};
const UPLOAD_CONTROL = /^(select|select file|choose( a)? file|browse( files)?|attach|upload|add file|replace)$/i;

/** A document section found by its heading/label and an upload-like control (Jobvite SELECT, etc.). */
export function findDocumentSection(root: Element, kind: 'resume' | 'cover_letter'): Element | null {
  const re = SECTION_LABEL[kind];
  const other = SECTION_LABEL[kind === 'resume' ? 'cover_letter' : 'resume'];
  for (const el of deepQueryAll<HTMLElement>(root, 'label, legend, h1, h2, h3, h4, span, div, p, td, th', 1000)) {
    if (!isVisible(el)) continue;
    const t = visibleText(el, 100);
    if (!t || t.length > 90 || !re.test(t)) continue;
    if (other.test(t) && !re.test(t.replace(other, ''))) continue;
    let cur: Element = el;
    for (let i = 0; i < 7 && cur.parentElement && cur.parentElement !== root; i++) {
      cur = cur.parentElement;
      const controls = clickables(cur, 30);
      if (controls.some((b) => UPLOAD_CONTROL.test(controlLabel(b).trim()) || /upload|browse|choose|attach|select|replace/i.test(controlLabel(b)))) {
        return cur;
      }
      if (cur.querySelector('input[type="file"]')) return cur;
    }
    return fieldContainer(el, root);
  }
  return null;
}

export function atsDocumentLocator(ids: { resume: RegExp; cover_letter: RegExp }, avoid: RegExp = /autofill|auto-fill|parse your resume|import from/i): DocumentLocator {
  const candidates = (root: Element) =>
    fileInputs(root).filter((i) => {
      let cur: Element | null = i.parentElement;
      for (let d = 0; cur && d < 4 && cur !== root; d++, cur = cur.parentElement) {
        if (avoid.test(`${cur.className && typeof cur.className === 'string' ? cur.className : ''} ${visibleText(cur, 300)}`) && !ids.resume.test(`${i.id} ${i.name}`)) return false;
      }
      return true;
    });
  const findInput = (root: Element, kind: 'resume' | 'cover_letter'): HTMLInputElement | null => {
    const all = candidates(root);
    const byId = all.find((i) => ids[kind].test(`${i.id} ${i.name} ${i.getAttribute('data-qa') ?? ''} ${i.getAttribute('aria-label') ?? ''}`));
    if (byId) return byId;
    return all.find((i) => classifyFileInput(i) === kind) ?? null;
  };
  return {
    findInput,
    findCard: (root, kind) => {
      const input = findInput(root, kind);
      if (input) return fieldContainer(input, root);
      return findDocumentSection(root, kind);
    },
  };
}

export function atsUploadTargets(locator: DocumentLocator) {
  return (root: Element): { resume: UploadTarget; coverLetter: UploadTarget } => {
    const describe = (kind: 'resume' | 'cover_letter'): UploadTarget => {
      const input = locator.findInput(root, kind);
      const card = locator.findCard(root, kind);
      const fromInput = input?.files?.[0]?.name ?? null;
      const shown = fromInput ?? attachedName(card);
      if (input) return { method: 'input', currentFileName: shown };
      // Custom upload widgets (Jobvite SELECT, Workday attach) expose a card before the file input.
      if (card) return { method: 'dropzone', currentFileName: shown };
      return { method: null, currentFileName: null };
    };
    return { resume: describe('resume'), coverLetter: describe('cover_letter') };
  };
}

/** Validation messages on the form, plus fields the page marked invalid. */
export function atsPageErrors(root: Element): string[] {
  const out = new Set(wizardPageErrors(root));
  deepQueryAll<HTMLElement>(root, '[aria-invalid="true"]', 20).forEach((el) => {
    const id = el.getAttribute('aria-describedby');
    const msg = id ? visibleText(el.ownerDocument.getElementById(id.split(/\s+/)[0]!), 160) : '';
    if (msg && msg.length < 160) out.add(msg);
  });
  return Array.from(out).slice(0, 6);
}

export function atsForms(locator: DocumentLocator): Partial<FormSupport> {
  return {
    findNextControl: noNextControl,
    uploadTargets: atsUploadTargets(locator),
    documents: locator,
    step: () => null,
    pageErrors: atsPageErrors,
  };
}

/** A button or link labelled like "Apply for this job". */
/** A control inside a form with fields, or a submit button: pressing it could send an application. */
export function couldSubmit(el: Element): boolean {
  if (el.matches('button[type="submit"], input[type="submit"], button:not([type])') && el.closest('form')) return true;
  const form = el.closest('form');
  return Boolean(form && form.querySelector('input:not([type="hidden"]):not([type="search"]), textarea, select'));
}

/**
 * The page's one "Apply" control (never a form's submit button). A choice the site just asked in a
 * dialog ("Apply Manually") comes first. Several different Apply controls (a careers list) → none:
 * ApplyFlow won't guess which job.
 */
export function findApplyButton(doc: Document, labels: RegExp): HTMLElement | null {
  const all = deepQueryAll<HTMLElement>(doc, 'a[href], button, [role="button"], input[type="button"]', 600).filter(
    (el) => isVisible(el) && !isPageChrome(el) && !couldSubmit(el) && labels.test(controlLabel(el).replace(/\s+/g, ' ').trim()),
  );
  const inDialog = all.filter((el) => el.closest('[role="dialog"], [aria-modal="true"], dialog[open]'));
  const pool = inDialog.length ? inDialog : all;
  const targets = new Set(pool.map((el) => el.getAttribute('href') || `#${controlLabel(el).toLowerCase()}`));
  return targets.size === 1 ? pool[0]! : null;
}

/** An employer form embedded in a frame on a company careers page (Greenhouse, Lever, Ashby). */
export function embeddedFormUrl(doc: Document): string | null {
  for (const f of deepQueryAll<HTMLIFrameElement>(doc, 'iframe[src]', 50)) {
    const src = f.getAttribute('src') ?? '';
    let u: URL;
    try {
      u = new URL(src, doc.location?.href ?? 'https://example.com/');
    } catch {
      continue;
    }
    if (u.protocol !== 'https:') continue;
    if (/(^|\.)greenhouse\.io$/i.test(u.hostname) && /embed|job_app|\/jobs\//i.test(u.pathname + u.search)) return u.toString();
    if (/(^|\.)lever\.co$/i.test(u.hostname)) return u.toString();
    if (/(^|\.)ashbyhq\.com$/i.test(u.hostname)) return u.toString().replace(/\/embed(\?|$)/, '$1');
  }
  return null;
}
