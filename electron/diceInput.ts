/**
 * Real (trusted) input for the built-in Dice browser, through Chromium's DevTools protocol on the
 * Dice view only. This is what a person does by hand, and what browser automation tools do:
 *
 *   - clickAt      a real left click at a point of the page (Input.dispatchMouseEvent). Menus that
 *                  ignore scripted clicks open, and the click counts as a user gesture, so Dice is
 *                  allowed to open its file chooser.
 *   - file chooser while ApplyFlow attaches a document it is "armed": the next file chooser Dice
 *                  opens is answered with the tailored file (Page.setInterceptFileChooserDialog +
 *                  DOM.setFileInputFiles) instead of showing the Windows "Open" dialog. Dice gets the
 *                  file exactly as if you had picked it, with genuine input/change events.
 *   - setInputFile put the file on one specific <input type=file> the page helper marked.
 *
 * Only the Dice view's own helper can ask for these (checked in main.ts), and only on dice.com.
 * Nothing is armed outside an upload ApplyFlow started; the interception is switched off right after.
 */
import type { WebContents } from 'electron';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type TrustedRequest =
  | { op: 'available' }
  | { op: 'clickAt'; x: number; y: number }
  | { op: 'arm'; name: string; base64: string }
  | { op: 'wait'; armId: string; timeoutMs: number }
  | { op: 'disarm'; armId: string }
  | { op: 'setInputFile'; marker: string; name: string; base64: string }
  | { op: 'clickMarked'; marker: string };

interface Arm {
  id: string;
  path: string;
  handled: boolean;
  error: string | null;
  waiters: ((handled: boolean) => void)[];
}

const UPLOAD_MARKER_ATTR = 'data-applyflow-upload';

/** A Windows/macOS/Linux-safe file name that keeps what Dice will display. */
export function safeUploadName(name: string): string {
  const cleaned = String(name || 'document.pdf')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(-150);
  return cleaned || 'document.pdf';
}

export class DiceInput {
  private wc: WebContents | null = null;
  private attached = false;
  private arms = new Map<string, Arm>();
  private active: Arm | null = null;

  constructor(private readonly tempDir: string) {
    // Leftovers from an earlier run.
    rmSync(tempDir, { recursive: true, force: true });
  }

  /** Point at the current Dice view (called when it is created). */
  use(wc: WebContents): void {
    if (this.wc === wc) return;
    this.wc = wc;
    this.attached = false;
    wc.debugger.on('detach', () => {
      this.attached = false;
    });
    wc.debugger.on('message', (_e, method: string, params: Record<string, unknown>) => {
      if (method === 'Page.fileChooserOpened') void this.onChooser(params as { backendNodeId?: number; mode?: string });
    });
    wc.once('destroyed', () => {
      if (this.wc === wc) this.wc = null;
    });
  }

  private async cmd<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T> {
    const wc = this.wc;
    if (!wc || wc.isDestroyed()) throw new Error('The Dice page is not open.');
    if (!this.attached || !wc.debugger.isAttached()) {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      this.attached = true;
      await wc.debugger.sendCommand('Page.enable');
    }
    return (await wc.debugger.sendCommand(method, params)) as T;
  }

  async available(): Promise<boolean> {
    try {
      await this.cmd('Runtime.evaluate', { expression: '1', returnByValue: true });
      return true;
    } catch {
      return false;
    }
  }

