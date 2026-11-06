import { useCallback, useEffect, useState } from 'react';
import { bridge } from '@/platform/bridge';
import type {
  SyncBackupInfo,
  SyncEntity,
  SyncExportResult,
  SyncImportResult,
  SyncInspectResult,
  SyncLogEntry,
  SyncProgress,
  SyncReport,
} from '@/platform/syncTypes';
import { emitChange } from '@/storage/events';
import { saveSettings } from '@/storage/settingsStore';
import { Icon } from './Icon';
import { WarningBanner } from './WarningBanner';

const ENTITY_LABELS: [SyncEntity, string][] = [
  ['applications', 'Applications'],
  ['contacts', 'Recruiter contacts'],
  ['documents', 'Tailored resumes & cover letters'],
  ['sessions', 'Job details & descriptions'],
  ['companyResearch', 'Company research'],
  ['resumes', 'Master resumes'],
  ['profile', 'Profile & saved answers'],
  ['usage', 'Claude usage records'],
];

const COLUMNS: [keyof SyncReport['entities'][SyncEntity], string][] = [
  ['added', 'New'],
  ['updated', 'Updated'],
  ['merged', 'Duplicates merged'],
  ['unchanged', 'Already here'],
  ['skipped', 'Skipped'],
  ['deleted', 'Deleted'],
  ['conflicts', 'Conflicts'],
];

const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : '—');
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function ProgressBar({ p }: { p: SyncProgress | null }) {
  if (!p || p.step === 'Done') return null;
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : null;
  return (
    <div className="stack-sm" role="status" aria-live="polite">
      <div className={`dice-progress${pct === null ? ' sync-progress-indeterminate' : ''}`} aria-hidden="true">
        <span style={{ width: pct === null ? '35%' : `${Math.max(4, pct)}%` }} />
      </div>
      <span className="small muted">
        {p.step}
        {pct !== null ? ` — ${p.done} of ${p.total}` : '…'}
      </span>
    </div>
  );
}

