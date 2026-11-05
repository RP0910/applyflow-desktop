import type { ClaudeChatCompleteRequest, ClaudeChatCompleteResult, ClaudeChatStatus } from '../src/platform/bridge';
import { CHALLENGE_LOOP_COUNT, CHALLENGE_LOOP_WINDOW_MS, CHALLENGE_STUCK_MS, LoopDetector } from './browserPolicy';
import { BrowserDiagnostics } from './browserSession';
import { CLAUDE_PARTITION, type ClaudeBrowser, type ClaudeTab } from './claudeBrowser';
import { CLAUDE_PAGE_API } from './claudePage';
import { claudeReplyBody, parseAssistantJson } from './claudeReply';

const HOME = 'https://claude.ai/';
const NEW_CHAT = 'https://claude.ai/new';
const CHALLENGE_GRACE_MS = 20_000;
const CHALLENGE_PAUSE_MS = 15 * 60_000;
const CHALLENGE = 'Claude.ai wants a quick security check. Click the Claude.ai indicator and finish it in the window that opens. ApplyFlow will not bypass it.';
const CHALLENGE_IN_WINDOW = 'Claude.ai is running a security check. If it asks, confirm you’re human in the sign-in window. ApplyFlow will not bypass it.';
const SIGN_IN = 'Finish signing in to Claude.ai. ApplyFlow will not complete a CAPTCHA or security check for you.';
const CHALLENGE_LOOP = 'Claude.ai’s security check keeps coming back, so it may not accept this browser on this network. ApplyFlow stopped reloading it. Try again later or from another network, or switch resume generation to the Claude API in Settings.';
const SIGN_IN_HOSTS = /(^|\.)(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com)$/i;

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
  emit: (status: ClaudeChatStatus) => void;
  openBrowser: () => Promise<ClaudeBrowser>;
  diagnostics?: BrowserDiagnostics;
  onChallengeLoop?: (closeSignIn: () => void) => void;
}): ClaudeChatController {
  let current: ClaudeChatStatus = { state: 'checking', detail: 'Checking Claude.ai…', checkedAt: null };
  let browser: ClaudeBrowser | null = null;
  let launching: Promise<ClaudeBrowser> | null = null;
  let stopResponses: (() => void) | null = null;
  let worker: ClaudeTab | null = null;
  let login: ClaudeTab | null = null;
  let loginStarting = false;
  let lastLoad = 0;
  let composerDirty = false;
  /** One Claude.ai thread per research title and one per resume title (retries reuse the same chat). */
  const chatSlots = new Map<string, ChatSlot>();
  let challengeAt = 0;
  let tail: Promise<void> = Promise.resolve();
  const cancelled = new Set<string>();
  let checkTimer: ReturnType<typeof setInterval> | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  const loginChecks = new LoopDetector(CHALLENGE_LOOP_WINDOW_MS);
  let loopReported: ClaudeTab | null = null;
  const diagnostics = opts.diagnostics ?? new BrowserDiagnostics();

  const getBrowser = (): Promise<ClaudeBrowser> => {
    if (browser?.alive()) return Promise.resolve(browser);
    if (browser && !launching) {
      browser.close();
      browser = null;
      worker = null;
    }
    launching ??= opts.openBrowser().then((b) => {
      stopResponses?.();
      browser = b;
      worker = null;
      stopResponses = b.onMainResponse((r) => {
        const tab = login;
        if (!tab || tab.isDestroyed() || r.tabId !== tab.id) return;
        if (!r.challenge) {
          if (r.status >= 200 && r.status < 300) loginChecks.reset('login');
          return;
        }
        if (loginChecks.note('login') >= CHALLENGE_LOOP_COUNT) checkNotAccepted(tab, r.url, `Security check shown ${CHALLENGE_LOOP_COUNT} times within ${CHALLENGE_LOOP_WINDOW_MS / 60_000} minutes`);
      });
      return b;
    }).finally(() => {
      launching = null;
    });
    return launching;
  };

  const checkNotAccepted = (tab: ClaudeTab, url: string, detail: string) => {
    if (loopReported === tab || tab.isDestroyed()) return;
    loopReported = tab;
    diagnostics.record({ partition: browser?.partition ?? CLAUDE_PARTITION, source: 'claude sign-in', kind: 'challenge-loop', url, detail });
    emit({ state: 'error', detail: CHALLENGE_LOOP, checkedAt: new Date().toISOString() });
    opts.onChallengeLoop?.(() => tab.close());
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

  const loginOpen = () => loginStarting || (!!login && !login.isDestroyed());

  const ensureWorker = async (): Promise<ClaudeTab> => {
    const b = await getBrowser();
    if (worker && !worker.isDestroyed()) return worker;
    worker = await b.openWorker();
    return worker;
  };

  const stepAside = async () => {
    lastLoad = 0;
    if (!worker || worker.isDestroyed()) return;
    const wc = worker;
    if (!isClaudeUrl(wc.getURL())) return;
    try {
      await wc.load('about:blank', 5_000);
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

  const sessionNotReady = (): Failure => {
    const detail = current.detail || 'Claude.ai is not connected. Click the sidebar indicator and wait until it says Connected, then tailor again.';
    if (current.state === 'signed_out') return { ok: false, code: 'signed_out', detail };
    return { ok: false, code: 'challenge', detail };
  };

  const checkStatus = async () => {
    if (loginOpen()) return;
    if (challengeAt && Date.now() - challengeAt < CHALLENGE_PAUSE_MS) return;
    const showWait = current.state !== 'ready';
    if (showWait) emit({ state: 'checking', detail: 'Checking Claude.ai…', checkedAt: current.checkedAt });
    try {
      const wc = await ensureWorker();
      const url = wc.getURL();
      const stale = Date.now() - lastLoad > 10 * 60_000;
      if (!isClaudeUrl(url) || stale) {
        if (showWait) emit({ state: 'connecting', detail: 'Opening Claude.ai…', checkedAt: current.checkedAt });
        await wc.load(HOME, 45_000);
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
      login.focus();
      return;
    }
    if (loginStarting) return;
    const closeWhenReady = current.state !== 'ready';
    challengeAt = 0;
    loginStarting = true;
    emit({ state: 'connecting', detail: SIGN_IN, checkedAt: current.checkedAt });
    loginChecks.reset('login');
    void enqueue(stepAside);
    void (async () => {
      try {
        const b = await getBrowser();
        const tab = await b.openLogin(NEW_CHAT);
        login = tab;
        tab.onClosed(() => {
          if (login === tab) login = null;
          scheduleCheck();
        });
        void watchLogin(tab, closeWhenReady);
      } catch (e) {
        emit({ state: 'error', detail: e instanceof Error ? `Could not open the Claude.ai sign-in window: ${e.message}` : 'Could not open the Claude.ai sign-in window.', checkedAt: new Date().toISOString() });
      } finally {
        loginStarting = false;
      }
    })();
  };

  const watchLogin = async (tab: ClaudeTab, closeWhenReady: boolean) => {
    let challengeSince = 0;
    while (!tab.isDestroyed()) {
      let snap: PageSnap | null = null;
      try {
        snap = await readAuth(tab, 4_000);
      } catch {
        snap = null;
      }
      if (tab.isDestroyed()) return;
      if (snap?.composer && !snap.signedOut && !snap.challenge && isClaudeUrl(snap.href)) {
        challengeAt = 0;
        emit({ state: 'ready', detail: 'Connected', checkedAt: new Date().toISOString() });
        if (closeWhenReady) {
          await delay(900);
          tab.close();
        }
        return;
      }
      if (snap?.challenge) {
        challengeSince ||= Date.now();
        if (Date.now() - challengeSince >= CHALLENGE_STUCK_MS) checkNotAccepted(tab, tab.getURL(), `Security check still showing after ${CHALLENGE_STUCK_MS / 1000} s`);
      } else {
        challengeSince = 0;
      }
      if (loopReported === tab) {
        if (current.detail !== CHALLENGE_LOOP) emit({ state: 'error', detail: CHALLENGE_LOOP, checkedAt: new Date().toISOString() });
      } else {
        emit({ state: 'connecting', detail: snap?.challenge ? CHALLENGE_IN_WINDOW : SIGN_IN, checkedAt: current.checkedAt });
      }
      await delay(1500);
    }
  };

  const signOut = () => enqueue(async () => {
    emit({ state: 'checking', detail: 'Signing out of Claude.ai…', checkedAt: current.checkedAt });
    try {
      await (await getBrowser()).reset();
    } catch {
    }
    lastLoad = 0;
    challengeAt = 0;
    chatSlots.clear();
    composerDirty = false;
    if (worker && !worker.isDestroyed()) {
      try {
        await worker.load('https://claude.ai/login', 30_000);
      } catch {
      }
    }
    emit({ state: 'signed_out', detail: 'Signed out of Claude.ai. Click the indicator to sign in again.', checkedAt: new Date().toISOString() });
  });

  const cancel = (requestId: string) => {
    if (!requestId) return;
    cancelled.add(requestId);
    const wc = worker && !worker.isDestroyed() ? worker : null;
    if (!wc || !isClaudeUrl(wc.getURL()) || wc.onChallengePage()) return;
    void wc.run('globalThis.__afClaude && globalThis.__afClaude.clickStop()').catch(() => undefined);
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
    if (current.state !== 'ready') await checkStatus();
    if (cancelled.has(requestId)) return { ok: false, code: 'cancelled', detail: 'Cancelled.' };
    if (current.state !== 'ready') return sessionNotReady();
    const research = /^Research\s*[—-]/i.test(title) || prompt.includes('"task":"company_research"');
    const step = (detail: string) => emit({ state: 'ready', detail, checkedAt: new Date().toISOString() });
    step(research ? 'Opening Claude.ai for company research…' : 'Opening Claude.ai for CV generation…');
    try {
      const wc = await ensureWorker();
      const slotKey = chatSlotKey(research, title);
      const savedChat = liveChatSlot(chatSlots, slotKey);
      let reused = false;
      if (wc.onChallengePage()) {
        step('Starting a new Claude.ai chat…');
        await wc.load(NEW_CHAT, 60_000);
        lastLoad = Date.now();
        composerDirty = false;
      } else if (savedChat && isExistingChatUrl(savedChat)) {
        step(research ? 'Continuing company research chat on Claude.ai…' : 'Continuing CV generation chat on Claude.ai…');
        if (wc.getURL() !== savedChat) await wc.load(savedChat, 60_000);
        reused = true;
        lastLoad = Date.now();
        composerDirty = false;
      } else if (research) {
        if (!isNewChatUrl(wc.getURL()) || composerDirty) {
          step('Starting a new Claude.ai chat…');
          await wc.load(NEW_CHAT, 60_000);
          lastLoad = Date.now();
        }
        composerDirty = false;
      } else {
        step('Starting a new Claude.ai chat…');
        await wc.load(NEW_CHAT, 60_000);
        lastLoad = Date.now();
        composerDirty = false;
      }
      if (cancelled.has(requestId)) return { ok: false, code: 'cancelled', detail: 'Cancelled.' };
      const opened = await waitForComposer(wc, requestId);
      if (opened) return await settleFailure(opened);
      await ensureApi(wc);
      composerDirty = true;
      step(research ? 'Sending company research to Claude.ai…' : 'Sending CV Generate prompt to Claude.ai…');
      const inserted = await wc.run(`globalThis.__afPrompt = ${JSON.stringify(prompt)}; globalThis.__afClaude.insert()`, true);
      if (inserted !== true) return await settleFailure({ ok: false, code: 'input', detail: 'Claude.ai did not accept the prompt in the message box.' });
      let sent = await wc.run('globalThis.__afClaude.clickSend()', true);
      if (sent !== true) {
        await delay(600);
        sent = await wc.run('globalThis.__afClaude.clickSend()', true);
      }
      if (sent !== true) return await settleFailure({ ok: false, code: 'input', detail: 'Claude.ai did not enable Send. Sign in again from the sidebar if the session expired.' });
      step(research ? 'Waiting for company research from Claude.ai…' : 'Waiting for CV JSON from Claude.ai…');
      const before = (await snap(wc)).assistant;
      const reply = await waitForReply(wc, requestId, timeoutMs, before, prompt, reused);
      if (!reply.ok) {
        rememberChatSlot(chatSlots, slotKey, wc.getURL());
        composerDirty = false;
        return await settleFailure(reply);
      }
      challengeAt = 0;
      rememberChatSlot(chatSlots, slotKey, wc.getURL());
      composerDirty = false;
      void renameChat(wc, title);
      emit({ state: 'ready', detail: 'Connected', checkedAt: new Date().toISOString() });
      return { ok: true, text: reply.text, model: reply.model, renamed: false };
    } catch (e) {
      if (cancelled.has(requestId)) return await settleFailure({ ok: false, code: 'cancelled', detail: 'Cancelled.' });
      const detail = e instanceof Error ? e.message : 'Could not reach Claude.ai.';
      emit({ state: 'error', detail, checkedAt: new Date().toISOString() });
      return { ok: false, code: /timeout/i.test(detail) ? 'timeout' : 'input', detail };
    } finally {
      cancelled.delete(requestId);
      if (current.state === 'ready' && current.detail.startsWith('Writing ')) emit({ ...current, detail: 'Connected' });
    }
  };

  const waitForComposer = async (wc: ClaudeTab, requestId: string): Promise<Failure | null> => {
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

  const waitForReply = async (wc: ClaudeTab, requestId: string, timeoutMs: number, before: string, prompt: string, reused: boolean): Promise<Extract<ClaudeChatCompleteResult, { ok: true }> | Failure> => {
    const deadline = Date.now() + timeoutMs;
    // In a reused chat the previous answer is still on screen; never hand it back as the new reply.
    const stale = reused ? parseAssistantJson(before, prompt) : null;
    let saw = false;
    let lastJson: string | null = null;
    let jsonStable = 0;
    let lastSnap: PageSnap | null = null;
    let lastBody = '';
    while (Date.now() < deadline) {
      if (cancelled.has(requestId)) {
        await wc.run('globalThis.__afClaude && globalThis.__afClaude.clickStop()', true).catch(() => undefined);
        return { ok: false, code: 'cancelled', detail: 'Cancelled.' };
      }
      const s = await snap(wc);
      lastSnap = s;
      if (s.challenge) return { ok: false, code: 'challenge', detail: CHALLENGE };
      if (s.signedOut) return { ok: false, code: 'signed_out', detail: 'Claude.ai signed out while writing. Sign in again from the sidebar.' };
      if (s.usageLimited) return { ok: false, code: 'limit', detail: 'Claude.ai reported a usage limit on this account.' };
      const body = claudeReplyBody(s.assistant, prompt);
      lastBody = s.assistant;
      const prior = before.replace(/\s+/g, ' ').trim();
      const flat = (body || s.assistant).replace(/\s+/g, ' ').trim();
      if (flat.length >= 24 && flat !== prior && !prior.includes(flat)) saw = true;
      if (s.stop || flat.length >= 24) saw = true;
      const found = parseAssistantJson(s.assistant, prompt);
      const json = found && found !== stale ? found : null;
      if (json) {
        jsonStable = json === lastJson ? jsonStable + 1 : 0;
        lastJson = json;
        if (!s.stop) {
          return { ok: true, text: json, model: s.model || 'claude.ai', renamed: false };
        }
        if (jsonStable >= 1) {
          return { ok: true, text: json, model: s.model || 'claude.ai', renamed: false };
        }
      } else {
        jsonStable = 0;
        lastJson = null;
      }
      await delay(700);
    }
    const tail = (lastSnap ? parseAssistantJson(lastSnap.assistant, prompt) : null);
    if (tail && tail !== stale) return { ok: true, text: tail, model: lastSnap?.model || 'claude.ai', renamed: false };
    return saw
      ? { ok: false, code: 'timeout', detail: 'Claude.ai finished on screen but ApplyFlow could not read the JSON. Copy the reply into a new chat or try again.' }
      : { ok: false, code: 'timeout', detail: 'Claude.ai did not start a reply.' };
  };

  const renameChat = async (wc: ClaudeTab, title: string): Promise<boolean> => {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      try {
        if (isClaudeUrl(wc.getURL()) && !wc.onChallengePage()) {
          await ensureApi(wc);
          const ok = await wc.run(`globalThis.__afTitle = ${JSON.stringify(title)}; globalThis.__afClaude.rename()`, true);
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
      stopResponses?.();
      stopResponses = null;
      if (startupTimer) clearTimeout(startupTimer);
      if (checkTimer) clearInterval(checkTimer);
      browser?.close();
      browser = null;
      login = null;
      worker = null;
    },
  };
}

function isClaudeUrl(url: string): boolean {
  return /^https:\/\/([^/]+\.)?claude\.ai\//i.test(url);
}

function isNewChatUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)claude\.ai$/i.test(u.hostname) && /^\/new\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

function isExistingChatUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)claude\.ai$/i.test(u.hostname) && /^\/chat\/[0-9a-f-]{36}\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

function chatSlotKey(research: boolean, title: string): string {
  const kind = research ? 'research' : 'resume';
  const norm = title.replace(/\s+/g, ' ').trim().toLowerCase();
  return `${kind}:${norm}`;
}

/** Reuse a chat only within one Tailor & Apply run (retries and the refine pass), not days later. */
const CHAT_SLOT_TTL_MS = 30 * 60_000;

type ChatSlot = { url: string; at: number };

function liveChatSlot(slots: Map<string, ChatSlot>, key: string): string | undefined {
  const now = Date.now();
  for (const [k, slot] of slots) if (now - slot.at > CHAT_SLOT_TTL_MS) slots.delete(k);
  return slots.get(key)?.url;
}

function rememberChatSlot(slots: Map<string, ChatSlot>, key: string, url: string): void {
  if (isExistingChatUrl(url)) slots.set(key, { url, at: Date.now() });
}

function onSignInPage(href: string): boolean {
  try {
    const u = new URL(href);
    return /\/login|\/magic-link/i.test(u.pathname) || SIGN_IN_HOSTS.test(u.hostname);
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

async function readAuth(wc: ClaudeTab, budgetMs: number, challengeGraceMs = 0): Promise<PageSnap> {
  const start = Date.now();
  for (;;) {
    const last = await snap(wc);
    const elapsed = Date.now() - start;
    if (last.signedOut || (last.composer && isClaudeUrl(last.href))) return last;
    if (last.challenge ? elapsed >= challengeGraceMs : elapsed >= budgetMs) return last;
    await delay(400);
  }
}

async function snap(wc: ClaudeTab): Promise<PageSnap> {
  const href = wc.getURL();
  if (wc.onChallengePage()) return { ...blankSnap(href), challenge: true };
  if (!isClaudeUrl(href)) return blankSnap(href);
  try {
    await ensureApi(wc);
    return normalizeSnap(await wc.run('globalThis.__afClaude.snapshot()'), href);
  } catch {
    return blankSnap(href);
  }
}

async function ensureApi(wc: ClaudeTab): Promise<void> {
  const ready = await wc.run('typeof globalThis.__afClaude==="object"&&typeof globalThis.__afClaude.snapshot==="function"').catch(() => false);
  if (ready === true) return;
  await wc.run(CLAUDE_PAGE_API);
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
