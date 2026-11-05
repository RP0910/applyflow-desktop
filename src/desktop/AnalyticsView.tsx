import { useEffect, useMemo, useState } from 'react';
import type { ApplicationRecord, ApplicationStage } from '@/types';
import { bridge, type UsageSummary } from '@/platform/bridge';
import { useHistory } from '@/hooks/useHistory';
import { useLibrary } from '@/hooks/useLibrary';
import { ACTIVE_STAGES } from '@/services/history/history';
import { buildAnalytics, type AnalyticsRange } from '@/services/history/analytics';
import { Icon } from '@/components/Icon';
import { WarningBanner } from '@/components/WarningBanner';

const RANGES: { id: AnalyticsRange; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'all', label: 'All time' },
];

function stageTone(stage: ApplicationStage): string {
  if (['Interview', 'Technical Interview', 'Offer', 'Recruiter Contacted'].includes(stage)) return 'chip-green';
  if (['Rejected', 'Withdrawn', 'No Response'].includes(stage)) return 'chip-red';
  if (stage === 'Applied') return 'chip-blue';
  return '';
}

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'muted';
}) {
  return (
    <div className={`analytics-stat${tone && tone !== 'default' ? ` analytics-stat-${tone}` : ''}`}>
      <div className="analytics-stat-value">{value}</div>
      <div className="analytics-stat-label">{label}</div>
      {hint ? <div className="analytics-stat-hint">{hint}</div> : null}
    </div>
  );
}

