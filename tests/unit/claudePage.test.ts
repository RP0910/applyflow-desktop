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

  function box(): DOMRect {
    return { width: 140, height: 32, top: 0, left: 0, bottom: 32, right: 140, x: 0, y: 0, toJSON() { return {}; } };
  }

  function layout() {
    document.querySelectorAll<HTMLElement>('button, [role="button"], [role="menuitemradio"], [role="menuitem"], [role="option"]').forEach((el) => {
      const hidden = el.dataset.hidden === 'true';
      el.getBoundingClientRect = () => (hidden ? { ...box(), width: 0, height: 0 } : box());
    });
  }

  function clicks(): string[] {
    const seen: string[] = [];
    document.querySelectorAll<HTMLElement>('button, [role="menuitemradio"], [role="menuitem"]').forEach((el) => {
      el.addEventListener('click', () => seen.push((el.textContent || '').replace(/\s+/g, ' ').trim()));
    });
    return seen;
  }

  it('reads the model from the picker, not from another Claude button', () => {
    const api = page('<button>Ask Claude</button><button data-testid="model-selector-dropdown">Haiku 4.5 Low</button>') as unknown as { snapshot: () => { model: string } };
    layout();
    expect(api.snapshot().model).toBe('claude.ai (Haiku 4.5 Low)');
  });

  it('leaves a new chat alone when it already shows the Settings model and speed', async () => {
    const api = page('<button data-testid="model-selector-dropdown">Sonnet 5.5 Medium</button><div role="menuitemradio">Opus 5.5</div>') as unknown as { selectModel: () => Promise<{ ok: boolean; already?: boolean }> };
    layout();
    const pressed = clicks();
    (globalThis as unknown as { __afModel: unknown }).__afModel = { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', effort: 'medium' };
    await expect(api.selectModel()).resolves.toMatchObject({ ok: true, already: true });
    expect(pressed).toEqual([]);
  });

  it('selects the Settings model rather than a similarly numbered one, then sets the speed', async () => {
    const api = page(`
      <button data-testid="model-selector-dropdown">Opus 5.5 High</button>
      <div role="menuitemradio" id="opus">Opus 5.5</div>
      <div role="menuitemradio" id="sonnet5">Sonnet 5</div>
      <div role="menuitemradio" id="sonnet55">Sonnet 5.5</div>
      <div role="menuitem" id="effort">Effort</div>
      <div role="menuitemradio" id="high">High</div>
      <div role="menuitemradio" id="medium">Medium Recommended</div>
    `) as unknown as { selectModel: () => Promise<{ ok: boolean }> };
    layout();
    const pressed = clicks();
    (globalThis as unknown as { __afModel: unknown }).__afModel = { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', effort: 'medium' };
    document.getElementById('sonnet55')!.addEventListener('click', () => {
      document.querySelector('[data-testid="model-selector-dropdown"]')!.textContent = 'Sonnet 5.5 High';
    });
    await expect(api.selectModel()).resolves.toMatchObject({ ok: true });
    expect(pressed).toEqual(['Opus 5.5 High', 'Sonnet 5.5', 'Effort', 'Medium Recommended']);
    expect(pressed).not.toContain('Sonnet 5');
  });

  it('opens More models when the Settings model is not in the first list', async () => {
    const api = page(`
      <button data-testid="model-selector-dropdown">Sonnet 5.5</button>
      <div role="menuitemradio">Sonnet 5.5</div>
      <div role="menuitem" id="more">More models</div>
      <div role="menuitemradio" id="older" data-hidden="true">Sonnet 4.6</div>
    `) as unknown as { selectModel: () => Promise<{ ok: boolean }> };
    layout();
    document.getElementById('more')!.addEventListener('click', () => {
      document.getElementById('older')!.dataset.hidden = 'false';
      layout();
    });
    const pressed = clicks();
    (globalThis as unknown as { __afModel: unknown }).__afModel = { id: 'claude-sonnet-4-6-20260205', name: 'Claude Sonnet 4.6', effort: 'model_default' };
    await expect(api.selectModel()).resolves.toMatchObject({ ok: true });
    expect(pressed.map((t) => t.replace(/\s+/g, ' '))).toEqual(['Sonnet 5.5', 'More models', 'Sonnet 4.6']);
  });

  it('does not choose a model the account would have to upgrade for', async () => {
    const api = page(`
      <button data-testid="model-selector-dropdown">Sonnet 5.5</button>
      <div role="menuitemradio" id="opus">Opus 5.5<button type="button">Upgrade</button></div>
    `) as unknown as { selectModel: () => Promise<{ ok: boolean; reason?: string }> };
    layout();
    const pressed = clicks();
    (globalThis as unknown as { __afModel: unknown }).__afModel = { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', effort: 'high' };
    await expect(api.selectModel()).resolves.toMatchObject({ ok: false, reason: 'upgrade' });
    expect(pressed).toEqual(['Sonnet 5.5']);
  });

  it('selects an older model named with the version before the family', async () => {
    const api = page(`
      <button data-testid="model-selector-dropdown">Sonnet 5.5</button>
      <div role="menuitemradio" id="old">3.5 Sonnet</div>
    `) as unknown as { selectModel: () => Promise<{ ok: boolean }> };
    layout();
    const pressed = clicks();
    (globalThis as unknown as { __afModel: unknown }).__afModel = { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', effort: 'model_default' };
    await expect(api.selectModel()).resolves.toMatchObject({ ok: true });
    expect(pressed).toEqual(['Sonnet 5.5', '3.5 Sonnet']);
  });

  it('skips an earlier code-block answer while the new reply is still being written', () => {
    const page2 = page('<div><div data-testid="user-message">one</div><div data-testid="assistant-message"><pre>{"company_name":"Old"}</pre></div><div data-testid="user-message">two</div><div data-testid="assistant-message">Writing…</div></div>');
    expect(page2.snapshot()).toMatchObject({ assistant: 'Writing…', fresh: true });
  });
});
