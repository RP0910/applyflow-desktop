import { useMemo, useState } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { backToDiceSearch, isDesktop } from '@/platform/bridge';
import { useLibrary } from '@/hooks/useLibrary';
import { defaultMessenger, type Messenger } from '@/services/messaging';
import type { DownloadsApi } from '@/services/downloads/downloader';
import type { EngineDeps } from '@/services/workflow/engine';
import { submitBlockers, unresolvedCritical } from '@/services/workflow/gating';
import { WarningBanner } from '@/components/WarningBanner';
import { BrandLogo, Icon, type IconName } from '@/components/Icon';
import { useWorkflow, type PanelView, type Workflow } from './useWorkflow';
import { HomeView } from './HomeView';
import { JobTab } from './tabs/JobTab';
import { MatchTab } from './tabs/MatchTab';
import { ResumeTab } from './tabs/ResumeTab';
import { CoverLetterTab } from './tabs/CoverLetterTab';
import { SettingsTab } from './tabs/OtherTabs';

const NAV: { id: PanelView; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Apply', icon: 'target' },
  { id: 'documents', label: 'Documents', icon: 'doc' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
];

interface Primary {
  label: string;
  run?: () => void;
  disabled?: boolean;
  hint?: string;
  spinning?: boolean;
  secondary?: { label: string; run: () => void };
}

export function primaryAction(wf: Workflow, hasResume: boolean): Primary {
  const s = wf.session;
  const r = wf.run;
  if (r.status === 'working') return { label: r.label || 'Working…', spinning: true, disabled: true, secondary: { label: 'Cancel', run: wf.cancel } };
  if (r.status === 'submitting') return { label: 'Submitting…', spinning: true, disabled: true };
  if (!hasResume) return { label: 'Tailor & Apply', disabled: true, hint: 'Add your resume above to begin.' };
  if (!s) return { label: 'Tailor & Apply', disabled: true, hint: wf.busy ? 'Reading the job…' : 'Open a job on dice.com to begin.' };
  if (s.submittedAt) {
    return isDesktop()
      ? { label: 'Back to search results', run: () => void backToDiceSearch(), hint: 'Applied and saved in Applications. Pick your next job.' }
      : { label: 'Applied', disabled: true, hint: 'Saved in Applications.' };
  }
  if (r.status === 'ready') {
    const blockers = submitBlockers({ session: s, run: r, duplicateApplied: wf.duplicateApplied });
    return {
      label: 'Submit application',
      run: () => void wf.submit(),
      disabled: blockers.length > 0,
      hint: blockers[0] ?? `Sends your application to ${s.job.company || 'the employer'} on ${wf.page?.siteName || 'the site'}.`,
    };
  }
  if (r.status === 'questions') return { label: 'Continue', run: () => void wf.continueRun(), hint: 'Answer below, or on the page and press Continue.' };
  if (r.status === 'attention') return { label: 'Continue', run: () => void wf.continueRun(), hint: r.label };
  if (r.status === 'external') {
    const url = r.externalUrl;
    return url
      ? { label: 'Open employer site', run: () => window.open(url, '_blank', 'noopener'), hint: 'Your documents are in your ApplyFlow folder.' }
      : { label: 'Done', disabled: true, hint: 'Apply on the employer’s site with the saved documents.' };
  }
  if (s.job.description.trim().length < 100) return { label: 'Tailor & Apply', disabled: true, hint: 'The job description is missing — add it under Job details.' };
  if (wf.duplicateApplied && !s.duplicateAcknowledged) return { label: 'Apply again', run: () => void wf.quickApply(), hint: 'You applied to this job before.' };
  return {
    label: s.resume ? 'Apply now' : 'Tailor & Apply',
    run: () => void wf.quickApply(),
    hint: s.resume ? 'Uses the documents already tailored for this job.' : s.job.platform === 'jobright' ? 'Writes your documents, opens the employer’s application from Jobright, attaches and fills it. You submit at the end.' : 'Writes your documents, opens Dice’s form, attaches and fills it. You submit at the end.',
  };
}

export interface PanelDeps {
  messenger?: Messenger;
  downloads?: DownloadsApi | null;
  engine?: Partial<EngineDeps>;
  pinnedTabId?: number | null;
  pollMs?: number;
}

const DESKTOP_NAV = NAV.filter((n) => n.id === 'home' || n.id === 'documents');

function DocumentsView({ wf, lib, settings }: { wf: Workflow; lib: ReturnType<typeof useLibrary>; settings: ReturnType<typeof useSettings>['settings'] }) {
  const [which, setWhich] = useState<'resume' | 'cover'>('resume');
  return (
    <div className="stack">
      <div className="segmented" role="group" aria-label="Document">
        <button type="button" aria-pressed={which === 'resume'} onClick={() => setWhich('resume')}>
          Resume
        </button>
        <button type="button" aria-pressed={which === 'cover'} onClick={() => setWhich('cover')}>
          Cover letter
        </button>
      </div>
      {which === 'resume' ? <ResumeTab wf={wf} lib={lib} settings={settings} /> : <CoverLetterTab wf={wf} />}
    </div>
  );
}

export function PanelApp({ deps = {}, desktop = false }: { deps?: PanelDeps; desktop?: boolean }) {
  const settingsCtl = useSettings();
  const lib = useLibrary();
  const wfDeps = useMemo(
    () => ({ messenger: deps.messenger ?? defaultMessenger(), downloads: deps.downloads, engine: deps.engine, pinnedTabId: deps.pinnedTabId ?? null, pollMs: deps.pollMs }),
    [deps.messenger, deps.downloads, deps.engine, deps.pinnedTabId, deps.pollMs],
  );
  const wf = useWorkflow({ settings: settingsCtl.settings, resumes: lib.resumes, profile: lib.profile }, wfDeps);
  const [minimized, setMinimized] = useState(false);

  const primary = primaryAction(wf, lib.resumes.length > 0);
  const critical = unresolvedCritical(wf.session).length;
  const view = wf.view;

  return (
    <div className={`panel${minimized ? ' panel-minimized' : ''}${desktop ? ' panel-desktop' : ''}`}>
      {desktop ? null : (
      <header className="topbar">
        <span className="brand">
          <BrandLogo height={30} />
          <span className="brand-for">for Dice &amp; Jobright</span>
        </span>
        <span className="row" style={{ gap: 0 }}>
          <button type="button" className="btn icon-btn" onClick={() => setMinimized((m) => !m)} aria-label={minimized ? 'Expand ApplyFlow' : 'Minimize ApplyFlow'} aria-expanded={!minimized}>
            <Icon name={minimized ? 'expand' : 'minimize'} />
          </button>
          <button type="button" className="btn icon-btn" onClick={() => window.close()} aria-label="Close ApplyFlow">
            <Icon name="close" />
          </button>
        </span>
      </header>
      )}
      <nav className="nav" aria-label="ApplyFlow sections">
        {(desktop ? DESKTOP_NAV : NAV).map((n) => (
          <button key={n.id} type="button" aria-current={view === n.id || (n.id === 'home' && view === 'match') ? 'page' : undefined} onClick={() => wf.setView(n.id)}>
            <Icon name={n.icon} size={14} />
            {n.label}
            {n.id === 'documents' && critical ? (
              <>
                <span className="dot" aria-hidden="true" />
                <span className="sr-only">({critical} issues)</span>
              </>
            ) : null}
          </button>
        ))}
      </nav>
      <main className="panel-body" id="panel-main" tabIndex={-1}>
        <div className="stack">
          {wf.notices.map((n) => (
            <WarningBanner
              key={n.id}
              tone={n.tone}
              live
              actions={
                <button type="button" className="btn btn-sm btn-quiet" onClick={() => wf.dismiss(n.id)}>
                  Dismiss
                </button>
              }
            >
              {n.text}
            </WarningBanner>
          ))}
          {view === 'home' ? <HomeView wf={wf} lib={lib} settings={settingsCtl.settings} hasKey={settingsCtl.hasKey} /> : null}
          {view === 'match' ? (
            <>
              <button type="button" className="back" onClick={() => wf.setView('home')}>
                ← Back
              </button>
              <JobTab wf={wf} />
              <MatchTab wf={wf} lib={lib} settings={settingsCtl.settings} />
            </>
          ) : null}
          {view === 'documents' ? <DocumentsView wf={wf} lib={lib} settings={settingsCtl.settings} /> : null}
          {view === 'settings' ? <SettingsTab ctl={settingsCtl} /> : null}
        </div>
      </main>
      <footer className="action-bar">
        <div className="progress-line" role="status" aria-live="polite">
          <span className="progress-line__text">{wf.progressText || primary.hint || ''}</span>
        </div>
        <div className="action-row">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => {
              if (view !== 'home') wf.setView('home');
              primary.run?.();
            }}
            disabled={primary.disabled || !primary.run}
            aria-busy={primary.spinning || undefined}
          >
            {primary.spinning ? <span className="spinner" aria-hidden="true" /> : null}
            {primary.label}
          </button>
          {primary.secondary ? (
            <button type="button" className="btn btn-lg" onClick={primary.secondary.run}>
              {primary.secondary.label}
            </button>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
