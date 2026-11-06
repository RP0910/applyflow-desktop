import { APPLICATION_STAGES, type ApplicationRecord, type ApplicationStage, type ApprovedAnswer } from '@/types';
import { ACTIVE_STAGES } from './history';
import { addDays, todayLocal } from '@/utils/dates';

export type AnalyticsRange = '7d' | '30d' | '90d' | 'all';

const DAY = 86_400_000;

const REPLY_STAGES: ApplicationStage[] = ['Recruiter Contacted', 'Interview', 'Technical Interview', 'Offer', 'Rejected'];
const INTERVIEW_STAGES: ApplicationStage[] = ['Interview', 'Technical Interview', 'Offer'];

export interface RangeBounds {
  startMs: number | null;
  startDay: string | null;
  endDay: string;
}

/** Inclusive local-calendar window ending today. 7 days means today and the six days before it. */
export function rangeBounds(range: AnalyticsRange, now = Date.now()): RangeBounds {
  const endDay = todayLocal(new Date(now));
  if (range === 'all') return { startMs: null, startDay: null, endDay };
  const span = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const startDay = addDays(endDay, -(span - 1));
  return { startMs: new Date(`${startDay}T00:00:00`).getTime(), startDay, endDay };
}

export function rangeStartIso(range: AnalyticsRange, now = Date.now()): string | null {
  const { startMs } = rangeBounds(range, now);
  return startMs == null ? null : new Date(startMs).toISOString();
}

/** Calendar day for a stored timestamp. Date-only values stay on that day; instants use local time. */
export function localDay(iso: string | null | undefined): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 10);
  return todayLocal(new Date(t));
}

function activityDay(r: ApplicationRecord): string {
  return localDay(r.dateApplied || r.datePrepared || r.createdAt);
}

function touchDay(r: ApplicationRecord): string {
  return localDay(r.updatedAt || r.dateApplied || r.datePrepared || r.createdAt);
}

function dayIn(day: string, startDay: string | null, endDay: string): boolean {
  if (!day) return false;
  if (day > endDay) return false;
  if (!startDay) return true;
  return day >= startDay;
}

export function inRange(r: ApplicationRecord, sinceIso: string | null, now = Date.now()): boolean {
  const endDay = todayLocal(new Date(now));
  const startDay = sinceIso ? todayLocal(new Date(sinceIso)) : null;
  return dayIn(activityDay(r), startDay, endDay);
}

export interface StageCount {
  stage: ApplicationStage;
  count: number;
}

export interface NameCount {
  name: string;
  count: number;
  hint?: string;
}

export interface ActivityBucket {
  key: string;
  label: string;
  prepared: number;
  applied: number;
  current: boolean;
}

export interface FunnelStep {
  name: string;
  count: number;
  /** Percent of the previous step. Null on the first step. */
  rate: number | null;
}

export interface AttentionItem {
  id: string;
  company: string;
  title: string;
  stage: ApplicationStage;
  reason: string;
  when: string;
}

export interface AnalyticsSnapshot {
  range: AnalyticsRange;
  asOf: string;
  rangeStart: string | null;
  rangeEnd: string;
  total: number;
  inRange: number;
  applied: number;
  appliedToday: number;
  appliedThisWeek: number;
  appliedPrev: number;
  preparedOnly: number;
  activePipeline: number;
  waiting: number;
  staleWaiting: number;
  medianDaysWaiting: number | null;
  interviews: number;
  offers: number;
  replies: number;
  rejected: number;
  closedJobs: number;
  closedTotal: number;
  responseRate: number | null;
  avgMatch: number | null;
  avgTailored: number | null;
  followUpsDue: number;
  followUpsOverdue: number;
  byStage: StageCount[];
  funnel: FunnelStep[];
  topCompanies: NameCount[];
  remoteMix: NameCount[];
  activity: ActivityBucket[];
  activityUnit: 'day' | 'week';
  recent: ApplicationRecord[];
  attention: AttentionItem[];
  insights: string[];
  screeningAnswers: number;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime();
  return Math.round(ms / DAY);
}

