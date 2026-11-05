import { BrowserWindow, type WebContents } from 'electron';
import type { ClaudeChatCompleteRequest, ClaudeChatCompleteResult, ClaudeChatStatus } from '../src/platform/bridge';
import { CHALLENGE_LOOP_COUNT, CHALLENGE_LOOP_WINDOW_MS, CHALLENGE_STUCK_MS, isChallengeTitle, LoopDetector } from './browserPolicy';
import { BrowserDiagnostics, monitorSession, watchContents, type SessionMonitor } from './browserSession';
import { CLAUDE_PAGE_API } from './claudePage';

const PARTITION = 'persist:applyflow-claude';
const HOME = 'https://claude.ai/';
const NEW_CHAT = 'https://claude.ai/new';
const HELPER_WORLD = 4271;
const CHALLENGE_GRACE_MS = 20_000;
const CHALLENGE_PAUSE_MS = 15 * 60_000;
const CHALLENGE = 'Claude.ai wants a quick security check. Click the Claude.ai indicator and finish it in the window that opens. ApplyFlow will not bypass it.';
const CHALLENGE_IN_WINDOW = 'Claude.ai is running a security check. If it asks, confirm you’re human in the sign-in window. ApplyFlow will not bypass it.';
const SIGN_IN = 'Finish signing in to Claude.ai. ApplyFlow will not complete a CAPTCHA or security check for you.';
const CHALLENGE_LOOP = 'Claude.ai’s security check keeps coming back in ApplyFlow’s built-in browser, so it may not accept this browser on this network. ApplyFlow stopped reloading it. Try again later or from another network, or switch resume generation to the Claude API in Settings.';
const SIGN_IN_HOSTS = /(^|\.)(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com)$/i;

let monitor: SessionMonitor | null = null;

interface PageSnap {
  href: string;
  composer: boolean;
  sendEnabled: boolean;
  stop: boolean;
  assistant: string;
  model: string;
  challenge: boolean;
  signedOut: boolean;
  usageLimited: boolean;
  chatId: string | null;
}

type Failure = Extract<ClaudeChatCompleteResult, { ok: false }>;

export interface ClaudeChatController {
  status: () => ClaudeChatStatus;
  openLogin: () => void;
  signOut: () => Promise<void>;
  complete: (req: ClaudeChatCompleteRequest) => Promise<ClaudeChatCompleteResult>;
  cancel: (requestId: string) => void;
  dispose: () => void;
}

