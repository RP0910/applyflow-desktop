/** Profile & answers → Education: editing the university / school on the candidate setup. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BuilderForm, MasterResume } from '@/types';
import { buildMasterFromForm, builderFromParsed, builderProblems, builderToParsed, emptyBuilder } from '@/services/resume/builder';
import { EducationSettings } from '@/components/EducationSettings';
import { assembleCv } from '@/services/workflow/cvEngine';
import type { LibraryController } from '@/hooks/useLibrary';

function setupForm(): BuilderForm {
  return {
    ...emptyBuilder(),
    jobs: [{ id: 'j1', company: 'Raytheon', title: '', city: '', start: '2019-03', end: '', current: true, did: '', technologies: '' }],
    education: [{ id: 'e1', degree: 'Bachelor of Science', field: 'Electrical Engineering Technology', school: 'Old University', city: 'Muncie, IN', start: '2012-08', end: '2016-05', details: '' }],
  };
}

function fakeLib(master: MasterResume | null) {
  const saved: BuilderForm[] = [];
  const lib = {
    resumes: master ? [master] : [],
    message: null,
    saveForm: vi.fn(async (form: BuilderForm, name: string, existing?: MasterResume) => {
      saved.push(form);
      return buildMasterFromForm(form, undefined, name, existing);
    }),
  } as unknown as LibraryController;
  return { lib, saved };
}

describe('education in the candidate setup', () => {
  it('keeps details and multi-word fields when read back for editing', () => {
    const form = setupForm();
    form.education[0] = { ...form.education[0]!, degree: 'Master of Science', field: 'Engineering in Robotics', details: 'GPA 3.8\nDean’s List' };
    const parsed = builderToParsed(form);
    expect(parsed.education[0]).toMatchObject({ degree: 'Master of Science in Engineering in Robotics', institution: 'Old University', date: '08/2012 – 05/2016', details: ['GPA 3.8', 'Dean’s List'], location: 'Muncie, IN' });
    const back = builderFromParsed(parsed).education[0]!;
    expect(back).toMatchObject({ degree: 'Master of Science', field: 'Engineering in Robotics', school: 'Old University', start: '2012-08', end: '2016-05', details: 'GPA 3.8\nDean’s List' });
  });

  it('asks for the university name when only a degree is entered', () => {
    const form = setupForm();
    form.education[0] = { ...form.education[0]!, school: '' };
    expect(builderProblems(form)).toContain('Bachelor of Science: add the university or school name.');
  });

  it('places the saved education on the generated resume, untouched by Claude', () => {
    const master = buildMasterFromForm(setupForm(), undefined, 'Candidate setup');
    const reply = {
      company_name: 'SAIC', role_title: 'Engineering Technician III', subtitle: 'Engineering Technician', summary: 's', cover_letter: 'c',
      skill_groups: [{ category: 'Tools', items: ['Altium Designer'] }], additional_categories: [],
      experience: [{ company: 'Raytheon', role_title: 'Engineering Technician', location: '', dates: '', role_description: 'd', bullets: ['b'] }],
    };
    const t = assembleCv(reply as never, master, undefined, { resume: null }, 'claude-test');
    expect(t.education).toEqual(master.parsed.education);
    expect(t.education[0]!.institution).toBe('Old University');
  });
});

describe('Profile & answers → Education section', () => {
  it('shows the saved university and saves an edited one, keeping the employers', async () => {
    const master = buildMasterFromForm(setupForm(), undefined, 'Candidate setup');
    const { lib, saved } = fakeLib(master);
    render(<EducationSettings lib={lib} />);
    const school = screen.getByLabelText('University / school') as HTMLInputElement;
    expect(school.value).toBe('Old University');
    expect(screen.getByRole('button', { name: 'Save education' })).toBeDisabled();
    await userEvent.clear(school);
    await userEvent.type(school, 'Purdue University');
    await userEvent.click(screen.getByRole('button', { name: 'Save education' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Education saved \(1 entry\)/));
    expect(saved).toHaveLength(1);
    expect(saved[0]!.education[0]).toMatchObject({ school: 'Purdue University', degree: 'Bachelor of Science', field: 'Electrical Engineering Technology' });
    expect(saved[0]!.jobs.map((j) => j.company)).toEqual(['Raytheon']);
  });

  it('adds a second school and lists what is missing instead of saving', async () => {
    const master = buildMasterFromForm(setupForm(), undefined, 'Candidate setup');
    const { lib, saved } = fakeLib(master);
    render(<EducationSettings lib={lib} />);
    await userEvent.click(screen.getByRole('button', { name: /Add education/ }));
    const degrees = screen.getAllByLabelText('Degree');
    await userEvent.type(degrees[1]!, 'Associate of Applied Science');
    await userEvent.click(screen.getByRole('button', { name: 'Save education' }));
    expect(await screen.findByText('Associate of Applied Science: add the university or school name.')).toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });

  it('asks for the employer setup first when there is none yet', () => {
    const { lib } = fakeLib(null);
    render(<EducationSettings lib={lib} />);
    expect(screen.getByText(/Save your employers in/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save education' })).toBeNull();
  });
});
