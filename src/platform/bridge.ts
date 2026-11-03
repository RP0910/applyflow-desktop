/**
 * The desktop bridge: the only way the ApplyFlow window talks to the Electron main process
 * (SQLite database, files on disk, the built-in Dice browser, reminders).
 *
 * `window.applyflow` is exposed by electron/preload.ts. When it is missing (unit tests, or the
 * UI opened in a plain browser for design work) every caller falls back to in-memory or
 * IndexedDB behaviour, so the same React code runs everywhere.
 */
import type { ApplicationRecord, CareerProfile, JobSession, MasterResume } from '@/types';
import type { ContentEvent, ContentResponseMap, PanelToContent } from '@/types/messages';

/** Every IPC method the main process answers. Arguments and results are structured-clone safe. */
export interface BridgeMethods {
  // key/value settings (non-secret)
  'kv.get': (key: string) => unknown;
  'kv.set': (key: string, value: unknown) => void;
  'kv.remove': (key: string) => void;
  // the Claude API key — encrypted at rest with the OS keychain (Electron safeStorage)
  'secret.get': () => string | null;
  'secret.set': (value: string) => void;
  'secret.remove': () => void;
  // master resumes
  'resumes.list': () => MasterResume[];
  'resumes.get': (id: string) => MasterResume | null;
  'resumes.save': (r: MasterResume) => MasterResume;
  'resumes.setDefault': (id: string) => void;
  'resumes.delete': (id: string) => void;
  // profile
  'profile.get': () => CareerProfile | null;
  'profile.save': (p: CareerProfile) => CareerProfile;
  // job sessions
  'sessions.get': (jobKey: string) => JobSession | null;
  'sessions.save': (s: JobSession) => JobSession;
  'sessions.latest': (withinMs: number) => JobSession | null;
  'sessions.delete': (jobKey: string) => void;
  // applications
  'applications.list': () => ApplicationRecord[];
  'applications.get': (id: string) => ApplicationRecord | null;
  'applications.byJobKey': (jobKey: string) => ApplicationRecord[];
  'applications.save': (r: ApplicationRecord) => ApplicationRecord;
  'applications.delete': (id: string) => void;
  'applications.import': (rs: ApplicationRecord[]) => number;
  // search ("who is calling?")
  'search.query': (q: string, limit?: number) => SearchHit[];
  // generated documents (every version is kept, with its JSON)
  'documents.upsert': (d: StoredDocumentInput) => StoredDocument;
  'documents.list': (filter: { applicationId?: string; jobKey?: string }) => StoredDocument[];
  'documents.get': (id: string) => StoredDocument | null;
  'documents.markSent': (applicationId: string, jobKey: string, versions?: { resume?: number | null; cover_letter?: number | null }) => void;
  // contacts per application (recruiter names, phones, emails)
  'contacts.list': (applicationId: string) => Contact[];
  'contacts.save': (c: Contact) => Contact;
  'contacts.delete': (id: string) => void;
  // Claude token usage
  'usage.add': (u: UsageInput) => void;
  'usage.summary': (filter: { jobKey?: string; sinceIso?: string }) => UsageSummary;
  // files on disk (paths are relative to the save location unless noted)
  'files.write': (f: { relativePath: string; bytes: Uint8Array; conflict: 'overwrite' | 'uniquify' }) => { absolutePath: string };
  'files.read': (absolutePath: string) => Uint8Array | null;
  'files.exists': (absolutePath: string) => boolean;
  'files.show': (absolutePath: string) => boolean;
  'files.open': (absolutePath: string) => string;
  'files.saveAs': (f: { defaultName: string; bytes: Uint8Array; filters?: { name: string; extensions: string[] }[] }) => string | null;
  'files.pickOpen': (f: { filters?: { name: string; extensions: string[] }[] }) => { name: string; bytes: Uint8Array } | null;
  'files.pickFolder': () => string | null;
  'files.baseDir': () => string;
  // the built-in Dice browser
  'dice.send': (msg: PanelToContent) => unknown;
  'dice.setBounds': (b: { x: number; y: number; width: number; height: number }) => void;
  'dice.setVisible': (visible: boolean) => void;
  'dice.navigate': (url: string) => void;
  'dice.back': () => void;
  /** Back to the last Dice search-results page (or Dice's job search when there was none). */
  'dice.backToSearch': () => void;
  'dice.forward': () => void;
  'dice.reload': () => void;
  'dice.state': () => BrowserState;
  'dice.clearSession': () => void;
  // reminders and app
  'reminders.set': (r: { applicationId: string; whenIso: string; label: string }) => void;
  'reminders.clear': (applicationId: string) => void;
  'app.info': () => { version: string; dataDir: string; dbPath: string; platform: string };
  'app.openExternal': (url: string) => void;
}

export type BridgeMethod = keyof BridgeMethods;

/** Events the main process pushes to the window. */
export interface BridgeEvents {
  'dice:event': ContentEvent | { type: 'AF_LAUNCHER_CLICKED' };
  'dice:state': BrowserState;
  'app:navigate': { view: DesktopView; focus?: string | null; search?: boolean };
}

export type DesktopView = 'apply' | 'applications' | 'library' | 'profile' | 'studio' | 'settings' | 'privacy';

export interface BrowserState {
  url: string;
  title: string;
  /** The last Dice search-results page, if any. */
  searchUrl?: string | null;
  /** The current page is a Dice search-results page. */
  onSearch?: boolean;
  /** The current page is Dice's application wizard or its confirmation. */
  onApplication?: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  ready: boolean;
}

export interface SearchHit {
  application: ApplicationRecord;
  /** Where the match was found. */
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
  /** 'job posting' when found in the posting automatically, 'you' when typed. */
  source: 'job posting' | 'you';
  createdAt: string;
}

export interface StoredDocumentInput {
  applicationId: string | null;
  jobKey: string;
  kind: 'resume' | 'cover_letter';
  version: number;
  /** The ResumeDocument JSON (applyflow.resume/1) the PDF was rendered from. */
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

/** The bridge, or null outside the desktop app. */
export function bridge(): ApplyFlowBridge | null {
  return typeof window !== 'undefined' && window.applyflow ? window.applyflow : null;
}

export const isDesktop = (): boolean => bridge() !== null;

/** Desktop: return the built-in browser to your last Dice search results (e.g. after applying). */
export async function backToDiceSearch(): Promise<void> {
  await bridge()?.invoke('dice.backToSearch');
}

/** The single built-in browser plays the role of the extension's "tab". */
export const DICE_TAB_ID = 1;

export type { ContentResponseMap };
