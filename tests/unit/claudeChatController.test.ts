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
  close() {}
  onClosed() {}

  async load(url: string) {
    this.loads.push(url);
    this.url = url === 'https://claude.ai/' ? NEW_CHAT : url;
    this.composerText = '';
    this.polls = -1;
    this.onScreen = this.chats.get(this.url) ?? '';
    this.onLoad?.();
  }

  async run(code: string): Promise<unknown> {
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
    openWorker: async () => tab,
    openLogin: async () => tab,
    onMainResponse: () => () => undefined,
    reset: async () => undefined,
    close: () => undefined,
  };
}

const diagnostics = { record: () => undefined } as unknown as BrowserDiagnostics;

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
