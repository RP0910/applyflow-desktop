import type { RemoteStatus } from './job';

export const APPLICATION_STAGES = [
  'Saved',
  'Analyzed',
  'Resume Ready',
  'Ready to Apply',
  'Applied',
  'Recruiter Contacted',
  'Interview',
  'Technical Interview',
  'Offer',
  'Rejected',
  'Withdrawn',
  'No Response',
] as const;

export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export interface ApplicationNote {
  id: string;
  text: string;
  createdAt: string;
}

export interface SavedFile {
  kind: 'resume' | 'cover_letter' | 'resume_json' | 'job_description' | 'metadata' | 'job_url';
  format: string;
  /** Path relative to the save folder (Documents by default). */
  relativePath: string;
  /** Desktop app: where the file is on disk. */
  absolutePath?: string | null;
  downloadId: number | null;
  state: 'pending' | 'complete' | 'failed';
  error?: string;
}

export interface ApplicationRecord {
  id: string;
  jobKey: string;
  jobId: string | null;
  jobUrl: string;
  title: string;
  company: string;
  location: string;
  remoteStatus: RemoteStatus;
  technologies: string[];
  salary: string | null;
  stage: ApplicationStage;
  matchScore: number | null;
  tailoredScore: number | null;
  resumeVersion: number;
  coverLetterVersion: number;
  resumeFileName: string | null;
  coverLetterFileName: string | null;
  keywords: string[];
  missingQualifications: string[];
  datePrepared: string;
  dateApplied: string | null;
  followUpDate: string | null;
  notes: ApplicationNote[];
  folderPath: string | null;
  files: SavedFile[];
  /** Stage changes over time, newest last. */
  stageHistory: { stage: ApplicationStage; at: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface HistoryFilters {
  company: string;
  title: string;
  technology: string;
  stages: ApplicationStage[];
  remoteStatus: RemoteStatus | 'any';
  dateFrom: string;
  dateTo: string;
  minScore: number | null;
  maxScore: number | null;
  followUpDue: boolean;
}

export const EMPTY_FILTERS: HistoryFilters = {
  company: '',
  title: '',
  technology: '',
  stages: [],
  remoteStatus: 'any',
  dateFrom: '',
  dateTo: '',
  minScore: null,
  maxScore: null,
  followUpDue: false,
};
