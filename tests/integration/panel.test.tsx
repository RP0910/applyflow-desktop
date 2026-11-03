import { ClaudeProvider } from '@/services/claude/provider';
import { cvFixture } from '../cvFixture';
/**
 * Integration: the real side panel, wired to the real content-script controller running
 * against a mock Dice job page and the mock Dice application wizard. Covers the one-click
 * flow, questions, the final confirmation, downloads and history record creation.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PanelApp } from '@/sidepanel/PanelApp';
import { createContentController } from '@/content/controller';
import type { Messenger } from '@/services/messaging';
import type { DownloadsApi } from '@/services/downloads/downloader';
import type { PanelToContent } from '@/types/messages';
import { saveResume, saveProfile, getProfile, listApplications, EMPTY_PROFILE } from '@/storage/repositories';
import { saveSettings, setApiKey } from '@/storage/settingsStore';
import { exampleResume, fixture, JOB_URL, APPLY_URL } from '../helpers';
import { installFileChooserInterceptor } from '@/content/fileChooserInterceptor';
import { mountDiceWizard, testUploadDeps } from '../wizardHelpers';

// What the page-world script does on dice.com.
installFileChooserInterceptor(HTMLInputElement.prototype);

/** A simulated Dice tab: a job page whose Apply button "navigates" to the mock Dice wizard. */
function makeDiceTab() {
  const doc = document.implementation.createHTMLDocument('dice');
  let url = JOB_URL;
  doc.documentElement.innerHTML = fixture('job-detail-jsonld.html').replace(/^<!doctype html>/i, '');
  let wizard: ReturnType<typeof mountDiceWizard> | null = null;
  const ctl = createContentController({ doc, url: () => url, version: 'test', successTimeoutMs: 30, stepTimeoutMs: 300, uploadDeps: testUploadDeps, sleep: () => Promise.resolve() });
  const calls: PanelToContent[] = [];
  const messenger: Messenger = {
    async send(_tabId, msg) {
      const m = msg as PanelToContent;
      calls.push(m);
      if (m.type === 'AF_OPEN_APPLICATION') {
        wizard = mountDiceWizard(doc, { title: 'Senior Architect AI Engineering and Platforms', company: 'Meridian Credit Analytics LLC' });
        url = APPLY_URL;
        return { ok: true, external: false, message: 'Opened' } as never;
      }
      return ctl.handle(m as never) as never;
    },
  };
  return { doc, messenger, calls, wizard: () => wizard!.state };
}

function fakeDownloads(): DownloadsApi & { download: ReturnType<typeof vi.fn> } {
  let id = 0;
  return { download: vi.fn(async () => ++id), search: async (q) => [{ id: q.id, state: 'complete', exists: true } as unknown as chrome.downloads.DownloadItem], show: vi.fn() };
}

async function seed() {
  await saveSettings({ engine: 'claude' });
  await setApiKey('test-key');
  const master = exampleResume();
  vi.spyOn(ClaudeProvider.prototype, 'researchCompanies').mockResolvedValue({
    data: {
      companies: master.parsed.experience.map((e, i) => ({
        periodIndex: i,
        name: e.company,
        activeYears: `${e.startDate}-${e.endDate || 'present'}`,
        techFit: 'relevant tech',
        hq: e.location || '',
      })),
    },
    model: 'test',
  });
  vi.spyOn(ClaudeProvider.prototype, 'generateCv').mockResolvedValue({ data: cvFixture(), model: 'test' });
  await saveResume(master);
  await saveProfile({ ...EMPTY_PROFILE, fullName: 'Jordan Rivera', email: 'jordan.rivera@example.com', phone: '(312) 555-0148', location: 'Chicago, IL' });
}