export function startClaudeChat(opts: {
  getWindow: () => BrowserWindow | null;
  emit: (status: ClaudeChatStatus) => void;
  diagnostics?: BrowserDiagnostics;
  onChallengeLoop?: (signInWindow: BrowserWindow) => void;
}): ClaudeChatController {
  let current: ClaudeChatStatus = { state: 'checking', detail: 'Checking Claude.ai…', checkedAt: null };
  let worker: BrowserWindow | null = null;
  let login: BrowserWindow | null = null;
  let lastLoad = 0;
  let challengeAt = 0;
  let tail: Promise<void> = Promise.resolve();
  const cancelled = new Set<string>();
  let checkTimer: ReturnType<typeof setInterval> | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  const loginChecks = new LoopDetector(CHALLENGE_LOOP_WINDOW_MS);
  let loopReported: BrowserWindow | null = null;
  const mon = monitorSession(PARTITION, opts.diagnostics ?? new BrowserDiagnostics());
  monitor = mon;
  const unsubscribe = mon.onPageResponse((r) => {
    const win = login;
    if (!win || win.isDestroyed() || r.resourceType !== 'mainFrame' || r.webContentsId !== win.webContents.id) return;
    if (!r.challenge) {
      if (r.status >= 200 && r.status < 300) loginChecks.reset('login');
      return;
    }
    if (loginChecks.note('login') >= CHALLENGE_LOOP_COUNT) checkNotAccepted(win, r.url, `Security check shown ${CHALLENGE_LOOP_COUNT} times within ${CHALLENGE_LOOP_WINDOW_MS / 60_000} minutes`);
  });

  const checkNotAccepted = (win: BrowserWindow, url: string, detail: string) => {
    if (loopReported === win || win.isDestroyed()) return;
    loopReported = win;
    mon.diagnostics.record({ partition: PARTITION, source: 'claude sign-in', kind: 'challenge-loop', url, detail });
    emit({ state: 'error', detail: CHALLENGE_LOOP, checkedAt: new Date().toISOString() });
    opts.onChallengeLoop?.(win);
  };

  const emit = (status: ClaudeChatStatus) => {
    current = status;
    opts.emit(status);
  };

  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };

  const loginOpen = () => !!login && !login.isDestroyed();

  const prefs = () => ({
    partition: PARTITION,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    backgroundThrottling: false,
    spellcheck: false,
  });

  const ensureWorker = (): WebContents => {
    if (worker && !worker.isDestroyed()) return worker.webContents;
    worker = new BrowserWindow({
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
    worker.setOpacity(0);
    worker.setIgnoreMouseEvents(true);
    worker.showInactive();
    return wc;
  };

  const stepAside = async () => {
    lastLoad = 0;
    if (!worker || worker.isDestroyed()) return;
    const wc = worker.webContents;
    if (!isClaudeUrl(safeUrl(wc))) return;
    try {
      await loadUrl(wc, 'about:blank', 5_000);
    } catch {
    }
  };

  const needUser = async (): Promise<Failure> => {
    challengeAt = Date.now();
    await stepAside();
    emit({ state: 'error', detail: CHALLENGE, checkedAt: new Date().toISOString() });
    return { ok: false, code: 'challenge', detail: CHALLENGE };
  };

  const scheduleCheck = () => {
    void enqueue(() => checkStatus());
  };

  const checkStatus = async () => {
    if (loginOpen()) return;
    if (challengeAt && Date.now() - challengeAt < CHALLENGE_PAUSE_MS) return;
    const showWait = current.state !== 'ready';
    if (showWait) emit({ state: 'checking', detail: 'Checking Claude.ai…', checkedAt: current.checkedAt });
    try {
      const wc = ensureWorker();
      const url = wc.getURL();
      const stale = Date.now() - lastLoad > 10 * 60_000;
      if (!isClaudeUrl(url) || stale) {
        if (showWait) emit({ state: 'connecting', detail: 'Opening Claude.ai…', checkedAt: current.checkedAt });
        await loadUrl(wc, HOME, 45_000);
        lastLoad = Date.now();
      }
      const snap = await readAuth(wc, 12_000, CHALLENGE_GRACE_MS);
      if (snap.challenge) {
        await needUser();
        return;
      }
      challengeAt = 0;
      emit(statusFromSnap(snap));
    } catch (e) {
      emit({ state: 'error', detail: e instanceof Error ? e.message : 'Could not reach Claude.ai.', checkedAt: new Date().toISOString() });
    }
  };

  const openLogin = () => {
    if (login && !login.isDestroyed()) {
      login.show();
      login.focus();
      return;
    }
    const closeWhenReady = current.state !== 'ready';
    challengeAt = 0;
    emit({ state: 'connecting', detail: SIGN_IN, checkedAt: current.checkedAt });
    loginChecks.reset('login');
    const parent = opts.getWindow() ?? undefined;
    login = new BrowserWindow({
      width: 1100,
      height: 840,
      title: 'Sign in to Claude.ai',
      autoHideMenuBar: true,
      backgroundColor: '#1f1f1f',
      parent,
      webPreferences: prefs(),
    });
    const win = login;
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (!/^https:\/\//i.test(url)) return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 760,
          autoHideMenuBar: true,
          parent: win,
          webPreferences: prefs(),
        },
      };
    });
    win.on('closed', () => {
      if (login === win) login = null;
      scheduleCheck();
    });
    void enqueue(stepAside);
    watchContents(win.webContents, () => 'claude sign-in', mon);
    void win.loadURL(NEW_CHAT).catch(() => undefined);
    void watchLogin(win, closeWhenReady);
  };

  const watchLogin = async (win: BrowserWindow, closeWhenReady: boolean) => {
    let challengeSince = 0;
    while (!win.isDestroyed()) {
      let snap: PageSnap | null = null;
      try {
        snap = await readAuth(win.webContents, 4_000);
      } catch {
        snap = null;
      }
      if (win.isDestroyed()) return;
      if (snap?.composer && !snap.signedOut && !snap.challenge && isClaudeUrl(snap.href)) {
        challengeAt = 0;
        emit({ state: 'ready', detail: 'Connected', checkedAt: new Date().toISOString() });
        if (closeWhenReady) {
          await delay(900);
          if (!win.isDestroyed()) win.close();
        }
        return;
      }
      if (snap?.challenge) {
        challengeSince ||= Date.now();
        if (Date.now() - challengeSince >= CHALLENGE_STUCK_MS) checkNotAccepted(win, safeUrl(win.webContents), `Security check still showing after ${CHALLENGE_STUCK_MS / 1000} s`);
      } else {
        challengeSince = 0;
      }
      if (loopReported === win) {
        if (current.detail !== CHALLENGE_LOOP) emit({ state: 'error', detail: CHALLENGE_LOOP, checkedAt: new Date().toISOString() });
      } else {
        emit({ state: 'connecting', detail: snap?.challenge ? CHALLENGE_IN_WINDOW : SIGN_IN, checkedAt: current.checkedAt });
      }
      await delay(1500);
    }
  };

  const signOut = () => enqueue(async () => {
    emit({ state: 'checking', detail: 'Signing out of Claude.ai…', checkedAt: current.checkedAt });
    await mon.reset();
    lastLoad = 0;
    challengeAt = 0;
    if (worker && !worker.isDestroyed()) {
      try {
        await loadUrl(worker.webContents, 'https://claude.ai/login', 30_000);
      } catch {  }
    }
    emit({ state: 'signed_out', detail: 'Signed out of Claude.ai. Click the indicator to sign in again.', checkedAt: new Date().toISOString() });
  });

  const cancel = (requestId: string) => {
    if (!requestId) return;
    cancelled.add(requestId);
    const wc = worker && !worker.isDestroyed() ? worker.webContents : null;
    if (!wc || !isClaudeUrl(safeUrl(wc)) || onChallengePage(wc)) return;
    void inPage(wc, 'globalThis.__afClaude && globalThis.__afClaude.clickStop()').catch(() => undefined);
  };

  const complete = (req: ClaudeChatCompleteRequest) => enqueue(() => runJob(req));

  const runJob = async (req: ClaudeChatCompleteRequest): Promise<ClaudeChatCompleteResult> => {
    const requestId = typeof req?.requestId === 'string' ? req.requestId : '';
    const prompt = typeof req?.prompt === 'string' ? req.prompt : '';
    const title = typeof req?.title === 'string' && req.title.trim() ? req.title.trim() : 'Company — Role';
    const timeoutMs = Math.min(10 * 60_000, Math.max(30_000, Number(req?.timeoutMs) || 180_000));
    if (!prompt.trim()) return { ok: false, code: 'input', detail: 'The prompt was empty.' };
    if (cancelled.has(requestId)) return { ok: false, code: 'cancelled', detail: 'Cancelled.' };
    if (loginOpen() && current.state !== 'ready') return { ok: false, code: 'signed_out', detail: 'Finish signing in to Claude.ai in the sign-in window, then try again.' };
    emit({ state: 'connecting', detail: `Writing “${title}” in Claude.ai…`, checkedAt: new Date().toISOString() });
    try {
      const wc = ensureWorker();
      await loadUrl(wc, NEW_CHAT, 60_000);
      lastLoad = Date.now();
      if (cancelled.has(requestId)) return { ok: false, code: 'cancelled', detail: 'Cancelled.' };
      const opened = await waitForComposer(wc, requestId);
      if (opened) return await settleFailure(opened);
      await ensureApi(wc);
      const inserted = await inPage(wc, `globalThis.__afPrompt = ${JSON.stringify(prompt)}; globalThis.__afClaude.insert()`, true);
      if (inserted !== true) return await settleFailure({ ok: false, code: 'input', detail: 'Claude.ai did not accept the prompt in the message box.' });
      let sent = await inPage(wc, 'globalThis.__afClaude.clickSend()', true);
      if (sent !== true) {
        await delay(600);
        sent = await inPage(wc, 'globalThis.__afClaude.clickSend()', true);
      }
      if (sent !== true) return await settleFailure({ ok: false, code: 'input', detail: 'Claude.ai did not enable Send. Sign in again from the sidebar if the session expired.' });
      const before = (await snap(wc)).assistant;
      const reply = await waitForReply(wc, requestId, timeoutMs, before, prompt);
      if (!reply.ok) return await settleFailure(reply);
      challengeAt = 0;
      const renamed = await renameChat(wc, title);
      emit({
        state: 'ready',
        detail: renamed ? 'Connected' : 'Connected. The resume was written, but Claude.ai kept its own chat title.',
        checkedAt: new Date().toISOString(),
      });
      return { ok: true, text: reply.text, model: reply.model, renamed };
    } catch (e) {
      if (cancelled.has(requestId)) return await settleFailure({ ok: false, code: 'cancelled', detail: 'Cancelled.' });
      const detail = e instanceof Error ? e.message : 'Could not reach Claude.ai.';
      emit({ state: 'error', detail, checkedAt: new Date().toISOString() });
      return { ok: false, code: /timeout/i.test(detail) ? 'timeout' : 'input', detail };
    } finally {
      cancelled.delete(requestId);
    }
  };

  const waitForComposer = async (wc: WebContents, requestId: string): Promise<Failure | null> => {
    const deadline = Date.now() + 45_000;
    let signedOutPolls = 0;
    let challengeSince = 0;
    while (Date.now() < deadline) {
      if (cancelled.has(requestId)) return { ok: false, code: 'cancelled', detail: 'Cancelled.' };
      const s = await snap(wc);
      if (s.challenge) {
        challengeSince ||= Date.now();
        if (Date.now() - challengeSince >= CHALLENGE_GRACE_MS || loginOpen()) return { ok: false, code: 'challenge', detail: CHALLENGE };
        await delay(500);
        continue;
      }
      challengeSince = 0;
      if (s.usageLimited) return { ok: false, code: 'limit', detail: 'Claude.ai reported a usage limit on this account.' };
      if (s.composer && !s.signedOut && isClaudeUrl(s.href)) return null;
      if (s.signedOut) {
        signedOutPolls += 1;
        if (signedOutPolls >= 3) return { ok: false, code: 'signed_out', detail: 'Claude.ai is signed out. Sign in from the sidebar indicator.' };
      }
      await delay(400);
    }
    return { ok: false, code: 'input', detail: 'Claude.ai did not show the message box. Sign in from the sidebar indicator and try again.' };
  };

  const waitForReply = async (wc: WebContents, requestId: string, timeoutMs: number, before: string, prompt: string): Promise<Extract<ClaudeChatCompleteResult, { ok: true }> | Failure> => {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    let stable = 0;
    let saw = false;
    let sawStop = false;
    while (Date.now() < deadline) {
      if (cancelled.has(requestId)) {
        await inPage(wc, 'globalThis.__afClaude && globalThis.__afClaude.clickStop()', true).catch(() => undefined);
        return { ok: false, code: 'cancelled', detail: 'Cancelled.' };
      }
      const s = await snap(wc);
      if (s.challenge) return { ok: false, code: 'challenge', detail: CHALLENGE };
      if (s.signedOut) return { ok: false, code: 'signed_out', detail: 'Claude.ai signed out while writing. Sign in again from the sidebar.' };
      if (s.usageLimited) return { ok: false, code: 'limit', detail: 'Claude.ai reported a usage limit on this account.' };
      if (s.stop) sawStop = true;
      const echo = echoedPrompt(s.assistant, prompt) || s.assistant.trim() === before.trim();
      const marker = /"company_name"|"companies"|company_name/.test(s.assistant);
      if (s.stop || (!echo && s.assistant !== last)) saw = true;
      if (!echo && marker && !s.stop && s.assistant === last) stable += 1;
      else stable = 0;
      if (stable >= 3 && (sawStop || stable >= 6)) return { ok: true, text: s.assistant, model: s.model || 'claude.ai', renamed: false };
      last = s.assistant;
      await delay(700);
    }
    return saw
      ? { ok: false, code: 'timeout', detail: 'Claude.ai was still writing when the time limit was reached.' }
      : { ok: false, code: 'timeout', detail: 'Claude.ai did not start a reply.' };
  };

  const renameChat = async (wc: WebContents, title: string): Promise<boolean> => {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      try {
        if (isClaudeUrl(safeUrl(wc)) && !onChallengePage(wc)) {
          await ensureApi(wc);
          const ok = await inPage(wc, `globalThis.__afTitle = ${JSON.stringify(title)}; globalThis.__afClaude.rename()`, true);
          if (ok === true) return true;
        }
      } catch {
      }
      await delay(700);
    }
    return false;
  };

  const settleFailure = async (res: Failure): Promise<Failure> => {
    if (res.code === 'challenge') await needUser();
    else if (res.code === 'signed_out') emit({ state: 'signed_out', detail: res.detail, checkedAt: new Date().toISOString() });
    else scheduleCheck();
    return res;
  };

  startupTimer = setTimeout(scheduleCheck, 2_500);
  checkTimer = setInterval(scheduleCheck, 90_000);

  return {
    status: () => current,
    openLogin,
    signOut,
    complete,
    cancel,
    dispose: () => {
      unsubscribe();
      if (startupTimer) clearTimeout(startupTimer);
      if (checkTimer) clearInterval(checkTimer);
      if (login && !login.isDestroyed()) login.destroy();
      if (worker && !worker.isDestroyed()) worker.destroy();
      login = null;
      worker = null;
    },
  };
}

