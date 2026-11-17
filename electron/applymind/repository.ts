import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { canonicalizeQuestion } from '../../src/services/forms/questionMatch';
import { exactVerifiedValue, GENERAL_CONTEXT, type ExactLookup, type ExactRecord } from '../../src/services/applymind/exact';
import { questionTypeOf } from '../../src/services/applymind/questionType';
import type { AnswerContext, LearnedBundle, MigrationPlan, ProposalView, Provenance, TrainingRecord } from '../../src/services/applymind/types';
import type { ApprovedAnswer, ScreeningControl } from '../../src/types';
import { openJson, sealJson, type Sealed } from './crypto';
import { blockedQuestions, isHeld, openConflict } from './exchange';
import { ensureApplyMindSchema } from './schema';

interface RecordRow {
  id: string;
  source_answer_id: string | null;
  answer_blob: string;
  deleted_at: string | null;
  pattern_id: string;
  original_question: string;
  normalized_question: string;
  status: string;
  provenance_json: string;
  context_json: string;
}

export interface ApplyCounts {
  answersSeen: number;
  created: number;
  unchanged: number;
  edited: number;
  restored: number;
  deleted: number;
  proposals: number;
  patterns: number;
  changed: boolean;
}

function rows(db: DatabaseSync, sql: string, ...params: (string | number | null)[]): Record<string, unknown>[] {
  return db.prepare(sql).all(...params) as Record<string, unknown>[];
}

function parseContext(value: unknown): AnswerContext {
  try {
    const parsed = JSON.parse(String(value)) as AnswerContext;
    if (parsed && (parsed.scope === 'general' || parsed.scope === 'job')) return parsed;
  } catch {
    /* fall through */
  }
  return GENERAL_CONTEXT;
}

export class KnowledgeRepository {
  constructor(readonly db: DatabaseSync, readonly deviceId: string) {
    ensureApplyMindSchema(db);
  }

