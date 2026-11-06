import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../electron/db';
import { SyncService } from '../../electron/sync/service';
import { DataManagement } from '@/components/DataManagement';
import { recordFromSession } from '@/services/history/history';
import type { JobSession } from '@/types';

const dirs: string[] = [];
const open: { store: Store }[] = [];
afterEach(() => {
  cleanup();
  delete (window as unknown as { applyflow?: unknown }).applyflow;
  for (const r of open.splice(0)) r.store.close();
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
    }
  }
});

function computer(name: string) {
  const root = mkdtempSync(join(tmpdir(), `af-dm-${name}-`));
  dirs.push(root);
  mkdirSync(join(root, 'Documents'));
  const ref = { store: new Store(join(root, 'db.sqlite')) };
  open.push(ref);
  const sync = new SyncService({
    store: () => ref.store,
    replaceStore: (s) => {
      ref.store = s;
    },
    userDataDir: root,
    baseDir: () => join(root, 'Documents'),
    appVersion: 'test',
    deviceName: name,
    platform: 'test',
    progress: () => undefined,
  });
  return { root, ref, sync };
}

function addJob(store: Store, n: number) {
  const now = new Date().toISOString();
  const s = store.saveSession({
    jobKey: `dice:${n}`,
    job: {
      jobKey: `dice:${n}`, platform: 'dice', jobId: String(n), url: `https://www.dice.com/job-detail/${n}`, applicationUrl: null, title: `Role ${n}`, company: `Company ${n}`, location: 'Remote', remoteStatus: 'remote',
      salary: null, employmentType: null, contractDuration: null, datePosted: null, description: 'x', requiredSkills: [], preferredSkills: [], responsibilities: [], qualifications: [], benefits: [],
      educationRequirements: [], clearanceRequirements: [], workAuthorizationRequirements: [], sponsorshipLanguage: [], externalApply: false,
    },
    extraction: { confidence: {}, sources: ['structured-data'], uncertain: false, warnings: [] },
    jobConfirmed: true, resumeId: null, analysis: null, evidence: [], masterScore: null, tailoredScore: null, resume: null, coverLetter: null,
    resumeReviewed: false, coverLetterReviewed: false, includeCoverLetter: true, fieldProposals: [], lastScanUrl: null, duplicateAcknowledged: false,
    applicationId: null, submittedAt: null, createdAt: now, updatedAt: now,
  } as JobSession);
  store.saveApplication(recordFromSession(s, 'Applied'));
}

/** The renderer bridge, backed by the real sync engine instead of Electron IPC and dialogs. */
function mountBridge(c: ReturnType<typeof computer>, pick: { importPath: string | null }) {
  const handlers: Record<string, (...a: never[]) => unknown> = {
    'sync.export': async (o: { password?: string | null }) => c.sync.exportTo(join(c.root, 'out.applyflow'), o.password ?? null),
    'sync.pickImport': () => pick.importPath,
    'sync.inspect': (r: { path: string; password?: string | null }) => c.sync.inspect(r.path, r.password ?? null),
    'sync.apply': (r: { token: string; applySettings: boolean }) => c.sync.apply(r.token, { applySettings: r.applySettings }),
    'sync.discard': (t: string) => c.sync.discard(t),
    'sync.history': () => c.sync.history(),
    'sync.backups': () => c.sync.listBackups(),
    'sync.backupNow': () => c.sync.backupNow(),
    'kv.get': () => undefined,
    'kv.set': () => undefined,
  };
  (window as unknown as { applyflow: unknown }).applyflow = {
    invoke: async (m: string, ...a: unknown[]) => (handlers[m] as (...x: unknown[]) => unknown)?.(...a),
    on: () => () => undefined,
  };
}

describe('Data management in Settings', () => {
  it('exports with a password, then previews and merges a password-protected file from another computer', async () => {
    const user = userEvent.setup();
    const other = computer('Laptop');
    addJob(other.ref.store, 1);
    addJob(other.ref.store, 2);
    const file = join(other.root, 'laptop.applyflow');
    await other.sync.exportTo(file, 'laptop-secret');

    const here = computer('Desktop');
    addJob(here.ref.store, 2);
    addJob(here.ref.store, 3);
    const pick = { importPath: file as string | null };
    mountBridge(here, pick);
    render(<DataManagement />);

    await user.click(screen.getByLabelText(/Protect the file with a password/));
    await user.type(screen.getByLabelText('Password'), 'short');
    expect(screen.getByRole('button', { name: /Export all data/ })).toBeDisabled();
    await user.type(screen.getByLabelText('Password'), '-but-long-now');
    await user.type(screen.getByLabelText('Repeat password'), 'short-but-long-now');
    await user.click(screen.getByRole('button', { name: /Export all data/ }));
    expect(await screen.findByText('Export saved')).toBeInTheDocument();
    expect(screen.getByText(/2 applications · 0 files · password protected/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Import and merge/ }));
    await user.type(await screen.findByLabelText(/Password for laptop.applyflow/), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByText(/That password does not open this file/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/Password for/));
    await user.type(screen.getByLabelText(/Password for/), 'laptop-secret');
    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(await screen.findByText(/Preview: laptop.applyflow/)).toBeInTheDocument();
    const row = screen.getByRole('rowheader', { name: 'Applications' }).closest('tr')!;
    expect(row.textContent).toMatch(/Applications1·1/);
    expect(here.ref.store.listApplications()).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: /Merge into this computer/ }));
    expect(await screen.findByText('Import finished')).toBeInTheDocument();
    expect(here.ref.store.listApplications().map((a) => a.jobKey).sort()).toEqual(['dice:1', 'dice:2', 'dice:3']);

    await user.click(screen.getByText(/Import and export history/));
    await waitFor(() => expect(screen.getByText(/Import/, { selector: 'span.strong' })).toBeInTheDocument());
    expect(screen.getByText(/from Laptop/)).toBeInTheDocument();
  });

  it('explains a file that is not ApplyFlow data', async () => {
    const user = userEvent.setup();
    const here = computer('Desktop');
    const bogus = join(here.root, 'notes.applyflow');
    (await import('node:fs')).writeFileSync(bogus, 'hello');
    mountBridge(here, { importPath: bogus });
    render(<DataManagement />);
    await user.click(screen.getByRole('button', { name: /Import and merge/ }));
    expect(await screen.findByText('This is not an ApplyFlow data file.')).toBeInTheDocument();
  });
});
