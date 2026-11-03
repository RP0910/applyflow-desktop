/**
 * Dice application wizard ("Easy Apply") structure, as observed on dice.com (Oct 2026):
 *   "You're Applying for <job>"  ·  "@ <Company> in <City>"  ·  progress bar  ·  "Step 1 of 2"
 *   Resume & Cover Letter:
 *     Resume *      — the profile resume as a file card with a "…" menu whose "Replace" opens a file chooser
 *     Cover Letter  — a drop area with a hidden <input type=file>
 *   Review your application (last step): cards for Resume, Cover Letter, answers — each with an
 *   edit button — and the Submit button.
 * Everything is found from visible text and page structure, never from Dice's generated class names.
 */
import type { UploadTarget } from '@/types/messages';
import { controlLabel, deepQueryAll, isPageChrome, isVisible, visibleText } from '../dom';
import { DICE_SELECTORS, STEP_RE, WIZARD_MARKERS } from './selectors';

const CLICKABLE = 'button, [role="button"], input[type="submit"], input[type="button"], a[href], a[role="button"]';
export const RESUME_HEADING = /^(resume|cv|résumé)(\s*\*)?(\s*\(?(required|optional)\)?)?$/i;
export const COVER_HEADING = /^cover letter(\s*\*)?(\s*\(?(required|optional)\)?)?$/i;
const WHOLE_FILE_NAME = /^[^\s].{0,138}\.(?:pdf|docx?|rtf|txt|odt)$/i;

export function clickables(root: ParentNode, limit = 400): HTMLElement[] {
  return deepQueryAll<HTMLElement>(root, CLICKABLE, limit).filter((b) => isVisible(b) && !isPageChrome(b));
}

function enabled(el: HTMLElement): boolean {
  return !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true';
}

// ---------------------------------------------------------------- button labels

// Material-icon ligatures often sit right after the label text ("Nextarrow_forward").
const ICON_LIGATURES = /(arrow_forward(_ios)?|arrow_back(_ios)?|chevron_right|chevron_left|navigate_next|navigate_before|keyboard_arrow_right|keyboard_arrow_left|arrow_right_alt)/gi;
const ICON_WORDS = /\b(east|west)\b/gi;

