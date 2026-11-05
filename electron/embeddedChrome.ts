import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { screen, type BrowserWindow } from 'electron';
import type { BrowserSurface, PaneBounds } from './browserSurface';
import { CdpClient, type CdpEvent } from './cdpClient';
import { findChromeExecutable } from './chromePath';
import { isChallengeResponse, isNavigable } from './browserPolicy';
import { DiceInput } from './diceInput';
import type { PageResponse } from './browserSession';
import type { PageController, WindowOpenDetails } from './pageController';
import { embedPixels, Win32Embed } from './win32Embed';

const WORLD = 'applyflow';
const OAUTH_HOSTS = /accounts\.google\.com|appleid\.apple\.com|linkedin\.com\/oauth|login\.microsoftonline\.com|facebook\.com\/(v\d|dialog)/i;

const HOST_PRELUDE = `(() => {
  if (globalThis.__afHost) return;
  const listeners = [];
  const pending = new Map();
  const callHost = (payload) => { if (typeof afHost === 'function') afHost(JSON.stringify(payload)); };
  globalThis.__afReply = (id, body) => {
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    if (body && body.error) waiter.reject(new Error(body.error));
    else waiter.resolve(body ? body.result : undefined);
  };
  globalThis.__afDeliver = (channel, payload) => {
    for (const listener of listeners) if (listener.channel === channel) listener.cb(null, payload);
  };
  let next = 0;
  globalThis.__afHost = {
    invoke(channel, req) {
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        callHost({ kind: 'invoke', id, channel, req });
      });
    },
    send(channel, payload) { callHost({ kind: 'send', channel, payload }); },
    on(channel, cb) { listeners.push({ channel, cb }); },
  };
})();`;

interface HistoryEntry {
  id: number;
  url: string;
}

type Role = 'jobs' | 'web';

export interface EmbeddedChrome {
  jobs: PageController;
  jobsSurface: BrowserSurface;
  openWeb(url: string | null): BrowserSurface;
  setShown(shown: boolean): void;
  reset(): Promise<void>;
  cookieSummary(): Promise<{ cookies: number; sites: number; clearance: string[] }>;
  close(): void;
}

