/**
 * ApplyFlow desktop — Electron main process.
 *
 *   ┌──────────────────────────── ApplyFlow window ───────────────────────────────┐
 *   │ nav │  built-in Dice browser (WebContentsView)      │  ApplyFlow panel       │
 *   │     │  dice-preload.cjs runs the page helper        │  (React, app://)       │
 *   └─────────────────────────────────────────────────────────────────────────────┘
 *
 * The React UI talks to this process only through the IPC methods in src/platform/bridge.ts.
 */
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, Notification, protocol, safeStorage, session, shell, WebContentsView } from 'electron';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from './db';
import { DiceInput, type TrustedRequest } from './diceInput';
import { backTargetIndex, DICE_SEARCH_HOME, isDiceApplicationUrl, isDiceSearchUrl, searchIndex } from '../src/services/platforms/dice/navigation';
import type { BridgeMethod, BrowserState } from '../src/platform/bridge';
import type { PanelToContent } from '../src/types/messages';

const APP_NAME = 'ApplyFlow';
const DICE_HOME = 'https://www.dice.com/';
const DICE_PARTITION = 'persist:dice';
const SECRET_KEY = 'applyflow.secret.anthropicApiKey.enc';
const REMINDERS_KEY = 'applyflow.reminders';
const SETTINGS_KEY = 'applyflow.settings.v1';
/** The last Dice search-results page you were on (kept across restarts). */
const LAST_SEARCH_KEY = 'applyflow.dice.lastSearchUrl';
// Ctrl+Alt alone is AltGr on many keyboards; with Shift it doesn't block typing anywhere.
const FIND_SHORTCUT = 'CommandOrControl+Alt+Shift+F';

app.setName(APP_NAME);
// Development/testing only: a separate data folder, and mock Dice pages (nothing reaches dice.com).
if (!app.isPackaged && process.env.APPLYFLOW_USER_DATA) app.setPath('userData', process.env.APPLYFLOW_USER_DATA);
const MOCK_DICE = !app.isPackaged ? process.env.APPLYFLOW_MOCK_DICE ?? '' : '';
if (process.platform === 'win32') app.setAppUserModelId('com.applyflow.desktop');

// One instance only: a second launch focuses the running window.
if (!app.requestSingleInstanceLock()) app.exit(0);

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const here = __dirname; // dist-electron/
const rendererDir = resolve(here, '../dist/renderer');
const iconPath = resolve(here, '../build/icon.png');

let win: BrowserWindow | null = null;
let dice: WebContentsView | null = null;
let diceReady = false;
let diceVisible = true;
let diceBounds = { x: 0, y: 0, width: 0, height: 0 };
let store: Store;
let mainWorldScript = '';
/** Real clicks and file-chooser answers for the Dice view (created when the app is ready). */
let diceInput: DiceInput | null = null;

// ---------------- helpers ----------------
function settings(): { saveLocation?: string } {
  return (store.kvGet(SETTINGS_KEY) as { saveLocation?: string } | undefined) ?? {};
}

/** Where documents are saved: the folder chosen in Settings, or Documents. */
function baseDir(): string {
  const chosen = settings().saveLocation;
  return chosen && isAbsolute(chosen) ? chosen : app.getPath('documents');
}

/** Resolve a relative path under the save location; refuses anything that escapes it. */
function safeJoin(base: string, rel: string): string {
  const target = resolve(base, normalize(rel.replace(/^[/\\]+/, '')));
  const r = relative(base, target);
  if (r.startsWith('..') || isAbsolute(r)) throw new Error('Refusing to write outside the save folder.');
  return target;
}

const pickedFolders = new Set<string>();

/** Only files ApplyFlow saved, or anything inside its save folder or data folder, may be opened or read. */
function allowedFile(p: string): boolean {
  if (typeof p !== 'string' || !isAbsolute(p)) return false;
  const target = resolve(p);
  const inside = (dir: string) => {
    const r = relative(resolve(dir), target);
    return r === '' || (!r.startsWith('..') && !isAbsolute(r));
  };
  if (inside(join(baseDir(), 'ApplyFlow')) || inside(app.getPath('userData'))) return true;
  return store.isKnownFile(p);
}

/** Never launch programs: only documents and folders open in their default app. */
const OPENABLE = /\.(pdf|docx?|txt|md|json|csv)$/i;

