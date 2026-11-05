import type { ExtractionResult, FieldConfidence, JobPosting, PageType } from '@/types';
import { diceJobIdFromUrl, jobKeyFor, normalizeJobUrl } from '@/utils/jobKey';
import { uniqCaseInsensitive } from '@/utils/text';
import { elementToText, htmlToText } from '@/services/extraction/htmlToText';
import { classifyJobSkills, detectRemoteStatus, detectSignals, splitDescription } from '@/services/extraction/sections';
import { canonicalSkill } from '@/services/skills/extract';
import type { JobSiteAdapter, ControlMatch } from '../types';
import { cleanText, controlLabel, deepQueryAll, firstMatch, isPageChrome, isVisible, visibleText } from '../dom';
import { findSubmitButton, findWizardRoot } from './wizard';
import {
  APPLY_LABEL,
  CAPTCHA_SELECTORS,
  DICE_SELECTORS,
  DICE_URLS,
  EXTERNAL_APPLY_LABEL,
  LOGIN_HINTS,
  SUCCESS_PATTERNS,
  WIZARD_MARKERS,
} from './selectors';

interface JsonLdJob {
  '@type'?: string | string[];
  title?: string;
  description?: string;
  datePosted?: string;
  employmentType?: string | string[];
  hiringOrganization?: { name?: string } | string;
  jobLocation?: { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string | { name?: string } } } | { address?: unknown }[];
  jobLocationType?: string;
  applicantLocationRequirements?: unknown;
  baseSalary?: { currency?: string; value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string } };
  identifier?: { value?: string } | string;
  skills?: string | string[];
  directApply?: boolean;
  url?: string;
}

function readJsonLd(doc: Document): JsonLdJob | null {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  for (const s of scripts) {
    try {
      const data: unknown = JSON.parse(s.textContent ?? '');
      const candidates: unknown[] = Array.isArray(data) ? data : (data as { '@graph'?: unknown[] })['@graph'] ?? [data];
      for (const c of candidates) {
        const t = (c as JsonLdJob)['@type'];
        if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) return c as JsonLdJob;
      }
    } catch {
    }
  }
  return null;
}

function formatEmployment(t: string | string[] | undefined): string | null {
  if (!t) return null;
  const arr = Array.isArray(t) ? t : [t];
  const map: Record<string, string> = { FULL_TIME: 'Full-time', PART_TIME: 'Part-time', CONTRACTOR: 'Contract', TEMPORARY: 'Temporary', INTERN: 'Internship', PER_DIEM: 'Per diem', OTHER: 'Other' };
  return arr.map((x) => map[x.toUpperCase()] ?? x.replace(/_/g, ' ')).join(', ');
}

function formatSalary(b: JsonLdJob['baseSalary']): string | null {
  if (!b?.value) return null;
  const { minValue, maxValue, value, unitText } = b.value;
  const cur = b.currency ?? 'USD';
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const per = unitText ? ` per ${unitText.toLowerCase()}` : '';
  if (minValue !== undefined && maxValue !== undefined) return `${cur} ${fmt(minValue)} – ${fmt(maxValue)}${per}`;
  if (value !== undefined) return `${cur} ${fmt(value)}${per}`;
  return null;
}

function locationFromLd(ld: JsonLdJob): string {
  const locs = Array.isArray(ld.jobLocation) ? ld.jobLocation : ld.jobLocation ? [ld.jobLocation] : [];
  const parts = locs
    .map((l) => (l as { address?: { addressLocality?: string; addressRegion?: string } }).address)
    .filter(Boolean)
    .map((a) => [a!.addressLocality, a!.addressRegion].filter(Boolean).join(', '))
    .filter(Boolean);
  return uniqCaseInsensitive(parts).join(' / ');
}

function parseDocumentTitle(title: string): { title?: string; company?: string; location?: string } {
  const parts = title.split(/\s+[-|–]\s+/).map((p) => p.trim());
  if (parts.length >= 3 && /dice/i.test(parts[parts.length - 1]!)) {
    return { title: parts[0], company: parts[1], location: parts.length >= 4 ? parts[2] : undefined };
  }
  return {};
}