export async function launchEmbeddedChrome(opts: {
  userDataDir: string;
  parent: () => BrowserWindow | null;
  helperSource: string;
  onJobsEvent: (evt: unknown) => void;
  onJobsResponse: (body: { id: number; result?: unknown; error?: string }) => void;
  onJobsTrusted: (req: unknown) => Promise<unknown>;
  onPageResponse: (res: PageResponse) => void;
}): Promise<EmbeddedChrome> {
  if (process.platform !== 'win32') throw new Error('Embedded Chrome is available on Windows.');
  const exe = findChromeExecutable();
  if (!exe) throw new Error('Google Chrome is not installed. Install Chrome, then restart ApplyFlow.');
  mkdirSync(opts.userDataDir, { recursive: true });
  const port = await freePort();
  const child = spawn(exe, [
    `--user-data-dir=${opts.userDataDir}`,
    `--remote-debugging-port=${port}`,
    `--remote-allow-origins=http://127.0.0.1:${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-features=Translate,CalculateNativeWinOcclusion',
    '--app=about:blank',
    '--window-position=-32000,-32000',
    '--window-size=1100,800',
  ], { stdio: 'ignore', windowsHide: false });
  const win32 = await Win32Embed.start();
  let cdp: CdpClient;
  try {
    const versionUrl = await waitForChrome(port, child);
    cdp = await CdpClient.connect(versionUrl);
  } catch (error) {
    win32.close();
    killChrome(child);
    throw error;
  }
  const host = new ChromeHost(opts, child, cdp, win32, port);
    try {
      await host.start();
    } catch (error) {
      host.close();
      throw error;
    }
    return host;
}

class ChromeHost {
  readonly jobs: ChromePage;
  readonly jobsSurface: BrowserSurface;
  private readonly pages = new Map<string, ChromePage>();
  private readonly claimed = new Set<string>();
  private slot = 0;
  private shown = true;
  private readonly stopEvents: () => void;

  constructor(
    private readonly opts: Parameters<typeof launchEmbeddedChrome>[0],
    private readonly child: ChildProcess,
    private readonly cdp: CdpClient,
    private readonly win32: Win32Embed,
    private readonly debugPort: number,
  ) {
    this.jobs = new ChromePage(this, 'jobs');
    this.jobsSurface = this.jobs.surface();
    this.stopEvents = cdp.onEvent((event) => this.onEvent(event));
  }

  async start(): Promise<void> {
    await this.cdp.send('Target.setDiscoverTargets', { discover: true });
    const list = await (await fetch(`http://127.0.0.1:${this.debugPort}/json/list`)).json() as { id: string; type: string }[];
    const first = list.find((t) => t.type === 'page');
    if (!first) throw new Error('Chrome did not open a window.');
    await this.attach(this.jobs, first.id, true);
    const win = this.opts.parent();
    const hide = () => this.setShown(false);
    const show = () => this.setShown(true);
    win?.on('hide', hide);
    win?.on('show', show);
    win?.on('minimize', hide);
    win?.on('restore', show);
  }

  openWeb(url: string | null): BrowserSurface {
    const page = new ChromePage(this, 'web');
    const surface = page.surface();
    void this.createWindow(page, url && isNavigable(url) ? url : 'about:blank').catch(() => page.fail(-2, 'Could not open the tab.', url ?? ''));
    return surface;
  }

  setShown(shown: boolean): void {
    this.shown = shown;
    for (const page of this.pages.values()) void page.apply();
  }

  async reset(): Promise<void> {
    try {
      const got = await this.cdp.send<{ cookies?: { domain?: string }[] }>('Network.getAllCookies');
      await this.cdp.send('Network.clearBrowserCookies');
      const origins = new Set<string>();
      for (const cookie of got.cookies ?? []) {
        const host = (cookie.domain ?? '').replace(/^\./, '');
        if (host) origins.add(`https://${host}`);
      }
      for (const origin of origins) await this.cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }).catch(() => undefined);
    } catch {
    }
  }

  async cookieSummary(): Promise<{ cookies: number; sites: number; clearance: string[] }> {
    await this.cdp.send('Network.enable').catch(() => undefined);
    const got = await this.cdp.send<{ cookies?: { name?: string; domain?: string }[] }>('Network.getAllCookies');
    const cookies = got.cookies ?? [];
    const site = (domain: string) => domain.replace(/^\./, '');
    const clearance = [...new Set(cookies.filter((cookie) => cookie.name === 'cf_clearance').map((cookie) => site(cookie.domain ?? '')))].filter(Boolean).sort();
    return { cookies: cookies.length, sites: new Set(cookies.map((cookie) => site(cookie.domain ?? '')).filter(Boolean)).size, clearance };
  }

  private closed = false;

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopEvents();
    this.cdp.close();
    this.win32.close();
    killChrome(this.child);
  }

  send<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T> {
    return this.cdp.send<T>(method, params, sessionId);
  }

  isShown(): boolean {
    return this.shown;
  }

  parent(): BrowserWindow | null {
    return this.opts.parent();
  }

  win32Embed(): Win32Embed {
    return this.win32;
  }

  jobsCallbacks(): Pick<Parameters<typeof launchEmbeddedChrome>[0], 'onJobsEvent' | 'onJobsResponse' | 'onJobsTrusted' | 'onPageResponse' | 'helperSource'> {
    return this.opts;
  }

  private async createWindow(page: ChromePage, url: string): Promise<void> {
    const created = await this.cdp.send<{ targetId: string }>('Target.createTarget', { url, newWindow: true, background: true, width: 1100, height: 800 });
    await this.attach(page, created.targetId, false);
  }

  private async attach(page: ChromePage, targetId: string, helper: boolean): Promise<void> {
    const { sessionId } = await this.cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    page.attached(targetId, sessionId);
    this.pages.set(targetId, page);
    await this.send('Page.enable', {}, sessionId);
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Network.enable', {}, sessionId);
    await this.send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId).catch(() => undefined);
    if (helper && this.opts.helperSource) {
      const source = `${HOST_PRELUDE}\n${this.opts.helperSource}`;
      try {
        await this.send('Runtime.addBinding', { name: 'afHost', executionContextName: WORLD }, sessionId);
      } catch {
        await this.send('Runtime.addBinding', { name: 'afHost' }, sessionId);
      }
      try {
        await this.send('Page.addScriptToEvaluateOnNewDocument', { source, worldName: WORLD, runImmediately: true }, sessionId);
      } catch {
        await this.send('Page.addScriptToEvaluateOnNewDocument', { source, worldName: WORLD }, sessionId).catch(() =>
          this.send('Page.addScriptToEvaluateOnNewDocument', { source }, sessionId));
      }
    }
    const hwnd = await this.claimWindow(targetId);
    if (hwnd) {
      page.hwnd = hwnd;
      const parent = this.parentHandle();
      if (parent) await this.win32.embed(hwnd, parent).catch(() => undefined);
      await page.apply();
    }
    void page.refreshHistory();
  }

  private parentHandle(): bigint | null {
    const win = this.opts.parent();
    if (!win || win.isDestroyed()) return null;
    const buf = win.getNativeWindowHandle();
    return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
  }

  private async claimWindow(targetId: string): Promise<bigint | null> {
    const pid = this.child.pid;
    if (!pid) return null;
    const slot = -30000 - this.slot++ * 80;
    const scale = this.scale();
    try {
      const { windowId } = await this.cdp.send<{ windowId: number }>('Browser.getWindowForTarget', { targetId });
      await this.cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: slot, top: -30000, width: 1100, height: 800, windowState: 'normal' } });
    } catch {
      return null;
    }
    const expected = Math.round(slot * scale);
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline) {
      const rows = await this.win32.find(pid).catch(() => []);
      const fresh = rows.filter((row) => !this.claimed.has(row.hwnd.toString()) && row.left < -5000);
      const hit = fresh.find((row) => Math.abs(row.left - slot) < 400 || Math.abs(row.left - expected) < 400) ?? (fresh.length === 1 ? fresh[0] : undefined);
      if (hit) {
        this.claimed.add(hit.hwnd.toString());
        return hit.hwnd;
      }
      await delay(100);
    }
    return null;
  }

  private scale(): number {
    const win = this.opts.parent();
    if (!win || win.isDestroyed()) return 1;
    return screen.getDisplayMatching(win.getBounds()).scaleFactor || 1;
  }

  private onEvent(event: CdpEvent): void {
    if (event.method === 'Target.targetCreated') {
      const info = event.params.targetInfo as { targetId?: string; type?: string; url?: string; openerId?: string } | undefined;
      if (info?.targetId && info.type === 'page' && info.openerId) void this.onPopup(info.openerId, info.targetId, info.url ?? '');
      return;
    }
    if (event.method === 'Target.targetInfoChanged') {
      const info = event.params.targetInfo as { targetId?: string } | undefined;
      const page = info?.targetId ? this.pages.get(info.targetId) : undefined;
      page?.onCdp(event);
      return;
    }
    if (event.method === 'Target.targetCrashed') {
      const targetId = event.params.targetId as string | undefined;
      const page = targetId ? this.pages.get(targetId) : undefined;
      page?.emit('render-process-gone', {}, { reason: 'crashed', exitCode: Number(event.params.errorCode ?? 0) });
      return;
    }
    if (!event.sessionId) return;
    const page = [...this.pages.values()].find((p) => p.sessionId === event.sessionId);
    page?.onCdp(event);
  }

  private async onPopup(openerId: string, targetId: string, url: string): Promise<void> {
    const opener = this.pages.get(openerId);
    if (!opener || this.pages.has(targetId)) return;
    await this.park(targetId);
    const finish = async (next: string) => {
      if (!next || /^about:blank$/i.test(next)) return false;
      if (OAUTH_HOSTS.test(next)) {
        await this.showPopup(targetId);
        return true;
      }
      if (opener.role === 'jobs') {
        if (/^https?:/i.test(next)) await opener.loadURL(next);
        await this.cdp.send('Target.closeTarget', { targetId }).catch(() => undefined);
        return true;
      }
      const decision = opener.popupHandler?.({ url: next, disposition: 'other' }) ?? { action: 'deny' as const };
      if (decision.action === 'allow') await this.showPopup(targetId);
      else await this.cdp.send('Target.closeTarget', { targetId }).catch(() => undefined);
      return true;
    };
    if (await finish(url)) return;
    let sessionId = '';
    try {
      sessionId = (await this.cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })).sessionId;
      await this.cdp.send('Page.enable', {}, sessionId);
    } catch {
      return;
    }
    const timer = setTimeout(() => void this.cdp.send('Target.closeTarget', { targetId }).catch(() => undefined), 15_000);
    const stop = this.cdp.onEvent((event) => {
      if (event.sessionId !== sessionId || event.method !== 'Page.frameNavigated') return;
      const frame = event.params.frame as { url?: string; parentId?: string } | undefined;
      if (frame?.parentId) return;
      void finish(frame?.url ?? '').then((done) => {
        if (!done) return;
        clearTimeout(timer);
        stop();
      });
    });
  }

  private async park(targetId: string): Promise<void> {
    try {
      const { windowId } = await this.cdp.send<{ windowId: number }>('Browser.getWindowForTarget', { targetId });
      await this.cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: -32000, top: -32000, width: 400, height: 300, windowState: 'normal' } });
    } catch {
    }
  }

  private async showPopup(targetId: string): Promise<void> {
    const win = this.opts.parent();
    const bounds = win && !win.isDestroyed() ? win.getBounds() : { x: 200, y: 80 };
    const { windowId } = await this.cdp.send<{ windowId: number }>('Browser.getWindowForTarget', { targetId });
    await this.cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: bounds.x + 80, top: bounds.y + 60, width: 520, height: 680, windowState: 'normal' } });
  }
}

