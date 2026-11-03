/** Small pieces of the Jobright / employer-site support. */
import { describe, expect, it } from 'vitest';
import { countryOf, semanticOf } from '@/services/forms/mapper';
import { isJobrightListUrl, jobrightJobId } from '@/services/platforms/jobright/adapter';
import { backTargetIndex, isDiceApplicationUrl, isDiceSearchUrl } from '@/services/platforms/dice/navigation';
import { visibleCaptcha, embeddedFormUrl, statusBlocker } from '@/services/platforms/ats/common';
import { siteName } from '@/services/platforms/registry';

const html = (body: string) => {
  const doc = document.implementation.createHTMLDocument('t');
  doc.body.innerHTML = body;
  return doc;
};

describe('profile → form values', () => {
  it('reads the country from a profile location', () => {
    expect(countryOf('St. Petersburg, FL 33702, US')).toBe('United States');
    expect(countryOf('Chicago, IL')).toBe('United States');
    expect(countryOf('Austin, TX, USA')).toBe('United States');
    expect(countryOf('Toronto, ON, Canada')).toBe('Canada');
    expect(countryOf('')).toBe('');
  });
  it('knows Lever’s “Additional information” box takes the cover letter, and “Country” fields', () => {
    expect(semanticOf({ label: 'Add a cover letter or anything else you want to share.', name: 'comments', control: 'textarea' })).toBe('cover_letter_text');
    expect(semanticOf({ label: 'Country', name: 'country', control: 'combobox' })).toBe('country');
    expect(semanticOf({ label: 'Country of citizenship', name: '', control: 'select' })).not.toBe('country');
  });
  it('maps Workday-style address labels', () => {
    expect(semanticOf({ label: 'Address Line 1', name: '', control: 'text' })).toBe('street');
    expect(semanticOf({ label: 'Address Line 2', name: '', control: 'text' })).toBe('address_line2');
    expect(semanticOf({ label: 'City', name: '', control: 'text' })).toBe('city');
    expect(semanticOf({ label: 'State', name: '', control: 'select' })).toBe('state');
    expect(semanticOf({ label: 'Postal Code', name: '', control: 'text' })).toBe('postal_code');
  });
});

describe('Jobright addresses', () => {
  it('job ids and lists', () => {
    expect(jobrightJobId('https://jobright.ai/jobs/info/66f1a2b3c4d5e6f7a8b9c0d1?utm=x')).toBe('66f1a2b3c4d5e6f7a8b9c0d1');
    expect(jobrightJobId('https://jobright.ai/jobs/recommend?jobId=abc')).toBe('abc');
    expect(isJobrightListUrl('https://jobright.ai/jobs/recommend')).toBe(true);
    expect(isJobrightListUrl('https://jobright.ai/jobs/search?value=technician')).toBe(true);
    expect(isJobrightListUrl('https://jobright.ai/jobs/info/abc')).toBe(false);
    expect(isDiceSearchUrl('https://jobright.ai/jobs/liked')).toBe(true);
  });
  it('Back from an employer form skips the application pages', () => {
    const h = ['https://jobright.ai/jobs/recommend', 'https://jobright.ai/jobs/info/x', 'https://jobs.lever.co/a/b', 'https://jobs.lever.co/a/b/apply'];
    expect(isDiceApplicationUrl(h[3]!)).toBe(true);
    expect(backTargetIndex(h, 3)).toBe(1);
  });
  it('names the site', () => {
    expect(siteName('https://jobs.lever.co/a/b/apply')).toBe('Lever');
    expect(siteName('https://contoso.wd5.myworkdayjobs.com/x')).toBe('Workday');
    expect(siteName('https://careers.acme.com/jobs/1')).toBe('careers.acme.com');
  });
});

describe('employer pages', () => {
  it('only a visible CAPTCHA challenge counts', () => {
    expect(visibleCaptcha(html('<div class="grecaptcha-badge"><iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?size=invisible"></iframe></div>'))).toBe(false);
    expect(visibleCaptcha(html('<iframe src="https://newassets.hcaptcha.com/captcha#frame=checkbox-invisible" style="display:none"></iframe>'))).toBe(false);
    expect(visibleCaptcha(html('<iframe title="recaptcha challenge expires in two minutes" src="https://www.google.com/recaptcha/api2/bframe"></iframe>'))).toBe(true);
  });
  it('finds a Greenhouse, Lever or Ashby form shown in a frame', () => {
    expect(embeddedFormUrl(html('<iframe src="https://boards.greenhouse.io/embed/job_app?for=acme&token=1"></iframe>'))).toBe('https://boards.greenhouse.io/embed/job_app?for=acme&token=1');
    expect(embeddedFormUrl(html('<iframe src="https://jobs.ashbyhq.com/acme/1/embed"></iframe>'))).toBe('https://jobs.ashbyhq.com/acme/1');
    expect(embeddedFormUrl(html('<iframe src="https://www.youtube.com/embed/x"></iframe>'))).toBeNull();
  });
  it('closed and already-applied messages', () => {
    expect(statusBlocker(html('<p>The job you are looking for is no longer open.</p>'), false)?.kind).toBe('closed');
    expect(statusBlocker(html('<p>You have already applied to this job.</p>'), true)?.kind).toBe('applied');
    // A job description mentioning closing isn't a closed job while the form is there.
    expect(statusBlocker(html('<p>Applications close on Friday; this position is no longer open after that.</p><form></form>'), true)).toBeNull();
  });
});

