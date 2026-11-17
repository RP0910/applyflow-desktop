import type { JobPosting, JobSession, PageState, PageType, SiteId } from '@/types';
import { diceJobIdFromUrl, normalizeJobUrl } from '@/utils/jobKey';
import { similarity } from '@/utils/text';
import { jobrightJobId } from '@/services/platforms/jobright/adapter';
import { formKeyFor } from '@/services/platforms/registry';

const SOFT_THRESHOLD = 0.7;
const CONFLICT_THRESHOLD = 0.35;

export interface JobIdentity {
  jobKey: string;
  jobId: string | null;
  url: string;
  applicationUrl: string | null;
  title: string;
  company: string;
  platform: JobPosting['platform'] | string;
}

export interface ObservedJob {
  url: string;
  pageType: PageType;
  jobKey: string | null;
  title: string;
  company?: string | null;
  hasApplicationForm: boolean;
  site?: SiteId | null;
}

export type IdentityVerdict = 'match' | 'compatible' | 'unknown' | 'mismatch';

export interface IdentityMatch {
  verdict: IdentityVerdict;
  confidence: number;
  reasons: string[];
  signals: {
    jobKey?: boolean;
    jobId?: boolean;
    url?: boolean;
    applicationUrl?: boolean;
    title?: number;
    company?: number;
  };
}

export function identityFromJob(job: Pick<JobPosting, 'jobKey' | 'jobId' | 'url' | 'applicationUrl' | 'title' | 'company' | 'platform'>): JobIdentity {
  return {
    jobKey: job.jobKey,
    jobId: job.jobId,
    url: job.url,
    applicationUrl: job.applicationUrl,
    title: job.title,
    company: job.company,
    platform: job.platform,
  };
}

export function identityFromSession(session: Pick<JobSession, 'job'>): JobIdentity {
  return identityFromJob(session.job);
}

export function observedFromPage(st: Pick<PageState, 'url' | 'pageType' | 'jobKey' | 'title' | 'hasApplicationForm' | 'site'> & { company?: string | null }): ObservedJob {
  return {
    url: st.url,
    pageType: st.pageType,
    jobKey: st.jobKey,
    title: st.title,
    company: st.company ?? null,
    hasApplicationForm: st.hasApplicationForm,
    site: st.site ?? null,
  };
}

function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function boardIdFromKey(jobKey: string): string | null {
  const m = jobKey.match(/^(?:dice|jobright):(.+)$/i);
  return m ? m[1]!.toLowerCase() : null;
}

function boardIdFromUrl(url: string): string | null {
  return diceJobIdFromUrl(url)?.toLowerCase() ?? jobrightJobId(url)?.toLowerCase() ?? null;
}

function expectedBoardId(expected: JobIdentity): string | null {
  if (expected.jobId) return expected.jobId.toLowerCase();
  return boardIdFromKey(expected.jobKey) ?? boardIdFromUrl(expected.url);
}

/** True when both sides name the same Dice/Jobright posting id. */
export function sameBoardJob(expected: JobIdentity, observed: ObservedJob): boolean {
  const want = expectedBoardId(expected);
  if (!want) return false;
  const got =
    (observed.jobKey && boardIdFromKey(observed.jobKey)) ||
    boardIdFromUrl(observed.url) ||
    null;
  return Boolean(got && got === want);
}

export function applicationHostMatch(expectedAppUrl: string | null | undefined, pageUrl: string): boolean {
  if (!expectedAppUrl) return false;
  const a = hostOf(expectedAppUrl);
  const b = hostOf(pageUrl);
  if (!a || !b) return false;
  if (a === b) return true;
  // boards.greenhouse.io vs job-boards.greenhouse.io, company.lever.co paths, etc.
  const parts = (h: string) => h.split('.').reverse();
  const pa = parts(a);
  const pb = parts(b);
  return pa[0] === pb[0] && pa[1] === pb[1] && Boolean(pa[1]);
}

function softScore(a: string | null | undefined, b: string | null | undefined): number | undefined {
  if (!a?.trim() || !b?.trim()) return undefined;
  return similarity(a, b);
}

function urlsEqual(a: string, b: string): boolean {
  try {
    return normalizeJobUrl(a) === normalizeJobUrl(b);
  } catch {
    return a.trim() === b.trim();
  }
}