class ChromePage extends EventEmitter implements PageController {
  readonly id = ++pageSeq;
  readonly navigationHistory: PageController['navigationHistory'];
  sessionId = '';
  hwnd: bigint | null = null;
  popupHandler: ((details: WindowOpenDetails) => { action: 'allow' | 'deny' }) | null = null;
  private targetId = '';
  private url = '';
  private title = '';
  private loading = false;
  private destroyed = false;
  private contextId = 0;
  private readonly outbox: { channel: string; payload: unknown }[] = [];
  private history: { index: number; entries: HistoryEntry[] } = { index: -1, entries: [] };
  private mainFrameId = '';
  private readonly debugListeners = new Set<(method: string, params: Record<string, unknown>) => void>();
  private pane: PaneBounds = { x: 0, y: 0, width: 0, height: 0 };
  private wantVisible = false;
  private embedded = false;

  constructor(private readonly host: ChromeHost, readonly role: Role) {
    super();
    const page = this;
    this.navigationHistory = {
      canGoBack: () => page.history.index > 0,
      canGoForward: () => page.history.index >= 0 && page.history.index < page.history.entries.length - 1,
      goBack: () => page.goBy(-1),
      goForward: () => page.goBy(1),
      goToIndex: (index) => {
        const entry = page.history.entries[index];
        if (entry) void page.command('Page.navigateToHistoryEntry', { entryId: entry.id });
      },
      getAllEntries: () => page.history.entries.map((entry) => ({ url: entry.url })),
      getActiveIndex: () => page.history.index,
    };
  }

