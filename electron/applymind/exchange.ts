import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { HELD_ORIGINAL_QUESTIONS } from '../../src/services/applymind/heldQuestions';
import {
  defaultSettings,
  fingerprintOf,
  withChecksums,
  type ApplyMindSection,
  type KnowledgeFact,
  type KnowledgeHistory,
  type KnowledgeMerge,
  type KnowledgeRecord,
  type KnowledgeReview,
  type KnowledgeTombstone,
  type ReviewAction,
  type ReviewItem,
} from '../../src/services/applymind/transfer';
import { GENERAL_CONTEXT } from '../../src/services/applymind/exact';
import type { AnswerContext, Provenance } from '../../src/services/applymind/types';
import { openJson, sealJson } from './crypto';

type Row = Record<string, unknown>;
const all = (db: DatabaseSync, sql: string, ...params: (string | number | null)[]) => db.prepare(sql).all(...params) as Row[];
const str = (v: unknown) => (v == null ? '' : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));

function contextOf(value: unknown): AnswerContext {
  try {
    const parsed = JSON.parse(String(value)) as AnswerContext;
    if (parsed && (parsed.scope === 'general' || parsed.scope === 'job')) return parsed;
  } catch {
    /* use the general context */
  }
  return GENERAL_CONTEXT;
}

function provenanceOf(value: unknown): Provenance {
  try {
    const parsed = JSON.parse(String(value)) as Provenance;
    if (parsed && typeof parsed.kind === 'string') return parsed;
  } catch {
    /* fall through */
  }
  return { kind: 'autofill', sourceAnswerId: null, catalogId: null, factId: null };
}

export function isHeld(provenance: Provenance): boolean {
  return provenance.review === 'pending';
}

export function readSection(db: DatabaseSync, key: Uint8Array, info: { appVersion: string; deviceId: string; exportedAt: string; autoFillSavedAnswers: boolean | null }): ApplyMindSection {
  const records: KnowledgeRecord[] = all(db, 'SELECT * FROM applymind_records').map((r) => ({
    id: str(r.id),
    sourceAnswerId: strOrNull(r.source_answer_id),
    deviceId: str(r.device_id),
    patternId: str(r.pattern_id),
    originalQuestion: str(r.original_question),
    normalizedQuestion: str(r.normalized_question),
    category: str(r.category),
    questionType: str(r.question_type),
    options: JSON.parse(str(r.options_json) || '[]') as string[],
    answer: openJson<string>(key, str(r.answer_blob)),
    status: str(r.status) as KnowledgeRecord['status'],
    provenance: provenanceOf(r.provenance_json),
    context: contextOf(r.context_json),
    platform: strOrNull(r.platform),
    answeredAt: str(r.answered_at),
    confirmedAt: str(r.confirmed_at),
    freshnessDays: r.freshness_days == null ? null : Number(r.freshness_days),
    deletedAt: strOrNull(r.deleted_at),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  }));
  const history: KnowledgeHistory[] = all(db, 'SELECT * FROM applymind_history').map((r) => ({
    id: str(r.id),
    recordId: str(r.record_id),
    at: str(r.at),
    deviceId: str(r.device_id),
    action: str(r.action),
    status: str(r.status),
    answer: openJson<string>(key, str(r.answer_blob)),
  }));
  const facts: KnowledgeFact[] = all(db, 'SELECT * FROM applymind_facts').map((r) => ({
    id: str(r.id),
    factKey: str(r.fact_key),
    kind: str(r.kind),
    label: str(r.label),
    country: strOrNull(r.country),
    sourceAnswerId: strOrNull(r.source_answer_id),
    freshnessDays: r.freshness_days == null ? null : Number(r.freshness_days),
    confirmedAt: str(r.confirmed_at),
    deviceId: str(r.device_id),
    value: openJson<string>(key, str(r.value_blob)),
  }));
  const tombstones: KnowledgeTombstone[] = all(db, 'SELECT * FROM applymind_tombstones').map((r) => ({
    id: str(r.id),
    sourceAnswerId: strOrNull(r.source_answer_id),
    patternId: strOrNull(r.pattern_id),
    deletedAt: str(r.deleted_at),
    deviceId: str(r.device_id),
  }));
  const reviews: KnowledgeReview[] = all(db, "SELECT * FROM applymind_reviews WHERE status = 'open'").map((r) => ({
    id: str(r.id),
    kind: str(r.kind) === 'conflict' ? 'conflict' : 'review',
    status: 'open',
    normalizedQuestion: str(r.normalized_question),
    question: str(r.question),
    recordId: strOrNull(r.record_id),
    otherRecordId: strOrNull(r.other_record_id),
    answer: openJson<string>(key, str(r.answer_blob)),
    otherAnswer: r.other_answer_blob == null ? null : openJson<string>(key, str(r.other_answer_blob)),
    context: contextOf(r.context_json),
    otherContext: r.other_context_json == null ? null : contextOf(r.other_context_json),
    origin: str(r.origin),
    otherOrigin: strOrNull(r.other_origin),
    createdAt: str(r.created_at),
  }));
  const modelRow = all(db, 'SELECT version, trained_at, records, patterns, held_out_patterns, tier_a_unlocked FROM applymind_models WHERE active = 1 ORDER BY trained_at DESC LIMIT 1')[0];
  return withChecksums({
    schema: 1,
    appVersion: info.appVersion,
    deviceId: info.deviceId,
    exportedAt: info.exportedAt,
    records,
    history,
    facts,
    tombstones,
    reviews,
    settings: defaultSettings(info.autoFillSavedAnswers),
    model: modelRow
      ? {
          version: str(modelRow.version),
          trainedAt: str(modelRow.trained_at),
          records: Number(modelRow.records),
          patterns: Number(modelRow.patterns),
          heldOutPatterns: Number(modelRow.held_out_patterns),
          tierAUnlocked: Boolean(modelRow.tier_a_unlocked),
          fingerprint: fingerprintOf(records),
          embedding: null,
        }
      : null,
  });
}

