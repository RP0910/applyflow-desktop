export interface PageIpc {
  invoke(channel: string, req?: unknown): Promise<unknown>;
  send(channel: string, payload?: unknown): void;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
}

declare const __AF_CHROME__: boolean;

export function pageIpc(): PageIpc {
  if (typeof __AF_CHROME__ !== 'undefined' && __AF_CHROME__) {
    const host = (globalThis as { __afHost?: PageIpc }).__afHost;
    if (!host) throw new Error('ApplyFlow helper is not connected.');
    return host;
  }
  return require('electron').ipcRenderer as PageIpc;
}
