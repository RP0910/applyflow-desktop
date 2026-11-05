import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { CdpClient, type CdpEvent } from './cdpClient';
import { findChromeExecutable } from './chromePath';
import { freePort, killChrome, waitForChrome } from './chromeProcess';
import { isChallengeResponse, isChallengeTitle } from './browserPolicy';
import type { BrowserDiagnostics } from './browserSession';
import type { ClaudeBrowser, ClaudeMainResponse, ClaudeTab } from './claudeBrowser';
import { workerAllowed } from './claudeBrowser';
import { ClaudeSignInWindow } from './claudeSignInWindow';
import { Win32Embed } from './win32Embed';

const WORLD = 'applyflow-claude';
const PARTITION = 'chrome:applyflow-claude';
const PARK = -30000;

export async function launchClaudeChrome(opts: {
  userDataDir: string;
  getWindow: () => BrowserWindow | null;
  diagnostics: BrowserDiagnostics;
  icon?: string;
  extraArgs?: string[];
}): Promise<ClaudeBrowser> {
  const exe = findChromeExecutable();
  if (!exe) throw new Error('Google Chrome is not installed.');
  mkdirSync(opts.userDataDir, { recursive: true });
  await closeStale(opts.userDataDir);
  const port = await freePort();
  const child = spawn(exe, [
    `--user-data-dir=${opts.userDataDir}`,
    `--remote-debugging-port=${port}`,
    `--remote-allow-origins=http://127.0.0.1:${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,CalculateNativeWinOcclusion',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    `--window-position=${PARK},${PARK}`,
    '--window-size=1360,900',
    ...(opts.extraArgs ?? []),
    `--app=data:text/html,${encodeURIComponent('<!doctype html><title>Claude.ai</title>')}`,
  ], { stdio: 'ignore', windowsHide: false });
  child.on('error', () => undefined);
  let cdp: CdpClient;
  try {
    cdp = await CdpClient.connect(await waitForChrome(port, child));
  } catch (error) {
    killChrome(child);
    throw error;
  }
  const host = new ClaudeChrome(opts, child, cdp, port);
  try {
    await host.start();
  } catch (error) {
    host.close();
    throw error;
  }
  return host;
}

async function closeStale(userDataDir: string): Promise<void> {
  const file = join(userDataDir, 'DevToolsActivePort');
  if (!existsSync(file)) return;
  try {
    const [port, path] = readFileSync(file, 'utf8').split(/\r?\n/);
    if (!port || !path) return;
    const cdp = await CdpClient.connect(`ws://127.0.0.1:${port.trim()}${path.trim()}`, 1_500);
    await Promise.race([cdp.send('Browser.close'), delay(1_500)]).catch(() => undefined);
    cdp.close();
    await delay(800);
  } catch {
  }
}

class ClaudeChrome implements ClaudeBrowser {
  readonly kind = 'chrome' as const;
  readonly partition = PARTITION;
  private readonly tabs = new Map<string, ChromeTab>();
  private readonly listeners = new Set<(r: ClaudeMainResponse) => void>();
  private readonly stopEvents: () => void;
  private signInTarget = '';
  private signInSurface: ChromeTab | null = null;
  private signInWindow: ClaudeSignInWindow | null = null;
  private signInLost = false;
  private signInHwnd: bigint | null = null;
  private workerTarget = '';
  private closed = false;
  private win32: Promise<Win32Embed | null> | null = null;

  constructor(
    private readonly opts: Parameters<typeof launchClaudeChrome>[0],
    private readonly child: ChildProcess,
    readonly cdp: CdpClient,
    private readonly port: number,
  ) {
    this.stopEvents = cdp.onEvent((event) => this.onEvent(event));
    child.once('exit', () => this.shutDown());
  }

  async start(): Promise<void> {
    await this.cdp.send('Target.setDiscoverTargets', { discover: true });
    const list = (await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json()) as { id: string; type: string }[];
    this.signInTarget = list.find((t) => t.type === 'page')?.id ?? '';
    if (!this.signInTarget) return;
    await this.setBounds(this.signInTarget, { left: PARK, top: PARK, width: 1100, height: 760, windowState: 'normal' });
    const page = await this.findParkedWindow();
    if (!page) return;
    this.signInHwnd = page;
    const helper = await this.helper();
    await helper?.toolWindow(page).catch(() => undefined);
    this.signInWindow = new ClaudeSignInWindow({
      parent: this.opts.getWindow,
      helper: () => this.helper(),
      page,
      icon: this.opts.icon,
      currentUrl: () => this.signInSurface?.getURL() ?? '',
    });
  }

  alive(): boolean {
    return !this.closed && !this.cdp.closed && !this.signInLost;
  }

  async openWorker(): Promise<ClaudeTab> {
    const { targetId } = await this.cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank', newWindow: true, background: true });
    await this.setBounds(targetId, { left: PARK, top: PARK, width: 1360, height: 900, windowState: 'normal' });
    const tab = await this.attach(targetId, 'claude background');
    this.workerTarget = targetId;
    void this.hideFromTaskbar();
    return tab;
  }

  async openLogin(url: string): Promise<ClaudeTab> {
    const shown = await this.openSignInWindow(url).catch(() => null);
    if (shown) return shown;
    return this.openLoginWindow(url);
  }

  private async openSignInWindow(url: string): Promise<ClaudeTab | null> {
    const win = this.signInWindow;
    if (!win || !this.signInTarget || this.signInLost) return null;
    if (!this.signInSurface || this.signInSurface.isDestroyed()) this.signInSurface = await this.attach(this.signInTarget, 'claude sign-in');
    const session = new SignInSession(this.signInSurface, win);
    const ok = await win.open(() => session.end());
    if (!ok) return null;
    void this.signInSurface.navigate(url).catch(() => undefined);
    return session;
  }

  private async openLoginWindow(url: string): Promise<ClaudeTab> {
    const known = new Set((await this.windows()).map((row) => row.hwnd.toString()));
    const { targetId } = await this.cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank', newWindow: true });
    const win = this.opts.getWindow();
    const width = 1100;
    const height = 840;
    const around = win && !win.isDestroyed() ? win.getBounds() : null;
    const left = around ? Math.round(around.x + Math.max(0, (around.width - width) / 2)) : 120;
    const top = around ? Math.round(around.y + Math.max(0, (around.height - height) / 2)) : 80;
    await this.setBounds(targetId, { left, top, width, height, windowState: 'normal' });
    const tab = await this.attach(targetId, 'claude sign-in');
    tab.hwnd = await this.findNewWindow(known);
    tab.focus();
    void tab.navigate(url).catch(() => undefined);
    return tab;
  }

  async raise(tab: ChromeTab): Promise<void> {
    await this.setBounds(tab.targetId, { windowState: 'normal' });
    await this.send('Target.activateTarget', { targetId: tab.targetId }).catch(() => undefined);
    const helper = await this.helper();
    if (!helper || !tab.hwnd) return;
    await helper.front(tab.hwnd, this.ownerHandle()).catch(() => undefined);
  }

  private ownerHandle(): bigint | null {
    const win = this.opts.getWindow();
    if (!win || win.isDestroyed()) return null;
    const buf = win.getNativeWindowHandle();
    return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
  }

  private helper(): Promise<Win32Embed | null> {
    if (process.platform !== 'win32') return Promise.resolve(null);
    this.win32 ??= Win32Embed.start().catch(() => null);
    return this.win32;
  }

  private async windows(): Promise<{ hwnd: bigint; left: number; top: number }[]> {
    const pid = this.child.pid;
    const helper = await this.helper();
    if (!helper || !pid) return [];
    return helper.find(pid).catch(() => []);
  }

  private async findParkedWindow(): Promise<bigint | null> {
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline) {
      const parked = (await this.windows()).filter((row) => row.left < -5000 && row.hwnd !== this.signInHwnd);
      if (parked.length) return parked[0]!.hwnd;
      await delay(120);
    }
    return null;
  }

  private async findNewWindow(known: Set<string>): Promise<bigint | null> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const fresh = (await this.windows()).filter((row) => row.left > -5000 && !known.has(row.hwnd.toString()));
      if (fresh.length) return fresh[0]!.hwnd;
      await delay(120);
    }
    return null;
  }

  onMainResponse(cb: (r: ClaudeMainResponse) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async reset(): Promise<void> {
    await this.cdp.send('Storage.clearCookies').catch(() => undefined);
    for (const origin of ['https://claude.ai', 'https://www.claude.ai', 'https://anthropic.com']) {
      await this.cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }).catch(() => undefined);
    }
    for (const tab of this.tabs.values()) tab.challenge = false;
    this.opts.diagnostics.record({ partition: PARTITION, source: 'settings', kind: 'session-reset' });
  }

  close(): void {
    if (this.closed) return;
    void this.cdp.send('Browser.close').catch(() => undefined);
    this.signInWindow?.dispose();
    this.signInWindow = null;
    const child = this.child;
    setTimeout(() => killChrome(child), 3_000).unref?.();
    this.shutDown();
  }

  noteResponse(r: ClaudeMainResponse, source: string): void {
    if (r.challenge) this.opts.diagnostics.record({ partition: PARTITION, source, kind: 'challenge', url: r.url, status: r.status });
    else if (r.status >= 400) this.opts.diagnostics.record({ partition: PARTITION, source, kind: 'http-error', url: r.url, status: r.status });
    for (const cb of this.listeners) {
      try {
        cb(r);
      } catch {
      }
    }
  }

  send<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T> {
    if (!this.alive()) return Promise.reject(new Error('Google Chrome closed.'));
    return this.cdp.send<T>(method, params, sessionId);
  }

  async setBounds(targetId: string, bounds: Record<string, unknown>): Promise<void> {
    try {
      const { windowId } = await this.cdp.send<{ windowId: number }>('Browser.getWindowForTarget', { targetId });
      if (bounds.windowState === 'normal') await this.cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }).catch(() => undefined);
      const { windowState: _state, ...rest } = bounds;
      await this.cdp.send('Browser.setWindowBounds', { windowId, bounds: rest });
    } catch {
    }
  }

  private shutDown(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopEvents();
    void this.win32?.then((helper) => helper?.close());
    this.cdp.close();
    for (const tab of this.tabs.values()) tab.markClosed();
    this.tabs.clear();
  }

  private async attach(targetId: string, source: string): Promise<ChromeTab> {
    const { sessionId } = await this.cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    const tab = new ChromeTab(this, targetId, sessionId, source);
    this.tabs.set(targetId, tab);
    await this.send('Page.enable', {}, sessionId);
    await this.send('Network.enable', {}, sessionId);
    await tab.readFrameTree();
    return tab;
  }

  private async hideFromTaskbar(): Promise<void> {
    const helper = await this.helper();
    if (!helper) return;
    const hwnd = await this.findParkedWindow();
    if (hwnd) await helper.toolWindow(hwnd).catch(() => undefined);
  }

  private onEvent(event: CdpEvent): void {
    const p = event.params;
    if (event.method === 'Target.targetCreated') {
      const info = p.targetInfo as { targetId?: string; type?: string; openerId?: string } | undefined;
      if (info?.targetId && info.type === 'page' && info.openerId && info.openerId === this.workerTarget) {
        void this.cdp.send('Target.closeTarget', { targetId: info.targetId }).catch(() => undefined);
      }
      return;
    }
    if (event.method === 'Target.targetInfoChanged') {
      const info = p.targetInfo as { targetId?: string; url?: string } | undefined;
      const tab = info?.targetId ? this.tabs.get(info.targetId) : undefined;
      if (tab && info) tab.onInfo(info.url);
      return;
    }
    if (event.method === 'Target.targetDestroyed' || event.method === 'Target.targetCrashed') {
      const targetId = String(p.targetId ?? '');
      const tab = this.tabs.get(targetId);
      if (tab) {
        this.tabs.delete(targetId);
        if (event.method === 'Target.targetCrashed') void this.cdp.send('Target.closeTarget', { targetId }).catch(() => undefined);
        tab.markClosed();
      }
      if (targetId === this.workerTarget) this.workerTarget = '';
      if (targetId === this.signInTarget) {
        this.signInLost = true;
        this.signInWindow?.hide();
      }
      return;
    }
    if (event.method === 'Target.detachedFromTarget') {
      const sessionId = String(p.sessionId ?? '');
      for (const [id, tab] of this.tabs) {
        if (tab.sessionId !== sessionId) continue;
        this.tabs.delete(id);
        tab.markClosed();
      }
      return;
    }
    if (!event.sessionId) return;
    for (const tab of this.tabs.values()) if (tab.sessionId === event.sessionId) tab.onCdp(event);
  }
}