function upsertRecord(db: DatabaseSync, record: KnowledgeRecord, key: Uint8Array): void {
  const sealed = sealJson(key, record.answer);
  db.prepare(`INSERT INTO applymind_patterns(id, category, normalized, created_at, device_id) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET normalized = excluded.normalized`).run(
    record.patternId, record.category, record.normalizedQuestion, record.createdAt, record.deviceId,
  );
  db.prepare(`INSERT INTO applymind_records(id, source_answer_id, device_id, pattern_id, original_question, normalized_question,
      category, question_type, options_json, status, provenance_json, context_json, platform, answered_at, confirmed_at,
      freshness_days, answer_blob, deleted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET source_answer_id = excluded.source_answer_id, pattern_id = excluded.pattern_id,
      original_question = excluded.original_question, normalized_question = excluded.normalized_question, category = excluded.category,
      question_type = excluded.question_type, options_json = excluded.options_json, status = excluded.status,
      provenance_json = excluded.provenance_json, context_json = excluded.context_json, platform = excluded.platform,
      freshness_days = excluded.freshness_days, answer_blob = excluded.answer_blob, deleted_at = excluded.deleted_at, updated_at = excluded.updated_at`).run(
    record.id, record.sourceAnswerId, record.deviceId, record.patternId, record.originalQuestion, record.normalizedQuestion,
    record.category, record.questionType, JSON.stringify(record.options), record.status, JSON.stringify(record.provenance),
    JSON.stringify(record.context), record.platform, record.answeredAt, record.confirmedAt, record.freshnessDays, sealed,
    record.deletedAt, record.createdAt, record.updatedAt,
  );
}