  async clickAt(x: number, y: number): Promise<boolean> {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 20000 || y > 20000) return false;
    const base = { x, y, modifiers: 0, pointerType: 'mouse' };
    await this.cmd('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', button: 'none', buttons: 0 });
    await this.cmd('Input.dispatchMouseEvent', { ...base, type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1 });
    await this.cmd('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1 });
    return true;
  }

  /** Write the document where Chromium can read it. Kept until ApplyFlow quits: Dice reads it while uploading. */
  private stage(name: string, base64: string): string {
    const dir = join(this.tempDir, randomUUID());
    mkdirSync(dir, { recursive: true });
    const path = join(dir, safeUploadName(name));
    writeFileSync(path, Buffer.from(base64, 'base64'));
    return path;
  }

  async arm(name: string, base64: string): Promise<string> {
    if (this.active) await this.disarm(this.active.id);
    const arm: Arm = { id: randomUUID(), path: this.stage(name, base64), handled: false, error: null, waiters: [] };
    this.arms.set(arm.id, arm);
    this.active = arm;
    await this.cmd('Page.setInterceptFileChooserDialog', { enabled: true });
    // Never left on: an upload takes seconds, so switch it off after 90 s whatever happens.
    setTimeout(() => void this.disarm(arm.id), 90_000);
    return arm.id;
  }

  /** The page navigated or its process went away: nothing it armed may stay on. */
  async disarmAll(): Promise<void> {
    for (const id of [...this.arms.keys()]) await this.disarm(id);
  }

  private async onChooser(p: { backendNodeId?: number; mode?: string }): Promise<void> {
    const arm = this.active;
    if (!arm || arm.handled) return;
    if (!p.backendNodeId) {
      arm.error = 'Dice opened a file chooser ApplyFlow could not answer.';
      return;
    }
    try {
      await this.cmd('DOM.setFileInputFiles', { files: [arm.path], backendNodeId: p.backendNodeId });
      arm.handled = true;
    } catch (e) {
      arm.error = e instanceof Error ? e.message : String(e);
    }
    const waiters = arm.waiters.splice(0);
    for (const w of waiters) w(arm.handled);
  }

  wait(armId: string, timeoutMs: number): Promise<{ handled: boolean; error: string | null }> {
    const arm = this.arms.get(armId);
    if (!arm) return Promise.resolve({ handled: false, error: 'Not armed.' });
    if (arm.handled) return Promise.resolve({ handled: true, error: null });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        arm.waiters = arm.waiters.filter((w) => w !== done);
        resolve({ handled: arm.handled, error: arm.error });
      }, Math.max(0, Math.min(timeoutMs, 60_000)));
      const done = (handled: boolean) => {
        clearTimeout(timer);
        resolve({ handled, error: arm.error });
      };
      arm.waiters.push(done);
    });
  }

  async disarm(armId: string): Promise<void> {
    const arm = this.arms.get(armId);
    this.arms.delete(armId);
    if (arm) for (const w of arm.waiters.splice(0)) w(arm.handled);
    if (this.active?.id !== armId) return;
    this.active = null;
    try {
      await this.cmd('Page.setInterceptFileChooserDialog', { enabled: false });
    } catch {
      /* the page went away */
    }
  }

  /** Expression finding the element the page helper marked (document and open shadow roots). */
  private static finder(marker: string, selector: string): string {
    return `(() => {
      const sel = '${selector}[${UPLOAD_MARKER_ATTR}="${marker}"]';
      const visit = (root) => {
        const hit = root.querySelector(sel);
        if (hit) return hit;
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { const h = visit(el.shadowRoot); if (h) return h; }
        return null;
      };
      return visit(document);
    })()`;
  }

  /** element.click() on the marked element, run as a user gesture (so Dice may open its chooser). */
  async clickMarked(marker: string): Promise<boolean> {
    if (!/^[\w-]{6,64}$/.test(marker)) return false;
    const expression = `(() => { const el = ${DiceInput.finder(marker, '')}; if (!el) return false; el.click(); return true; })()`;
    const res = await this.cmd<{ result?: { value?: unknown } }>('Runtime.evaluate', { expression, returnByValue: true, userGesture: true });
    return res.result?.value === true;
  }

  /** Set the file on the input the page helper marked with data-applyflow-upload="<marker>". */
  async setInputFile(marker: string, name: string, base64: string): Promise<boolean> {
    if (!/^[\w-]{6,64}$/.test(marker)) return false;
    const path = this.stage(name, base64);
    const expression = DiceInput.finder(marker, 'input[type="file"]');
    const res = await this.cmd<{ result?: { objectId?: string; subtype?: string } }>('Runtime.evaluate', { expression, returnByValue: false });
    const objectId = res.result?.objectId;
    if (!objectId || res.result?.subtype !== 'node') return false;
    try {
      await this.cmd('DOM.setFileInputFiles', { files: [path], objectId });
      return true;
    } finally {
      void this.cmd('Runtime.releaseObject', { objectId }).catch(() => undefined);
    }
  }

  async handle(req: TrustedRequest): Promise<unknown> {
    switch (req.op) {
      case 'available':
        return this.available();
      case 'clickAt':
        return this.clickAt(Number(req.x), Number(req.y));
      case 'arm':
        return this.arm(String(req.name), String(req.base64));
      case 'wait':
        return this.wait(String(req.armId), Number(req.timeoutMs) || 0);
      case 'disarm':
        return this.disarm(String(req.armId));
      case 'setInputFile':
        return this.setInputFile(String(req.marker), String(req.name), String(req.base64));
      case 'clickMarked':
        return this.clickMarked(String(req.marker));
      default:
        throw new Error('Unknown request.');
    }
  }

  cleanup(): void {
    try {
      rmSync(this.tempDir, { recursive: true, force: true });
    } catch {
      /* in use */
    }
  }
}