function uniquePath(p: string): string {
  if (!existsSync(p)) return p;
  const ext = extname(p);
  const stem = p.slice(0, p.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const c = `${stem} (${i})${ext}`;
    if (!existsSync(c)) return c;
  }
  return `${stem}-${Date.now()}${ext}`;
}

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function historyUrls(): { urls: string[]; active: number } {
  const h = dice?.webContents.navigationHistory;
  if (!h) return { urls: [], active: -1 };
  return { urls: h.getAllEntries().map((e) => e.url), active: h.getActiveIndex() };
}

function lastSearchUrl(): string | null {
  const v = store?.kvGet(LAST_SEARCH_KEY);
  return typeof v === 'string' && isDiceSearchUrl(v) ? v : null;
}

/** Remember the search-results page (Dice changes the query and page number in place). */
function rememberSearch(url: string): void {
  if (isDiceSearchUrl(url) && url !== lastSearchUrl()) store.kvSet(LAST_SEARCH_KEY, url);
}

/** Back, but out of Dice's application pages in one step (they redirect to themselves after you apply). */
function diceBack(): void {
  const h = dice?.webContents.navigationHistory;
  if (!h) return;
  const { urls, active } = historyUrls();
  const i = backTargetIndex(urls, active);
  if (i >= 0 && i !== active - 1) h.goToIndex(i);
  else if (h.canGoBack()) h.goBack();
}

/** Return to your search results: the same history entry when it's there (results and scroll kept), else reopen it. */
function diceBackToSearch(): void {
  const wc = dice?.webContents;
  if (!wc) return;
  const { urls, active } = historyUrls();
  const remembered = lastSearchUrl();
  let i = -1;
  if (remembered) i = urls.lastIndexOf(remembered, Math.max(0, active - 1));
  if (i < 0 || i >= active) i = searchIndex(urls, active);
  if (i >= 0) wc.navigationHistory.goToIndex(i);
  else void wc.loadURL(remembered ?? DICE_SEARCH_HOME);
}

function browserState(): BrowserState {
  const wc = dice?.webContents;
  const url = wc?.getURL() ?? '';
  const { urls, active } = historyUrls();
  return {
    url,
    title: wc?.getTitle() ?? '',
    searchUrl: lastSearchUrl() ?? (searchIndex(urls, active) >= 0 ? urls[searchIndex(urls, active)]! : null),
    onSearch: isDiceSearchUrl(url),
    onApplication: isDiceApplicationUrl(url),
    canGoBack: Boolean(wc?.navigationHistory.canGoBack()),
    canGoForward: Boolean(wc?.navigationHistory.canGoForward()),
    loading: Boolean(wc?.isLoading()),
    ready: diceReady,
  };
}

function focusWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------------- the built-in Dice browser ----------------
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
let nextRequest = 1;

function rejectPending(reason: string, only?: number[]): void {
  for (const [id, p] of pending) {
    if (only && !only.includes(id)) continue;
    clearTimeout(p.timer);
    p.reject(new Error(reason));
    pending.delete(id);
  }
}

function diceSend(msg: PanelToContent): Promise<unknown> {
  const wc = dice?.webContents;
  if (!wc || wc.isDestroyed() || !diceReady) return Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));
  const id = nextRequest++;
  // Employer forms: scans open each dropdown once, and fills type into autocompletes — allow time.
  const slow = ['AF_UPLOAD_DOCUMENT', 'AF_SUBMIT', 'AF_OPEN_APPLICATION', 'AF_SCAN_FIELDS', 'AF_FILL_FIELDS', 'AF_ANSWER_FIELD'];
  const timeoutMs = slow.includes(msg.type) ? 120_000 : 45_000;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rej(new Error('The Dice page did not answer in time.'));
    }, timeoutMs);
    pending.set(id, { resolve: res, reject: rej, timer });
    wc.send('af:request', { id, msg });
  });
}

function layoutDice(): void {
  if (!dice) return;
  const b = diceVisible && diceBounds.width > 0 && diceBounds.height > 0 ? diceBounds : { x: 0, y: 0, width: 0, height: 0 };
  dice.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
  dice.setVisible(diceVisible && b.width > 0);
}

