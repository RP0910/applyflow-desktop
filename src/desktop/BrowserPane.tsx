/**
 * The built-in Dice browser: a toolbar, and a placeholder whose position the main process
 * mirrors with the real browser view (a native WebContentsView drawn over this area).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { bridge, type BrowserState } from '@/platform/bridge';
import { BrandLogo, Icon } from '@/components/Icon';

const EMPTY: BrowserState = { url: '', title: '', searchUrl: null, onSearch: false, onApplication: false, canGoBack: false, canGoForward: false, loading: true, ready: false };

export function BrowserPane({ visible }: { visible: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<BrowserState>(EMPTY);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [opening, setOpening] = useState<{ show: boolean; label: string }>({ show: false, label: '' });

  useEffect(() => {
    const b = bridge();
    if (!b) return;
    void b.invoke('dice.state').then(setState);
    return b.on('dice:state', setState);
  }, []);

  useEffect(() => {
    if (!editing) setAddress(state.url);
  }, [state.url, editing]);

  // Workflow-driven veil only while opening the employer application (not during document prep).
  useEffect(() => {
    const read = () => {
      const label = document.documentElement.dataset.afOpening;
      setOpening(label ? { show: true, label } : { show: false, label: '' });
    };
    const onOpening = (e: Event) => {
      const d = (e as CustomEvent<{ show?: boolean; label?: string }>).detail;
      setOpening({ show: Boolean(d?.show), label: d?.label || 'Opening your application…' });
    };
    read();
    window.addEventListener('af:opening', onOpening);
    return () => window.removeEventListener('af:opening', onOpening);
  }, []);

  // A dialog in ApplyFlow's window must not be covered by the browser view.
  useEffect(() => {
    const check = () => setDialogOpen(Boolean(document.querySelector('[role="dialog"], .modal-backdrop')));
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    check();
    return () => mo.disconnect();
  }, []);

  // Hide the native WebContentsView while a dialog, workflow veil, or page load overlay is up —
  // otherwise the React overlay sits under the browser and the user can't see it.
  const pageLoading = state.ready && state.loading;
  const showVeil = opening.show || pageLoading;
  const hideBrowser = dialogOpen || showVeil;

  useEffect(() => {
    const b = bridge();
    const el = hostRef.current;
    if (!b || !el) return;
    const show = visible && !hideBrowser;
    void b.invoke('dice.setVisible', show);
    if (!show) return;
    const push = () => {
      const r = el.getBoundingClientRect();
      void b.invoke('dice.setBounds', { x: r.left, y: r.top, width: r.width, height: r.height });
    };
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    window.addEventListener('resize', push);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', push);
    };
  }, [visible, hideBrowser]);

  const go = (e: FormEvent) => {
    e.preventDefault();
    const v = address.trim();
    if (v) void bridge()?.invoke('dice.navigate', v);
    setEditing(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const onDice = /^https:\/\/(www\.)?dice\.com\//i.test(state.url);
  const veilLabel = opening.show ? opening.label || 'Opening your application…' : 'Opening page…';
  const veilHint = opening.show
    ? 'Waiting for the employer’s application to load'
    : 'Waiting for the page to finish loading';

  return (
    <section className="browser" aria-label="Dice">
      <form className="browser-bar" onSubmit={go}>
        <button type="button" className="btn icon-btn" onClick={() => void bridge()?.invoke('dice.back')} disabled={!state.canGoBack} aria-label="Back" title={state.onApplication ? 'Back to the job (leaves the application)' : 'Back'}>
          <Icon name="back" />
        </button>
        <button type="button" className="btn icon-btn" onClick={() => void bridge()?.invoke('dice.forward')} disabled={!state.canGoForward} aria-label="Forward" title="Forward">
          <Icon name="forward" />
        </button>
        <button type="button" className="btn icon-btn" onClick={() => void bridge()?.invoke('dice.reload')} aria-label="Reload" title="Reload (F5)">
          {state.loading ? <span className="spinner spinner-dark" aria-hidden="true" /> : <Icon name="refresh" />}
        </button>
        <button type="button" className="btn btn-sm site-btn" onClick={() => void bridge()?.invoke('dice.navigate', 'https://jobright.ai/jobs/recommend')} title="Your Jobright job recommendations">
          Jobright
        </button>
        <button type="button" className="btn btn-sm site-btn" onClick={() => void bridge()?.invoke('dice.navigate', 'https://www.dice.com/')} title="Dice home">
          Dice
        </button>
        <button
          type="button"
          className="btn btn-sm search-results-btn"
          onClick={() => void bridge()?.invoke('dice.backToSearch')}
          disabled={Boolean(state.onSearch)}
          title={state.searchUrl ? 'Back to your Dice search results' : 'Open Dice job search'}
        >
          <Icon name="search" size={14} /> {state.searchUrl ? 'Search results' : 'Job search'}
        </button>
        <label className="address">
          <Icon name={onDice ? 'shield' : 'globe'} size={14} />
          <span className="sr-only">Address or Dice job search</span>
          <input
            className="address-input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => {
              setEditing(true);
              e.target.select();
            }}
            onBlur={() => setEditing(false)}
            placeholder="Search Dice jobs or paste a job link"
            spellCheck={false}
          />
        </label>
        <button type="submit" className="btn btn-sm">
          Go
        </button>
      </form>
      <div className="browser-host" ref={hostRef}>
        {!state.ready ? (
          <div className="browser-wait">
            <span className="spinner spinner-dark" aria-hidden="true" /> Loading Dice…
          </div>
        ) : null}
        {showVeil ? (
          <div className="browser-loading-overlay" role="status" aria-live="polite" aria-busy="true">
            <div className="browser-loading-card">
              <BrandLogo height={40} />
              <span className="spinner spinner-lg" aria-hidden="true" />
              <p>{veilLabel}</p>
              <span className="browser-loading-hint">{veilHint}</span>
            </div>
          </div>
        ) : null}
        {dialogOpen && !showVeil ? <div className="browser-wait">The Dice page is hidden while a dialog is open.</div> : null}
      </div>
    </section>
  );
}
