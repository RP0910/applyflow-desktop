import { BrowserWindow, type WebContents } from 'electron';
import { BrowserDiagnostics, monitorSession, watchContents, type SessionMonitor } from './browserSession';

export interface ClaudeTab {
  readonly id: number;
  getURL(): string;
  getTitle(): string;
  isDestroyed(): boolean;
  onChallengePage(): boolean;
  load(url: string, timeoutMs: number): Promise<void>;
  /** Drop the page's "leave site?" handler so the next chat can open. */
  prepareForNavigation(): Promise<void>;
  run(code: string, userGesture?: boolean): Promise<unknown>;
  focus(): void;
  close(): void;
  onClosed(cb: () => void): void;
}

export interface ClaudeMainResponse {
  tabId: number;
  url: string;
  status: number;
  challenge: boolean;
}

export interface ClaudeBrowser {
  readonly kind: 'chrome' | 'electron';
  readonly partition: string;
  alive(): boolean;
  openWorker(): Promise<ClaudeTab>;
  openLogin(url: string): Promise<ClaudeTab>;
  onMainResponse(cb: (r: ClaudeMainResponse) => void): () => void;
  reset(): Promise<void>;
  close(): void;
}

export const CLAUDE_PARTITION = 'persist:applyflow-claude';
const HELPER_WORLD = 4271;

export function electronClaudeBrowser(opts: { getWindow: () => BrowserWindow | null; diagnostics: BrowserDiagnostics }): ClaudeBrowser {
  const mon: SessionMonitor = monitorSession(CLAUDE_PARTITION, opts.diagnostics);
  const windows = new Set<BrowserWindow>();
  const prefs = () => ({
    partition: CLAUDE_PARTITION,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    backgroundThrottling: false,
    spellcheck: false,
  });

  const tabFor = (win: BrowserWindow): ClaudeTab => {
    const wc = win.webContents;
    windows.add(win);
    win.on('closed', () => windows.delete(win));
    return {
      id: wc.id,
      getURL: () => safe(() => wc.getURL(), ''),
      getTitle: () => safe(() => wc.getTitle(), ''),
      isDestroyed: () => win.isDestroyed() || wc.isDestroyed(),
      onChallengePage: () => mon.onChallengePage(wc),
      load: (url, timeoutMs) => loadElectron(wc, url, timeoutMs),
      prepareForNavigation: () => {
        if (wc.isDestroyed()) return Promise.resolve();
        return wc.executeJavaScript('window.onbeforeunload=null;window.addEventListener("beforeunload",function(e){e.stopImmediatePropagation();},true);true').then(() => undefined);
      },
      run: (code, userGesture = false) => wc.executeJavaScriptInIsolatedWorld(HELPER_WORLD, [{ code }], userGesture),
      focus: () => {
        if (win.isDestroyed()) return;
        win.show();
        win.focus();
      },
      close: () => {
        if (!win.isDestroyed()) win.close();
      },
      onClosed: (cb) => {
        win.on('closed', cb);
      },
    };
  };

  return {
    kind: 'electron',
    partition: CLAUDE_PARTITION,
    alive: () => true,
    async openWorker() {
      const worker = new BrowserWindow({
        show: false,
        width: 1360,
        height: 900,
        skipTaskbar: true,
        focusable: false,
        minimizable: false,
        maximizable: false,
        title: 'Claude.ai session',
        webPreferences: prefs(),
      });
      const wc = worker.webContents;
      watchContents(wc, () => 'claude background', mon);
      wc.setBackgroundThrottling(false);
      wc.setAudioMuted(true);
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
      const block = (event: { preventDefault: () => void }, url: string) => {
        if (!workerAllowed(url)) event.preventDefault();
      };
      wc.on('will-navigate', block);
      wc.on('will-redirect', block);
      // A streaming reply arms beforeunload. Accept the leave so the next chat can open.
      wc.on('will-prevent-unload', (event) => event.preventDefault());
      worker.setOpacity(0);
      worker.setIgnoreMouseEvents(true);
      worker.showInactive();
      return tabFor(worker);
    },
    async openLogin(url) {
      const parent = opts.getWindow() ?? undefined;
      const win = new BrowserWindow({
        width: 1100,
        height: 840,
        title: 'Sign in to Claude.ai',
        autoHideMenuBar: true,
        backgroundColor: '#1f1f1f',
        parent,
        webPreferences: prefs(),
      });
      win.webContents.setWindowOpenHandler(({ url: next }) => {
        if (!/^https:\/\//i.test(next)) return { action: 'deny' };
        return {
          action: 'allow',
          overrideBrowserWindowOptions: { width: 520, height: 760, autoHideMenuBar: true, parent: win, webPreferences: prefs() },
        };
      });
      watchContents(win.webContents, () => 'claude sign-in', mon);
      void win.loadURL(url).catch(() => undefined);
      return tabFor(win);
    },
    onMainResponse(cb) {
      return mon.onPageResponse((r) => {
        if (r.resourceType !== 'mainFrame' || r.webContentsId === undefined) return;
        cb({ tabId: r.webContentsId, url: r.url, status: r.status, challenge: r.challenge });
      });
    },
    reset: () => mon.reset(),
    close() {
      for (const win of windows) if (!win.isDestroyed()) win.destroy();
      windows.clear();
    },
  };
}

export function workerAllowed(url: string): boolean {
  if (/^about:blank$/i.test(url)) return true;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname;
    return h === 'claude.ai' || h.endsWith('.claude.ai')
      || h === 'anthropic.com' || h.endsWith('.anthropic.com')
      || h === 'accounts.google.com' || h.endsWith('.google.com') || h.endsWith('.gstatic.com')
      || h.endsWith('.microsoftonline.com') || h.endsWith('.live.com')
      || h.endsWith('.apple.com')
      || h === 'challenges.cloudflare.com';
  } catch {
    return false;
  }
}

function loadElectron(wc: WebContents, url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      wc.removeListener('did-finish-load', done);
      wc.removeListener('did-fail-load', fail);
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('Could not open Claude.ai before the time limit.'))), timeoutMs);
    const done = () => finish(() => resolve());
    const fail = (_e: unknown, code: number, desc: string, _url: string, isMain: boolean) => {
      if (!isMain || code === -3) return;
      finish(() => reject(new Error(desc || 'Could not open Claude.ai.')));
    };
    wc.on('did-finish-load', done);
    wc.on('did-fail-load', fail);
    void wc.loadURL(url).catch((e: unknown) => finish(() => reject(e instanceof Error ? e : new Error('Could not open Claude.ai.'))));
  });
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
