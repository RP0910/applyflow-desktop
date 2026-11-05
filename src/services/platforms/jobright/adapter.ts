import type { ExtractionResult, ExtractionSource, FieldConfidence, JobPosting, PageBlocker, PageType } from '@/types';
import { uniqCaseInsensitive } from '@/utils/text';
import { htmlToText } from '@/services/extraction/htmlToText';
import { classifyJobSkills, detectRemoteStatus, detectSignals, splitDescription } from '@/services/extraction/sections';
import { canonicalSkill } from '@/services/skills/extract';
import type { JobSiteAdapter } from '../types';
import { controlLabel, deepQueryAll, isPageChrome, isVisible, visibleText } from '../dom';
import { couldSubmit, hostOf, pageText, visibleCaptcha } from '../ats/common';

export const JOBRIGHT_HOSTS = /(^|\.)jobright\.ai$/i;

export function jobrightJobId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!JOBRIGHT_HOSTS.test(u.hostname)) return null;
    const m = u.pathname.match(/\/jobs\/info\/([^/?#]+)/i);
    if (m) return decodeURIComponent(m[1]!);
    return u.searchParams.get('jobId') ?? u.searchParams.get('job_id');
  } catch {
    return null;
  }
}

export function isJobrightListUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!JOBRIGHT_HOSTS.test(u.hostname)) return false;
    const p = u.pathname.replace(/\/+$/, '');
    return /^\/jobs(\/(?!info\/)[^/]+)?$/i.test(p) && !u.searchParams.get('jobId');
  } catch {
    return false;
  }
}


interface Found {
  title?: string;
  company?: string;
  location?: string;
  description?: string;
  responsibilities?: string[];
  required?: string[];
  preferred?: string[];
  skills?: string[];
  salary?: string;
  employmentType?: string;
  posted?: string;
  remote?: boolean;
  applyUrl?: string;
}

function readJsonLd(doc: Document): Found | null {
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const raw = JSON.parse(s.textContent ?? '');
      const items: unknown[] = Array.isArray(raw) ? raw : raw?.['@graph'] ?? [raw];
      for (const it of items) {
        const o = it as Record<string, unknown>;
        const type = o['@type'];
        if (!(type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting')))) continue;
        const org = o.hiringOrganization as { name?: string } | string | undefined;
        const loc = (Array.isArray(o.jobLocation) ? o.jobLocation[0] : o.jobLocation) as { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string | { name?: string } } } | undefined;
        const a = loc?.address;
        const country = typeof a?.addressCountry === 'string' ? a.addressCountry : a?.addressCountry?.name;
        return {
          title: typeof o.title === 'string' ? cleanJobTitle(o.title).title : undefined,
          company: typeof org === 'string' ? org : org?.name,
          location: [a?.addressLocality, a?.addressRegion, country].filter(Boolean).join(', ') || undefined,
          description: typeof o.description === 'string' ? htmlToText(o.description) : undefined,
          employmentType: Array.isArray(o.employmentType) ? o.employmentType.join(', ') : typeof o.employmentType === 'string' ? o.employmentType : undefined,
          posted: typeof o.datePosted === 'string' ? o.datePosted : undefined,
          remote: o.jobLocationType === 'TELECOMMUTE' || undefined,
          applyUrl: typeof o.url === 'string' && !JOBRIGHT_HOSTS.test(hostOf(o.url)) ? o.url : undefined,
        };
      }
    } catch {
    }
  }
  return null;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const strs = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : str((x as Record<string, unknown>)?.name) ?? str((x as Record<string, unknown>)?.text) ?? '')).filter(Boolean) : undefined);

export function cleanJobTitle(t: string | undefined): { title?: string; company?: string } {
  if (!t) return {};
  const s = t.replace(/^\s*\[(remote|hybrid|onsite|on-site)\]\s*/i, '').trim();
  const m = s.match(/^(.+?)\s+Job Details\s*(?:\|\s*(.+))?$/i);
  if (m) return { title: m[1]!.trim(), company: m[2]?.trim() || undefined };
  const at = s.match(/^(.+?)\s+@\s+(.+)$/);
  if (at) return { title: at[1]!.trim(), company: at[2]!.trim() };
  return { title: s };
}

