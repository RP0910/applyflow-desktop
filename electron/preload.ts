/**
 * Preload for the ApplyFlow window: exposes `window.applyflow` (see src/platform/bridge.ts).
 * Only two primitives cross the boundary — invoke(method, …args) and on(event, cb) — and the
 * main process checks every call comes from this window.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const EVENTS = new Set(['dice:event', 'dice:state', 'app:navigate', 'claudeChat:status']);

contextBridge.exposeInMainWorld('applyflow', {
  invoke: (method: string, ...args: unknown[]) => ipcRenderer.invoke('af:invoke', method, args),
  on: (event: string, cb: (payload: unknown) => void) => {
    if (!EVENTS.has(event)) throw new Error(`Unknown event ${event}`);
    const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