/** Mock pages for Jobright and employer sites (tests/fixtures/jobright, development only). */
function mockSite(url: URL, dir: string): string | null {
  const jr = join(dir, '../jobright');
  const read = (f: string) => (existsSync(join(jr, f)) ? readFileSync(join(jr, f), 'utf8') : null);
  const h = url.hostname;
  const p = url.pathname;
  if (/(^|\.)jobright\.ai$/.test(h)) return /\/jobs\/info\//.test(p) ? read('jobright-job.html') : read('jobright-list.html');
  if (/^careers\.acme-robotics\.com$/.test(h)) return read('company-careers.html');
  if (/^boards\.greenhouse\.io$/.test(h)) return read('greenhouse-classic.html');
  if (/^job-boards\.greenhouse\.io$/.test(h)) return read('greenhouse-new.html');
  if (/^jobs\.lever\.co$/.test(h)) return read(/\/apply\/?$/.test(p) ? 'lever-apply.html' : /\/thanks\/?$/.test(p) ? 'lever-thanks.html' : 'lever-posting.html');
  if (/^jobs\.ashbyhq\.com$/.test(h)) return read(/\/application\/?$/.test(p) ? 'ashby-application.html' : 'ashby-overview.html');
  if (/myworkdayjobs\.com$/.test(h)) return read('workday.html');
  if (/(^|\.)linkedin\.com$/.test(h)) return read('linkedin.html');
  return null;
}

/** Serves tests/fixtures pages for dice.com, jobright.ai and mock employer sites (development only). */
function mockDice(ses: Electron.Session, dir: string): void {
  ses.protocol.handle('https', async (req) => {
    const url = new URL(req.url);
    if (!/(^|\.)dice\.com$/.test(url.hostname)) {
      const page = mockSite(url, dir);
      return page ? new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } }) : new Response('blocked in mock mode', { status: 403 });
    }
    const read = (f: string) => readFileSync(join(dir, f), 'utf8');
    if (url.pathname.endsWith('/__mock/mock-dice-wizard.js')) return new Response(read('mock-dice-wizard.cjs'), { headers: { 'content-type': 'application/javascript' } });
    let body = '<!doctype html><title>MockDice</title><h1>Mock Dice</h1><p><a href="/job-detail/3f9a1c2e-7b4d-4e8a-9c1f-2d6b8e0a5c71">Senior Architect</a></p>';
    if (url.pathname.includes('/job-detail/')) body = existsSync(join(dir, 'mock-job.html')) ? read('mock-job.html') : read('job-detail-jsonld.html');
    else if (url.pathname.includes('/job-applications/')) body = read(url.searchParams.has('real') ? 'wizard-realistic.html' : 'wizard-page.html');
    return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
}

/** Sign-in pop-ups keep their own window. */
const OAUTH_HOSTS = /accounts\.google\.com|appleid\.apple\.com|linkedin\.com\/oauth|login\.microsoftonline\.com|facebook\.com\/(v\d|dialog)/i;
/** When a job board just opened a blank tab (see setWindowOpenHandler). */
let pendingBlankTab = 0;