function weekStart(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return todayLocal(d);
}

function shortDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function wasSubmitted(r: ApplicationRecord): boolean {
  return Boolean(r.dateApplied) || ACTIVE_STAGES.includes(r.stage) || r.stage === 'Rejected' || r.stage === 'Withdrawn' || r.stage === 'No Response';
}

function isReply(r: ApplicationRecord): boolean {
  return REPLY_STAGES.includes(r.stage);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function stageEventDay(r: ApplicationRecord, stage: ApplicationStage): string | null {
  const hits = r.stageHistory.filter((h) => h.stage === stage);
  const last = hits[hits.length - 1];
  if (last) return localDay(last.at);
  if (r.stage === stage) return localDay(r.updatedAt || r.datePrepared);
  return null;
}

function buildActivity(records: ApplicationRecord[], startDay: string, endDay: string, unit: 'day' | 'week'): ActivityBucket[] {
  const buckets: ActivityBucket[] = [];
  if (unit === 'day') {
    for (let day = startDay; day <= endDay; day = addDays(day, 1)) {
      buckets.push({ key: day, label: day === endDay ? 'Today' : shortDay(day), prepared: 0, applied: 0, current: day === endDay });
    }
  } else {
    for (let week = weekStart(startDay); week <= endDay; week = addDays(week, 7)) {
      const current = week === weekStart(endDay);
      buckets.push({
        key: week,
        label: current ? 'Today' : shortDay(week),
        prepared: 0,
        applied: 0,
        current,
      });
    }
  }
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  const bucketKey = (day: string) => (unit === 'day' ? day : weekStart(day));
  for (const r of records) {
    const prepared = localDay(r.datePrepared || r.createdAt);
    if (prepared >= startDay && prepared <= endDay) {
      const b = index.get(bucketKey(prepared));
      if (b != null) buckets[b]!.prepared += 1;
    }
    if (r.dateApplied) {
      const applied = localDay(r.dateApplied);
      if (applied >= startDay && applied <= endDay) {
        const b = index.get(bucketKey(applied));
        if (b != null) buckets[b]!.applied += 1;
      }
    }
  }
  return buckets;
}

function buildInsights(s: {
  applied: number;
  appliedToday: number;
  appliedPrev: number;
  span: number;
  waiting: number;
  staleWaiting: number;
  replies: number;
  responseRate: number | null;
  followUpsOverdue: number;
  closedJobs: number;
}): string[] {
  const lines: string[] = [];
  if (s.appliedToday) lines.push(`${plural(s.appliedToday, 'application')} recorded today.`);
  if (s.followUpsOverdue) lines.push(`${plural(s.followUpsOverdue, 'follow-up')} overdue.`);
  if (s.waiting) {
    lines.push(
      s.staleWaiting
        ? `${plural(s.waiting, 'application')} still waiting on a reply, ${s.staleWaiting} for 14 days or more.`
        : `${plural(s.waiting, 'application')} still waiting on a reply.`,
    );
  }
  if (s.applied && s.replies === 0) lines.push(`No replies yet on ${plural(s.applied, 'application')} in this period.`);
  else if (s.applied && s.responseRate != null) lines.push(`${s.responseRate}% of applications in this period received a reply.`);
  if (s.closedJobs) lines.push(`${plural(s.closedJobs, 'posting')} marked Closed Job in this period.`);
  if (s.span && (s.applied || s.appliedPrev)) {
    const diff = s.applied - s.appliedPrev;
    const window = plural(s.span, 'day');
    if (diff === 0) lines.push(`This period matches the previous ${window}.`);
    else if (diff > 0) lines.push(`This period has ${plural(diff, 'more application')} than the previous ${window}.`);
    else lines.push(`This period has ${plural(-diff, 'fewer application')} than the previous ${window}.`);
  }
  return lines.slice(0, 4);
}

export function buildAnalytics(
  records: ApplicationRecord[],
  opts: { range?: AnalyticsRange; answers?: ApprovedAnswer[]; now?: number } = {},
): AnalyticsSnapshot {
  const range = opts.range ?? '30d';
  const now = opts.now ?? Date.now();
  const bounds = rangeBounds(range, now);
  const { startDay, endDay } = bounds;
  const today = endDay;
  const weekOfToday = weekStart(today);

  const volume = records.filter((r) => dayIn(activityDay(r), startDay, endDay));
  const appliedRows = volume.filter((r) => wasSubmitted(r) && (!r.dateApplied || dayIn(localDay(r.dateApplied), startDay, endDay)));
  const replies = volume.filter(isReply);
  const waitingRows = volume.filter((r) => r.stage === 'Applied');
  const waitingAges = waitingRows
    .map((r) => (r.dateApplied ? daysBetween(localDay(r.dateApplied), today) : null))
    .filter((n): n is number => n != null && n >= 0);
  const staleWaiting = waitingAges.filter((n) => n >= 14).length;

  const span = startDay ? daysBetween(startDay, endDay) + 1 : 0;
  const prevEnd = startDay ? addDays(startDay, -1) : null;
  const prevStart = prevEnd && span ? addDays(prevEnd, -(span - 1)) : null;
  const appliedPrev = prevStart && prevEnd
    ? records.filter((r) => r.dateApplied && dayIn(localDay(r.dateApplied), prevStart, prevEnd)).length
    : 0;

  const closedJobs = records.filter((r) => {
    const day = stageEventDay(r, 'Closed Job');
    return Boolean(day && dayIn(day, startDay, endDay));
  }).length;

  const byStageMap = new Map<ApplicationStage, number>();
  for (const r of records) byStageMap.set(r.stage, (byStageMap.get(r.stage) ?? 0) + 1);
  const byStage = APPLICATION_STAGES.filter((stage) => byStageMap.has(stage)).map((stage) => ({ stage, count: byStageMap.get(stage)! }));

  const applied = appliedRows.length;
  const responseRate = applied ? Math.round((replies.length / applied) * 100) : null;
  const prepared = volume.length;
  const funnelCounts = [
    ['Prepared', prepared],
    ['Applied', applied],
    ['Heard back', replies.length],
    ['Interview', volume.filter((r) => INTERVIEW_STAGES.includes(r.stage)).length],
    ['Offer', volume.filter((r) => r.stage === 'Offer').length],
  ] as const;
  const funnel: FunnelStep[] = funnelCounts.map(([name, count], i) => {
    const prev = i === 0 ? null : funnelCounts[i - 1]![1];
    return { name, count, rate: prev ? Math.round((count / prev) * 100) : null };
  });

  const companyMap = new Map<string, { total: number; applied: number; replied: number }>();
  for (const r of volume) {
    const name = r.company.trim() || 'Unknown company';
    const row = companyMap.get(name) ?? { total: 0, applied: 0, replied: 0 };
    row.total += 1;
    if (wasSubmitted(r)) row.applied += 1;
    if (isReply(r)) row.replied += 1;
    companyMap.set(name, row);
  }
  const topCompanies: NameCount[] = [...companyMap.entries()]
    .map(([name, row]) => ({
      name,
      count: row.total,
      hint: row.applied ? `${row.replied} repl${row.replied === 1 ? 'y' : 'ies'}` : 'Prepared only',
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 8);

  const remoteMix: NameCount[] = (() => {
    const map = new Map<string, number>();
    for (const r of volume) {
      const name = r.remoteStatus === 'unknown' ? 'Unspecified' : r.remoteStatus[0]!.toUpperCase() + r.remoteStatus.slice(1);
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  })();

  const activityStart = startDay ?? weekStart(
    records.reduce((min, r) => {
      const day = activityDay(r);
      return day && day < min ? day : min;
    }, endDay),
  );
  const activityUnit: 'day' | 'week' = startDay && span <= 31 ? 'day' : 'week';

  const recent = [...records]
    .filter((r) => dayIn(activityDay(r), startDay, endDay) || dayIn(touchDay(r), startDay, endDay))
    .sort((a, b) => (b.updatedAt || activityDay(b)).localeCompare(a.updatedAt || activityDay(a)))
    .slice(0, 8);

  const attention: AttentionItem[] = [];
  for (const r of records) {
    if (r.followUpDate && r.followUpDate <= today && ACTIVE_STAGES.includes(r.stage)) {
      attention.push({
        id: r.id,
        company: r.company || 'Unknown company',
        title: r.title || 'Untitled role',
        stage: r.stage,
        reason: r.followUpDate < today ? `Follow-up overdue since ${shortDay(r.followUpDate)}` : 'Follow-up due today',
        when: r.followUpDate < today ? r.followUpDate : `${r.followUpDate}~`,
      });
    }
  }
  for (const r of records) {
    if (r.stage !== 'Applied' || !r.dateApplied) continue;
    const age = daysBetween(localDay(r.dateApplied), today);
    if (age < 14) continue;
    if (attention.some((item) => item.id === r.id)) continue;
    attention.push({
      id: r.id,
      company: r.company || 'Unknown company',
      title: r.title || 'Untitled role',
      stage: r.stage,
      reason: `Waiting ${age} days with no reply`,
      when: r.dateApplied,
    });
  }
  attention.sort((a, b) => a.when.localeCompare(b.when));

  const followUps = records.filter((r) => r.followUpDate);
  const insights = buildInsights({
    applied,
    appliedToday: records.filter((r) => r.dateApplied && localDay(r.dateApplied) === today).length,
    appliedPrev,
    span,
    waiting: waitingRows.length,
    staleWaiting,
    replies: replies.length,
    responseRate,
    followUpsOverdue: followUps.filter((r) => r.followUpDate! < today && ACTIVE_STAGES.includes(r.stage)).length,
    closedJobs,
  });

  return {
    range,
    asOf: new Date(now).toISOString(),
    rangeStart: startDay,
    rangeEnd: endDay,
    total: records.length,
    inRange: volume.length,
    applied,
    appliedToday: records.filter((r) => r.dateApplied && localDay(r.dateApplied) === today).length,
    appliedThisWeek: records.filter((r) => r.dateApplied && localDay(r.dateApplied) >= weekOfToday && localDay(r.dateApplied) <= today).length,
    appliedPrev,
    preparedOnly: Math.max(0, volume.length - applied),
    activePipeline: records.filter((r) => ACTIVE_STAGES.includes(r.stage)).length,
    waiting: waitingRows.length,
    staleWaiting,
    medianDaysWaiting: median(waitingAges),
    interviews: volume.filter((r) => r.stage === 'Interview' || r.stage === 'Technical Interview').length,
    offers: volume.filter((r) => r.stage === 'Offer').length,
    replies: replies.length,
    rejected: volume.filter((r) => r.stage === 'Rejected').length,
    closedJobs,
    closedTotal: records.filter((r) => r.stage === 'Closed Job').length,
    responseRate,
    avgMatch: avg(volume.map((r) => r.matchScore).filter((n): n is number => n != null)),
    avgTailored: avg(volume.map((r) => r.tailoredScore).filter((n): n is number => n != null)),
    followUpsDue: followUps.filter((r) => r.followUpDate! >= today).length,
    followUpsOverdue: followUps.filter((r) => r.followUpDate! < today && ACTIVE_STAGES.includes(r.stage)).length,
    byStage,
    funnel,
    topCompanies,
    remoteMix,
    activity: buildActivity(records, activityStart, endDay, activityUnit),
    activityUnit,
    recent,
    attention: attention.slice(0, 6),
    insights,
    screeningAnswers: opts.answers?.length ?? 0,
  };
}
