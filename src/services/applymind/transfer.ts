import { createHash } from 'node:crypto';
import { COLD_START, FRESHNESS_DAYS } from './constants';
import type { AnswerContext, AnswerStatus, Provenance } from './types';

/** Section schema. A higher number is refused by this version. */
export const APPLYMIND_SCHEMA = 1;

export class ApplyMindSectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplyMindSectionError';
  }
}

export interface KnowledgeRecord {
  id: string;
  sourceAnswerId: string | null;
  deviceId: string;
  patternId: string;
  originalQuestion: string;
  normalizedQuestion: string;
  category: string;
  questionType: string;
  options: string[];
  answer: string;
  status: AnswerStatus;
  provenance: Provenance;
  context: AnswerContext;
  platform: string | null;
  answeredAt: string;
  confirmedAt: string;
  freshnessDays: number | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeHistory {
  id: string;
  recordId: string;
  at: string;
  deviceId: string;
  action: string;
  status: string;
  answer: string;
}

export interface KnowledgeFact {
  id: string;
  factKey: string;
  kind: string;
  label: string;
  country: string | null;
  sourceAnswerId: string | null;
  freshnessDays: number | null;
  confirmedAt: string;
  deviceId: string;
  value: string;
}

export interface KnowledgeTombstone {
  id: string;
  sourceAnswerId: string | null;
  patternId: string | null;
  deletedAt: string;
  deviceId: string;
}

export interface KnowledgeReview {
  id: string;
  kind: 'review' | 'conflict';
  status: 'open' | 'resolved';
  normalizedQuestion: string;
  question: string;
  recordId: string | null;
  otherRecordId: string | null;
  answer: string;
  otherAnswer: string | null;
  context: AnswerContext;
  otherContext: AnswerContext | null;
  origin: string;
  otherOrigin: string | null;
  createdAt: string;
}

export interface ApplyMindSettings {
  freshnessDays: number;
  coldStart: { minRecords: number; minPatterns: number; minHeldOutPatterns: number };
  autoFillSavedAnswers: boolean | null;
}

export interface ApplyMindModelInfo {
  version: string;
  trainedAt: string;
  records: number;
  patterns: number;
  heldOutPatterns: number;
  tierAUnlocked: boolean;
  fingerprint: string;
  embedding: null;
}

export interface ApplyMindSection {
  schema: number;
  appVersion: string;
  deviceId: string;
  exportedAt: string;
  records: KnowledgeRecord[];
  history: KnowledgeHistory[];
  facts: KnowledgeFact[];
  tombstones: KnowledgeTombstone[];
  reviews: KnowledgeReview[];
  settings: ApplyMindSettings;
  model: ApplyMindModelInfo | null;
  checksums: Record<string, string>;
}

export type ReviewAction = 'confirm' | 'correct' | 'delete' | 'keep-local' | 'keep-incoming' | 'keep-both' | 'replace';

export interface ReviewItem {
  id: string;
  kind: 'review' | 'conflict' | 'fact';
  question: string;
  answer: string;
  otherAnswer: string | null;
  origin: string;
  otherOrigin: string | null;
  normalizedQuestion: string;
}

export interface KnowledgeMerge {
  records: KnowledgeRecord[];
  history: KnowledgeHistory[];
  facts: KnowledgeFact[];
  tombstones: KnowledgeTombstone[];
  reviews: KnowledgeReview[];
  added: number;
  merged: number;
  skipped: number;
  conflicts: number;
}

const PARTS = ['records', 'history', 'facts', 'tombstones', 'reviews', 'settings', 'model'] as const;

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = sortValue((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

export function partChecksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortValue(value))).digest('hex');
}

export function withChecksums(section: Omit<ApplyMindSection, 'checksums'>): ApplyMindSection {
  const checksums: Record<string, string> = {};
  for (const part of PARTS) checksums[part] = partChecksum(section[part]);
  return { ...section, checksums };
}

export function defaultSettings(autoFillSavedAnswers: boolean | null): ApplyMindSettings {
  return { freshnessDays: FRESHNESS_DAYS, coldStart: { ...COLD_START }, autoFillSavedAnswers };
}

/** Two stored answers share a context only when both are general, or both name the same job. */
export function sameContext(a: AnswerContext, b: AnswerContext): boolean {
  if (a.scope !== b.scope) return false;
  if (a.scope !== 'job') return true;
  return a.platform === b.platform && a.jobTitle === b.jobTitle;
}