function createDiceView(): WebContentsView {
  const ses = session.fromPartition(DICE_PARTITION);
  if (MOCK_DICE) mockDice(ses, MOCK_DICE);
  // A plain Chrome user agent: sites treat the built-in browser like Chrome.
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|applyflow|ApplyFlow)\/\S+/gi, ''));
  const view = new WebContentsView({
    webPreferences: {
      partition: DICE_PARTITION,
      preload: join(here, 'dice-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  const wc = view.webContents;
  diceInput?.use(wc);
  wc.setWindowOpenHandler(({ url, features, disposition }) => {
    const opener = wc.getURL();
    const fromBoard = /^https:\/\/([^/]+\.)?(jobright\.ai|dice\.com)\//i.test(opener);
    // Jobright's Apply opens a blank tab first and sends it to the employer once it knows the address
    // (window.open() then tab.location = …). Let that tab exist, hidden, and bring its first real
    // address into this browser.
    if (fromBoard && (!url || /^about:blank/i.test(url))) {
      pendingBlankTab = Date.now();
      return { action: 'allow', overrideBrowserWindowOptions: { show: false, width: 400, height: 300, webPreferences: { partition: DICE_PARTITION, contextIsolation: true, sandbox: true } } };
    }
    if (!/^https?:/i.test(url)) return { action: 'deny' };
    // Job boards' "Apply" opening the employer's application: always in this browser, so ApplyFlow follows it.
    if (fromBoard && !OAUTH_HOSTS.test(url)) {
      void wc.loadURL(url);
      return { action: 'deny' };
    }
    // Real pop-ups (sign-in windows) open as small windows in the same browser profile.
    if (disposition === 'new-window' && features) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true, webPreferences: { partition: DICE_PARTITION, contextIsolation: true, sandbox: true } } };
    }
    // Dice opens jobs in new tabs; the built-in browser shows them in place (Back returns).
    void wc.loadURL(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => {
    if (!pendingBlankTab || Date.now() - pendingBlankTab > 2000) return;
    pendingBlankTab = 0;
    const cwc = child.webContents;
    let done = false;
    const adopt = (target: string) => {
      if (done || !/^https?:/i.test(target)) return;
      done = true;
      // A sign-in window keeps its own window; anything else comes into the built-in browser.
      if (OAUTH_HOSTS.test(target)) {
        child.setSize(520, 680);
        child.center();
        child.show();
        return;
      }
      void wc.loadURL(target);
      setImmediate(() => {
        if (!child.isDestroyed()) child.destroy();
      });
    };
    cwc.on('will-navigate', (e, target) => {
      if (OAUTH_HOSTS.test(target)) return adopt(target);
      e.preventDefault();
      adopt(target);
    });
    cwc.on('did-start-navigation', (d) => {
      if (d.isMainFrame) adopt(d.url);
    });
    cwc.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Never left behind: a blank tab nobody sent anywhere goes away.
    setTimeout(() => {
      if (!done && !child.isDestroyed()) child.destroy();
    }, 15_000);
  });
  const pushState = () => send('dice:state', browserState());
  wc.on('did-start-navigation', (details) => {
    // A new document: a file-chooser hand-off armed by the old page must not carry over.
    if (details.isMainFrame && !details.isSameDocument) void diceInput?.disarmAll();
    pushState();
  });
  // A new document replaced the page: its helper announces itself (AF_READY) once loaded.
  // Answers the old page sent just before it went away still arrive, so wait a moment
  // before giving up on requests that are still open.
  wc.on('did-navigate', (_e, url) => {
    rememberSearch(url);
    diceReady = false;
    const open = [...pending.keys()];
    setTimeout(() => rejectPending('Could not establish connection. The page changed.', open), 1500);
    pushState();
  });
  wc.on('dom-ready', () => {
    // The file-chooser helper stays dormant unless ApplyFlow is attaching a document (see fileChooserInterceptor.ts).
    if (mainWorldScript && /^https:\/\//i.test(wc.getURL())) void wc.executeJavaScript(mainWorldScript, false).catch(() => undefined);
    pushState();
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) rememberSearch(url);
    pushState();
  });
  wc.on('did-stop-loading', pushState);
  wc.on('page-title-updated', pushState);
  wc.on('render-process-gone', () => {
    void diceInput?.disarmAll();
    diceReady = false;
    rejectPending('The Dice page stopped responding.');
    pushState();
  });
  // Native dialogs in the page (beforeunload etc.) would block the helper; the user still sees them.
  wc.on('will-prevent-unload', (e) => e.preventDefault());
  return view;
}

// ---------------- IPC ----------------
type Handler = (...args: never[]) => unknown;

function registerIpc(): void {
  const h: Partial<Record<BridgeMethod, Handler>> = {
    'kv.get': (k: string) => store.kvGet(k),
    'kv.set': (k: string, v: unknown) => {
      // The save location can only become a folder the user picked in the folder dialog.
      if (k === SETTINGS_KEY && v && typeof v === 'object') {
        const next = v as { saveLocation?: string };
        const prev = settings().saveLocation ?? '';
        const devOverride = !app.isPackaged && Boolean(process.env.APPLYFLOW_USER_DATA);
        if (next.saveLocation && next.saveLocation !== prev && !pickedFolders.has(next.saveLocation) && !devOverride) next.saveLocation = prev;
      }
      store.kvSet(k, v);
    },
    'kv.remove': (k: string) => store.kvRemove(k),
    'secret.get': () => {
      const enc = store.kvGet(SECRET_KEY) as { v: string; enc: boolean } | undefined;
      if (!enc) return null;
      try {
        return enc.enc ? safeStorage.decryptString(Buffer.from(enc.v, 'base64')) : Buffer.from(enc.v, 'base64').toString('utf8');
      } catch {
        return null;
      }
    },
    'secret.set': (value: string) => {
      const ok = safeStorage.isEncryptionAvailable();
      const v = ok ? safeStorage.encryptString(value).toString('base64') : Buffer.from(value, 'utf8').toString('base64');
      store.kvSet(SECRET_KEY, { v, enc: ok });
    },
    'secret.remove': () => store.kvRemove(SECRET_KEY),
    'resumes.list': () => store.listResumes(),
    'resumes.get': (id: string) => store.getResume(id),
    'resumes.save': (r: Parameters<Store['saveResume']>[0]) => store.saveResume(r),
    'resumes.setDefault': (id: string) => store.setDefaultResume(id),
    'resumes.delete': (id: string) => store.deleteResume(id),
    'profile.get': () => store.getProfile(),
    'profile.save': (p: Parameters<Store['saveProfile']>[0]) => store.saveProfile(p),
    'sessions.get': (k: string) => store.getSession(k),
    'sessions.save': (s: Parameters<Store['saveSession']>[0]) => store.saveSession(s),
    'sessions.latest': (ms: number) => store.latestSession(ms),
    'sessions.delete': (k: string) => store.deleteSession(k),
    'applications.list': () => store.listApplications(),
    'applications.get': (id: string) => store.getApplication(id),
    'applications.byJobKey': (k: string) => store.applicationsByJobKey(k),
    'applications.save': (r: Parameters<Store['saveApplication']>[0]) => store.saveApplication(r),
    'applications.delete': (id: string) => store.deleteApplication(id),
    'applications.import': (rs: Parameters<Store['importApplications']>[0]) => store.importApplications(rs),
    'search.query': (q: string, limit?: number) => store.search(q, limit),
    'documents.upsert': (d: Parameters<Store['upsertDocument']>[0]) => store.upsertDocument(d),
    'documents.list': (f: Parameters<Store['listDocuments']>[0]) => store.listDocuments(f),
    'documents.get': (id: string) => store.getDocument(id),
    'documents.markSent': (appId: string, jobKey: string, versions?: Parameters<Store['markSent']>[2]) => store.markSent(appId, jobKey, versions),
    'contacts.list': (appId: string) => store.listContacts(appId),
    'contacts.save': (c: Parameters<Store['saveContact']>[0]) => store.saveContact(c),
    'contacts.delete': (id: string) => store.deleteContact(id),
    'usage.add': (u: Parameters<Store['addUsage']>[0]) => store.addUsage(u),
    'usage.summary': (f: Parameters<Store['usageSummary']>[0]) => store.usageSummary(f),
    'files.write': (f: { relativePath: string; bytes: Uint8Array; conflict: 'overwrite' | 'uniquify' }) => {
      let target = safeJoin(baseDir(), f.relativePath);
      mkdirSync(dirname(target), { recursive: true });
      if (f.conflict === 'uniquify') target = uniquePath(target);
      writeFileSync(target, Buffer.from(f.bytes));
      return { absolutePath: target };
    },
    'files.read': (p: string) => (allowedFile(p) && existsSync(p) ? new Uint8Array(readFileSync(p)) : null),
    'files.exists': (p: string) => allowedFile(p) && existsSync(p),
    'files.show': (p: string) => {
      if (!allowedFile(p) || !existsSync(p)) return false;
      shell.showItemInFolder(p);
      return true;
    },
    'files.open': (p: string) => {
      if (!allowedFile(p) || !existsSync(p)) return 'That file is not available.';
      const isDir = statSync(p).isDirectory();
      if (!isDir && !OPENABLE.test(p)) return 'ApplyFlow only opens documents.';
      return shell.openPath(p);
    },
    'files.saveAs': async (f: { defaultName: string; bytes: Uint8Array; filters?: { name: string; extensions: string[] }[] }) => {
      const r = await dialog.showSaveDialog(win!, { defaultPath: join(baseDir(), f.defaultName), filters: f.filters });
      if (r.canceled || !r.filePath) return null;
      writeFileSync(r.filePath, Buffer.from(f.bytes));
      return r.filePath;
    },
    'files.pickOpen': async (f: { filters?: { name: string; extensions: string[] }[] }) => {
      const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: f.filters });
      const p = r.filePaths[0];
      if (r.canceled || !p) return null;
      return { name: p.split(sep).pop() ?? p, bytes: new Uint8Array(readFileSync(p)) };
    },
    'files.pickFolder': async () => {
      const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], defaultPath: baseDir() });
      const p = r.canceled ? null : (r.filePaths[0] ?? null);
      if (p) pickedFolders.add(p);
      return p;
    },
    'files.baseDir': () => baseDir(),
    'dice.send': (msg: PanelToContent) => diceSend(msg),
    'dice.setBounds': (b: typeof diceBounds) => {
      // The window reports CSS pixels; the view is placed in window pixels (they differ when zoomed).
      const z = win?.webContents.getZoomFactor() ?? 1;
      diceBounds = { x: b.x * z, y: b.y * z, width: b.width * z, height: b.height * z };
      layoutDice();
    },
    'dice.setVisible': (v: boolean) => {
      diceVisible = v;
      layoutDice();
    },
    'dice.navigate': (url: string) => {
      const u = /^https?:\/\//i.test(url) ? url : /\.\w{2,}(\/|$)/.test(url) ? `https://${url}` : `https://www.dice.com/jobs?q=${encodeURIComponent(url)}`;
      void dice?.webContents.loadURL(u);
    },
    'dice.back': () => diceBack(),
    'dice.backToSearch': () => diceBackToSearch(),
    'dice.forward': () => dice?.webContents.navigationHistory.goForward(),
    'dice.reload': () => dice?.webContents.reload(),
    'dice.state': () => browserState(),
    'dice.clearSession': async () => {
      await session.fromPartition(DICE_PARTITION).clearStorageData();
      void dice?.webContents.loadURL(DICE_HOME);
    },
    'reminders.set': (r: { applicationId: string; whenIso: string; label: string }) => {
      const all = (store.kvGet(REMINDERS_KEY) as Record<string, { whenIso: string; label: string }> | undefined) ?? {};
      all[r.applicationId] = { whenIso: r.whenIso, label: r.label };
      store.kvSet(REMINDERS_KEY, all);
    },
    'reminders.clear': (id: string) => {
      const all = (store.kvGet(REMINDERS_KEY) as Record<string, unknown> | undefined) ?? {};
      delete all[id];
      store.kvSet(REMINDERS_KEY, all);
    },
    'app.info': () => ({ version: app.getVersion(), dataDir: app.getPath('userData'), dbPath: store.path, platform: process.platform }),
    'app.openExternal': (url: string) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    },
  };
  ipcMain.handle('af:invoke', async (e, method: BridgeMethod, args: unknown[]) => {
    if (e.sender !== win?.webContents) throw new Error('Not allowed.');
    const fn = h[method];
    if (!fn) throw new Error(`Unknown method ${method}`);
    return (fn as (...a: unknown[]) => unknown)(...(args ?? []));
  });

  // From the Dice page helper.
  ipcMain.on('af:response', (e, r: { id: number; result?: unknown; error?: string }) => {
    if (e.sender !== dice?.webContents) return;
    const p = pending.get(r.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(r.id);
    if (r.error !== undefined) p.reject(new Error(r.error));
    else p.resolve(r.result);
  });
  // Real input for an upload ApplyFlow started (see electron/diceInput.ts). Dice view, dice.com only.
  ipcMain.handle('af:trusted', async (e, req: TrustedRequest) => {
    const wc = dice?.webContents;
    if (!wc || e.sender !== wc || !diceInput) throw new Error('Not allowed.');
    // Dice, Jobright and the employer sites they lead to — https pages only.
    if (!/^https:\/\//i.test(wc.getURL())) throw new Error('Not a secure page.');
    // Development/testing only: exercise the scripted fallback.
    if (!app.isPackaged && process.env.APPLYFLOW_NO_TRUSTED) throw new Error('Real input is switched off.');
    return diceInput.handle(req);
  });
  ipcMain.on('af:event', (e, evt: { type: string }) => {
    if (e.sender !== dice?.webContents) return;
    if (evt?.type === 'AF_READY') {
      diceReady = true;
      send('dice:state', browserState());
      return;
    }
    send('dice:event', evt);
  });
}

// ---------------- reminders ----------------
const liveNotifications = new Set<Notification>();
function checkReminders(): void {
  const all = (store.kvGet(REMINDERS_KEY) as Record<string, { whenIso: string; label: string }> | undefined) ?? {};
  let changed = false;
  for (const [id, r] of Object.entries(all)) {
    if (Date.parse(r.whenIso) > Date.now()) continue;
    delete all[id];
    changed = true;
    if (!Notification.isSupported()) continue;
    const n = new Notification({ title: 'Follow-up due', body: r.label, icon: existsSync(iconPath) ? iconPath : undefined });
    liveNotifications.add(n);
    n.on('close', () => liveNotifications.delete(n));
    n.on('click', () => {
      liveNotifications.delete(n);
      focusWindow();
      send('app:navigate', { view: 'applications', focus: id });
    });
    n.show();
  }
  if (changed) store.kvSet(REMINDERS_KEY, all);
}

// ---------------- window ----------------
function createWindow(): void {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 680,
    title: APP_NAME,
    backgroundColor: '#F4F4F5',
    icon: existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined,
    show: false,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      plugins: true,
      spellcheck: true,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Links from the panel (employer sites, job pages) open in the built-in browser.
    if (/^https?:/i.test(url)) {
      void dice?.webContents.loadURL(url);
      send('app:navigate', { view: 'apply' });
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });

  dice = createDiceView();
  win.contentView.addChildView(dice);
  layoutDice();
  void dice.webContents.loadURL(DICE_HOME);

  void win.loadURL('app://applyflow/index.html');
  win.on('closed', () => {
    win = null;
    dice = null;
  });
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const nav = (view: string, label: string, accelerator?: string) => ({ label, accelerator, click: () => send('app:navigate', { view }) });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' as const }] : []),
      { label: 'File', submenu: [{ label: 'Open data folder', click: () => void shell.openPath(app.getPath('userData')) }, { label: 'Open documents folder', click: () => void shell.openPath(baseDir()) }, { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' }] },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          nav('apply', 'Apply', 'CmdOrCtrl+1'),
          nav('applications', 'Applications', 'CmdOrCtrl+2'),
          nav('library', 'Work history', 'CmdOrCtrl+3'),
          nav('studio', 'PDF Studio', 'CmdOrCtrl+4'),
          nav('settings', 'Settings', 'CmdOrCtrl+,'),
          { type: 'separator' },
          { label: 'Find an application…', accelerator: 'CmdOrCtrl+F', click: () => send('app:navigate', { view: 'applications', search: true }) },
          { type: 'separator' },
          { label: 'Reload Dice page', accelerator: 'F5', click: () => dice?.webContents.reload() },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }, { label: 'Dice page DevTools', click: () => dice?.webContents.openDevTools({ mode: 'detach' }) }]),
        ],
      },
      { role: 'windowMenu' },
    ]),
  );
}

