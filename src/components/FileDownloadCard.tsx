import type { SavedFile } from '@/types';
import { Icon } from './Icon';

export function FileDownloadCard({
  folder,
  planned,
  saved,
  busy,
  onDownload,
  onOpenFolder,
}: {
  folder: string;
  planned: string[];
  saved: SavedFile[];
  busy: boolean;
  onDownload: () => void;
  onOpenFolder?: () => void;
}) {
  const files = saved.length ? saved.map((s) => ({ name: s.relativePath.split('/').pop() ?? s.relativePath, state: s.state, error: s.error })) : planned.map((name) => ({ name, state: null as SavedFile['state'] | null, error: undefined as string | undefined }));
  return (
    <section className="card" aria-labelledby="files-title">
      <div className="row-between">
        <h2 className="section-title" id="files-title">
          Application files
        </h2>
        <span className="row" style={{ gap: 4 }}>
          {onOpenFolder && saved.some((s) => s.state === 'complete') ? (
            <button type="button" className="btn btn-sm" onClick={onOpenFolder}>
              <Icon name="folder" size={14} /> Open folder
            </button>
          ) : null}
          <button type="button" className="btn btn-sm" onClick={onDownload} disabled={busy}>
            <Icon name="download" size={14} /> {saved.length ? 'Download again' : 'Download now'}
          </button>
        </span>
      </div>
      <p className="small muted wrap-anywhere" style={{ margin: '4px 0 8px' }}>
        Saved to {folder}/
      </p>
      <ul className="list-plain stack-sm">
        {files.map((f) => (
          <li key={f.name} className="row-between small">
            <span className="row" style={{ gap: 6 }}>
              <Icon name="doc" size={14} /> {f.name}
            </span>
            {f.state ? (
              <span className={`chip ${f.state === 'complete' ? 'chip-green' : f.state === 'failed' ? 'chip-red' : 'chip-amber'}`}>{f.state === 'complete' ? 'Saved' : f.state === 'failed' ? 'Failed' : 'In progress'}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {saved.filter((s) => s.error).map((s) => (
        <p key={s.relativePath} className="small" style={{ color: 'var(--red)' }}>
          {s.relativePath.split('/').pop()}: {s.error}
        </p>
      ))}
    </section>
  );
}
