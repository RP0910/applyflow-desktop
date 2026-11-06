import type { CompanyResearchReply } from '@/prompts/companyResearch';
import type { ApplicationRecord, CareerProfile, JobSession, MasterResume, SiteCredential } from '@/types';
import type { ContentEvent, ContentResponseMap, PanelToContent } from '@/types/messages';
import type { SyncBackupInfo, SyncExportResult, SyncImportResult, SyncInspectResult, SyncLogEntry, SyncProgress } from './syncTypes';

export interface BridgeMethods {
  'kv.get': (key: string) => unknown;
  'kv.set': (key: string, value: unknown) => void;
  'kv.remove': (key: string) => void;
  'secret.get': () => string | null;
  'secret.set': (value: string) => void;
  'secret.remove': () => void;
  'resumes.list': () => MasterResume[];
  'resumes.get': (id: string) => MasterResume | null;
  'resumes.save': (r: MasterResume) => MasterResume;
  'resumes.setDefault': (id: string) => void;
  'resumes.delete': (id: string) => void;
  'profile.get': () => CareerProfile | null;
  'profile.save': (p: CareerProfile) => CareerProfile;
  'siteCredentials.list': () => SiteCredential[];
  'siteCredentials.get': (host: string) => SiteCredential | null;
  'siteCredentials.save': (c: SiteCredential) => SiteCredential;
  'siteCredentials.delete': (host: string) => void;
  'sessions.get': (jobKey: string) => JobSession | null;
  'sessions.save': (s: JobSession) => JobSession;
  'sessions.latest': (withinMs: number) => JobSession | null;
  'sessions.delete': (jobKey: string) => void;
  'companyResearch.get': (jobKey: string) => CompanyResearchReply | null;
  'companyResearch.save': (payload: { jobKey: string; research: CompanyResearchReply }) => CompanyResearchReply;
  'applications.list': () => ApplicationRecord[];
  'applications.get': (id: string) => ApplicationRecord | null;
  'applications.byJobKey': (jobKey: string) => ApplicationRecord[];
  'applications.save': (r: ApplicationRecord) => ApplicationRecord;
  'applications.delete': (id: string) => void;
  'applications.import': (rs: ApplicationRecord[]) => number;
  'search.query': (q: string, limit?: number) => SearchHit[];
  'documents.upsert': (d: StoredDocumentInput) => StoredDocument;
  'documents.list': (filter: { applicationId?: string; jobKey?: string }) => StoredDocument[];
  'documents.get': (id: string) => StoredDocument | null;
  'documents.markSent': (applicationId: string, jobKey: string, versions?: { resume?: number | null; cover_letter?: number | null }) => void;
  'contacts.list': (applicationId: string) => Contact[];
  'contacts.save': (c: Contact) => Contact;
  'contacts.delete': (id: string) => void;
  'usage.add': (u: UsageInput) => void;
  'usage.summary': (filter: { jobKey?: string; sinceIso?: string }) => UsageSummary;
  'files.write': (f: { relativePath: string; bytes: Uint8Array; conflict: 'overwrite' | 'uniquify' }) => { absolutePath: string };
  'files.read': (absolutePath: string) => Uint8Array | null;
  'files.exists': (absolutePath: string) => boolean;
  'files.show': (absolutePath: string) => boolean;
  'files.open': (absolutePath: string) => string;
  'files.saveAs': (f: { defaultName: string; bytes: Uint8Array; filters?: { name: string; extensions: string[] }[] }) => string | null;
  'files.pickOpen': (f: { filters?: { name: string; extensions: string[] }[] }) => { name: string; bytes: Uint8Array } | null;
  'files.pickFolder': () => string | null;
  'files.baseDir': () => string;
  'dice.send': (msg: PanelToContent) => unknown;
  'dice.setBounds': (b: { x: number; y: number; width: number; height: number }) => void;
  'dice.setVisible': (visible: boolean) => void;
  'dice.navigate': (url: string) => void;
  'dice.back': () => void;
  'dice.backToSearch': () => void;
  'dice.forward': () => void;
  'dice.reload': () => void;
  'dice.state': () => BrowserState;
  'dice.clearSession': () => void;
  'browser.state': () => BrowserTabsState;
  'browser.newTab': (url?: string) => number;
  'browser.closeTab': (id: number) => void;
  'browser.activate': (id: number) => void;
  'browser.navigate': (id: number, input: string) => void;
  'browser.back': (id: number) => void;
  'browser.forward': (id: number) => void;
  'browser.reload': (id: number) => void;
  'browser.stop': (id: number) => void;
  'browser.retryCheck': (id: number) => void;
  'browser.openExternal': (id: number) => boolean;
  'browser.resetSession': () => void;
  'browser.diagnostics': () => BrowserDiagnosticsReport;
  'reminders.set': (r: { applicationId: string; whenIso: string; label: string }) => void;
  'reminders.clear': (applicationId: string) => void;
  'sync.export': (opts: { password?: string | null }) => SyncExportResult | null;
  'sync.pickImport': () => string | null;
  'sync.inspect': (req: { path: string; password?: string | null }) => SyncInspectResult;
  'sync.apply': (req: { token: string; applySettings: boolean }) => SyncImportResult;
  'sync.discard': (token: string) => void;
  'sync.history': () => SyncLogEntry[];
  'sync.backups': () => SyncBackupInfo[];
  'sync.backupNow': () => SyncBackupInfo;
  'sync.restore': (name: string) => { restored: SyncBackupInfo; safetyBackup: SyncBackupInfo };
  'app.info': () => { version: string; dataDir: string; dbPath: string; platform: string };
  'app.openExternal': (url: string) => void;
  'claudeChat.status': () => ClaudeChatStatus;
  'claudeChat.open': () => void;
  'claudeChat.signOut': () => void;
  'claudeChat.complete': (req: ClaudeChatCompleteRequest) => ClaudeChatCompleteResult;
  'claudeChat.cancel': (requestId: string) => void;
}

