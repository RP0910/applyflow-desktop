import { hostOf } from './ats/common';

/**
 * Job-board listing / syndication hosts. Schema.org JobPosting.url often points here
 * when the same posting is mirrored on LinkedIn/Indeed — that is NOT the employer apply form.
 */
const SYNDICATION: { host: RegExp; name: string }[] = [
  { host: /(^|\.)linkedin\.com$/i, name: 'LinkedIn' },
  { host: /(^|\.)indeed\.com$/i, name: 'Indeed' },
  { host: /(^|\.)glassdoor\.com$/i, name: 'Glassdoor' },
  { host: /(^|\.)ziprecruiter\.com$/i, name: 'ZipRecruiter' },
  { host: /(^|\.)simplyhired\.com$/i, name: 'SimplyHired' },
  { host: /(^|\.)monster\.com$/i, name: 'Monster' },
  { host: /(^|\.)careerbuilder\.com$/i, name: 'CareerBuilder' },
];

/** Known employer ATS / career-site patterns that are safe direct-navigate targets. */
const ATS_HINT: RegExp[] = [
  /(^|\.)greenhouse\.io$/i,
  /(^|\.)lever\.co$/i,
  /(^|\.)ashbyhq\.com$/i,
  /myworkdayjobs\.com$/i,
  /myworkdaysite\.com$/i,
  /(^|\.)workday\.com$/i,
  /(^|\.)icims\.com$/i,
  /(^|\.)smartrecruiters\.com$/i,
  /(^|\.)workable\.com$/i,
  /(^|\.)bamboohr\.com$/i,
  /(^|\.)jobvite\.com$/i,
  /(^|\.)taleo\.net$/i,
  /oraclecloud\.com$/i,
  /successfactors\.(com|eu)$/i,
  /(^|\.)recruitee\.com$/i,
  /(^|\.)breezy\.hr$/i,
  /(^|\.)jazzhr\.com$/i,
  /(^|\.)applytojob\.com$/i,
  /(^|\.)rippling\.com$/i,
  /(^|\.)dover\.(com|io)$/i,
  /(^|\.)jobright\.ai$/i,
  /(^|\.)dice\.com$/i,
];

export function syndicationBoardName(url: string): string | null {
  const h = hostOf(url);
  return SYNDICATION.find((s) => s.host.test(h))?.name ?? null;
}

export function isJobBoardSyndicationUrl(url: string): boolean {
  return Boolean(syndicationBoardName(url));
}

export function isKnownAtsApplyHost(url: string): boolean {
  const h = hostOf(url);
  return ATS_HINT.some((re) => re.test(h));
}

/**
 * Rank a candidate employer-apply URL. Higher is better.
 * Prefer known ATS hosts; demote job-board syndication mirrors (LinkedIn/Indeed/…).
 */
export function applyUrlScore(url: string | null | undefined): number {
  if (!url || !/^https?:\/\//i.test(url)) return -1;
  if (isJobBoardSyndicationUrl(url)) return 1;
  if (isKnownAtsApplyHost(url)) return 100;
  // Company career site or unknown HTTPS employer host.
  return 50;
}

/**
 * Pick the best employer application URL from candidates (first among equal scores wins).
 * Use this so Jobright’s applyLink beats a LinkedIn JobPosting.url from JSON-LD.
 */
export function pickEmployerApplyUrl(...candidates: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = applyUrlScore(c);
    if (s > bestScore && c) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

/** True when navigating here as a “direct” Jobright fallback is unsafe (syndication mirror). */
export function shouldAvoidDirectNavigate(url: string | null | undefined, preferred?: string | null): boolean {
  if (!url) return true;
  if (!isJobBoardSyndicationUrl(url)) return false;
  // Only allow navigating to LinkedIn/Indeed when that is the preferred/only apply destination.
  if (preferred && !isJobBoardSyndicationUrl(preferred) && applyUrlScore(preferred) > applyUrlScore(url)) return true;
  if (preferred && isJobBoardSyndicationUrl(preferred) && hostOf(preferred) === hostOf(url)) return false;
  // No better preferred URL — still avoid authwall-style boards when we can click Apply instead.
  return true;
}

/**
 * After navigation: did we land on a syndication board while the session expected a real employer apply URL?
 */
export function unexpectedSyndicationDestination(actualUrl: string, expectedApplyUrl: string | null | undefined): boolean {
  if (!expectedApplyUrl || isJobBoardSyndicationUrl(expectedApplyUrl)) return false;
  return isJobBoardSyndicationUrl(actualUrl);
}
