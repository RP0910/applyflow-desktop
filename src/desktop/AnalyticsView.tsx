import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApplicationRecord, ApplicationStage } from '@/types';
import { bridge, type UsageSummary } from '@/platform/bridge';
import { useHistory } from '@/hooks/useHistory';
import { useLibrary } from '@/hooks/useLibrary';
import { buildAnalytics, rangeStartIso, type ActivityBucket, type AnalyticsRange } from '@/services/history/analytics';
import { Icon } from '@/components/Icon';
import { WarningBanner } from '@/components/WarningBanner';
import { formatDisplayDate } from '@/utils/dates';

const RANGES: { id: AnalyticsRange; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'all', label: 'All time' },
];

function stageTone(stage: ApplicationStage): string {
  if (['Interview', 'Technical Interview', 'Offer', 'Recruiter Contacted'].includes(stage)) return 'chip-green';
  if (stage === 'Closed Job') return 'chip-amber';
  if (['Rejected', 'Withdrawn', 'No Response'].includes(stage)) return 'chip-red';
  if (stage === 'Applied') return 'chip-blue';
  return '';
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (iso.length === 10) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

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

function BarList({ items, max }: { items: { name: string; count: number; tone?: string; hint?: string }[]; max: number }) {
  if (!items.length) return <p className="small muted">Nothing in this period yet.</p>;
  return (
    <ul className="analytics-bars list-plain">
      {items.map((item) => (
        <li key={item.name}>
          <div className="analytics-bar-meta">
            <span className="analytics-bar-name" title={item.name}>
              {item.name}
            </span>
            <span className="analytics-bar-extra">
              {item.hint ? <span className="small muted">{item.hint}</span> : null}
              <span className={`chip${item.tone ? ` ${item.tone}` : ''}`}>{item.count}</span>
            </span>
          </div>
          <div className="analytics-bar-track" aria-hidden="true">
            <div className="analytics-bar-fill" style={{ width: `${max ? Math.max(6, Math.round((item.count / max) * 100)) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivityChart({ buckets, unit }: { buckets: ActivityBucket[]; unit: 'day' | 'week' }) {
  const scroller = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...buckets.map((w) => Math.max(w.prepared, w.applied)));
  const endKey = buckets.at(-1)?.key ?? '';
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [endKey, buckets.length]);
  if (!buckets.length) return <p className="small muted">No activity yet.</p>;
  const labelEvery = buckets.length <= 10 ? 1 : Math.ceil(buckets.length / 6);
  return (
    <div ref={scroller} className={`analytics-week${buckets.length > 14 ? ' dense' : ''}`} role="img" aria-label={unit === 'day' ? 'Applications prepared and applied by day, through today' : 'Applications prepared and applied by week, through today'}>
      {buckets.map((w, i) => {
        const showLabel = w.current || i === 0 || i % labelEvery === 0;
        return (
          <div key={w.key} className={`analytics-week-col${w.current ? ' current' : ''}`}>
            <div className="analytics-week-bars">
              <div className={`analytics-week-bar prepared${w.current ? ' current' : ''}`} style={{ height: `${Math.round((w.prepared / max) * 100)}%` }} title={`${w.key}: ${w.prepared} prepared`} />
              <div className={`analytics-week-bar applied${w.current ? ' current' : ''}`} style={{ height: `${Math.round((w.applied / max) * 100)}%` }} title={`${w.key}: ${w.applied} applied`} />
            </div>
            <span className="analytics-week-label">{showLabel ? w.label : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

function GoTo({ id, onOpen }: { id: string; onOpen?: (id: string) => void }) {
  if (!onOpen) return null;
  return (
    <button type="button" className="btn btn-sm btn-outline analytics-go" onClick={() => onOpen(id)}>
      Go to this application
    </button>
  );
}

export function AnalyticsView({ onOpenApplication }: { onOpenApplication?: (id: string) => void }) {
  const history = useHistory();
  const lib = useLibrary();
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const stats = useMemo(
    () => buildAnalytics(history.records, { range, answers: lib.profile.approvedAnswers, now }),
    [history.records, range, lib.profile.approvedAnswers, now],
  );

  useEffect(() => {
    const b = bridge();
    if (!b) return;
    const sinceIso = rangeStartIso(range, now);
    void b.invoke('usage.summary', sinceIso ? { sinceIso } : {}).then(setUsage);
  }, [range, stats.rangeStart]);

  const stageMax = Math.max(1, ...stats.byStage.map((s) => s.count));
  const companyMax = Math.max(1, ...stats.topCompanies.map((c) => c.count));
  const funnelMax = Math.max(1, ...stats.funnel.map((s) => s.count));
  const tokenIn = usage ? usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens : 0;
  const asOf = new Date(stats.asOf).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const appliedHint = [
    stats.appliedToday ? `${stats.appliedToday} today` : null,
    `${stats.appliedThisWeek} this week`,
    stats.preparedOnly ? `${stats.preparedOnly} prepared only` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const waitingHint = stats.medianDaysWaiting != null
    ? `Median ${stats.medianDaysWaiting} days${stats.staleWaiting ? ` · ${stats.staleWaiting} at 14+ days` : ''}`
    : 'Applied, no reply yet';

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
        <p className="analytics-asof">Through {asOf}</p>
      </div>

      {!history.records.length ? (
        <WarningBanner tone="info">No applications stored yet. Tailor &amp; Apply on a job and your activity will show up here.</WarningBanner>
      ) : null}

      {stats.insights.length ? (
        <section className="card" aria-label="What stands out">
          <ul className="analytics-insights">
            {stats.insights.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="analytics-stats" aria-label="Key metrics">
        <Stat label="Applied" value={stats.applied} tone="good" hint={appliedHint || `${stats.inRange} in this period`} />
        <Stat label="Waiting on a reply" value={stats.waiting} tone={stats.staleWaiting ? 'warn' : 'default'} hint={waitingHint} />
        <Stat label="Active pipeline" value={stats.activePipeline} hint="Applied through offer, all tracked" />
        <Stat label="Interviews" value={stats.interviews} tone={stats.interviews ? 'good' : 'muted'} hint="In this period" />
        <Stat label="Offers" value={stats.offers} tone={stats.offers ? 'good' : 'muted'} hint="In this period" />
        <Stat label="Reply rate" value={stats.responseRate == null ? '—' : `${stats.responseRate}%`} hint="Recruiter, interview, offer, or rejection" />
        <Stat
          label="Follow-ups"
          value={stats.followUpsOverdue ? stats.followUpsOverdue : stats.followUpsDue}
          tone={stats.followUpsOverdue ? 'warn' : 'default'}
          hint={stats.followUpsOverdue ? `${stats.followUpsOverdue} overdue · ${stats.followUpsDue} upcoming` : stats.followUpsDue ? 'Upcoming reminders' : 'None set'}
        />
        <Stat
          label="Closed jobs"
          value={stats.closedJobs}
          tone={stats.closedJobs ? 'warn' : 'muted'}
          hint={stats.closedTotal ? `${stats.closedTotal} tracked in total` : 'Postings Jobright closed'}
        />
      </section>

      <div className="analytics-grid">
        <section className="card stack-sm" aria-labelledby="an-week">
          <h2 className="section-title" id="an-week">
            <Icon name="history" /> {stats.activityUnit === 'day' ? 'Daily activity' : 'Weekly activity'}
          </h2>
          <p className="section-sub">
            <span className="analytics-legend"><i className="prepared" /> Prepared</span>
            <span className="analytics-legend"><i className="applied" /> Applied</span>
            <span className="small muted">
              {stats.activityUnit === 'day'
                ? `Each bar is a day, from ${formatDisplayDate(stats.rangeStart)} through today.`
                : 'Each bar is a week starting Monday. The last bar is this week, through now.'}
            </span>
          </p>
          <ActivityChart buckets={stats.activity} unit={stats.activityUnit} />
        </section>

        <section className="card stack-sm" aria-labelledby="an-funnel">
          <h2 className="section-title" id="an-funnel">
            <Icon name="target" /> Outcome funnel
          </h2>
          <p className="section-sub">How applications in this period moved forward. Percents are the share of the previous step.</p>
          <BarList
            items={stats.funnel.map((s) => ({
              name: s.name,
              count: s.count,
              hint: s.rate == null ? undefined : `${s.rate}%`,
              tone: s.name === 'Offer' || s.name === 'Interview' ? 'chip-green' : s.name === 'Heard back' ? 'chip-blue' : '',
            }))}
            max={funnelMax}
          />
          <p className="small muted">
            Average match {stats.avgMatch == null ? '—' : stats.avgMatch}
            {stats.avgTailored != null ? ` · tailored ${stats.avgTailored}` : ''}. A reply is a recruiter contact, interview, offer, or rejection.
          </p>
        </section>

        <section className="card stack-sm" aria-labelledby="an-attn">
          <h2 className="section-title" id="an-attn">
            <Icon name="bell" /> Needs attention
          </h2>
          <p className="section-sub">Overdue follow-ups and applications still at Applied after 14 days.</p>
          {stats.attention.length ? (
            <ul className="list-plain analytics-recent">
              {stats.attention.map((item) => (
                <li key={item.id} className="analytics-recent-row">
                  <div>
                    <div className="strong">{item.company}</div>
                    <div className="small muted wrap-anywhere">{item.title}</div>
                    <div className="small">{item.reason}</div>
                  </div>
                  <div className="analytics-recent-meta">
                    <span className={`chip ${stageTone(item.stage)}`}>{item.stage}</span>
                    <GoTo id={item.id} onOpen={onOpenApplication} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Nothing is overdue, and no application has been waiting 14 days.</p>
          )}
        </section>

        <section className="card stack-sm" aria-labelledby="an-pipe">
          <h2 className="section-title" id="an-pipe">
            <Icon name="briefcase" /> Current pipeline
          </h2>
          <p className="section-sub">Latest stage of every tracked application, including ones outside this period.</p>
          <BarList items={stats.byStage.map((s) => ({ name: s.stage, count: s.count, tone: stageTone(s.stage) }))} max={stageMax} />
        </section>

        <section className="card stack-sm" aria-labelledby="an-co">
          <h2 className="section-title" id="an-co">
            <Icon name="building" /> Companies
          </h2>
          <p className="section-sub">Roles in this period. The note is how many of the submitted ones received a reply.</p>
          <BarList items={stats.topCompanies} max={companyMax} />
        </section>

        <section className="card stack-sm" aria-labelledby="an-remote">
          <h2 className="section-title" id="an-remote">
            <Icon name="globe" /> Work arrangement
          </h2>
          <BarList items={stats.remoteMix} max={Math.max(1, ...stats.remoteMix.map((r) => r.count))} />
        </section>
      </div>

      <section className="card stack-sm" aria-labelledby="an-recent">
        <h2 className="section-title" id="an-recent">
          <Icon name="history" /> Latest updates
        </h2>
        <p className="section-sub">Newest prepare, apply, or stage change in this period, with the time it was saved.</p>
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
                  <span className="small muted">{formatWhen(r.updatedAt || r.dateApplied || r.datePrepared)}</span>
                  <GoTo id={r.id} onOpen={onOpenApplication} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No activity in this range.</p>
        )}
      </section>

      <p className="small muted">
        {stats.screeningAnswers} screening answers saved on this computer.
        {usage
          ? ` Claude usage in this range: ${usage.calls} request${usage.calls === 1 ? '' : 's'}, ${tokenIn.toLocaleString()} input tokens, ${usage.outputTokens.toLocaleString()} output tokens.`
          : ''}
        {' '}Counts include everything saved through the current minute.
      </p>
    </div>
  );
}
