import { APPLICATION_STAGES, type ApplicationRecord, type ApplicationStage, type HistoryFilters, type JobSession } from '@/types';
import { newId } from '@/utils/id';
import { nowIso, todayLocal } from '@/utils/dates';
import { normalizeJobUrl } from '@/utils/jobKey';
import { similarity } from '@/utils/text';

export const ACTIVE_STAGES: ApplicationStage[] = ['Applied', 'Recruiter Contacted', 'Interview', 'Technical Interview', 'Offer'];

export function recordFromSession(s: JobSession, stage: ApplicationStage, existing?: ApplicationRecord): ApplicationRecord {
  const now = nowIso();
  const base: ApplicationRecord = existing ?? {
    id: newId('app'),
    jobKey: s.jobKey,
    jobId: s.job.jobId,
    jobUrl: s.job.url,
    title: s.job.title,
    company: s.job.company,
    location: s.job.location,
    remoteStatus: s.job.remoteStatus,
    technologies: [],
    salary: s.job.salary,
    stage,
    matchScore: null,
    tailoredScore: null,
    resumeVersion: 0,
    coverLetterVersion: 0,
    resumeFileName: null,
    coverLetterFileName: null,
    keywords: [],
    missingQualifications: [],
    datePrepared: now,
    dateApplied: null,
    followUpDate: null,
    notes: [],
    folderPath: null,
    files: [],
    stageHistory: [],
    createdAt: now,
    updatedAt: now,
  };
  const stageChanged = base.stage !== stage || base.stageHistory.length === 0;
  return {
    ...base,
    title: s.job.title,
    company: s.job.company,
    location: s.job.location,
    remoteStatus: s.job.remoteStatus,
    salary: s.job.salary,
    technologies: (s.analysis?.requiredSkills ?? s.job.requiredSkills).slice(0, 15),
    stage,
    matchScore: s.masterScore?.total ?? base.matchScore,
    tailoredScore: s.tailoredScore?.total ?? base.tailoredScore,
    resumeVersion: s.resume?.version ?? base.resumeVersion,
    coverLetterVersion: s.includeCoverLetter ? s.coverLetter?.version ?? base.coverLetterVersion : 0,
    keywords: (s.analysis?.resumeKeywords ?? []).slice(0, 20),
    missingQualifications: s.analysis?.missingQualifications ?? base.missingQualifications,
    dateApplied: stage === 'Applied' && !base.dateApplied ? now : base.dateApplied,
    stageHistory: stageChanged ? [...base.stageHistory, { stage, at: now }] : base.stageHistory,
    updatedAt: now,
  };
}

export function setStage(r: ApplicationRecord, stage: ApplicationStage): ApplicationRecord {
  if (r.stage === stage) return r;
  const now = nowIso();
  return {
    ...r,
    stage,
    dateApplied: stage === 'Applied' && !r.dateApplied ? now : r.dateApplied,
    stageHistory: [...r.stageHistory, { stage, at: now }],
    updatedAt: now,
  };
}

export function addNote(r: ApplicationRecord, text: string): ApplicationRecord {
  const t = text.trim();
  if (!t) return r;
  return { ...r, notes: [...r.notes, { id: newId('note'), text: t, createdAt: nowIso() }], updatedAt: nowIso() };
}

export function duplicateApplication(r: ApplicationRecord): ApplicationRecord {
  const now = nowIso();
  return {
    ...structuredClone(r),
    id: newId('app'),
    stage: 'Saved',
    dateApplied: null,
    followUpDate: null,
    files: [],
    folderPath: null,
    notes: [{ id: newId('note'), text: `Duplicated from the ${r.stage.toLowerCase()} record created ${r.createdAt.slice(0, 10)}.`, createdAt: now }],
    stageHistory: [{ stage: 'Saved', at: now }],
    createdAt: now,
    updatedAt: now,
  };
}

export interface DuplicateCheck {
  exact: ApplicationRecord | null;
  similar: ApplicationRecord[];
}

export function findDuplicates(records: ApplicationRecord[], jobKey: string, url: string, company: string, title: string, now = new Date()): DuplicateCheck {
  const nUrl = normalizeJobUrl(url);
  const exact = records.find((r) => r.jobKey === jobKey || normalizeJobUrl(r.jobUrl) === nUrl) ?? null;
  const cutoff = now.getTime() - 60 * 86400000;
  const similar = records.filter(
    (r) =>
      r !== exact &&
      r.company.trim().toLowerCase() === company.trim().toLowerCase() &&
      similarity(r.title, title) >= 0.7 &&
      Date.parse(r.createdAt) >= cutoff,
  );
  return { exact, similar };
}

export function hasApplied(r: ApplicationRecord | null): boolean {
  return Boolean(r && (ACTIVE_STAGES.includes(r.stage) || r.stage === 'Rejected' || r.stage === 'Withdrawn' || r.stage === 'No Response' || r.stage === 'Closed Job'));
}

/** Stages ApplyFlow may move to Closed Job when Jobright reports the posting closed. Later outcomes stay as they are until you change them. */
const AUTO_CLOSE_STAGES: ApplicationStage[] = ['Saved', 'Analyzed', 'Resume Ready', 'Ready to Apply', 'Applied', 'No Response'];

