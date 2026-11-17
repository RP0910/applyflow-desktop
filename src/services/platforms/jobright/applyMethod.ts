import { controlLabel, deepQueryAll, isPageChrome, isVisible, visibleText } from '../dom';
import { couldSubmit } from '../ats/common';

function onJobrightList(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/(^|\.)jobright\.ai$/i.test(u.hostname)) return false;
    const p = u.pathname.replace(/\/+$/, '');
    return /^\/jobs(\/(?!info\/)[^/]+)?$/i.test(p) && !u.searchParams.get('jobId');
  } catch {
    return false;
  }
}

function jobIdFromHref(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)jobright\.ai$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/jobs\/info\/([^/?#]+)/i);
    if (m) return decodeURIComponent(m[1]!);
    return u.searchParams.get('jobId') ?? u.searchParams.get('job_id');
  } catch {
    return null;
  }
}

export type JobrightApplyMethod = 'autofill' | 'apply_now' | 'referral' | 'unknown';

export interface JobrightListCard {
  jobId: string | null;
  jobKey: string | null;
  title: string;
  company: string;
  applyLabel: string;
  method: JobrightApplyMethod;
  href: string | null;
}

export interface JobrightListScan {
  total: number;
  eligible: number;
  skippedApplyNow: number;
  skippedUnknown: number;
  skippedReferral: number;
  cards: JobrightListCard[];
}

