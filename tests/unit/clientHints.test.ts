import { describe, expect, it } from 'vitest';
import {
  ClientHintPolicy,
  HIGH_ENTROPY_HINTS,
  hintHeaders,
  isCloudflareChallenge,
  normalizeUaMetadata,
  parseAcceptCh,
  reducedChromeUserAgent,
  withClientHints,
  type UaMetadata,
} from '../../electron/clientHints';

// What Electron 45 (Chromium 156) on Windows 11 reports in navigator.userAgentData.
const RAW = {
  brands: [{ brand: 'Not:A-Brand', version: '8' }, { brand: 'Chromium', version: '156' }],
  mobile: false,
  platform: 'Windows',
  architecture: 'x86',
  bitness: '64',
  formFactors: ['Desktop'],
  fullVersionList: [{ brand: 'Not:A-Brand', version: '8.0.0.0' }, { brand: 'Chromium', version: '156.0.8078.75' }],
  model: '',
  platformVersion: '19.0.0',
  uaFullVersion: '156.0.8078.75',
  wow64: false,
};
const META = normalizeUaMetadata(RAW) as UaMetadata;

describe('Chrome identity for the Claude.ai session', () => {
  it('reduces the user agent to MAJOR.0.0.0 like Chrome, with no Electron token', () => {
    const ua = reducedChromeUserAgent('win32', '156.0.8078.75');
    expect(ua).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36');
    expect(reducedChromeUserAgent('darwin', '156.0.8078.75')).toContain('(Macintosh; Intel Mac OS X 10_15_7)');
    expect(reducedChromeUserAgent('linux', '156.0.8078.75')).toContain('(X11; Linux x86_64)');
    expect(ua).not.toMatch(/Electron|8078/);
  });

  it('reads userAgentData and rejects anything without brands or platform', () => {
    expect(META.brands).toHaveLength(2);
    expect(META.platformVersion).toBe('19.0.0');
    expect(normalizeUaMetadata(null)).toBeNull();
    expect(normalizeUaMetadata({ brands: [], platform: 'Windows' })).toBeNull();
    expect(normalizeUaMetadata({ brands: RAW.brands, platform: '' })).toBeNull();
  });

  it('sends the three default hints with exactly what the page sees in JavaScript', () => {
    expect(hintHeaders(META)).toEqual([
      ['sec-ch-ua', '"Not:A-Brand";v="8", "Chromium";v="156"'],
      ['sec-ch-ua-mobile', '?0'],
      ['sec-ch-ua-platform', '"Windows"'],
    ]);
  });

  it('adds requested high-entropy hints in a fixed order', () => {
    const all = new Map(hintHeaders(META, new Set(HIGH_ENTROPY_HINTS)));
    expect(all.get('sec-ch-ua-arch')).toBe('"x86"');
    expect(all.get('sec-ch-ua-bitness')).toBe('"64"');
    expect(all.get('sec-ch-ua-model')).toBe('""');
    expect(all.get('sec-ch-ua-platform-version')).toBe('"19.0.0"');
    expect(all.get('sec-ch-ua-full-version')).toBe('"156.0.8078.75"');
    expect(all.get('sec-ch-ua-full-version-list')).toBe('"Not:A-Brand";v="8.0.0.0", "Chromium";v="156.0.8078.75"');
    expect(all.get('sec-ch-ua-wow64')).toBe('?0');
    expect(all.get('sec-ch-ua-form-factors')).toBe('"Desktop"');
    expect([...all.keys()].slice(0, 3)).toEqual(['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform']);
  });

  it('escapes quotes and backslashes in brand names', () => {
    const odd = { ...META, brands: [{ brand: 'A "quoted" \\ brand', version: '1' }] };
    expect(hintHeaders(odd)[0]![1]).toBe('"A \\"quoted\\" \\\\ brand";v="1"');
  });

  it('parses Accept-CH case-insensitively and ignores hints it cannot send', () => {
    expect([...parseAcceptCh('Sec-CH-UA-Arch, sec-ch-ua-bitness,DPR, UA-Model')]).toEqual(['sec-ch-ua-arch', 'sec-ch-ua-bitness']);
    expect([...parseAcceptCh(['Sec-CH-UA-Model', 'Sec-CH-UA-WoW64'])]).toEqual(['sec-ch-ua-model', 'sec-ch-ua-wow64']);
    expect(parseAcceptCh(undefined).size).toBe(0);
  });

  it('puts the hints first and never duplicates one the request already has', () => {
    const out = withClientHints({ 'Upgrade-Insecure-Requests': '1', 'User-Agent': 'x', 'Sec-CH-UA-Mobile': '?1' }, hintHeaders(META));
    expect(Object.keys(out)).toEqual(['sec-ch-ua', 'sec-ch-ua-platform', 'Upgrade-Insecure-Requests', 'User-Agent', 'Sec-CH-UA-Mobile']);
    expect(out['Sec-CH-UA-Mobile']).toBe('?1');
  });

  it('recognises a Cloudflare challenge response by its cf-mitigated header', () => {
    expect(isCloudflareChallenge({ 'cf-mitigated': ['challenge'] })).toBe(true);
    expect(isCloudflareChallenge({ 'CF-Mitigated': 'challenge' })).toBe(true);
    expect(isCloudflareChallenge({ 'content-type': ['text/html'] })).toBe(false);
    expect(isCloudflareChallenge(undefined)).toBe(false);
  });
});

