import { describe, expect, it } from 'vitest';
import {
  applyMethodStatusLine,
  classifyJobrightApplyLabel,
  detectJobrightApplyMethod,
  hideUnsupportedJobrightListCards,
  JR_LIST_HIDDEN_ATTR,
  scanJobrightList,
} from '@/services/platforms/jobright/applyMethod';
import { createContentController } from '@/content/controller';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const listHtml = readFileSync(resolve(__dirname, '../fixtures/jobright/jobright-list.html'), 'utf8');

function load(html: string, url: string) {
  document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '').replace(/^\s*<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
  const ctl = createContentController({ doc: document, url: () => url, version: 'test' });
  return ctl;
}

describe('classifyJobrightApplyLabel', () => {
  it('distinguishes Apply with Autofill from Apply Now', () => {
    expect(classifyJobrightApplyLabel('APPLY WITH AUTOFILL')).toBe('autofill');
    expect(classifyJobrightApplyLabel('Apply with Autofill')).toBe('autofill');
    expect(classifyJobrightApplyLabel('APPLY NOW')).toBe('apply_now');
    expect(classifyJobrightApplyLabel('Apply Now')).toBe('apply_now');
    expect(classifyJobrightApplyLabel('Send My Profile')).toBe('referral');
    expect(applyMethodStatusLine('autofill')).toMatch(/ELIGIBLE/);
    expect(applyMethodStatusLine('apply_now')).toMatch(/SKIPPED — Apply Now/);
  });
});

