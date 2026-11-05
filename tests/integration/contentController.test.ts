import { describe, expect, it } from 'vitest';
import { createContentController } from '@/content/controller';
import { fixture, JOB_URL, APPLY_URL } from '../helpers';

function diceTab(file: string, url: string) {
  const doc = document.implementation.createHTMLDocument('dice');
  doc.documentElement.innerHTML = fixture(file).replace(/^<!doctype html>/i, '');
  let clicks = 0;
  const ctl = createContentController({ doc, url: () => url, version: '1.0.0', successTimeoutMs: 30 });
  doc.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      if (/submit/i.test(b.textContent ?? '')) {
        clicks++;
        doc.body.insertAdjacentHTML('beforeend', '<p>Your application has been submitted</p>');
      }
    }),
  );
  return { doc, ctl, clicks: () => clicks };
}

describe('content script: page detection', () => {
  it('reports job pages, application pages and unsupported pages', () => {
    expect(diceTab('job-detail-jsonld.html', JOB_URL).ctl.pageState()).toMatchObject({ pageType: 'job-detail', jobKey: 'dice:3f9a1c2e-7b4d-4e8a-9c1f-2d6b8e0a5c71', hasApplicationForm: false });
    expect(diceTab('apply-questions.html', APPLY_URL).ctl.pageState()).toMatchObject({ pageType: 'application', hasApplicationForm: true });
    expect(diceTab('job-detail-jsonld.html', 'https://example.com/job-detail/1').ctl.pageState()).toMatchObject({ pageType: 'other', site: 'generic', hasApplicationForm: false });
    expect(diceTab('job-detail-jsonld.html', 'http://example.com/job-detail/1').ctl.pageState().pageType).toBe('unsupported');
  });

  it('extracts the job through the message interface', () => {
    const r = diceTab('job-detail-jsonld.html', JOB_URL).ctl.handle({ type: 'AF_EXTRACT_JOB' }) as { ok: boolean; job: { title: string } };
    expect(r.ok).toBe(true);
    expect(r.job.title).toBe('Senior Architect AI Engineering and Platforms');
  });

  it('fails safely when the form has no recognizable fields', () => {
    const t = diceTab('apply-questions.html', APPLY_URL);
    t.doc.querySelector('form')!.innerHTML = '<div>Something new</div><input type="hidden" name="x">';
    const r = t.ctl.scan();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Dice changed this page layout/);
  });
});

describe('content script: submit safety', () => {
  it('refuses to submit without a token armed by the panel', async () => {
    const t = diceTab('apply-questions.html', APPLY_URL);
    const r = await t.ctl.submit('forged');
    expect(r.outcome).toBe('refused');
    expect(t.clicks()).toBe(0);
  });

  it('clicks exactly once for a valid token, and the token cannot be reused', async () => {
    const t = diceTab('apply-questions.html', APPLY_URL);
    t.ctl.handle({ type: 'AF_ARM_SUBMIT', token: 'abc' });
    const first = await t.ctl.submit('abc');
    expect(first).toMatchObject({ ok: true, outcome: 'clicked', successDetected: true });
    const second = await t.ctl.submit('abc');
    expect(second.outcome).toBe('refused');
    expect(t.clicks()).toBe(1);
  });

  it('a wrong token disarms the real one', async () => {
    const t = diceTab('apply-questions.html', APPLY_URL);
    t.ctl.handle({ type: 'AF_ARM_SUBMIT', token: 'real' });
    await t.ctl.submit('wrong');
    expect((await t.ctl.submit('real')).outcome).toBe('refused');
    expect(t.clicks()).toBe(0);
  });

  it('tokens expire', async () => {
    let clock = 0;
    const doc = document.implementation.createHTMLDocument('dice');
    doc.documentElement.innerHTML = fixture('apply-questions.html');
    const ctl = createContentController({ doc, url: () => APPLY_URL, version: '1', now: () => clock, successTimeoutMs: 10 });
    ctl.handle({ type: 'AF_ARM_SUBMIT', token: 't' });
    clock = 121_000;
    expect((await ctl.submit('t')).outcome).toBe('refused');
  });

  it('never clicks when a CAPTCHA is present or the submit control is ambiguous', async () => {
    const a = diceTab('apply-questions.html', APPLY_URL);
    a.doc.body.insertAdjacentHTML('beforeend', '<div class="g-recaptcha" data-sitekey="x"></div>');
    a.ctl.handle({ type: 'AF_ARM_SUBMIT', token: 't' });
    expect((await a.ctl.submit('t')).message).toMatch(/CAPTCHA/);
    const b = diceTab('apply-questions.html', APPLY_URL);
    b.doc.querySelector('form')!.insertAdjacentHTML('beforeend', '<button type="button">Submit</button>');
    b.ctl.handle({ type: 'AF_ARM_SUBMIT', token: 't' });
    expect((await b.ctl.submit('t')).message).toMatch(/More than one/);
    expect(a.clicks() + b.clicks()).toBe(0);
  });

  it('does not click an external apply button', async () => {
    const t = diceTab('job-detail-jsonld.html', JOB_URL);
    t.doc.querySelector('[data-cy="applyButton"]')!.textContent = 'Apply on company site';
    expect(await t.ctl.openApplication()).toMatchObject({ ok: false, external: true });
  });
});
