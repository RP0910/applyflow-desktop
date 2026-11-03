import type { ContentResponseMap, PanelToContent } from '@/types/messages';
import { bridge } from '@/platform/bridge';

export interface Messenger {
  send<K extends PanelToContent['type']>(tabId: number, msg: Extract<PanelToContent, { type: K }>): Promise<ContentResponseMap[K]>;
}

export class TabUnreachableError extends Error {
  constructor() {
    super('ApplyFlow can’t reach the Dice page yet. Wait for it to load, or press Reload.');
    this.name = 'TabUnreachableError';
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** chrome.tabs messaging that injects the content script once if the tab predates the install. */
export const chromeMessenger: Messenger = {
  async send(tabId, msg) {
    try {
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch (e: unknown) {
      if (!/receiving end does not exist|could not establish connection/i.test(String(e))) throw new TabUnreachableError();
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['main-world.js'], world: 'MAIN' }).catch(() => undefined);
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        await delay(200);
        return await chrome.tabs.sendMessage(tabId, msg);
      } catch {
        throw new TabUnreachableError();
      }
    }
  },
};

/** The desktop app: messages go to the page helper in the built-in Dice browser via the main process. */
export const desktopMessenger: Messenger = {
  async send(_tabId, msg) {
    const b = bridge();
    if (!b) throw new TabUnreachableError();
    try {
      return (await b.invoke('dice.send', msg)) as never;
    } catch (e: unknown) {
      throw /receiving end|establish connection|navigating|did not answer|stopped responding/i.test(String(e)) ? new TabUnreachableError() : e;
    }
  },
};

/** The messenger for this environment. */
export function defaultMessenger(): Messenger {
  return bridge() ? desktopMessenger : chromeMessenger;
}
