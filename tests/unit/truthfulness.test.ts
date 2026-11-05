import { describe, expect, it } from 'vitest';
import type { TailoredResume } from '@/types';
import { analyzeJobLocally } from '@/services/analysis/localAnalyzer';
import { classifySkills } from '@/services/matching/evidence';
import { tailorLocally } from '@/services/tailoring/localTailor';
import { validateTailoredResume, validateCoverLetter, findCliches, hasCritical } from '@/services/tailoring/validator';
import { applyAutoFixes } from '@/services/tailoring/autofix';
import { assembleFromClaude } from '@/services/tailoring/assemble';
import { generateLocalCoverLetter } from '@/services/coverLetter/local';
import { compareResumes } from '@/services/tailoring/diff';
import { extractMetrics } from '@/utils/text';
import { exampleResume, mockJob } from '../helpers';

const master = exampleResume();
const job = mockJob();
const analysis = analyzeJobLocally(job, master);
const evidence = classifySkills(analysis.requiredSkills, analysis.preferredSkills, master);
const ctx = { master, job, evidence, length: 'two_pages' as const };
const base = (): TailoredResume => tailorLocally({ master, job, analysis, evidence, length: 'two_pages', version: 1 });

describe('local tailoring', () => {
  it('produces a resume that passes every truthfulness check', () => {
    const t = base();
    expect(validateTailoredResume(t, ctx).filter((i) => i.severity === 'critical')).toEqual([]);
    expect(t.experience).toHaveLength(3);
    expect(t.experience.map((e) => e.company)).toEqual(['Northlake Payments', 'Northlake Payments', 'Brightline Logistics']);
    expect(t.skills.slice(0, 3)).toEqual(['Python', 'Java', 'AWS (EC2, EKS, Lambda, S3, SageMaker, Bedrock)']);
    expect(t.skills).not.toContain('Databricks');
    expect(t.changes.length).toBeGreaterThan(0);
  });

  it('respects a one-page target without dropping any role', () => {
    const t = tailorLocally({ master, job, analysis, evidence, length: 'one_page', version: 1 });
    expect(t.experience).toHaveLength(3);
    expect(t.experience[0]!.bullets.length).toBeLessThanOrEqual(4);
    expect(t.experience.every((e) => e.bullets.length >= 1)).toBe(true);
  });
});

describe('truthfulness validator', () => {
  it('flags invented metrics', () => {
    const t = base();
    t.experience[0]!.bullets[0] = 'Cut cloud spend by 47% across the platform.';
    const issues = validateTailoredResume(t, ctx);
    expect(issues.find((i) => i.code === 'invented_metric')?.message).toMatch(/47%/);
  });

  it('flags skills the master resume does not support', () => {
    const t = base();
    t.skills.push('Databricks');
    t.summary += ' Deep expertise in Snowflake.';
    const codes = validateTailoredResume(t, ctx).filter((i) => i.code === 'unsupported_skill').map((i) => i.excerpt);
    expect(codes).toEqual(expect.arrayContaining(['Databricks']));
  });

  it('flags changed employers, titles and dates, and removed roles', () => {
    const t = base();
    t.experience[0]!.company = 'Google';
    t.experience[1]!.title = 'Staff Engineer';
    t.experience[2]!.startDate = 'Jan 2010';
    t.experience.push({ sourceId: 'made-up', title: 'CTO', company: 'Startup', location: '', startDate: '2010', endDate: '2011', bullets: [] });
    const codes = validateTailoredResume(t, ctx).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['invented_employer', 'invented_title', 'changed_dates']));
    const removed = base();
    removed.experience.pop();
    expect(validateTailoredResume(removed, ctx).map((i) => i.code)).toContain('hidden_gap');
  });

  it('flags invented education, certifications and a changed location', () => {
    const t = base();
    t.education.push({ id: 'x', degree: 'M.S. Computer Science', institution: 'Stanford University', date: '2016', details: [] });
    t.certifications.push('Google Professional ML Engineer');
    t.contact.location = 'Remote, USA';
    const codes = validateTailoredResume(t, ctx).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['invented_education', 'invented_certification', 'location_mismatch']));
  });

  it('flags text copied word-for-word from the job description', () => {
    const t = base();
    t.summary = 'Partner with data science, security and product teams to move models from prototype to production.';
    expect(validateTailoredResume(t, ctx).map((i) => i.code)).toContain('copied_job_text');
  });

  it('flags facts the user restricted', () => {
    const m = structuredClone(master);
    m.facts.find((f) => f.text.startsWith('Mentored 8 engineers'))!.status = 'do_not_use';
    const t = base();
    t.experience[0]!.bullets.push('Mentored 8 engineers; two were promoted to senior engineer.');
    expect(validateTailoredResume(t, { ...ctx, master: m }).map((i) => i.code)).toContain('restricted_fact');
  });

  it('auto-fix reverts to the user’s own wording and clears critical issues', () => {
    const t = base();
    t.experience[0]!.bullets[0] = 'Designed an LLM gateway on AWS EKS adopted by 90+ product teams using Databricks.';
    t.skills.push('Databricks');
    t.contact.location = 'Austin, TX';
    t.experience.pop();
    const issues = validateTailoredResume(t, ctx);
    expect(hasCritical(issues)).toBe(true);
    const fixed = applyAutoFixes(t, master, undefined, issues);
    expect(validateTailoredResume(fixed, ctx).filter((i) => i.severity === 'critical')).toEqual([]);
    const bullets = fixed.experience[0]!.bullets;
    expect(bullets.some((b) => /40\+ product teams/.test(b))).toBe(true);
    expect(bullets.some((b) => /90\+|Databricks/.test(b))).toBe(false);
    expect(new Set(bullets).size).toBe(bullets.length);
  });
});

