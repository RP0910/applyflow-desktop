import { describe, expect, it } from 'vitest';
import {
  applicationHostMatch,
  identityFromJob,
  isConfidentMatch,
  matchJobIdentity,
  pageLeftThisJob,
  sameBoardJob,
  sessionFitsApplicationPage,
  type JobIdentity,
  type ObservedJob,
} from '@/services/workflow/jobIdentity';
import type { JobPosting } from '@/types';

function posting(partial: Partial<JobPosting> & Pick<JobPosting, 'jobKey' | 'title' | 'company' | 'platform'>): JobPosting {
  return {
    jobId: null,
    url: 'https://www.dice.com/job-detail/aaa',
    applicationUrl: null,
    location: '',
    remoteStatus: 'unknown',
    salary: null,
    employmentType: null,
    contractDuration: null,
    datePosted: null,
    description: '',
    requiredSkills: [],
    preferredSkills: [],
    responsibilities: [],
    qualifications: [],
    benefits: [],
    educationRequirements: [],
    clearanceRequirements: [],
    workAuthorizationRequirements: [],
    sponsorshipLanguage: [],
    externalApply: false,
    ...partial,
  };
}

function job(partial: Partial<JobPosting> & Pick<JobPosting, 'jobKey' | 'title' | 'company' | 'platform'>): JobIdentity {
  return identityFromJob(posting(partial));
}

function page(partial: Partial<ObservedJob> & Pick<ObservedJob, 'url' | 'pageType'>): ObservedJob {
  return {
    jobKey: null,
    title: '',
    company: null,
    hasApplicationForm: false,
    site: null,
    ...partial,
  };
}

