import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, session: {}, BrowserWindow: class {} }));

import type { ClaudeChatStatus } from '@/platform/bridge';
import type { ClaudeBrowser, ClaudeTab } from '../../electron/claudeBrowser';
import type { BrowserDiagnostics } from '../../electron/browserSession';
import { startClaudeChat, type ClaudeChatController } from '../../electron/claudeChat';
import { claudeReplyReady, extractClaudeJson, parseAssistantJson } from '../../electron/claudeReply';

const NEW_CHAT = 'https://claude.ai/new';
const REPLY = '{"companies":[{"periodIndex":0,"name":"Northwind","activeYears":"2020","techFit":"platforms","hq":"Austin, TX"}]}';

class FakeTab implements ClaudeTab {
  readonly id = 1;
  url = 'about:blank';
  loads: string[] = [];
  composerText = '';
  signedIn = true;
  sendWorks = true;
  onLoad: (() => void) | null = null;
  polls = -1;
  /** What the next send answers with. */
  reply = REPLY;
  private answering = REPLY;
  private chatSeq = 0;
  /** Last finished answer per chat URL, shown again when that chat is reopened. */
  private chats = new Map<string, string>();
  private onScreen = '';
  /** When set, the on-screen reply text ApplyFlow reads (e.g. a layout it can't parse). */
  domText: string | null = null;
  /** The conversation as Claude.ai's API returns it; null = the page helper can't read it. */
  conversation: { prompt: string; text: string; done: boolean } | null = null;

  getURL() { return this.url; }
  getTitle() { return 'Claude'; }
  isDestroyed() { return false; }
  onChallengePage() { return false; }
  focus() {}
  closed = 0;
  /** Page scripts that never answer (a frozen page): the next N snapshot calls hang. */
  hangSnapshots = 0;
  workers = 0;
  close() { this.closed++; }
  onClosed() {}

  /** 'late': the page arrives but its load event never fires in time; 'stuck': the navigation never happens. */
  loadTrouble: 'late' | 'stuck' | null = null;

  async load(url: string) {
    this.loads.push(url);
    if (this.loadTrouble === 'stuck') throw new Error('Could not open Claude.ai before the time limit.');
    this.url = url === 'https://claude.ai/' ? NEW_CHAT : url;
    this.composerText = '';
    this.polls = -1;
    this.onScreen = this.chats.get(this.url) ?? '';
    this.onLoad?.();
    if (this.loadTrouble === 'late') throw new Error('Could not open Claude.ai before the time limit.');
  }

  async run(code: string): Promise<unknown> {
    if (this.hangSnapshots > 0 && code.includes('snapshot()')) {
      this.hangSnapshots--;
      return new Promise(() => undefined);
    }
    if (code.startsWith('typeof globalThis.__afClaude')) return true;
    if (code.includes('__afClaude.insert()')) {
      const m = /globalThis\.__afPrompt = ("(?:[^"\\]|\\.)*")/.exec(code);
      this.composerText += m ? JSON.parse(m[1]!) as string : '';
      return true;
    }
    if (code.includes('clickSend()')) {
      if (!this.sendWorks) return false;
      if (!/^https:\/\/claude\.ai\/chat\//.test(this.url)) {
        this.chatSeq += 1;
        const id = String(this.chatSeq).padStart(8, '0');
        this.url = `https://claude.ai/chat/${id}-0000-0000-0000-000000000000`;
      }
      this.answering = this.reply;
      this.polls = 0;
      return true;
    }
    if (code.includes('rename()')) return true;
    if (code.includes('readReply')) return this.conversation ? { ok: true, humans: 1, ...this.conversation } : { ok: false, why: 'conversation 404' };
    if (code.includes('snapshot()')) {
      // Right after Send in a reused chat, the previous answer is still the newest one on screen
      // and Claude.ai has not shown its stop control yet.
      const queued = (this.polls === 0 || this.polls === 1) && this.onScreen !== '';
      const streaming = this.polls >= 0 && this.polls < 3;
      const done = this.polls >= 3;
      if (this.polls >= 0) this.polls += 1;
      if (done) {
        this.onScreen = this.answering;
        this.chats.set(this.url, this.answering);
      }
      const partial = this.answering.slice(0, 40);
      return {
        href: this.url,
        composer: this.signedIn,
        sendEnabled: true,
        stop: streaming && !queued,
        // While queued the old answer is still the newest one; nothing follows the new prompt yet.
        fresh: (streaming || done) && !queued,
        assistant: this.domText ?? (done ? this.answering : queued ? this.onScreen : streaming ? partial : this.onScreen),
        model: 'claude.ai',
        challenge: false,
        signedOut: !this.signedIn,
        usageLimited: false,
        chatId: null,
      };
    }
    return undefined;
  }
}