/**
 * Compare the job the session/CV was built for against what the Jobs tab currently shows.
 * Deterministic identifiers win; title/company are soft signals only.
 */
export function matchJobIdentity(expected: JobIdentity, observed: ObservedJob, opts: { formKey?: string | null; formUrl?: string | null } = {}): IdentityMatch {
  const signals: IdentityMatch['signals'] = {};
  const wantId = expectedBoardId(expected);
  const gotKeyId = observed.jobKey ? boardIdFromKey(observed.jobKey) : null;
  const gotUrlId = boardIdFromUrl(observed.url);

  if (observed.jobKey && observed.jobKey === expected.jobKey) {
    signals.jobKey = true;
    return { verdict: 'match', confidence: 1, reasons: ['Same job key'], signals };
  }

  if (sameBoardJob(expected, observed)) {
    signals.jobId = true;
    if (observed.jobKey) signals.jobKey = observed.jobKey === expected.jobKey;
    return { verdict: 'match', confidence: 0.98, reasons: ['Same board job id'], signals };
  }

  if (urlsEqual(expected.url, observed.url)) {
    signals.url = true;
    return { verdict: 'match', confidence: 0.95, reasons: ['Same job URL'], signals };
  }

  // Different board posting → hard mismatch (do not click Apply here).
  if (wantId && (gotKeyId || gotUrlId) && wantId !== (gotKeyId || gotUrlId)) {
    signals.jobId = false;
    if (observed.jobKey) signals.jobKey = false;
    return {
      verdict: 'mismatch',
      confidence: 0.97,
      reasons: [`Page is a different job (${gotKeyId || gotUrlId}) than the tailored resume (${wantId})`],
      signals,
    };
  }

  if (observed.jobKey && boardIdFromKey(observed.jobKey) && expected.jobKey !== observed.jobKey && (expected.jobKey.startsWith('dice:') || expected.jobKey.startsWith('jobright:'))) {
    signals.jobKey = false;
    return {
      verdict: 'mismatch',
      confidence: 0.96,
      reasons: [`Page job key ${observed.jobKey} does not match session ${expected.jobKey}`],
      signals,
    };
  }

  const titleScore = softScore(expected.title, observed.title);
  const companyScore = softScore(expected.company, observed.company);
  if (titleScore !== undefined) signals.title = titleScore;
  if (companyScore !== undefined) signals.company = companyScore;

  const onBoard = observed.site === 'dice' || observed.site === 'jobright' || observed.pageType === 'search';
  const onEmployerSurface =
    !onBoard &&
    (observed.hasApplicationForm ||
      observed.pageType === 'application' ||
      Boolean(observed.site && observed.site !== 'dice' && observed.site !== 'jobright'));

  // Employer ATS / careers pages (including mid-hop before the form mounts).
  if (onEmployerSurface) {
    if (opts.formUrl && urlsEqual(opts.formUrl, observed.url)) {
      signals.applicationUrl = true;
      return { verdict: 'compatible', confidence: 0.92, reasons: ['Same application form URL ApplyFlow opened'], signals };
    }
    if (opts.formKey && formKeyFor(observed.url) === opts.formKey) {
      signals.applicationUrl = true;
      return { verdict: 'compatible', confidence: 0.9, reasons: ['Same application form key'], signals };
    }
    if (applicationHostMatch(expected.applicationUrl, observed.url)) {
      signals.applicationUrl = true;
      try {
        const exp = new URL(expected.applicationUrl!);
        const obs = new URL(observed.url);
        const expPath = exp.pathname.replace(/\/+$/, '').toLowerCase();
        const obsPath = obs.pathname.replace(/\/+$/, '').toLowerCase();
        if (expPath && obsPath && (obsPath.includes(expPath) || expPath.includes(obsPath) || formKeyFor(observed.url) === formKeyFor(expected.applicationUrl!))) {
          return { verdict: 'compatible', confidence: 0.88, reasons: ['Application host and path align with this job’s apply URL'], signals };
        }
      } catch {
        /* host-only */
      }
      return { verdict: 'compatible', confidence: 0.75, reasons: ['Application host matches this job’s apply URL'], signals };
    }
    // Soft confirm on ATS when title+company both look right.
    if (titleScore !== undefined && companyScore !== undefined && titleScore >= SOFT_THRESHOLD && companyScore >= SOFT_THRESHOLD) {
      return { verdict: 'compatible', confidence: 0.7, reasons: ['Application page title and company match the tailored job'], signals };
    }
    if (
      observed.hasApplicationForm &&
      titleScore !== undefined &&
      companyScore !== undefined &&
      titleScore < CONFLICT_THRESHOLD &&
      companyScore < CONFLICT_THRESHOLD
    ) {
      return {
        verdict: 'mismatch',
        confidence: 0.8,
        reasons: ['Application page title and company do not match the tailored resume'],
        signals,
      };
    }
    // Generic ATS / login walls with no apply URL — unknown (caller decides whether to recover).
    if (!expected.applicationUrl && !opts.formKey && !opts.formUrl) {
      return { verdict: 'unknown', confidence: 0.4, reasons: ['Employer page with no stored apply URL to verify'], signals };
    }
    return { verdict: 'unknown', confidence: 0.45, reasons: ['Could not confidently tie this employer page to the tailored job'], signals };
  }

  if (observed.pageType === 'search') {
    return { verdict: 'mismatch', confidence: 0.9, reasons: ['Browser is on a job list, not this job'], signals };
  }

  // Job-detail / other without a matching id: use soft signals.
  if (observed.pageType === 'job-detail') {
    // Session expects a board id but the page lost it (Jobright drawer closed) → treat as off-job.
    if (wantId && !gotKeyId && !gotUrlId && (observed.site === 'jobright' || expected.platform === 'jobright' || observed.site === 'dice' || expected.platform === 'dice')) {
      return {
        verdict: 'mismatch',
        confidence: 0.85,
        reasons: ['Job page no longer shows this posting’s id — Apply buttons may belong to another job'],
        signals,
      };
    }
    if (titleScore !== undefined && companyScore !== undefined) {
      if (titleScore >= SOFT_THRESHOLD && companyScore >= SOFT_THRESHOLD) {
        return { verdict: 'compatible', confidence: 0.72, reasons: ['Job title and company match'], signals };
      }
      if (titleScore < CONFLICT_THRESHOLD && companyScore < CONFLICT_THRESHOLD) {
        return { verdict: 'mismatch', confidence: 0.82, reasons: ['Job title and company do not match the tailored resume'], signals };
      }
    }
    if (titleScore !== undefined && titleScore < CONFLICT_THRESHOLD && expected.title.trim()) {
      return { verdict: 'mismatch', confidence: 0.7, reasons: ['Job title does not match the tailored resume'], signals };
    }
  }

  return { verdict: 'unknown', confidence: 0.35, reasons: ['Not enough signals to verify this is the same job'], signals };
}

