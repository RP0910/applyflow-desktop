// End-to-end check of "Replace your resume" in the REAL built-in browser (Electron/Chromium),
// against MOCK Dice pages (tests/fixtures/dice/wizard-realistic.html — nothing reaches dice.com).
//
// For each behaviour variant of Dice's resume card it opens the application step, asks the page
// helper to attach a tailored resume (exactly what Tailor & Apply sends), and checks that the mock
// page received the new file through its own file input and shows the new name.
//
// Usage: npm run build && xvfb-run -a node scripts/e2e-replace.mjs
import { createRequire } from 'node:module';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const VARIANTS = (process.argv.find((a) => a.startsWith('--variants='))?.slice(11) ?? '')
  .split(';')
  .filter(Boolean);
const DEFAULT_VARIANTS = [
  '',
  'pointer-menu',
  'svg-title',
  'label',
  'effect',
  'bigdom',
  'aria-hide',
  'trusted',
  'slow',
  'detached',
  'pointer-menu,svg-title,aria-hide,effect,slow',
  'label,bigdom,trusted',
  'legacy-mock',
];
const runs = VARIANTS.length ? VARIANTS : DEFAULT_VARIANTS;

const fixtures = mkdtempSync(join(tmpdir(), 'af-fixtures-'));
cpSync(join(root, 'tests/fixtures/dice'), fixtures, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'af-data-'));
const pdf = readFileSync(join(root, 'docs/examples/generated-application/resume_tailored.pdf')).toString('base64');
const coverPdf = readFileSync(join(root, 'docs/examples/generated-application/cover_letter.pdf')).toString('base64');

const app = await electron.launch({
  executablePath: require(join(root, 'node_modules/electron')),
  args: [root, '--no-sandbox'],
  env: { ...process.env, APPLYFLOW_USER_DATA: userData, APPLYFLOW_MOCK_DICE: fixtures, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, what, timeout = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* retry */
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${what}`);
};

let failed = 0;
try {
  await app.firstWindow();
  const win = await waitFor(async () => app.windows().find((w) => w.url().startsWith('app://')), 'the ApplyFlow window');
  await win.waitForSelector('.rail');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950));
  const invoke = (method, ...args) => win.evaluate(({ method, args }) => window.applyflow.invoke(method, ...args), { method, args });
  const diceEval = (js) =>
    app.evaluate(async ({ webContents }, code) => {
      const wc = webContents.getAllWebContents().find((w) => /dice\.com/.test(w.getURL()));
      return wc ? wc.executeJavaScript(code) : null;
    }, js);

  for (const v of runs) {
    // "legacy-mock": the original mock wizard (tests/fixtures/dice/mock-dice-wizard.cjs) in real Chromium.
    const legacy = v === 'legacy-mock';
    const url = legacy
      ? 'https://www.dice.com/job-applications/c5b4804d-9bfc-4873-928b-5185b557f0b6/wizard'
      : `https://www.dice.com/job-applications/c5b4804d-9bfc-4873-928b-5185b557f0b6/wizard?real=1&v=${encodeURIComponent(v)}`;
    await invoke('dice.navigate', url);
    if (process.argv.includes('--hidden')) await invoke('dice.setVisible', false);
    await waitFor(async () => (await invoke('dice.state')).ready && (legacy || /real=1/.test((await invoke('dice.state')).url)), 'the mock wizard');
    await waitFor(async () => (await diceEval(legacy ? 'Boolean(document.querySelector(".file-link"))' : 'Boolean(window.__mock)')) === true, 'mock state');
    await sleep(300);
    const name = `Grant-Howard-Resume-SAIC-Engineering-Technician-III-v${Math.floor(Math.random() * 90 + 10)}.pdf`;
    const t0 = Date.now();
    let res;
    try {
      res = await invoke('dice.send', { type: 'AF_UPLOAD_DOCUMENT', kind: 'resume', file: { name, mime: 'application/pdf', base64: pdf } });
    } catch (e) {
      res = { ok: false, message: String(e?.message ?? e) };
    }
    const ms = Date.now() - t0;
    const mock = legacy ? { replaceClicks: 1, log: [] } : await diceEval('JSON.parse(JSON.stringify(window.__mock))');
    const shown = await diceEval(`document.querySelector('${legacy ? '.file-link' : '#resume-card .file-link'}')?.textContent ?? null`);
    // Replace really clicked (not reached by luck), never Delete, and the new file shown.
    const pass = Boolean(res?.ok && res?.verified && shown === name && mock.replaceClicks === 1 && !mock.deleted);
    if (!pass) failed++;
    console.log(
      `${pass ? 'PASS' : 'FAIL'}  [${v || 'baseline'}]  ${ms}ms  ok=${res?.ok} verified=${res?.verified} method=${res?.method}  shown=${shown}  ` +
        `replaceClicks=${mock?.replaceClicks}  ${res?.message ?? ''}  log=${JSON.stringify(mock?.log ?? [])}`,
    );
    // Cover letter on the same page (drop area with a hidden input inside a <label>).
    if (!v || v === 'bigdom') {
      const cname = `Grant-Howard-Cover-Letter-SAIC-v${Math.floor(Math.random() * 90 + 10)}.pdf`;
      const cres = await invoke('dice.send', { type: 'AF_UPLOAD_DOCUMENT', kind: 'cover_letter', file: { name: cname, mime: 'application/pdf', base64: coverPdf } });
      const cshown = await diceEval(`document.querySelector('.cover-name')?.textContent ?? null`);
      const cpass = Boolean(cres?.ok && cshown === cname);
      if (!cpass) failed++;
      console.log(`${cpass ? 'PASS' : 'FAIL'}  [${v || 'baseline'} cover letter]  ok=${cres?.ok} verified=${cres?.verified} method=${cres?.method} shown=${cshown}  ${cres?.message ?? ''}`);
    }
  }
} finally {
  await app.close().catch(() => undefined);
}
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll replace checks passed.');
process.exit(failed ? 1 : 0);