function fakeBrowser(tab: FakeTab): ClaudeBrowser {
  return {
    kind: 'chrome',
    partition: 'test',
    alive: () => true,
    openWorker: async () => {
      tab.workers++;
      return tab;
    },
    openLogin: async () => tab,
    onMainResponse: () => () => undefined,
    reset: async () => undefined,
    close: () => undefined,
  };
}

const recorded: { kind: string; detail?: string }[] = [];
const diagnostics = { record: (e: { kind: string; detail?: string }) => void recorded.push(e) } as unknown as BrowserDiagnostics;

async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  void p.finally(() => { done = true; });
  for (let i = 0; i < 2000 && !done; i++) await vi.advanceTimersByTimeAsync(250);
  return p;
}

describe('Claude.ai Chat job runner', () => {
  let tab: FakeTab;
  let seen: ClaudeChatStatus[];
  let chat: ClaudeChatController;

  beforeEach(async () => {
    vi.useFakeTimers();
    tab = new FakeTab();
    seen = [];
    chat = startClaudeChat({ emit: (s) => seen.push(s), openBrowser: async () => fakeBrowser(tab), diagnostics });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(chat.status().state).toBe('ready');
    seen = [];
  });

  afterEach(() => {
    chat.dispose();
    vi.useRealTimers();
  });

  it('keeps a connected session connected while writing, and returns the reply', async () => {
    const res = await settle(chat.complete({ requestId: 'r1', prompt: 'Research the employers. Reply with JSON.', title: 'American Red Cross — Associate', timeoutMs: 60_000 }));
    expect(res).toMatchObject({ ok: true, text: REPLY });
    expect(seen.map((s) => s.state)).not.toContain('connecting');
    expect(seen.map((s) => s.state)).not.toContain('checking');
    expect(chat.status()).toMatchObject({ state: 'ready', detail: 'Connected' });
  });

  it('starts the resume chat when /new is usable even though its load event came late', async () => {
    await settle(chat.complete({ requestId: 'r1', prompt: 'Research employers. Reply with JSON.', title: 'Research — Progyny — Analyst', timeoutMs: 60_000 }));
    tab.loadTrouble = 'late';
    const res = await settle(chat.complete({ requestId: 'r2', prompt: 'Write resume JSON for this role.', title: 'Progyny — Analyst', timeoutMs: 60_000 }));
    expect(res).toMatchObject({ ok: true, text: REPLY });
    expect(tab.composerText).toBe('Write resume JSON for this role.');
  });

  it('never sends the resume prompt into the research chat when /new did not open', async () => {
    await settle(chat.complete({ requestId: 'r1', prompt: 'Research employers. Reply with JSON.', title: 'Research — Progyny — Analyst', timeoutMs: 60_000 }));
    const researchChat = tab.url;
    tab.composerText = '';
    tab.loadTrouble = 'stuck';
    const res = await settle(chat.complete({ requestId: 'r2', prompt: 'Write resume JSON for this role.', title: 'Progyny — Analyst', timeoutMs: 60_000 }));
    expect(res.ok).toBe(false);
    expect(tab.url).toBe(researchChat);
    expect(tab.composerText).toBe('');
  });

  it('replaces the tab when a page never opened in time, so the retry does not reuse it', async () => {
    await settle(chat.complete({ requestId: 'r0', prompt: 'Research employers. Reply with JSON.', title: 'Research — Acme — Engineer', timeoutMs: 60_000 }));
    tab.loadTrouble = 'stuck';
    const before = tab.workers;
    const res = await settle(chat.complete({ requestId: 'r1', prompt: 'Write resume JSON for this role.', title: 'Acme — Engineer', timeoutMs: 60_000 }));
    expect(res).toMatchObject({ ok: false, code: 'input' });
    expect(tab.closed).toBeGreaterThan(0);
    tab.loadTrouble = null;
    const again = await settle(chat.complete({ requestId: 'r2', prompt: 'Write resume JSON for this role.', title: 'Acme — Engineer', timeoutMs: 60_000 }));
    expect(again.ok).toBe(true);
    expect(tab.workers).toBe(before + 1);
  });

  it('uses one chat each for research, job titles and the CV of a target job, and retries continue in that chat', async () => {
    const ask = async (requestId: string, title: string, prompt: string) => {
      const res = await settle(chat.complete({ requestId, prompt, title, timeoutMs: 60_000 }));
      expect(res.ok).toBe(true);
      return tab.url;
    };
    const research = await ask('a1', 'Research — Acme — PM', '{"task":"company_research"} Reply with JSON.');
    const titles = await ask('a2', 'Titles — Acme — PM', '{"task":"suggest_role_titles"} Reply with JSON.');
    const cv = await ask('a3', 'Acme — PM', 'Write the CV JSON for this role.');
    expect(new Set([research, titles, cv]).size).toBe(3);
    // Retries (and the CV refine pass) go back to the chat of the same kind.
    expect(await ask('a4', 'Titles — Acme — PM', '{"task":"suggest_role_titles"} Reply with JSON again.')).toBe(titles);
    expect(await ask('a5', 'Acme — PM', 'Revise the CV JSON.')).toBe(cv);
    expect(await ask('a6', 'Research — Acme — PM', '{"task":"company_research"} Reply with JSON again.')).toBe(research);
    // Another target job gets its own three chats.
    const other = await ask('b1', 'Titles — Globex — PM', '{"task":"suggest_role_titles"} Reply with JSON.');
    expect([research, titles, cv]).not.toContain(other);
  });

  it('lets Claude.ai finish writing a short JSON reply before the job ends, so the next job can leave the chat', async () => {
    // A job-titles reply is complete JSON in the conversation while the page still shows Stop.
    tab.conversation = { prompt: 'Suggest titles. Reply with JSON.', text: REPLY, done: false };
    const res = await settle(chat.complete({ requestId: 't1', prompt: 'Suggest titles. Reply with JSON.', title: 'Titles — Acme — PM', timeoutMs: 60_000 }));
    expect(res.ok).toBe(true);
    // Streaming ends after 3 snapshots; the job returned only once a snapshot showed it had stopped.
    expect(tab.polls).toBeGreaterThanOrEqual(4);
  });

  it('records where a failed job stopped and why, for the diagnostics report', async () => {
    recorded.length = 0;
    tab.sendWorks = false;
    const res = await settle(chat.complete({ requestId: 'r1', prompt: 'Research employers. Reply with JSON.', title: 'Research — Acme — Engineer', timeoutMs: 60_000 }));
    expect(res.ok).toBe(false);
    expect(recorded.filter((e) => e.kind === 'chat-failed').map((e) => e.detail)).toEqual([
      'Sending company research to Claude.ai → input: Claude.ai did not enable Send. Sign in again from the sidebar if the session expired.',
    ]);
  });

  it('a frozen Claude.ai page ends the job with a clear error, and the retry gets a fresh tab', async () => {
    const before = tab.workers;
    tab.hangSnapshots = 1;
    const started = Date.now();
    const res = await settle(chat.complete({ requestId: 'r1', prompt: 'Research employers. Reply with JSON.', title: 'Research — Medasource — Salesforce Administrator', timeoutMs: 180_000 }));
    expect(res).toMatchObject({ ok: false, code: 'input' });
    expect(res.ok ? '' : res.detail).toMatch(/stopped responding.*fresh Claude\.ai tab/);
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(tab.closed).toBe(1);
    const retry = await settle(chat.complete({ requestId: 'r2', prompt: 'Research employers. Reply with JSON.', title: 'Research — Medasource — Salesforce Administrator', timeoutMs: 180_000 }));
    expect(retry).toMatchObject({ ok: true, text: REPLY });
    expect(tab.workers).toBe(before + 1);
  });

  it('reads the reply from the conversation when the page text cannot be parsed', async () => {
    const prompt = 'Research the employers for this role. Reply with one JSON object only.';
    tab.domText = 'Claude can make mistakes. Please double-check responses.';
    tab.conversation = { prompt, text: REPLY, done: true };
    const res = await settle(chat.complete({ requestId: 'r1', prompt, title: 'Research — Medasource — Salesforce Administrator', timeoutMs: 60_000 }));
    expect(res).toMatchObject({ ok: true, text: REPLY });
  });

  it('fails fast, for a retry, when Claude.ai answers in words instead of JSON', async () => {
    const prompt = 'Research the employers for this role. Reply with one JSON object only.';
    tab.domText = 'I can’t identify specific companies from this description.';
    tab.conversation = { prompt, text: 'I can’t identify specific companies from this description.', done: true };
    const started = Date.now();
    const res = await settle(chat.complete({ requestId: 'r1', prompt, title: 'Research — Medasource — Salesforce Administrator', timeoutMs: 60_000 }));
    expect(res).toMatchObject({ ok: false, code: 'input' });
    expect(res.ok ? '' : res.detail).toMatch(/answered without the JSON.*identify specific companies/);
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  it('accepts a retry in the same chat that repeats the earlier research word for word', async () => {
    const title = 'Research — Medasource — Salesforce Administrator';
    const first = await settle(chat.complete({ requestId: 'r1', prompt: 'Research employers. Reply with JSON.', title, timeoutMs: 60_000 }));
    expect(first).toMatchObject({ ok: true, text: REPLY });
    const chatUrl = tab.url;
    const again = await settle(chat.complete({ requestId: 'r2', prompt: 'Research employers. Return one complete JSON object.', title, timeoutMs: 60_000 }));
    expect(again).toMatchObject({ ok: true, text: REPLY });
    expect(tab.url).toBe(chatUrl);
  });

  it('reuses one Claude.ai chat per research title instead of opening /new on every retry', async () => {
    const title = 'Research — Dandy — Senior Accountant';
    const first = await settle(chat.complete({ requestId: 'r1', prompt: 'Research employers. Reply with JSON.', title, timeoutMs: 60_000 }));
    expect(first).toMatchObject({ ok: true, text: REPLY });
    const chatUrl = tab.url;
    expect(chatUrl).toMatch(/\/chat\//);
    tab.loads = [];
    const retry = REPLY.replace('Northwind', 'Contoso');
    tab.reply = retry;
    const second = await settle(chat.complete({ requestId: 'r2', prompt: 'Return one complete JSON object.', title, timeoutMs: 60_000 }));
    // The first answer is still on screen when the retry is sent; it must not be returned again.
    expect(second).toMatchObject({ ok: true, text: retry });
    expect(tab.loads).not.toContain(NEW_CHAT);
    expect(tab.url).toBe(chatUrl);
  });

  it('opens a new chat when the saved one is older than one run', async () => {
    const title = 'Research — Dandy — Senior Accountant';
    await settle(chat.complete({ requestId: 'r1', prompt: 'Research employers.', title, timeoutMs: 60_000 }));
    const oldUrl = tab.url;
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    tab.loads = [];
    const res = await settle(chat.complete({ requestId: 'r2', prompt: 'Research employers.', title, timeoutMs: 60_000 }));
    expect(res.ok).toBe(true);
    expect(tab.loads).not.toContain(oldUrl);
    expect(tab.url).toMatch(/\/chat\//);
    expect(tab.url).not.toBe(oldUrl);
  });

  it('opens a new chat for CV generation even after company research in another thread', async () => {
    const researchTitle = 'Research — Dandy — Senior Accountant';
    const resumeTitle = 'Dandy — Senior Accountant';
    await settle(chat.complete({ requestId: 'r1', prompt: 'Research employers.', title: researchTitle, timeoutMs: 60_000 }));
    const researchUrl = tab.url;
    tab.loads = [];
    await settle(chat.complete({ requestId: 'r2', prompt: 'Write resume JSON.', title: resumeTitle, timeoutMs: 60_000 }));
    expect(tab.loads[0]).toBe(NEW_CHAT);
    expect(tab.url).not.toBe(researchUrl);
  });

  it('reloads the new chat when an earlier job left its prompt unsent', async () => {
    tab.sendWorks = false;
    const failed = await settle(chat.complete({ requestId: 'r1', prompt: 'First prompt for the employer research.', title: 'A — B', timeoutMs: 60_000 }));
    expect(failed.ok).toBe(false);
    tab.sendWorks = true;
    const loadsBefore = tab.loads.length;
    const res = await settle(chat.complete({ requestId: 'r2', prompt: 'Second prompt for the employer research.', title: 'A — B', timeoutMs: 60_000 }));
    expect(res.ok).toBe(true);
    expect(tab.loads.slice(loadsBefore)).toContain(NEW_CHAT);
    expect(tab.composerText).toBe('Second prompt for the employer research.');
  });

  it('does not report a cut-off reply when the session is signed out', async () => {
    tab.signedIn = false;
    tab.url = 'https://claude.ai/login';
    await vi.advanceTimersByTimeAsync(91_000);
    expect(chat.status().state).toBe('signed_out');
    const res = await settle(chat.complete({ requestId: 'r1', prompt: 'Research the employers. Reply with JSON.', title: 'A — B', timeoutMs: 60_000 }));
    expect(res).toMatchObject({ ok: false, code: 'signed_out' });
  });

  it('does not leave the indicator on Writing after a cancelled job', async () => {
    tab.url = 'https://claude.ai/chat/11111111-1111-1111-1111-111111111111';
    tab.onLoad = () => chat.cancel('r1');
    const job = chat.complete({ requestId: 'r1', prompt: 'Research the employers. Reply with JSON.', title: 'A — B', timeoutMs: 60_000 });
    const res = await settle(job);
    expect(res).toMatchObject({ ok: false, code: 'cancelled' });
    expect(chat.status().detail).not.toMatch(/^Writing /);
  });

  it('accepts a complete reply while the stop control is still visible', async () => {
    tab.polls = 0;
    const original = tab.run.bind(tab);
    tab.run = async (code: string) => {
      if (code.includes('snapshot()')) {
        const streaming = tab.polls >= 0 && tab.polls < 2;
        const done = tab.polls >= 2;
        if (tab.polls >= 0) tab.polls += 1;
        return {
          href: tab.url,
          composer: tab.signedIn,
          sendEnabled: true,
          stop: streaming || done,
          assistant: REPLY,
          model: 'claude.ai',
          challenge: false,
          signedOut: false,
          usageLimited: false,
          chatId: null,
        };
      }
      return original(code);
    };
    const res = await settle(chat.complete({ requestId: 'r-stop', prompt: 'Research employers. Reply with JSON.', title: 'Research — A — B', timeoutMs: 60_000 }));
    expect(res).toMatchObject({ ok: true, text: REPLY });
  });
});

describe('Claude.ai reply readiness', () => {
  it('waits for a complete JSON object', () => {
    expect(claudeReplyReady(REPLY.slice(0, 60))).toBe(false);
    expect(claudeReplyReady(REPLY)).toBe(true);
    expect(claudeReplyReady(`Here it is:\n${REPLY}\nCopy`)).toBe(true);
    expect(claudeReplyReady('{"companies": "a } inside a string')).toBe(false);
  });

  it('extracts research JSON even when Claude adds UI text after it', () => {
    const research = '{"companies":[{"name":"Medidata Solutions, Inc.","activeYears":"1999-present","techFit":"Cloud clinical trial platform","hq":"New York, NY"}]} Copy Retry';
    expect(extractClaudeJson(research)).toBe('{"companies":[{"name":"Medidata Solutions, Inc.","activeYears":"1999-present","techFit":"Cloud clinical trial platform","hq":"New York, NY"}]}');
  });

  it('finds JSON in a code block when a later assistant line is not JSON', () => {
    const page = 'Claude can make mistakes.\n```json\n' + REPLY + '\n```\nCopy';
    expect(parseAssistantJson(page, 'Research employers.')).toBe(REPLY);
  });

  it('reads JSON that Claude.ai rendered as prose with curly quotes', () => {
    const page = '{\u201Ccompanies\u201D:[{\u201Cname\u201D:\u201DThrive Pet Healthcare, LLC\u201D,\u201DactiveYears\u201D:\u201D2019-present\u201D,\u201DtechFit\u201D:\u201DVet network similar to PetVet\u2019s.\u201D,\u201Dhq\u201D:\u201DRolling Meadows, IL\u201D}]}';
    const json = parseAssistantJson(page, 'Research employers.');
    expect(json).not.toBeNull();
    expect(JSON.parse(json!)).toEqual({ companies: [{ name: 'Thrive Pet Healthcare, LLC', activeYears: '2019-present', techFit: 'Vet network similar to PetVet\u2019s.', hq: 'Rolling Meadows, IL' }] });
  });

  it('reads curly-quoted resume JSON and keeps quoted words inside prose', () => {
    const page = 'Claude can make mistakes.\n{\u201ccompany_name\u201d: \u201cPetVet\u201d, \u201csummary\u201d: \u201cBuilt a \u201cbest-in-class\u201d TA team for the company\u2019s growth\u201d, \u201cskill_groups\u201d: [\u201cExcel\u201d, \u201cPower BI\u201d]}\nCopy Retry';
    const json = parseAssistantJson(page, 'Write the resume.');
    expect(json).not.toBeNull();
    expect(JSON.parse(json!)).toEqual({
      company_name: 'PetVet',
      summary: 'Built a \u201cbest-in-class\u201d TA team for the company\u2019s growth',
      skill_groups: ['Excel', 'Power BI'],
    });
  });

  it('leaves straight-quoted resume JSON with curly quotes in prose untouched', () => {
    const cv = '{"company_name":"PetVet","summary":"Led \u201cfast-track\u201d hiring"}';
    expect(parseAssistantJson(cv, 'Write the resume.')).toBe(cv);
  });
});
