/**
 * The Claude.ai Chat connection in Google Chrome.
 *
 * ApplyFlow starts the user's installed Chrome with its own profile (separate from everyday Chrome)
 * and drives it over the DevTools protocol:
 * - a background window, parked off-screen and kept off the taskbar, writes the resumes;
 * - the sign-in window is an ordinary Chrome window the user finishes themselves.
 * Chrome's own identity is what lets Claude.ai's security check finish. ApplyFlow never clicks it,
 * never runs anything inside a check page, and keeps its page helper in an isolated world.
 */
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
import { Win32Embed } from './win32Embed';

const WORLD = 'applyflow-claude';
const PARTITION = 'chrome:applyflow-claude';
const PARK = -30000;

export async function launchClaudeChrome(opts: {
  userDataDir: string;
  getWindow: () => BrowserWindow | null;
  diagnostics: BrowserDiagnostics;
  /** Test hook: extra Chrome switches. */
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
    'about:blank',
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

/** A Chrome left running by an earlier ApplyFlow would take over the new launch; ask it to quit first. */
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
    // Nothing is listening: the file is left over from a closed Chrome.
  }
}

class ClaudeChrome implements ClaudeBrowser {
  readonly kind = 'chrome' as const;
  readonly partition = PARTITION;
  private readonly tabs = new Map<string, ChromeTab>();
  private readonly listeners = new Set<(r: ClaudeMainResponse) => void>();
  private readonly stopEvents: () => void;
  private spare: string | null = null;
  private workerTarget = '';
  private closed = false;

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
    this.spare = list.find((t) => t.type === 'page')?.id ?? null;
  }

  alive(): boolean {
    return !this.closed && !this.cdp.closed;
  }

  async openWorker(): Promise<ClaudeTab> {
    let targetId = this.spare;
    this.spare = null;
    if (!targetId) {
      ({ targetId } = await this.cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank', newWindow: true, background: true }));
    }
    await this.setBounds(targetId, { left: PARK, top: PARK, width: 1360, height: 900, windowState: 'normal' });
    const tab = await this.attach(targetId, 'claude background');
    this.workerTarget = targetId;
    void this.hideFromTaskbar();
    return tab;
  }

  async openLogin(url: string): Promise<ClaudeTab> {
    const { targetId } = await this.cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank', newWindow: true });
    const win = this.opts.getWindow();
    const width = 1100;
    const height = 840;
    const around = win && !win.isDestroyed() ? win.getBounds() : null;
    const left = around ? Math.round(around.x + Math.max(0, (around.width - width) / 2)) : 120;
    const top = around ? Math.round(around.y + Math.max(0, (around.height - height) / 2)) : 80;
    await this.setBounds(targetId, { left, top, width, height, windowState: 'normal' });
    const tab = await this.attach(targetId, 'claude sign-in');
    tab.focus();
    void tab.navigate(url).catch(() => undefined);
    return tab;
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
    this.cdp.close();
    for (const tab of this.tabs.values()) tab.markClosed();
    this.tabs.clear();
  }

  private async attach(targetId: string, source: string): Promise<ChromeTab> {
    const { sessionId } = await this.cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    const tab = new ChromeTab(this, targetId, sessionId, source);
    this.tabs.set(targetId, tab);
    // Page and Network events only. Runtime is never enabled: pages can notice it.
    await this.send('Page.enable', {}, sessionId);
    await this.send('Network.enable', {}, sessionId);
    await tab.readFrameTree();
    return tab;
  }

  /** The background window stays "visible" to Windows (so Claude.ai keeps rendering) but leaves the taskbar. */
  private async hideFromTaskbar(): Promise<void> {
    const pid = this.child.pid;
    if (process.platform !== 'win32' || !pid) return;
    let win32: Win32Embed | null = null;
    try {
      win32 = await Win32Embed.start();
      const deadline = Date.now() + 6_000;
      while (Date.now() < deadline) {
        const rows = await win32.find(pid).catch(() => []);
        const parked = rows.filter((row) => row.left < -5000);
        if (parked.length) {
          for (const row of parked) await win32.toolWindow(row.hwnd).catch(() => undefined);
          return;
        }
        await delay(150);
      }
    } catch {
      // Best effort: the window still works, it just shows on the taskbar.
    } finally {
      win32?.close();
    }
  }

  private onEvent(event: CdpEvent): void {
    const p = event.params;
    if (event.method === 'Target.targetCreated') {
      const info = p.targetInfo as { targetId?: string; type?: string; openerId?: string } | undefined;
      // The background page never opens windows of its own.
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

let tabSeq = 0;

class ChromeTab implements ClaudeTab {
  readonly id = ++tabSeq;
  challenge = false;
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

  navigate(url: string): Promise<void> {
    return this.command<{ errorText?: string }>('Page.navigate', { url }).then((r) => {
      if (r?.errorText && !/ERR_ABORTED/i.test(r.errorText)) throw new Error(r.errorText);
    });
  }

  load(url: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.loadWaiters.delete(finish);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => finish(new Error('Could not open Claude.ai before the time limit.')), timeoutMs);
      this.loadWaiters.add(finish);
      this.navigate(url).catch((e: unknown) => finish(e instanceof Error ? e : new Error('Could not open Claude.ai.')));
    });
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
        // The page navigated and took the helper's world with it: make a new one once.
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
    void this.host.setBounds(this.targetId, { windowState: 'normal' });
    void this.host.send('Target.activateTarget', { targetId: this.targetId }).catch(() => undefined);
    void this.command('Page.bringToFront').catch(() => undefined);
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

  onInfo(url: string | undefined): void {
    if (url) this.url = url;
    void this.refreshTitle();
  }

  /**
   * The title of the document actually showing. Target events can deliver the previous document's title
   * after a navigation (a cleared security check would look stuck), so the history entry is read instead.
   */
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
      case 'Page.loadEventFired':
        void this.refreshTitle().finally(() => {
          for (const waiter of [...this.loadWaiters]) waiter();
        });
        return;
      case 'Page.javascriptDialogOpening':
        if (this.source === 'claude background') void this.command('Page.handleJavaScriptDialog', { accept: p.type === 'beforeunload' }).catch(() => undefined);
        return;
      case 'Page.frameRequestedNavigation':
        // Keep the background page on Claude.ai and its sign-in providers.
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
