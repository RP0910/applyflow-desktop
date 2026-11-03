import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AtsReport } from '@/types';
import { AtsReportCard } from '@/components/AtsReportCard';

const report = (over: Partial<AtsReport> = {}): AtsReport => ({
  score: 88,
  reachable: 93,
  band: 'excellent',
  categories: [
    { key: 'keywords', label: 'Job keywords', score: 38, max: 45, applicable: true, detail: '' },
    { key: 'format', label: 'File format', score: 0, max: 5, applicable: false, detail: '' },
  ],
  keywords: [
    { term: 'HLS', kind: 'hard', importance: 'required', weight: 4, support: 'supported', found: 'exact', count: 3, inExperience: true, inSkills: true, inSummary: true },
    { term: 'Kubernetes', kind: 'hard', importance: 'required', weight: 3, support: 'supported', found: 'missing', count: 0, inExperience: false, inSkills: false, inSummary: false },
    { term: 'Microservices', kind: 'hard', importance: 'required', weight: 3.5, support: 'related', found: 'missing', count: 0, inExperience: false, inSkills: false, inSummary: false },
    { term: 'LLMs', kind: 'hard', importance: 'preferred', weight: 2, support: 'missing', found: 'missing', count: 0, inExperience: false, inSkills: false, inSummary: false },
  ],
  checks: [
    { id: 'all_jobs', status: 'pass', label: 'All 4 jobs included' },
    { id: 'metrics', status: 'warn', label: '2 of 20 bullets show a number or result', detail: 'Add real numbers.' },
  ],
  computedFor: 'tailored',
  disclaimer: 'Simulation.',
  computedAt: '2026-10-30T00:00:00Z',
  ...over,
});

describe('ATS report card', () => {
  it('shows the score, the improvement and what needs a look', () => {
    render(<AtsReportCard report={report()} before={report({ score: 71, computedFor: 'master' })} />);
    expect(screen.getByRole('heading', { name: /ATS check: tailored resume/ })).toBeInTheDocument();
    expect(screen.getByText(/Was 71 with your master resume/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 4 job keywords · up to 93 possible/)).toBeInTheDocument();
    expect(screen.getByText('2 of 20 bullets show a number or result')).toBeInTheDocument();
  });

  it('adds skills only after the user taps the ones they have', async () => {
    const onConfirm = vi.fn();
    render(<AtsReportCard report={report()} onConfirmSkills={onConfirm} />);
    // Skills the resume can't back are offered, never added silently.
    const micro = screen.getByRole('button', { name: 'Microservices' });
    expect(screen.queryByRole('button', { name: /add to my skills/ })).not.toBeInTheDocument();
    await userEvent.click(micro);
    expect(micro).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /I have it — add to my skills and rewrite/ }));
    expect(onConfirm).toHaveBeenCalledWith(['Microservices']);
    // A supported keyword is not offered as "not on your resume".
    expect(screen.queryByRole('button', { name: 'Kubernetes' })).not.toBeInTheDocument();
  });

  it('details list categories that apply and the keywords already on the resume', async () => {
    render(<AtsReportCard report={report()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show ATS details' }));
    expect(screen.getByText('Job keywords')).toBeInTheDocument();
    expect(screen.queryByText('File format')).not.toBeInTheDocument();
    expect(screen.getByText(/Backed by your experience but not used yet/)).toBeInTheDocument();
  });
});
