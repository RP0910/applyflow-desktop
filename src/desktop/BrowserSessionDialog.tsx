import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { bridge, type BrowserDiagnosticsReport, type BrowserTab } from '@/platform/bridge';
import { Icon } from '@/components/Icon';

const PROFILE_NAMES: Record<string, string> = {
  'persist:dice': 'Jobs and web tabs',
  'persist:applyflow-claude': 'Claude.ai Chat',
};

function time(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
}

export function BrowserSessionDialog({ open, tab, onClose }: { open: boolean; tab: BrowserTab | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [report, setReport] = useState<BrowserDiagnosticsReport | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    void bridge()?.invoke('browser.diagnostics').then(setReport).catch(() => setReport(null));
  }, []);

  useEffect(() => {
    if (!open) return;
    setConfirmReset(false);
    setNote('');
    load();
    const returnTo = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo?.focus?.();
    };
  }, [open, load, onClose]);

  if (!open) return null;

  const pageUrl = tab && /^https?:\/\//i.test(tab.url) ? tab.url : null;
  const reset = async () => {
    setBusy(true);
    try {
      await bridge()?.invoke('browser.resetSession');
      setNote('Signed out of every site in the built-in browser. Web tabs were closed.');
      setConfirmReset(false);
      load();
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setNote('Diagnostics copied.');
    } catch {
      setNote('Could not copy. Select the list below instead.');
    }
  };
  const events = (report?.events ?? []).slice(-20).reverse();

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal browser-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <h2 id={titleId}>Built-in browser</h2>
        <div className="stack-sm">
          <p className="small">
            Sites you sign in to here stay signed in after ApplyFlow restarts, for as long as each site allows. This browser keeps its own profile, separate from the browser you use day to day. ApplyFlow never fills in security checks
            (“Just a moment…”, CAPTCHAs): you complete them on the page.
          </p>
          {report ? (
            <ul className="browser-profiles">
              {report.partitions.map((p) => (
                <li key={p.partition}>
                  <strong>{PROFILE_NAMES[p.partition] ?? p.partition}</strong>: {p.persistent ? 'kept on this computer' : 'this session only'}, {p.cookies} cookies from {p.sites} sites
                  {p.clearanceSites.length ? <span className="muted"> · security check passed for {p.clearanceSites.join(', ')}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {note ? (
            <p className="small" role="status">
              {note}
            </p>
          ) : null}
          <div className="row">
            <button type="button" className="btn btn-sm" disabled={!pageUrl || !tab} onClick={() => tab && void bridge()?.invoke('browser.openExternal', tab.id)} title={pageUrl ?? undefined}>
              <Icon name="external" size={13} /> Open this page in my browser
            </button>
            <button type="button" className="btn btn-sm" disabled={!report} onClick={() => void copy()}>
              <Icon name="copy" size={13} /> Copy diagnostics
            </button>
            {!confirmReset ? (
              <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmReset(true)}>
                Reset browser session…
              </button>
            ) : null}
          </div>
          {confirmReset ? (
            <div className="banner banner-warning" role="group" aria-label="Confirm reset">
              <Icon name="alert" />
              <div>
                <div className="banner-title">Sign out of every site in the built-in browser?</div>
                <div>Clears cookies, saved sign-ins and site data for the Jobs and web tabs (Jobright, Dice, employer sites). Claude.ai Chat’s sign-in is separate and stays.</div>
                <div className="banner-actions">
                  <button type="button" className="btn btn-sm" onClick={() => setConfirmReset(false)} disabled={busy}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => void reset()} disabled={busy}>
                    {busy ? <span className="spinner" aria-hidden="true" /> : null}
                    Reset
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          <details className="browser-diagnostics">
            <summary>Diagnostics</summary>
            {report ? (
              <div className="stack-sm">
                <p className="small muted">
                  Electron {report.electron} · Chromium {report.chromium}
                  <br />
                  <span className="wrap-anywhere">{report.userAgent}</span>
                </p>
                {events.length ? (
                  <ol className="browser-events">
                    {events.map((e, i) => (
                      <li key={`${e.at}-${i}`}>
                        <span className="muted">{time(e.at)}</span> <strong>{e.kind}</strong> · {e.source}
                        {e.status ? ` · HTTP ${e.status}` : ''}
                        {e.code ? ` · error ${e.code}` : ''}
                        {e.url ? <span className="wrap-anywhere"> · {e.url}</span> : null}
                        {e.detail ? <span className="muted"> · {e.detail}</span> : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="small muted">No problems recorded since ApplyFlow started.</p>
                )}
              </div>
            ) : (
              <p className="small muted">Loading…</p>
            )}
          </details>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
