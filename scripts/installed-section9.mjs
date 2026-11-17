/**
 * Development-only check of the installed ApplyFlow build.
 * Uses a copy of the data files. Does not submit an application.
 */
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const realData = join(process.env.APPDATA, 'ApplyFlow');
const copyData = join(tmpdir(), 'af-section9-data');
const work = join(tmpdir(), 'af-section9-work');
const port = 9443;
const debugPort = 9333;
const exe = join(process.env.LOCALAPPDATA, 'Programs', 'ApplyFlow', 'ApplyFlow.exe');
const report = { steps: [], dataUnchanged: null, before: null, after: null };
const children = [];
const FIXTURE = new Set([
  'Section Nine', 'Checker', 'section9@example.test', 'No', 'None', 'Decline',
  '100', 'Remote', '3', '01/01/1990', 'https://example.test/in/section9',
  'Functional', 'A sentence the page keeps.', 'Built reliable systems.', 'Yes', 'I am a protected veteran',
]);

function classify(field) {
  const secret = /\b(password|passcode|social security|ssn|passport|driver'?s licen[cs]e|credit card)\b/i;
  if (field.control === 'file' || field.sensitive === 'legal_consent' || /\bcertif/i.test(field.label) || secret.test(field.label)) return 'excluded';
  if (field.rejected || !String(field.finalValue || '').trim()) return 'rejected';
  const base = String(field.baseline || '').trim();
  const final = String(field.finalValue || '').trim();
  const filler = field.fillerValue == null ? null : String(field.fillerValue).trim();
  if (field.touched && final !== base) return filler == null ? 'verified' : 'correction';
  if (filler != null && !field.touched && final === filler) return 'accepted';
  return 'prefill';
}

function show(value) {
  const text = String(value ?? '');
  return FIXTURE.has(text) ? text : text ? '[stored]' : '(empty)';
}

function hashFile(path) {
  if (!existsSync(path)) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function snapshotData(dir) {
  return {
    sqlite: hashFile(join(dir, 'applyflow.sqlite')),
    key: hashFile(join(dir, 'applymind.key')),
    localState: hashFile(join(dir, 'Local State')),
    sqliteBytes: existsSync(join(dir, 'applyflow.sqlite')) ? statSync(join(dir, 'applyflow.sqlite')).size : 0,
  };
}

function copyDataFiles() {
  rmSync(copyData, { recursive: true, force: true });
  mkdirSync(copyData, { recursive: true });
  for (const name of ['applyflow.sqlite', 'applymind.key', 'Local State', 'Preferences']) {
    const from = join(realData, name);
    if (existsSync(from)) cpSync(from, join(copyData, name));
  }
}

function makeCert() {
  mkdirSync(work, { recursive: true });
  const pfx = join(work, 'fixture.pfx');
  const ps = `
    $cert = New-SelfSignedCertificate -DnsName '127.0.0.1' -CertStoreLocation 'Cert:\\CurrentUser\\My' -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(1)
    $pwd = ConvertTo-SecureString -String 'section9' -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath '${pfx.replace(/'/g, "''")}' -Password $pwd | Out-Null
  `;
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
}

function startSite() {
  const essay = `<label for="essay">Explain why you are the ideal candidate</label><textarea id="essay"></textarea>
    <script>
      const el = document.querySelector('#essay');
      const proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      let tracked = '';
      Object.defineProperty(el, '_valueTracker', { configurable: true, value: { setValue(v) { tracked = String(v); }, getValue() { return tracked; } } });
      Object.defineProperty(el, 'value', { configurable: true, get() { return proto.get.call(this); }, set(v) { proto.set.call(this, v); tracked = String(v); } });
      el.setAttribute('data-model', '');
      el.addEventListener('input', () => { if (tracked !== proto.get.call(el)) { el.setAttribute('data-model', proto.get.call(el)); tracked = proto.get.call(el); } });
    </script>`;
  const questions = readFileSync(join(root, 'tests', 'fixtures', 'dice', 'apply-questions.html'), 'utf8')
    .replace('<button type="submit">Submit Application</button>', `${essay}<button type="button">Continue</button>`);
  const variant = questions
    .replace('Are you legally authorized to work in the United States?', 'Are you legally permitted to work in Canada?')
    .replaceAll('> Yes<', '> Permitted<')
    .replaceAll('> No<', '> Not permitted<');
  const files = { '/questions.html': questions, '/variant.html': variant };
  const server = createServer({ pfx: readFileSync(join(work, 'fixture.pfx')), passphrase: 'section9' }, (req, res) => {
    const body = files[req.url] || '';
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
    res.end(body);
  });
  return new Promise((resolveServer) => server.listen(port, '127.0.0.1', () => resolveServer(server)));
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const done = this.pending.get(msg.id);
      if (!done) return;
      this.pending.delete(msg.id);
      done(msg);
    });
  }
  async send(method, params = {}) {
    await this.opened;
    const id = ++this.id;
    const result = new Promise((resolve) => this.pending.set(id, resolve));
    this.ws.send(JSON.stringify({ id, method, params }));
    const msg = await result;
    if (msg.error) throw new Error(msg.error.message || JSON.stringify(msg.error));
    return msg.result;
  }
  async eval(expression) {
    const out = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || 'Page evaluation failed');
    return out.result?.value;
  }
  close() { this.ws.close(); }
}

