import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const EVENTS = new Set(['dice:event', 'dice:state', 'browser:tabs', 'app:navigate', 'claudeChat:status', 'sync:progress']);

contextBridge.exposeInMainWorld('applyflow', {
  invoke: (method: string, ...args: unknown[]) => ipcRenderer.invoke('af:invoke', method, args),
  on: (event: string, cb: (payload: unknown) => void) => {
    if (!EVENTS.has(event)) throw new Error(`Unknown event ${event}`);
    const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