class SignInSession implements ClaudeTab {
  readonly id: number;
  private ended = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly page: ChromeTab, private readonly win: ClaudeSignInWindow) {
    this.id = page.id;
    page.onClosed(() => this.end());
  }

  getURL(): string {
    return this.page.getURL();
  }

  getTitle(): string {
    return this.page.getTitle();
  }

  isDestroyed(): boolean {
    return this.ended || this.page.isDestroyed();
  }

  onChallengePage(): boolean {
    return !this.ended && this.page.onChallengePage();
  }

  load(url: string, timeoutMs: number): Promise<void> {
    return this.page.load(url, timeoutMs);
  }

  prepareForNavigation(): Promise<void> {
    return this.page.prepareForNavigation();
  }

  run(code: string, userGesture?: boolean): Promise<unknown> {
    return this.page.run(code, userGesture);
  }

  focus(): void {
    if (!this.isDestroyed()) this.win.focus();
  }

  close(): void {
    this.end();
  }

  onClosed(cb: () => void): void {
    if (this.ended) cb();
    else this.listeners.add(cb);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.win.hide();
    if (!this.page.isDestroyed()) void this.page.navigate('about:blank').catch(() => undefined);
    for (const cb of this.listeners) {
      try {
        cb();
      } catch {
      }
    }
    this.listeners.clear();
  }
}

