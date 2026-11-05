import { describe, expect, it } from 'vitest';
import {
  browserUserAgent,
  CHALLENGE_LOOP_COUNT,
  isChallengeResponse,
  isChallengeTitle,
  isNavigable,
  isSignInUrl,
  LoopDetector,
  normalizeAddress,
  permissionCheckAllowed,
  permissionRequestAllowed,
  redactUrl,
  webSearch,
} from '../../electron/browserPolicy';

const ELECTRON_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) applyflow/2.2.7 Chrome/156.0.8078.75 Electron/45.2.1 Safari/537.36';

describe('built-in browser policy', () => {
  it('keeps the real Chromium version and drops only the app and Electron tokens', () => {
    expect(browserUserAgent(ELECTRON_UA)).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.75 Safari/537.36');
    expect(browserUserAgent(browserUserAgent(ELECTRON_UA))).toBe(browserUserAgent(ELECTRON_UA));
  });

  it('recognises Cloudflare’s security check by header or title', () => {
    expect(isChallengeResponse({ 'cf-mitigated': ['challenge'] })).toBe(true);
    expect(isChallengeResponse({ 'CF-Mitigated': 'challenge' })).toBe(true);
    expect(isChallengeResponse({ 'content-type': ['text/html'] })).toBe(false);
    expect(isChallengeResponse(undefined)).toBe(false);
    expect(isChallengeTitle('Just a moment...')).toBe(true);
    expect(isChallengeTitle('Claude')).toBe(false);
  });

  it('knows sign-in pages, where ApplyFlow runs nothing of its own', () => {
    expect(isSignInUrl('https://accounts.google.com/o/oauth2/v2/auth?x=1')).toBe(true);
    expect(isSignInUrl('https://www.dice.com/dashboard/login')).toBe(true);
    expect(isSignInUrl('https://jobs.example.com/oauth/callback')).toBe(true);
    expect(isSignInUrl('https://boards.greenhouse.io/acme/jobs/123')).toBe(false);
    expect(isSignInUrl('not a url')).toBe(false);
  });

  it('only lets web tabs open web pages', () => {
    expect(isNavigable('https://example.com/')).toBe(true);
    expect(isNavigable('http://localhost:3000/')).toBe(true);
    expect(isNavigable('about:blank')).toBe(true);
    for (const bad of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'data:text/html,hi', 'chrome://settings', 'app://applyflow/index.html']) expect(isNavigable(bad)).toBe(false);
  });

  it('turns address-bar input into an address or a search', () => {
    expect(normalizeAddress('https://example.com/a?b=1', webSearch)).toBe('https://example.com/a?b=1');
    expect(normalizeAddress('example.com/jobs', webSearch)).toBe('https://example.com/jobs');
    expect(normalizeAddress('localhost:8080', webSearch)).toBe('https://localhost:8080');
    expect(normalizeAddress('senior engineer jobs', webSearch)).toBe('https://www.google.com/search?q=senior%20engineer%20jobs');
    expect(normalizeAddress('javascript:alert(1)', webSearch)).toBe('https://www.google.com/search?q=javascript%3Aalert(1)');
    expect(normalizeAddress('   ', webSearch)).toBeNull();
  });

  it('keeps only origin and path in diagnostics', () => {
    expect(redactUrl('https://claude.ai/new?__cf_chl_tk=SECRET#frag')).toBe('https://claude.ai/new');
    expect(redactUrl('https://accounts.google.com/o/oauth2/auth?code=abc&state=xyz')).toBe('https://accounts.google.com/o/oauth2/auth');
    expect(redactUrl('about:blank')).toBe('about:blank');
    expect(redactUrl('data:text/html,<secret>')).toBe('data:…');
    expect(redactUrl('???')).toBe('(not a URL)');
    expect(redactUrl(`https://x.com/${'a'.repeat(200)}`).length).toBeLessThan(120);
  });

  it('allows only what websites need, and says no to sensitive permissions', () => {
    for (const p of ['clipboard-sanitized-write', 'fullscreen', 'storage-access']) expect(permissionRequestAllowed(p)).toBe(true);
    for (const p of ['media', 'geolocation', 'notifications', 'midiSysex', 'usb', 'hid', 'serial', 'clipboard-read', 'idle-detection']) expect(permissionRequestAllowed(p)).toBe(false);
    expect(permissionRequestAllowed('openExternal', 'mailto:recruiter@example.com')).toBe(true);
    expect(permissionRequestAllowed('openExternal', 'ms-settings:privacy')).toBe(false);
    expect(permissionCheckAllowed('notifications')).toBe(false);
    expect(permissionCheckAllowed('media')).toBe(false);
    expect(permissionCheckAllowed('clipboard-sanitized-write')).toBe(true);
  });

  it('notices a security check that keeps coming back within the window, and forgets old ones', () => {
    const d = new LoopDetector(60_000);
    expect(d.note('tab', 0)).toBe(1);
    expect(d.note('tab', 10_000)).toBe(2);
    expect(d.note('tab', 20_000)).toBe(CHALLENGE_LOOP_COUNT);
    expect(d.count('tab', 75_000)).toBe(1);
    d.reset('tab');
    expect(d.count('tab', 75_000)).toBe(0);
  });
});
