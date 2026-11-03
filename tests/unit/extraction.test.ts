import { describe, expect, it } from 'vitest';
import { diceAdapter, extractDiceJob, detectCaptcha } from '@/services/platforms/dice/adapter';
import { adapterForUrl } from '@/services/platforms/registry';
import { detectSignals, splitDescription, classifyJobSkills } from '@/services/extraction/sections';
import { htmlToText } from '@/services/extraction/htmlToText';
import { diceJobIdFromUrl, jobKeyFor, normalizeJobUrl } from '@/utils/jobKey';
import { fixtureDoc, JOB_URL, APPLY_URL } from '../helpers';

describe('Dice job extraction', () => {
  it('reads the modern layout from structured data with high confidence', () => {
    const r = extractDiceJob(fixtureDoc('job-detail-jsonld.html'), `${JOB_URL}?searchlink=abc&utm_source=x`);
    expect(r.ok).toBe(true);
    expect(r.uncertain).toBe(false);
    expect(r.sources).toContain('structured-data');
    const j = r.job!;
    expect(j.title).toBe('Senior Architect AI Engineering and Platforms');
    expect(j.company).toBe('Meridian Credit Analytics LLC');
    expect(j.location).toBe('Chicago, IL');
    expect(j.remoteStatus).toBe('onsite');
    expect(j.employmentType).toBe('Full-time');
    expect(j.salary).toBe('USD 142,500 – 237,500 per year');
    expect(j.datePosted).toBe('2026-10-29');
    expect(j.jobKey).toBe('dice:3f9a1c2e-7b4d-4e8a-9c1f-2d6b8e0a5c71');
    expect(j.url).toBe(JOB_URL); // tracking params removed
    expect(j.externalApply).toBe(false);
    expect(j.applicationUrl).toBe(APPLY_URL);
    expect(j.responsibilities).toHaveLength(7);
    expect(j.qualifications.length).toBeGreaterThanOrEqual(7);
    expect(j.benefits).toContain('401(k) with company match');
    expect(j.requiredSkills).toEqual(expect.arrayContaining(['Python', 'Java', 'AWS', 'Kubernetes', 'Apache Kafka', 'Terraform']));
    expect(j.preferredSkills).toEqual(expect.arrayContaining(['Azure OpenAI', 'Vertex AI', 'Databricks', 'Snowflake']));
    expect(j.workAuthorizationRequirements).toEqual(['Candidates must be authorized to work in the United States.']);
    expect(j.sponsorshipLanguage).toEqual(['This position is not eligible for visa sponsorship.']);
    expect(j.educationRequirements[0]).toMatch(/Bachelor/);
  });

  it('reads an older layout through known selectors when there is no structured data', () => {
    const r = extractDiceJob(fixtureDoc('job-detail-legacy.html'), 'https://www.dice.com/jobs/detail/contract-data-engineer/lakeshore/abc123');
    expect(r.ok).toBe(true);
    expect(r.sources).toEqual(['selectors']);
    const j = r.job!;
    expect(j.title).toBe('Contract Data Engineer (Spark / Airflow)');
    expect(j.company).toBe('Lakeshore Health Systems');
    expect(j.remoteStatus).toBe('remote');
    expect(j.employmentType).toMatch(/Contract/);
    expect(j.contractDuration).toMatch(/6 month/);
    expect(j.jobKey).toBe('dice:abc123');
    expect(j.workAuthorizationRequirements.join(' ')).toMatch(/US Citizen/);
    expect(j.sponsorshipLanguage.join(' ')).toMatch(/No C2C/);
    expect(j.preferredSkills).toEqual(expect.arrayContaining(['dbt', 'Terraform']));
  });

  it('marks a redesigned page as uncertain and says which fields need review', () => {
    const r = extractDiceJob(fixtureDoc('job-detail-redesigned.html'), 'https://www.dice.com/job-detail/11111111-2222-3333-4444-555555555555');
    expect(r.ok).toBe(true);
    expect(r.uncertain).toBe(true);
    expect(r.confidence.company).toBe('missing');
    expect(r.confidence.description).toBe('low');
    expect(r.warnings.join(' ')).toMatch(/heuristics/);
    expect(r.job!.requiredSkills).toEqual(expect.arrayContaining(['Kubernetes', 'Terraform']));
  });

  it('fails safely with a clear message when the page has no job content', () => {
    const r = extractDiceJob(fixtureDoc('job-detail-broken.html'), 'https://www.dice.com/job-detail/x');
    expect(r.ok).toBe(false);
    expect(r.job).toBeNull();
    expect(r.failureReason).toMatch(/Dice changed this page layout/);
  });
});

