/**
 * Regression: live job-boards.greenhouse.io embeds intl-tel-input's type=search
 * inside the application form. isPageChrome must not treat that form as site chrome,
 * or ApplyFlow never sees hasApplicationForm and fills nothing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createContentController } from '@/content/controller';
import { proposeFieldValues } from '@/services/forms/mapper';
import { isPageChrome } from '@/services/platforms/dom';
import { EMPTY_PROFILE } from '@/storage/repositories';
import type { CareerProfile } from '@/types';
import { browserlikeUploadDeps } from '../jobrightHarness';

const HTML = readFileSync(resolve(__dirname, '../fixtures/jobright/greenhouse-live-venn.html'), 'utf8');
const LIVE_URL = 'https://job-boards.greenhouse.io/venncity/jobs/4731865005';

const profile: CareerProfile = {
  ...EMPTY_PROFILE,
  fullName: 'Grant Howard',
  email: 'grant.howard@example.com',
  phone: '(727) 555-0148',
  linkedinUrl: 'https://www.linkedin.com/in/granthoward',
  city: 'St. Petersburg',
  state: 'FL',
  country: 'United States',
  location: 'St. Petersburg, FL, United States',
};

describe('Greenhouse live page (intl-tel-input search inside the form)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = HTML.replace(/^<!doctype html>/i, '')
      .replace(/^\s*<html[^>]*>/i, '')
      .replace(/<\/html>\s*$/i, '');
    for (const id of ['first_name', 'last_name', 'email', 'phone']) {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.value = '';
    }
  });

  it('does not treat the application form as page chrome because of the phone country search', () => {
    const form = document.querySelector('form#application-form')!;
    const phoneSearch = document.querySelector('input.iti__search-input, input[type="search"]') as HTMLInputElement;
    expect(form).toBeTruthy();
    expect(phoneSearch?.type).toBe('search');
    expect(form.contains(phoneSearch)).toBe(true);
    expect(isPageChrome(form)).toBe(false);
    expect(isPageChrome(document.getElementById('first_name')!)).toBe(false);
  });

  it('finds the form, attaches resume/cover letter, and fills core fields', async () => {
    const ctl = createContentController({
      doc: document,
      url: () => LIVE_URL,
      version: 'test',
      uploadDeps: browserlikeUploadDeps,
    });

    expect(ctl.pageState()).toMatchObject({ site: 'greenhouse', hasApplicationForm: true, pageType: 'application' });

    const scan = await ctl.handle({ type: 'AF_SCAN_FIELDS' });
    expect(scan).toMatchObject({ ok: true, formFound: true, site: 'greenhouse' });
    expect(scan.uploads.resume.method).toBeTruthy();
    expect(scan.uploads.coverLetter.method).toBeTruthy();
    expect(scan.fields.map((f) => f.label)).toEqual(expect.arrayContaining(['First Name', 'Last Name', 'Email', 'Phone']));

    const resumePayload = {
      name: 'Grant_Howard_Resume.pdf',
      mime: 'application/pdf',
      base64: Buffer.from('%PDF-1.4 resume').toString('base64'),
    };
    const coverPayload = {
      name: 'Grant_Howard_Cover.pdf',
      mime: 'application/pdf',
      base64: Buffer.from('%PDF-1.4 cover').toString('base64'),
    };
    expect(await ctl.handle({ type: 'AF_UPLOAD_DOCUMENT', kind: 'resume', file: resumePayload })).toMatchObject({ ok: true });
    expect(await ctl.handle({ type: 'AF_UPLOAD_DOCUMENT', kind: 'cover_letter', file: coverPayload })).toMatchObject({ ok: true });

    const proposals = proposeFieldValues(scan.fields, {
      profile,
      resume: null,
      coverLetter: null,
      includeCoverLetter: true,
      resumeFileName: resumePayload.name,
      coverLetterFileName: coverPayload.name,
      useSavedAnswers: true,
    });
    const fills = proposals
      .filter((p) => p.action === 'fill' && p.proposedValue)
      .map((p) => ({ fieldId: p.fieldId, kind: 'value' as const, value: p.proposedValue }));
    expect(fills.length).toBeGreaterThan(0);
    const filled = await ctl.handle({ type: 'AF_FILL_FIELDS', instructions: fills });
    expect(filled.results.every((r) => r.ok)).toBe(true);
    expect((document.getElementById('first_name') as HTMLInputElement).value).toBe('Grant');
    expect((document.getElementById('last_name') as HTMLInputElement).value).toBe('Howard');
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('grant.howard@example.com');
  });
});