async function targets() {
  const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  return res.json();
}

async function waitFor(fn, ms = 25000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < ms) {
    try { return await fn(); } catch (error) { last = error; await new Promise((r) => setTimeout(r, 400)); }
  }
  throw last || new Error('Timed out');
}

async function connectMain() {
  return waitFor(async () => {
    const list = await targets();
    const main = list.find((t) => t.type === 'page' && /index\.html/i.test(t.url));
    if (!main?.webSocketDebuggerUrl) throw new Error(`Main window not listed (${list.map((t) => t.url).join(' | ')})`);
    return new Cdp(main.webSocketDebuggerUrl);
  });
}

async function connectPage(urlPart) {
  return waitFor(async () => {
    const list = await targets();
    const page = list.find((t) => t.type === 'page' && String(t.url).includes(urlPart));
    if (!page?.webSocketDebuggerUrl) throw new Error(`Page ${urlPart} not listed (${list.map((t) => t.url).join(' | ')})`);
    return new Cdp(page.webSocketDebuggerUrl);
  });
}

function launch() {
  const child = spawn(exe, [`--user-data-dir=${copyData}`, `--remote-debugging-port=${debugPort}`, '--ignore-certificate-errors'], { stdio: 'ignore' });
  children.push(child);
  return child;
}

async function click(page, selector) {
  const pos = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 12), w: r.width, h: r.height }; })()`);
  if (!pos || pos.w < 1 || pos.h < 1) throw new Error(`No box for ${selector}`);
  const base = { x: pos.x, y: pos.y, modifiers: 0, pointerType: 'mouse' };
  await page.send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', button: 'none', buttons: 0 });
  await page.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1 });
}

async function typeInto(page, selector, text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await click(page, selector);
    await new Promise((r) => setTimeout(r, 80));
    await page.send('Input.insertText', { text });
    await new Promise((r) => setTimeout(r, 80));
    const got = await page.eval(`document.querySelector(${JSON.stringify(selector)})?.value || ''`);
    if (got === text) return;
  }
  throw new Error(`Typing did not land in ${selector}`);
}

async function clickChecked(page, selector) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await click(page, selector);
    if (await page.eval(`document.querySelector(${JSON.stringify(selector)})?.checked === true`)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Click did not select ${selector}`);
}