let tabSeq = 0;

class ChromeTab implements ClaudeTab {
  readonly id = ++tabSeq;
  challenge = false;
  hwnd: bigint | null = null;
  private url = 'about:blank';
  private title = '';
  private closed = false;
  private mainFrameId = '';
  private context = 0;
  private readonly closedListeners = new Set<() => void>();
  private readonly loadWaiters = new Set<(error?: Error) => void>();

  constructor(
    private readonly host: ClaudeChrome,
    readonly targetId: string,
    readonly sessionId: string,
    private readonly source: string,
  ) {}

  getURL(): string {
    return this.url;
  }

  getTitle(): string {
    return this.title;
  }

  isDestroyed(): boolean {
    return this.closed || !this.host.alive();
  }

  onChallengePage(): boolean {
    return !this.isDestroyed() && (this.challenge || isChallengeTitle(this.title));
  }

  navigate(url: string): Promise<boolean> {
    return this.command<{ errorText?: string }>('Page.navigate', { url }).then((r) => {
      const errorText = r?.errorText ?? '';
      if (errorText && !/ERR_ABORTED/i.test(errorText)) throw new Error(errorText);
      return /ERR_ABORTED/i.test(errorText);
    });
  }

  /** Main world: a streaming reply's beforeunload lives there, not in the helper world. */
  prepareForNavigation(): Promise<void> {
    if (this.closed || !/^https:\/\/([^/]+\.)?claude\.ai\//i.test(this.url)) return Promise.resolve();
    return this.command('Runtime.evaluate', {
      expression: 'window.onbeforeunload=null;window.addEventListener("beforeunload",function(e){e.stopImmediatePropagation();},true);true',
      returnByValue: true,
      userGesture: true,
    }).then(() => undefined);
  }

  load(url: string, timeoutMs: number): Promise<void> {
    const reload = this.samePage(url);
    const started = this.url;
    return new Promise((resolve, reject) => {
      let settled = false;
      let armed = false;
      let retried = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.loadWaiters.delete(onLoad);
        if (error) reject(error);
        else resolve();
      };
      // A cancelled leave fires "stopped loading" while the tab is still on the old chat.
      // That is not the new page. Only a committed navigation (or a reload) counts.
      const committed = () => reload || this.samePage(url) || this.url !== started;
      const onLoad = (error?: Error) => {
        if (error) finish(error);
        else if (armed && committed()) finish();
      };
      const timer = setTimeout(() => finish(new Error('Could not open Claude.ai before the time limit.')), timeoutMs);
      this.loadWaiters.add(onLoad);
      const go = () => {
        this.navigate(url).then((aborted) => {
          armed = true;
          if (!reload && this.samePage(url)) finish();
          else if (aborted && !retried) {
            retried = true;
            setTimeout(() => { if (!settled) void go(); }, 500);
          }
        }).catch((e: unknown) => finish(e instanceof Error ? e : new Error('Could not open Claude.ai.')));
      };
      void go();
    });
  }