describe('matchJobIdentity', () => {
  it('matches the same board job key', () => {
    const expected = job({ jobKey: 'dice:abc', jobId: 'abc', title: 'Engineer', company: 'Acme', platform: 'dice' });
    const m = matchJobIdentity(expected, page({ url: 'https://www.dice.com/job-detail/abc', pageType: 'job-detail', jobKey: 'dice:abc', title: 'Engineer', site: 'dice' }));
    expect(m.verdict).toBe('match');
    expect(isConfidentMatch(m)).toBe(true);
  });

  it('mismatches a different Dice job key', () => {
    const expected = job({ jobKey: 'dice:aaa', jobId: 'aaa', title: 'Engineer', company: 'Acme', platform: 'dice' });
    const m = matchJobIdentity(expected, page({ url: 'https://www.dice.com/job-detail/bbb', pageType: 'job-detail', jobKey: 'dice:bbb', title: 'Other', site: 'dice' }));
    expect(m.verdict).toBe('mismatch');
    expect(m.confidence).toBeGreaterThan(0.9);
  });

  it('matches Jobright id from path or query', () => {
    const expected = job({
      jobKey: 'jobright:lever-1',
      jobId: 'lever-1',
      platform: 'jobright',
      url: 'https://jobright.ai/jobs/info/lever-1',
      title: 'PCB Layout Technician',
      company: 'Northwind Avionics',
    });
    expect(sameBoardJob(expected, page({ url: 'https://jobright.ai/jobs/info/lever-1', pageType: 'job-detail', jobKey: 'jobright:lever-1', site: 'jobright' }))).toBe(true);
    expect(
      matchJobIdentity(
        expected,
        page({ url: 'https://jobright.ai/jobs/recommend?jobId=lever-1', pageType: 'job-detail', jobKey: 'jobright:lever-1', site: 'jobright' }),
      ).verdict,
    ).toBe('match');
  });

  it('treats a Jobright list (no job id) as left / mismatch', () => {
    const expected = job({
      jobKey: 'jobright:lever-1',
      jobId: 'lever-1',
      platform: 'jobright',
      url: 'https://jobright.ai/jobs/info/lever-1',
      title: 'PCB Layout Technician',
      company: 'Northwind',
    });
    const list = page({ url: 'https://jobright.ai/jobs/recommend', pageType: 'search', site: 'jobright', title: 'Jobs' });
    expect(matchJobIdentity(expected, list).verdict).toBe('mismatch');
    expect(pageLeftThisJob(list, { jobKey: expected.jobKey, job: posting({ ...expected, platform: 'jobright' }) })).toBe(true);
  });

  it('treats Jobright job-detail without an id as off-job when the session expects one', () => {
    const expected = job({
      jobKey: 'jobright:lever-1',
      jobId: 'lever-1',
      platform: 'jobright',
      url: 'https://jobright.ai/jobs/info/lever-1',
      title: 'PCB Layout Technician',
      company: 'Northwind',
    });
    const m = matchJobIdentity(
      expected,
      page({ url: 'https://jobright.ai/jobs/recommend', pageType: 'job-detail', jobKey: null, site: 'jobright', title: 'Something' }),
    );
    expect(m.verdict).toBe('mismatch');
  });

  it('marks an ATS form compatible when the apply host matches', () => {
    const expected = job({
      jobKey: 'jobright:lever-1',
      jobId: 'lever-1',
      platform: 'jobright',
      url: 'https://jobright.ai/jobs/info/lever-1',
      applicationUrl: 'https://jobs.lever.co/northwind/7c1f2e9a-5b3d-4c8e-9a10-2f6b8e0a5c71',
      title: 'PCB Layout Technician',
      company: 'Northwind Avionics',
    });
    expect(applicationHostMatch(expected.applicationUrl, 'https://jobs.lever.co/northwind/7c1f2e9a-5b3d-4c8e-9a10-2f6b8e0a5c71/apply')).toBe(true);
    const m = matchJobIdentity(
      expected,
      page({
        url: 'https://jobs.lever.co/northwind/7c1f2e9a-5b3d-4c8e-9a10-2f6b8e0a5c71/apply',
        pageType: 'application',
        hasApplicationForm: true,
        site: 'lever',
        title: 'PCB Layout Technician',
        company: 'Northwind Avionics',
      }),
    );
    expect(m.verdict).toBe('compatible');
    expect(
      sessionFitsApplicationPage(
        { job: posting({ ...expected, platform: 'jobright', externalApply: true }) },
        {
          url: 'https://jobs.lever.co/northwind/7c1f2e9a-5b3d-4c8e-9a10-2f6b8e0a5c71/apply',
          pageType: 'application',
          jobKey: null,
          title: 'PCB Layout Technician',
          company: 'Northwind Avionics',
          hasApplicationForm: true,
          site: 'lever',
        },
      ),
    ).toBe(true);
  });

  it('soft-matches title and company on job-detail when ids are absent', () => {
    const expected = job({
      jobKey: 'url:https://example.com/jobs/1',
      url: 'https://example.com/jobs/1',
      title: 'Senior Software Engineer',
      company: 'Globex Corporation',
      platform: 'jobright',
    });
    const m = matchJobIdentity(
      expected,
      page({
        url: 'https://example.com/jobs/1?ref=x',
        pageType: 'job-detail',
        title: 'Senior Software Engineer',
        company: 'Globex Corporation',
      }),
    );
    expect(['match', 'compatible']).toContain(m.verdict);
  });

  it('mismatches when title and company both conflict on job-detail', () => {
    const expected = job({
      jobKey: 'url:https://example.com/a',
      url: 'https://example.com/a',
      title: 'PCB Layout Technician',
      company: 'Northwind Avionics',
      platform: 'jobright',
    });
    const m = matchJobIdentity(
      expected,
      page({
        url: 'https://example.com/b',
        pageType: 'job-detail',
        title: 'Marketing Intern',
        company: 'Totally Different Co',
      }),
    );
    expect(m.verdict).toBe('mismatch');
  });

  it('rejects attaching a session to an unrelated ATS host', () => {
    const session = {
      job: posting({
        jobKey: 'jobright:lever-1',
        jobId: 'lever-1',
        platform: 'jobright',
        url: 'https://jobright.ai/jobs/info/lever-1',
        applicationUrl: 'https://jobs.lever.co/northwind/7c1f2e9a',
        title: 'PCB Layout Technician',
        company: 'Northwind',
        externalApply: true,
      }),
    };
    expect(
      sessionFitsApplicationPage(session, {
        url: 'https://boards.greenhouse.io/embed/job_app?for=acmerobotics&token=4012345',
        pageType: 'application',
        jobKey: null,
        title: 'Robotics Engineer',
        company: 'Acme Robotics',
        hasApplicationForm: true,
        site: 'greenhouse',
      }),
    ).toBe(false);
  });
});
