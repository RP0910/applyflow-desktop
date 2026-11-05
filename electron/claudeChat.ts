/**
 * Background Claude.ai session.
 *
 * The user signs in once in a normal window. Resume jobs then reuse that
 * persistent profile: one hidden window, one conversation per job, no CAPTCHA bypass.
 * Jobs are queued so two applications cannot type into the same chat.
 */
import { BrowserWindow, session, type WebContents } from 'electron';
import type { ClaudeChatCompleteRequest, ClaudeChatCompleteResult, ClaudeChatStatus } from '../src/platform/bridge';
import { CLAUDE_PAGE_API } from './claudePage';

const PARTITION = 'persist:applyflow-claude';
const HOME = 'https://claude.ai/';
const NEW_CHAT = 'https://claude.ai/new';
const CHALLENGE = 'Claude.ai is asking you to confirm it’s you. Finish that in the sign-in window. ApplyFlow will not bypass it.';

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
}): ClaudeChatController {
  let current: ClaudeChatStatus = { state: 'checking', detail: 'Checking Claude.ai…', checkedAt: null };
  let worker: BrowserWindow | null = null;
  let login: BrowserWindow | null = null;
  let lastLoad = 0;
  let tail: Promise<void> = Promise.resolve();
  const cancelled = new Set<string>();
  let checkTimer: ReturnType<typeof setInterval> | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let userAgentSet = false;

  const emit = (status: ClaudeChatStatus) => {
    current = status;
    opts.emit(status);
  };

  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };

  const claudeSession = () => {
    const ses = session.fromPartition(PARTITION);
    if (!userAgentSet) {
      ses.setUserAgent(chromeUserAgent());
      userAgentSet = true;
    }
    return ses;
  };

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
    claudeSession();
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
    wc.setBackgroundThrottling(false);
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    const block = (event: { preventDefault: () => void }, url: string) => {
      if (!workerAllowed(url)) event.preventDefault();
    };
    wc.on('will-navigate', block);
    wc.on('will-redirect', block);
    // Painted so the composer exists, but invisible and click-through so it never covers the app.
    worker.setOpacity(0);
    worker.setIgnoreMouseEvents(true);
    worker.showInactive();
    return wc;
  };

  const scheduleCheck = () => {
    void enqueue(() => checkStatus());
  };

  const checkStatus = async () => {
    if (login && !login.isDestroyed()) return;
    const showWait = current.state !== 'ready';
    if (showWait) emit({ state: 'checking', detail: 'Checking Claude.ai…', checkedAt: current.checkedAt });
    try {
      const wc = ensureWorker();
      const url = wc.getURL();
      const stale = Date.now() - lastLoad > 10 * 60_000;
      if (!/^https:\/\/([^/]+\.)?claude\.ai\//i.test(url) || stale) {
        if (showWait) emit({ state: 'connecting', detail: 'Opening Claude.ai…', checkedAt: current.checkedAt });
        await loadUrl(wc, HOME, 45_000);
        lastLoad = Date.now();
      }
      const snap = await readAuth(wc, 12_000);
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
    emit({ state: 'connecting', detail: 'Finish signing in to Claude.ai. ApplyFlow will not complete a CAPTCHA or security check for you.', checkedAt: current.checkedAt });
    claudeSession();
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
    void win.loadURL(NEW_CHAT);
    void watchLogin(win, closeWhenReady);
  };

  const watchLogin = async (win: BrowserWindow, closeWhenReady: boolean) => {
    while (!win.isDestroyed()) {
      let snap: PageSnap | null = null;
      try {
        snap = await readAuth(win.webContents, 4_000);
      } catch {
        snap = null;
      }
      if (win.isDestroyed()) return;
      if (snap?.composer && !snap.signedOut && !snap.challenge && /claude\.ai/i.test(snap.href)) {
        emit({ state: 'ready', detail: 'Connected', checkedAt: new Date().toISOString() });
        if (closeWhenReady) {
          await delay(900);
          if (!win.isDestroyed()) win.close();
        }
        return;
      }
      if (snap?.challenge) emit({ state: 'error', detail: CHALLENGE, checkedAt: new Date().toISOString() });
      else emit({ state: 'connecting', detail: 'Finish signing in to Claude.ai. ApplyFlow will not complete a CAPTCHA or security check for you.', checkedAt: current.checkedAt });
      await delay(1500);
    }
  };

  const signOut = () => enqueue(async () => {
    emit({ state: 'checking', detail: 'Signing out of Claude.ai…', checkedAt: current.checkedAt });
    await claudeSession().clearStorageData();
    lastLoad = 0;
    if (worker && !worker.isDestroyed()) {
      try { await loadUrl(worker.webContents, 'https://claude.ai/login', 30_000); } catch { /* the next check reports signed out */ }
    }
    emit({ state: 'signed_out', detail: 'Signed out of Claude.ai. Click the indicator to sign in again.', checkedAt: new Date().toISOString() });
  });

  const cancel = (requestId: string) => {
    if (!requestId) return;
    cancelled.add(requestId);
    const wc = worker && !worker.isDestroyed() ? worker.webContents : null;
    if (!wc) return;
    void wc.executeJavaScript('globalThis.__afClaude && globalThis.__afClaude.clickStop()').catch(() => undefined);
  };

  const complete = (req: ClaudeChatCompleteRequest) => enqueue(() => runJob(req));

  const runJob = async (req: ClaudeChatCompleteRequest): Promise<ClaudeChatCompleteResult> => {
    const requestId = typeof req?.requestId === 'string' ? req.requestId : '';
    const prompt = typeof req?.prompt === 'string' ? req.prompt : '';
    const title = typeof req?.title === 'string' && req.title.trim() ? req.title.trim() : 'Company — Role';
    const timeoutMs = Math.min(10 * 60_000, Math.max(30_000, Number(req?.timeoutMs) || 180_000));
    if (!prompt.trim()) return { ok: false, code: 'input', detail: 'The prompt was empty.' };
    if (cancelled.has(requestId)) return { ok: false, code: 'cancelled', detail: 'Cancelled.' };
    emit({ state: 'connecting', detail: `Writing “${title}” in Claude.ai…`, checkedAt: new Date().toISOString() });
    try {
      const wc = ensureWorker();
      await loadUrl(wc, NEW_CHAT, 60_000);
      lastLoad = Date.now();
      if (cancelled.has(requestId)) return { ok: false, code: 'cancelled', detail: 'Cancelled.' };
      const opened = await waitForComposer(wc, requestId);
      if (opened) return opened;
      const inserted = await wc.executeJavaScript(`globalThis.__afPrompt = ${JSON.stringify(prompt)}; globalThis.__afClaude.insert()`, true);
      if (inserted !== true) return { ok: false, code: 'input', detail: 'Claude.ai did not accept the prompt in the message box.' };
      let sent = await wc.executeJavaScript('globalThis.__afClaude.clickSend()', true);
      if (sent !== true) {
        await delay(600);
        sent = await wc.executeJavaScript('globalThis.__afClaude.clickSend()', true);
      }
      if (sent !== true) return { ok: false, code: 'input', detail: 'Claude.ai did not enable Send. Sign in again from the sidebar if the session expired.' };
      const before = (await snap(wc)).assistant;
      const reply = await waitForReply(wc, requestId, timeoutMs, before, prompt);
      if (!reply.ok) {
        applyFailure(reply);
        return reply;
      }
      const renamed = await renameChat(wc, title);
      emit({
        state: 'ready',
        detail: renamed ? 'Connected' : 'Connected. The resume was written, but Claude.ai kept its own chat title.',
        checkedAt: new Date().toISOString(),
      });
      return { ok: true, text: reply.text, model: reply.model, renamed };
    } catch (e) {
      if (cancelled.has(requestId)) return { ok: false, code: 'cancelled', detail: 'Cancelled.' };
      const detail = e instanceof Error ? e.message : 'Could not reach Claude.ai.';
      emit({ state: 'error', detail, checkedAt: new Date().toISOString() });
      return { ok: false, code: /timeout/i.test(detail) ? 'timeout' : 'input', detail };
    } finally {
      cancelled.delete(requestId);
    }
  };

  const waitForComposer = async (wc: WebContents, requestId: string): Promise<ClaudeChatCompleteResult | null> => {
    const deadline = Date.now() + 45_000;
    let signedOutPolls = 0;
    while (Date.now() < deadline) {
      if (cancelled.has(requestId)) return { ok: false, code: 'cancelled', detail: 'Cancelled.' };
      const s = await snap(wc);
      if (s.challenge) return { ok: false, code: 'challenge', detail: CHALLENGE };
      if (s.usageLimited) return { ok: false, code: 'limit', detail: 'Claude.ai reported a usage limit on this account.' };
      if (s.composer && !s.signedOut && /claude\.ai/i.test(s.href)) return null;
      if (s.signedOut) {
        signedOutPolls += 1;
        if (signedOutPolls >= 3) return { ok: false, code: 'signed_out', detail: 'Claude.ai is signed out. Sign in from the sidebar indicator.' };
      }
      await delay(400);
    }
    return { ok: false, code: 'input', detail: 'Claude.ai did not show the message box. Sign in from the sidebar indicator and try again.' };
  };

  const waitForReply = async (wc: WebContents, requestId: string, timeoutMs: number, before: string, prompt: string): Promise<Extract<ClaudeChatCompleteResult, { ok: true }> | Extract<ClaudeChatCompleteResult, { ok: false }>> => {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    let stable = 0;
    let saw = false;
    let sawStop = false;
    while (Date.now() < deadline) {
      if (cancelled.has(requestId)) {
        await wc.executeJavaScript('globalThis.__afClaude && globalThis.__afClaude.clickStop()', true).catch(() => undefined);
        return { ok: false, code: 'cancelled', detail: 'Cancelled.' };
      }
      const s = await snap(wc);
      if (s.challenge) return { ok: false, code: 'challenge', detail: CHALLENGE };
      if (s.signedOut) return { ok: false, code: 'signed_out', detail: 'Claude.ai signed out while writing. Sign in again from the sidebar.' };
      if (s.usageLimited) return { ok: false, code: 'limit', detail: 'Claude.ai reported a usage limit on this account.' };
      if (s.stop) sawStop = true;
      // The composer echo contains the prompt, including the words company_name. Only a new reply counts.
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
        await ensureApi(wc);
        const ok = await wc.executeJavaScript(`globalThis.__afTitle = ${JSON.stringify(title)}; globalThis.__afClaude.rename()`, true);
        if (ok === true) return true;
      } catch {
        /* the page may still be navigating to the new conversation */
      }
      await delay(700);
    }
    return false;
  };

  const applyFailure = (res: Extract<ClaudeChatCompleteResult, { ok: false }>) => {
    if (res.code === 'signed_out') emit({ state: 'signed_out', detail: res.detail, checkedAt: new Date().toISOString() });
    else if (res.code === 'challenge') emit({ state: 'error', detail: res.detail, checkedAt: new Date().toISOString() });
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
      if (startupTimer) clearTimeout(startupTimer);
      if (checkTimer) clearInterval(checkTimer);
      if (login && !login.isDestroyed()) login.destroy();
      if (worker && !worker.isDestroyed()) worker.destroy();
      login = null;
      worker = null;
    },
  };
}

