import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderHook } from '@testing-library/react';
import type { BuilderForm } from '@/types';
import { buildMasterFromForm, builderFromParsed, builderProblems, builderToParsed, emptyBuilder, monthToResume, resumeToMonth } from '@/services/resume/builder';
import { parseResumeText } from '@/services/resume/parser';
import { yearsOfExperience } from '@/services/matching/experience';
import { useLibrary } from '@/hooks/useLibrary';
import { ResumeBuilder } from '@/components/ResumeBuilder';
import { EMPTY_PROFILE } from '@/storage/repositories';

const profile = {
  ...EMPTY_PROFILE,
  fullName: 'Riley Chen', email: 'riley@example.com', phone: '(555) 010-2000', location: 'Denver, CO',
  city: 'Denver', state: 'CO', country: 'United States',
};

function form(): BuilderForm {
  return {
    headline: 'Video Playback Engineer',
    summary: '',
    skills: 'HLS, DRM, Swift, Kotlin',
    certifications: '',
    languages: 'English, Japanese',
    jobs: [
      { id: 'j1', company: 'Beta Streams', title: 'Video Engineer', city: 'Boston, MA', start: '2019-01', end: '2021-12', current: false, did: 'Built HLS packaging workflows\n• Ran the live ingest platform for 40 channels', technologies: 'C++, FFmpeg' },
      { id: 'j2', company: 'Acme Media', title: 'Senior Player Engineer', city: 'Denver, CO', start: '2022-01', end: '', current: true, did: 'Built the iOS and Android player\nCut startup time by 30%', technologies: 'Swift, Kotlin, ExoPlayer' },
    ],
    education: [{ id: 'e1', degree: 'Bachelor’s degree', field: 'Computer Science', school: 'State University', city: 'Austin, TX', start: '2014-09', end: '2018-05' }],
  };
}

describe('resume form → master resume', () => {
  it('turns each real job into a dated job with its own bullets and technologies, newest first', () => {
    const p = builderToParsed(form(), profile);
    expect(p.contact).toMatchObject({ fullName: 'Riley Chen', email: 'riley@example.com', phone: '(555) 010-2000', location: 'Denver, CO' });
    expect(p.experience.map((e) => [e.company, e.title, e.location, e.startDate, e.endDate])).toEqual([
      ['Acme Media', 'Senior Player Engineer', 'Denver, CO', '01/2022', 'Present'],
      ['Beta Streams', 'Video Engineer', 'Boston, MA', '01/2019', '12/2021'],
    ]);
    expect(p.experience[1]!.bullets).toEqual(['Built HLS packaging workflows', 'Ran the live ingest platform for 40 channels']);
    expect(p.experience[0]!.technologies).toEqual(['Swift', 'Kotlin', 'ExoPlayer']);
    expect(p.education[0]).toMatchObject({ degree: 'Bachelor’s degree in Computer Science', institution: 'State University', date: '09/2014 – 05/2018', location: 'Austin, TX' });
    expect(p.languages).toEqual(['English', 'Japanese']);
  });

  it('the stored resume reads back the same, and everything typed is a confirmed fact', () => {
    const m = buildMasterFromForm(form(), profile, 'Mine');
    expect(m.sourceFormat).toBe('form');
    expect(m.facts.every((f) => f.status === 'confirmed')).toBe(true);
    expect(parseResumeText(m.rawText).experience).toHaveLength(2);
    expect(yearsOfExperience(m.parsed.experience, new Date('2026-10-30'))).toBeGreaterThan(7);
  });

  it('says exactly what is missing', () => {
    const f = emptyBuilder();
    expect(builderProblems(f)).toEqual(['Add at least one job.']);
    f.jobs[0] = { ...f.jobs[0]!, company: 'Acme', did: 'One line' };
    expect(builderProblems(f)).toEqual([
      'Acme: add the start month.',
      'Acme: add the end month, or tick “I work here now”.',
    ]);
  });

  it('converts dates and an imported resume into the form', () => {
    expect(monthToResume('2023-02')).toBe('02/2023');
    expect(resumeToMonth('Feb 2023')).toBe('2023-02');
    expect(resumeToMonth('02/2023')).toBe('2023-02');
    const back = builderFromParsed(builderToParsed(form(), profile));
    expect(back.jobs.map((j) => [j.company, j.start, j.end, j.current])).toEqual([
      ['Acme Media', '2022-01', '', true],
      ['Beta Streams', '2019-01', '2021-12', false],
    ]);
    expect(back.education[0]).toMatchObject({ degree: 'Bachelor’s degree', field: 'Computer Science', start: '2014-09', end: '2018-05' });
  });
});

describe('resume form screen', () => {
  it('saves contact details to the profile and the history as the default resume', async () => {
    const { result } = renderHook(() => useLibrary());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    render(<ResumeBuilder lib={result.current} />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('Full name'), 'Riley Chen');
    await u.type(screen.getByLabelText('City and state'), 'Denver, CO');
    await u.type(screen.getByLabelText('Phone'), '555 010 2000');
    await u.type(screen.getByLabelText('Email'), 'riley@example.com');
    await u.click(screen.getByRole('button', { name: 'Save resume' }));
    // Nothing is saved until a real job is entered.
    expect(await screen.findByText('Add at least one job.')).toBeInTheDocument();
    await u.type(screen.getByLabelText('Company'), 'Acme Media');
    await u.type(screen.getByLabelText('Your job title'), 'Player Engineer');
    await u.type(screen.getByLabelText('Start month'), '2020-03');
    await u.click(screen.getByLabelText('I work here now'));
    await u.type(screen.getByLabelText('What you did there — one per line'), 'Built the iOS player{enter}Added DRM with FairPlay');
    expect(screen.getByRole('status')).toHaveTextContent(/1 job · about 6 years/);
    await u.click(screen.getByRole('button', { name: 'Save resume' }));
    await waitFor(() => expect(result.current.resumes).toHaveLength(1));
    const r = result.current.resumes[0]!;
    expect(r).toMatchObject({ sourceFormat: 'form', isDefault: true });
    expect(r.parsed.experience[0]).toMatchObject({ company: 'Acme Media', title: 'Player Engineer', startDate: '03/2020', endDate: 'Present', bullets: ['Built the iOS player', 'Added DRM with FairPlay'] });
    expect(result.current.profile).toMatchObject({ fullName: 'Riley Chen', email: 'riley@example.com', location: 'Denver, CO' });
  });
});

describe('tailoring from the form', () => {
  it('writes a job-targeted resume with every job from the form and nothing else', async () => {
    const { mockJob, emptySession } = await import('../helpers');
    const { runAnalysis, runTailoring } = await import('@/services/workflow/engine');
    const { DEFAULT_SETTINGS } = await import('@/types');
    const m = buildMasterFromForm(form(), profile, 'Mine');
    const job = mockJob();
    const settings = { ...DEFAULT_SETTINGS, engine: 'local' as const };
    const a = await runAnalysis(job, false, m, profile, { settings, apiKey: null });
    const r = await runTailoring({ ...emptySession(job, m.id), analysis: a.analysis, evidence: a.evidence }, m, profile, { settings, apiKey: null });
    expect(r.resume.contact).toMatchObject({ fullName: 'Riley Chen', email: 'riley@example.com', location: 'Denver, CO' });
    expect(r.resume.experience.map((e) => e.company)).toEqual(['Acme Media', 'Beta Streams']);
    expect(r.resume.issues.filter((i) => i.severity === 'critical')).toEqual([]);
    expect(r.resume.education[0]!.institution).toBe('State University');
  });
});