describe('Dice page detection', () => {
  it('classifies job, application, search and unsupported pages', () => {
    expect(diceAdapter.classifyPage(fixtureDoc('job-detail-jsonld.html'), JOB_URL)).toBe('job-detail');
    expect(diceAdapter.classifyPage(fixtureDoc('apply-wizard.html'), APPLY_URL)).toBe('application');
    expect(diceAdapter.classifyPage(fixtureDoc('job-detail-broken.html'), 'https://www.dice.com/jobs?q=architect')).toBe('search');
    expect(diceAdapter.classifyPage(fixtureDoc('job-detail-jsonld.html'), 'https://www.example.com/job-detail/1')).toBe('unsupported');
  });

  it('routes only Dice hosts to the Dice adapter', () => {
    expect(adapterForUrl('https://www.dice.com/job-detail/x')?.id).toBe('dice');
    expect(adapterForUrl('https://dice.com/job-detail/x')?.id).toBe('dice');
    // Other https sites: best-effort employer-site support (never the Dice adapter).
    expect(adapterForUrl('https://www.linkedin.com/jobs/view/1')?.id).toBe('generic');
    expect(adapterForUrl('https://dice.com.evil.example/job-detail/x')?.id).toBe('generic');
    expect(adapterForUrl('http://example.com/x')).toBeNull();
  });

  it('finds the internal apply control and flags external ones', () => {
    const internal = diceAdapter.findApplyControl(fixtureDoc('job-detail-jsonld.html'));
    expect(internal?.external).toBe(false);
    const doc = fixtureDoc('job-detail-jsonld.html');
    doc.querySelector('[data-cy="applyButton"]')!.textContent = 'Apply on company site';
    expect(diceAdapter.findApplyControl(doc)?.external).toBe(true);
  });

  it('requires exactly one enabled submit control', () => {
    const doc = fixtureDoc('apply-questions.html');
    const root = diceAdapter.findApplicationRoot(doc)!;
    expect(diceAdapter.findSubmitControl(root).match?.label).toBe('Submit Application');
    const extra = doc.createElement('button');
    extra.textContent = 'Submit';
    root.appendChild(extra);
    const two = diceAdapter.findSubmitControl(root);
    expect(two.match).toBeNull();
    expect(two.reason).toMatch(/More than one/);
  });

  it('detects CAPTCHAs without interacting with them', () => {
    const doc = fixtureDoc('apply-wizard.html');
    expect(detectCaptcha(doc)).toBe(false);
    doc.body.insertAdjacentHTML('beforeend', '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>');
    expect(detectCaptcha(doc)).toBe(true);
  });
});

describe('job description analysis', () => {
  it('splits sections by headings and keeps list items', () => {
    const text = htmlToText('<p>Intro.</p><h3>Responsibilities</h3><ul><li>Build APIs</li></ul><h3>Requirements</h3><ul><li>5+ years of experience with Go</li></ul><p><strong>Nice to have:</strong></p><ul><li>Rust</li></ul>');
    const s = splitDescription(text);
    expect(s.responsibilities).toEqual(['Build APIs']);
    expect(s.requirements).toEqual(['5+ years of experience with Go']);
    expect(s.preferred).toEqual(['Rust']);
    const skills = classifyJobSkills(s, text, []);
    expect(skills.required).toContain('Go');
    expect(skills.preferred).toContain('Rust');
  });

  it('detects clearance, citizenship, sponsorship, education, years and duration signals', () => {
    const sig = detectSignals('Active Secret clearance required.\nMust be a U.S. citizen.\nNo C2C.\nBachelor\'s degree required.\n7+ years of experience in Java.\nDuration: 12 months');
    expect(sig.clearance).toHaveLength(1);
    expect(sig.workAuthorization.join()).toMatch(/citizen/);
    expect(sig.sponsorship.join()).toMatch(/C2C/);
    expect(sig.education).toHaveLength(1);
    expect(sig.requiredYears).toBe(7);
    expect(sig.contractDuration).toBe('12 months');
  });
});

describe('job identity', () => {
  it('derives stable keys from current and legacy Dice URLs', () => {
    expect(diceJobIdFromUrl('https://www.dice.com/job-detail/ABC-123?x=1')).toBe('abc-123');
    expect(diceJobIdFromUrl('https://www.dice.com/jobs/detail/title/company/xyz789')).toBe('xyz789');
    expect(diceJobIdFromUrl('https://www.dice.com/job-applications/abc-123/wizard')).toBe('abc-123');
    expect(jobKeyFor('https://www.dice.com/job-detail/abc-123')).toBe(jobKeyFor('https://dice.com/job-applications/ABC-123/wizard'));
    expect(normalizeJobUrl('https://dice.com/job-detail/a?utm=1#top')).toBe('https://www.dice.com/job-detail/a');
  });
});
