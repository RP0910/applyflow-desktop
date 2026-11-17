/** Development-only Electron driver. It is not packaged with ApplyFlow. */
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const resultPath = process.argv.find((arg) => arg.endsWith('.json')) ?? join(process.cwd(), 'trusted-result.json');
const fixture = join(__dirname, 'fixture.html');
const preload = join(__dirname, 'page.js');

function fail(error: unknown): void {
  writeFileSync(resultPath, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  app.exit(1);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    show: false,
    webPreferences: { preload, contextIsolation: false, nodeIntegration: false },
  });
  const dbg = win.webContents.debugger;
  try {
    await win.loadFile(fixture);
    dbg.attach('1.3');
    const step = async (label: string, expression: string) => {
      const value = await win.webContents.executeJavaScript(`(async () => { try { return JSON.stringify({ ok: true, value: await (${expression}) }); } catch (e) { return JSON.stringify({ ok: false, error: String(e && e.stack || e) }); } })()`);
      return JSON.parse(value) as { ok: boolean; value?: unknown; error?: string };
    };
    const prepared = await step('prepare', 'window.__af.prepare()');
    if (!prepared.ok) throw new Error(prepared.error || 'prepare failed');
    const click = async (selector: string) => {
      const pos = await win.webContents.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 12) }; })()`);
      if (!pos || pos.x < 1 || pos.y < 1) throw new Error(`No box for ${selector}`);
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    };
    const oldModel = (await step('old', 'window.__af.fillEssayOld()')).value;
    await click('#city');
    await dbg.sendCommand('Input.insertText', { text: 'Tampa' });
    await click('#level');
    await click('#opt-ba');
    const filled = (await step('fill', 'window.__af.fillEssay()')).value;
    await click('#go');
    const classes = (await step('classes', 'window.__af.classes()')).value;
    writeFileSync(resultPath, JSON.stringify({ ok: true, oldModel, filled, classes }));
    app.exit(0);
  } catch (error) {
    fail(error);
  }
}).catch(fail);
