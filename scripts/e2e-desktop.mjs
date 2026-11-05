import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron: electron, expect } = (() => {
  const pw = require('playwright');
  let exp;
  try {
    exp = require('@playwright/test').expect;
  } catch {
    exp = null;
  }
  return { _electron: pw._electron, expect: exp };
})();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(root, 'docs/screenshots');
const JOB_URL = 'https://www.dice.com/job-detail/3f9a1c2e-7b4d-4e8a-9c1f-2d6b8e0a5c71';
const PHONE = '(312) 555-0147';
rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

const lines = [];
const log = (m) => {
  const l = `[${new Date().toISOString().slice(11, 19)}] ${m}`;
  lines.push(l);
  console.log(l);
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERTION: ${msg}`);
};
const waitFor = async (fn, what, timeout = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${what}`);
};

const fixtures = mkdtempSync(join(tmpdir(), 'af-fixtures-'));
cpSync(join(root, 'tests/fixtures/dice'), fixtures, { recursive: true });
const contact = `Questions? Call Dana Whitfield, Technical Recruiter, at ${PHONE} or email dana.whitfield@meridian-example.com.`;
writeFileSync(
  join(fixtures, 'mock-job.html'),
  readFileSync(join(fixtures, 'job-detail-jsonld.html'), 'utf8')
    .split('<h3>Benefits</h3>')
    .join(`<p>${contact}</p><h3>Benefits</h3>`),
);
const userData = mkdtempSync(join(tmpdir(), 'af-data-'));
const docsDir = mkdtempSync(join(tmpdir(), 'af-docs-'));

