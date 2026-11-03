import type { ApplicationRecord, CareerProfile, JobSession, MasterResume, SiteCredential } from '@/types';
import { DEFAULT_SITE_PASSWORD } from '@/types';
import { nowIso } from '@/utils/dates';
import { withSyncedLocation } from '@/utils/address';
import { getDb } from './db';
import { emitChange } from './events';
import { bridge } from '@/platform/bridge';
import { storageGet, storageSet } from './chromeStorage';

const SITE_CREDS_KEY = 'applyflow.siteCredentials.v1';

// In the desktop app every call goes to SQLite through the bridge (`b`); IndexedDB is the
// fallback for unit tests and design previews.

// ---------- Master resumes ----------

export async function listResumes(): Promise<MasterResume[]> {
  const b = bridge();
  if (b) return b.invoke('resumes.list');
  const db = await getDb();
  const all = await db.getAll('resumes');
  return all.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.updatedAt.localeCompare(a.updatedAt));
}

export async function getResume(id: string): Promise<MasterResume | undefined> {
  const b = bridge();
  if (b) return (await b.invoke('resumes.get', id)) ?? undefined;
  return (await getDb()).get('resumes', id);
}

export async function getDefaultResume(): Promise<MasterResume | undefined> {
  const all = await listResumes();
  return all.find((r) => r.isDefault) ?? all[0];
}

export async function saveResume(resume: MasterResume): Promise<MasterResume> {
  const b = bridge();
  if (b) {
    const saved = await b.invoke('resumes.save', resume);
    emitChange('resumes');
    return saved;
  }
  const db = await getDb();
  const existing = await db.getAll('resumes');
  const next = { ...resume, updatedAt: nowIso() };
  if (existing.length === 0) next.isDefault = true;
  const tx = db.transaction('resumes', 'readwrite');
  if (next.isDefault) {
    for (const r of existing) if (r.id !== next.id && r.isDefault) await tx.store.put({ ...r, isDefault: false });
  }
  await tx.store.put(next);
  await tx.done;
  emitChange('resumes');
  return next;
}

export async function setDefaultResume(id: string): Promise<void> {
  const b = bridge();
  if (b) {
    await b.invoke('resumes.setDefault', id);
    emitChange('resumes');
    return;
  }
  const db = await getDb();
  const tx = db.transaction('resumes', 'readwrite');
  for (const r of await tx.store.getAll()) await tx.store.put({ ...r, isDefault: r.id === id });
  await tx.done;
  emitChange('resumes');
}

export async function deleteResume(id: string): Promise<void> {
  const b = bridge();
  if (b) {
    await b.invoke('resumes.delete', id);
    emitChange('resumes');
    return;
  }
  const db = await getDb();
  const target = await db.get('resumes', id);
  await db.delete('resumes', id);
  if (target?.isDefault) {
    const rest = await db.getAll('resumes');
    if (rest[0]) await db.put('resumes', { ...rest[0], isDefault: true });
  }
  emitChange('resumes');
}

// ---------- Career profile ----------

export const EMPTY_PROFILE: CareerProfile = {
  fullName: '',
  email: '',
  phone: '',
  location: '',
  streetAddress: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  headline: '',
  professionalSummary: '',
  verifiedSkills: [],
  workAuthorizationNote: '',
  preferredTitles: [],
  preferredLocations: [],
  remotePreference: 'any',
  salaryPreference: '',
  availability: '',
  portfolioLinks: [],
  linkedinUrl: '',
  githubUrl: '',
  approvedAnswers: [],
  updatedAt: '',
};

export async function getProfile(): Promise<CareerProfile> {
  const b = bridge();
  if (b) return { ...EMPTY_PROFILE, ...((await b.invoke('profile.get')) ?? {}) };
  const p = await (await getDb()).get('profile', 'default');
  return { ...EMPTY_PROFILE, ...(p ?? {}) };
}

export async function saveProfile(profile: CareerProfile): Promise<CareerProfile> {
  const synced = withSyncedLocation(profile);
  const b = bridge();
  if (b) {
    const saved = await b.invoke('profile.save', synced);
    emitChange('profile');
    return saved;
  }
  const next = { ...synced, updatedAt: nowIso() };
  await (await getDb()).put('profile', next, 'default');
  emitChange('profile');
  return next;
}

// ---------- Job-site login credentials ----------