function externalUrl(v: unknown): string | undefined {
  const s = str(v);
  if (!s || !/^https?:\/\//i.test(s)) return undefined;
  return JOBRIGHT_HOSTS.test(hostOf(s)) ? undefined : s;
}

function readNextData(doc: Document, jobId?: string | null): Found | null {
  const el = doc.getElementById('__NEXT_DATA__');
  if (!el?.textContent) return null;
  let data: unknown;
  try {
    data = JSON.parse(el.textContent);
  } catch {
    return null;
  }
  let job: Record<string, unknown> | null = null;
  let company: Record<string, unknown> | null = null;
  const seen = new Set<unknown>();
  const visit = (v: unknown, depth: number, key = ''): void => {
    if (!v || typeof v !== 'object' || seen.has(v) || depth > 12) return;
    seen.add(v);
    const o = v as Record<string, unknown>;
    const isJob = (str(o.jobTitle) || str(o.title)) && (str(o.jobSummary) || str(o.jobDescription) || str(o.description) || Array.isArray(o.coreResponsibilities));
    if (!job && isJob && (!jobId || !str(o.jobId) || str(o.jobId) === jobId)) job = o;
    if (!company && str(o.companyName) && (key === 'companyResult' || str(o.companyDesc) || str(o.companyURL) || str(o.companyUrl) || str(o.companyLogo))) company = o;
    for (const k of Object.keys(o)) visit(o[k], depth + 1, k);
  };
  visit(data, 0);
  if (!job) return null;
  const j = job as Record<string, unknown>;
  const c = (company ?? {}) as Record<string, unknown>;
  const q = (j.qualifications ?? {}) as Record<string, unknown>;
  const skillTags = strs(j.jobTags) ?? strs(j.skills) ?? strs(j.skillSummaries) ?? strs((j.skillMatchingScores as unknown[] | undefined)?.map((x) => (x as Record<string, unknown>)?.displayName));
  const cleaned = cleanJobTitle(str(j.jobTitle) ?? str(j.title));
  return {
    title: str(j.jobNlpTitle) ?? cleaned.title,
    company: str(j.companyName) ?? str(c.companyName) ?? str((j.company as Record<string, unknown> | undefined)?.name) ?? cleaned.company,
    location: str(j.jobLocation) ?? str(j.location),
    description: str(j.jobDescription) ? htmlToText(str(j.jobDescription)!) : str(j.description) ? htmlToText(str(j.description)!) : str(j.jobSummary),
    responsibilities: strs(j.coreResponsibilities) ?? strs(j.responsibilities),
    required: strs(q.mustHave) ?? strs(j.requirements),
    preferred: strs(q.preferredHave) ?? strs(q.niceToHave),
    skills: skillTags,
    salary: str(j.salaryDesc) ?? str(j.salary),
    employmentType: str(j.employmentType) ?? str(j.jobType),
    posted: str(j.publishTime) ?? str(j.publishTimeDesc) ?? str(j.postedAt),
    remote: j.isRemote === true || /remote/i.test(str(j.workModel) ?? '') || undefined,
    applyUrl: externalUrl(j.applyLink) ?? externalUrl(j.applyUrl) ?? externalUrl(j.originalUrl) ?? externalUrl(j.jobUrl) ?? externalUrl(j.url),
  };
}


function fromDocumentTitle(t: string): { title?: string; company?: string } {
  const s = t.replace(/\s*\|\s*Jobright(\.ai| AI)?\s*$/i, '');
  if (!/ @ | Job Details/i.test(s)) return {};
  const [left, right] = s.split(/\s+@\s+(?=[^@]+$)/);
  const c = cleanJobTitle(left);
  return { title: c.title, company: right?.trim() || c.company };
}

function headingTitle(doc: Document): { title?: string; company?: string } {
  const el =
    deepQueryAll<HTMLElement>(doc, 'h1, [class*="job-title" i], [class*="jobTitle" i], [class*="job_title" i]', 20).find((e) => isVisible(e) && !isPageChrome(e) && visibleText(e, 300).length > 3) ?? null;
  return el ? cleanJobTitle(visibleText(el, 300)) : {};
}

const JOB_SECTIONS = /^(overview|job description|about (the|this) (role|job|position)|summary|why join us|responsibilities|what you(['’]ll| will) do|qualifications?|requirements|required|preferred|nice to have|benefits|perks)\b/i;
const STOP_SECTIONS = /^(company|about (the )?company|funding|recent news|similar jobs|people also viewed|invite-only|insider connection|h1b sponsorship|leadership team)\b/i;

function readSections(doc: Document): { text: string; byHeading: Record<string, string[]>; skills: string[] } {
  const main = doc.querySelector('main') ?? doc.body;
  const sections: { h: Element; name: string; include: boolean }[] = [];
  let started = false;
  for (const h of deepQueryAll<HTMLElement>(main, 'h1, h2, h3, h4, h5', 200)) {
    if (!isVisible(h) || isPageChrome(h)) continue;
    const name = visibleText(h, 80);
    if (started && STOP_SECTIONS.test(name)) {
      sections.push({ h, name, include: false });
      break;
    }
    const include = JOB_SECTIONS.test(name);
    started ||= include;
    sections.push({ h, name, include });
  }
  const owner = (el: Element) => {
    let found: (typeof sections)[number] | null = null;
    for (const s of sections) {
      if (s.h.compareDocumentPosition(el) & 4 ) found = s;
      else break;
    }
    return found;
  };
  const byHeading: Record<string, string[]> = {};
  for (const el of deepQueryAll<HTMLElement>(main, 'li, p', 4000)) {
    if (el.querySelector('li, p') || !isVisible(el)) continue;
    const s = owner(el);
    if (!s?.include) continue;
    const t = visibleText(el, 800);
    if (t) (byHeading[s.name.toLowerCase()] ??= []).push(t);
  }
  const skills: string[] = [];
  for (const el of deepQueryAll<HTMLElement>(main, '[class*="tag" i], [class*="chip" i], [class*="skill" i]', 600)) {
    if (el.childElementCount > 0 || !isVisible(el)) continue;
    const s = owner(el);
    const t = visibleText(el, 60);
    if (s?.include && /qualif|skill|requirement/i.test(s.name) && t && t.length < 50) skills.push(t);
  }
  const text = sections
    .filter((s) => s.include)
    .map((s) => [s.name, ...(byHeading[s.name.toLowerCase()] ?? []).map((l) => `• ${l}`)].join('\n'))
    .join('\n\n')
    .trim();
  return { text, byHeading, skills };
}

function headerChips(doc: Document): string[] {
  const h1 = doc.querySelector('h1');
  const scope = h1?.parentElement?.parentElement ?? doc.body;
  return deepQueryAll<HTMLElement>(scope, 'span, div, p, li', 300)
    .filter((el) => el.childElementCount === 0 && isVisible(el))
    .map((el) => visibleText(el, 80))
    .filter((t) => t && t.length < 80);
}

function lineFor(byHeading: Record<string, string[]>, re: RegExp): string[] {
  const k = Object.keys(byHeading).find((h) => re.test(h));
  return k ? byHeading[k]! : [];
}

export function extractJobrightJob(doc: Document, url: string): ExtractionResult {
  const sources = new Set<ExtractionSource>();
  const confidence: Partial<Record<keyof JobPosting, FieldConfidence>> = {};
  const warnings: string[] = [];
  const id = jobrightJobId(url);
  const heading = headingTitle(doc);
  const nd = readNextData(doc, id);
  const ldRaw = readJsonLd(doc);
  const same = (a?: string, b?: string) => Boolean(a && b && (a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase())));
  const ld = ldRaw && (same(ldRaw.title, nd?.title) || same(ldRaw.title, heading.title) || (!nd && !heading.title)) ? ldRaw : null;
  if (ld) sources.add('structured-data');
  if (nd) sources.add('structured-data');
  const sec = readSections(doc);
  if (sec.text) sources.add('selectors');
  const fromTitle = fromDocumentTitle(doc.title);

  const pick = (k: keyof JobPosting, ...vals: (string | undefined)[]) => {
    const i = vals.findIndex((v) => v && v.trim());
    confidence[k] = i < 0 ? 'missing' : i <= 1 ? 'high' : 'medium';
    return i < 0 ? '' : vals[i]!.trim();
  };
  const title = pick('title', nd?.title, ld?.title, heading.title || fromTitle.title);
  const company = pick('company', nd?.company, ld?.company, fromTitle.company || companyNearTitle(doc) || heading.company);
  const chips = headerChips(doc);
  const chipLocation = chips.find((c) => /,\s*[A-Z]{2}\b|united states|\bremote\b|\bUS\b/i.test(c) && c.length < 60 && !/\$/.test(c));
  const location = pick('location', ld?.location, nd?.location, chipLocation);
  if (!location) confidence.location = 'missing';

  const responsibilities = nd?.responsibilities ?? lineFor(sec.byHeading, /responsibilit|what you/);
  const required = nd?.required ?? lineFor(sec.byHeading, /^required|^requirements|^qualification/);
  const preferred = nd?.preferred ?? lineFor(sec.byHeading, /preferred|nice to have/);
  const benefits = lineFor(sec.byHeading, /benefit|perks/);
  const structured = [ld?.description, nd?.description].filter(Boolean).sort((a, b) => b!.length - a!.length)[0] ?? '';
  const assembled = [
    structured,
    responsibilities.length && !structured.includes(responsibilities[0]!) ? `Responsibilities\n${responsibilities.map((r) => `• ${r}`).join('\n')}` : '',
    required.length && !structured.includes(required[0]!) ? `Required\n${required.map((r) => `• ${r}`).join('\n')}` : '',
    preferred.length && !structured.includes(preferred[0]!) ? `Preferred\n${preferred.map((r) => `• ${r}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();
  const description = assembled.length >= sec.text.length ? assembled : sec.text;
  confidence.description = description.length > 300 ? 'high' : description ? 'low' : 'missing';

  const split = splitDescription(description);
  const skillTags = uniqCaseInsensitive([...(nd?.skills ?? []), ...sec.skills].map((s) => canonicalSkill(s) || s));
  const classified = classifyJobSkills({ ...split, requirements: required.length ? required : split.requirements, preferred: preferred.length ? preferred : split.preferred }, description, skillTags);
  const signals = detectSignals(description);
  const salary = nd?.salary ?? chips.find((c) => /\$\s?\d/.test(c)) ?? null;
  const posted = nd?.posted ?? ld?.posted ?? chips.find((c) => /\b(ago|today|yesterday)\b/i.test(c)) ?? null;
  const remoteText = `${location} ${chips.join(' ')}`;
  const job: JobPosting = {
    jobKey: id ? `jobright:${id}` : `url:${url.split(/[?#]/)[0]}`,
    platform: 'jobright',
    jobId: id,
    url: url.split('#')[0]!,
    applicationUrl: ld?.applyUrl ?? nd?.applyUrl ?? null,
    title,
    company,
    location,
    remoteStatus: nd?.remote || ld?.remote ? 'remote' : detectRemoteStatus(remoteText),
    salary,
    employmentType: nd?.employmentType ?? ld?.employmentType ?? chips.find((c) => /^(full[- ]time|part[- ]time|contract|internship|temporary|contract to hire)$/i.test(c)) ?? null,
    contractDuration: null,
    datePosted: posted,
    description,
    requiredSkills: classified.required,
    preferredSkills: classified.preferred,
    responsibilities: responsibilities.length ? responsibilities : split.responsibilities,
    qualifications: required.length ? required : split.requirements,
    benefits,
    educationRequirements: signals.education,
    clearanceRequirements: signals.clearance,
    workAuthorizationRequirements: signals.workAuthorization,
    sponsorshipLanguage: signals.sponsorship,
    externalApply: true,
  };
  if (!job.applicationUrl) warnings.push('The employer’s application address wasn’t in the page data; ApplyFlow will use Jobright’s Apply button.');
  if (description && description.length < 200) {
    warnings.push('The job description looks unusually short. Open “Edit job details” to check it.');
    confidence.description = 'low';
  }
  const missingKey = (['title', 'company', 'description'] as const).filter((k) => confidence[k] === 'missing');
  if (missingKey.length >= 2 || !description) {
    return {
      ok: false,
      job: title || company || description ? job : null,
      confidence,
      sources: Array.from(sources),
      uncertain: true,
      warnings,
      failureReason: 'ApplyFlow couldn’t read this Jobright job (the page may still be loading, or you may need to sign in). Reload the page, or use “Edit job details” to paste it.',
    };
  }
  const uncertain = (['title', 'company', 'description', 'location'] as const).some((k) => confidence[k] === 'low' || confidence[k] === 'missing');
  return { ok: true, job, confidence, sources: Array.from(sources.size ? sources : new Set<ExtractionSource>(['heuristics'])), uncertain, warnings };
}

function companyNearTitle(doc: Document): string | undefined {
  for (const el of deepQueryAll<HTMLElement>(doc, 'h2, h3, [class*="company" i]', 40)) {
    const t = visibleText(el, 120);
    const m = t.match(/^(.{2,80}?)\s*[·•]\s*\d+\s+\w+\s+ago$/i);
    if (m) return m[1]!.trim();
  }
  return undefined;
}

export async function extractJobrightJobAsync(doc: Document, url: string, fetcher: (u: string) => Promise<string> = defaultFetch): Promise<ExtractionResult> {
  const here = extractJobrightJob(doc, url);
  const id = jobrightJobId(url);
  const hasOwnData = Boolean(readNextData(doc, id)?.title);
  if (here.ok && !here.uncertain && hasOwnData) return here;
  if (!id) return here;
  try {
    const html = await fetcher(url.split('#')[0]!);
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    if (!readNextData(parsed, id)?.title && !readJsonLd(parsed)) return here;
    const fresh = extractJobrightJob(parsed, url);
    if (!fresh.ok) return here;
    const merged = { ...fresh.job!, location: fresh.job!.location || here.job?.location || '', salary: fresh.job!.salary ?? here.job?.salary ?? null };
    return { ...fresh, job: merged, warnings: fresh.warnings };
  } catch {
    return here;
  }
}

async function defaultFetch(u: string): Promise<string> {
  const r = await fetch(u, { credentials: 'include', headers: { accept: 'text/html' } });
  if (!r.ok) throw new Error(String(r.status));
  return r.text();
}


const APPLY = /^(apply|apply now|apply on (the )?(company|employer)(['’]s)? (site|website|page)|apply externally|apply with autofill|easy apply|apply on company site|continue to apply|go to application)$/i;
const DIALOG_APPLY = /^(apply without customi[sz]ing|apply without (changes|optimi[sz]ing|tailoring|autofill)|apply manually|continue (to apply|without customi[sz]ing)|skip( and apply| for now)?|apply anyway|apply directly|no,? (thanks|just apply)|go to (the )?(company|employer)('s)? (site|website)|apply on (the )?(company|employer)('s)? (site|website))$/i;
const APPLIED_PROMPT = /did you apply\??/i;
const APPLIED_YES = /^(yes,? i applied!?|i applied!?)$/i;
const APPLIED_NO = /^(no,? i (didn['’]?t|did not) apply!?)$/i;
const DIALOG = '[role="dialog"], [aria-modal="true"], .ant-modal, [class*="modal" i]';

const words = (t: string) => t.replace(/[^\p{L}\p{N}'’ ]+/gu, ' ').replace(/\s+/g, ' ').trim();

function dialogButtons(d: HTMLElement): HTMLElement[] {
  return deepQueryAll<HTMLElement>(d, 'a, button, [role="button"], [role="link"], span, u, div, p', 400).filter((el) => {
    const t = words(el.innerText ?? el.textContent ?? '');
    return t.length > 0 && t.length < 60 && isVisible(el) && !couldSubmit(el);
  });
}

function pickInnermost(hits: HTMLElement[]): HTMLElement | null {
  const hit = hits.find((el) => !hits.some((o) => o !== el && el.contains(o)));
  return hit ? hit.closest<HTMLElement>('a, button, [role="button"], [role="link"]') ?? hit : null;
}

export function appliedConfirmDialog(doc: Document): { root: HTMLElement; yes: HTMLElement | null; no: HTMLElement | null } | null {
  for (const d of deepQueryAll<HTMLElement>(doc, DIALOG, 20).filter(isVisible)) {
    if (!APPLIED_PROMPT.test(visibleText(d, 800))) continue;
    const btns = dialogButtons(d);
    return {
      root: d,
      yes: pickInnermost(btns.filter((el) => APPLIED_YES.test(words(el.innerText ?? el.textContent ?? '')))),
      no: pickInnermost(btns.filter((el) => APPLIED_NO.test(words(el.innerText ?? el.textContent ?? '')))),
    };
  }
  return null;
}

export function confirmAppliedControl(doc: Document): HTMLElement | null {
  const dialog = appliedConfirmDialog(doc);
  if (dialog?.yes) return dialog.yes;
  const els = deepQueryAll<HTMLElement>(doc, 'a, button, [role="button"], [role="link"]', 400).filter(
    (el) => isVisible(el) && !isPageChrome(el) && APPLIED_YES.test(words(controlLabel(el) || el.innerText || el.textContent || '')),
  );
  return pickInnermost(els);
}

export function dialogChoice(doc: Document): HTMLElement | null {
  for (const d of deepQueryAll<HTMLElement>(doc, DIALOG, 20).filter(isVisible)) {
    if (APPLIED_PROMPT.test(visibleText(d, 800))) continue;
    const hits = dialogButtons(d).filter((el) => {
      const t = words(el.innerText ?? el.textContent ?? '');
      return DIALOG_APPLY.test(t) || APPLY.test(t);
    });
    const hit = pickInnermost(hits);
    if (hit) return hit;
  }
  return null;
}

function applyControl(doc: Document): HTMLElement | null {
  const choice = dialogChoice(doc);
  if (choice) return choice;
  const els = deepQueryAll<HTMLElement>(doc, 'a[href], button, [role="button"]', 800).filter(
    (el) => isVisible(el) && !isPageChrome(el) && !couldSubmit(el) && !el.closest(DIALOG) && APPLY.test(words(controlLabel(el))),
  );
  const title = deepQueryAll<HTMLElement>(doc, 'h1, [class*="job-title" i], [class*="jobTitle" i]', 5)[0] ?? null;
  return (title ? els.find((el) => title.compareDocumentPosition(el) & 4) : null) ?? els[0] ?? null;
}

function classify(doc: Document, url: string): PageType {
  if (!JOBRIGHT_HOSTS.test(hostOf(url))) return 'unsupported';
  if (/\/jobs\/info\//i.test(url) || new URL(url).searchParams.get('jobId')) return 'job-detail';
  if (isJobrightListUrl(url)) return 'search';
  if (readJsonLd(doc)) return 'job-detail';
  return 'other';
}

function loginRequired(doc: Document): boolean {
  if (/\/(login|signin|sign-in|signup|sign-up|register)\b/i.test(doc.location?.pathname ?? '')) return true;
  const dialogs = deepQueryAll<HTMLElement>(doc, '[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="login" i], [class*="signin" i]', 20).filter(isVisible);
  return dialogs.some((d) => {
    const t = visibleText(d, 2000);
    const asks = /\b(sign (in|up)( now| to apply)?|log ?in|create (an |your )?account|already a member|(continue|sign (in|up)|log ?in) with (google|linkedin|email|apple))\b/i.test(t);
    const email = d.querySelector('input[type="password"], input[type="email"], input[name*="mail" i], input[placeholder*="mail" i], input[aria-label*="mail" i], input[autocomplete="email"]');
    return asks && (Boolean(email) || /\b(continue|sign (in|up)|log ?in) with google\b/i.test(t));
  });
}

function blocker(doc: Document, url: string): PageBlocker | null {
  if (classify(doc, url) !== 'job-detail') return null;
  const text = pageText(doc, 20000);
  if (/no longer (available|accepting applications|open)|this job (has )?(expired|closed|been closed)|position (has been )?filled|job (is )?(expired|closed)/i.test(text) && !applyControl(doc)) {
    return { kind: 'closed', message: 'Jobright says this job is no longer available.' };
  }
  if (!applyControl(doc) && /send my profile/i.test(text)) {
    return { kind: 'referral', message: 'This is a Jobright referral role: there is no employer application to fill. Use “Send My Profile” on the page; your tailored documents are saved.' };
  }
  return null;
}

export const jobrightAdapter: JobSiteAdapter = {
  id: 'jobright',
  displayName: 'Jobright',
  kind: 'board',
  hosts: JOBRIGHT_HOSTS,
  classifyPage: classify,
  extractJob: extractJobrightJob,
  extractJobAsync: (doc, url) => extractJobrightJobAsync(doc, url),
  jobKeyForUrl: (url) => {
    const id = jobrightJobId(url);
    return id ? `jobright:${id}` : null;
  },
  findApplyControl: (doc) => {
    const el = applyControl(doc);
    if (!el) return null;
    const raw = el.getAttribute('href');
    const href = raw && /^https?:\/\//i.test(raw) ? raw : null;
    return { element: el, label: words(controlLabel(el) || el.textContent || '') || 'Apply', external: true, href };
  },
  pendingChoice: (doc) => {
    const el = dialogChoice(doc);
    return el ? words(controlLabel(el) || el.textContent || '') || 'Continue' : null;
  },
  findApplicationRoot: () => null,
  findSubmitControl: () => ({ match: null, reason: 'Applications happen on the employer’s site.' }),
  successPatterns: [],
  blocker,
  applicationUrl: (doc) => readJsonLd(doc)?.applyUrl ?? readNextData(doc)?.applyUrl ?? null,
  canSubmit: false,
  captchaVisible: visibleCaptcha,
  loginRequired,
};