function ReportTable({ report }: { report: SyncReport }) {
  const rows = ENTITY_LABELS.filter(([e]) => Object.values(report.entities[e]).some((n) => n > 0));
  const f = report.files;
  return (
    <div className="stack-sm">
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Data</th>
              {COLUMNS.map(([, label]) => (
                <th key={label} scope="col" style={{ textAlign: 'right' }}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map(([e, label]) => (
                <tr key={e}>
                  <th scope="row" style={{ position: 'static', background: 'transparent', fontWeight: 500 }}>
                    {label}
                  </th>
                  {COLUMNS.map(([k]) => (
                    <td key={k} style={{ textAlign: 'right' }} className={k === 'conflicts' && report.entities[e][k] ? 'strong' : undefined}>
                      {report.entities[e][k] || '·'}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="muted">
                  The file has no records.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="small">
        Documents: {f.added} new{f.renamed ? `, ${f.renamed} saved under a new name to avoid replacing a different file` : ''}, {f.reused} already on this computer
        {f.missing ? `, ${f.missing} not in the file` : ''}
        {f.skipped ? `, ${f.skipped} skipped` : ''}.
      </p>
      {report.warnings.length ? (
        <WarningBanner tone="warning" title="Warnings">
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {report.warnings.slice(0, 20).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </WarningBanner>
      ) : null}
      {report.conflicts.length ? (
        <details>
          <summary className="small strong" style={{ cursor: 'pointer' }}>
            {report.conflicts.length} conflicting change{report.conflicts.length === 1 ? '' : 's'} and how {report.conflicts.length === 1 ? 'it is' : 'they are'} resolved
          </summary>
          <div className="table-wrap" style={{ marginTop: 8, maxHeight: 320 }}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Record</th>
                  <th scope="col">Field</th>
                  <th scope="col">This computer</th>
                  <th scope="col">Other computer</th>
                  <th scope="col">Resolution</th>
                </tr>
              </thead>
              <tbody>
                {report.conflicts.slice(0, 200).map((c, i) => (
                  <tr key={i}>
                    <td>{c.label}</td>
                    <td>{c.field ?? '—'}</td>
                    <td className="wrap-anywhere">{c.local ?? '—'}</td>
                    <td className="wrap-anywhere">{c.incoming ?? '—'}</td>
                    <td>{c.resolution}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </div>
  );
}

type ImportState =
  | { phase: 'idle' }
  | { phase: 'password'; path: string; message?: string }
  | { phase: 'preview'; result: Extract<SyncInspectResult, { status: 'ready' }> }
  | { phase: 'done'; result: SyncImportResult };

export function DataManagement() {
  const b = bridge();
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [busy, setBusy] = useState<null | 'export' | 'inspect' | 'import' | 'backup' | 'restore'>(null);
  const [error, setError] = useState<string | null>(null);

  const [protect, setProtect] = useState(false);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [exported, setExported] = useState<SyncExportResult | null>(null);

  const [imp, setImp] = useState<ImportState>({ phase: 'idle' });
  const [importPw, setImportPw] = useState('');
  const [applySettings, setApplySettings] = useState(false);

  const [history, setHistory] = useState<SyncLogEntry[]>([]);
  const [backups, setBackups] = useState<SyncBackupInfo[]>([]);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!b) return;
    const [h, bk] = await Promise.all([b.invoke('sync.history'), b.invoke('sync.backups')]);
    setHistory(h);
    setBackups(bk);
  }, [b]);

  useEffect(() => {
    if (!b) return;
    void refresh();
    return b.on('sync:progress', setProgress);
  }, [b, refresh]);

  if (!b) return null;

  const run = async <T,>(kind: NonNullable<typeof busy>, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      return await fn();
    } catch (e) {
      setError(errText(e));
      return undefined;
    } finally {
      setBusy(null);
      setProgress(null);
      void refresh();
    }
  };

  const pwProblem = protect ? (pw1.length < 8 ? 'Use at least 8 characters.' : pw1 !== pw2 ? 'The passwords do not match.' : null) : null;

  const doExport = () =>
    run('export', async () => {
      setExported(null);
      const r = await b.invoke('sync.export', { password: protect ? pw1 : null });
      if (r) {
        setExported(r);
        setPw1('');
        setPw2('');
      }
    });

  const inspect = (path: string, password: string | null) =>
    run('inspect', async () => {
      const r = await b.invoke('sync.inspect', { path, password });
      if (r.status === 'ready') {
        setImp({ phase: 'preview', result: r });
        setApplySettings(false);
      } else if (r.status === 'password-required') setImp({ phase: 'password', path, message: r.message });
      else {
        setImp({ phase: 'idle' });
        setError(r.message);
      }
    });

  const chooseImport = async () => {
    setError(null);
    setExported(null);
    const path = await b.invoke('sync.pickImport');
    if (path) {
      setImportPw('');
      await inspect(path, null);
    }
  };

  const cancelImport = () => {
    if (imp.phase === 'preview') void b.invoke('sync.discard', imp.result.token);
    setImp({ phase: 'idle' });
  };

  const doImport = () => {
    if (imp.phase !== 'preview') return;
    const token = imp.result.token;
    void run('import', async () => {
      const r = await b.invoke('sync.apply', { token, applySettings });
      setImp({ phase: 'done', result: r });
      for (const t of ['applications', 'resumes', 'profile', 'sessions'] as const) emitChange(t);
      if (r.report.settingsApplied) await saveSettings({});
    });
  };

  const doRestore = (name: string) =>
    run('restore', async () => {
      await b.invoke('sync.restore', name);
      window.location.reload();
    });

  const working = busy !== null;
  const lastExport = history.find((h) => h.kind === 'export' && h.ok);

  return (
    <section className="card stack" aria-labelledby="dm-h">
      <h2 className="section-title" id="dm-h">
        <Icon name="database" /> Data management
      </h2>
      <p className="small muted">
        Move your applications, documents, recruiter contacts and analytics between computers with a single <span className="strong">.applyflow</span> file, without any cloud service. Importing merges with what is
        already here: duplicates are combined, newer changes win, deletions carry over, and nothing is replaced wholesale. To keep several computers in step, export from one, import on the next, and pass the
        newest file along.
      </p>
      {error ? (
        <WarningBanner tone="critical" live>
          {error}
        </WarningBanner>
      ) : null}
      {notice ? (
        <WarningBanner tone="success" live>
          {notice}
        </WarningBanner>
      ) : null}
      <ProgressBar p={progress} />

      <div className="stack-sm">
        <h3 className="field-label" style={{ margin: 0 }}>
          Export all data
        </h3>
        <span className="hint">
          Includes the application history, job descriptions, tailored resumes and cover letters (PDF, Word and JSON), master resumes, recruiter contacts, notes, saved answers, usage history and
          preferences. Your Claude API key, Claude.ai sign-in, job-site passwords and browser sessions are never exported.
        </span>
        <label className="check" htmlFor="dm-protect">
          <input id="dm-protect" type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} disabled={working} />
          <span>Protect the file with a password (AES-256 encryption)</span>
        </label>
        {protect ? (
          <div className="grid-2">
            <div className="field">
              <label htmlFor="dm-pw1">Password</label>
              <input id="dm-pw1" className="input" type="password" autoComplete="new-password" value={pw1} onChange={(e) => setPw1(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="dm-pw2">Repeat password</label>
              <input id="dm-pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </div>
            <span className="hint">{pwProblem ?? 'There is no way to open the file without this password.'}</span>
          </div>
        ) : null}
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => void doExport()} disabled={working || Boolean(pwProblem)}>
            {busy === 'export' ? <span className="spinner" aria-hidden="true" /> : <Icon name="download" size={14} />}
            Export all data…
          </button>
          {lastExport ? <span className="small muted">Last export: {when(lastExport.at)}</span> : null}
        </div>
        {exported ? (
          <WarningBanner
            tone="success"
            live
            title="Export saved"
            actions={
              <button type="button" className="btn btn-sm" onClick={() => void b.invoke('files.show', exported.path)}>
                <Icon name="folder" size={14} /> Show in folder
              </button>
            }
          >
            <span className="wrap-anywhere">{exported.path}</span> · {bytes(exported.bytes)} · {exported.counts.applications ?? 0} applications · {exported.files} files
            {exported.encrypted ? ' · password protected' : ''}
            {exported.missingFiles ? ` · ${exported.missingFiles} document${exported.missingFiles === 1 ? ' was' : 's were'} missing on disk and left out` : ''}
          </WarningBanner>
        ) : null}
      </div>

      <div className="stack-sm">
        <h3 className="field-label" style={{ margin: 0 }}>
          Import and merge data
        </h3>
        <span className="hint">You see exactly what will change before anything is written. A backup of this computer’s data is made first.</span>
        {imp.phase === 'idle' || imp.phase === 'done' ? (
          <div className="row">
            <button type="button" className="btn" onClick={() => void chooseImport()} disabled={working}>
              {busy === 'inspect' ? <span className="spinner" aria-hidden="true" /> : <Icon name="upload" size={14} />}
              Import and merge…
            </button>
          </div>
        ) : null}

        {imp.phase === 'password' ? (
          <form
            className="stack-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void inspect(imp.path, importPw);
            }}
          >
            {imp.message ? <WarningBanner tone="warning" live>{imp.message}</WarningBanner> : null}
            <div className="field" style={{ maxWidth: 360 }}>
              <label htmlFor="dm-ipw">Password for {imp.path.split(/[\\/]/).pop()}</label>
              <input id="dm-ipw" className="input" type="password" autoComplete="off" value={importPw} onChange={(e) => setImportPw(e.target.value)} autoFocus />
            </div>
            <div className="row">
              <button type="submit" className="btn btn-primary" disabled={!importPw || working}>
                {busy === 'inspect' ? <span className="spinner" aria-hidden="true" /> : null}
                Open
              </button>
              <button type="button" className="btn btn-quiet" onClick={cancelImport} disabled={working}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {imp.phase === 'preview' ? (
          <div className="stack-sm card card-quiet">
            <div className="strong">Preview: {imp.result.path.split(/[\\/]/).pop()}</div>
            <span className="small">
              Exported {when(imp.result.source.exportedAt)} from <span className="strong">{imp.result.source.deviceName}</span> by ApplyFlow {imp.result.source.appVersion}
              {imp.result.source.encrypted ? ' · password protected' : ''}. Nothing has been changed yet.
            </span>
            {imp.result.source.sameDevice ? (
              <WarningBanner tone="info">This file was exported from this computer. Importing it only adds things that are missing here; records deleted since then stay deleted.</WarningBanner>
            ) : null}
            <ReportTable report={imp.result.report} />
            {imp.result.hasSettings ? (
              <label className="check" htmlFor="dm-settings">
                <input id="dm-settings" type="checkbox" checked={applySettings} onChange={(e) => setApplySettings(e.target.checked)} disabled={working} />
                <span>
                  Also use the other computer’s preferences
                  <span className="hint" style={{ display: 'block' }}>
                    Resume formats, layout, folder naming and similar. This computer keeps its own save location and Claude model list.
                  </span>
                </span>
              </label>
            ) : null}
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={doImport} disabled={working}>
                {busy === 'import' ? <span className="spinner" aria-hidden="true" /> : <Icon name="check" size={14} />}
                Merge into this computer
              </button>
              <button type="button" className="btn btn-quiet" onClick={cancelImport} disabled={working}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {imp.phase === 'done' ? (
          <div className="stack-sm">
            <WarningBanner
              tone="success"
              live
              title="Import finished"
              actions={
                imp.result.logPath ? (
                  <button type="button" className="btn btn-sm" onClick={() => void b.invoke('files.open', imp.result.logPath!)}>
                    <Icon name="doc" size={14} /> Open the import log
                  </button>
                ) : null
              }
            >
              Analytics and search now include the merged records. A backup from just before the import was saved as {imp.result.backup.name}.
            </WarningBanner>
            <ReportTable report={imp.result.report} />
          </div>
        ) : null}
      </div>

      <details>
        <summary className="field-label" style={{ cursor: 'pointer' }}>
          Import and export history ({history.length})
        </summary>
        {history.length ? (
          <div className="table-wrap" style={{ marginTop: 8, maxHeight: 320 }}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What</th>
                  <th scope="col">Result</th>
                  <th scope="col">Log</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{when(h.at)}</td>
                    <td>
                      <span className="strong">{h.kind[0]!.toUpperCase() + h.kind.slice(1)}</span>
                      {h.peer ? ` from ${h.peer}` : ''}
                      {h.file ? <div className="small muted wrap-anywhere">{h.file}</div> : null}
                    </td>
                    <td>
                      {h.ok ? h.summary : <span style={{ color: 'var(--red)' }}>{h.error ?? h.summary}</span>}
                    </td>
                    <td>
                      {h.logPath ? (
                        <button type="button" className="btn btn-sm btn-quiet" onClick={() => void b.invoke('files.open', h.logPath!)}>
                          Open log
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted">No exports or imports yet.</p>
        )}
      </details>

      <details>
        <summary className="field-label" style={{ cursor: 'pointer' }}>
          Restore from backup ({backups.length})
        </summary>
        <div className="stack-sm" style={{ marginTop: 8 }}>
          <span className="hint">
            ApplyFlow backs up its database before every import and every restore, and keeps the latest {15} automatic backups. Restoring replaces the database with the backup; the current data is backed up
            first, so a restore can itself be undone. Documents saved by an import stay in your ApplyFlow folder.
          </span>
          <div className="row">
            <button
              type="button"
              className="btn btn-sm"
              disabled={working}
              onClick={() =>
                void run('backup', async () => {
                  const r = await b.invoke('sync.backupNow');
                  setNotice(`Backup saved: ${r.name}`);
                })
              }
            >
              {busy === 'backup' ? <span className="spinner" aria-hidden="true" /> : <Icon name="history" size={14} />}
              Back up now
            </button>
          </div>
          {backups.length ? (
            <div className="table-wrap" style={{ maxHeight: 320 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Made</th>
                    <th scope="col">Why</th>
                    <th scope="col">Size</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((bk) => (
                    <tr key={bk.name}>
                      <td style={{ whiteSpace: 'nowrap' }}>{when(bk.createdAt)}</td>
                      <td>{bk.reason === 'before-import' ? 'Before an import' : bk.reason === 'before-restore' ? 'Before a restore' : 'Made by you'}</td>
                      <td>{bytes(bk.bytes)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {confirmRestore === bk.name ? (
                          <>
                            <button type="button" className="btn btn-sm btn-danger" disabled={working} onClick={() => void doRestore(bk.name)}>
                              {busy === 'restore' ? <span className="spinner" aria-hidden="true" /> : null}
                              Yes, restore it
                            </button>{' '}
                            <button type="button" className="btn btn-sm btn-quiet" onClick={() => setConfirmRestore(null)} disabled={working}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button type="button" className="btn btn-sm" onClick={() => setConfirmRestore(bk.name)} disabled={working}>
                            Restore…
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="small muted">No backups yet.</p>
          )}
        </div>
      </details>
    </section>
  );
}
