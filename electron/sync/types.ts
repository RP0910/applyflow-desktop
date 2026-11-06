import type { ApplicationRecord, CareerProfile, JobSession, MasterResume, SavedFile } from '../../src/types';
import type { Contact, StoredDocument } from '../../src/platform/bridge';
import type { AppClock } from './clock';

export type TombstoneEntity = 'application' | 'contact' | 'resume' | 'session';

export interface Tombstone {
  entity: TombstoneEntity;
  id: string;
  /** Secondary key (the job key) so a deleted job is not re-added under another device's identifier. */
  matchKey: string | null;
  deletedAt: string;
}

export interface Alias {
  entity: 'application' | 'resume';
  from: string;
  to: string;
}

/** A saved file as it travels in an export: the content hash replaces the device-specific absolute path. */
export interface SyncSavedFile extends SavedFile {
  sha256?: string | null;
}

export interface AppEntry {
  record: ApplicationRecord;
  clock: AppClock | null;
  syncedAt: string | null;
}

export interface ContactRow extends Contact {
  updatedAt: string;
}

export interface DocRow extends StoredDocument {
  fileSha256?: string | null;
  fileRelativePath?: string | null;
}

export interface ResearchRow {
  jobKey: string;
  data: unknown;
  updatedAt: string;
}

export interface ResumeRow {
  resume: Omit<MasterResume, 'sourceData'>;
  sourceSha256: string | null;
}

export interface UsageRow {
  gid: string;
  jobKey: string | null;
  applicationId: string | null;
  task: string;
  model: string;
  inputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  outputTokens: number;
  at: string;
}

/** Everything that is synchronised. Used for this device's state and for the contents of an export. */
export interface Snapshot {
  deviceId: string;
  applications: AppEntry[];
  contacts: ContactRow[];
  documents: DocRow[];
  sessions: JobSession[];
  companyResearch: ResearchRow[];
  resumes: ResumeRow[];
  profile: CareerProfile | null;
  usage: UsageRow[];
  kv: Record<string, unknown>;
  tombstones: Tombstone[];
  aliases: Alias[];
}

export const SETTINGS_KEY = 'applyflow.settings.v1';
export const REMINDERS_KEY = 'applyflow.reminders';
export const POSTING_MARKER_PREFIX = 'contacts.fromPosting.';
/** Settings that describe this computer rather than the user's preferences. */
export const DEVICE_SETTINGS = ['saveLocation', 'availableModels', 'modelsRefreshedAt'] as const;
