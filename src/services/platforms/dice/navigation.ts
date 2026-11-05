
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

export function isDiceApplicationUrl(url: string): boolean {
  const u = parse(url);
  if (u) return /^\/job-applications\//i.test(u.pathname);
  try {
    return /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com)$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function backTargetIndex(urls: string[], active: number): number {
  if (active <= 0 || active >= urls.length) return -1;
  if (!isDiceApplicationUrl(urls[active]!)) return active - 1;
  let i = active;
  while (i >= 0 && isDiceApplicationUrl(urls[i]!)) i--;
  return i;
}

export function searchIndex(urls: string[], active: number): number {
  for (let i = Math.min(active - 1, urls.length - 1); i >= 0; i--) if (isDiceSearchUrl(urls[i]!)) return i;
  return -1;
}

export const DICE_SEARCH_HOME = 'https://www.dice.com/jobs';