function BarList({ items, max }: { items: { name: string; count: number; tone?: string }[]; max: number }) {
  if (!items.length) return <p className="small muted">Nothing in this period yet.</p>;
  return (
    <ul className="analytics-bars list-plain">
      {items.map((item) => (
        <li key={item.name}>
          <div className="analytics-bar-meta">
            <span className="analytics-bar-name" title={item.name}>
              {item.name}
            </span>
            <span className={`chip${item.tone ? ` ${item.tone}` : ''}`}>{item.count}</span>
          </div>
          <div className="analytics-bar-track" aria-hidden="true">
            <div className="analytics-bar-fill" style={{ width: `${max ? Math.max(6, Math.round((item.count / max) * 100)) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function WeekChart({ weeks }: { weeks: { label: string; prepared: number; applied: number }[] }) {
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.prepared, w.applied)));
  if (!weeks.length) return <p className="small muted">No weekly activity yet.</p>;
  return (
    <div className="analytics-week" role="img" aria-label="Applications prepared and applied by week">
      {weeks.map((w) => (
        <div key={w.label + w.prepared + w.applied} className="analytics-week-col">
          <div className="analytics-week-bars">
            <div className="analytics-week-bar prepared" style={{ height: `${Math.round((w.prepared / max) * 100)}%` }} title={`${w.prepared} prepared`} />
            <div className="analytics-week-bar applied" style={{ height: `${Math.round((w.applied / max) * 100)}%` }} title={`${w.applied} applied`} />
          </div>
          <span className="analytics-week-label">{w.label}</span>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsView({ onOpenApplications }: { onOpenApplications?: () => void }) {
  const history = useHistory();
  const lib = useLibrary();
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  const stats = useMemo(
    () => buildAnalytics(history.records, { range, answers: lib.profile.approvedAnswers }),
    [history.records, range, lib.profile.approvedAnswers],
  );

  useEffect(() => {
    const b = bridge();
    if (!b) return;
    const sinceIso = range === 'all' ? undefined : new Date(Date.now() - (range === '7d' ? 7 : range === '30d' ? 30 : 90) * 86_400_000).toISOString();
    void b.invoke('usage.summary', sinceIso ? { sinceIso } : {}).then(setUsage);
  }, [range]);

  const stageMax = Math.max(1, ...stats.byStage.map((s) => s.count));
  const companyMax = Math.max(1, ...stats.topCompanies.map((c) => c.count));
  const tokenIn = usage ? usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens : 0;

  return (
    <div className="analytics stack">
      <div className="analytics-toolbar row-between">
        <div className="chip-row" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.id} type="button" className={`chip chip-toggle${range === r.id ? ' chip-blue' : ''}`} aria-pressed={range === r.id} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        {onOpenApplications ? (
          <button type="button" className="btn btn-sm" onClick={onOpenApplications}>
            <Icon name="briefcase" size={13} /> Open applications
          </button>
        ) : null}
      </div>

      {!history.records.length ? (
        <WarningBanner tone="info">No applications stored yet. Tailor &amp; Apply on a job and your activity will show up here.</WarningBanner>
      ) : null}

      <section className="analytics-stats" aria-label="Key metrics">
        <Stat label="In this period" value={stats.inRange} hint={`${stats.total} total tracked`} />
        <Stat label="Applied" value={stats.applied} tone="good" hint={stats.preparedOnly ? `${stats.preparedOnly} prepared only` : undefined} />
        <Stat label="Active pipeline" value={stats.activePipeline} hint="Applied through offer" />
        <Stat label="Interviews" value={stats.interviews} tone={stats.interviews ? 'good' : 'muted'} />
        <Stat label="Offers" value={stats.offers} tone={stats.offers ? 'good' : 'muted'} />
        <Stat label="Response rate" value={stats.responseRate == null ? '—' : `${stats.responseRate}%`} hint="Of applied roles with a later stage" />
        <Stat label="Avg match" value={stats.avgMatch == null ? '—' : stats.avgMatch} hint={stats.avgTailored != null ? `Tailored ${stats.avgTailored}` : 'From job analysis'} />
        <Stat
          label="Follow-ups"
          value={stats.followUpsOverdue ? stats.followUpsOverdue : stats.followUpsDue}
          tone={stats.followUpsOverdue ? 'warn' : 'default'}
          hint={stats.followUpsOverdue ? `${stats.followUpsOverdue} overdue · ${stats.followUpsDue} upcoming` : stats.followUpsDue ? 'Upcoming reminders' : 'None set'}
        />
      </section>

      <div className="analytics-grid">
        <section className="card stack-sm" aria-labelledby="an-week">
          <h2 className="section-title" id="an-week">
            <Icon name="history" /> Weekly activity
          </h2>
          <p className="section-sub">
            <span className="analytics-legend"><i className="prepared" /> Prepared</span>
            <span className="analytics-legend"><i className="applied" /> Applied</span>
          </p>
          <WeekChart weeks={stats.weekly} />
        </section>

        <section className="card stack-sm" aria-labelledby="an-pipe">
          <h2 className="section-title" id="an-pipe">
            <Icon name="target" /> Pipeline by stage
          </h2>
          <BarList items={stats.byStage.map((s) => ({ name: s.stage, count: s.count, tone: stageTone(s.stage) }))} max={stageMax} />
        </section>

        <section className="card stack-sm" aria-labelledby="an-co">
          <h2 className="section-title" id="an-co">
            <Icon name="building" /> Top companies
          </h2>
          <BarList items={stats.topCompanies} max={companyMax} />
        </section>

        <section className="card stack-sm" aria-labelledby="an-remote">
          <h2 className="section-title" id="an-remote">
            <Icon name="globe" /> Work arrangement
          </h2>
          <BarList items={stats.remoteMix} max={Math.max(1, ...stats.remoteMix.map((r) => r.count))} />
          <h3 className="analytics-subhead">Frequent titles</h3>
          <ul className="list-plain stack-sm">
            {stats.topTitles.length ? (
              stats.topTitles.slice(0, 5).map((t) => (
                <li key={t.name} className="row-between small">
                  <span className="wrap-anywhere">{t.name}</span>
                  <span className="chip">{t.count}</span>
                </li>
              ))
            ) : (
              <li className="small muted">No titles yet.</li>
            )}
          </ul>
        </section>
      </div>

      <div className="analytics-grid analytics-grid-2">
        <section className="card stack-sm" aria-labelledby="an-recent">
          <h2 className="section-title" id="an-recent">
            <Icon name="briefcase" /> Recent activity
          </h2>
          {stats.recent.length ? (
            <ul className="list-plain analytics-recent">
              {stats.recent.map((r: ApplicationRecord) => (
                <li key={r.id} className="analytics-recent-row">
                  <div>
                    <div className="strong">{r.company || '—'}</div>
                    <div className="small muted wrap-anywhere">{r.title || 'Untitled role'}</div>
                  </div>
                  <div className="analytics-recent-meta">
                    <span className={`chip ${stageTone(r.stage)}`}>{r.stage}</span>
                    <span className="small muted">{fmtDate(r.dateApplied || r.datePrepared)}</span>
                    {ACTIVE_STAGES.includes(r.stage) && r.followUpDate ? <span className="small">Follow-up {fmtDate(r.followUpDate)}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">No activity in this range.</p>
          )}
        </section>

        <section className="card stack-sm" aria-labelledby="an-extras">
          <h2 className="section-title" id="an-extras">
            <Icon name="database" /> Library &amp; usage
          </h2>
          <dl className="kv">
            <dt>Screening answers</dt>
            <dd>{stats.screeningAnswers} saved for reuse</dd>
            <dt>Job site logins</dt>
            <dd>Managed in Profile settings</dd>
            <dt>Claude requests</dt>
            <dd>{usage ? `${usage.calls} in this range` : '—'}</dd>
            <dt>Tokens (input)</dt>
            <dd>{usage ? tokenIn.toLocaleString() : '—'}</dd>
            <dt>Tokens (output)</dt>
            <dd>{usage ? usage.outputTokens.toLocaleString() : '—'}</dd>
          </dl>
          <p className="small muted">All figures stay on this computer. Claude usage is only counted when you use an API key.</p>
        </section>
      </div>
    </div>
  );
}