function largestDescriptionBlock(doc: Document): Element | null {
  let best: Element | null = null;
  let bestScore = 0;
  doc.querySelectorAll('article, section, div').forEach((el) => {
    const text = el.textContent ?? '';
    if (text.length < 400 || text.length > 30000) return;
    const hits = (text.match(/responsibilit|requirement|qualification|experience|you will|skills/gi) ?? []).length;
    const score = hits * 1000 - text.length / 10;
    if (hits >= 2 && score > bestScore) {
      best = el;
      bestScore = score;
    }
  });
  return best;
}

function chipTexts(doc: Document): string[] {
  const out: string[] = [];
  for (const sel of DICE_SELECTORS.detailChips) {
    try {
      deepQueryAll(doc, sel, 40).forEach((el) => {
        const t = cleanText(el);
        if (t && t.length < 80) out.push(t);
      });
    } catch {
    }
  }
  return uniqCaseInsensitive(out);
}

export function extractDiceJob(doc: Document, url: string): ExtractionResult {
  const confidence: Partial<Record<keyof JobPosting, FieldConfidence>> = {};
  const sources = new Set<ExtractionResult['sources'][number]>();
  const warnings: string[] = [];
  const ld = readJsonLd(doc);
  const titleMeta = parseDocumentTitle(doc.title || '');

  let title = '';
  if (ld?.title) {
    title = ld.title.trim();
    confidence.title = 'high';
    sources.add('structured-data');
  } else {
    const m = firstMatch(doc, DICE_SELECTORS.title as unknown as string[]);
    if (m && cleanText(m.el)) {
      title = cleanText(m.el);
      confidence.title = m.selector === 'h1' || m.selector === 'main h1' ? 'medium' : 'high';
      sources.add(m.selector === 'h1' || m.selector === 'main h1' ? 'heuristics' : 'selectors');
    } else if (titleMeta.title) {
      title = titleMeta.title;
      confidence.title = 'low';
      sources.add('heuristics');
    } else confidence.title = 'missing';
  }

  let company = '';
  const org = ld?.hiringOrganization;
  if (org && (typeof org === 'string' ? org : org.name)) {
    company = (typeof org === 'string' ? org : org.name ?? '').trim();
    confidence.company = 'high';
  } else {
    const m = firstMatch(doc, DICE_SELECTORS.company as unknown as string[]);
    if (m && cleanText(m.el)) {
      company = cleanText(m.el);
      confidence.company = 'high';
      sources.add('selectors');
    } else if (titleMeta.company) {
      company = titleMeta.company;
      confidence.company = 'low';
      sources.add('heuristics');
    } else confidence.company = 'missing';
  }

  let location = ld ? locationFromLd(ld) : '';
  if (location) confidence.location = 'high';
  else {
    const m = firstMatch(doc, DICE_SELECTORS.location as unknown as string[]);
    if (m && cleanText(m.el)) {
      location = cleanText(m.el).replace(/\s*•.*$/, '');
      confidence.location = 'high';
    } else if (titleMeta.location) {
      location = titleMeta.location;
      confidence.location = 'low';
    } else confidence.location = 'missing';
  }

  let description = '';
  if (ld?.description) {
    description = htmlToText(ld.description);
    confidence.description = 'high';
  }
  const descEl = firstMatch(doc, DICE_SELECTORS.description as unknown as string[]);
  if (descEl) {
    const t = elementToText(descEl.el);
    if (t.length > description.length * 1.1) {
      description = t;
      confidence.description = 'high';
      sources.add('selectors');
    }
  }
  if (!description) {
    const block = largestDescriptionBlock(doc);
    if (block) {
      description = elementToText(block);
      confidence.description = 'low';
      sources.add('heuristics');
      warnings.push('The job description was found by page heuristics. Check that it is complete.');
    } else confidence.description = 'missing';
  }

  const chips = chipTexts(doc);
  const chipText = chips.join(' | ');
  let employmentType = formatEmployment(ld?.employmentType);
  if (!employmentType) {
    const c = chips.find((x) => /full[- ]?time|part[- ]?time|contract|third party|w2|c2c|temporary|intern/i.test(x));
    employmentType = c ?? null;
  }
  confidence.employmentType = employmentType ? (ld?.employmentType ? 'high' : 'medium') : 'missing';

  let salary = formatSalary(ld?.baseSalary);
  if (!salary) {
    const m = firstMatch(doc, DICE_SELECTORS.salary as unknown as string[]);
    salary = m ? cleanText(m.el) : chips.find((x) => /(usd|\$)\s?[\d,]+/i.test(x)) ?? null;
  }
  confidence.salary = salary ? 'medium' : 'missing';

  let remoteStatus = ld?.jobLocationType === 'TELECOMMUTE' ? 'remote' : detectRemoteStatus(`${chipText} ${location}`);
  if (remoteStatus === 'unknown') remoteStatus = detectRemoteStatus(description.slice(0, 1500));
  confidence.remoteStatus = remoteStatus === 'unknown' ? 'missing' : chipText ? 'high' : 'medium';

  let datePosted = ld?.datePosted ?? null;
  if (!datePosted) {
    const m = firstMatch(doc, DICE_SELECTORS.posted as unknown as string[]);
    datePosted = m ? cleanText(m.el) : null;
  }

  const platformSkills: string[] = [];
  for (const sel of DICE_SELECTORS.skills) {
    try {
      deepQueryAll(doc, sel, 60).forEach((el) => {
        const t = cleanText(el);
        if (t && t.length < 60) platformSkills.push(t);
      });
    } catch {
    }
    if (platformSkills.length) break;
  }
  if (ld?.skills) platformSkills.push(...(Array.isArray(ld.skills) ? ld.skills : ld.skills.split(/,\s*/)));

  const sections = splitDescription(description);
  const signals = detectSignals(description);
  const skills = classifyJobSkills(sections, description, uniqCaseInsensitive(platformSkills.map(canonicalSkill)));

  const apply = diceAdapter.findApplyControl(doc);
  const externalApply = ld?.directApply === false || (ld?.directApply !== true && Boolean(apply?.external)) || Boolean(apply && EXTERNAL_APPLY_LABEL.test(apply.label));
  const jobId =
    diceJobIdFromUrl(url) ??
    (typeof ld?.identifier === 'string' ? ld.identifier : ld?.identifier?.value) ??
    null;

  const job: JobPosting = {
    jobKey: jobKeyFor(url, jobId),
    platform: 'dice',
    jobId,
    url: normalizeJobUrl(url),
    applicationUrl: apply && !apply.external && apply.element.getAttribute('href')
      ? new URL(apply.element.getAttribute('href')!, 'https://www.dice.com').toString()
      : null,
    title,
    company,
    location,
    remoteStatus,
    salary,
    employmentType,
    contractDuration: signals.contractDuration,
    datePosted,
    description,
    requiredSkills: skills.required,
    preferredSkills: skills.preferred,
    responsibilities: sections.responsibilities.slice(0, 25),
    qualifications: sections.requirements.slice(0, 25),
    benefits: sections.benefits.slice(0, 15),
    educationRequirements: signals.education,
    clearanceRequirements: signals.clearance,
    workAuthorizationRequirements: signals.workAuthorization,
    sponsorshipLanguage: signals.sponsorship,
    externalApply,
  };

  if (description && description.length < 300) {
    warnings.push('The job description looks unusually short. Open “Edit job details” to check it.');
    confidence.description = 'low';
  }
  if (!sections.requirements.length && !sections.responsibilities.length && description) {
    warnings.push('Requirements and responsibilities could not be separated; ApplyFlow used the whole description.');
  }

  const keyFields: (keyof JobPosting)[] = ['title', 'company', 'description'];
  const missingKey = keyFields.filter((k) => confidence[k] === 'missing');
  if (missingKey.length >= 2 || !description) {
    return {
      ok: false,
      job: title || company || description ? job : null,
      confidence,
      sources: Array.from(sources),
      uncertain: true,
      warnings,
      failureReason: 'Dice changed this page layout, so I could not safely read the job details. Use “Edit job details” to paste them, or reload the page.',
    };
  }
  const uncertain = keyFields.some((k) => confidence[k] === 'low' || confidence[k] === 'missing') || confidence.location === 'missing';
  return { ok: true, job, confidence, sources: Array.from(sources.size ? sources : ['heuristics']), uncertain, warnings };
}

