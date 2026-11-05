import { useEffect, useRef, useState, type FormEvent } from 'react';
import { bridge, type BrowserState, type BrowserTab, type BrowserTabsState } from '@/platform/bridge';
import { Icon } from '@/components/Icon';
import { WarningBanner } from '@/components/WarningBanner';
import { BrowserSessionDialog } from './BrowserSessionDialog';

const EMPTY: BrowserState = { url: '', title: '', searchUrl: null, onSearch: false, onApplication: false, canGoBack: false, canGoForward: false, loading: true, ready: false };
const NO_TABS: BrowserTabsState = { activeId: 0, jobsId: 0, tabs: [] };

function tabLabel(t: BrowserTab): string {
  if (t.kind === 'jobs') return 'Jobs';
  if (t.title && t.title !== t.url) return t.title;
  try {
    const u = new URL(t.url);
    return /^https?:$/.test(u.protocol) ? u.hostname : 'New tab';
  } catch {
    return 'New tab';
  }
}

export function BrowserPane({ visible }: { visible: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<BrowserState>(EMPTY);
  const [tabs, setTabs] = useState<BrowserTabsState>(NO_TABS);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [opening, setOpening] = useState<{ show: boolean; label: string }>({ show: false, label: '' });

  useEffect(() => {
    const b = bridge();
    if (!b) return;
    void b.invoke('dice.state').then(setState);
    void b.invoke('browser.state').then(setTabs).catch(() => undefined);
    const offState = b.on('dice:state', setState);
    const offTabs = b.on('browser:tabs', setTabs);
    return () => {
      offState();
      offTabs();
    };
  }, []);

  const active = tabs.tabs.find((t) => t.id === tabs.activeId) ?? null;
  const onJobs = !active || active.kind === 'jobs';
  const jobsTab = tabs.tabs.find((t) => t.kind === 'jobs') ?? null;
  const currentUrl = onJobs ? state.url : (active?.url ?? '');

  useEffect(() => {
    if (!editing) setAddress(currentUrl === 'about:blank' ? '' : currentUrl);
  }, [currentUrl, editing, tabs.activeId]);

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

  useEffect(() => {
    const check = () => setDialogOpen(Boolean(document.querySelector('[role="dialog"], .modal-backdrop')));
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    check();
    return () => mo.disconnect();
  }, []);

  const loading = onJobs ? state.loading : Boolean(active?.loading);
  const pageLoading = onJobs ? state.ready && state.loading : loading;
  const [slowLoad, setSlowLoad] = useState(false);
  useEffect(() => {
    if (!pageLoading) {
      setSlowLoad(false);
      return;
    }
    const t = setTimeout(() => setSlowLoad(true), 300);
    return () => clearTimeout(t);
  }, [pageLoading]);

  const showVeil = (onJobs && opening.show) || slowLoad;
  const hideBrowser = dialogOpen;

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

  const b = () => bridge();
  const go = (e: FormEvent) => {
    e.preventDefault();
    const v = address.trim();
    if (v) {
      if (onJobs) void b()?.invoke('dice.navigate', v);
      else if (active) void b()?.invoke('browser.navigate', active.id, v);
    }
    setEditing(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const back = () => (onJobs ? void b()?.invoke('dice.back') : active && void b()?.invoke('browser.back', active.id));
  const forward = () => (onJobs ? void b()?.invoke('dice.forward') : active && void b()?.invoke('browser.forward', active.id));
  const reloadOrStop = () => {
    const id = active?.id ?? tabs.jobsId;
    if (loading) void b()?.invoke('browser.stop', id);
    else if (onJobs) void b()?.invoke('dice.reload');
    else void b()?.invoke('browser.reload', id);
  };
  const newTab = async () => {
    await b()?.invoke('browser.newTab');
    setTimeout(() => addressRef.current?.focus(), 0);
  };

  const canGoBack = onJobs ? state.canGoBack : Boolean(active?.canGoBack);
  const canGoForward = onJobs ? state.canGoForward : Boolean(active?.canGoForward);
  const secure = /^https:\/\//i.test(currentUrl);
  const veilLabel = onJobs && opening.show ? opening.label || 'Opening your application…' : 'Opening page…';
  const veilHint = onJobs && opening.show ? 'Waiting for the employer’s application to load' : 'Waiting for the page to finish loading';

  return (
    <section className="browser" aria-label="Built-in browser">
      {tabs.tabs.length ? (
        <div className="browser-tabs" role="tablist" aria-label="Browser tabs">
          {tabs.tabs.map((t) => {
            const selected = t.id === tabs.activeId;
            const label = tabLabel(t);
            return (
              <div key={t.id} className={`browser-tab${selected ? ' is-active' : ''}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className="browser-tab-btn"
                  onClick={() => void b()?.invoke('browser.activate', t.id)}
                  title={t.kind === 'jobs' ? `Jobs: where ApplyFlow fills applications${t.title ? ` — ${t.title}` : ''}` : t.title || t.url}
                >
                  {t.loading ? <span className="spinner spinner-dark spinner-xs" aria-hidden="true" /> : <Icon name={t.kind === 'jobs' ? 'briefcase' : 'globe'} size={13} />}
                  <span className="browser-tab-title">{label}</span>
                  {t.challenge || t.challengeLoop ? <Icon name="shield" size={12} /> : null}
                  {t.challenge || t.challengeLoop ? <span className="sr-only"> (security check)</span> : null}
                </button>
                {t.kind === 'web' ? (
                  <button type="button" className="browser-tab-close" aria-label={`Close ${label}`} title="Close tab" onClick={() => void b()?.invoke('browser.closeTab', t.id)}>
                    <Icon name="close" size={11} />
                  </button>
                ) : null}
              </div>
            );
          })}
          <button type="button" className="btn icon-btn browser-tab-new" onClick={() => void newTab()} aria-label="New tab" title="New tab (Ctrl+T)">
            <Icon name="plus" size={14} />
          </button>
        </div>
      ) : null}
      <form className="browser-bar" onSubmit={go}>
        <button type="button" className="btn icon-btn" onClick={back} disabled={!canGoBack} aria-label="Back" title={onJobs && state.onApplication ? 'Back to the job (leaves the application)' : 'Back'}>
          <Icon name="back" />
        </button>
        <button type="button" className="btn icon-btn" onClick={forward} disabled={!canGoForward} aria-label="Forward" title="Forward">
          <Icon name="forward" />
        </button>
        <button type="button" className="btn icon-btn" onClick={reloadOrStop} aria-label={loading ? 'Stop' : 'Reload'} title={loading ? 'Stop loading' : 'Reload (F5)'}>
          {loading ? <Icon name="stop" /> : <Icon name="refresh" />}
        </button>
        <button type="button" className="btn btn-sm site-btn" onClick={() => void b()?.invoke('dice.navigate', 'https://jobright.ai/jobs/recommend')} title="Your Jobright job recommendations (Jobs tab)">
          Jobright
        </button>
        <button type="button" className="btn btn-sm site-btn" onClick={() => void b()?.invoke('dice.navigate', 'https://www.dice.com/')} title="Dice home (Jobs tab)">
          Dice
        </button>
        {onJobs ? (
          <button
            type="button"
            className="btn btn-sm search-results-btn"
            onClick={() => void b()?.invoke('dice.backToSearch')}
            disabled={Boolean(state.onSearch)}
            title={state.searchUrl ? 'Back to your Dice search results' : 'Open Dice job search'}
          >
            <Icon name="search" size={14} /> {state.searchUrl ? 'Search results' : 'Job search'}
          </button>
        ) : null}
        <label className="address">
          <Icon name={secure ? 'shield' : 'globe'} size={14} />
          <span className="sr-only">{onJobs ? 'Address or Dice job search' : 'Address or web search'}</span>
          <input
            ref={addressRef}
            className="address-input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => {
              setEditing(true);
              e.target.select();
            }}
            onBlur={() => setEditing(false)}
            placeholder={onJobs ? 'Search Dice jobs or paste a job link' : 'Search the web or type an address'}
            spellCheck={false}
          />
        </label>
        <button type="submit" className="btn btn-sm">
          Go
        </button>
        <button type="button" className="btn icon-btn" onClick={() => setSessionOpen(true)} aria-label="Built-in browser: session and diagnostics" title="Session, reset and diagnostics">
          <Icon name="gear" />
        </button>
      </form>
      <BrowserNotice tab={active ?? jobsTab} />
      {showVeil ? (
        <div className="browser-loading-strip" role="status" aria-live="polite" aria-busy="true">
          <span className="sk sk-dot" aria-hidden="true" />
          <span className="browser-loading-text">
            <strong>{veilLabel}</strong>
            <span className="browser-loading-hint">{veilHint}</span>
          </span>
          <span className="browser-loading-skeleton" aria-hidden="true">
            <span className="sk sk-bar" />
            <span className="sk sk-bar sk-bar-md" />
            <span className="sk sk-bar sk-bar-sm" />
          </span>
        </div>
      ) : null}
      <div className="browser-host" ref={hostRef}>
        {onJobs && !state.ready ? (
          <div className="browser-wait">
            <span className="spinner spinner-dark" aria-hidden="true" /> Loading Jobright…
          </div>
        ) : null}
        {dialogOpen ? <div className="browser-wait">The page is hidden while a dialog is open.</div> : null}
      </div>
      <BrowserSessionDialog open={sessionOpen} tab={active ?? jobsTab} onClose={() => setSessionOpen(false)} />
    </section>
  );
}

function BrowserNotice({ tab }: { tab: BrowserTab | null }) {
  if (!tab) return null;
  const b = bridge();
  const openOutside = /^https?:\/\//i.test(tab.url) ? (
    <button type="button" className="btn btn-sm" onClick={() => void b?.invoke('browser.openExternal', tab.id)}>
      <Icon name="external" size={13} /> Open in my browser
    </button>
  ) : null;
  if (tab.challengeLoop) {
    return (
      <div className="browser-notice">
        <WarningBanner
          tone="warning"
          live
          title="This site’s security check isn’t accepting this browser"
          actions={
            <>
              {openOutside}
              <button type="button" className="btn btn-sm" onClick={() => void b?.invoke('browser.retryCheck', tab.id)}>
                Try again here
              </button>
            </>
          }
        >
          It keeps coming back or hasn’t finished, so it may not accept ApplyFlow’s built-in browser from this network right now. ApplyFlow won’t keep reloading it. You can continue in your usual browser.
        </WarningBanner>
      </div>
    );
  }
  if (tab.crashed) {
    return (
      <div className="browser-notice">
        <WarningBanner
          tone="critical"
          live
          title="This page stopped working"
          actions={
            <button type="button" className="btn btn-sm" onClick={() => void b?.invoke('browser.reload', tab.id)}>
              Reload
            </button>
          }
        />
      </div>
    );
  }
  if (tab.error) {
    return (
      <div className="browser-notice">
        <WarningBanner
          tone="critical"
          live
          title="Couldn’t open this page"
          actions={
            <>
              <button type="button" className="btn btn-sm" onClick={() => void b?.invoke('browser.reload', tab.id)}>
                Try again
              </button>
              {openOutside}
            </>
          }
        >
          {tab.error.description || 'The page did not load'} (error {tab.error.code}).
        </WarningBanner>
      </div>
    );
  }
  if (tab.challenge) {
    return (
      <div className="browser-notice">
        <WarningBanner tone="info" live title="Security check">
          Complete it on the page below. ApplyFlow doesn’t interact with it{tab.kind === 'jobs' ? ', and waits until it’s done before filling anything' : ''}.
        </WarningBanner>
      </div>
    );
  }
  return null;
}
