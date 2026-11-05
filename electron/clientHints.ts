/**
 * What a Chromium browser tells websites about itself, and what Electron leaves out.
 *
 * Electron reports itself in JavaScript (navigator.userAgentData) like Chromium does, but it never sends
 * the matching Sec-CH-UA request headers and ignores a site's Accept-CH. Bot checks such as Cloudflare's
 * compare the two, so the page's own answers and the headers disagree and the check never passes.
 * These helpers build the headers Chrome would send, from the values this Chromium gives pages.
 * No Electron imports here, so it can be unit-tested.
 */

export interface UaBrand {
  brand: string;
  version: string;
}

/** navigator.userAgentData plus getHighEntropyValues(), as this Chromium reports them to pages. */
export interface UaMetadata {
  brands: UaBrand[];
  mobile: boolean;
  platform: string;
  architecture: string;
  bitness: string;
  model: string;
  platformVersion: string;
  fullVersionList: UaBrand[];
  uaFullVersion: string;
  wow64: boolean;
  formFactors: string[];
}

/** Runs in a secure page to read UaMetadata. */
export const UA_METADATA_SCRIPT = `(async () => {
  const u = navigator.userAgentData;
  if (!u) return null;
  const high = await u.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'fullVersionList', 'uaFullVersion', 'wow64', 'formFactors']);
  return { brands: u.brands, mobile: u.mobile, platform: u.platform, ...high };
})()`;

/** The high-entropy hints, in the order Chrome adds them after the three default ones. */
export const HIGH_ENTROPY_HINTS = [
  'sec-ch-ua-arch',
  'sec-ch-ua-platform-version',
  'sec-ch-ua-model',
  'sec-ch-ua-full-version',
  'sec-ch-ua-full-version-list',
  'sec-ch-ua-bitness',
  'sec-ch-ua-wow64',
  'sec-ch-ua-form-factors',
] as const;

type HighEntropyHint = (typeof HIGH_ENTROPY_HINTS)[number];
const HIGH_SET = new Set<string>(HIGH_ENTROPY_HINTS);

/**
 * Chrome's user agent string. Since Chrome 110 the version is reduced to MAJOR.0.0.0; a full build
 * number (what Electron reports) is itself a sign the browser isn't Chrome.
 */