export function fingerprintOf(records: KnowledgeRecord[]): string {
  const lines = records
    .filter((r) => !r.deletedAt && r.status === 'verified')
    .map((r) => `${r.id}\t${r.normalizedQuestion.trim()}\t${partChecksum(r.answer)}`)
    .sort();
  return partChecksum(lines);
}

export function verifySection(raw: unknown): ApplyMindSection {
  if (!raw || typeof raw !== 'object') throw new ApplyMindSectionError('The ApplyMind section is missing or damaged.');
  const section = raw as ApplyMindSection;
  if (typeof section.schema !== 'number') throw new ApplyMindSectionError('The ApplyMind section has no schema version.');
  if (section.schema > APPLYMIND_SCHEMA) {
    throw new ApplyMindSectionError('This ApplyMind section was made by a newer version of ApplyFlow. Update ApplyFlow on this computer and try again.');
  }
  if (section.schema < 1) throw new ApplyMindSectionError('The ApplyMind section is not a version this ApplyFlow can read.');
  for (const part of PARTS) {
    const expected = section.checksums?.[part];
    if (!expected || partChecksum(section[part]) !== expected) {
      throw new ApplyMindSectionError(`The ApplyMind ${part} checksum does not match. Nothing was imported.`);
    }
  }
  if (!Array.isArray(section.records) || !Array.isArray(section.history)) {
    throw new ApplyMindSectionError('The ApplyMind section is missing its records.');
  }
  return section;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function historySignature(items: KnowledgeHistory[]): string[] {
  return items.map((h) => `${h.id}|${h.at}|${h.action}|${h.status}|${h.answer}`).sort();
}

function sameHistory(a: KnowledgeHistory[], b: KnowledgeHistory[]): boolean {
  const as = historySignature(a);
  const bs = historySignature(b);
  return as.length === bs.length && as.every((item, i) => item === bs[i]);
}

function continues(shorter: KnowledgeHistory[], longer: KnowledgeHistory[]): boolean {
  if (longer.length <= shorter.length) return false;
  const ids = new Set(longer.map((h) => h.id));
  return shorter.every((h) => ids.has(h.id));
}

function conflictId(normalized: string, left: string, right: string): string {
  const answers = [left.trim(), right.trim()].sort().join('|');
  return `cf_${createHash('sha256').update(`${normalized.trim()}|${answers}`).digest('hex').slice(0, 24)}`;
}

export function mergeKnowledge(local: ApplyMindSection, incoming: ApplyMindSection): KnowledgeMerge {
  const records = new Map<string, KnowledgeRecord>();
  for (const record of local.records) records.set(record.id, clone(record));
  const history = new Map<string, KnowledgeHistory>();
  for (const item of local.history) history.set(item.id, clone(item));
  const tombstones = new Map<string, KnowledgeTombstone>();
  for (const item of [...local.tombstones, ...incoming.tombstones]) {
    const prev = tombstones.get(item.id);
    if (!prev || item.deletedAt > prev.deletedAt) tombstones.set(item.id, clone(item));
  }
  const reviews = new Map<string, KnowledgeReview>();
  for (const item of [...local.reviews, ...incoming.reviews]) {
    if (item.status === 'open') reviews.set(item.id, clone(item));
  }
  const facts = new Map<string, KnowledgeFact>();
  for (const fact of local.facts) facts.set(fact.factKey, clone(fact));

  let added = 0;
  let merged = 0;
  let skipped = 0;
  let conflicts = 0;

  const forRecord = (id: string) => [...history.values()].filter((h) => h.recordId === id);

  const adopt = (recordId: string, items: KnowledgeHistory[]) => {
    for (const item of items) {
      if (!history.has(item.id)) history.set(item.id, { ...clone(item), recordId });
    }
  };

  const addConflict = (question: string, normalized: string, left: KnowledgeRecord, right: KnowledgeRecord) => {
    const id = conflictId(normalized, left.answer, right.answer);
    if (reviews.has(id)) return;
    reviews.set(id, {
      id,
      kind: 'conflict',
      status: 'open',
      normalizedQuestion: normalized,
      question,
      recordId: left.id,
      otherRecordId: right.id,
      answer: left.answer,
      otherAnswer: right.answer,
      context: left.context,
      otherContext: right.context,
      origin: left.deviceId,
      otherOrigin: right.deviceId,
      createdAt: new Date().toISOString(),
    });
    conflicts++;
  };

  const tombstoned = (record: KnowledgeRecord) => [...tombstones.values()].some((t) =>
    t.sourceAnswerId != null && t.sourceAnswerId === record.sourceAnswerId || t.id === record.id || t.id === `tomb_${record.sourceAnswerId ?? ''}`);

  for (const inc of incoming.records) {
    const incomingHist = incoming.history.filter((h) => h.recordId === inc.id);
    const sameId = records.get(inc.id);
    if (sameId) {
      const localHist = forRecord(inc.id);
      if (sameHistory(localHist, incomingHist) && sameId.answer === inc.answer && sameId.status === inc.status && sameId.deletedAt === inc.deletedAt) {
        skipped++;
        continue;
      }
      if (continues(localHist, incomingHist)) {
        const keptId = sameId.id;
        Object.assign(sameId, clone(inc), { id: keptId });
        adopt(keptId, incomingHist);
        merged++;
        continue;
      }
      if (continues(incomingHist, localHist) || sameId.answer.trim() === inc.answer.trim()) {
        adopt(sameId.id, incomingHist);
        merged++;
        continue;
      }
      if (sameId.status === 'verified' && inc.status !== 'verified') {
        adopt(sameId.id, incomingHist);
        skipped++;
        continue;
      }
      if (inc.status === 'verified' && sameId.status !== 'verified') {
        const keptId = sameId.id;
        Object.assign(sameId, clone(inc), { id: keptId });
        adopt(keptId, incomingHist);
        merged++;
        continue;
      }
      if (sameContext(sameId.context, inc.context)) addConflict(sameId.originalQuestion, sameId.normalizedQuestion, sameId, inc);
      adopt(sameId.id, incomingHist);
      continue;
    }

    const live = [...records.values()].filter((r) => !r.deletedAt);
    const bySource = inc.sourceAnswerId ? live.find((r) => r.sourceAnswerId === inc.sourceAnswerId) : undefined;
    if (bySource) {
      if (bySource.answer.trim() === inc.answer.trim()) {
        adopt(bySource.id, incomingHist);
        merged++;
        continue;
      }
      if (bySource.status === 'verified' || inc.status === 'verified') {
        addConflict(bySource.originalQuestion, bySource.normalizedQuestion, bySource, inc);
        if (inc.status === 'verified' && bySource.status !== 'verified') {
          const keptId = bySource.id;
          Object.assign(bySource, clone(inc), { id: keptId, sourceAnswerId: bySource.sourceAnswerId });
        }
        continue;
      }
    }

    const samePattern = live.filter((r) => r.normalizedQuestion.trim() === inc.normalizedQuestion.trim() && sameContext(r.context, inc.context));
    const sameAnswer = samePattern.find((r) => r.answer.trim() === inc.answer.trim());
    if (sameAnswer) {
      adopt(sameAnswer.id, incomingHist);
      merged++;
      continue;
    }
    const clash = samePattern.find((r) => r.status === 'verified' && inc.status === 'verified');
    records.set(inc.id, clone(inc));
    adopt(inc.id, incomingHist);
    added++;
    if (clash) addConflict(clash.originalQuestion, clash.normalizedQuestion, clash, inc);
  }

  for (const record of records.values()) {
    if (tombstoned(record)) record.deletedAt = record.deletedAt ?? new Date().toISOString();
  }

  for (const fact of incoming.facts) {
    const prev = facts.get(fact.factKey);
    if (!prev) {
      facts.set(fact.factKey, clone(fact));
      added++;
      continue;
    }
    if (prev.value === fact.value) {
      skipped++;
      continue;
    }
    const id = conflictId(fact.factKey, prev.value, fact.value);
    if (!reviews.has(id)) {
      reviews.set(id, {
        id,
        kind: 'conflict',
        status: 'open',
        normalizedQuestion: fact.factKey,
        question: fact.label,
        recordId: prev.id,
        otherRecordId: fact.id,
        answer: prev.value,
        otherAnswer: fact.value,
        context: { platform: null, jobTitle: null, skills: [], location: null, remote: null, seniority: null, employmentType: null, scope: 'general' },
        otherContext: null,
        origin: prev.deviceId,
        otherOrigin: fact.deviceId,
        createdAt: new Date().toISOString(),
      });
      conflicts++;
    }
  }

  return {
    records: [...records.values()],
    history: [...history.values()],
    facts: [...facts.values()],
    tombstones: [...tombstones.values()],
    reviews: [...reviews.values()],
    added,
    merged,
    skipped,
    conflicts,
  };
}