function isClaudeUrl(url: string): boolean {
  return /^https:\/\/([^/]+\.)?claude\.ai\//i.test(url);
}

function onChallengePage(wc: WebContents): boolean {
  if (monitor) return monitor.onChallengePage(wc);
  try {
    return isChallengeTitle(wc.getTitle());
  } catch {
    return false;
  }
}

function onSignInPage(href: string): boolean {
  try {
    const u = new URL(href);
    return /\/login|\/magic-link/i.test(u.pathname) || SIGN_IN_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

function workerAllowed(url: string): boolean {
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

function statusFromSnap(snap: PageSnap): ClaudeChatStatus {
  const checkedAt = new Date().toISOString();
  if (snap.challenge) return { state: 'error', detail: CHALLENGE, checkedAt };
  if (snap.composer && !snap.signedOut && isClaudeUrl(snap.href)) return { state: 'ready', detail: 'Connected', checkedAt };
  if (snap.signedOut) return { state: 'signed_out', detail: 'Signed out. Click to sign in to Claude.ai.', checkedAt };
  return { state: 'error', detail: 'Could not confirm the Claude.ai session. Click the indicator to sign in.', checkedAt };
}

async function readAuth(wc: WebContents, budgetMs: number, challengeGraceMs = 0): Promise<PageSnap> {
  const start = Date.now();
  for (;;) {
    const last = await snap(wc);
    const elapsed = Date.now() - start;
    if (last.signedOut || (last.composer && isClaudeUrl(last.href))) return last;
    if (last.challenge ? elapsed >= challengeGraceMs : elapsed >= budgetMs) return last;
    await delay(400);
  }
}

async function snap(wc: WebContents): Promise<PageSnap> {
  const href = safeUrl(wc);
  if (onChallengePage(wc)) return { ...blankSnap(href), challenge: true };
  if (!isClaudeUrl(href)) return blankSnap(href);
  try {
    await ensureApi(wc);
    return normalizeSnap(await inPage(wc, 'globalThis.__afClaude.snapshot()'), href);
  } catch {
    return blankSnap(href);
  }
}

function inPage(wc: WebContents, code: string, userGesture = false): Promise<unknown> {
  return wc.executeJavaScriptInIsolatedWorld(HELPER_WORLD, [{ code }], userGesture);
}

async function ensureApi(wc: WebContents): Promise<void> {
  const ready = await inPage(wc, 'typeof globalThis.__afClaude==="object"&&typeof globalThis.__afClaude.snapshot==="function"').catch(() => false);
  if (ready === true) return;
  await inPage(wc, CLAUDE_PAGE_API);
}

function normalizeSnap(raw: unknown, href: string): PageSnap {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    href: typeof r.href === 'string' ? r.href : href,
    composer: r.composer === true,
    sendEnabled: r.sendEnabled === true,
    stop: r.stop === true,
    assistant: typeof r.assistant === 'string' ? r.assistant : '',
    model: typeof r.model === 'string' && r.model ? r.model : 'claude.ai',
    challenge: r.challenge === true,
    signedOut: r.signedOut === true,
    usageLimited: r.usageLimited === true,
    chatId: typeof r.chatId === 'string' ? r.chatId : null,
  };
}

function blankSnap(href: string): PageSnap {
  return { href, composer: false, sendEnabled: false, stop: false, assistant: '', model: 'claude.ai', challenge: false, signedOut: onSignInPage(href), usageLimited: false, chatId: null };
}

function safeUrl(wc: WebContents): string {
  try { return wc.getURL(); } catch { return ''; }
}

function loadUrl(wc: WebContents, url: string, timeoutMs: number): Promise<void> {
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

function echoedPrompt(assistant: string, prompt: string): boolean {
  const sample = assistant.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (sample.length < 24) return true;
  return prompt.replace(/\s+/g, ' ').includes(sample);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