  attached(targetId: string, sessionId: string): void {
    this.targetId = targetId;
    this.sessionId = sessionId;
  }

  surface(): BrowserSurface {
    const page = this;
    return {
      webContents: page,
      mount() {},
      setBounds(bounds) {
        page.pane = bounds;
        void page.apply();
      },
      setVisible(visible) {
        page.wantVisible = visible;
        void page.apply();
      },
      destroy() {
        page.destroyed = true;
        page.emit('destroyed');
        if (page.hwnd) void page.host.win32Embed().show(page.hwnd, false).catch(() => undefined);
        if (page.targetId) void page.host.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
      },
    };
  }

  loadURL(url: string): Promise<void> {
    if (!isNavigable(url)) return Promise.reject(new Error('Not a web address.'));
    this.loading = true;
    this.emit('did-start-loading');
    return this.command<{ errorText?: string }>('Page.navigate', { url }).then((result) => {
      if (result?.errorText) this.fail(-2, result.errorText, url);
    });
  }

  reload(): void {
    this.loading = true;
    void this.command('Page.reload', { ignoreCache: false });
  }

  stop(): void {
    void this.command('Page.stopLoading');
  }

  getURL(): string {
    return this.url;
  }

  getTitle(): string {
    return this.title;
  }

  isLoading(): boolean {
    return this.loading;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, payload?: unknown): void {
    this.outbox.push({ channel, payload });
    void this.flush();
  }