app.on('second-instance', focusWindow);

app.whenReady().then(() => {
  const dataDir = app.getPath('userData');
  mkdirSync(dataDir, { recursive: true });
  store = new Store(join(dataDir, 'applyflow.sqlite'));
  diceInput = new DiceInput(join(app.getPath('temp'), 'ApplyFlow-uploads'));
  const mw = join(here, 'main-world.js');
  mainWorldScript = existsSync(mw) ? readFileSync(mw, 'utf8') : '';

  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = resolve(rendererDir, `.${decodeURIComponent(pathname)}`);
    if (!file.startsWith(rendererDir)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // Claude requests go straight from the ApplyFlow window to api.anthropic.com. Its page origin is
  // app://applyflow, so make sure the browser's CORS check accepts the API's answers.
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://api.anthropic.com/*'] }, (details, cb) => {
    const headers = { ...(details.responseHeaders ?? {}) };
    for (const k of Object.keys(headers)) if (/^access-control-allow-/i.test(k)) delete headers[k];
    headers['Access-Control-Allow-Origin'] = ['app://applyflow'];
    headers['Access-Control-Allow-Headers'] = ['*, authorization, content-type, anthropic-version, x-api-key, anthropic-dangerous-direct-browser-access'];
    headers['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS'];
    headers['Access-Control-Expose-Headers'] = ['request-id, retry-after, anthropic-ratelimit-requests-remaining'];
    cb(details.method === 'OPTIONS' ? { responseHeaders: headers, statusLine: 'HTTP/1.1 204 No Content' } : { responseHeaders: headers });
  });

  registerIpc();
  buildMenu();
  createWindow();
  setInterval(checkReminders, 60_000);
  setTimeout(checkReminders, 5_000);
  // When a recruiter calls: this shortcut brings ApplyFlow to the front with search ready.
  globalShortcut.register(FIND_SHORTCUT, () => {
    focusWindow();
    send('app:navigate', { view: 'applications', search: true });
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  diceInput?.cleanup();
  try {
    store?.close();
  } catch {
    /* already closed */
  }
});
