const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function diceJobIdFromUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/(^|\.)dice\.com$/i.test(url.hostname)) return null;
  const path = url.pathname;
  let m = path.match(/\/job-detail\/([^/?#]+)/i);
  if (m) return m[1]!.toLowerCase();
  m = path.match(/\/job-applications\/([^/?#]+)/i);
  if (m) return m[1]!.toLowerCase();
  m = path.match(/\/jobs\/detail\/[^/]+\/[^/]+\/([^/?#]+)/i);
  if (m) return m[1]!.toLowerCase();
  const uuid = path.match(UUID);
  return uuid ? uuid[0].toLowerCase() : null;
}

export function normalizeJobUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    const keep = new URLSearchParams();
    url.search = keep.toString();
    url.hostname = url.hostname.toLowerCase().replace(/^dice\.com$/, 'www.dice.com');
    return url.toString().replace(/\/$/, '');
  } catch {
    return rawUrl.trim();
  }
}

export function jobKeyFor(url: string, explicitId?: string | null): string {
  const id = explicitId || diceJobIdFromUrl(url);
  return id ? `dice:${id.toLowerCase()}` : `url:${normalizeJobUrl(url)}`;
}
