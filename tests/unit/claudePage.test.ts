import { beforeAll, describe, expect, it } from 'vitest';
import { CLAUDE_PAGE_API } from '../../electron/claudePage';

interface PageApi {
  snapshot: () => { sendEnabled: boolean; stop: boolean; assistant: string; fresh: boolean };
}

function page(html: string): PageApi {
  document.body.innerHTML = html;
  (0, eval)(CLAUDE_PAGE_API);
  return (globalThis as unknown as { __afClaude: PageApi }).__afClaude;
}

describe('Claude.ai page helper', () => {
  beforeAll(() => {
    if (!('innerText' in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, 'innerText', {
        configurable: true,
        get(this: HTMLElement) { return this.textContent ?? ''; },
      });
    }
  });

  it('finds Send when the button has both a label and visible text', () => {
    expect(page('<button aria-label="Send message">Send</button>').snapshot().sendEnabled).toBe(true);
    expect(page('<button aria-label="Send message"><svg></svg></button>').snapshot().sendEnabled).toBe(true);
    expect(page('<button data-testid="send-button"><svg></svg></button>').snapshot().sendEnabled).toBe(true);
  });

  it('ignores other buttons and a disabled Send', () => {
    expect(page('<button>Send feedback</button><button aria-label="Send message" disabled>Send</button>').snapshot().sendEnabled).toBe(false);
  });

  it('finds Stop while Claude is writing', () => {
    expect(page('<button aria-label="Stop response">Stop</button>').snapshot().stop).toBe(true);
    expect(page('<button>Stop sharing</button>').snapshot().stop).toBe(false);
  });

  it('reads a role-title code block, not an earlier companies reply', () => {
    const roles = '{"roles":[{"periodIndex":0,"role_title":"Warehouse Logistics Manager"}]}';
    const html = `<div data-testid="user-message">suggest titles</div><div data-testid="assistant-message"><pre>${roles}</pre></div>`;
    expect(page(html).snapshot().assistant).toBe(roles);
  });

  it('reads the reply after the user message, not the prompt', () => {
    const api = page('<div id="t"><div data-testid="user-message">PROMPT TEXT</div><div data-testid="assistant-message">{"companies":[]}</div></div>');
    expect(api.snapshot().assistant).toBe('{"companies":[]}');
  });

  it('in a reused chat, ignores the earlier answer until the newest prompt gets its own reply', () => {
    const OLD = '{"companies":[{"name":"Northwind"}]}';
    const turn = (who: 'user' | 'assistant', text: string) => `<div data-testid="${who}-message">${text}</div>`;
    const waiting = page(`<div>${turn('user', 'Research employers.')}${turn('assistant', OLD)}${turn('user', 'Research employers. Return one complete JSON object.')}</div>`);
    expect(waiting.snapshot()).toMatchObject({ assistant: '', fresh: false });
    // Claude.ai answers with the very same JSON: it is the reply to the newest prompt.
    const answered = page(`<div>${turn('user', 'Research employers.')}${turn('assistant', OLD)}${turn('user', 'Research employers. Return one complete JSON object.')}${turn('assistant', OLD)}</div>`);
    expect(answered.snapshot()).toMatchObject({ assistant: OLD, fresh: true });
  });

  it('reads the newest reply and the prompt it answers from the conversation itself', async () => {
    const id = '0f1e2d3c-4b5a-4968-8776-655443322110';
    history.pushState({}, '', `/chat/${id}`);
    document.cookie = 'lastActiveOrg=org-123';
    const urls: string[] = [];
    const conversation = {
      current_leaf_message_uuid: 'a2',
      chat_messages: [
        { uuid: 'h1', sender: 'human', parent_message_uuid: null, content: [{ type: 'text', text: 'Research employers.' }] },
        { uuid: 'a1', sender: 'assistant', parent_message_uuid: 'h1', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"companies":[{"name":"Old"}]}' }] },
        { uuid: 'h2', sender: 'human', parent_message_uuid: 'a1', content: [], text: '', attachments: [{ extracted_content: 'Research employers. Return one complete JSON object.' }] },
        { uuid: 'a2', sender: 'assistant', parent_message_uuid: 'h2', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"companies":[{"name":"New"}]}' }] },
      ],
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => conversation } as Response;
    }) as typeof fetch;
    try {
      const api = page('<div></div>') as unknown as { readReply: () => Promise<Record<string, unknown>> };
      expect(await api.readReply()).toEqual({ ok: true, prompt: 'Research employers. Return one complete JSON object.', text: '{"companies":[{"name":"New"}]}', humans: 2, done: true });
      expect(urls).toEqual([`/api/organizations/org-123/chat_conversations/${id}?tree=True&rendering_mode=messages&render_all_tools=true`]);
    } finally {
      globalThis.fetch = realFetch;
      history.pushState({}, '', '/');
    }
  });

  it('skips an earlier code-block answer while the new reply is still being written', () => {
    const page2 = page('<div><div data-testid="user-message">one</div><div data-testid="assistant-message"><pre>{"company_name":"Old"}</pre></div><div data-testid="user-message">two</div><div data-testid="assistant-message">Writing…</div></div>');
    expect(page2.snapshot()).toMatchObject({ assistant: 'Writing…', fresh: true });
  });
});
