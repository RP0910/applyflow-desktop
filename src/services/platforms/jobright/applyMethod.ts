import { controlLabel, deepQueryAll, isPageChrome, isVisible, visibleText } from '../dom';
import { couldSubmit } from '../ats/common';

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

function applyButtons(doc: Document): HTMLElement[] {
  return deepQueryAll<HTMLElement>(doc, 'a[href], button, [role="button"]', 1200).filter(
    (el) =>
      isVisible(el) &&
      !isPageChrome(el) &&
      !couldSubmit(el) &&
      !el.closest('[role="dialog"], [aria-modal="true"], .ant-modal') &&
      ANY_APPLY_RE.test(words(controlLabel(el) || el.innerText || el.textContent || '')),
  );
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

function cardRoot(el: HTMLElement): HTMLElement {
  return (
    el.closest<HTMLElement>('article, li, [class*="job-card" i], [class*="jobCard" i], [class*="JobCard" i], [data-job-id], section') ??
    el.parentElement ??
    el
  );
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
  for (const btn of applyButtons(doc)) {
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
