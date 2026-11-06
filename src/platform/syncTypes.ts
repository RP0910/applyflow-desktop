/** Types shared by the Data Management screen and the main-process sync engine. */

export type SyncEntity = 'applications' | 'contacts' | 'documents' | 'sessions' | 'companyResearch' | 'resumes' | 'profile' | 'usage';

export interface EntityCounts {
  /** Records that did not exist here and were added. */
  added: number;
  /** Existing records that received newer or missing information. */
  updated: number;
  /** Records recognised as the same item under a different identifier and combined. */
  merged: number;
  /** Records already identical here. */
  unchanged: number;
  /** Records ignored: older than this device's copy, deleted here, or invalid. */
  skipped: number;
  /** Records removed here because they were deleted on the other device. */
  deleted: number;
  /** Records where both devices changed the same thing; the resolution is in `conflicts`. */
  conflicts: number;
}

export interface SyncConflict {
  entity: SyncEntity;
  id: string;
  label: string;
  field: string | null;
  local: string | null;
  incoming: string | null;
  resolution: string;
}

export interface FileCounts {
  added: number;
  reused: number;
  renamed: number;
  missing: number;
  skipped: number;
}

export interface SyncReport {
  entities: Record<SyncEntity, EntityCounts>;
  files: FileCounts;
  conflicts: SyncConflict[];
  warnings: string[];
  settingsApplied: boolean;
}

export interface SyncSourceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  appVersion: string;
  schemaVersion: number;
  exportedAt: string;
  encrypted: boolean;
  sameDevice: boolean;
  counts: Record<string, number>;
}

export interface SyncProgress {
  op: 'export' | 'inspect' | 'import' | 'backup' | 'restore';
  step: string;
  done: number;
  total: number;
}

export interface SyncExportResult {
  path: string;
  bytes: number;
  counts: Record<string, number>;
  files: number;
  missingFiles: number;
  encrypted: boolean;
}

export type SyncInspectResult =
  | { status: 'password-required'; path: string; message?: string }
  | { status: 'error'; path: string; message: string }
  | { status: 'ready'; path: string; token: string; source: SyncSourceInfo; report: SyncReport; hasSettings: boolean };

export interface SyncImportResult {
  report: SyncReport;
  backup: SyncBackupInfo;
  logPath: string | null;
}

export interface SyncBackupInfo {
  name: string;
  path: string;
  createdAt: string;
  bytes: number;
  reason: string;
}

export interface SyncLogEntry {
  id: number;
  at: string;
  kind: 'export' | 'import' | 'backup' | 'restore';
  ok: boolean;
  file: string | null;
  peer: string | null;
  summary: string;
  logPath: string | null;
  error: string | null;
}

export function emptyCounts(): EntityCounts {
  return { added: 0, updated: 0, merged: 0, unchanged: 0, skipped: 0, deleted: 0, conflicts: 0 };
}

export function emptyReport(): SyncReport {
  const entities = {} as Record<SyncEntity, EntityCounts>;
  for (const e of ['applications', 'contacts', 'documents', 'sessions', 'companyResearch', 'resumes', 'profile', 'usage'] as SyncEntity[]) entities[e] = emptyCounts();
  return { entities, files: { added: 0, reused: 0, renamed: 0, missing: 0, skipped: 0 }, conflicts: [], warnings: [], settingsApplied: false };
}