describe('scanJobrightList (screenshot cases)', () => {
  it('includes Tiger Analytics Autofill and skips HCLTech / IMR Soft Apply Now', () => {
    document.documentElement.innerHTML = listHtml.replace(/^<!doctype html>/i, '').replace(/^\s*<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
    const scan = scanJobrightList(document, 'https://jobright.ai/jobs/recommend');
    expect(scan.total).toBe(3);
    expect(scan.eligible).toBe(1);
    expect(scan.skippedApplyNow).toBe(2);
    expect(scan.cards.map((c) => [c.company || c.title, c.method])).toEqual(
      expect.arrayContaining([
        ['HCLTech', 'apply_now'],
        ['Tiger Analytics', 'autofill'],
        ['IMR Soft LLC', 'apply_now'],
      ]),
    );
    const st = load(listHtml, 'https://jobright.ai/jobs/recommend').pageState();
    expect(st.pageType).toBe('search');
    expect(st.listScan).toMatchObject({ total: 3, eligible: 1, skippedApplyNow: 2 });
  });

  it('hides the full Apply Now tile (including match column) so the next job moves up', () => {
    document.documentElement.innerHTML = listHtml.replace(/^<!doctype html>/i, '').replace(/^\s*<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
    const hcl = document.querySelector('[data-job-id="hcl-1"]') as HTMLElement;
    const tiger = document.querySelector('[data-job-id="tiger-1"]') as HTMLElement;
    const imr = document.querySelector('[data-job-id="imr-1"]') as HTMLElement;
    const imrMatch = imr.querySelector('.match-col') as HTMLElement;
    const r = hideUnsupportedJobrightListCards(document);
    expect(r).toEqual({ hidden: 2, visible: 1 });
    const hiddenEls = [...document.querySelectorAll(`[${JR_LIST_HIDDEN_ATTR}="1"]`)].map(
      (el) => `${(el as HTMLElement).tagName}.${(el as HTMLElement).className}#${el.getAttribute('data-job-id')}`,
    );
    expect(hiddenEls, `hid unexpected nodes: ${hiddenEls.join(',')}`).toEqual([
      'DIV.job-tile#hcl-1',
      'DIV.job-tile#imr-1',
    ]);
    // Outer tile is hidden — not only the inner job-card-body (which left a blank gap + match %).
    expect(hcl.getAttribute(JR_LIST_HIDDEN_ATTR)).toBe('1');
    expect(imr.getAttribute(JR_LIST_HIDDEN_ATTR)).toBe('1');
    expect(tiger.getAttribute(JR_LIST_HIDDEN_ATTR)).toBeNull();
    expect(hcl.querySelector('.job-card-body')!.getAttribute(JR_LIST_HIDDEN_ATTR)).toBeNull();
    expect(imrMatch.closest(`[${JR_LIST_HIDDEN_ATTR}="1"]`)).toBe(imr);
    expect(getComputedStyle(hcl).display).toBe('none');
    expect(getComputedStyle(imr).display).toBe('none');
    expect(getComputedStyle(tiger).display).not.toBe('none');
    // Remaining Autofill tiles stay in document order with no reserved blank row between.
    const visibleTiles = [...document.querySelectorAll('.job-tile')].filter(
      (el) => (el as HTMLElement).getAttribute(JR_LIST_HIDDEN_ATTR) !== '1',
    );
    expect(visibleTiles.map((el) => el.getAttribute('data-job-id'))).toEqual(['tiger-1']);
    load(listHtml, 'https://jobright.ai/jobs/recommend').pageState();
    expect(document.querySelector('[data-job-id="imr-1"]')!.getAttribute(JR_LIST_HIDDEN_ATTR)).toBe('1');
    expect(scanJobrightList(document, 'https://jobright.ai/jobs/recommend').skippedApplyNow).toBe(2);
  });

  it('hides Apply Now cards that appear after scroll / infinite load', () => {
    document.documentElement.innerHTML = listHtml.replace(/^<!doctype html>/i, '').replace(/^\s*<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
    const main = document.querySelector('main')!;
    hideUnsupportedJobrightListCards(document);
    expect(document.querySelector('[data-job-id="imr-1"]')!.getAttribute(JR_LIST_HIDDEN_ATTR)).toBe('1');

    const late = document.createElement('div');
    late.className = 'job-tile';
    late.setAttribute('data-job-id', 'late-1');
    late.innerHTML = `
      <div class="job-card-body">
        <a href="/jobs/info/late-1"><h2 class="job-title">Late Apply Now Role</h2></a>
        <div class="company">Scroll Co</div>
        <button type="button" class="apply">APPLY NOW</button>
      </div>
      <div class="match-col">90% Strong Match</div>`;
    main.appendChild(late);

    const autofillLate = document.createElement('div');
    autofillLate.className = 'job-tile';
    autofillLate.setAttribute('data-job-id', 'late-af');
    autofillLate.innerHTML = `
      <div class="job-card-body">
        <a href="/jobs/info/late-af"><h2 class="job-title">Late Autofill Role</h2></a>
        <div class="company">Keep Co</div>
        <button type="button" class="apply">APPLY WITH AUTOFILL</button>
      </div>
      <div class="match-col">80% Good Match</div>`;
    main.appendChild(autofillLate);

    // Simulate scroll-driven re-filter (same path as watchJobrightListFilter).
    document.dispatchEvent(new Event('scroll', { bubbles: true }));
    hideUnsupportedJobrightListCards(document);

    expect(late.getAttribute(JR_LIST_HIDDEN_ATTR)).toBe('1');
    expect(autofillLate.getAttribute(JR_LIST_HIDDEN_ATTR)).toBeNull();
    expect(document.querySelector('[data-job-id="tiger-1"]')!.getAttribute(JR_LIST_HIDDEN_ATTR)).toBeNull();
  });
});

describe('detectJobrightApplyMethod on job detail', () => {
  it('blocks Apply Now postings before open', async () => {
    const { FakeBrowser } = await import('../jobrightHarness');
    const b = new FakeBrowser('https://jobright.ai/jobs/info/hcl-1');
    expect(b.ctl.pageState()).toMatchObject({
      pageType: 'job-detail',
      applyMethod: 'apply_now',
      blocker: { kind: 'apply_now' },
    });
    expect(detectJobrightApplyMethod(document).method).toBe('apply_now');
    const open = await b.send({ type: 'AF_OPEN_APPLICATION' });
    expect(open.ok).toBe(false);
    expect(open.blocker?.kind).toBe('apply_now');
  });

  it('allows Apply with Autofill postings', async () => {
    const { FakeBrowser } = await import('../jobrightHarness');
    const b = new FakeBrowser('https://jobright.ai/jobs/info/tiger-1');
    expect(b.ctl.pageState()).toMatchObject({ applyMethod: 'autofill', blocker: null });
    expect(detectJobrightApplyMethod(document).method).toBe('autofill');
  });
});
