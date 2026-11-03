import type { ApplicationRecord, ApplicationStage, ApprovedAnswer } from '@/types';
import { ACTIVE_STAGES } from './history';
import { todayLocal } from '@/utils/dates';

export type AnalyticsRange = '7d' | '30d' | '90d' | 'all';

const DAY = 86_400_000;

export function rangeStartIso(range: AnalyticsRange, now = Date.now()): string | null {
  if (range === 'all') return null;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return new Date(now - days * DAY).toISOString();
}

function activityDate(r: ApplicationRecord): string {
  return r.dateApplied || r.datePrepared || r.createdAt;
}

export function inRange(r: ApplicationRecord, sinceIso: string | null): boolean {
  if (!sinceIso) return true;
  return activityDate(r) >= sinceIso;
}

export interface StageCount {
  stage: ApplicationStage;
  count: number;
}

export interface NameCount {
  name: string;
  count: number;
}

export interface WeekBucket {
  /** Monday YYYY-MM-DD of the week. */
  week: string;
  label: string;
  prepared: number;
  applied: number;
}

export interface AnalyticsSnapshot {
  range: AnalyticsRange;
  total: number;
  inRange: number;
  applied: number;
  preparedOnly: number;
  activePipeline: number;
  interviews: number;
  offers: number;
  rejected: number;
  responseRate: number | null;
  avgMatch: number | null;
  avgTailored: number | null;
  followUpsDue: number;
  followUpsOverdue: number;
  byStage: StageCount[];
  topCompanies: NameCount[];
  topTitles: NameCount[];
  remoteMix: NameCount[];
  weekly: WeekBucket[];
  recent: ApplicationRecord[];
  screeningAnswers: number;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function countBy<T>(items: T[], key: (t: T) => string, limit = 8): NameCount[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const k = key(item).trim() || '—';
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function mondayOf(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Mon=0
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekLabel(monday: string): string {
  const d = new Date(`${monday}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function buildWeekly(rows: ApplicationRecord[], sinceIso: string | null, now = Date.now()): WeekBucket[] {
  const start = sinceIso ? mondayOf(new Date(sinceIso)) : mondayOf(new Date(now - 84 * DAY));
  const end = mondayOf(new Date(now));
  const buckets = new Map<string, WeekBucket>();
  for (let t = start.getTime(); t <= end.getTime(); t += 7 * DAY) {
    const week = isoDay(new Date(t));
    buckets.set(week, { week, label: weekLabel(week), prepared: 0, applied: 0 });
  }
  for (const r of rows) {
    const preparedWeek = isoDay(mondayOf(new Date(r.datePrepared || r.createdAt)));
    const bPrep = buckets.get(preparedWeek);
    if (bPrep) bPrep.prepared += 1;
    if (r.dateApplied) {
      const appliedWeek = isoDay(mondayOf(new Date(r.dateApplied)));
      const bApp = buckets.get(appliedWeek);
      if (bApp) bApp.applied += 1;
    }
  }
  return [...buckets.values()];
}

const INTERVIEW_STAGES: ApplicationStage[] = ['Interview', 'Technical Interview'];
const RESPONSE_STAGES: ApplicationStage[] = ['Recruiter Contacted', 'Interview', 'Technical Interview', 'Offer', 'Rejected', 'No Response'];

export function buildAnalytics(
  records: ApplicationRecord[],
  opts: { range?: AnalyticsRange; answers?: ApprovedAnswer[]; now?: number } = {},
): AnalyticsSnapshot {
  const range = opts.range ?? '30d';
  const now = opts.now ?? Date.now();
  const since = rangeStartIso(range, now);
  const rows = records.filter((r) => inRange(r, since));
  const appliedRows = rows.filter((r) => Boolean(r.dateApplied) || ACTIVE_STAGES.includes(r.stage) || r.stage === 'Rejected' || r.stage === 'Withdrawn' || r.stage === 'No Response');
  const today = todayLocal();

  const byStageMap = new Map<ApplicationStage, number>();
  for (const r of rows) byStageMap.set(r.stage, (byStageMap.get(r.stage) ?? 0) + 1);
  const byStage = [...byStageMap.entries()]
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count);

  const interviews = rows.filter((r) => INTERVIEW_STAGES.includes(r.stage)).length;
  const offers = rows.filter((r) => r.stage === 'Offer').length;
  const rejected = rows.filter((r) => r.stage === 'Rejected' || r.stage === 'No Response').length;
  const responded = rows.filter((r) => RESPONSE_STAGES.includes(r.stage)).length;
  const applied = appliedRows.length;
  const responseRate = applied ? Math.round((responded / applied) * 100) : null;

  const followUps = records.filter((r) => r.followUpDate);
  const followUpsDue = followUps.filter((r) => r.followUpDate! >= today).length;
  const followUpsOverdue = followUps.filter((r) => r.followUpDate! < today && ACTIVE_STAGES.includes(r.stage)).length;

  return {
    range,
    total: records.length,
    inRange: rows.length,
    applied,
    preparedOnly: rows.length - applied,
    activePipeline: records.filter((r) => ACTIVE_STAGES.includes(r.stage)).length,
    interviews,
    offers,
    rejected,
    responseRate,
    avgMatch: avg(rows.map((r) => r.matchScore).filter((n): n is number => n != null)),
    avgTailored: avg(rows.map((r) => r.tailoredScore).filter((n): n is number => n != null)),
    followUpsDue,
    followUpsOverdue,
    byStage,
    topCompanies: countBy(rows, (r) => r.company || 'Unknown company'),
    topTitles: countBy(rows, (r) => r.title || 'Untitled'),
    remoteMix: countBy(rows, (r) => (r.remoteStatus === 'unknown' ? 'Unspecified' : r.remoteStatus[0]!.toUpperCase() + r.remoteStatus.slice(1))),
    weekly: buildWeekly(rows, since, now),
    recent: [...rows].sort((a, b) => activityDate(b).localeCompare(activityDate(a))).slice(0, 8),
    screeningAnswers: opts.answers?.length ?? 0,
  };
}