function chromeUserAgent(): string {
  const chrome = process.versions.chrome || '140.0.0.0';
  const base = `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
  if (process.platform === 'darwin') return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${base}`;
  if (process.platform === 'linux') return `Mozilla/5.0 (X11; Linux x86_64) ${base}`;
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${base}`;
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
  if (snap.composer && !snap.signedOut && /claude\.ai/i.test(snap.href)) return { state: 'ready', detail: 'Connected', checkedAt };
  if (snap.signedOut) return { state: 'signed_out', detail: 'Signed out. Click to sign in to Claude.ai.', checkedAt };
  return { state: 'error', detail: 'Could not confirm the Claude.ai session. Click the indicator to sign in.', checkedAt };
}

async function readAuth(wc: WebContents, budgetMs: number): Promise<PageSnap> {
  const deadline = Date.now() + budgetMs;
  let last = blankSnap(wc.getURL());
  while (Date.now() < deadline) {
    last = await snap(wc);
    if (last.challenge || last.signedOut || (last.composer && /claude\.ai/i.test(last.href))) return last;
    await delay(400);
  }
  return last;
}

async function snap(wc: WebContents): Promise<PageSnap> {
  try {
    await ensureApi(wc);
    return normalizeSnap(await wc.executeJavaScript('globalThis.__afClaude.snapshot()'), wc.getURL());
  } catch {
    return blankSnap(safeUrl(wc));
  }
}

async function ensureApi(wc: WebContents): Promise<void> {
  const ready = await wc.executeJavaScript('typeof globalThis.__afClaude==="object"&&typeof globalThis.__afClaude.snapshot==="function"').catch(() => false);
  if (ready === true) return;
  await wc.executeJavaScript(CLAUDE_PAGE_API);
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
  return { href, composer: false, sendEnabled: false, stop: false, assistant: '', model: 'claude.ai', challenge: false, signedOut: /\/login/i.test(href), usageLimited: false, chatId: null };
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

/** True when the visible text is still the prompt we typed, not Claude's reply. */
function echoedPrompt(assistant: string, prompt: string): boolean {
  const sample = assistant.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (sample.length < 24) return true;
  return prompt.replace(/\s+/g, ' ').includes(sample);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
