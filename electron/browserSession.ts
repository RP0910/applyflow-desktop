import { app, session as electronSession, type Session } from 'electron';
import type { BrowserDiagnosticEvent as DiagnosticEvent, BrowserDiagnosticsReport as DiagnosticsReport, BrowserPartitionReport as PartitionReport } from '../src/platform/bridge';
import {
  isChallengeResponse,
  isChallengeTitle,
  LoopDetector,
  permissionCheckAllowed,
  permissionRequestAllowed,
  redactUrl,
} from './browserPolicy';

const MAX_EVENTS = 300;

export class BrowserDiagnostics {
  private readonly list: DiagnosticEvent[] = [];

  record(e: Omit<DiagnosticEvent, 'at'>): void {
    this.list.push({ ...e, at: new Date().toISOString(), url: e.url ? redactUrl(e.url) : undefined });
    if (this.list.length > MAX_EVENTS) this.list.splice(0, this.list.length - MAX_EVENTS);
  }

  events(): DiagnosticEvent[] {
    return this.list.slice();
  }

  async report(monitors: Iterable<SessionMonitor>): Promise<DiagnosticsReport> {
    const partitions: PartitionReport[] = [];
    for (const m of monitors) partitions.push(await m.storageReport());
    return {
      electron: process.versions.electron ?? '',
      chromium: process.versions.chrome ?? '',
      userAgent: app.userAgentFallback,
      partitions,
      events: this.events(),
    };
  }
}

export interface PageResponse {
  webContentsId: number | undefined;
  url: string;
  status: number;
  resourceType: string;
  challenge: boolean;
}

export class SessionMonitor {
  readonly session: Session;
  private readonly challenged = new Set<number>();
  private readonly listeners = new Set<(r: PageResponse) => void>();

  constructor(readonly partition: string, readonly diagnostics: BrowserDiagnostics) {
    const ses = electronSession.fromPartition(partition);
    this.session = ses;
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      const allowed = permissionRequestAllowed(permission, (details as { externalURL?: string }).externalURL);
      if (!allowed) this.diagnostics.record({ partition, source: 'permissions', kind: 'permission-denied', url: safeUrl(wc), detail: permission });
      callback(allowed);
    });
    ses.setPermissionCheckHandler((_wc, permission) => permissionCheckAllowed(permission));
    ses.webRequest.onResponseStarted({ urls: ['https://*/*', 'http://*/*'], types: ['mainFrame', 'subFrame'] }, (d) => {
      this.noteResponse({ webContentsId: d.webContentsId, url: d.url, status: d.statusCode, resourceType: d.resourceType, challenge: isChallengeResponse(d.responseHeaders) });
    });
    ses.webRequest.onErrorOccurred({ urls: ['https://*/*', 'http://*/*'] }, (d) => {
      if (/ERR_ABORTED|ERR_BLOCKED_BY_CLIENT/.test(d.error)) return;
      const fromCheck = /(^|\.)challenges\.cloudflare\.com$/i.test(hostOf(d.url)) || /\/cdn-cgi\/challenge-platform\//.test(d.url);
      if (d.resourceType !== 'mainFrame' && d.resourceType !== 'subFrame' && !fromCheck) return;
      this.diagnostics.record({ partition, source: fromCheck ? 'security check' : 'page', kind: 'resource-error', url: d.url, detail: `${d.resourceType}: ${d.error}` });
    });
  }

  onPageResponse(cb: (r: PageResponse) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  noteResponse(res: PageResponse): void {
    if (res.resourceType === 'mainFrame' && res.webContentsId !== undefined) {
      if (res.challenge) this.challenged.add(res.webContentsId);
      else this.challenged.delete(res.webContentsId);
    }
    if (res.resourceType === 'mainFrame') {
      if (res.challenge) this.diagnostics.record({ partition: this.partition, source: 'page', kind: 'challenge', url: res.url, status: res.status });
      else if ((res.status ?? 0) >= 400) this.diagnostics.record({ partition: this.partition, source: 'page', kind: 'http-error', url: res.url, status: res.status });
    }
    for (const cb of this.listeners) {
      try {
        cb(res);
      } catch {
      }
    }
  }

  onChallengePage(wc: { id: number; isDestroyed(): boolean; getTitle(): string }): boolean {
    try {
      if (wc.isDestroyed()) return false;
      return this.challenged.has(wc.id) || isChallengeTitle(wc.getTitle());
    } catch {
      return false;
    }
  }

  async storageReport(): Promise<PartitionReport> {
    let cookies: Electron.Cookie[] = [];
    try {
      cookies = await this.session.cookies.get({});
    } catch {
      cookies = [];
    }
    const site = (c: Electron.Cookie) => (c.domain ?? '').replace(/^\./, '');
    return {
      partition: this.partition,
      persistent: this.session.isPersistent(),
      cookies: cookies.length,
      sites: new Set(cookies.map(site)).size,
      clearanceSites: [...new Set(cookies.filter((c) => c.name === 'cf_clearance').map(site))].sort(),
    };
  }

  async reset(): Promise<void> {
    await this.session.clearStorageData();
    await this.session.clearCache();
    this.challenged.clear();
    this.diagnostics.record({ partition: this.partition, source: 'settings', kind: 'session-reset' });
  }
}

const monitors = new Map<string, SessionMonitor>();

export function monitorSession(partition: string, diagnostics: BrowserDiagnostics): SessionMonitor {
  let m = monitors.get(partition);
  if (!m) {
    m = new SessionMonitor(partition, diagnostics);
    monitors.set(partition, m);
  }
  return m;
}

export function allMonitors(): SessionMonitor[] {
  return [...monitors.values()];
}

export function watchContents(wc: { on(event: string, listener: (...args: any[]) => void): unknown; isDestroyed(): boolean; getURL(): string }, source: () => string, monitor: SessionMonitor): void {
  const d = monitor.diagnostics;
  const partition = monitor.partition;
  const reloads = new LoopDetector(60_000);
  let redirects = 0;
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) redirects = 0;
  });
  wc.on('did-redirect-navigation', (details) => {
    if (!details.isMainFrame) return;
    redirects += 1;
    if (redirects === 10) d.record({ partition, source: source(), kind: 'redirect-loop', url: details.url, detail: '10 redirects in one page load' });
  });
  wc.on('did-navigate', (_e, url) => {
    if (reloads.note(redactUrl(url)) === 6) d.record({ partition, source: source(), kind: 'navigation-loop', url, detail: 'Opened 6 times within a minute' });
  });
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    d.record({ partition, source: source(), kind: 'navigation-error', url, code, detail: description });
  });
  wc.on('render-process-gone', (_e, details) => {
    d.record({ partition, source: source(), kind: 'renderer-gone', url: safeUrl(wc), detail: `${details.reason} (exit code ${details.exitCode})` });
  });
  wc.on('unresponsive', () => {
    d.record({ partition, source: source(), kind: 'unresponsive', url: safeUrl(wc) });
  });
}

function safeUrl(wc: { isDestroyed(): boolean; getURL(): string } | null): string {
  try {
    return wc && !wc.isDestroyed() ? wc.getURL() : '';
  } catch {
    return '';
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
