import { BrowserWindow, shell, WebContentsView } from 'electron';
import type { BrowserTab, BrowserTabsState } from '../src/platform/bridge';
import { electronSurface, type BrowserSurface } from './browserSurface';
import type { PageController } from './pageController';
import { CHALLENGE_LOOP_COUNT, CHALLENGE_LOOP_WINDOW_MS, CHALLENGE_STUCK_MS, isNavigable, LoopDetector, normalizeAddress, webSearch } from './browserPolicy';
import { watchContents, type PageResponse, type SessionMonitor } from './browserSession';

interface Tab {
  id: number;
  kind: 'jobs' | 'web';
  surface: BrowserSurface;
  error: BrowserTab['error'];
  crashed: boolean;
  challengeLoop: boolean;
}

type Bounds = { x: number; y: number; width: number; height: number };

export class BrowserTabs {
  private readonly tabs = new Map<number, Tab>();
  private order: number[] = [];
  private nextId = 1;
  private activeId = 0;
  private jobsId = 0;
  private bounds: Bounds = { x: 0, y: 0, width: 0, height: 0 };
  private visible = true;
  private readonly challenges = new LoopDetector(CHALLENGE_LOOP_WINDOW_MS);
  private readonly stuckTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private emitQueued = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly opts: {
      window: () => BrowserWindow | null;
      monitor: SessionMonitor;
      emit: (state: BrowserTabsState) => void;
      openWeb?: (url: string | null) => BrowserSurface | null;
    },
  ) {
    this.unsubscribe = opts.monitor.onPageResponse((r) => this.onPageResponse(r));
  }

  adoptJobs(surface: BrowserSurface): number {
    const tab = this.add('jobs', surface);
    this.jobsId = tab.id;
    if (!this.activeId) this.activeId = tab.id;
    this.layout();
    return tab.id;
  }

  open(address?: string, activate = true): number {
    const url = address ? normalizeAddress(address, webSearch) : null;
    const chrome = this.opts.openWeb?.(url);
    if (chrome) {
      const tab = this.add('web', chrome);
      this.wireWebTab(tab);
      if (activate) this.activeId = tab.id;
      this.layout();
      this.queueEmit();
      return tab.id;
    }
    const view = new WebContentsView({
      webPreferences: {
        partition: this.opts.monitor.partition,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        safeDialogs: true,
        spellcheck: true,
      },
    });
    const tab = this.add('web', electronSurface(this.opts.window, view));
    this.wireWebTab(tab);
    if (activate) this.activeId = tab.id;
    this.layout();
    void view.webContents.loadURL(url ?? 'about:blank').catch(() => undefined);
    this.queueEmit();
    return tab.id;
  }

  close(id: number): void {
    const tab = this.tabs.get(id);
    if (!tab || tab.kind === 'jobs') return;
    const i = this.order.indexOf(id);
    this.order = this.order.filter((x) => x !== id);
    this.tabs.delete(id);
    this.challenges.reset(String(id));
    this.clearStuck(id);
    tab.surface.destroy();
    if (this.activeId === id) this.activeId = this.order[Math.max(0, i - 1)] ?? this.jobsId;
    this.layout();
    this.queueEmit();
  }

  closeWebTabs(): void {
    for (const id of [...this.order]) if (id !== this.jobsId) this.close(id);
  }

  activate(id: number): void {
    if (!this.tabs.has(id) || this.activeId === id) return;
    this.activeId = id;
    this.layout();
    this.queueEmit();
  }

  activateJobs(): void {
    if (this.jobsId) this.activate(this.jobsId);
  }

  isJobsActive(): boolean {
    return this.activeId === this.jobsId;
  }

  contents(id?: number): PageController | null {
    const tab = this.tabs.get(id ?? this.activeId);
    return tab && !tab.surface.webContents.isDestroyed() ? tab.surface.webContents : null;
  }

  navigate(id: number, input: string): void {
    const tab = this.tabs.get(id);
    if (!tab || tab.kind !== 'web') return;
    const url = normalizeAddress(input, webSearch);
    if (url) void tab.surface.webContents.loadURL(url).catch(() => undefined);
  }

  back(id: number): void {
    const wc = this.contents(id);
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  forward(id: number): void {
    const wc = this.contents(id);
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(id: number): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.error = null;
    tab.crashed = false;
    tab.surface.webContents.reload();
    this.queueEmit();
  }

  stop(id: number): void {
    this.contents(id)?.stop();
  }

  retryCheck(id: number): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.challengeLoop = false;
    this.challenges.reset(String(id));
    this.clearStuck(id);
    this.reload(id);
  }

  openExternally(id: number): boolean {
    const url = this.contents(id)?.getURL() ?? '';
    if (!/^https?:\/\//i.test(url)) return false;
    void shell.openExternal(url);
    return true;
  }

  setBounds(bounds: Bounds): void {
    this.bounds = bounds;
    this.layout();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.layout();
  }

  state(): BrowserTabsState {
    return { activeId: this.activeId, jobsId: this.jobsId, tabs: this.order.map((id) => this.snapshot(this.tabs.get(id)!)) };
  }

  dispose(): void {
    this.unsubscribe();
    for (const id of [...this.stuckTimers.keys()]) this.clearStuck(id);
    for (const id of [...this.order]) if (id !== this.jobsId) this.close(id);
  }


  private add(kind: Tab['kind'], surface: BrowserSurface): Tab {
    const tab: Tab = { id: this.nextId++, kind, surface, error: null, crashed: false, challengeLoop: false };
    this.tabs.set(tab.id, tab);
    this.order.push(tab.id);
    surface.mount();
    const wc = surface.webContents;
    watchContents(wc, () => (tab.kind === 'jobs' ? 'jobs tab' : `tab ${tab.id}`), this.opts.monitor);
    const update = () => this.queueEmit();
    wc.on('did-start-loading', update);
    wc.on('did-stop-loading', update);
    wc.on('page-title-updated', update);
    wc.on('did-navigate', update);
    wc.on('did-navigate-in-page', update);
    wc.on('did-start-navigation', (d) => {
      if (d.isMainFrame && !d.isSameDocument) {
        tab.error = null;
        tab.crashed = false;
      }
      update();
    });
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      tab.error = { code, description, url };
      update();
    });
    wc.on('render-process-gone', () => {
      tab.crashed = true;
      update();
    });
    return tab;
  }

  private wireWebTab(tab: Tab): void {
    const wc = tab.surface.webContents;
    const monitor = this.opts.monitor;
    const partition = monitor.partition;
    const secure = { partition, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, safeDialogs: true };
    const popupHandler = ({ url, disposition }: { url: string; disposition: string }) => {
      const target = url || 'about:blank';
      if (!isNavigable(target)) {
        monitor.diagnostics.record({ partition, source: `tab ${tab.id}`, kind: 'popup-blocked', url: target, detail: 'Not a web address' });
        return { action: 'deny' as const };
      }
      if (disposition === 'new-window') {
        monitor.diagnostics.record({ partition, source: `tab ${tab.id}`, kind: 'popup-opened', url: target });
        return {
          action: 'allow' as const,
          overrideBrowserWindowOptions: { parent: this.opts.window() ?? undefined, width: 520, height: 700, autoHideMenuBar: true, webPreferences: secure },
        };
      }
      this.open(target, disposition !== 'background-tab');
      return { action: 'deny' as const };
    };
    wc.setWindowOpenHandler(popupHandler);
    wc.on('did-create-window', (child) => {
      const cwc = child.webContents;
      watchContents(cwc, () => `pop-up from tab ${tab.id}`, monitor);
      cwc.setWindowOpenHandler(popupHandler);
      cwc.on('will-navigate', (e: { preventDefault(): void }, url: string) => {
        if (!isNavigable(url)) e.preventDefault();
      });
    });
    wc.on('will-navigate', (e, url) => {
      if (!isNavigable(url)) e.preventDefault();
    });
  }

  private onPageResponse(r: PageResponse): void {
    if (r.resourceType !== 'mainFrame' || r.webContentsId === undefined) return;
    const tab = [...this.tabs.values()].find((t) => !t.surface.webContents.isDestroyed() && t.surface.webContents.id === r.webContentsId);
    if (!tab) return;
    const key = String(tab.id);
    if (r.challenge) {
      if (this.challenges.note(key) >= CHALLENGE_LOOP_COUNT) this.notAccepted(tab, r.url, `Security check shown ${CHALLENGE_LOOP_COUNT} times within ${CHALLENGE_LOOP_WINDOW_MS / 60_000} minutes`);
      if (!this.stuckTimers.has(tab.id)) {
        this.stuckTimers.set(tab.id, setTimeout(() => {
          this.stuckTimers.delete(tab.id);
          const wc = tab.surface.webContents;
          if (this.tabs.get(tab.id) === tab && !wc.isDestroyed() && this.opts.monitor.onChallengePage(wc)) {
            this.notAccepted(tab, wc.getURL(), `Security check still showing after ${CHALLENGE_STUCK_MS / 1000} s`);
          }
        }, CHALLENGE_STUCK_MS));
      }
    } else if (r.status >= 200 && r.status < 300) {
      this.challenges.reset(key);
      this.clearStuck(tab.id);
      tab.challengeLoop = false;
    }
    this.queueEmit();
  }

  private notAccepted(tab: Tab, url: string, detail: string): void {
    if (tab.challengeLoop) return;
    tab.challengeLoop = true;
    this.opts.monitor.diagnostics.record({ partition: this.opts.monitor.partition, source: tab.kind === 'jobs' ? 'jobs tab' : `tab ${tab.id}`, kind: 'challenge-loop', url, detail });
    this.queueEmit();
  }

  private clearStuck(id: number): void {
    const t = this.stuckTimers.get(id);
    if (t) clearTimeout(t);
    this.stuckTimers.delete(id);
  }

  private snapshot(tab: Tab): BrowserTab {
    const wc = tab.surface.webContents;
    const alive = !wc.isDestroyed();
    return {
      id: tab.id,
      kind: tab.kind,
      title: alive ? wc.getTitle() : '',
      url: alive ? wc.getURL() : '',
      loading: alive && wc.isLoading(),
      canGoBack: alive && wc.navigationHistory.canGoBack(),
      canGoForward: alive && wc.navigationHistory.canGoForward(),
      challenge: alive && this.opts.monitor.onChallengePage(wc),
      challengeLoop: tab.challengeLoop,
      error: tab.error,
      crashed: tab.crashed,
    };
  }

  private layout(): void {
    const b = this.bounds;
    const show = this.visible && b.width > 0 && b.height > 0;
    for (const tab of this.tabs.values()) {
      const active = tab.id === this.activeId;
      if (show) tab.surface.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
      tab.surface.setVisible(show && active);
    }
  }

  private queueEmit(): void {
    if (this.emitQueued) return;
    this.emitQueued = true;
    setImmediate(() => {
      this.emitQueued = false;
      this.opts.emit(this.state());
    });
  }
}
