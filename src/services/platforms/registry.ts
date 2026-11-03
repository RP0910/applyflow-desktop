import type { JobSiteAdapter } from './types';
import { diceAdapter } from './dice/adapter';
import { jobrightAdapter } from './jobright/adapter';
import { greenhouseAdapter } from './ats/greenhouse';
import { leverAdapter } from './ats/lever';
import { ashbyAdapter } from './ats/ashby';
import { jobviteAdapter } from './ats/jobvite';
import { genericAdapter, siteNameFor } from './ats/generic';

/**
 * Job boards (where jobs are found and read) and employer application systems (where you apply).
 * Order matters: the best-effort adapter for other employer sites matches any https page, so it is last.
 */
export const ADAPTERS: JobSiteAdapter[] = [diceAdapter, jobrightAdapter, greenhouseAdapter, leverAdapter, ashbyAdapter, jobviteAdapter];

export function adapterForUrl(url: string): JobSiteAdapter | null {
  try {
    const u = new URL(url);
    const known = ADAPTERS.find((a) => a.hosts.test(u.hostname));
    if (known) return known;
    return u.protocol === 'https:' ? genericAdapter : null;
  } catch {
    return null;
  }
}

/** "Dice", "Jobright", "Greenhouse"… or a name for the employer's site ("Workday", "careers.acme.com"). */
export function siteName(url: string): string {
  const a = adapterForUrl(url);
  if (!a) return 'this site';
  return a.id === 'generic' ? siteNameFor(url) : a.displayName;
}

/**
 * Which application a page belongs to: the site's job id (Dice job, Greenhouse token, Lever/Ashby posting),
 * else the site's address. A run is tied to the form it opened; a different key is a different application.
 */
export function formKeyFor(url: string): string {
  try {
    const a = adapterForUrl(url);
    return a?.jobKeyForUrl(url) ?? new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}
