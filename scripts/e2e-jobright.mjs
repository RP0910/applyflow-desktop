import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(root, 'docs/screenshots');
mkdirSync(SHOTS, { recursive: true });

const lines = [];
const log = (m) => {
  const l = `[${new Date().toISOString().slice(11, 19)}] ${m}`;
  lines.push(l);
  console.log(l);
};
let failures = 0;
const check = (cond, msg) => {
  log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, what, timeout = 30000) => {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${what}${last instanceof Error ? ` (${last.message})` : ''}`);
};

const CV = {
  company_name: 'Employer',
  role_title: 'Electronics Technician',
  subtitle: 'Electronics & Test Technician',
  summary: 'Electronics technician with hands-on PCB assembly, test and troubleshooting experience; reads schematics and works with engineers from prototype to production.',
  cover_letter: 'Dear Hiring Team,\n\nI am excited to apply. At Raytheon I built and tested printed circuit board assemblies, supported ECAD reviews and maintained test fixtures.\n\nSincerely,\nGrant Howard',
  skill_groups: [
    { category: 'Electronics', items: ['PCB assembly', 'Soldering', 'BGAs', 'Oscilloscopes', 'Schematics'] },
    { category: 'Design tools', items: ['Altium Designer', 'ECAD', 'DFM', 'BOMs', 'Gerbers', 'ODB++'] },
  ],
  additional_categories: [],
  experience: [
    {
      company: 'Raytheon',
      role_title: 'Electronics Technician',
      location: '',
      dates: '',
      role_description: 'Built, tested and reworked flight electronics.',
      bullets: ['Built and tested PCB assemblies and harnesses to schematics', 'Supported ECAD design reviews with DFM feedback, BOMs and Gerber/ODB++ packages', 'Maintained test fixtures and followed ESD procedures'],
    },
  ],
};

const userData = mkdtempSync(join(tmpdir(), 'af-data-'));
const docsDir = mkdtempSync(join(tmpdir(), 'af-docs-'));
const app = await electron.launch({
  executablePath: require(join(root, 'node_modules/electron')),
  args: [root, '--no-sandbox'],
  env: { ...process.env, APPLYFLOW_USER_DATA: userData, APPLYFLOW_MOCK_DICE: join(root, 'tests/fixtures/dice'), ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
});

try {
  await app.firstWindow();
  const win = await waitFor(async () => app.windows().find((w) => w.url().startsWith('app://')), 'the ApplyFlow window');
  await win.waitForSelector('.rail');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
  const invoke = (m, ...a) => win.evaluate(({ m, a }) => window.applyflow.invoke(m, ...a), { m, a });
  const dice = (js) =>
    app.evaluate(async ({ webContents }, code) => {
      const wc = webContents.getAllWebContents().find((w) => /^https:/.test(w.getURL()));
      return wc ? wc.executeJavaScript(code) : null;
    }, js);
  const url = async () => (await invoke('dice.state')).url;

  let claudeCalls = 0;
  await win.route('https://api.anthropic.com/**', async (route) => {
    claudeCalls++;
    const body = { id: `msg_${claudeCalls}`, type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: JSON.stringify(CV) }], stop_reason: 'end_turn', usage: { input_tokens: 1200, output_tokens: 900 } };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
  });

  const current = (await invoke('kv.get', 'applyflow.settings.v1')) ?? {};
  await invoke('kv.set', 'applyflow.settings.v1', { ...current, engine: 'claude', saveLocation: docsDir, schema: current.schema ?? 3 });
  await invoke('secret.set', 'sk-ant-test-key');
  await win.reload();
  await win.waitForSelector('.rail');
  await win.getByRole('button', { name: /Profile & answers/ }).first().click();
  const fill = async (id, v) => win.fill(`#pf-${id}`, v);
  await fill('fullName', 'Grant Howard');
  await fill('email', 'grant.howard@example.com');
  await fill('phone', '(727) 555-0148');
  await fill('location', 'St. Petersburg, FL 33702, US');
  await fill('linkedinUrl', 'https://www.linkedin.com/in/granthoward');
  await win.locator('form.stack button[type=submit]').first().click();
  await win.getByLabel('Company').fill('Raytheon');
  await win.getByLabel('Start').first().fill('2019-03');
  await win.getByLabel('I work here now').check();
  await win.getByRole('button', { name: 'Save candidate setup' }).click();
  await win.getByText(/Candidate setup saved/).waitFor();
  await win.getByLabel('University / school').fill('Purdue University');
  await win.getByLabel('Degree').fill('Associate of Applied Science');
  await win.getByLabel('Field of study').fill('Electronics Engineering Technology');
  await win.getByLabel('End / graduation').fill('2016-05');
  await win.getByRole('button', { name: 'Save education' }).click();
  await win.getByText(/Education saved/).waitFor();
  log('candidate set up (profile, employer, education)');

  await win.getByRole('button', { name: 'Apply', exact: true }).first().click();
  await win.getByRole('button', { name: 'Jobright', exact: true }).click();
  await waitFor(async () => /jobright\.ai\/jobs\/recommend/.test(await url()), 'Jobright list');
  log('opened Jobright recommendations with the toolbar button');

  const shot = async (name) => {
    const winPng = (await win.screenshot()).toString('base64');
    const box = await win.locator('.browser-host').boundingBox();
    const pagePng = await app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => /^https:/.test(w.getURL()));
      return wc ? (await wc.capturePage()).toPNG().toString('base64') : null;
    });
    const out = !pagePng || !box ? winPng : await win.evaluate(async ({ a, b, box }) => {
      const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${src}`; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const c = document.createElement('canvas');
      c.width = ia.width; c.height = ia.height;
      const g = c.getContext('2d');
      g.drawImage(ia, 0, 0);
      g.drawImage(ib, box.x, box.y, box.width, box.height);
      return c.toDataURL('image/png').split(',')[1];
    }, { a: winPng, b: pagePng, box });
    writeFileSync(join(SHOTS, name), Buffer.from(out, 'base64'));
  };

  const openJob = async (id, title) => {
    await waitFor(async () => /jobright\.ai\/jobs\/(recommend|liked)/.test(await url()), 'back on the Jobright list', 20000);
    await waitFor(async () => (await invoke('dice.state')).ready, 'page helper');
    await dice(`document.querySelector('a[href="/jobs/info/${id}"]').click()`);
    await waitFor(async () => (await url()).includes(`/jobs/info/${id}`), `Jobright job ${id}`);
    await waitFor(async () => (await win.locator('.job-title').first().innerText().catch(() => '')) === title, `panel shows “${title}”`, 30000);
  };
  const answer = async (labelRe, option) => {
    const card = win.locator('.q-card').filter({ hasText: labelRe });
    await card.getByRole('button', { name: option, exact: true }).click();
  };
  const finish = async (company, answers) => {
    await waitFor(async () => (await heading(/question for you|questions for you|Ready to submit/).count()) > 0, `${company}: questions or review`, 90000);
    const asked = await win.locator('.q-card .q-label').allInnerTexts().catch(() => []);
    log(`${company}: the panel asked ${asked.length ? asked.map((a) => `“${a}”`).join(', ') : 'nothing (saved answers covered it)'}`);
    for (const [re, option] of answers) {
      const card = win.locator('.q-card').filter({ hasText: re });
      if (await card.count()) await (option ? card.getByRole('button', { name: option, exact: true }) : card.getByRole('button').first()).click();
    }
    await waitFor(async () => (await heading(new RegExp(`Ready to submit to ${company}`)).count()) > 0, `${company} ready`, 60000);
    return asked;
  };
  const tailorAndApply = async () => win.locator('.action-bar').getByRole('button', { name: 'Tailor & Apply' }).click();
  const heading = (re) => win.getByRole('heading', { name: re });

  await openJob('lever-1', 'PCB Layout Technician');
  await shot('jobright-01-job.png');
  check((await win.getByText('Jobright job').count()) > 0, 'panel labels it a Jobright job');
  let t0 = Date.now();
  await tailorAndApply();
  await waitFor(async () => (await heading(/2 questions for you/).count()) > 0, 'Lever questions', 90000);
  log(`Lever: reached the questions in ${((Date.now() - t0) / 1000).toFixed(1)}s (Claude calls so far: ${claudeCalls})`);
  check(/jobs\.lever\.co\/northwind\/.+\/apply$/.test(await url()), `followed Jobright → Lever job page → /apply (${await url()})`);
  const lever = await dice(`(() => { const f = document.getElementById('application-form'); const v = (n) => f.querySelector('[name="' + n + '"]').value; return { name: v('name'), email: v('email'), phone: v('phone'), loc: v('location'), sel: document.getElementById('selected-location').value, li: v('urls[LinkedIn]'), comments: v('comments'), file: f.querySelector('.filename').textContent, parsed: Boolean(window.__parsed) }; })()`);
  check(lever.parsed && lever.name === 'Grant Howard' && lever.email === 'grant.howard@example.com' && lever.phone === '(727) 555-0148', `Lever read the resume; ApplyFlow corrected name/email/phone (${lever.name}, ${lever.email}, ${lever.phone})`);
  check(/^St\. Petersburg, FL/.test(lever.loc) && /St\. Petersburg/.test(lever.sel), `location picked from Lever's suggestions (${lever.loc})`);
  check(/Grant-Howard-.*Resume.*\.pdf$/.test(lever.file), `tailored resume attached through real input (${lever.file})`);
  check(/^Dear Hiring Team/.test(lever.comments), 'cover letter in “Additional information”');
  await shot('jobright-02-lever-questions.png');
  await answer(/authorized to work/, 'Yes');
  await answer(/visa sponsorship/, 'No');
  await waitFor(async () => (await heading(/Ready to submit to Northwind Avionics/).count()) > 0, 'Lever ready', 60000);
  await shot('jobright-03-lever-ready.png');
  await win.getByRole('button', { name: 'Submit application' }).click();
  await waitFor(async () => (await heading(/Applied to Northwind Avionics/).count()) > 0, 'Lever applied', 60000);
  check(/\/thanks$/.test(await url()), 'Lever confirmation page reached and recorded');
  await shot('jobright-04-lever-applied.png');
  await win.locator('.action-bar').getByRole('button', { name: 'Back to search results' }).click();
  check(/jobright\.ai\/jobs\/recommend/.test(await waitFor(async () => { const u = await url(); return /jobright\.ai\/jobs\/recommend/.test(u) ? u : null; }, 'back on Jobright list')), '“Back to search results” returned to the Jobright list');

  await openJob('gh-1', 'Hardware Test Engineer');
  t0 = Date.now();
  await tailorAndApply();
  await waitFor(async () => (await heading(/question for you|questions for you|Ready to submit/).count()) > 0, 'Greenhouse questions', 90000);
  log(`Greenhouse: first stop in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  check(/boards\.greenhouse\.io\/embed\/job_app/.test(await url()), `followed the careers page's Greenhouse frame (${await url()})`);
  const gh = await dice(`({ first: first_name.value, last: last_name.value, email: email.value, phone: phone.value, resume: document.getElementById('resume_filename').textContent, cover: document.getElementById('cover_letter_filename').textContent, gender: document.getElementById('job_application_gender').value, ack: privacy_ack.checked })`);
  check(gh.first === 'Grant' && gh.last === 'Howard' && gh.email === 'grant.howard@example.com', 'contact details filled');
  check(/Resume/.test(gh.resume) && /Cover-Letter/.test(gh.cover), `resume and cover letter attached (${gh.resume.trim()} · ${gh.cover.trim()})`);
  check(gh.gender === '' && gh.ack === false, 'self-identification and the privacy acknowledgement left to the person');
  await shot('jobright-05-greenhouse-questions.png');
  const ghAsked = await finish('Acme Robotics', [[/legally authorized/, 'Yes'], [/require sponsorship/, 'No'], [/acknowledge/, null]]);
  check(ghAsked.some((a) => /acknowledge/i.test(a)) && !ghAsked.some((a) => /authorized|sponsorship/i.test(a)), 'saved answers from Lever applied; only the privacy acknowledgement was asked');
  await win.getByRole('button', { name: 'Submit application' }).click();
  await waitFor(async () => (await heading(/Applied to Acme Robotics/).count()) > 0, 'Greenhouse applied', 60000);
  const ghSent = await dice('window.__submitted ?? null');
  check(ghSent?.first === 'Grant' && /Resume/.test(ghSent?.resume ?? ''), 'Greenhouse received the application');
  await shot('jobright-06-greenhouse-applied.png');
  await win.locator('.action-bar').getByRole('button', { name: 'Back to search results' }).click();

  await openJob('ashby-1', 'Test Engineering Technician');
  t0 = Date.now();
  await tailorAndApply();
  await waitFor(async () => (await heading(/question for you|questions for you|Ready to submit/).count()) > 0, 'Ashby first stop', 90000);
  log(`Ashby: first stop in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const ash = await dice(`({ name: _systemfield_name.value, email: _systemfield_email.value, loc: document.getElementById('loc-value').value, file: document.querySelector('._fileName').textContent, autofill: Boolean(window.__autofillUsed) })`);
  check(ash.name === 'Grant Howard' && /St\. Petersburg/.test(ash.loc) && /Resume/.test(ash.file) && !ash.autofill, `Ashby filled, location chosen, resume in the resume field (not Autofill) (${ash.loc})`);
  await finish('Helio Systems', [[/legally authorized/, 'Yes'], [/visa sponsorship/, 'No']]);
  await win.getByRole('button', { name: 'Submit application' }).click();
  await waitFor(async () => (await heading(/Applied to Helio Systems/).count()) > 0, 'Ashby applied', 60000);
  const ashSent = await dice('window.__submitted ?? null');
  check(ashSent?.auth === 'Yes' && ashSent?.spons === 'No', 'Ashby received the Yes/No answers');
  await shot('jobright-07-ashby-applied.png');
  await win.locator('.action-bar').getByRole('button', { name: 'Back to search results' }).click();

  await openJob('ghnew-1', 'Electronics Technician');
  t0 = Date.now();
  await tailorAndApply();
  await waitFor(async () => (await heading(/question for you|questions for you|Ready to submit/).count()) > 0, 'Greenhouse (new) questions', 90000);
  log(`Greenhouse (new): first stop in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${(await heading(/question|Ready/).first().innerText())}`);
  const ghn = await dice(`({ country: document.querySelector('[data-combo="country"] input[type=hidden]').value, loc: document.querySelector('[data-combo="candidate-location"] input[type=hidden]').value, auth: document.querySelector('[data-combo="question_30002"] input[type=hidden]').value })`);
  check(ghn.country === 'United States' && /St\. Petersburg/.test(ghn.loc), `dropdowns chosen: country “${ghn.country}”, location “${ghn.loc}”`);
  check(ghn.auth === 'Yes', 'your saved answer (work authorization) applied to the dropdown question');
  await finish('Acme Robotics', [[/Altium/, 'Yes'], [/authorized/, 'Yes'], [/sponsorship/, 'No']]);
  await shot('jobright-08-greenhouse-new-ready.png');
  await win.getByRole('button', { name: 'Submit application' }).click();
  await waitFor(async () => (await heading(/Applied to Acme Robotics/).count()) > 0, 'Greenhouse (new) applied', 60000);
  await win.locator('.action-bar').getByRole('button', { name: 'Back to search results' }).click();

  await openJob('workday-1', 'Engineering Technician III');
  await tailorAndApply();
  await waitFor(async () => (await win.getByText(/Workday wants you to sign in/).count()) > 0, 'Workday sign-in stop', 90000);
  check(/applyManually/.test(await url()), 'Workday: pressed Apply → Apply Manually, stopped at sign-in');
  await shot('jobright-09-workday-signin.png');
  await invoke('dice.backToSearch');
  await openJob('closed-1', 'Senior Test Technician');
  await tailorAndApply();
  await waitFor(async () => (await win.getByText(/no longer open/).count()) > 0, 'closed job stop', 90000);
  check(true, 'closed Greenhouse job: stopped with the reason');
  await shot('jobright-10-closed.png');

  const apps = await invoke('applications.list');
  const applied = apps.filter((a) => a.stage === 'Applied').map((a) => `${a.company} — ${a.title}`);
  check(applied.length === 4, `Applications shows 4 applied: ${applied.join(' · ')}`);
} catch (e) {
  failures++;
  log(`ERROR ${e?.stack ?? e}`);
} finally {
  writeFileSync(join(SHOTS, 'jobright-e2e-log.txt'), lines.join('\n') + '\n');
  await app.close().catch(() => undefined);
}
log(failures ? `${failures} check(s) failed.` : 'All Jobright end-to-end checks passed.');
process.exit(failures ? 1 : 0);