const words = (t: string) => t.replace(/[^\p{L}\p{N}'’ ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Jobright’s Autofill CTA — the only apply path ApplyFlow should automate. */
export const AUTOFILL_APPLY_RE = /^apply with autofill$/i;
/** External / LinkedIn-style CTA — skip before CV generation. */
export const APPLY_NOW_RE = /^apply now$/i;
const REFERRAL_RE = /^send my profile$/i;
const ANY_APPLY_RE =
  /^(apply|apply now|apply on (the )?(company|employer)(['’]s)? (site|website|page)|apply externally|apply with autofill|easy apply|apply on company site|continue to apply|go to application)$/i;

export function classifyJobrightApplyLabel(label: string): JobrightApplyMethod {
  const t = words(label);
  if (!t) return 'unknown';
  if (AUTOFILL_APPLY_RE.test(t)) return 'autofill';
  if (APPLY_NOW_RE.test(t)) return 'apply_now';
  if (REFERRAL_RE.test(t)) return 'referral';
  if (ANY_APPLY_RE.test(t)) return 'unknown';
  return 'unknown';
}

export function applyMethodStatusLine(method: JobrightApplyMethod): string {
  switch (method) {
    case 'autofill':
      return 'ELIGIBLE — Apply with Autofill';
    case 'apply_now':
      return 'SKIPPED — Apply Now (unsupported)';
    case 'referral':
      return 'SKIPPED — Referral / Send My Profile';
    default:
      return 'SKIPPED — Application type unknown';
  }
}

/** Cards ApplyFlow has removed from the Jobright recommend list (Apply Now / unsupported). */
export const JR_LIST_HIDDEN_ATTR = 'data-af-jr-hidden';
const JR_HIDE_STYLE_ID = 'af-jr-hide-style';

/** Force hidden tiles out of layout (Jobright cards often keep height via flex/grid children). */
function ensureHideStyles(doc: Document): void {
  if (doc.getElementById(JR_HIDE_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = JR_HIDE_STYLE_ID;
  style.textContent = `
[${JR_LIST_HIDDEN_ATTR}="1"] {
  display: none !important;
  visibility: hidden !important;
  height: 0 !important;
  max-height: 0 !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  border: 0 !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
`;
  (doc.head ?? doc.documentElement).appendChild(style);
}

function applyButtons(doc: Document, opts?: { includeOffscreen?: boolean }): HTMLElement[] {
  const includeOffscreen = Boolean(opts?.includeOffscreen);
  // Long recommend feeds can exceed a few hundred controls once infinite-scroll loads.
  return deepQueryAll<HTMLElement>(doc, 'a[href], button, [role="button"]', 4000).filter((el) => {
    if (isPageChrome(el) || couldSubmit(el)) return false;
    if (el.closest('[role="dialog"], [aria-modal="true"], .ant-modal')) return false;
    if (!ANY_APPLY_RE.test(words(controlLabel(el) || el.innerText || el.textContent || ''))) return false;
    // Keep counting / re-classifying cards we already hid (display:none → not isVisible).
    if (el.closest(`[${JR_LIST_HIDDEN_ATTR}="1"]`)) return true;
    // List scan/hide: include below-the-fold / virtualized cards so scroll loads get filtered.
    if (includeOffscreen) return el.isConnected;
    return isVisible(el);
  });
}

function normalizeJobId(href: string | null | undefined, attr?: string | null): string | null {
  if (href) {
    const fromAbs = jobIdFromHref(href);
    if (fromAbs) return fromAbs;
  }
  const raw = attr || href;
  if (!raw) return null;
  try {
    return jobIdFromHref(new URL(raw, 'https://jobright.ai').toString());
  } catch {
    const m = String(raw).match(/\/jobs\/info\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]!) : null;
  }
}

function jobIdsIn(el: Element): Set<string> {
  const ids = new Set<string>();
  for (const a of el.querySelectorAll<HTMLAnchorElement>('a[href*="/jobs/info/"]')) {
    const id = normalizeJobId(a.href, a.getAttribute('href'));
    if (id) ids.add(id);
  }
  const own = el.getAttribute('data-job-id');
  if (own) ids.add(own);
  return ids;
}

/** Primary apply CTA on a Jobright job-detail page (prefers Autofill when both exist). */
export function detectJobrightApplyMethod(doc: Document): { method: JobrightApplyMethod; label: string; element: HTMLElement | null } {
  const els = applyButtons(doc);
  const labeled = els.map((el) => {
    const label = words(controlLabel(el) || el.innerText || el.textContent || '');
    return { el, label, method: classifyJobrightApplyLabel(label) };
  });
  const autofill = labeled.find((x) => x.method === 'autofill');
  if (autofill) return { method: 'autofill', label: autofill.label, element: autofill.el };
  const title = deepQueryAll<HTMLElement>(doc, 'h1, [class*="job-title" i], [class*="jobTitle" i]', 5)[0] ?? null;
  const nearTitle = title
    ? labeled.find((x) => Boolean(title.compareDocumentPosition(x.el) & Node.DOCUMENT_POSITION_FOLLOWING))
    : undefined;
  const pick = nearTitle ?? labeled[0];
  if (!pick) {
    const text = visibleText(doc.body, 8000);
    if (REFERRAL_RE.test(text) || /send my profile/i.test(text)) return { method: 'referral', label: 'Send My Profile', element: null };
    return { method: 'unknown', label: '', element: null };
  }
  return { method: pick.method, label: pick.label, element: pick.el };
}

function applyCtaCount(el: Element): number {
  let n = 0;
  for (const cand of el.querySelectorAll<HTMLElement>('a[href], button, [role="button"]')) {
    if (ANY_APPLY_RE.test(words(controlLabel(cand) || cand.innerText || cand.textContent || ''))) n++;
  }
  return n;
}

/**
 * Full list tile for a Jobright card — outermost ancestor that still owns exactly one job.
 * Inner “job-card” wrappers leave the match-score column and blank white gap if hidden alone.
 */
function cardRoot(el: HTMLElement): HTMLElement {
  let best: HTMLElement = el.parentElement ?? el;
  let node: HTMLElement | null = el.parentElement;
  for (let i = 0; i < 24 && node; i++, node = node.parentElement) {
    if (!node || node === node.ownerDocument.documentElement || node === node.ownerDocument.body) break;
    if (node.matches('main, [role="main"], header, nav, footer')) break;
    const ids = jobIdsIn(node);
    if (ids.size > 1) break; // list / feed container
    if (applyCtaCount(node) > 1) break; // another job’s Apply button entered the subtree
    // Still a single job — keep climbing so match % / tile chrome is included.
    best = node;
  }
  return best;
}

function showCard(root: HTMLElement): void {
  if (root.getAttribute(JR_LIST_HIDDEN_ATTR) !== '1') return;
  root.removeAttribute(JR_LIST_HIDDEN_ATTR);
  root.removeAttribute('data-af-jr-reason');
  root.removeAttribute('aria-hidden');
  root.style.removeProperty('display');
  root.style.removeProperty('visibility');
  root.style.removeProperty('height');
  root.style.removeProperty('max-height');
  root.style.removeProperty('min-height');
  root.style.removeProperty('margin');
  root.style.removeProperty('padding');
  root.style.removeProperty('overflow');
  root.style.removeProperty('opacity');
  root.style.removeProperty('pointer-events');
}

function hideCard(root: HTMLElement, method: JobrightApplyMethod): void {
  ensureHideStyles(root.ownerDocument);
  root.setAttribute(JR_LIST_HIDDEN_ATTR, '1');
  root.setAttribute('data-af-jr-reason', method);
  root.setAttribute('aria-hidden', 'true');
  // Inline as well so React re-styles don’t leave a blank reserved row.
  root.style.setProperty('display', 'none', 'important');
  root.style.setProperty('height', '0', 'important');
  root.style.setProperty('min-height', '0', 'important');
  root.style.setProperty('margin', '0', 'important');
  root.style.setProperty('padding', '0', 'important');
  root.style.setProperty('overflow', 'hidden', 'important');
}

/**
 * Hide Jobright list cards that are not “Apply with Autofill” so they never appear in search results.
 * Removes the whole tile from layout so the next Autofill job moves up (no blank gap).
 * Safe to call repeatedly (scroll / pagination / SPA re-renders).
 */
export function hideUnsupportedJobrightListCards(doc: Document): { hidden: number; visible: number } {
  ensureHideStyles(doc);
  let hidden = 0;
  let visible = 0;
  const seen = new Set<HTMLElement>();
  for (const btn of applyButtons(doc, { includeOffscreen: true })) {
    const label = words(controlLabel(btn) || btn.innerText || btn.textContent || '');
    const method = classifyJobrightApplyLabel(label);
    const root = cardRoot(btn);
    if (seen.has(root)) continue;
    seen.add(root);
    if (method === 'autofill') {
      showCard(root);
      visible++;
      continue;
    }
    hideCard(root, method);
    hidden++;
  }
  return { hidden, visible };
}

/**
 * Keep filtering Apply Now tiles while the Jobright list scrolls / infinite-loads.
 * pageState alone misses scroll-only virtualization updates that don’t change the page signature.
 */
export function watchJobrightListFilter(doc: Document, getUrl: () => string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let obs: MutationObserver | null = null;
  let lastUrl = '';

  const run = (): void => {
    try {
      if (!onJobrightList(getUrl())) return;
      hideUnsupportedJobrightListCards(doc);
    } catch {
      /* page mid-navigation */
    }
  };

  const schedule = (ms = 80): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, ms);
  };

  const onScroll = (): void => schedule(60);
  const win = doc.defaultView;
  win?.addEventListener('scroll', onScroll, true);
  doc.addEventListener('scroll', onScroll, true);

  obs = new MutationObserver(() => schedule(100));
  if (doc.documentElement) {
    obs.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
  }

  interval = setInterval(() => {
    const url = getUrl();
    if (url !== lastUrl) {
      lastUrl = url;
      schedule(0);
      return;
    }
    if (onJobrightList(url)) run();
  }, 750);

  schedule(0);

  return () => {
    if (timer) clearTimeout(timer);
    if (interval) clearInterval(interval);
    obs?.disconnect();
    win?.removeEventListener('scroll', onScroll, true);
    doc.removeEventListener('scroll', onScroll, true);
  };
}

function textFrom(el: Element | null | undefined, max = 120): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Scan a Jobright recommend/list page for per-card apply CTAs.
 * Used to show eligible vs skipped counts before any CV work starts.
 */
export function scanJobrightList(doc: Document, pageUrl = 'https://jobright.ai/jobs/recommend'): JobrightListScan {
  const cards: JobrightListCard[] = [];
  const seen = new Set<string>();
  for (const btn of applyButtons(doc, { includeOffscreen: true })) {
    const label = words(controlLabel(btn) || btn.innerText || btn.textContent || '');
    const method = classifyJobrightApplyLabel(label);
    const root = cardRoot(btn);
    const link =
      root.querySelector<HTMLAnchorElement>('a[href*="/jobs/info/"]') ??
      (btn instanceof HTMLAnchorElement && /\/jobs\/info\//i.test(btn.href) ? btn : null);
    const href = link?.href ? new URL(link.href, pageUrl).toString() : null;
    const id = href ? jobIdFromHref(href) : null;
    const key = id ? `jobright:${id}` : href ?? `${label}|${textFrom(root.querySelector('h2, h3, [class*="title" i]'), 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const titleEl = root.querySelector('h2, h3, [class*="job-title" i], [class*="jobTitle" i], [class*="title" i]');
    const companyEl = root.querySelector('[class*="company" i]');
    cards.push({
      jobId: id,
      jobKey: id ? `jobright:${id}` : null,
      title: textFrom(titleEl, 120) || textFrom(root, 80),
      company: textFrom(companyEl, 80),
      applyLabel: label,
      method,
      href,
    });
  }
  return {
    total: cards.length,
    eligible: cards.filter((c) => c.method === 'autofill').length,
    skippedApplyNow: cards.filter((c) => c.method === 'apply_now').length,
    skippedUnknown: cards.filter((c) => c.method === 'unknown').length,
    skippedReferral: cards.filter((c) => c.method === 'referral').length,
    cards,
  };
}

export function isJobrightAutofillEligible(method: JobrightApplyMethod | null | undefined): boolean {
  return method === 'autofill';
}