export function writeMerged(db: DatabaseSync, merged: KnowledgeMerge, key: Uint8Array): void {
  for (const record of merged.records) upsertRecord(db, record, key);
  for (const item of merged.history) {
    const exists = all(db, 'SELECT id FROM applymind_history WHERE id = ?', item.id)[0];
    if (exists) continue;
    db.prepare('INSERT INTO applymind_history(id, record_id, at, device_id, action, status, answer_blob) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      item.id, item.recordId, item.at, item.deviceId, item.action, item.status, sealJson(key, item.answer),
    );
  }
  for (const fact of merged.facts) {
    db.prepare(`INSERT INTO applymind_facts(id, fact_key, kind, label, country, source_answer_id, freshness_days, confirmed_at, device_id, value_blob)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fact_key) DO NOTHING`).run(
      fact.id, fact.factKey, fact.kind, fact.label, fact.country, fact.sourceAnswerId, fact.freshnessDays, fact.confirmedAt, fact.deviceId, sealJson(key, fact.value),
    );
  }
  for (const item of merged.tombstones) {
    db.prepare(`INSERT INTO applymind_tombstones(id, source_answer_id, pattern_id, deleted_at, device_id) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET deleted_at = excluded.deleted_at`).run(item.id, item.sourceAnswerId, item.patternId, item.deletedAt, item.deviceId);
  }
  for (const review of merged.reviews) {
    if (review.status !== 'open') continue;
    const exists = all(db, 'SELECT id FROM applymind_reviews WHERE id = ?', review.id)[0];
    if (exists) continue;
    insertReview(db, key, review);
  }
}

function insertReview(db: DatabaseSync, key: Uint8Array, review: KnowledgeReview): void {
  db.prepare(`INSERT INTO applymind_reviews(id, kind, status, normalized_question, question, record_id, other_record_id, answer_blob, other_answer_blob, context_json, other_context_json, origin, other_origin, created_at, resolved_at)
    VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
    review.id, review.kind, review.normalizedQuestion, review.question, review.recordId, review.otherRecordId,
    sealJson(key, review.answer), review.otherAnswer == null ? null : sealJson(key, review.otherAnswer),
    JSON.stringify(review.context), review.otherContext ? JSON.stringify(review.otherContext) : null,
    review.origin, review.otherOrigin, review.createdAt,
  );
}

export function openConflict(db: DatabaseSync, key: Uint8Array, review: KnowledgeReview): void {
  const open = all(db, "SELECT id FROM applymind_reviews WHERE status = 'open' AND normalized_question = ?", review.normalizedQuestion)[0];
  if (open) return;
  insertReview(db, key, review);
}

export function holdCandidateCount(db: DatabaseSync): number {
  const wanted = new Set(HELD_ORIGINAL_QUESTIONS);
  let n = 0;
  for (const row of all(db, 'SELECT original_question, status, provenance_json, deleted_at FROM applymind_records')) {
    if (row.deleted_at != null || !wanted.has(str(row.original_question))) continue;
    if (str(row.status) === 'accepted' && isHeld(provenanceOf(row.provenance_json))) continue;
    n++;
  }
  return n;
}

export function holdFillerRecords(db: DatabaseSync, key: Uint8Array, deviceId: string, now: string): number {
  const wanted = new Set(HELD_ORIGINAL_QUESTIONS);
  const rows = all(db, 'SELECT * FROM applymind_records WHERE deleted_at IS NULL');
  let n = 0;
  for (const row of rows) {
    if (!wanted.has(str(row.original_question))) continue;
    const provenance = provenanceOf(row.provenance_json);
    if (str(row.status) === 'accepted' && isHeld(provenance)) continue;
    const next: Provenance = {
      kind: 'autofill',
      sourceAnswerId: strOrNull(row.source_answer_id),
      catalogId: provenance.catalogId ?? null,
      factId: null,
      review: 'pending',
    };
    const answer = openJson<string>(key, str(row.answer_blob));
    db.prepare(`UPDATE applymind_records SET status = 'accepted', provenance_json = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(next), now, str(row.id));
    db.prepare('INSERT INTO applymind_history(id, record_id, at, device_id, action, status, answer_blob) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      randomUUID(), str(row.id), now, deviceId, 'held', 'accepted', sealJson(key, answer),
    );
    const reviewId = `rv_${createHash('sha256').update(str(row.id)).digest('hex').slice(0, 24)}`;
    if (!all(db, 'SELECT id FROM applymind_reviews WHERE id = ?', reviewId)[0]) {
      insertReview(db, key, {
        id: reviewId,
        kind: 'review',
        status: 'open',
        normalizedQuestion: str(row.normalized_question),
        question: str(row.original_question),
        recordId: str(row.id),
        otherRecordId: null,
        answer,
        otherAnswer: null,
        context: contextOf(row.context_json),
        otherContext: null,
        origin: 'This computer',
        otherOrigin: null,
        createdAt: now,
      });
    }
    n++;
  }
  return n;
}

