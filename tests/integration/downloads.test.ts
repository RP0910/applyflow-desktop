import { describe, expect, it, vi } from 'vitest';
import { downloadFiles, showInFolder, type DownloadsApi } from '@/services/downloads/downloader';
import type { PlannedFile } from '@/services/downloads/planner';

const file = (name: string): PlannedFile => ({ kind: 'resume', format: 'pdf', relativePath: `ApplyFlow/Acme/2026-10-30_Job/${name}`, mime: 'application/pdf', data: new Blob(['x']) });

function api(state: 'complete' | 'interrupted' = 'complete'): DownloadsApi & { download: ReturnType<typeof vi.fn>; show: ReturnType<typeof vi.fn> } {
  let id = 0;
  return {
    download: vi.fn(async () => ++id),
    search: vi.fn(async (q: { id?: number }) => [{ id: q.id, state, exists: true, error: state === 'interrupted' ? 'FILE_NO_SPACE' : undefined } as unknown as chrome.downloads.DownloadItem]),
    show: vi.fn(),
  };
}

describe('download workflow', () => {
  it('saves each file to its folder path without prompting', async () => {
    const a = api();
    const saved = await downloadFiles([file('resume_tailored.pdf'), file('job_url.txt')], a);
    expect(saved.map((s) => [s.relativePath.split('/').pop(), s.state, s.downloadId])).toEqual([
      ['resume_tailored.pdf', 'complete', 1],
      ['job_url.txt', 'complete', 2],
    ]);
    expect(a.download.mock.calls[0]![0]).toMatchObject({ filename: 'ApplyFlow/Acme/2026-10-30_Job/resume_tailored.pdf', conflictAction: 'uniquify', saveAs: false });
  });

  it('reports interrupted and failed downloads instead of hiding them', async () => {
    const interrupted = await downloadFiles([file('a.pdf')], api('interrupted'));
    expect(interrupted[0]).toMatchObject({ state: 'failed', error: 'Download interrupted (FILE_NO_SPACE).' });
    const broken = api();
    broken.download.mockRejectedValueOnce(new Error('Invalid filename'));
    expect((await downloadFiles([file('b.pdf')], broken))[0]).toMatchObject({ state: 'failed', error: 'Invalid filename' });
    expect((await downloadFiles([file('c.pdf')], null))[0]!.state).toBe('failed');
  });

  it('opens the saved folder, or explains where the files went', async () => {
    const a = api();
    const saved = await downloadFiles([file('resume_tailored.pdf')], a);
    expect((await showInFolder(saved, a)).ok).toBe(true);
    expect(a.show).toHaveBeenCalledWith(1);
    const gone: DownloadsApi = { ...a, search: async () => [] };
    const r = await showInFolder(saved, gone);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Downloads\/ApplyFlow\/Acme\/2026-10-30_Job/);
  });
});
