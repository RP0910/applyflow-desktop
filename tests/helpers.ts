import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { JobPosting, JobSession, MasterResume } from '@/types';
import { buildMasterResume } from '@/services/resume/facts';
import { extractDiceJob } from '@/services/platforms/dice/adapter';

export const ROOT = resolve(__dirname, '..');
export const JOB_URL = 'https://www.dice.com/job-detail/3f9a1c2e-7b4d-4e8a-9c1f-2d6b8e0a5c71';
export const APPLY_URL = 'https://www.dice.com/job-applications/3f9a1c2e-7b4d-4e8a-9c1f-2d6b8e0a5c71/wizard';

export function fixture(name: string): string {
  return readFileSync(resolve(ROOT, 'tests/fixtures/dice', name), 'utf8');
}

export function fixtureDoc(name: string): Document {
  const doc = new DOMParser().parseFromString(fixture(name), 'text/html');
  return doc;
}

export function exampleResumeText(): string {
  return readFileSync(resolve(ROOT, 'docs/examples/example-master-resume.txt'), 'utf8');
}

export function exampleResume(): MasterResume {
  return buildMasterResume('Example', exampleResumeText(), 'text', null);
}

export function mockJob(): JobPosting {
  const r = extractDiceJob(fixtureDoc('job-detail-jsonld.html'), JOB_URL);
  if (!r.job) throw new Error('fixture failed');
  return r.job;
}

export function emptySession(job: JobPosting, resumeId: string | null = null): JobSession {
  return {
    jobKey: job.jobKey,
    job,
    extraction: { confidence: {}, sources: ['structured-data'], uncertain: false, warnings: [] },
    jobConfirmed: true,
    resumeId,
    analysis: null,
    evidence: [],
    masterScore: null,
    tailoredScore: null,
    resume: null,
    coverLetter: null,
    resumeReviewed: false,
    coverLetterReviewed: false,
    includeCoverLetter: true,
    fieldProposals: [],
    lastScanUrl: null,
    duplicateAcknowledged: false,
    applicationId: null,
    submittedAt: null,
    createdAt: '2026-10-30T10:00:00.000Z',
    updatedAt: '2026-10-30T10:00:00.000Z',
  };
}
