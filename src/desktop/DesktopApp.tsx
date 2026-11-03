/**
 * ApplyFlow desktop shell: navigation rail + views. The Apply view (built-in Dice browser and
 * the ApplyFlow panel) stays mounted while you look at other views, so a running application
 * is never interrupted.
 */
import { useCallback, useEffect, useState } from 'react';
import { bridge, type DesktopView, type UsageSummary } from '@/platform/bridge';
import { PanelApp } from '@/sidepanel/PanelApp';
import { navigateListeners } from '@/sidepanel/tabs/OtherTabs';
import { useSettings } from '@/hooks/useSettings';
import { useLibrary } from '@/hooks/useLibrary';
import { CandidateSetup } from '@/components/CandidateSetup';
import { ProfileForm } from '@/components/ProfileForm';
import { ScreeningAnswersForm } from '@/components/ScreeningAnswersForm';
import { SettingsForm } from '@/components/SettingsForm';
import { EducationSettings } from '@/components/EducationSettings';
import { WarningBanner } from '@/components/WarningBanner';
import { BrandLogo, Icon, type IconName } from '@/components/Icon';
import { APP_VERSION } from '@/version';
import { BrowserPane } from './BrowserPane';
import { ApplicationsView } from './ApplicationsView';
import { AnalyticsView } from './AnalyticsView';
import { PdfStudio } from './PdfStudio';