function hostOf(urlOrHost: string): string {
  try {
    return new URL(urlOrHost.includes('://') ? urlOrHost : `https://${urlOrHost}`).hostname.toLowerCase();
  } catch {
    return urlOrHost.replace(/^https?:\/\//i, '').split('/')[0]!.toLowerCase();
  }
}

export async function listSiteCredentials(): Promise<SiteCredential[]> {
  const b = bridge();
  if (b) return b.invoke('siteCredentials.list');
  return (await storageGet<SiteCredential[]>(SITE_CREDS_KEY)) ?? [];
}

export async function getSiteCredential(urlOrHost: string): Promise<SiteCredential | null> {
  const host = hostOf(urlOrHost);
  const b = bridge();
  if (b) return b.invoke('siteCredentials.get', host);
  return (await listSiteCredentials()).find((c) => c.host === host) ?? null;
}

export async function saveSiteCredential(cred: SiteCredential): Promise<SiteCredential> {
  const next: SiteCredential = { ...cred, host: hostOf(cred.host || cred.url), updatedAt: nowIso() };
  const b = bridge();
  if (b) return b.invoke('siteCredentials.save', next);
  const all = (await listSiteCredentials()).filter((c) => c.host !== next.host);
  all.push(next);
  await storageSet(SITE_CREDS_KEY, all);
  return next;
}

export async function deleteSiteCredential(host: string): Promise<void> {
  const h = hostOf(host);
  const b = bridge();
  if (b) {
    await b.invoke('siteCredentials.delete', h);
    return;
  }
  await storageSet(SITE_CREDS_KEY, (await listSiteCredentials()).filter((c) => c.host !== h));
}

/**
 * Return the stored login for this job site, creating one from the profile email and the
 * default password when none exists yet.
 */
export async function ensureSiteCredential(url: string, email: string): Promise<SiteCredential | null> {
  const trimmed = email.trim();
  if (!trimmed) return null;
  const host = hostOf(url);
  if (!host) return null;
  const existing = await getSiteCredential(host);
  if (existing) {
    // Keep email in sync with the profile when the stored email was empty or still the default.
    if (existing.email.trim().toLowerCase() !== trimmed.toLowerCase()) {
      return saveSiteCredential({ ...existing, email: trimmed, url: existing.url || url });
    }
    return existing;
  }
  let origin = url;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = `https://${host}`;
  }
  return saveSiteCredential({ host, url: origin, email: trimmed, password: DEFAULT_SITE_PASSWORD, updatedAt: '' });
}

// ---------- Job sessions (in-progress work per job) ----------

export async function getSession(jobKey: string): Promise<JobSession | undefined> {
  const b = bridge();
  if (b) return (await b.invoke('sessions.get', jobKey)) ?? undefined;
  return (await getDb()).get('sessions', jobKey);
}

export async function saveSession(session: JobSession): Promise<JobSession> {
  const b = bridge();
  if (b) {
    const saved = await b.invoke('sessions.save', session);
    emitChange('sessions');
    return saved;
  }
  const next = { ...session, updatedAt: nowIso() };
  await (await getDb()).put('sessions', next);
  emitChange('sessions');
  return next;
}

/** The most recently updated session (used when Dice's application URL doesn't carry the job ID). */
export async function latestSession(withinMs = 3 * 60 * 60 * 1000): Promise<JobSession | undefined> {
  const b = bridge();
  if (b) return (await b.invoke('sessions.latest', withinMs)) ?? undefined;
  const all = await (await getDb()).getAll('sessions');
  const cutoff = Date.now() - withinMs;
  return all.filter((s) => Date.parse(s.updatedAt) >= cutoff).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export async function deleteSession(jobKey: string): Promise<void> {
  const b = bridge();
  if (b) {
    await b.invoke('sessions.delete', jobKey);
    emitChange('sessions');
    return;
  }
  await (await getDb()).delete('sessions', jobKey);
  emitChange('sessions');
}

// ---------- Application history ----------

export async function listApplications(): Promise<ApplicationRecord[]> {
  const b = bridge();
  if (b) return b.invoke('applications.list');
  const all = await (await getDb()).getAll('applications');
  return all.sort((a, b) => (b.dateApplied ?? b.datePrepared).localeCompare(a.dateApplied ?? a.datePrepared));
}

export async function getApplication(id: string): Promise<ApplicationRecord | undefined> {
  const b = bridge();
  if (b) return (await b.invoke('applications.get', id)) ?? undefined;
  return (await getDb()).get('applications', id);
}

export async function findApplicationsByJobKey(jobKey: string): Promise<ApplicationRecord[]> {
  const b = bridge();
  if (b) return b.invoke('applications.byJobKey', jobKey);
  return (await getDb()).getAllFromIndex('applications', 'jobKey', jobKey);
}

export async function saveApplication(record: ApplicationRecord): Promise<ApplicationRecord> {
  const b = bridge();
  if (b) {
    const saved = await b.invoke('applications.save', record);
    emitChange('applications');
    return saved;
  }
  const next = { ...record, updatedAt: nowIso() };
  await (await getDb()).put('applications', next);
  emitChange('applications');
  return next;
}

export async function deleteApplication(id: string): Promise<void> {
  const b = bridge();
  if (b) {
    await b.invoke('applications.delete', id);
    emitChange('applications');
    return;
  }
  await (await getDb()).delete('applications', id);
  emitChange('applications');
}

export async function importApplications(records: ApplicationRecord[]): Promise<number> {
  const b = bridge();
  if (b) {
    const n = await b.invoke('applications.import', records);
    emitChange('applications');
    return n;
  }
  const db = await getDb();
  const tx = db.transaction('applications', 'readwrite');
  for (const r of records) await tx.store.put(r);
  await tx.done;
  emitChange('applications');
  return records.length;
}