export type BridgeMethod = keyof BridgeMethods;

export interface BridgeEvents {
  'dice:event': ContentEvent | { type: 'AF_LAUNCHER_CLICKED' };
  'dice:state': BrowserState;
  'browser:tabs': BrowserTabsState;
  'app:navigate': { view: DesktopView; focus?: string | null; search?: boolean };
  'claudeChat:status': ClaudeChatStatus;
  'sync:progress': SyncProgress;
}

export type ClaudeChatState = 'checking' | 'connecting' | 'ready' | 'signed_out' | 'error';

export interface ClaudeChatStatus {
  state: ClaudeChatState;
  detail: string;
  checkedAt: string | null;
}

export interface ClaudeChatCompleteRequest {
  requestId: string;
  prompt: string;
  title: string;
  timeoutMs: number;
  /** Model id from Settings. Applied when a Claude.ai chat is created. */
  model?: string;
  /** Display name from Settings, used to match Claude.ai’s model menu. */
  modelName?: string;
  /** Speed from Settings. `model_default` leaves Claude.ai’s effort unchanged. */
  effort?: 'low' | 'medium' | 'high' | 'model_default';
}

export type ClaudeChatCompleteResult =
  | { ok: true; text: string; model: string; renamed: boolean }
  | { ok: false; code: 'signed_out' | 'challenge' | 'timeout' | 'empty' | 'input' | 'cancelled' | 'limit'; detail: string };

export type DesktopView = 'apply' | 'applications' | 'analytics' | 'library' | 'profile' | 'answers' | 'studio' | 'settings' | 'privacy';

export interface BrowserState {
  url: string;
  title: string;
  searchUrl?: string | null;
  onSearch?: boolean;
  onApplication?: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  ready: boolean;
}

export interface BrowserTab {
  id: number;
  kind: 'jobs' | 'web';
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  challenge: boolean;
  challengeLoop: boolean;
  error: { code: number; description: string; url: string } | null;
  crashed: boolean;
}

export interface BrowserTabsState {
  activeId: number;
  jobsId: number;
  tabs: BrowserTab[];
}

export type BrowserDiagnosticKind =
  | 'navigation-error'
  | 'http-error'
  | 'resource-error'
  | 'renderer-gone'
  | 'unresponsive'
  | 'redirect-loop'
  | 'navigation-loop'
  | 'challenge'
  | 'challenge-loop'
  | 'popup-opened'
  | 'popup-blocked'
  | 'permission-denied'
  | 'session-reset'
  | 'reply-unread'
  | 'chat-failed';

export interface BrowserDiagnosticEvent {
  at: string;
  partition: string;
  source: string;
  kind: BrowserDiagnosticKind;
  url?: string;
  status?: number;
  code?: number;
  detail?: string;
}

export interface BrowserPartitionReport {
  partition: string;
  persistent: boolean;
  cookies: number;
  sites: number;
  clearanceSites: string[];
}

export interface BrowserDiagnosticsReport {
  electron: string;
  chromium: string;
  userAgent: string;
  partitions: BrowserPartitionReport[];
  events: BrowserDiagnosticEvent[];
}

export interface SearchHit {
  application: ApplicationRecord;
  matchedOn: Array<'phone' | 'email' | 'company' | 'title' | 'contact' | 'text'>;
  snippet: string | null;
  contacts: Contact[];
}

export interface Contact {
  id: string;
  applicationId: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  source: 'job posting' | 'you';
  createdAt: string;
}

export interface StoredDocumentInput {
  applicationId: string | null;
  jobKey: string;
  kind: 'resume' | 'cover_letter';
  version: number;
  json: string;
  engine: string | null;
  model: string | null;
  filePath?: string | null;
  format?: string | null;
}

export interface StoredDocument extends StoredDocumentInput {
  id: string;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UsageInput {
  jobKey: string | null;
  applicationId: string | null;
  task: string;
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export interface UsageSummary {
  calls: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export interface ApplyFlowBridge {
  invoke<M extends BridgeMethod>(method: M, ...args: Parameters<BridgeMethods[M]>): Promise<ReturnType<BridgeMethods[M]>>;
  on<E extends keyof BridgeEvents>(event: E, cb: (payload: BridgeEvents[E]) => void): () => void;
}

declare global {
  interface Window {
    applyflow?: ApplyFlowBridge;
  }
}

export function bridge(): ApplyFlowBridge | null {
  return typeof window !== 'undefined' && window.applyflow ? window.applyflow : null;
}

export const isDesktop = (): boolean => bridge() !== null;

export async function backToDiceSearch(): Promise<void> {
  await bridge()?.invoke('dice.backToSearch');
}

export const DICE_TAB_ID = 1;

export type { ContentResponseMap };
