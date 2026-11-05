/**
 * Makes an Electron session identify itself the way Chrome does: Chrome's reduced user agent, and the
 * Sec-CH-UA headers Electron never sends (see clientHints.ts for why bot checks care).
 */
import { BrowserWindow, session, type Session } from 'electron';
import { ClientHintPolicy, isCloudflareChallenge, normalizeUaMetadata, reducedChromeUserAgent, UA_METADATA_SCRIPT, type UaMetadata } from './clientHints';

/** In memory only. Its https:// is answered locally, so reading the metadata never touches the network. */
const PROBE_PARTITION = 'applyflow-ua-probe';
const PROBE_URL = 'https://ua-probe.applyflow.invalid/';

let metadata: Promise<UaMetadata | null> | null = null;

/** What this Chromium reports to pages in navigator.userAgentData (null if it can't be read). */
export function uaMetadata(): Promise<UaMetadata | null> {
  metadata ??= readMetadata().catch(() => null);
  return metadata;
}

/** userAgentData only exists on secure pages (not about:blank), so serve a blank https page from memory. */
async function readMetadata(): Promise<UaMetadata | null> {
  const ses = session.fromPartition(PROBE_PARTITION);
  if (!ses.protocol.isProtocolHandled('https')) {
    ses.protocol.handle('https', () => new Response('<!doctype html><title>ApplyFlow</title>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  }
  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await withTimeout(win.loadURL(PROBE_URL), 5_000);
    return normalizeUaMetadata(await withTimeout(win.webContents.executeJavaScript(UA_METADATA_SCRIPT), 5_000));
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

export interface PageResponse {
  webContentsId: number | undefined;
  url: string;
  /** Cloudflare answered with a security check ("Just a moment…") instead of the page. */
  challenge: boolean;
}

/**
 * Sets Chrome's user agent and client hints on `ses`. The user agent is set before this returns (it
 * applies only to windows created afterwards). The promise resolves once the client hints are in
 * place; load pages only after that, or the first request goes out without them.
 *
 * `remember` lists high-entropy hints per origin to send from the first request, as Chrome does for a
 * site that asked for them on an earlier visit. `onPageResponse` sees every top-level page response.
 */
export async function presentAsChrome(
  ses: Session,
  opts: { remember?: Record<string, readonly string[]>; onPageResponse?: (r: PageResponse) => void } = {},
): Promise<void> {
  ses.setUserAgent(reducedChromeUserAgent(process.platform, process.versions.chrome));
  const meta = await uaMetadata();
  const policy = meta ? new ClientHintPolicy(meta, opts.remember) : null;
  ses.webRequest.onHeadersReceived({ urls: ['https://*/*'], types: ['mainFrame'] }, (details, callback) => {
    try {
      policy?.noteNavigation(details.url, details.responseHeaders);
      opts.onPageResponse?.({ webContentsId: details.webContentsId, url: details.url, challenge: isCloudflareChallenge(details.responseHeaders) });
    } finally {
      callback({});
    }
  });
  if (!policy) return;
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://*/*'] }, (details, callback) => {
    let requestHeaders = details.requestHeaders;
    try {
      requestHeaders = policy.apply(details);
    } finally {
      callback({ requestHeaders });
    }
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out.')), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}
