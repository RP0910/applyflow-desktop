import { beforeAll, describe, expect, it } from 'vitest';
import { CLAUDE_PAGE_API } from '../../electron/claudePage';

interface PageApi {
  snapshot: () => { sendEnabled: boolean; stop: boolean; assistant: string };
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

  it('reads the reply after the user message, not the prompt', () => {
    const api = page('<div id="t"><div data-testid="user-message">PROMPT TEXT</div><div data-testid="assistant-message">{"companies":[]}</div></div>');
    expect(api.snapshot().assistant).toBe('{"companies":[]}');
  });
});