const app = await electron.launch({
  executablePath: require(join(root, 'node_modules/electron')),
  args: [root, '--no-sandbox'],
  env: { ...process.env, APPLYFLOW_USER_DATA: userData, APPLYFLOW_MOCK_DICE: fixtures, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
});
const errors = [];
try {
  await app.firstWindow();
  const win = await waitFor(async () => app.windows().find((w) => w.url().startsWith('app://')), 'the ApplyFlow window');
  win.on('console', (m) => m.type() === 'error' && errors.push(`window: ${m.text()}`));
  await win.waitForSelector('.rail');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950));
  await win.evaluate((dir) => window.applyflow.invoke('kv.set', 'applyflow.settings.v1', { saveLocation: dir, schema: 3 }), docsDir);
  await win.reload();
  await win.waitForSelector('.rail');
  log('app started');

  const diceEval = (js) =>
    app.evaluate(async ({ webContents }, code) => {
      const wc = webContents.getAllWebContents().find((w) => /dice\.com/.test(w.getURL()));
      return wc ? wc.executeJavaScript(code) : null;
    }, js);
  const shotApply = async (name) => {
    const winPng = (await win.screenshot()).toString('base64');
    const box = await win.locator('.browser-host').boundingBox();
    const dicePng = await app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => /dice\.com/.test(w.getURL()));
      return wc ? (await wc.capturePage()).toPNG().toString('base64') : null;
    });
    if (!dicePng || !box) {
      writeFileSync(join(SHOTS, name), Buffer.from(winPng, 'base64'));
      return;
    }
    const out = await win.evaluate(
      async ({ a, b, box }) => {
        const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${src}`; });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        const c = document.createElement('canvas');
        c.width = ia.width;
        c.height = ia.height;
        const g = c.getContext('2d');
        g.drawImage(ia, 0, 0);
        g.drawImage(ib, box.x, box.y, box.width, box.height);
        return c.toDataURL('image/png').split(',')[1];
      },
      { a: winPng, b: dicePng, box },
    );
    writeFileSync(join(SHOTS, name), Buffer.from(out, 'base64'));
  };
  const diceUrl = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()).find((u) => /dice\.com/.test(u)) ?? '');

  await win.getByRole('button', { name: 'Work history' }).click();
  await win.getByRole('button', { name: 'Upload a file' }).click();
  await win.setInputFiles("input[type=file][aria-label='Choose a resume file']", join(root, 'docs/examples/example-master-resume-flowcv-style.pdf'));
  await waitFor(async () => /Imported/.test(await win.locator('.banner').first().innerText()), 'resume import', 30000);
  log('master resume imported: ' + (await win.locator('.banner').first().innerText()).replace(/\n/g, ' '));
  await win.screenshot({ path: join(SHOTS, '02-work-history.png') });

  await win.getByRole('button', { name: 'Apply', exact: true }).click();
  await win.fill('.address-input', JOB_URL);
  await win.press('.address-input', 'Enter');
  await waitFor(async () => (await diceUrl()).includes('/job-detail/'), 'job page');
  await waitFor(async () => (await win.locator('.job-title').count()) > 0, 'job detected', 30000);
  log('job detected: ' + (await win.locator('.job-title').first().innerText()));
  await waitFor(async () => (await win.getByRole('button', { name: /Estimated match/ }).count()) > 0, 'score', 30000);
  log('scored automatically: ' + (await win.getByRole('button', { name: /Estimated match/ }).first().getAttribute('aria-label')));
  await shotApply('01-apply-job-scored.png');

  const t0 = Date.now();
  await win.locator('.action-bar').getByRole('button', { name: 'Tailor & Apply' }).click();
  await waitFor(async () => (await win.getByRole('heading', { name: /questions for you/i }).count()) > 0, 'questions', 90000);
  log(`reached the questions in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const qs = await win.locator('.q-card .q-label').allInnerTexts();
  log('questions for the user: ' + qs.join(' | '));
  await shotApply('03-apply-questions.png');
  for (let i = 0; i < 6; i++) {
    const cards = win.locator('.q-card');
    if (!(await cards.count())) break;
    const card = cards.first();
    const q = await card.locator('.q-label').innerText();
    if (/years/i.test(q)) {
      await card.getByRole('textbox').fill('6');
      await card.getByRole('button', { name: 'Use' }).click();
    } else if (/sponsor/i.test(q)) {
      await card.getByRole('button', { name: 'No', exact: true }).click();
    } else {
      await card.getByRole('button', { name: 'Yes', exact: true }).click();
    }
    await win.waitForTimeout(700);
  }
  await waitFor(async () => (await win.getByRole('heading', { name: /Ready to submit/i }).count()) > 0, 'review step', 60000);
  const review = String(await diceEval("document.querySelector('.content')?.innerText ?? ''")).replace(/\n/g, ' ');
  log('Dice review step: ' + review.slice(0, 300));
  assert(/Resume\.pdf/.test(review), 'tailored resume replaced the profile resume');
  await shotApply('04-apply-review.png');

  await win.getByRole('button', { name: 'Submit application' }).click();
  await waitFor(async () => (await win.getByRole('heading', { name: /Applied to/ }).count()) > 0, 'applied', 60000);
  log('submitted: ' + (await win.locator('.done-hero').innerText()).replace(/\n/g, ' '));
  await win.waitForTimeout(1500);
  await shotApply('05-apply-submitted.png');
  const saved = readdirSync(docsDir, { recursive: true }).map(String);
  log('files on disk: ' + saved.filter((f) => /\.(pdf|docx|json|txt)$/.test(f)).join(', '));
  assert(saved.some((f) => f.endsWith('resume_tailored.pdf')), 'resume PDF saved');
  assert(saved.some((f) => f.endsWith('resume.json')), 'resume JSON saved');
  const GEN = join(root, 'docs/examples/generated-application');
  rmSync(GEN, { recursive: true, force: true });
  mkdirSync(GEN, { recursive: true });
  for (const f of saved.filter((x) => /\.(pdf|docx|json|txt)$/.test(x))) cpSync(join(docsDir, f), join(GEN, f.split(/[\\/]/).pop()));

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('app:navigate', { view: 'applications', search: true }));
  await win.waitForSelector('.apps-search-input');
  await win.fill('.apps-search-input', '555 0147');
  await waitFor(async () => (await win.locator('.apps-item').count()) > 0, 'search hit');
  const hit = (await win.locator('.apps-item').first().innerText()).replace(/\n/g, ' | ');
  log('search "555 0147" → ' + hit);
  assert(/Meridian/.test(hit) && /Phone number/.test(hit), 'phone search finds the application');
  await waitFor(async () => (await win.locator('.doc-row').count()) > 0, 'documents');
  const sentChip = await win.locator('.doc-row-sent').count();
  log(`documents listed: ${await win.locator('.doc-row').count()} (sent highlighted: ${sentChip})`);
  await win.locator('.doc-row').first().getByRole('button', { name: 'Preview' }).click();
  await win.waitForSelector('.pdf-page', { timeout: 20000 });
  await win.waitForTimeout(800);
  await win.screenshot({ path: join(SHOTS, '06-applications-phone-search.png') });
  for (const q of ['meridian', 'dana', 'kafka']) {
    await win.fill('.apps-search-input', q);
    await win.waitForTimeout(500);
    log(`search "${q}" → ${await win.locator('.apps-item').count()} result(s)`);
  }

  await win.locator('.doc-row').first().getByRole('button', { name: 'PDF Studio' }).click();
  await win.waitForSelector('.studio .pdf-page', { timeout: 20000 });
  await win.selectOption('.studio-controls select >> nth=0', 'modern');
  await win.waitForTimeout(1500);
  await win.screenshot({ path: join(SHOTS, '07-pdf-studio-modern.png') });
  log('PDF Studio rendered the saved resume JSON in the modern template');

  await win.getByRole('button', { name: 'Settings' }).click();
  await win.waitForTimeout(500);
  await win.screenshot({ path: join(SHOTS, '08-settings.png') });

  const real = errors.filter((e) => !/favicon|DevTools|Autofill|net::ERR/i.test(e));
  log(`console errors: ${real.length}`);
  real.forEach((e) => log('  ' + e));
  if (real.length) process.exitCode = 1;
  log('e2e complete');
} catch (e) {
  log('FAILED: ' + (e instanceof Error ? e.stack : String(e)));
  try {
    const w = await app.firstWindow();
    await w.screenshot({ path: join(SHOTS, 'zz-failure.png') });
  } catch {
  }
  process.exitCode = 1;
} finally {
  writeFileSync(join(SHOTS, 'e2e-log.txt'), lines.join('\n') + '\n');
  await app.close().catch(() => undefined);
  void expect;
  void existsSync;
}
