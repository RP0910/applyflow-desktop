import type { SavedFile } from '@/types';
import type { PlannedFile } from './planner';
import { bridge } from '@/platform/bridge';

async function saveToDisk(files: PlannedFile[], conflictAction: 'uniquify' | 'overwrite'): Promise<SavedFile[]> {
  const b = bridge()!;
  const out: SavedFile[] = [];
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.data.arrayBuffer());
      const r = await b.invoke('files.write', { relativePath: f.relativePath, bytes, conflict: conflictAction });
      out.push({ kind: f.kind, format: f.format, relativePath: f.relativePath, absolutePath: r.absolutePath, downloadId: null, state: 'complete' });
    } catch (e: unknown) {
      out.push({ kind: f.kind, format: f.format, relativePath: f.relativePath, downloadId: null, state: 'failed', error: e instanceof Error ? e.message : 'Could not save the file.' });
    }
  }
  return out;
}

export interface DownloadsApi {
  download(opts: chrome.downloads.DownloadOptions): Promise<number>;
  search(q: chrome.downloads.DownloadQuery): Promise<chrome.downloads.DownloadItem[]>;
  show(id: number): void;
}

function chromeDownloads(): DownloadsApi | null {
  if (typeof chrome === 'undefined' || !chrome.downloads) return null;
  return {
    download: (o) => chrome.downloads.download(o),
    search: (q) => chrome.downloads.search(q),
    show: (id) => chrome.downloads.show(id),
  };
}

async function waitForComplete(api: DownloadsApi, id: number, timeoutMs: number): Promise<{ state: SavedFile['state']; error?: string }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const [item] = await api.search({ id });
    if (item?.state === 'complete') return { state: 'complete' };
    if (item?.state === 'interrupted') return { state: 'failed', error: item.error ? `Download interrupted (${item.error}).` : 'Download interrupted.' };
    await new Promise((r) => setTimeout(r, 150));
  }
  return { state: 'pending' };
}

export async function downloadFiles(files: PlannedFile[], api: DownloadsApi | null | undefined = undefined, conflictAction: 'uniquify' | 'overwrite' = 'uniquify'): Promise<SavedFile[]> {
  if (api === undefined && bridge()) return saveToDisk(files, conflictAction);
  if (api === undefined) api = chromeDownloads();
  if (!api) {
    return files.map((f) => ({ kind: f.kind, format: f.format, relativePath: f.relativePath, downloadId: null, state: 'failed', error: 'Downloads are not available in this context.' }));
  }
  const results: SavedFile[] = [];
  for (const f of files) {
    const url = URL.createObjectURL(f.data);
    try {
      const id = await api.download({ url, filename: f.relativePath, conflictAction, saveAs: false });
      const done = await waitForComplete(api, id, 15000);
      results.push({ kind: f.kind, format: f.format, relativePath: f.relativePath, downloadId: id, state: done.state, error: done.error });
    } catch (e: unknown) {
      results.push({ kind: f.kind, format: f.format, relativePath: f.relativePath, downloadId: null, state: 'failed', error: e instanceof Error ? e.message : 'Download failed.' });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  }
  return results;
}

export async function showInFolder(files: SavedFile[], api: DownloadsApi | null | undefined = undefined): Promise<{ ok: boolean; message: string }> {
  const b = bridge();
  if (api === undefined && b) {
    for (const f of files) if (f.absolutePath && (await b.invoke('files.show', f.absolutePath))) return { ok: true, message: 'Opened the folder.' };
    const path = files[0]?.relativePath.split('/').slice(0, -1).join('/') ?? '';
    return { ok: false, message: path ? `The files were moved or deleted. They were saved to ${path}.` : 'No saved files for this application yet.' };
  }
  if (api === undefined) api = chromeDownloads();
  if (!api) return { ok: false, message: 'Downloads are not available in this context.' };
  for (const f of files) {
    if (f.downloadId === null) continue;
    const [item] = await api.search({ id: f.downloadId });
    if (item && item.exists !== false && item.state === 'complete') {
      api.show(f.downloadId);
      return { ok: true, message: 'Opened the folder.' };
    }
  }
  const path = files[0]?.relativePath.split('/').slice(0, -1).join('/') ?? '';
  return { ok: false, message: path ? `The files were moved or deleted. They were saved to Downloads/${path}.` : 'No saved files for this application yet.' };
}