export function reducedChromeUserAgent(platform: string, chromeVersion: string): string {
  const major = /^(\d+)/.exec(chromeVersion || '')?.[1] ?? '140';
  const base = `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  if (platform === 'darwin') return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${base}`;
  if (platform === 'linux') return `Mozilla/5.0 (X11; Linux x86_64) ${base}`;
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${base}`;
}

export function normalizeUaMetadata(raw: unknown): UaMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const brands = brandList(r.brands);
  const platform = typeof r.platform === 'string' ? r.platform : '';
  if (!brands.length || !platform) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    brands,
    mobile: r.mobile === true,
    platform,
    architecture: str(r.architecture),
    bitness: str(r.bitness),
    model: str(r.model),
    platformVersion: str(r.platformVersion),
    fullVersionList: brandList(r.fullVersionList),
    uaFullVersion: str(r.uaFullVersion),
    wow64: r.wow64 === true,
    formFactors: Array.isArray(r.formFactors) ? r.formFactors.filter((f): f is string => typeof f === 'string') : [],
  };
}

function brandList(v: unknown): UaBrand[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((b): b is UaBrand => !!b && typeof b === 'object' && typeof (b as UaBrand).brand === 'string' && typeof (b as UaBrand).version === 'string')
    .map((b) => ({ brand: b.brand, version: b.version }));
}

/** A structured-field string: "value" with \ and " escaped. */
function sf(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function brandHeader(brands: UaBrand[]): string {
  return brands.map((b) => `${sf(b.brand)};v=${sf(b.version)}`).join(', ');
}

function highValue(meta: UaMetadata, hint: HighEntropyHint): string | null {
  switch (hint) {
    case 'sec-ch-ua-arch': return sf(meta.architecture);
    case 'sec-ch-ua-platform-version': return sf(meta.platformVersion);
    case 'sec-ch-ua-model': return sf(meta.model);
    case 'sec-ch-ua-full-version': return meta.uaFullVersion ? sf(meta.uaFullVersion) : null;
    case 'sec-ch-ua-full-version-list': return meta.fullVersionList.length ? brandHeader(meta.fullVersionList) : null;
    case 'sec-ch-ua-bitness': return sf(meta.bitness);
    case 'sec-ch-ua-wow64': return meta.wow64 ? '?1' : '?0';
    case 'sec-ch-ua-form-factors': return meta.formFactors.length ? meta.formFactors.map(sf).join(', ') : null;
  }
}

/** The client hint headers for one request: the three Chrome always sends, then any requested high-entropy ones. */
export function hintHeaders(meta: UaMetadata, high: ReadonlySet<string> = new Set()): Array<[string, string]> {
  const out: Array<[string, string]> = [
    ['sec-ch-ua', brandHeader(meta.brands)],
    ['sec-ch-ua-mobile', meta.mobile ? '?1' : '?0'],
    ['sec-ch-ua-platform', sf(meta.platform)],
  ];
  for (const hint of HIGH_ENTROPY_HINTS) {
    if (!high.has(hint)) continue;
    const value = highValue(meta, hint);
    if (value !== null) out.push([hint, value]);
  }
  return out;
}

/** Hint names from an Accept-CH header (case-insensitive); only the UA hints this module can send. */
export function parseAcceptCh(value: string | string[] | undefined): Set<string> {
  const raw = Array.isArray(value) ? value.join(',') : value ?? '';
  const out = new Set<string>();
  for (const token of raw.split(',')) {
    const name = token.trim().toLowerCase();
    if (HIGH_SET.has(name)) out.add(name);
  }
  return out;
}

/** Puts the hints first (where Chrome sends them) unless the request already carries them; other headers keep their order. */
export function withClientHints(requestHeaders: Record<string, string>, hints: Array<[string, string]>): Record<string, string> {
  const present = new Set(Object.keys(requestHeaders).map((k) => k.toLowerCase()));
  const out: Record<string, string> = {};
  for (const [name, value] of hints) if (!present.has(name)) out[name] = value;
  for (const [name, value] of Object.entries(requestHeaders)) out[name] = value;
  return out;
}

function headerValue(headers: Record<string, string[] | string> | undefined, name: string): string[] | undefined {
  if (!headers) return undefined;
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === name) return Array.isArray(v) ? v : [v];
  return undefined;
}

/** True when a response is a Cloudflare challenge page ("Just a moment…"). */
export function isCloudflareChallenge(responseHeaders: Record<string, string[] | string> | undefined): boolean {
  return (headerValue(responseHeaders, 'cf-mitigated') ?? []).some((v) => /challenge/i.test(v));
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * Chrome's client hint rules for one session: the default hints on every secure request, and the
 * high-entropy hints an origin asked for with Accept-CH on its own page loads, for that origin only.
 * `remembered` stands in for hints Chrome would already have stored from an earlier visit.
 */
export class ClientHintPolicy {
  private readonly accepted = new Map<string, Set<string>>();

  constructor(private readonly meta: UaMetadata, remembered: Record<string, readonly string[]> = {}) {
    for (const [origin, hints] of Object.entries(remembered)) {
      const o = originOf(origin);
      if (o) this.accepted.set(o, parseAcceptCh([...hints]));
    }
  }

  /** A top-level page load: its Accept-CH, when present, replaces what that origin asked for. */
  noteNavigation(url: string, responseHeaders: Record<string, string[] | string> | undefined): void {
    const origin = originOf(url);
    const accept = headerValue(responseHeaders, 'accept-ch');
    if (origin && accept) this.accepted.set(origin, parseAcceptCh(accept));
  }

  /** The request headers Chrome would send. */
  apply(req: { url: string; resourceType: string; initiatorOrigin?: string; requestHeaders: Record<string, string> }): Record<string, string> {
    const origin = originOf(req.url);
    if (!origin) return req.requestHeaders;
    const asked = this.accepted.get(origin);
    const sameSite = req.resourceType === 'mainFrame' || req.initiatorOrigin === origin;
    return withClientHints(req.requestHeaders, hintHeaders(this.meta, asked && sameSite ? asked : undefined));
  }
}