describe('ClientHintPolicy', () => {
  const req = (url: string, resourceType = 'mainFrame', initiatorOrigin?: string) => ({ url, resourceType, initiatorOrigin, requestHeaders: { 'User-Agent': 'x' } });

  it('sends only the default hints until a site asks for more', () => {
    const policy = new ClientHintPolicy(META);
    const out = policy.apply(req('https://example.com/'));
    expect(Object.keys(out)).toEqual(['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'User-Agent']);
  });

  it('remembers Accept-CH from a page load and sends those hints to that origin only', () => {
    const policy = new ClientHintPolicy(META);
    policy.noteNavigation('https://example.com/a', { 'Accept-CH': ['Sec-CH-UA-Arch, Sec-CH-UA-Platform-Version'] });
    const nav = policy.apply(req('https://example.com/b'));
    expect(nav['sec-ch-ua-arch']).toBe('"x86"');
    expect(nav['sec-ch-ua-platform-version']).toBe('"19.0.0"');
    // Same-origin requests from that site's page get them too; other sites and third-party requests don't.
    expect(policy.apply(req('https://example.com/api', 'xhr', 'https://example.com'))['sec-ch-ua-arch']).toBe('"x86"');
    expect(policy.apply(req('https://example.com/api', 'xhr', 'https://other.com'))['sec-ch-ua-arch']).toBeUndefined();
    expect(policy.apply(req('https://other.com/'))['sec-ch-ua-arch']).toBeUndefined();
    // A later Accept-CH replaces the earlier one.
    policy.noteNavigation('https://example.com/c', { 'accept-ch': ['Sec-CH-UA-Bitness'] });
    const after = policy.apply(req('https://example.com/d'));
    expect(after['sec-ch-ua-bitness']).toBe('"64"');
    expect(after['sec-ch-ua-arch']).toBeUndefined();
  });

  it('sends remembered hints from the very first request (claude.ai)', () => {
    const policy = new ClientHintPolicy(META, { 'https://claude.ai/': HIGH_ENTROPY_HINTS });
    const first = policy.apply(req('https://claude.ai/new'));
    for (const hint of HIGH_ENTROPY_HINTS) expect(first[hint]).toBeDefined();
    expect(policy.apply(req('https://challenges.cloudflare.com/x', 'subFrame', 'https://claude.ai'))['sec-ch-ua-arch']).toBeUndefined();
  });

  it('leaves plain-http and unparsable URLs alone', () => {
    const policy = new ClientHintPolicy(META);
    expect(policy.apply(req('http://example.com/'))).toEqual({ 'User-Agent': 'x' });
    expect(policy.apply(req('not a url'))).toEqual({ 'User-Agent': 'x' });
  });
});
