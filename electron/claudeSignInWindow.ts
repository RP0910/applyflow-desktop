import { BrowserWindow, screen } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Win32Embed } from './win32Embed';

const HEADER = 56;
const WIDTH = 1100;
const HEIGHT = 820;

function headerHtml(icon: string): string {
  const logo = icon ? `<img src="${icon}" alt="">` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>ApplyFlow — Sign in to Claude.ai</title>
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; height: 100%; background: #ffffff; font: 13px/1.35 "Segoe UI", system-ui, sans-serif; color: #18181b; overflow: hidden; user-select: none; }
  header { height: ${HEADER - 1}px; display: flex; align-items: center; gap: 12px; padding: 0 16px; border-bottom: 1px solid #e4e4e7; background: #fafafa; }
  img { width: 28px; height: 28px; }
  .text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .title { font-weight: 600; font-size: 14px; }
  .hint { color: #52525b; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .addr { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; background: #f0f0f2; color: #3f3f46; font-size: 12px; max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .addr svg { flex: none; }
  .loading { position: fixed; left: 0; right: 0; top: ${HEADER}px; bottom: 0; display: flex; align-items: center; justify-content: center; color: #71717a; }
</style></head><body>
<header>
  ${logo}
  <div class="text">
    <div class="title">Sign in to Claude.ai</div>
    <div class="hint">ApplyFlow writes your resumes with your Claude.ai account. Finish signing in and any security check below; ApplyFlow never completes them for you.</div>
  </div>
  <div class="addr" title="Secure connection"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg><span id="addr">claude.ai</span></div>
</header>
<div class="loading">Opening Claude.ai…</div>
<script>window.setAddr = (t) => { document.getElementById('addr').textContent = t; };</script>
</body></html>`;
}

function iconData(path: string | undefined): string {
  if (!path) return '';
  const dir = join(dirname(path), 'icons');
  for (const size of ['64x64', '48x48', '128x128']) {
    const file = join(dir, `${size}.png`);
    try {
      if (existsSync(file)) return `data:image/png;base64,${readFileSync(file).toString('base64')}`;
    } catch {
    }
  }
  return '';
}

export class ClaudeSignInWindow {
  private host: BrowserWindow | null = null;
  private embedded = false;
  private disposed = false;
  private onUserClose: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inset: { left: number; top: number; right: number; bottom: number } | null = null;

  constructor(
    private readonly opts: {
      parent: () => BrowserWindow | null;
      helper: () => Promise<Win32Embed | null>;
      page: bigint;
      icon?: string;
      currentUrl: () => string;
    },
  ) {}

  async open(onUserClose: () => void): Promise<boolean> {
    this.onUserClose = onUserClose;
    const host = this.ensureHost();
    const helper = await this.opts.helper();
    if (!helper) return false;
    if (!this.embedded) {
      try {
        await helper.embed(this.opts.page, handleOf(host));
        this.embedded = true;
      } catch {
        return false;
      }
    }
    if (!host.isVisible()) {
      this.center(host);
      host.show();
    }
    host.focus();
    await this.layout();
    this.timer ??= setInterval(() => {
      this.showAddress();
      void this.checkInset();
    }, 800);
    return true;
  }

  focus(): void {
    const host = this.host;
    if (!host || host.isDestroyed()) return;
    if (host.isMinimized()) host.restore();
    host.show();
    host.focus();
  }

  hide(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.onUserClose = null;
    const host = this.host;
    if (host && !host.isDestroyed()) host.hide();
  }

  dispose(): void {
    this.disposed = true;
    this.hide();
    if (this.host && !this.host.isDestroyed()) this.host.destroy();
    this.host = null;
  }

  private ensureHost(): BrowserWindow {
    if (this.host && !this.host.isDestroyed()) return this.host;
    const parent = this.opts.parent();
    const host = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      useContentSize: true,
      minWidth: 640,
      minHeight: 520,
      show: false,
      title: 'ApplyFlow — Sign in to Claude.ai',
      icon: this.opts.icon && existsSync(this.opts.icon) ? this.opts.icon : undefined,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      minimizable: true,
      maximizable: true,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, javascript: true },
    });
    host.setMenu(null);
    host.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    host.webContents.on('will-navigate', (e) => e.preventDefault());
    void host.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(headerHtml(iconData(this.opts.icon)))}`);
    host.on('page-title-updated', (e) => e.preventDefault());
    host.on('close', (e) => {
      if (this.disposed) return;
      e.preventDefault();
      const cb = this.onUserClose;
      this.hide();
      cb?.();
    });
    const relayout = () => void this.layout();
    host.on('resize', relayout);
    host.on('maximize', relayout);
    host.on('unmaximize', relayout);
    host.on('restore', relayout);
    this.host = host;
    return host;
  }

  private center(host: BrowserWindow): void {
    const parent = this.opts.parent();
    const area = parent && !parent.isDestroyed() ? parent.getBounds() : screen.getPrimaryDisplay().workArea;
    const b = host.getBounds();
    host.setPosition(Math.round(area.x + Math.max(0, (area.width - b.width) / 2)), Math.round(area.y + Math.max(0, (area.height - b.height) / 2)));
  }

  private async layout(): Promise<void> {
    const host = this.host;
    if (!host || host.isDestroyed() || !this.embedded) return;
    const helper = await this.opts.helper();
    if (!helper) return;
    const page = this.opts.page;
    const [w, h] = host.getContentSize();
    const scale = screen.getDisplayMatching(host.getBounds()).scaleFactor || 1;
    const top = Math.round(HEADER * scale);
    const width = Math.round(w! * scale);
    const height = Math.max(0, Math.round(h! * scale) - top);
    const inset = this.inset ?? (await helper.content(page).catch(() => null));
    if (!inset) {
      await helper.place(page, 0, top, width, height).catch(() => undefined);
    } else {
      this.inset = inset;
      await helper.place(page, -inset.left, top - inset.top, width + inset.left + inset.right, height + inset.top + inset.bottom).catch(() => undefined);
      await helper.crop(page, inset.left, inset.top, inset.left + width, inset.top + height).catch(() => undefined);
    }
    await helper.show(page, true).catch(() => undefined);
  }

  private async checkInset(): Promise<void> {
    const helper = await this.opts.helper();
    const now = await helper?.content(this.opts.page).catch(() => null);
    if (!now || (this.inset && now.left === this.inset.left && now.top === this.inset.top && now.right === this.inset.right && now.bottom === this.inset.bottom)) return;
    this.inset = now;
    await this.layout();
  }

  private showAddress(): void {
    const host = this.host;
    if (!host || host.isDestroyed() || !host.isVisible()) return;
    let text = 'claude.ai';
    try {
      const u = new URL(this.opts.currentUrl());
      if (u.protocol === 'https:') text = u.hostname;
    } catch {
    }
    void host.webContents.executeJavaScript(`window.setAddr && window.setAddr(${JSON.stringify(text)})`).catch(() => undefined);
  }
}

function handleOf(win: BrowserWindow): bigint {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
}