describe('your details only go where they belong', () => {
  it('ignores look-alike words and questions about other people', () => {
    expect(semanticOf({ label: 'What does engineering excellence mean to you?', name: '', control: 'textarea' })).not.toBe('phone');
    expect(semanticOf({ label: 'Miscellaneous', name: '', control: 'text' })).not.toBe('phone');
    expect(semanticOf({ label: 'Referrer email', name: '', control: 'email' })).toBe('unknown');
    expect(semanticOf({ label: 'Name of the employee who referred you', name: '', control: 'text' })).toBe('unknown');
    expect(semanticOf({ label: 'Kaggle profile URL', name: '', control: 'text' })).not.toBe('summary');
    expect(semanticOf({ label: 'Mobile phone', name: '', control: 'tel' })).toBe('phone');
    expect(semanticOf({ label: 'Email', name: '', control: 'email' })).toBe('email');
  });
});

describe('Jobright titles and stale page data', () => {
  it('cleans Jobright’s title strings', async () => {
    const { cleanJobTitle } = await import('@/services/platforms/jobright/adapter');
    expect(cleanJobTitle('Experienced Data Science AI Engineer Job Details | Gainwell Technologies LLC')).toEqual({ title: 'Experienced Data Science AI Engineer', company: 'Gainwell Technologies LLC' });
    expect(cleanJobTitle('[Remote] Data Engineer Job Details | Acme')).toEqual({ title: 'Data Engineer', company: 'Acme' });
    expect(cleanJobTitle('Data Engineer @ Acme')).toEqual({ title: 'Data Engineer', company: 'Acme' });
    expect(cleanJobTitle('Data Engineer')).toEqual({ title: 'Data Engineer' });
  });

  it('inside the signed-in app, ignores page data left from another job and reads this job’s own page', async () => {
    const { extractJobrightJobAsync } = await import('@/services/platforms/jobright/adapter');
    const nd = (id: string, title: string, company: string) =>
      `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { dataSource: { jobResult: { jobId: id, jobTitle: `${title} Job Details | ${company} LLC`, jobNlpTitle: title, jobSummary: `${company} is hiring a ${title} to build data pipelines and models for healthcare clients.`, coreResponsibilities: ['Build models', 'Ship pipelines'], jobLocation: 'Remote' }, companyResult: { companyName: company } } } } })}</script>`;
    // The app was first loaded on job A; job B was opened from a list without a page load.
    const doc = html(`${nd('aaa111', 'Nurse Manager', 'Mercy Health')}<main><h2>Gainwell Technologies · 43 minutes ago</h2><h1>Experienced Data Science AI Engineer</h1><button>APPLY WITH AUTOFILL</button></main>`);
    const urls: string[] = [];
    const res = await extractJobrightJobAsync(doc, 'https://jobright.ai/jobs/info/bbb222', async (u) => {
      urls.push(u);
      return `<!doctype html><html><head>${nd('bbb222', 'Experienced Data Science AI Engineer', 'Gainwell Technologies')}</head><body></body></html>`;
    });
    expect(urls).toEqual(['https://jobright.ai/jobs/info/bbb222']);
    expect(res.ok).toBe(true);
    expect(res.job).toMatchObject({ title: 'Experienced Data Science AI Engineer', company: 'Gainwell Technologies' });
    expect(res.job!.description).not.toMatch(/Nurse|Mercy/);
  });

  it('without the fetch, still names the job from what the page shows, never from another job’s data', async () => {
    const { extractJobrightJobAsync } = await import('@/services/platforms/jobright/adapter');
    const doc = html('<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"dataSource":{"jobResult":{"jobId":"aaa111","jobTitle":"Nurse Manager","jobSummary":"Mercy Health is hiring a nurse manager."}}}}}</script><main><h2>Gainwell Technologies · 43 minutes ago</h2><h1>Experienced Data Science AI Engineer</h1><p>Responsibilities: build models.</p></main>');
    const res = await extractJobrightJobAsync(doc, 'https://jobright.ai/jobs/info/bbb222', async () => {
      throw new Error('offline');
    });
    expect(res.job?.title ?? '').not.toMatch(/Nurse/);
    if (res.job) expect(res.job.title).toBe('Experienced Data Science AI Engineer');
  });
});
