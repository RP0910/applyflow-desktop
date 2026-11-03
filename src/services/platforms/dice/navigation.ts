/**
 * Getting back to your Dice job search from a job or an application (built-in browser).
 *
 * Dice's application wizard (/job-applications/<id>/wizard, …/wizard/success) sits on top of the
 * browser history and keeps redirecting to itself after you apply, so the plain Back button can't
 * get out of it. These helpers pick the history entry to return to instead. Pure functions, so the
 * main process and tests share them.
 */

function parse(url: string): URL | null {
  try {
    const u = new URL(url);
    return /(^|\.)dice\.com$/i.test(u.hostname) ? u : null;
  } catch {
    return null;
  }
}

function jobright(url: string): URL | null {
  try {
    const u = new URL(url);
    return /(^|\.)jobright\.ai$/i.test(u.hostname) ? u : null;
  } catch {
    return null;
  }
}

/**
 * A search-results page: Dice /jobs?q=…, /jobs/q-devops-jobs; Jobright /jobs/recommend, /jobs/search?…,
 * /jobs/liked… (never a job's own page).
 */
export function isDiceSearchUrl(url: string): boolean {
  const j = jobright(url);
  if (j) {
    const p = j.pathname.replace(/\/+$/, '');
    return /^\/jobs(\/(?!info\/)[^/]+)?$/i.test(p) && !j.searchParams.get('jobId');
  }
  const u = parse(url);
  if (!u) return false;
  const p = u.pathname.replace(/\/+$/, '') || '/';
  if (/^\/jobs\/(detail|job-detail)\b/i.test(p)) return false;
  return /^\/jobs$/i.test(p) || /^\/jobs\/q-[^/]+/i.test(p);
}

/** Dice's application wizard and its confirmation page, and the employer application sites Jobright leads to. */
export function isDiceApplicationUrl(url: string): boolean {
  const u = parse(url);
  if (u) return /^\/job-applications\//i.test(u.pathname);
  try {
    return /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com)$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Where Back should go. On an application page: the entry just before the application pages
 * (normally the job you applied to). Otherwise one step back. -1 when there is nowhere to go.
 */
export function backTargetIndex(urls: string[], active: number): number {
  if (active <= 0 || active >= urls.length) return -1;
  if (!isDiceApplicationUrl(urls[active]!)) return active - 1;
  let i = active;
  while (i >= 0 && isDiceApplicationUrl(urls[i]!)) i--;
  return i;
}

/** The most recent search-results entry before the current one (-1 when there is none). */
export function searchIndex(urls: string[], active: number): number {
  for (let i = Math.min(active - 1, urls.length - 1); i >= 0; i--) if (isDiceSearchUrl(urls[i]!)) return i;
  return -1;
}

export const DICE_SEARCH_HOME = 'https://www.dice.com/jobs';