  private samePage(url: string): boolean {
    try {
      const a = new URL(this.url);
      const b = new URL(url);
      return a.origin === b.origin && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '');
    } catch {
      return this.url === url;
    }
  }

  async run(code: string, userGesture = false): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      if (!this.context) this.context = await this.createWorld();
      let result: { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
      try {
        result = await this.command('Runtime.evaluate', {
          expression: code,
          contextId: this.context,
          returnByValue: true,
          awaitPromise: true,
          userGesture,
        });
      } catch (error) {
        if (attempt === 0 && !this.closed) {
          this.context = 0;
          continue;
        }
        throw error;
      }
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'The page script failed.');
      return result.result?.value;
    }
  }

  focus(): void {
    if (this.isDestroyed()) return;
    void this.command('Page.bringToFront').catch(() => undefined);
    void this.host.raise(this);
  }

  close(): void {
    if (this.isDestroyed()) return;
    void this.host.send('Target.closeTarget', { targetId: this.targetId }).catch(() => undefined);
  }

  onClosed(cb: () => void): void {
    if (this.closed) cb();
    else this.closedListeners.add(cb);
  }

  markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of [...this.loadWaiters]) waiter(new Error('The Claude.ai window closed.'));
    for (const cb of this.closedListeners) {
      try {
        cb();
      } catch {
      }
    }
    this.closedListeners.clear();
  }

  async readFrameTree(): Promise<void> {
    try {
      const tree = await this.command<{ frameTree?: { frame?: { id?: string; url?: string } } }>('Page.getFrameTree');
      this.mainFrameId = tree.frameTree?.frame?.id ?? this.targetId;
      if (tree.frameTree?.frame?.url) this.url = tree.frameTree.frame.url;
    } catch {
      this.mainFrameId = this.targetId;
    }
  }

  private settleLoad(): void {
    void this.refreshTitle().finally(() => {
      for (const waiter of [...this.loadWaiters]) waiter();
    });
  }

  onInfo(url: string | undefined): void {
    if (url) this.url = url;
    void this.refreshTitle();
  }

  private async refreshTitle(): Promise<void> {
    try {
      const history = await this.command<{ currentIndex: number; entries: { title?: string; url?: string }[] }>('Page.getNavigationHistory');
      const entry = history.entries?.[history.currentIndex];
      if (entry) this.title = entry.title ?? '';
    } catch {
    }
  }

  onCdp(event: CdpEvent): void {
    const p = event.params;
    switch (event.method) {
      case 'Page.frameNavigated': {
        const frame = p.frame as { id?: string; url?: string; parentId?: string } | undefined;
        if (!frame || frame.parentId) return;
        if (frame.id) this.mainFrameId = frame.id;
        if (frame.url) this.url = frame.url;
        this.title = '';
        this.context = 0;
        void this.refreshTitle();
        return;
      }
      case 'Page.navigatedWithinDocument':
        if (p.frameId === this.mainFrameId && typeof p.url === 'string') this.url = p.url;
        return;
      case 'Page.frameStoppedLoading': {
        const frameId = typeof p.frameId === 'string' ? p.frameId : '';
        if (this.mainFrameId && frameId && frameId !== this.mainFrameId) return;
        this.settleLoad();
        return;
      }
      case 'Page.loadEventFired':
        this.settleLoad();
        return;
      case 'Page.javascriptDialogOpening':
        // beforeunload accept means Leave, so the titles chat (and the CV chat) can open.
        if (this.source === 'claude background') void this.command('Page.handleJavaScriptDialog', { accept: p.type === 'beforeunload' }).catch(() => undefined);
        return;
      case 'Page.frameRequestedNavigation':
        if (this.source === 'claude background' && p.frameId === this.mainFrameId && typeof p.url === 'string' && !workerAllowed(p.url)) {
          void this.command('Page.stopLoading').catch(() => undefined);
        }
        return;
      case 'Network.responseReceived': {
        if (p.type !== 'Document') return;
        if (this.mainFrameId && p.frameId && p.frameId !== this.mainFrameId) return;
        const response = p.response as { url?: string; status?: number; headers?: Record<string, string> } | undefined;
        if (!response) return;
        this.challenge = isChallengeResponse(response.headers);
        this.host.noteResponse({ tabId: this.id, url: response.url ?? this.url, status: response.status ?? 0, challenge: this.challenge }, this.source);
        return;
      }
      default:
    }
  }

  private async createWorld(): Promise<number> {
    if (!this.mainFrameId) await this.readFrameTree();
    const made = await this.command<{ executionContextId: number }>('Page.createIsolatedWorld', { frameId: this.mainFrameId, worldName: WORLD });
    return made.executionContextId;
  }

  private command<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('The Claude.ai window closed.'));
    return this.host.send<T>(method, params, this.sessionId);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