function classifyDicePage(doc: Document, url: string): PageType {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'unsupported';
  }
  if (!/(^|\.)dice\.com$/i.test(u.hostname)) return 'unsupported';
  const path = u.pathname;
  if (DICE_URLS.application.some((re) => re.test(path))) return 'application';
  if (WIZARD_MARKERS.test(visibleText(doc.body, 4000)) && findWizardRoot(doc)) return 'application';
  if (DICE_URLS.jobDetail.some((re) => re.test(path))) return 'job-detail';
  if (readJsonLd(doc)) return 'job-detail';
  if (DICE_URLS.search.some((re) => re.test(path))) return 'search';
  return 'other';
}

function findApplyControl(doc: Document): (ControlMatch & { external: boolean }) | null {
  const candidates: HTMLElement[] = [];
  for (const sel of DICE_SELECTORS.applyButton) {
    try {
      candidates.push(...deepQueryAll<HTMLElement>(doc, sel, 10));
    } catch {
    }
  }
  deepQueryAll<HTMLElement>(doc, 'button, a[href], [role="button"]', 400).forEach((el) => {
    const label = controlLabel(el);
    if (APPLY_LABEL.test(label) || EXTERNAL_APPLY_LABEL.test(label)) candidates.push(el);
  });
  const visible = Array.from(new Set(candidates)).filter((el) => isVisible(el) && !isPageChrome(el));
  if (!visible.length) return null;
  const el = visible[0]!;
  const inner = (el.shadowRoot?.querySelector('button, a[href]') as HTMLElement | null) ?? null;
  const target = inner ?? el;
  const label = controlLabel(target) || controlLabel(el) || 'Apply';
  const href = target.getAttribute('href') ?? '';
  let external = EXTERNAL_APPLY_LABEL.test(label);
  if (!external && /^https?:\/\//i.test(href)) {
    try {
      external = !/(^|\.)dice\.com$/i.test(new URL(href).hostname);
    } catch {
      external = false;
    }
  }
  return { element: target, label, external };
}