export function listReviews(db: DatabaseSync, key: Uint8Array): ReviewItem[] {
  return all(db, "SELECT * FROM applymind_reviews WHERE status = 'open' ORDER BY created_at").map((r) => ({
    id: str(r.id),
    kind: str(r.kind) === 'conflict' ? 'conflict' : 'review',
    question: str(r.question),
    answer: openJson<string>(key, str(r.answer_blob)),
    otherAnswer: r.other_answer_blob == null ? null : openJson<string>(key, str(r.other_answer_blob)),
    origin: str(r.origin),
    otherOrigin: strOrNull(r.other_origin),
    normalizedQuestion: str(r.normalized_question),
  }));
}

export function blockedQuestions(db: DatabaseSync): string[] {
  const found = new Set<string>();
  for (const row of all(db, "SELECT normalized_question FROM applymind_reviews WHERE status = 'open'")) found.add(str(row.normalized_question).trim());
  for (const row of all(db, 'SELECT normalized_question, provenance_json FROM applymind_records WHERE deleted_at IS NULL')) {
    if (isHeld(provenanceOf(row.provenance_json))) found.add(str(row.normalized_question).trim());
  }
  return [...found];
}

export function resolveReview(db: DatabaseSync, key: Uint8Array, deviceId: string, now: string, id: string, action: ReviewAction, answer?: string): void {
  const review = all(db, "SELECT * FROM applymind_reviews WHERE id = ? AND status = 'open'", id)[0];
  if (!review) throw new Error('That review is no longer open.');
  const recordId = strOrNull(review.record_id);
  const otherId = strOrNull(review.other_record_id);
  const current = openJson<string>(key, str(review.answer_blob));
  const other = review.other_answer_blob == null ? null : openJson<string>(key, str(review.other_answer_blob));
  const chosen = action === 'correct' || action === 'replace' ? (answer ?? '').trim() : action === 'keep-incoming' ? (other ?? '').trim() : current.trim();
  if ((action === 'correct' || action === 'replace') && !chosen) throw new Error('Type the answer to keep.');
  if (action === 'delete' || (action === 'keep-incoming' && !other && !otherId)) {
    if (recordId) deleteRecord(db, key, deviceId, now, recordId, current);
    closeReview(db, id, now);
    return;
  }
  if (action === 'keep-both' && recordId) {
    splitContexts(db, recordId, otherId, other, key, deviceId, now);
    closeReview(db, id, now);
    return;
  }
  if (recordId && (action === 'confirm' || action === 'correct' || action === 'keep-local' || action === 'keep-incoming' || action === 'replace')) {
    verifyRecord(db, key, deviceId, now, recordId, chosen, action === 'keep-local' || action === 'confirm' ? 'confirmed' : 'corrected');
    if (otherId && otherId !== recordId) deleteRecord(db, key, deviceId, now, otherId, other ?? '');
  }
  closeReview(db, id, now);
}