const NAV: { id: DesktopView; label: string; icon: IconName; hint?: string }[] = [
  { id: 'apply', label: 'Apply', icon: 'target', hint: 'Ctrl+1' },
  { id: 'applications', label: 'Applications', icon: 'briefcase', hint: 'Ctrl+2' },
  { id: 'analytics', label: 'Analytics', icon: 'history', hint: 'Ctrl+3' },
  { id: 'studio', label: 'PDF Studio', icon: 'palette', hint: 'Ctrl+4' },
  { id: 'profile', label: 'Profile settings', icon: 'user' },
  { id: 'answers', label: 'Screening Q&A', icon: 'note' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
  { id: 'privacy', label: 'Privacy & data', icon: 'shield' },
];

const LEDES: Partial<Record<DesktopView, string>> = {
  applications: 'Search by company, recruiter, phone number, email, job title or skill — see exactly which resume you sent.',
  analytics: 'Your local activity dashboard — applications, pipeline, weekly volume, companies and Claude usage. Nothing is sent anywhere.',
  library: 'Employer details are managed in Profile settings.',
  studio: 'Turn resume JSON into a PDF or Word file with ApplyFlow’s own renderer. Edit any saved resume and re-render it — no AI, no tokens.',
  profile: 'Contact details, full address and job-site logins used to fill applications. Employers and education are below.',
  answers: 'View and edit every screening question and answer saved in your local database. Similar questions are filled automatically on later applications.',
  settings: 'Claude connection, documents, privacy and where files are saved.',
  privacy: 'Exactly what ApplyFlow stores, what it sends, and what it refuses to do.',
};

const SECTION_TO_VIEW: Record<string, DesktopView> = { library: 'profile', profile: 'profile', answers: 'answers', history: 'applications', analytics: 'analytics', settings: 'settings', privacy: 'privacy' };
export function DesktopApp() {
  const [view, setView] = useState<DesktopView>('apply');
  const [focus, setFocus] = useState<string | null>(null);
  const [searchSignal, setSearchSignal] = useState(0);
  const [studioDoc, setStudioDoc] = useState<{ json: string; title: string } | null>(null);
  const settingsCtl = useSettings();
  const lib = useLibrary();

  useEffect(() => {
    const b = bridge();
    const offNav = b?.on('app:navigate', (n) => {
      setView(n.view === 'library' ? 'profile' : n.view);
      if (n.focus) setFocus(n.focus);
      if (n.search) setSearchSignal((x) => x + 1);
    });
    const onSection = (section: string) => setView(SECTION_TO_VIEW[section] ?? 'apply');
    navigateListeners.add(onSection);
    return () => {
      offNav?.();
      navigateListeners.delete(onSection);
    };
  }, []);

  const openStudio = useCallback((json: string, title: string) => {
    setStudioDoc({ json, title });
    setView('studio');
  }, []);

  const current = NAV.find((n) => n.id === view)!;

  return (
    <div className={`desktop view-${view}`}>
      <nav className="rail" aria-label="ApplyFlow">
        <span className="brand rail-brand">
          <BrandLogo height={44} />
        </span>
        {NAV.map((n) => (
          <button key={n.id} type="button" className="rail-item" aria-current={view === n.id ? 'page' : undefined} onClick={() => setView(n.id)} title={n.hint}>
            <Icon name={n.icon} /> {n.label}
          </button>
        ))}
        <button type="button" className="rail-find" onClick={() => {
          setView('applications');
          setSearchSignal((x) => x + 1);
        }}>
          <Icon name="phone" size={14} />
          <span>
            Recruiter calling?
            <span className="hint">Ctrl+Alt+Shift+F from anywhere</span>
          </span>
        </button>
        <p className="rail-foot">Version {APP_VERSION}. Not affiliated with Dice or Jobright.</p>
      </nav>

      {/* Apply: always mounted; hidden (not unmounted) on other views. */}
      <div className="apply-view" hidden={view !== 'apply'}>
        <BrowserPane visible={view === 'apply'} />
        <aside className="apply-panel" aria-label="ApplyFlow panel">
          <PanelApp desktop />
        </aside>
      </div>

      {view !== 'apply' ? (
        <main className={`ws-main desktop-main${view === 'applications' || view === 'studio' || view === 'analytics' ? ' desktop-main-wide' : ''}`}>
          <h1>{current.label}</h1>
          {LEDES[view] ? <p className="lede">{LEDES[view]}</p> : null}
          {view === 'applications' ? <ApplicationsView focus={focus} searchSignal={searchSignal} onOpenStudio={openStudio} /> : null}
          {view === 'analytics' ? <AnalyticsView onOpenApplications={() => setView('applications')} /> : null}
          {view === 'studio' ? <PdfStudio initial={studioDoc} /> : null}
          {view === 'profile' ? (
            <>
              {lib.message ? <div style={{ marginBottom: 12 }}><WarningBanner tone={lib.message.tone} live>{lib.message.text}</WarningBanner></div> : null}
              <ProfileForm profile={lib.profile} onSave={(p) => void lib.updateProfile(p)} />
              <CandidateSetup lib={lib} />
              <EducationSettings lib={lib} />
            </>
          ) : null}
          {view === 'answers' ? (
            <>
              {lib.message ? <div style={{ marginBottom: 12 }}><WarningBanner tone={lib.message.tone} live>{lib.message.text}</WarningBanner></div> : null}
              <ScreeningAnswersForm profile={lib.profile} onSave={(p) => void lib.updateProfile(p)} />
            </>
          ) : null}
          {view === 'settings' ? (
            <div className="stack">
              <UsageCard />
              <SettingsForm ctl={settingsCtl} />
            </div>
          ) : null}
          {view === 'privacy' ? <Privacy /> : null}
        </main>
      ) : null}
    </div>
  );
}

function UsageCard() {
  const [month, setMonth] = useState<UsageSummary | null>(null);
  const [all, setAll] = useState<UsageSummary | null>(null);
  useEffect(() => {
    const b = bridge();
    if (!b) return;
    void b.invoke('usage.summary', { sinceIso: new Date(Date.now() - 30 * 86400_000).toISOString() }).then(setMonth);
    void b.invoke('usage.summary', {}).then(setAll);
  }, []);
  if (!month || !all) return null;
  const totalIn = (u: UsageSummary) => u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  const share = (u: UsageSummary) => (totalIn(u) ? Math.round((u.cacheReadTokens / totalIn(u)) * 100) : 0);
  return (
    <section className="card stack-sm" aria-labelledby="usage-h">
      <h2 className="section-title" id="usage-h">
        <Icon name="database" /> Claude token usage
      </h2>
      <dl className="kv">
        <dt>Last 30 days</dt>
        <dd>
          {month.calls} request{month.calls === 1 ? '' : 's'} · {totalIn(month).toLocaleString()} input ({share(month)}% read from cache) · {month.outputTokens.toLocaleString()} output
        </dd>
        <dt>All time</dt>
        <dd>
          {all.calls} request{all.calls === 1 ? '' : 's'} · {totalIn(all).toLocaleString()} input ({share(all)}% from cache) · {all.outputTokens.toLocaleString()} output
        </dd>
      </dl>
      <p className="small muted">One request writes the resume and cover letter together, followed by up to two score-improvement requests. Cached input is billed at a fraction of the normal rate; check exact prices on your Anthropic console.</p>
    </section>
  );
}

function Privacy() {
  const [info, setInfo] = useState<{ dataDir: string; dbPath: string } | null>(null);
  useEffect(() => {
    void bridge()?.invoke('app.info').then(setInfo);
  }, []);
  return (
    <div className="stack" style={{ maxWidth: 780 }}>
      <section className="card stack-sm">
        <h2 className="section-title">What stays on this computer</h2>
        <ul className="bullets">
          <li>Everything — work history, verified facts, profile, screening answers, job-site logins, every tailored resume and cover letter (with the JSON it was rendered from), applications, contacts, notes and token usage — is in one SQLite database{info ? <>: <span className="wrap-anywhere strong">{info.dbPath}</span></> : null}.</li>
          <li>Your Claude API key and job-site passwords are encrypted with the operating system’s protection (Windows DPAPI) before they’re stored.</li>
          <li>Documents are saved in your ApplyFlow folder (Settings → Saved documents). Deleting an application doesn’t delete its files.</li>
          <li>Your Dice / Jobright browser session lives only in ApplyFlow’s built-in browser profile, separate from Chrome or Edge.</li>
        </ul>
        <div className="row">
          {info ? (
            <button type="button" className="btn btn-sm" onClick={() => void bridge()?.invoke('files.open', info.dataDir)}>
              <Icon name="folder" size={13} /> Open data folder
            </button>
          ) : null}
          <button type="button" className="btn btn-sm btn-danger" onClick={() => void bridge()?.invoke('dice.clearSession')}>
            Sign out of Dice (clear browser data)
          </button>
        </div>
        <p className="small muted">Back up by copying the data folder while ApplyFlow is closed.</p>
      </section>
      <section className="card stack-sm">
        <h2 className="section-title">What is sent to Claude (only if you add a key)</h2>
        <ul className="bullets">
          <li>Requests go directly from this computer to api.anthropic.com. There is no ApplyFlow server.</li>
          <li>Sent: the job posting (or only its requirements, if you turn off “Send the full job description”) and your confirmed resume facts: name, location, titles, employers, dates, bullets, skills, education and certifications.</li>
          <li>Never sent: email, phone, links, work authorization, salary preferences, saved answers, contacts, notes, or facts marked “Needs review” or “Do not use”.</li>
          <li>Claude returns text only (JSON). The PDF is drawn on this computer by ApplyFlow’s renderer.</li>
        </ul>
      </section>
      <section className="card stack-sm">
        <h2 className="section-title">What ApplyFlow will never do</h2>
        <ul className="bullets">
          <li>Change the employer names and dates you entered. AI-generated descriptions and achievements are drafts you should verify before use.</li>
          <li>Answer sponsorship, work authorization, clearance, criminal history, disability, veteran, demographic, salary, relocation or unclear experience questions.</li>
          <li>Submit an application without your explicit confirmation, or click anything when Dice’s page looks unfamiliar.</li>
          <li>Touch CAPTCHAs, MFA or other multi-factor challenges. Email/password sign-in on job sites uses only credentials you stored in Profile settings.</li>
          <li>Collect analytics or tracking data.</li>
        </ul>
      </section>
      <WarningBanner tone="info">
        ApplyFlow is an independent tool and is not affiliated with, endorsed by, or operated by Dice, Jobright, or the employers’ application sites (Greenhouse, Lever, Ashby…). The match score is an estimate from ApplyFlow’s own transparent factors, not an employer’s ATS score.
      </WarningBanner>
    </div>
  );
}
