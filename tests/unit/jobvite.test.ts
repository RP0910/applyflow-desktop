import { describe, expect, it } from 'vitest';
import { jobviteAdapter } from '@/services/platforms/ats/jobvite';
import { adapterForUrl } from '@/services/platforms/registry';
import { applyCompanyResearch, PLACEHOLDER_COMPANY } from '@/services/workflow/cvEngine';
import { exampleResume } from '../helpers';

describe('Jobvite adapter', () => {
  it('is selected for jobs.jobvite.com and finds SELECT-based resume slots', () => {
    expect(adapterForUrl('https://jobs.jobvite.com/careers/varonis/job/oQRBAfwC/apply')?.id).toBe('jobvite');
    document.body.innerHTML = `
      <form id="jv-form">
        <div class="field">
          <label>Add Resume*</label>
          <button type="button">SELECT</button>
        </div>
        <div class="field">
          <label>First Name</label>
          <input name="firstName" />
          <label>Email</label>
          <input type="email" name="email" />
          <label>Phone</label>
          <input name="phone" />
        </div>
      </form>`;
    const root = jobviteAdapter.findApplicationRoot(document)!;
    expect(root).toBeTruthy();
    const targets = jobviteAdapter.forms!.uploadTargets!(root);
    expect(targets.resume.method).toBe('dropzone');
    expect(jobviteAdapter.forms!.documents!.findCard(root, 'resume')).toBeTruthy();
  });
});

describe('company research placeholders', () => {
  it('applies researched employer names and HQ locations onto the working master', () => {
    expect(PLACEHOLDER_COMPANY.test('Company 1')).toBe(true);
    expect(PLACEHOLDER_COMPANY.test('Example Systems')).toBe(true);
    expect(PLACEHOLDER_COMPANY.test('Varonis')).toBe(false);
    const master = exampleResume();
    master.parsed.experience[0]!.company = 'Company 1';
    master.parsed.experience[0]!.location = 'Denver, CO';
    const next = applyCompanyResearch(master, {
      companies: [{ periodIndex: 0, name: 'HashiCorp', activeYears: '2019-2023', techFit: 'cloud infra', hq: 'San Francisco, CA' }],
    });
    expect(next.master.parsed.experience[0]!.company).toBe('HashiCorp');
    expect(next.master.parsed.experience[0]!.location).toBe('San Francisco, CA');
    expect(next.replaced).toEqual([{ from: 'Company 1', to: 'HashiCorp', periodIndex: 0, location: 'San Francisco, CA' }]);
    const original = exampleResume();
    const prior = original.parsed.experience[0]!.company;
    const swapped = applyCompanyResearch(original, {
      companies: [{ periodIndex: 0, name: 'HashiCorp', activeYears: '2019-2023', techFit: 'cloud infra', hq: '' }],
    });
    expect(swapped.master.parsed.experience[0]!.company).toBe('HashiCorp');
    expect(swapped.replaced).toEqual([{ from: prior, to: 'HashiCorp', periodIndex: 0, location: undefined }]);
    const same = applyCompanyResearch(exampleResume(), {
      companies: [{ periodIndex: 0, name: prior, activeYears: '2019-2023', techFit: 'cloud infra', hq: '' }],
    });
    expect(same.master.parsed.experience[0]!.company).toBe(prior);
    expect(same.replaced).toEqual([]);
    const hqOnly = applyCompanyResearch(exampleResume(), {
      companies: [{ periodIndex: 0, name: prior, activeYears: '2019-2023', techFit: 'cloud infra', hq: 'Chicago, IL' }],
    });
    expect(hqOnly.master.parsed.experience[0]!.company).toBe(prior);
    expect(hqOnly.master.parsed.experience[0]!.location).toBe('Chicago, IL');
  });
});