describe('side panel rendering', () => {
  it('welcomes a new user with one thing to do: add a resume', async () => {
    const messenger: Messenger = { send: async () => ({ url: 'https://www.dice.com/', pageType: 'other', jobKey: null, title: '', hasApplicationForm: false, captchaDetected: false, loginRequired: false }) as never };
    render(<PanelApp deps={{ messenger, pinnedTabId: 1 }} />);
    expect(await screen.findByText('Welcome to ApplyFlow')).toBeInTheDocument();
    expect(screen.getByText('Set up your candidate details')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open candidate setup/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upload a file/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tailor & Apply' })).toBeDisabled();
    expect(screen.getByText('for Dice & Jobright')).toBeInTheDocument();
  });

  it('has three sections and a single main button', async () => {
    await seed();
    const messenger: Messenger = { send: async () => ({ url: 'https://www.dice.com/', pageType: 'other', jobKey: null, title: '', hasApplicationForm: false, captchaDetected: false, loginRequired: false }) as never };
    const user = userEvent.setup();
    render(<PanelApp deps={{ messenger, pinnedTabId: 1 }} />);
    expect(await screen.findByText('Open a job on Dice or Jobright to get started.')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'ApplyFlow sections' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Apply', 'Documents', 'Settings']);
    await user.click(within(nav).getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('checkbox', { name: /Move through Dice’s steps automatically/ })).toBeChecked();
    expect(screen.getByText('More settings')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Minimize ApplyFlow' }));
    expect(screen.getByRole('button', { name: 'Expand ApplyFlow' })).toBeInTheDocument();
  });
});

describe('Tailor & Apply on a mock Dice job', () => {
  it('scores automatically, then one click tailors, attaches, fills and stops for the user’s answers and final submit', async () => {
    await seed();
    const tab = makeDiceTab();
    const downloads = fakeDownloads();
    const user = userEvent.setup();
    render(<PanelApp deps={{ messenger: tab.messenger, downloads, pinnedTabId: 7, pollMs: 5 }} />);

    // Job detected and scored with no click.
    expect(await screen.findByRole('heading', { name: 'Senior Architect AI Engineering and Platforms', level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Estimated match \d+ out of 100/ })).toBeInTheDocument();
    expect(tab.calls.some((c) => c.type === 'AF_OPEN_APPLICATION')).toBe(false);

    // Click 1: everything up to the questions only the user can answer.
    await user.click(screen.getByRole('button', { name: 'Tailor & Apply' }));
    expect(await screen.findByRole('heading', { name: '3 questions for you' }, { timeout: 15000 })).toBeInTheDocument();
    const wiz = tab.wizard();
    expect(wiz.resume).toMatch(/^Jordan-Rivera-.*-Resume-v1-\d+\.pdf$/); // profile resume replaced via the “…” menu
    expect(wiz.coverLetter).toMatch(/^Jordan-Rivera-.*-Cover-Letter-v1-\d+\.pdf$/);
    expect(wiz.nativePickerOpened).toBe(0);
    expect(wiz.step).toBe(2);
    expect(wiz.answers).toMatchObject({ q_auth: '', q_spon: '', q_years: '' }); // nothing guessed
    // The site's search bar was never touched.
    expect((tab.doc.querySelector('input[name=q]') as HTMLInputElement).value).toBe('');

    // One tap per answer; the last one continues automatically to Dice's review step.
    const card = (label: RegExp) => screen.getByText(label).closest('.q-card') as HTMLElement;
    await user.click(within(card(/legally authorized/)).getByRole('button', { name: 'Yes' }));
    await user.click(within(card(/visa sponsorship/)).getByRole('button', { name: 'No' }));
    await user.type(within(card(/years of experience/)).getByRole('textbox'), '8');
    await user.click(within(card(/years of experience/)).getByRole('button', { name: 'Use' }));
    expect(await screen.findByRole('heading', { name: 'Ready to submit to Meridian Credit Analytics LLC' }, { timeout: 15000 })).toBeInTheDocument();
    expect(wiz.step).toBe(3);
    expect(wiz.answers).toMatchObject({ q_auth: 'yes', q_spon: 'no', q_years: '8' });
    const summary = screen.getByRole('heading', { name: /Ready to submit to/ }).closest('section')!;
    // Dice-style review cards: both documents tailored and attached.
    expect(within(summary).getAllByText('Tailored for this job')).toHaveLength(2);
    expect(within(summary).getByText(wiz.resume)).toBeInTheDocument();
    expect(within(summary).getByText(/1 optional question left blank/)).toBeInTheDocument();
    expect(within(summary).getByText('3 answers filled in')).toBeInTheDocument();
    expect(within(summary).getByText(/require visa sponsorship\?:/).parentElement).toHaveTextContent(/: No$/);
    expect(tab.calls.some((c) => c.type === 'AF_SUBMIT')).toBe(false);
    expect(wiz.submitClicks).toBe(0);

    // The tailored documents were saved to Downloads as soon as they were written — before submitting.
    const early = downloads.download.mock.calls.map((c) => (c[0] as { filename: string }).filename.split('/').pop());
    expect(early).toEqual(expect.arrayContaining(['resume_tailored.pdf', 'resume_tailored.docx', 'cover_letter.pdf', 'job_description.txt']));
    expect(early).not.toContain('application_metadata.json');
    const savedBeforeSubmit = early.length;

    // Answers were remembered for next time.
    expect((await getProfile()).approvedAnswers.map((a) => [a.category, a.answer])).toEqual([
      ['work_authorization', 'Yes'],
      ['sponsorship', 'No'],
      ['years_experience', '8'],
    ]);

    // Final click: the user's explicit confirmation. One token, one click on Dice's Submit.
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByRole('heading', { name: 'Applied to Meridian Credit Analytics LLC' })).toBeInTheDocument();
    const arm = tab.calls.filter((c) => c.type === 'AF_ARM_SUBMIT') as Extract<PanelToContent, { type: 'AF_ARM_SUBMIT' }>[];
    const sub = tab.calls.filter((c) => c.type === 'AF_SUBMIT') as Extract<PanelToContent, { type: 'AF_SUBMIT' }>[];
    expect(arm).toHaveLength(1);
    expect(sub).toHaveLength(1);
    expect(sub[0]!.token).toBe(arm[0]!.token);
    expect(wiz.submitClicks).toBe(1);

    // Files saved into the documented folder structure; submitting adds only what was missing (no duplicates).
    await waitFor(() => expect(downloads.download.mock.calls.length).toBe(savedBeforeSubmit + 2));
    const names = downloads.download.mock.calls.map((c) => (c[0] as { filename: string }).filename);
    expect(names.slice(savedBeforeSubmit).map((n) => n.split('/').pop())).toEqual(['application_metadata.json', 'job_url.txt']);
    expect(names.every((n) => n.startsWith('ApplyFlow/Meridian-Credit-Analytics-LLC/'))).toBe(true);
    expect(names.map((n) => n.split('/').pop())).toEqual(expect.arrayContaining(['resume_tailored.pdf', 'resume_tailored.docx', 'cover_letter.pdf', 'job_description.txt', 'application_metadata.json', 'job_url.txt']));

    // History record created with stage, scores, files and follow-up.
    await waitFor(async () => expect((await listApplications())[0]?.files.length).toBeGreaterThan(0));
    const [rec] = await listApplications();
    expect(rec).toMatchObject({ stage: 'Applied', company: 'Meridian Credit Analytics LLC', resumeVersion: 1, coverLetterVersion: 1 });
    expect(rec!.matchScore).toBeGreaterThan(0);
    expect(rec!.followUpDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rec!.files.every((f) => f.state === 'complete')).toBe(true);
    expect(rec!.stageHistory.map((s) => s.stage)).toEqual(['Resume Ready', 'Ready to Apply', 'Applied']);
  }, 40000);

  it('with saved answers, applying takes two clicks: Tailor & Apply, then Submit', async () => {
    await seed();
    await saveProfile({
      ...(await getProfile()),
      approvedAnswers: [
        { id: '1', category: 'work_authorization', questionPattern: 'Are you legally authorized to work in the United States?', answer: 'Yes', approvedAt: '' },
        { id: '2', category: 'sponsorship', questionPattern: 'Will you now or in the future require visa sponsorship?', answer: 'No', approvedAt: '' },
        { id: '3', category: 'years_experience', questionPattern: 'How many years of experience do you have with Java?', answer: '8', approvedAt: '' },
      ],
    });
    const tab = makeDiceTab();
    const user = userEvent.setup();
    render(<PanelApp deps={{ messenger: tab.messenger, downloads: fakeDownloads(), pinnedTabId: 7, pollMs: 5 }} />);
    await screen.findByRole('button', { name: /Estimated match/ });
    await user.click(screen.getByRole('button', { name: 'Tailor & Apply' }));
    expect(await screen.findByRole('heading', { name: /Ready to submit to/ }, { timeout: 15000 })).toBeInTheDocument();
    const review = screen.getByRole('heading', { name: /Ready to submit to/ }).closest('section')!;
    expect(within(review).getByText(/Are you legally authorized to work in the United States\?:/)).toBeInTheDocument();
    expect(screen.queryByText(/questions for you/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByRole('heading', { name: 'Applied to Meridian Credit Analytics LLC' })).toBeInTheDocument();
    expect(tab.wizard().submitClicks).toBe(1);
  }, 40000);

  it('warns about a duplicate application and asks before applying again', async () => {
    await seed();
    const tab = makeDiceTab();
    const { saveApplication } = await import('@/storage/repositories');
    const { recordFromSession } = await import('@/services/history/history');
    const { emptySession, mockJob } = await import('../helpers');
    await saveApplication(recordFromSession(emptySession(mockJob()), 'Interview'));
    render(<PanelApp deps={{ messenger: tab.messenger, downloads: fakeDownloads(), pinnedTabId: 7 }} />);
    expect(await screen.findByText('You already applied to this job')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply again' })).toBeEnabled();
  });
});
