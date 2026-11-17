
export function browserUserAgent(electronDefault: string): string {
  return electronDefault.replace(/\s(?:Electron|applyflow)\/\S+/gi, '').replace(/\s{2,}/g, ' ').trim();
}

export function isChallengeResponse(headers: Record<string, string[] | string> | undefined): boolean {
  if (!headers) return false;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== 'cf-mitigated') continue;
    return (Array.isArray(v) ? v : [v]).some((x) => /challenge/i.test(x));
  }
  return false;
}

export function isChallengeTitle(title: string): boolean {
  return /^just a moment/i.test(title.trim());
}

export function isSignInUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (/(^|\.)(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com)$/i.test(u.hostname)) return true;
    return /\/(login|signin|sign-in|sign_in|logout|oauth2?|sso|saml|magic-link|authorize)(\/|$)/i.test(u.pathname);
  } catch {
    return false;
  }
}

export function isNavigable(url: string): boolean {
  if (/^about:blank$/i.test(url)) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function normalizeAddress(input: string, search: (query: string) => string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v) || /^about:blank$/i.test(v)) return isNavigable(v) ? v : null;
  const domainLike = !/\s/.test(v) && (/^localhost(:\d+)?(\/|$)/i.test(v) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(v)) && !/^[\w-]+:\/\//.test(v);
  if (domainLike) {
    const url = `https://${v}`;
    return isNavigable(url) ? url : null;
  }
  return search(v);
}

export const webSearch = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

export function redactUrl(url: string): string {
  if (/^about:/i.test(url)) return url.slice(0, 40);
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return `${u.protocol}…`;
    const path = u.pathname.length > 80 ? `${u.pathname.slice(0, 80)}…` : u.pathname;
    return `${u.origin}${path}`;
  } catch {
    return '(not a URL)';
  }
}

const ALLOWED_REQUESTS = new Set([
  'clipboard-sanitized-write',
  'fullscreen',
  'pointerLock',
  'storage-access',
  'top-level-storage-access',
  'persistent-storage',
  'mediaKeySystem',
]);

const DENIED_CHECKS = new Set([
  'media',
  'geolocation',
  'notifications',
  'midi',
  'midiSysex',
  'hid',
  'serial',
  'usb',
  'idle-detection',
  'clipboard-read',
  'display-capture',
  'keyboardLock',
  'speaker-selection',
  'window-management',
]);

function externalAllowed(externalUrl: string | undefined): boolean {
  return /^(mailto|tel):/i.test(externalUrl ?? '');
}

export function permissionRequestAllowed(permission: string, externalUrl?: string): boolean {
  if (permission === 'openExternal') return externalAllowed(externalUrl);
  return ALLOWED_REQUESTS.has(permission);
}

export function permissionCheckAllowed(permission: string): boolean {
  return !DENIED_CHECKS.has(permission);
}

export class LoopDetector {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly windowMs: number) {}

  note(key: string, now = Date.now()): number {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    list.push(now);
    this.hits.set(key, list);
    return list.length;
  }

  count(key: string, now = Date.now()): number {
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs).length;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

export const CHALLENGE_LOOP_COUNT = 3;
export const CHALLENGE_LOOP_WINDOW_MS = 3 * 60_000;
export const CHALLENGE_STUCK_MS = 60_000;