  async executeJavaScript(code: string, userGesture = false): Promise<unknown> {
    const result = await this.command<{ result?: { value?: unknown }; exceptionDetails?: { text?: string } }>('Runtime.evaluate', {
      expression: code,
      returnByValue: true,
      awaitPromise: true,
      userGesture,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'The page script failed.');
    return result.result?.value;
  }

  setWindowOpenHandler(handler: (details: WindowOpenDetails) => { action: 'allow' | 'deny' }): void {
    this.popupHandler = handler;
  }

  debugSend(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.command(method, params);
  }

  subscribeDebug(cb: (method: string, params: Record<string, unknown>) => void): void {
    this.debugListeners.add(cb);
  }

  openDevTools(): void {}

  async apply(): Promise<void> {
    if (!this.hwnd || this.destroyed) return;
    const win = this.host.parent();
    const show = this.host.isShown() && this.wantVisible && this.pane.width > 0 && this.pane.height > 0;
    if (!win || win.isDestroyed()) {
      await this.host.win32Embed().show(this.hwnd, false).catch(() => undefined);
      return;
    }
    if (!this.embedded) {
      const parent = win.getNativeWindowHandle();
      const handle = parent.length >= 8 ? parent.readBigUInt64LE(0) : BigInt(parent.readUInt32LE(0));
      await this.host.win32Embed().embed(this.hwnd, handle).catch(() => undefined);
      this.embedded = true;
    }
    const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor || 1;
    const px = embedPixels({ window: win.getBounds(), content: win.getContentBounds() }, this.pane, scale);
    if (show) await this.host.win32Embed().place(this.hwnd, px.x, px.y, px.w, px.h).catch(() => undefined);
    await this.host.win32Embed().show(this.hwnd, show).catch(() => undefined);
  }

  fail(code: number, description: string, url: string): void {
    this.loading = false;
    this.emit('did-fail-load', {}, code, description, url, true);
    this.emit('did-stop-loading');
  }

  async refreshHistory(): Promise<void> {
    try {
      const history = await this.command<{ currentIndex: number; entries: HistoryEntry[] }>('Page.getNavigationHistory');
      this.history = { index: history.currentIndex ?? -1, entries: history.entries ?? [] };
    } catch {
    }
  }

  onCdp(event: CdpEvent): void {
    for (const cb of this.debugListeners) {
      try {
        cb(event.method, event.params);
      } catch {
      }
    }
    const p = event.params;
    if (event.method === 'Page.frameNavigated') {
      const frame = p.frame as { id?: string; url?: string; parentId?: string } | undefined;
      if (!frame || frame.parentId) return;
      if (frame.id) this.mainFrameId = frame.id;
      const url = frame.url ?? '';
      if (url && !isNavigable(url) && url !== 'about:blank') {
        void this.command('Page.stopLoading');
        return;
      }
      this.url = url;
      this.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url });
      this.emit('did-navigate', {}, url);
      void this.refreshHistory();
      return;
    }
    if (event.method === 'Page.navigatedWithinDocument') {
      const url = String(p.url ?? this.url);
      this.url = url;
      this.emit('did-navigate-in-page', {}, url, true);
      void this.refreshHistory();
      return;
    }
    if (event.method === 'Page.frameStartedLoading') {
      this.loading = true;
      this.emit('did-start-loading');
      return;
    }
    if (event.method === 'Page.frameStoppedLoading' || event.method === 'Page.loadEventFired') {
      this.loading = false;
      this.emit('did-stop-loading');
      return;
    }
    if (event.method === 'Page.domContentEventFired') {
      this.emit('dom-ready');
      return;
    }
    if (event.method === 'Page.javascriptDialogOpening' && p.type === 'beforeunload') {
      void this.command('Page.handleJavaScriptDialog', { accept: true, promptText: '' });
      return;
    }
    if (event.method === 'Runtime.executionContextCreated') {
      const ctx = p.context as { id?: number; name?: string } | undefined;
      if (ctx?.name === WORLD && ctx.id) {
        this.contextId = ctx.id;
        void this.flush();
      }
      return;
    }
    if (event.method === 'Runtime.executionContextDestroyed' && p.executionContextId === this.contextId) {
      this.contextId = 0;
      return;
    }
    if (event.method === 'Runtime.bindingCalled' && p.name === 'afHost') {
      this.onBinding(String(p.payload ?? ''));
      return;
    }
    if (event.method === 'Network.responseReceived') {
      this.onResponse(p);
      return;
    }
    if (event.method === 'Network.requestWillBeSent' && p.redirectResponse && p.type === 'Document') {
      const url = String((p.request as { url?: string } | undefined)?.url ?? '');
      this.emit('did-redirect-navigation', { isMainFrame: true, url });
      return;
    }
    if (event.method === 'Target.targetInfoChanged') {
      const info = p.targetInfo as { targetId?: string; title?: string; url?: string } | undefined;
      if (!info || info.targetId !== this.targetId) return;
      if (typeof info.title === 'string' && info.title !== this.title) {
        this.title = info.title;
        this.emit('page-title-updated', {}, this.title);
      }
      if (info.url) this.url = info.url;
    }
  }

  private onResponse(p: Record<string, unknown>): void {
    if (p.type !== 'Document') return;
    const frameId = typeof p.frameId === 'string' ? p.frameId : '';
    if (this.mainFrameId && frameId && frameId !== this.mainFrameId) return;
    const response = p.response as { url?: string; status?: number; headers?: Record<string, string> } | undefined;
    if (!response) return;
    const res: PageResponse = {
      webContentsId: this.id,
      url: response.url ?? this.url,
      status: response.status ?? 0,
      resourceType: 'mainFrame',
      challenge: isChallengeResponse(response.headers),
    };
    this.host.jobsCallbacks().onPageResponse(res);
  }

  private onBinding(payload: string): void {
    let body: { kind?: string; id?: number; channel?: string; req?: unknown; payload?: unknown };
    try {
      body = JSON.parse(payload) as typeof body;
    } catch {
      return;
    }
    const jobs = this.host.jobsCallbacks();
    if (body.kind === 'send' && body.channel === 'af:event') jobs.onJobsEvent(body.payload);
    else if (body.kind === 'send' && body.channel === 'af:response' && body.payload && typeof body.payload === 'object') jobs.onJobsResponse(body.payload as { id: number; result?: unknown; error?: string });
    else if (body.kind === 'invoke' && body.channel === 'af:trusted' && typeof body.id === 'number') {
      void jobs.onJobsTrusted(body.req).then(
        (result) => this.reply(body.id!, { result }),
        (error: unknown) => this.reply(body.id!, { error: error instanceof Error ? error.message : String(error) }),
      );
    }
  }

  private reply(id: number, body: { result?: unknown; error?: string }): void {
    if (!this.contextId) return;
    void this.command('Runtime.evaluate', {
      expression: `globalThis.__afReply && globalThis.__afReply(${id}, ${JSON.stringify(body)})`,
      contextId: this.contextId,
    }).catch(() => undefined);
  }

  private async flush(): Promise<void> {
    if (!this.contextId || !this.outbox.length) return;
    const batch = this.outbox.splice(0);
    for (const item of batch) {
      await this.command('Runtime.evaluate', {
        expression: `globalThis.__afDeliver && globalThis.__afDeliver(${JSON.stringify(item.channel)}, ${JSON.stringify(item.payload ?? null)})`,
        contextId: this.contextId,
      }).catch(() => undefined);
    }
  }

  private goBy(delta: number): void {
    const entry = this.history.entries[this.history.index + delta];
    if (entry) void this.command('Page.navigateToHistoryEntry', { entryId: entry.id });
  }

  private command<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (this.destroyed || !this.sessionId) return Promise.reject(new Error('The page is not open.'));
    return this.host.send<T>(method, params, this.sessionId);
  }
}

let pageSeq = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForChrome(port: number, child: ChildProcess): Promise<string> {
  const deadline = Date.now() + 20_000;
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  while (Date.now() < deadline) {
    if (exited) throw new Error('Google Chrome closed before it was ready. Close any other embedded Chrome window and try again.');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const body = (await response.json()) as { webSocketDebuggerUrl?: string };
        if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
      }
    } catch {
    }
    await delay(200);
  }
  throw new Error('Google Chrome did not start.');
}

function killChrome(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill();
}

export function connectJobsInput(host: EmbeddedChrome, input: DiceInput): void {
  const page = host.jobs as ChromePage;
  input.useConnected(
    page,
    (method, params) => page.debugSend(method, params),
    (cb) => page.subscribeDebug(cb),
    (cb) => {
      page.on('destroyed', cb);
    },
  );
}
