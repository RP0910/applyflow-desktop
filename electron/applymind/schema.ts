import type { DatabaseSync } from 'node:sqlite';

export function ensureApplyMindSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS applymind_patterns (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      normalized TEXT NOT NULL,
      created_at TEXT NOT NULL,
      device_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS applymind_records (
      id TEXT PRIMARY KEY,
      source_answer_id TEXT,
      device_id TEXT NOT NULL,
      pattern_id TEXT NOT NULL,
      original_question TEXT NOT NULL,
      normalized_question TEXT NOT NULL,
      category TEXT NOT NULL,
      question_type TEXT NOT NULL,
      options_json TEXT NOT NULL,
      status TEXT NOT NULL,
      provenance_json TEXT NOT NULL,
      context_json TEXT NOT NULL,
      platform TEXT,
      answered_at TEXT NOT NULL,
      confirmed_at TEXT NOT NULL,
      freshness_days INTEGER,
      answer_blob TEXT NOT NULL,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS applymind_records_source ON applymind_records(source_answer_id);
    CREATE TABLE IF NOT EXISTS applymind_history (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL,
      at TEXT NOT NULL,
      device_id TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      answer_blob TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS applymind_tombstones (
      id TEXT PRIMARY KEY,
      source_answer_id TEXT,
      pattern_id TEXT,
      deleted_at TEXT NOT NULL,
      device_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS applymind_proposals (
      id TEXT PRIMARY KEY,
      fact_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      country TEXT,
      source_answer_id TEXT NOT NULL,
      freshness_days INTEGER,
      status TEXT NOT NULL,
      value_blob TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS applymind_facts (
      id TEXT PRIMARY KEY,
      fact_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      country TEXT,
      source_answer_id TEXT,
      freshness_days INTEGER,
      confirmed_at TEXT NOT NULL,
      device_id TEXT NOT NULL,
      value_blob TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS applymind_reviews (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      normalized_question TEXT NOT NULL,
      question TEXT NOT NULL,
      record_id TEXT,
      other_record_id TEXT,
      answer_blob TEXT NOT NULL,
      other_answer_blob TEXT,
      context_json TEXT NOT NULL,
      other_context_json TEXT,
      origin TEXT NOT NULL,
      other_origin TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS applymind_fact_wordings (
      fact_key TEXT NOT NULL,
      normalized_question TEXT NOT NULL,
      PRIMARY KEY (fact_key, normalized_question)
    );
    CREATE TABLE IF NOT EXISTS applymind_fact_choices (
      fact_key TEXT NOT NULL,
      options_key TEXT NOT NULL,
      choice TEXT NOT NULL,
      PRIMARY KEY (fact_key, options_key)
    );
    CREATE TABLE IF NOT EXISTS applymind_fact_declines (
      fact_key TEXT PRIMARY KEY,
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS applymind_models (
      version TEXT PRIMARY KEY,
      trained_at TEXT NOT NULL,
      active INTEGER NOT NULL,
      records INTEGER NOT NULL,
      patterns INTEGER NOT NULL,
      held_out_patterns INTEGER NOT NULL,
      tier_a_unlocked INTEGER NOT NULL,
      artifact_json TEXT NOT NULL
    );
  `);
}