  meta(key: string): string | null {
    const row = rows(this.db, 'SELECT value FROM meta WHERE key = ?', key)[0];
    return row ? String(row.value) : null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  countActive(): number {
    return Number(rows(this.db, 'SELECT COUNT(*) AS n FROM applymind_records WHERE deleted_at IS NULL')[0]?.n ?? 0);
  }

  countVerified(): number {
    return Number(rows(this.db, "SELECT COUNT(*) AS n FROM applymind_records WHERE deleted_at IS NULL AND status = 'verified'")[0]?.n ?? 0);
  }

  /** Verified answer for this exact question. A question waiting for review is not filled. */
  exactVerified(key: Uint8Array, query: ExactLookup): string | null {
    const blocked = new Set(blockedQuestions(this.db));
    const records: ExactRecord[] = rows(this.db, `SELECT normalized_question, answer_blob, status, context_json, question_type
      FROM applymind_records WHERE deleted_at IS NULL AND status = 'verified' AND question_type != 'long_form'`).map((r) => ({
      normalizedQuestion: String(r.normalized_question),
      answer: openJson<string>(key, String(r.answer_blob)),
      status: 'verified' as const,
      context: parseContext(r.context_json),
    })).filter((r) => !blocked.has(r.normalizedQuestion.trim()));
    return exactVerifiedValue(records, query);
  }

  /**
   * Stores a fill the user did not approve. Never verified, never user_entered.
   * Skips a question that already has a verified record.
   */
  acceptFills(items: { question: string; answer: string; category: string; options: string[]; control: string }[], key: Uint8Array, now: string): number {
    let n = 0;
    this.tx(() => {
      for (const item of items) {
        const question = item.question.trim();
        const answer = item.answer.trim();
        const normalized = canonicalizeQuestion(question);
        if (!question || !answer || !normalized.trim()) continue;
        const verified = rows(this.db, `SELECT id FROM applymind_records WHERE deleted_at IS NULL AND status = 'verified' AND normalized_question = ?`, normalized);
        if (verified.length) continue;
        const id = `ac_${createHash('sha256').update(normalized).digest('hex').slice(0, 24)}`;
        const sealed = sealJson(key, answer);
        const control = (['text', 'textarea', 'select', 'combobox', 'radio', 'checkbox'].includes(item.control) ? item.control : 'text') as ScreeningControl;
        const category = (item.category || 'general') as ApprovedAnswer['category'];
        const provenance = { kind: 'autofill' as const, sourceAnswerId: null, catalogId: null, factId: null };
        const questionType = questionTypeOf({ category, control, answer, options: item.options, questionPattern: question });
        const existing = rows(this.db, 'SELECT id, answer_blob, deleted_at FROM applymind_records WHERE id = ?', id)[0];
        this.upsertPattern(id, category, normalized, this.deviceId, now);
        if (!existing) {
          this.db.prepare(`INSERT INTO applymind_records(id, source_answer_id, device_id, pattern_id, original_question, normalized_question,
            category, question_type, options_json, status, provenance_json, context_json, platform, answered_at, confirmed_at,
            freshness_days, answer_blob, deleted_at, created_at, updated_at)
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, NULL, ?, ?, NULL, ?, NULL, ?, ?)`).run(
            id, this.deviceId, id, question, normalized, category, questionType, JSON.stringify(item.options),
            JSON.stringify(provenance), JSON.stringify(GENERAL_CONTEXT), now, now, sealed, now, now,
          );
          this.addHistory(id, this.deviceId, now, 'accepted', 'accepted', sealed);
          n++;
          continue;
        }
        const current = openJson<string>(key, String(existing.answer_blob));
        if (!existing.deleted_at && current.trim() === answer) continue;
        this.db.prepare(`UPDATE applymind_records SET original_question = ?, normalized_question = ?, category = ?, question_type = ?,
          options_json = ?, status = 'accepted', provenance_json = ?, answer_blob = ?, deleted_at = NULL, updated_at = ? WHERE id = ?`).run(
          question, normalized, category, questionType, JSON.stringify(item.options), JSON.stringify(provenance), sealed, now, id,
        );
        this.addHistory(id, this.deviceId, now, 'accepted', 'accepted', sealed);
        n++;
      }
    });
    return n;
  }

  patternCount(): number {
    return Number(rows(this.db, 'SELECT COUNT(DISTINCT pattern_id) AS n FROM applymind_records WHERE deleted_at IS NULL')[0]?.n ?? 0);
  }

  apply(plan: MigrationPlan, key: Uint8Array, now: string, mode: 'correct' | 'preserve' = 'correct'): ApplyCounts {
    const counts: ApplyCounts = {
      answersSeen: plan.records.length, created: 0, unchanged: 0, edited: 0, restored: 0, deleted: 0,
      proposals: 0, patterns: new Set(plan.records.map((r) => r.patternId)).size, changed: false,
    };
    this.tx(() => {
      const existing = rows(this.db, `SELECT id, source_answer_id, answer_blob, deleted_at, pattern_id, original_question, normalized_question, status, provenance_json, context_json
        FROM applymind_records`).map((r) => ({
        id: String(r.id),
        source_answer_id: r.source_answer_id == null ? null : String(r.source_answer_id),
        answer_blob: String(r.answer_blob),
        deleted_at: r.deleted_at == null ? null : String(r.deleted_at),
        pattern_id: String(r.pattern_id),
        original_question: String(r.original_question),
        normalized_question: String(r.normalized_question),
        status: String(r.status),
        provenance_json: String(r.provenance_json),
        context_json: String(r.context_json),
      })) as RecordRow[];
      const bySource = new Map(existing.filter((r) => r.source_answer_id).map((r) => [r.source_answer_id!, r]));
      const seen = new Set<string>();

      for (const rec of plan.records) {
        seen.add(rec.sourceAnswerId);
        const sealed = sealJson(key, rec.answer);
        const prev = bySource.get(rec.sourceAnswerId);
        this.upsertPattern(rec.patternId, rec.category, rec.normalizedQuestion, rec.deviceId, now);
        if (!prev) {
          this.insertRecord(rec, sealed, now);
          this.addHistory(rec.id, rec.deviceId, now, 'created', rec.status, sealed);
          counts.created++;
          continue;
        }
        const current = openJson<string>(key, prev.answer_blob);
        const same = current.trim() === rec.answer.trim();
        let held = false;
        try { held = isHeld(JSON.parse(prev.provenance_json) as Provenance); } catch { held = false; }
        if (held) {
          counts.unchanged++;
          continue;
        }
        if (mode === 'preserve' && prev.status === 'verified' && !prev.deleted_at && !same) {
          openConflict(this.db, key, {
            id: `cf_profile_${prev.id}`,
            kind: 'conflict',
            status: 'open',
            normalizedQuestion: prev.normalized_question,
            question: prev.original_question,
            recordId: prev.id,
            otherRecordId: null,
            answer: current,
            otherAnswer: rec.answer,
            context: parseContext(prev.context_json),
            otherContext: GENERAL_CONTEXT,
            origin: 'This computer',
            otherOrigin: 'Imported profile',
            createdAt: now,
          });
          counts.unchanged++;
          continue;
        }
        if (same && !prev.deleted_at) {
          if (prev.original_question !== rec.originalQuestion || prev.normalized_question !== rec.normalizedQuestion || prev.pattern_id !== rec.patternId) {
            this.db.prepare('UPDATE applymind_records SET pattern_id = ?, original_question = ?, normalized_question = ?, updated_at = ? WHERE id = ?').run(
              rec.patternId, rec.originalQuestion, rec.normalizedQuestion, now, prev.id,
            );
            counts.changed = true;
          }
          counts.unchanged++;
          continue;
        }
        this.db.prepare(`UPDATE applymind_records SET pattern_id = ?, original_question = ?, normalized_question = ?, category = ?,
          question_type = ?, options_json = ?, status = ?, provenance_json = ?, context_json = ?, freshness_days = ?,
          answer_blob = ?, deleted_at = NULL, confirmed_at = ?, updated_at = ? WHERE id = ?`).run(
          rec.patternId, rec.originalQuestion, rec.normalizedQuestion, rec.category, rec.questionType,
          JSON.stringify(rec.options), rec.status, JSON.stringify(rec.provenance), JSON.stringify(rec.context),
          rec.freshnessDays, sealed, now, now, prev.id,
        );
        const action = prev.deleted_at ? 'restored' : 'corrected';
        this.addHistory(prev.id, rec.deviceId, now, action, rec.status, sealed);
        if (prev.deleted_at) counts.restored++;
        else counts.edited++;
      }

      for (const row of existing) {
        if (!row.source_answer_id || seen.has(row.source_answer_id) || row.deleted_at) continue;
        let held = false;
        try { held = isHeld(JSON.parse(row.provenance_json) as Provenance); } catch { held = false; }
        if (held) continue;
        if (mode === 'preserve' && row.status === 'verified') {
          const current = openJson<string>(key, row.answer_blob);
          openConflict(this.db, key, {
            id: `cf_missing_${row.id}`,
            kind: 'conflict',
            status: 'open',
            normalizedQuestion: row.normalized_question,
            question: row.original_question,
            recordId: row.id,
            otherRecordId: null,
            answer: current,
            otherAnswer: null,
            context: parseContext(row.context_json),
            otherContext: null,
            origin: 'This computer',
            otherOrigin: 'The other computer no longer has this saved answer',
            createdAt: now,
          });
          continue;
        }
        this.db.prepare('UPDATE applymind_records SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id);
        this.db.prepare(`INSERT INTO applymind_tombstones(id, source_answer_id, pattern_id, deleted_at, device_id) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET deleted_at = excluded.deleted_at`).run(
          `tomb_${row.source_answer_id}`, row.source_answer_id, row.pattern_id, now, this.deviceId,
        );
        counts.deleted++;
      }

      const confirmed = new Set(rows(this.db, 'SELECT fact_key FROM applymind_facts').map((r) => String(r.fact_key)));
      const nextProposals = plan.proposals.filter((p) => !confirmed.has(p.factKey));
      const previous = this.proposalSnapshot(key);
      const nextSnap = nextProposals.map((p) => `${p.factKey}=${p.value.trim()}`).sort().join('|');
      if (previous !== nextSnap) {
        this.db.prepare("DELETE FROM applymind_proposals WHERE status = 'proposed'").run();
        for (const p of nextProposals) {
          this.db.prepare(`INSERT INTO applymind_proposals(id, fact_key, kind, label, country, source_answer_id, freshness_days, status, value_blob, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`).run(
            p.id, p.factKey, p.kind, p.label, p.country, p.sourceAnswerId, p.freshnessDays, sealJson(key, { question: p.question, value: p.value }), now,
          );
        }
        counts.changed = true;
      }
      counts.proposals = nextProposals.length;
      if (counts.created || counts.edited || counts.restored || counts.deleted) counts.changed = true;
    });
    return counts;
  }

  trainingRecords(key: Uint8Array): TrainingRecord[] {
    return rows(this.db, `SELECT id, pattern_id, category, question_type, normalized_question, original_question, answer_blob
      FROM applymind_records WHERE deleted_at IS NULL AND status = 'verified'`).map((r) => ({
      id: String(r.id),
      patternId: String(r.pattern_id),
      category: String(r.category),
      questionType: String(r.question_type),
      normalized: String(r.normalized_question),
      original: String(r.original_question),
      answer: openJson<string>(key, String(r.answer_blob)),
    }));
  }

  proposals(key: Uint8Array): ProposalView[] {
    return rows(this.db, "SELECT * FROM applymind_proposals WHERE status = 'proposed' ORDER BY label").map((r) => {
      const body = openJson<{ question: string; value: string }>(key, String(r.value_blob));
      return {
        id: String(r.id),
        factKey: String(r.fact_key),
        kind: String(r.kind),
        label: String(r.label),
        country: r.country == null ? null : String(r.country),
        question: body.question,
        value: body.value,
        freshnessDays: r.freshness_days == null ? null : Number(r.freshness_days),
        sourceAnswerId: String(r.source_answer_id),
      };
    });
  }

  confirmFacts(ids: string[], now: string): number {
    let n = 0;
    this.tx(() => {
      for (const id of ids) {
        const row = rows(this.db, "SELECT * FROM applymind_proposals WHERE id = ? AND status = 'proposed'", id)[0];
        if (!row) continue;
        this.db.prepare(`INSERT INTO applymind_facts(id, fact_key, kind, label, country, source_answer_id, freshness_days, confirmed_at, device_id, value_blob)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(fact_key) DO UPDATE SET value_blob = excluded.value_blob, confirmed_at = excluded.confirmed_at, source_answer_id = excluded.source_answer_id`).run(
          `fact_${String(row.fact_key)}`, String(row.fact_key), String(row.kind), String(row.label), row.country == null ? null : String(row.country),
          String(row.source_answer_id), row.freshness_days == null ? null : Number(row.freshness_days), now, this.deviceId, String(row.value_blob),
        );
        this.db.prepare("UPDATE applymind_proposals SET status = 'confirmed' WHERE id = ?").run(id);
        n++;
      }
    });
    return n;
  }

  rejectProposal(id: string): void {
    this.db.prepare("UPDATE applymind_proposals SET status = 'rejected' WHERE id = ? AND status = 'proposed'").run(id);
  }

  correctProposal(id: string, value: string, key: Uint8Array): boolean {
    const row = rows(this.db, "SELECT value_blob FROM applymind_proposals WHERE id = ? AND status = 'proposed'", id)[0];
    if (!row) return false;
    const body = openJson<{ question: string; value: string }>(key, String(row.value_blob));
    this.db.prepare('UPDATE applymind_proposals SET value_blob = ? WHERE id = ?').run(sealJson(key, { ...body, value }), id);
    return true;
  }

  fillContext(key: Uint8Array): { facts: { factKey: string; family: string; country: string | null; value: string; wordings: string[]; choices: { optionsKey: string; choice: string }[] }[]; drafts: Record<string, string> } {
    const wordings = rows(this.db, 'SELECT fact_key, normalized_question FROM applymind_fact_wordings');
    const choices = rows(this.db, 'SELECT fact_key, options_key, choice FROM applymind_fact_choices');
    const facts = rows(this.db, 'SELECT fact_key, kind, country, value_blob FROM applymind_facts').map((r) => {
      const factKey = String(r.fact_key);
      return {
        factKey,
        family: String(r.kind),
        country: r.country == null ? null : String(r.country),
        value: factText(key, String(r.value_blob)),
        wordings: wordings.filter((w) => String(w.fact_key) === factKey).map((w) => String(w.normalized_question)),
        choices: choices.filter((c) => String(c.fact_key) === factKey).map((c) => ({ optionsKey: String(c.options_key), choice: String(c.choice) })),
      };
    });
    const drafts: Record<string, string> = {};
    for (const status of ['accepted', 'verified'] as const) {
      for (const r of rows(this.db, `SELECT normalized_question, answer_blob FROM applymind_records WHERE deleted_at IS NULL AND status = ? AND question_type = 'long_form'`, status)) {
        drafts[String(r.normalized_question)] = openJson<string>(key, String(r.answer_blob));
      }
    }
    return { facts, drafts };
  }

  factPromptFor(factKey: string): boolean {
    if (rows(this.db, 'SELECT fact_key FROM applymind_facts WHERE fact_key = ?', factKey)[0]) return false;
    if (rows(this.db, "SELECT id FROM applymind_proposals WHERE fact_key = ? AND status = 'proposed'", factKey)[0]) return false;
    if (rows(this.db, 'SELECT fact_key FROM applymind_fact_declines WHERE fact_key = ?', factKey)[0]) return false;
    return true;
  }

  saveFact(fact: { factKey: string; kind: string; label: string; country: string | null; value: string; question: string }, key: Uint8Array, now: string): void {
    const sealed = sealJson(key, fact.value);
    this.db.prepare(`INSERT INTO applymind_facts(id, fact_key, kind, label, country, source_answer_id, freshness_days, confirmed_at, device_id, value_blob)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
      ON CONFLICT(fact_key) DO UPDATE SET value_blob = excluded.value_blob, confirmed_at = excluded.confirmed_at, label = excluded.label`).run(
      `fact_${fact.factKey}`, fact.factKey, fact.kind, fact.label, fact.country, now, this.deviceId, sealed,
    );
    this.db.prepare("UPDATE applymind_proposals SET status = 'confirmed' WHERE fact_key = ? AND status = 'proposed'").run(fact.factKey);
  }

  declineFact(factKey: string, now: string): void {
    this.db.prepare('INSERT INTO applymind_fact_declines(fact_key, at) VALUES (?, ?) ON CONFLICT(fact_key) DO UPDATE SET at = excluded.at').run(factKey, now);
  }

  approveWordings(items: { factKey: string; normalized: string }[]): void {
    for (const item of items) {
      this.db.prepare('INSERT INTO applymind_fact_wordings(fact_key, normalized_question) VALUES (?, ?) ON CONFLICT(fact_key, normalized_question) DO NOTHING').run(item.factKey, item.normalized);
    }
  }

  rememberChoice(factKey: string, optionsKey: string, choice: string): void {
    if (!factKey || !optionsKey || !choice) return;
    this.db.prepare('INSERT INTO applymind_fact_choices(fact_key, options_key, choice) VALUES (?, ?, ?) ON CONFLICT(fact_key, options_key) DO UPDATE SET choice = excluded.choice').run(factKey, optionsKey, choice);
  }

  /** A page answer resolves an open review or held record for the same question. */
  releaseQuestion(question: string, answer: string, key: Uint8Array, now: string): string | null {
    const normalized = canonicalizeQuestion(question).trim();
    const review = rows(this.db, "SELECT id, record_id FROM applymind_reviews WHERE status = 'open' AND normalized_question = ?", normalized)[0];
    const recordId = review ? String(review.record_id ?? '') : '';
    const row = recordId
      ? rows(this.db, 'SELECT id, provenance_json FROM applymind_records WHERE id = ?', recordId)[0]
      : rows(this.db, 'SELECT id, provenance_json FROM applymind_records WHERE deleted_at IS NULL AND normalized_question = ?', normalized)[0];
    if (!row) return null;
    const id = String(row.id);
    let held = false;
    try { held = isHeld(JSON.parse(String(row.provenance_json)) as Provenance); } catch { held = false; }
    if (!held && !review) return null;
    const provenance: Provenance = { kind: 'user_entered', sourceAnswerId: null, catalogId: null, factId: null };
    const sealed = sealJson(key, answer);
    this.db.prepare(`UPDATE applymind_records SET status = 'verified', provenance_json = ?, answer_blob = ?, confirmed_at = ?, updated_at = ?, deleted_at = NULL WHERE id = ?`).run(
      JSON.stringify(provenance), sealed, now, now, id,
    );
    this.addHistory(id, this.deviceId, now, 'corrected', 'verified', sealed);
    if (review) this.db.prepare("UPDATE applymind_reviews SET status = 'resolved', resolved_at = ? WHERE id = ?").run(now, String(review.id));
    return id;
  }

  learnLongForm(item: { question: string; answer: string; options: string[]; category: string; platform: string | null; jobTitle: string | null; company: string | null }, key: Uint8Array, now: string, status: 'verified' | 'accepted' = 'verified'): string {
    const normalized = canonicalizeQuestion(item.question).trim();
    const id = `kr_long_${createHash('sha256').update(`${normalized}|${item.company ?? ''}|${item.jobTitle ?? ''}`).digest('hex').slice(0, 24)}`;
    const context: AnswerContext = { ...GENERAL_CONTEXT, scope: 'job', platform: item.platform, jobTitle: item.jobTitle, location: item.company };
    const sealed = sealJson(key, item.answer);
    const existing = rows(this.db, 'SELECT answer_blob FROM applymind_records WHERE id = ?', id)[0];
    this.upsertPattern(id, item.category || 'general', normalized, this.deviceId, now);
    if (!existing) {
      this.db.prepare(`INSERT INTO applymind_records(id, source_answer_id, device_id, pattern_id, original_question, normalized_question,
        category, question_type, options_json, status, provenance_json, context_json, platform, answered_at, confirmed_at,
        freshness_days, answer_blob, deleted_at, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, 'long_form', ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`).run(
        id, this.deviceId, id, item.question, normalized, item.category || 'general', JSON.stringify(item.options), status,
        JSON.stringify({ kind: status === 'accepted' ? 'autofill' : 'user_entered', sourceAnswerId: null, catalogId: null, factId: null }),
        JSON.stringify(context), item.platform, now, now, sealed, now, now,
      );
      this.addHistory(id, this.deviceId, now, status === 'accepted' ? 'accepted' : 'created', status, sealed);
      return id;
    }
    const current = openJson<string>(key, String(existing.answer_blob));
    this.db.prepare('UPDATE applymind_records SET confirmed_at = ?, updated_at = ?, answer_blob = ?, deleted_at = NULL, status = ? WHERE id = ?').run(
      now, now, sealed, status, id,
    );
    if (current.trim() !== item.answer.trim()) this.addHistory(id, this.deviceId, now, status === 'accepted' ? 'accepted' : 'corrected', status, sealed);
    return id;
  }

  undoRecords(ids: string[], now: string): void {
    for (const id of ids) this.db.prepare('UPDATE applymind_records SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  }

  confirmedCount(): number {
    return Number(rows(this.db, 'SELECT COUNT(*) AS n FROM applymind_facts')[0]?.n ?? 0);
  }

  activeModel(): LearnedBundle | null {
    const row = rows(this.db, 'SELECT artifact_json FROM applymind_models WHERE active = 1 ORDER BY trained_at DESC LIMIT 1')[0];
    return row ? JSON.parse(String(row.artifact_json)) as LearnedBundle : null;
  }

  saveModel(bundle: LearnedBundle, active: boolean): void {
    this.tx(() => {
      if (active) this.db.prepare('UPDATE applymind_models SET active = 0 WHERE active = 1').run();
      this.db.prepare(`INSERT INTO applymind_models(version, trained_at, active, records, patterns, held_out_patterns, tier_a_unlocked, artifact_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(version) DO UPDATE SET active = excluded.active, artifact_json = excluded.artifact_json, trained_at = excluded.trained_at`).run(
        bundle.version, bundle.trainedAt, active ? 1 : 0, bundle.records, bundle.patterns, bundle.heldOutPatterns, bundle.tierAUnlocked ? 1 : 0, JSON.stringify(bundle),
      );
    });
  }

  historyCount(recordId: string): number {
    return Number(rows(this.db, 'SELECT COUNT(*) AS n FROM applymind_history WHERE record_id = ?', recordId)[0]?.n ?? 0);
  }

  /** Every stored ciphertext column, for tests that check plaintext never lands in the database. */
  sealedColumns(): string[] {
    const out: string[] = [];
    for (const sql of [
      'SELECT answer_blob AS b FROM applymind_records',
      'SELECT answer_blob AS b FROM applymind_history',
      'SELECT value_blob AS b FROM applymind_proposals',
      'SELECT value_blob AS b FROM applymind_facts',
    ]) {
      for (const row of rows(this.db, sql)) out.push(String(row.b));
    }
    return out;
  }

  private proposalSnapshot(key: Uint8Array): string {
    return rows(this.db, "SELECT fact_key, value_blob FROM applymind_proposals WHERE status = 'proposed'").map((r) => {
      const body = openJson<{ value: string }>(key, String(r.value_blob));
      return `${String(r.fact_key)}=${body.value.trim()}`;
    }).sort().join('|');
  }

  private upsertPattern(id: string, category: string, normalized: string, deviceId: string, now: string): void {
    this.db.prepare(`INSERT INTO applymind_patterns(id, category, normalized, created_at, device_id) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET normalized = excluded.normalized, category = excluded.category`).run(id, category, normalized, now, deviceId);
  }

  private insertRecord(rec: MigrationPlan['records'][number], sealed: string, now: string): void {
    this.db.prepare(`INSERT INTO applymind_records(id, source_answer_id, device_id, pattern_id, original_question, normalized_question,
      category, question_type, options_json, status, provenance_json, context_json, platform, answered_at, confirmed_at,
      freshness_days, answer_blob, deleted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
      rec.id, rec.sourceAnswerId, rec.deviceId, rec.patternId, rec.originalQuestion, rec.normalizedQuestion,
      rec.category, rec.questionType, JSON.stringify(rec.options), rec.status, JSON.stringify(rec.provenance),
      JSON.stringify(rec.context), rec.platform, rec.answeredAt, rec.confirmedAt, rec.freshnessDays, sealed, now, now,
    );
  }

  private addHistory(recordId: string, deviceId: string, at: string, action: string, status: string, blob: string): void {
    this.db.prepare('INSERT INTO applymind_history(id, record_id, at, device_id, action, status, answer_blob) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      randomUUID(), recordId, at, deviceId, action, status, blob,
    );
  }

  private tx(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}

function factText(key: Uint8Array, blob: string): string {
  const opened = openJson<unknown>(key, blob);
  if (typeof opened === 'string') return opened;
  if (opened && typeof opened === 'object' && 'value' in opened) return String((opened as { value: unknown }).value);
  return '';
}

export function blobIsSealed(blob: string): boolean {
  const parsed = JSON.parse(blob) as Sealed;
  return Boolean(parsed.iv && parsed.tag && parsed.data);
}