function findApplicationRoot(doc: Document): Element | null {
  return findWizardRoot(doc);
}

function findSubmitControl(root: Element): { match: ControlMatch | null; reason: string | null } {
  const r = findSubmitButton(root);
  return { match: r.el ? { element: r.el, label: controlLabel(r.el) } : null, reason: r.reason };
}

export const diceAdapter: JobSiteAdapter = {
  id: 'dice',
  displayName: 'Dice',
  kind: 'board',
  canSubmit: true,
  hosts: /(^|\.)dice\.com$/i,
  classifyPage: classifyDicePage,
  extractJob: extractDiceJob,
  jobKeyForUrl: (url) => {
    const id = diceJobIdFromUrl(url);
    return id ? `dice:${id}` : null;
  },
  findApplyControl,
  findApplicationRoot,
  findSubmitControl,
  successPatterns: SUCCESS_PATTERNS,
};

export function detectCaptcha(doc: Document): boolean {
  return CAPTCHA_SELECTORS.some((sel) => {
    try {
      return deepQueryAll(doc, sel, 1).length > 0;
    } catch {
      return false;
    }
  });
}

export function detectLoginRequired(doc: Document): boolean {
  const text = (doc.body?.innerText ?? doc.body?.textContent ?? '').slice(0, 20000);
  return LOGIN_HINTS.some((re) => re.test(text)) || Boolean(doc.querySelector('input[type="password"]'));
}
