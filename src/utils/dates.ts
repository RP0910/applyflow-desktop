export function nowIso(): string {
  return new Date().toISOString();
}

/** Local calendar date, YYYY-MM-DD. */
export function todayLocal(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + days);
  return todayLocal(d);
}

export function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse resume-style dates: "Jan 2020", "January 2020", "01/2020", "2020", "Present".
 * Returns months since year 0, or null.
 */
export function parseResumeDate(s: string, now: Date = new Date()): number | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (/^(present|current|now|today|ongoing)$/.test(t)) return now.getFullYear() * 12 + now.getMonth();
  let m = t.match(/^([a-z]{3,9})\.?\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[1]!.slice(0, 4) === 'sept' ? 'sept' : m[1]!.slice(0, 3)];
    if (mon !== undefined) return Number(m[2]) * 12 + mon;
  }
  m = t.match(/^(\d{1,2})[/\-.](\d{4})$/);
  if (m) return Number(m[2]) * 12 + Math.min(11, Math.max(0, Number(m[1]) - 1));
  m = t.match(/^(\d{4})[/\-.](\d{1,2})$/);
  if (m) return Number(m[1]) * 12 + Math.min(11, Math.max(0, Number(m[2]) - 1));
  m = t.match(/^(\d{4})$/);
  if (m) return Number(m[1]) * 12;
  return null;
}

export interface DateSpan {
  start: number;
  end: number;
}

/** Total distinct months covered by spans (overlaps counted once). */
export function totalMonths(spans: DateSpan[]): number {
  const sorted = spans.filter((s) => s.end >= s.start).sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const s of sorted) {
    if (s.start > curEnd) {
      if (curEnd >= curStart && curStart >= 0) total += curEnd - curStart + 1;
      curStart = s.start;
      curEnd = s.end;
    } else {
      curEnd = Math.max(curEnd, s.end);
    }
  }
  if (curStart >= 0) total += curEnd - curStart + 1;
  return total;
}

/** Gaps between employment spans, in months, longer than minMonths. */
export function findGaps(spans: DateSpan[], minMonths: number): { afterEnd: number; beforeStart: number; months: number }[] {
  const sorted = spans.filter((s) => s.end >= s.start).sort((a, b) => a.start - b.start);
  const gaps: { afterEnd: number; beforeStart: number; months: number }[] = [];
  let maxEnd = -Infinity;
  for (const s of sorted) {
    if (maxEnd !== -Infinity && s.start - maxEnd - 1 >= minMonths) {
      gaps.push({ afterEnd: maxEnd, beforeStart: s.start, months: s.start - maxEnd - 1 });
    }
    maxEnd = Math.max(maxEnd, s.end);
  }
  return gaps;
}