describe('Claude output assembly', () => {
  it('takes employers, titles, dates and education from the master, whatever Claude says', () => {
    const p = master.parsed;
    const t = assembleFromClaude(
      {
        headline: 'Principal Engineer, AI Platforms',
        summary: 'Builds AI platforms.',
        skills: ['Python', 'AWS'],
        experience: [{ sourceId: p.experience[0]!.id, bullets: ['Designed the LLM gateway used by 40+ product teams.'] }, { sourceId: 'invented', bullets: ['Ran Google'] }],
        projects: [{ sourceName: 'Made-up project', bullets: ['x'] }],
        certificationIndexes: [0, 99],
        additional: [],
        changes: [],
        unsupportedRequirements: ['Databricks'],
      },
      master,
      undefined,
      2,
      'claude-sonnet-5-5',
    );
    expect(t.experience.map((e) => [e.company, e.title, e.startDate])).toEqual(p.experience.map((e) => [e.company, e.title, e.startDate]));
    expect(t.experience[1]!.bullets.length).toBeGreaterThan(0);
    expect(t.projects.map((x) => x.name)).not.toContain('Made-up project');
    expect(t.projects.every((x) => p.projects.some((m) => m.name === x.name))).toBe(true);
    expect(t.certifications).toEqual([p.certifications[0]]);
    expect(t.changes.some((c) => /Restored/.test(c.reason))).toBe(true);
  });
});

describe('cover letter', () => {
  const resume = base();
  it('builds a local letter only from the user’s own lines', () => {
    const text = generateLocalCoverLetter({ job, master, resume, evidence, tone: 'professional' });
    expect(text).toMatch(/^Dear Hiring Team,/);
    expect(text).toMatch(/Senior Architect AI Engineering and Platforms/);
    expect(text).toMatch(/Jordan Rivera$/);
    expect(text).toMatch(/Earlier there, as a Senior Software Engineer/);
    const issues = validateCoverLetter(text, { master, job, evidence, minWords: 150, maxWords: 400 });
    expect(issues.filter((i) => i.severity === 'critical')).toEqual([]);
    expect(findCliches(text)).toEqual([]);
  });

  it('makes a shorter version on request', () => {
    const full = generateLocalCoverLetter({ job, master, resume, evidence, tone: 'professional' });
    const short = generateLocalCoverLetter({ job, master, resume, evidence, tone: 'professional', action: 'shorter' });
    expect(short.length).toBeLessThan(full.length);
  });

  it('flags clichés and invented numbers', () => {
    const text = 'Dear Hiring Team,\n\nI am thrilled to apply. I thrive in a fast-paced environment and grew revenue 300%.\n\nSincerely,\nJordan';
    const codes = validateCoverLetter(text, { master, job, evidence, minWords: 10, maxWords: 400 }).map((i) => i.code);
    expect(codes.filter((c) => c === 'ai_cliche')).toHaveLength(2);
    expect(codes).toContain('invented_metric');
  });
});

describe('comparison and metrics', () => {
  it('labels moved, removed and added lines', () => {
    const t = base();
    const diffs = compareResumes(master.parsed, t);
    const exp = diffs.find((d) => d.section.startsWith('Principal'))!;
    expect(exp.tailored.some((l) => l.status === 'moved' || l.status === 'same')).toBe(true);
    expect(diffs.find((d) => d.section === 'Skills')!.tailored.some((l) => l.status === 'added')).toBe(true);
  });

  it('extracts metrics but not years', () => {
    expect(extractMetrics('Cut cost by 22% in 2021, handling 9,000 events and $2.5M budget, 10x faster')).toEqual(['22%', '9,000', '$2.5M', '10x']);
  });
});