function verifyRecord(db: DatabaseSync, key: Uint8Array, deviceId: string, now: string, id: string, answer: string, action: string): void {
  const row = all(db, 'SELECT provenance_json FROM applymind_records WHERE id = ?', id)[0];
  if (!row) return;
  const prev = provenanceOf(row.provenance_json);
  const provenance: Provenance = { kind: 'user_entered', sourceAnswerId: prev.sourceAnswerId, catalogId: prev.catalogId, factId: prev.factId };
  const sealed = sealJson(key, answer);
  db.prepare(`UPDATE applymind_records SET status = 'verified', provenance_json = ?, answer_blob = ?, confirmed_at = ?, updated_at = ?, deleted_at = NULL WHERE id = ?`).run(
    JSON.stringify(provenance), sealed, now, now, id,
  );
  db.prepare('INSERT INTO applymind_history(id, record_id, at, device_id, action, status, answer_blob) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    randomUUID(), id, now, deviceId, action, 'verified', sealed,
  );
}

function deleteRecord(db: DatabaseSync, key: Uint8Array, deviceId: string, now: string, id: string, answer: string): void {
  const row = all(db, 'SELECT source_answer_id, pattern_id FROM applymind_records WHERE id = ?', id)[0];
  if (!row) return;
  db.prepare('UPDATE applymind_records SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  db.prepare(`INSERT INTO applymind_tombstones(id, source_answer_id, pattern_id, deleted_at, device_id) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET deleted_at = excluded.deleted_at`).run(
    `tomb_${strOrNull(row.source_answer_id) ?? id}`, strOrNull(row.source_answer_id), str(row.pattern_id), now, deviceId,
  );
  db.prepare('INSERT INTO applymind_history(id, record_id, at, device_id, action, status, answer_blob) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    randomUUID(), id, now, deviceId, 'deleted', 'accepted', sealJson(key, answer),
  );
}

function splitContexts(db: DatabaseSync, recordId: string, otherId: string | null, otherAnswer: string | null, key: Uint8Array, deviceId: string, now: string): void {
  const job = (platform: string): AnswerContext => ({ ...GENERAL_CONTEXT, scope: 'job', platform, jobTitle: null });
  db.prepare('UPDATE applymind_records SET context_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(job('this-computer')), now, recordId);
  if (otherId && all(db, 'SELECT id FROM applymind_records WHERE id = ?', otherId)[0]) {
    db.prepare('UPDATE applymind_records SET context_json = ?, status = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(job('other-computer')), 'verified', now, otherId);
    return;
  }
  if (!otherAnswer) return;
  const row = all(db, 'SELECT * FROM applymind_records WHERE id = ?', recordId)[0];
  if (!row) return;
  const id = `kr_other_${createHash('sha256').update(otherAnswer + str(row.normalized_question)).digest('hex').slice(0, 16)}`;
  const provenance: Provenance = { kind: 'user_entered', sourceAnswerId: null, catalogId: null, factId: null };
  db.prepare(`INSERT INTO applymind_records(id, source_answer_id, device_id, pattern_id, original_question, normalized_question,
      category, question_type, options_json, status, provenance_json, context_json, platform, answered_at, confirmed_at,
      freshness_days, answer_blob, deleted_at, created_at, updated_at)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, 'other-computer', ?, ?, NULL, ?, NULL, ?, ?)`).run(
    id, deviceId, str(row.pattern_id), str(row.original_question), str(row.normalized_question), str(row.category), str(row.question_type),
    str(row.options_json), JSON.stringify(provenance), JSON.stringify(job('other-computer')), now, now, sealJson(key, otherAnswer), now, now,
  );
}

function closeReview(db: DatabaseSync, id: string, now: string): void {
  db.prepare("UPDATE applymind_reviews SET status = 'resolved', resolved_at = ? WHERE id = ?").run(now, id);
}
