import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ApplicationRecord, CareerProfile, JobSession, MasterResume } from '@/types';

interface ApplyFlowDB extends DBSchema {
  resumes: { key: string; value: MasterResume };
  profile: { key: string; value: CareerProfile };
  sessions: { key: string; value: JobSession; indexes: { updatedAt: string } };
  applications: {
    key: string;
    value: ApplicationRecord;
    indexes: { jobKey: string; stage: string; updatedAt: string };
  };
}

const DB_NAME = 'applyflow';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ApplyFlowDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<ApplyFlowDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ApplyFlowDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('resumes')) db.createObjectStore('resumes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile');
        if (!db.objectStoreNames.contains('sessions')) {
          const s = db.createObjectStore('sessions', { keyPath: 'jobKey' });
          s.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('applications')) {
          const a = db.createObjectStore('applications', { keyPath: 'id' });
          a.createIndex('jobKey', 'jobKey');
          a.createIndex('stage', 'stage');
          a.createIndex('updatedAt', 'updatedAt');
        }
      },
    });
  }
  return dbPromise;
}

/** Test helper: drop the cached connection so a fresh fake-indexeddb can be used. */
export async function __resetDb(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
  }
  dbPromise = null;
}
