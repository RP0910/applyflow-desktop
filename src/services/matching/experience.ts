import type { ExperienceEntry } from '@/types';
import { parseResumeDate, totalMonths, findGaps, type DateSpan } from '@/utils/dates';

export function spansOf(entries: Pick<ExperienceEntry, 'startDate' | 'endDate'>[], now = new Date()): DateSpan[] {
  return entries
    .map((e) => ({ start: parseResumeDate(e.startDate, now), end: parseResumeDate(e.endDate || 'present', now) }))
    .filter((s): s is DateSpan => s.start !== null && s.end !== null);
}

export function yearsOfExperience(entries: Pick<ExperienceEntry, 'startDate' | 'endDate'>[], now = new Date()): number {
  return Math.round((totalMonths(spansOf(entries, now)) / 12) * 10) / 10;
}

export function employmentGaps(entries: Pick<ExperienceEntry, 'startDate' | 'endDate'>[], minMonths = 6, now = new Date()) {
  return findGaps(spansOf(entries, now), minMonths);
}