export function closeJobRecord(r: ApplicationRecord, opts: { force?: boolean; source?: 'jobright' | 'manual' } = {}): ApplicationRecord | null {
  if (r.stage === 'Closed Job') return null;
  if (!opts.force && !AUTO_CLOSE_STAGES.includes(r.stage)) return null;
  const staged = setStage(r, 'Closed Job');
  const note = opts.source === 'jobright' ? 'Jobright reports this posting is closed.' : 'Marked as a closed job posting.';
  if (staged.notes.some((n) => n.text === note)) return staged;
  return addNote(staged, note);
}

export function isFollowUpDue(r: ApplicationRecord, today = todayLocal()): boolean {
  return Boolean(r.followUpDate && r.followUpDate <= today && ACTIVE_STAGES.includes(r.stage));
}

export function filterApplications(records: ApplicationRecord[], f: HistoryFilters, today = todayLocal()): ApplicationRecord[] {
  const has = (hay: string, needle: string) => !needle.trim() || hay.toLowerCase().includes(needle.trim().toLowerCase());
  return records.filter((r) => {
    if (!has(r.company, f.company)) return false;
    if (!has(r.title, f.title)) return false;
    if (f.technology.trim() && !r.technologies.some((t) => has(t, f.technology)) && !r.keywords.some((t) => has(t, f.technology))) return false;
    if (f.stages.length && !f.stages.includes(r.stage)) return false;
    if (f.remoteStatus !== 'any' && r.remoteStatus !== f.remoteStatus) return false;
    const date = (r.dateApplied ?? r.datePrepared).slice(0, 10);
    if (f.dateFrom && date < f.dateFrom) return false;
    if (f.dateTo && date > f.dateTo) return false;
    const score = r.tailoredScore ?? r.matchScore;
    if (f.minScore !== null && (score === null || score < f.minScore)) return false;
    if (f.maxScore !== null && (score === null || score > f.maxScore)) return false;
    if (f.followUpDue && !isFollowUpDue(r, today)) return false;
    return true;
  });
}

export type SortKey = 'date' | 'company' | 'title' | 'stage' | 'score' | 'followUp';

export function sortApplications(records: ApplicationRecord[], key: SortKey, dir: 'asc' | 'desc'): ApplicationRecord[] {
  const val = (r: ApplicationRecord): string | number => {
    switch (key) {
      case 'company': return r.company.toLowerCase();
      case 'title': return r.title.toLowerCase();
      case 'stage': return APPLICATION_STAGES.indexOf(r.stage);
      case 'score': return r.tailoredScore ?? r.matchScore ?? -1;
      case 'followUp': return r.followUpDate ?? '9999';
      default: return r.dateApplied ?? r.datePrepared;
    }
  };
  const sorted = [...records].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return dir === 'desc' ? sorted.reverse() : sorted;
}

export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_COLUMNS: [string, (r: ApplicationRecord) => unknown][] = [
  ['Application ID', (r) => r.id],
  ['Company', (r) => r.company],
  ['Job title', (r) => r.title],
  ['Location', (r) => r.location],
  ['Remote status', (r) => r.remoteStatus],
  ['Stage', (r) => r.stage],
  ['Date prepared', (r) => r.datePrepared.slice(0, 10)],
  ['Date applied', (r) => r.dateApplied?.slice(0, 10) ?? ''],
  ['Match score (est.)', (r) => r.matchScore ?? ''],
  ['Tailored score (est.)', (r) => r.tailoredScore ?? ''],
  ['Resume version', (r) => r.resumeVersion],
  ['Cover letter version', (r) => r.coverLetterVersion || ''],
  ['Follow-up date', (r) => r.followUpDate ?? ''],
  ['Salary', (r) => r.salary ?? ''],
  ['Technologies', (r) => r.technologies],
  ['Missing qualifications', (r) => r.missingQualifications],
  ['Job URL', (r) => r.jobUrl],
  ['Saved folder', (r) => r.folderPath ?? ''],
  ['Notes', (r) => r.notes.map((n) => n.text)],
];

export function toCsv(records: ApplicationRecord[]): string {
  const header = CSV_COLUMNS.map(([h]) => csvCell(h)).join(',');
  const rows = records.map((r) => CSV_COLUMNS.map(([, f]) => csvCell(f(r))).join(','));
  return `﻿${[header, ...rows].join('\r\n')}\r\n`;
}

export function toJson(records: ApplicationRecord[]): string {
  return JSON.stringify({ exportedBy: 'ApplyFlow for Dice', exportedAt: nowIso(), version: 1, applications: records }, null, 2);
}

export function parseImport(json: string): ApplicationRecord[] {
  const data = JSON.parse(json) as { applications?: unknown };
  const list = Array.isArray(data) ? data : Array.isArray(data.applications) ? data.applications : null;
  if (!list) throw new Error('This file is not an ApplyFlow export.');
  return (list as ApplicationRecord[]).filter((r) => r && typeof r.id === 'string' && typeof r.company === 'string' && APPLICATION_STAGES.includes(r.stage));
}