async function chooseSelect(page, selector, key) {
  const code = key.toUpperCase().charCodeAt(0);
  const down = { key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, text: key };
  for (let attempt = 0; attempt < 3; attempt++) {
    await click(page, selector);
    await page.send('Input.dispatchKeyEvent', { ...down, type: 'keyDown' });
    await page.send('Input.dispatchKeyEvent', { ...down, type: 'keyUp' });
    await new Promise((r) => setTimeout(r, 80));
    const chosen = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el?.selectedOptions?.[0]?.text || ''; })()`);
    if (chosen && !/^select$/i.test(chosen)) return;
  }
  throw new Error(`Could not choose ${selector}`);
}

function mark(name, ok, detail) {
  report.steps.push({ name, verified: Boolean(ok), detail: detail || '' });
  console.log(`${ok ? 'Verified' : 'Not verified'}: ${name}${detail ? ` — ${detail}` : ''}`);
}

function counts(status) {
  if (!status) return null;
  return { verified: status.verified, patterns: status.patterns, modelVersion: status.modelVersion, trainedRecords: status.trainedRecords };
}

function modelRows(dir) {
  const db = new DatabaseSync(join(dir, 'applyflow.sqlite'), { readOnly: true });
  try {
    return Number(db.prepare('SELECT COUNT(*) AS n FROM applymind_models').get().n);
  } finally {
    db.close();
  }
}

async function main() {
  if (!existsSync(exe)) throw new Error('Installed app not found');
  try { execFileSync('taskkill', ['/IM', 'ApplyFlow.exe', '/F'], { stdio: 'ignore' }); } catch { /* not running */ }
  const beforeReal = snapshotData(realData);
  copyDataFiles();
  const modelsBefore = modelRows(copyData);
  makeCert();
  const server = await startSite();
  launch();
  const ui = await connectMain();
  const invoke = (method, arg) => ui.eval(`window.applyflow.invoke(${JSON.stringify(method)}${arg === undefined ? '' : `, ${JSON.stringify(arg)}`})`);
  const info = await waitFor(() => invoke('app.info'));
  if (!String(info?.dataDir || '').includes('af-section9-data')) throw new Error('Refusing to use the real data folder');
  await invoke('dice.setVisible', true);
  await invoke('dice.setBounds', { x: 0, y: 0, width: 1100, height: 800 });
  report.before = counts(await invoke('applymind.status'));

  await invoke('dice.navigate', `https://127.0.0.1:${port}/questions.html`);
  const page = await connectPage('/questions.html');
  const scan = await waitFor(async () => {
    const found = await invoke('dice.send', { type: 'AF_SCAN_FIELDS' });
    if (!found?.fields?.length) throw new Error(found?.error || 'Form not scanned');
    return found;
  });
  const prior = {};
  for (const field of scan.fields) {
    if (field.control === 'file') continue;
    prior[field.label] = (await invoke('applymind.exact', { question: field.label, options: field.options || [], control: field.control })) != null;
  }
  await typeInto(page, '#fn', 'Section Nine');
  await typeInto(page, '#ln', 'Checker');
  await typeInto(page, '#em', 'section9@example.test');
  await clickChecked(page, 'input[name="auth"][value="y"]');
  await clickChecked(page, 'input[name="spon"][value="n"]');
  await chooseSelect(page, '#clr', 'n');
  await chooseSelect(page, '#crim', 'n');
  await chooseSelect(page, '#dis', 'n');
  await chooseSelect(page, '#vet', 'i');
  await chooseSelect(page, '#race', 'd');
  await typeInto(page, '#sal', '100');
  await typeInto(page, '#rel', 'Remote');
  await typeInto(page, '#yrs', '3');
  await typeInto(page, '#dob', '01/01/1990');
  await clickChecked(page, '#agree');
  await typeInto(page, '#li', 'https://example.test/in/section9');
  await typeInto(page, '#sum', 'Built reliable systems.');
  await typeInto(page, '#fav', 'Functional');
  const essayField = scan.fields.find((field) => /ideal candidate/i.test(field.label));
  const filled = essayField ? await invoke('dice.send', { type: 'AF_FILL_FIELDS', instructions: [{ fieldId: essayField.fieldId, kind: 'value', value: 'A sentence the page keeps.' }] }) : null;
  const model = await page.eval(`document.querySelector('#essay')?.getAttribute('data-model') || ''`);
  await click(page, 'form button');
  await new Promise((r) => setTimeout(r, 300));
  const cap = await invoke('dice.send', { type: 'AF_READ_CAPTURE' });
  const rows = (cap?.fields || []).map((field) => ({ label: field.label, status: classify(field), value: show(field.finalValue) }));
  const stored = rows.filter((row) => row.status === 'verified' || row.status === 'correction' || row.status === 'accepted');
  const answered = ['First Name', 'Are you legally authorized', 'Security clearance level', 'Professional Summary', 'favorite programming paradigm'];
  const complete = answered.every((part) => stored.some((row) => row.label.includes(part) && row.status === 'verified'));
  mark('1. Hand answers stored with a status', complete, rows.map((row) => `${row.label}: ${row.status} ${row.value}`).join('; '));

  const items = (cap?.fields || []).flatMap((field) => {
    const status = classify(field);
    if (status !== 'verified' && status !== 'correction' && status !== 'accepted') return [];
    const longForm = /\b(why|explain|describe|ideal candidate|tell us about|motivation|walk us through)\b/i.test(field.label);
    return [{ kind: status, question: field.label, answer: field.finalValue, control: field.control, options: field.options || [], category: field.sensitive || 'general', longForm, platform: 'generic', jobTitle: 'Section 9', company: 'Fixture', country: 'US', factKey: null, factLabel: null, optionsKey: field.options?.length ? field.options.map((o) => o.toLowerCase()).sort().join('|') : null }];
  });
  const learned = await invoke('applymind.learnPage', { items, learnDemographics: true });
  const profile = await invoke('profile.get');
  const fresh = (learned?.profileAnswers || []).filter((a) => !prior[a.questionPattern]);
  if (profile && fresh.length) {
    await invoke('profile.save', { ...profile, approvedAnswers: [...profile.approvedAnswers, ...fresh.map((a) => ({ ...a, id: `sec9_${Math.random().toString(36).slice(2, 10)}`, approvedAt: new Date().toISOString() }))] });
  }
  const essayOk = filled?.results?.[0]?.ok === true && model === 'A sentence the page keeps.';
  const essayClass = rows.find((row) => /ideal candidate/i.test(row.label));
  mark('4. The framework essay is accepted by the page', essayOk && essayClass?.status === 'accepted', `model ${model ? 'updated' : 'empty'}; status ${essayClass?.status || 'missing'}`);
  const shot = await invoke('dice.send', { type: 'AF_PAGE_SNAPSHOT', delayMs: 0 });
  const shotPath = await invoke('snapshots.save', { html: shot?.html || '', unopened: shot?.unopened || [] });
  const shotHtml = typeof shotPath === 'string' && existsSync(shotPath) ? readFileSync(shotPath, 'utf8') : '';
  const shotOk = shotHtml.includes('Explain why you are the ideal candidate') && shotHtml.includes('First Name') && shotHtml.includes('*.myworkdayjobs.com') && !shotHtml.includes('127.0.0.1') && !/type="password"/i.test(shotHtml);
  mark('Snapshot file from the installed app', shotOk, shotOk ? `written under the copy's page-snapshots folder; unopened ${shot?.unopened?.length ? shot.unopened.join('; ') : 'none'}` : 'the file was missing a question, the host, or leaked the address');

  page.close();
  await invoke('dice.navigate', `https://127.0.0.1:${port}/questions.html`);
  const again = await connectPage('/questions.html');
  const favorite = await invoke('applymind.exact', { question: 'What is your favorite programming paradigm?', options: [], control: 'text' });
  const phone = await invoke('applymind.exact', { question: 'Mobile phone', options: [], control: 'text' });
  const context = await invoke('applymind.fillContext');
  const essayDraft = Object.values(context?.drafts || {}).includes('A sentence the page keeps.');
  const phoneLearned = stored.some((row) => /mobile phone/i.test(row.label));
  mark('2. Reopen fills a new answer, flags the essay, and does not learn the untouched phone', favorite === 'Functional' && essayDraft && !phoneLearned, `favorite ${favorite === 'Functional' ? 'filled' : 'not filled'}; essay ${essayDraft ? 'flagged draft' : 'not flagged'}; phone ${phone == null ? 'left' : prior['Mobile phone'] ? 'already stored' : 'filled'}`);
  again.close();

  await invoke('dice.navigate', `https://127.0.0.1:${port}/variant.html`);
  const variant = await connectPage('/variant.html');
  const canada = await invoke('applymind.exact', { question: 'Are you legally permitted to work in Canada?', options: ['Permitted', 'Not permitted'], control: 'radio' });
  mark('3. Different wording and options are not filled from the other question', canada == null, canada == null ? 'left for you' : 'filled from an existing answer');
  variant.close();

  ui.close();
  for (const child of children) child.kill();
  await new Promise((r) => setTimeout(r, 1500));
  launch();
  const ui2 = await connectMain();
  const invoke2 = (method, arg) => ui2.eval(`window.applyflow.invoke(${JSON.stringify(method)}${arg === undefined ? '' : `, ${JSON.stringify(arg)}`})`);
  await waitFor(() => invoke2('app.info'));
  const exactAgain = await invoke2('applymind.exact', { question: 'What is your favorite programming paradigm?', options: [], control: 'text' });
  mark('5. After restart the saved answer is still filled', exactAgain === 'Functional', exactAgain === 'Functional' ? 'filled' : 'not filled');
  report.after = counts(await invoke2('applymind.status'));
  ui2.close();
  for (const child of children) child.kill();
  await new Promise((r) => setTimeout(r, 800));
  let modelsAfter = modelsBefore;
  try { modelsAfter = modelRows(copyData); } catch { /* the copy can still be closing */ }
  const retrained = modelsAfter > modelsBefore || report.after?.modelVersion !== report.before?.modelVersion;
  mark('6. Counts and retraining', report.before != null && report.after != null, `verified ${report.before?.verified} -> ${report.after?.verified}; patterns ${report.before?.patterns} -> ${report.after?.patterns}; retrained ${retrained ? 'yes' : 'no'}`);
  const afterReal = snapshotData(realData);
  report.dataUnchanged = beforeReal.sqlite === afterReal.sqlite && beforeReal.key === afterReal.key && beforeReal.localState === afterReal.localState && beforeReal.sqliteBytes === afterReal.sqliteBytes;
  mark('Existing data loaded, and the original folder was not written', report.dataUnchanged === true && report.before?.verified != null, report.dataUnchanged ? `loaded verified ${report.before?.verified}; original folder unchanged` : 'original folder changed');
  server.close();
  writeFileSync(join(work, 'report.json'), JSON.stringify(report, null, 2));
  for (const child of children) child.kill();
  process.exit(0);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  for (const child of children) { try { child.kill(); } catch { /* already gone */ } }
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'report.json'), JSON.stringify({ ...report, error: message }, null, 2));
  process.exit(1);
}).finally(() => {
  for (const child of children) { try { child.kill(); } catch { /* already gone */ } }
});