/** "Next  →", "Nextarrow_forward", "NEXT" → "next". */
export function normalizeLabel(s: string): string {
  return s
    .replace(ICON_LIGATURES, ' ')
    .replace(ICON_WORDS, ' ')
    .replace(/[→›»>←‹«<…]+/g, ' ')
    .replace(/[^\p{L}\p{N}&' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const NEXT_WORDS = /^(next|next step|go to next step|continue|save and continue|save & continue|continue to review|review|review application|review your application|proceed)$/;
const SUBMIT_WORDS = /^(submit|submit application|submit my application|submit your application|send application|send my application|finish|finish and submit|complete application)$/;

/** What a wizard button does, from its visible label (or, for icon-only buttons, its attributes). */
export function navKind(el: HTMLElement): 'next' | 'submit' | null {
  const labels = [controlLabel(el), el.textContent ?? '', el.getAttribute('title') ?? ''].map(normalizeLabel).filter(Boolean);
  if (labels.some((l) => SUBMIT_WORDS.test(l))) return 'submit';
  if (labels.some((l) => NEXT_WORDS.test(l))) return 'next';
  if (labels.some((l) => l.length > 2)) return null;
  const attrs = `${el.getAttribute('data-testid') ?? ''} ${el.id} ${el.getAttribute('name') ?? ''} ${typeof el.className === 'string' ? el.className : ''}`;
  if (/(^|[\s_-])submit($|[\s_-])/i.test(attrs)) return 'submit';
  if (/(^|[\s_-])(btn-?)?next($|[\s_-])/i.test(attrs)) return 'next';
  return null;
}

// ---------------------------------------------------------------- the wizard container

const CHROME_PROBE = 'header, footer, nav, [role="navigation"], [role="search"], [role="banner"], [role="contentinfo"], input[type="search"], input[name="q"]';

function containsSiteChrome(el: Element): boolean {
  return Array.from(el.querySelectorAll(CHROME_PROBE)).some((c) => isPageChrome(c));
}

/** The element that shows "Step 1 of 2" or "You're Applying for" (not inside the site header). */
const MARKER_TEXT = /step\s+\d+\s+of\s+\d+|^\s*you['’]?re applying for\b/i;

function markerElement(doc: Document): Element | null {
  const body = doc.body;
  // Cheap checks first (textContent needs no layout); this runs on every page change.
  if (!body || !/step\s+\d+\s+of\s+\d+|you['’]?re applying for/i.test((body.textContent ?? '').slice(0, 200000))) return null;
  const ok = (el: Element | null): boolean => {
    if (!el) return false;
    const raw = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    return raw.length <= 120 && MARKER_TEXT.test(raw) && !isPageChrome(el) && isVisible(el);
  };
  // Walk text nodes ("Step", "Applying") instead of measuring every element.
  const walker = doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(), seen = 0; n && seen < 20000; n = walker.nextNode(), seen++) {
    if (!/step|applying/i.test(n.nodeValue ?? '')) continue;
    // "Step <b>2</b> of 2" splits the text: climb a little to the element that holds all of it.
    let el: Element | null = n.parentElement;
    for (let up = 0; el && up < 3; up++, el = el.parentElement) if (ok(el)) return el as Element;
  }
  // Inside open shadow roots (web components).
  return deepQueryAll(body, 'h1, h2, h3, h4, h5, h6, p, span, div, small, strong', 1500).find((el) => el.childElementCount <= 4 && ok(el)) ?? null;
}

/** Widest ancestor of `el` that still excludes the site's header, navigation, search and footer. */
function widestWizardContainer(el: Element): Element {
  const body = el.ownerDocument.body;
  let cur = el;
  while (cur.parentElement && cur.parentElement !== body && cur.parentElement !== el.ownerDocument.documentElement) {
    if (containsSiteChrome(cur.parentElement)) break;
    cur = cur.parentElement;
  }
  return cur;
}

/** The application container. Anchored on Dice's own wizard text, then on its Next/Submit button. */
export function findWizardRoot(doc: Document): Element | null {
  const marker = markerElement(doc);
  if (marker) return widestWizardContainer(marker);
  // Explicit containers — only when they hold the wizard's own buttons (not just one upload area).
  for (const sel of DICE_SELECTORS.applicationRoot) {
    try {
      const hit = deepQueryAll(doc, sel, 5).find((el) => isVisible(el) && !isPageChrome(el) && clickables(el, 80).some((b) => navKind(b)));
      if (hit) return hit;
    } catch {
      /* ignore */
    }
  }
  // Anchor on the wizard's Next/Submit button and climb to the container that holds the step.
  // (A carousel "Next" on a job page never qualifies: its ancestors carry no wizard text or upload.)
  const nav = clickables(doc).filter((b) => navKind(b));
  for (const b of nav) {
    let cur: Element | null = b.parentElement;
    for (let depth = 0; cur && cur !== doc.body && depth < 14; depth++, cur = cur.parentElement) {
      if (isPageChrome(cur)) break;
      if (WIZARD_MARKERS.test(visibleText(cur, 3000)) || fileInputs(cur).length) return cur;
      if (cur.tagName === 'FORM' && Array.from(cur.querySelectorAll('input, textarea, select')).some((i) => !isPageChrome(i))) return cur;
    }
  }
  const form = Array.from(doc.querySelectorAll('form')).find(
    (f) => isVisible(f) && !isPageChrome(f) && (f.querySelector('input[type="file"]') || WIZARD_MARKERS.test(visibleText(f, 3000))) && f.querySelector('input:not([type="hidden"]):not([type="search"]), textarea, select'),
  );
  if (form) return form;
  const main = doc.querySelector('main, [role="main"]');
  return main && WIZARD_MARKERS.test(visibleText(main, 3000)) ? main : null;
}

export function wizardStep(doc: Document | Element): { current: number; total: number } | null {
  const body = 'body' in doc ? doc.body : doc;
  const m = visibleText(body, 20000).match(STEP_RE);
  return m ? { current: Number(m[1]), total: Number(m[2]) } : null;
}

function single(controls: HTMLElement[], noun: string): { el: HTMLElement | null; reason: string | null } {
  const usable = controls.filter(enabled);
  if (usable.length === 1) return { el: usable[0]!, reason: null };
  if (usable.length > 1) return { el: null, reason: `More than one ${noun} button is on the page, so ApplyFlow won’t choose one. Click it yourself.` };
  if (controls.length) return { el: null, reason: `Dice’s ${noun} button is disabled — a required field is probably still empty.` };
  return { el: null, reason: null };
}

export function findNextControl(root: Element): { el: HTMLElement | null; reason: string | null } {
  return single(clickables(root).filter((b) => navKind(b) === 'next'), 'Next');
}

export function findSubmitButton(root: Element): { el: HTMLElement | null; reason: string | null } {
  const r = single(clickables(root).filter((b) => navKind(b) === 'submit'), 'Submit');
  return r.el || r.reason ? r : { el: null, reason: 'This step has no Submit button yet. ApplyFlow will continue through Dice’s steps first.' };
}

/** Validation messages Dice is showing on the current step. */
export function pageErrors(root: Element): string[] {
  const out = new Set<string>();
  deepQueryAll(root, '[role="alert"], [aria-live="assertive"], [class*="error" i], [class*="invalid" i]', 40).forEach((el) => {
    const t = visibleText(el, 200);
    if (t && t.length < 200 && /required|please|invalid|must|select|upload|missing|enter/i.test(t) && isVisible(el)) out.add(t);
  });
  return Array.from(out).slice(0, 5);
}

// ---------------------------------------------------------------- resume / cover letter cards

/** Short heading-like text inside root that names a document slot. */
function headings(root: Element): { el: Element; kind: 'resume' | 'cover_letter' }[] {
  const out: { el: Element; kind: 'resume' | 'cover_letter' }[] = [];
  deepQueryAll(root, 'h1, h2, h3, h4, h5, h6, legend, label, p, span, div, strong, b', 2000).forEach((el) => {
    if (el.children.length > 3) return;
    const t = visibleText(el, 80);
    if (!t || t.length > 40) return;
    if (RESUME_HEADING.test(t)) out.push({ el, kind: 'resume' });
    else if (COVER_HEADING.test(t)) out.push({ el, kind: 'cover_letter' });
  });
  // Keep the innermost of nested matches ("<h3>Resume <span>*</span></h3>" inside a matching div).
  return out.filter((h) => !out.some((o) => o !== h && o.kind === h.kind && h.el.contains(o.el)));
}

/** Elements that show only a file name ("Grant-Howard-Resume.pdf"). */
function fileNameLeaves(root: Element): HTMLElement[] {
  return deepQueryAll<HTMLElement>(root, 'a, span, p, div, strong, b, li, button, td, dd', 2000).filter((el) => {
    const t = visibleText(el, 160);
    return WHOLE_FILE_NAME.test(t) && isVisible(el) && Array.from(el.children).every((c) => !WHOLE_FILE_NAME.test(visibleText(c, 160)));
  });
}

function hasCardStuff(el: Element): boolean {
  return Boolean(el.querySelector('input[type="file"]') || fileNameLeaves(el).length || /upload|drag|drop|browse/i.test(visibleText(el, 600)) || el.querySelector('button, [role="button"]'));
}

/**
 * The card for "Resume" or "Cover letter": the nearest ancestor of its heading that holds a
 * file name, a file input, a drop area or a button — but not the other card's heading. When no
 * heading matches, the card is found from the file name it shows and the label next to it.
 */
export function findDocumentCard(root: Element, kind: 'resume' | 'cover_letter'): Element | null {
  const all = headings(root);
  const mine = all.filter((h) => h.kind === kind);
  const other = all.filter((h) => h.kind !== kind).map((h) => h.el);
  // Prefer the container that also holds the card's button or file input (Dice's edit / "…" button
  // sits beside the text block), falling back to the one that only shows the file name.
  const actionable = (el: Element) => Boolean(el.querySelector('input[type="file"], button, [role="button"]') || /upload|drag|drop|browse/i.test(visibleText(el, 600)));
  for (const h of mine) {
    let cur: Element | null = h.el.parentElement;
    let named: Element | null = null;
    for (let depth = 0; cur && depth < 7 && cur !== root.parentElement; depth++, cur = cur.parentElement) {
      if (other.some((o) => cur!.contains(o))) break;
      if (actionable(cur)) return cur;
      if (!named && hasCardStuff(cur)) named = cur;
    }
    if (named) return named;
  }
  // Fallback: a file name whose surrounding label (excluding the name itself) says which slot it is.
  for (const leaf of fileNameLeaves(root)) {
    const name = visibleText(leaf, 160);
    let cur: Element | null = leaf.parentElement;
    for (let depth = 0; cur && depth < 6 && cur !== root.parentElement; depth++, cur = cur.parentElement) {
      if (fileNameLeaves(cur).length > 1) break;
      const label = visibleText(cur, 600).replace(name, ' ').toLowerCase();
      const isCover = /cover letter/.test(label);
      const isResume = /\bresume\b|\bcv\b|résumé/.test(label);
      if (isCover && isResume) break;
      if ((kind === 'cover_letter' && isCover) || (kind === 'resume' && isResume)) {
        const parent = cur.parentElement;
        const widen = parent && !cur.querySelector('button, [role="button"]') && parent.querySelector('button, [role="button"]') && fileNameLeaves(parent).length === 1 ? parent : null;
        return widen ?? cur;
      }
      if (isCover || isResume) break;
    }
  }
  return null;
}

export function fileInputs(root: ParentNode): HTMLInputElement[] {
  return deepQueryAll<HTMLInputElement>(root, 'input[type="file"]', 20).filter((i) => !isPageChrome(i));
}

/** Classify a (usually hidden) file input by its attributes and surrounding text. */
export function classifyFileInput(input: HTMLInputElement): 'resume' | 'cover_letter' | null {
  const attrs = `${input.name} ${input.id} ${input.getAttribute('aria-label') ?? ''} ${input.getAttribute('data-testid') ?? ''}`.toLowerCase();
  if (/cover/.test(attrs)) return 'cover_letter';
  if (/resume|cv\b/.test(attrs)) return 'resume';
  let cur: Element | null = input.parentElement;
  for (let depth = 0; cur && depth < 6; depth++, cur = cur.parentElement) {
    if (cur.querySelectorAll('input[type="file"]').length > 1) break;
    const names = fileNameLeaves(cur).map((l) => visibleText(l, 160));
    let t = visibleText(cur, 400).toLowerCase();
    for (const n of names) t = t.replace(n.toLowerCase(), ' ');
    const cover = /cover letter/.test(t);
    const resume = /\bresume\b|\bcv\b|résumé/.test(t);
    if (cover && resume) return null;
    if (cover) return 'cover_letter';
    if (resume) return 'resume';
  }
  return null;
}

export function findFileInputFor(root: Element, kind: 'resume' | 'cover_letter'): HTMLInputElement | null {
  const card = findDocumentCard(root, kind);
  const inCard = card ? fileInputs(card)[0] : undefined;
  if (inCard) return inCard;
  const all = fileInputs(root);
  const byContext = all.find((i) => classifyFileInput(i) === kind);
  if (byContext) return byContext;
  // One unlabeled input next to a resume card that already shows a file → it's the cover letter's.
  const unlabeled = all.filter((i) => classifyFileInput(i) === null);
  if (unlabeled.length === 1 && kind === 'cover_letter' && findDocumentCard(root, 'resume') && !findDocumentCard(root, 'resume')?.contains(unlabeled[0]!)) return unlabeled[0]!;
  return null;
}

/** The file name a card shows: the text of the element that holds only the name (a link or label). */
export function shownFileName(card: Element): string | null {
  const leaf = fileNameLeaves(card)[0];
  if (leaf) return visibleText(leaf, 160);
  return visibleText(card, 600).match(/[\w\-.()+,&']+\.(?:pdf|docx?|rtf|txt|odt)\b/i)?.[0] ?? null;
}

export function uploadTargets(root: Element): { resume: UploadTarget; coverLetter: UploadTarget } {
  const describe = (kind: 'resume' | 'cover_letter'): UploadTarget => {
    const card = findDocumentCard(root, kind);
    const input = findFileInputFor(root, kind);
    const currentFileName = card ? shownFileName(card) : null;
    if (card && currentFileName && card.querySelector('button, [role="button"]')) {
      return { method: input ? 'input' : 'replace-menu', currentFileName };
    }
    if (input) return { method: 'input', currentFileName };
    if (card && /upload|drag|drop|browse/i.test(visibleText(card, 600))) return { method: 'dropzone', currentFileName };
    return { method: null, currentFileName };
  };
  return { resume: describe('resume'), coverLetter: describe('cover_letter') };
}

// ---------------------------------------------------------------- diagnostics

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+?\d[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;

/**
 * A privacy-safe outline of the application's structure for troubleshooting a Dice change:
 * tags, roles, test IDs, ARIA labels and the short labels of buttons and headings. Field
 * values, file names, emails and phone numbers are never included.
 */
export function describeWizard(doc: Document): string {
  const root = findWizardRoot(doc);
  const lines: string[] = [`url-path: ${doc.location?.pathname ?? '?'}`, `root: ${root ? root.tagName.toLowerCase() : 'none'}`, `step: ${JSON.stringify(wizardStep(doc))}`];
  const clean = (s: string) => s.replace(EMAIL, '[email]').replace(PHONE, '[phone]').replace(/[^\s]{1,140}\.(pdf|docx?|rtf|txt|odt)\b/gi, '[file.$1]').replace(/\s+/g, ' ').trim().slice(0, 60);
  const walk = (el: Element, depth: number) => {
    if (lines.length > 400 || depth > 18) return;
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'svg', 'path', 'noscript'].includes(tag)) return;
    const attrs = ['id', 'role', 'data-testid', 'data-cy', 'aria-label', 'aria-haspopup', 'type', 'name', 'hidden', 'disabled']
      .map((a) => (el.hasAttribute(a) ? `${a}=${clean(el.getAttribute(a) ?? '')}` : ''))
      .filter(Boolean)
      .join(' ');
    const isLabelish = /^(button|a|h[1-6]|label|legend|li)$/.test(tag) || el.getAttribute('role') === 'menuitem';
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join(' ').trim();
    const text = isLabelish ? clean(visibleText(el, 80)) : own ? `[text ${own.length}]` : '';
    const nav = el instanceof HTMLElement && /^(button|a)$/.test(tag) ? navKind(el) : null;
    lines.push(`${'  '.repeat(depth)}<${tag}${attrs ? ` ${attrs}` : ''}>${text ? ` ${text}` : ''}${nav ? ` {${nav}}` : ''}${isPageChrome(el) ? ' {site}' : ''}`);
    for (const c of Array.from(el.children)) walk(c, depth + 1);
  };
  walk(root ?? doc.body, 0);
  return lines.join('\n');
}
