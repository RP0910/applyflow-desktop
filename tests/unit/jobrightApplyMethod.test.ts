import { describe, expect, it } from 'vitest';
import {
  applyMethodStatusLine,
  classifyJobrightApplyLabel,
  detectJobrightApplyMethod,
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