/** Page is confidently this session’s job (or its application). */
export function isConfidentMatch(m: IdentityMatch): boolean {
  return m.verdict === 'match' || m.verdict === 'compatible';
}

/**
 * Browser left this job’s detail/apply surface — Apply must not be pressed here.
 * Uses the identity matcher so Jobright list/drawer loss counts as left.
 */
export function pageLeftThisJob(
  st: (Pick<PageState, 'url' | 'pageType' | 'jobKey' | 'title' | 'hasApplicationForm' | 'site'> & { company?: string | null }) | null | undefined,
  session: Pick<JobSession, 'jobKey' | 'job'> | null | undefined,
): boolean {
  if (!st || !session || st.hasApplicationForm) return false;
  const m = matchJobIdentity(identityFromSession(session), observedFromPage(st));
  if (m.verdict === 'mismatch') return true;
  if (st.pageType === 'search') return true;
  return false;
}

/** Whether a candidate session may be attached to the current application page. */
export function sessionFitsApplicationPage(
  session: Pick<JobSession, 'job'>,
  st: Pick<PageState, 'url' | 'pageType' | 'jobKey' | 'title' | 'hasApplicationForm' | 'site'> & { company?: string | null },
): boolean {
  const m = matchJobIdentity(identityFromJob(session.job), observedFromPage(st));
  return isConfidentMatch(m);
}
