import { canonicalizeQuestion } from '@/services/forms/questionMatch';
import type { AnswerContext, AnswerStatus } from './types';

export const GENERAL_CONTEXT: AnswerContext = {
  platform: null,
  jobTitle: null,
  skills: [],
  location: null,
  remote: null,
  seniority: null,
  employmentType: null,
  scope: 'general',
};

export interface ExactRecord {
  normalizedQuestion: string;
  answer: string;
  status: AnswerStatus;
  context: AnswerContext;
}

export interface ExactLookup {
  question: string;
  options: string[];
  control: string;
  context?: Partial<AnswerContext> | null;
}

const CHOICE = new Set(['radio', 'select', 'combobox', 'checkbox']);

/** A general answer fits any job. A job-scoped answer fits only that same job. */
export function contextsCompatible(record: AnswerContext, live: Partial<AnswerContext> | null | undefined): boolean {
  if (record.scope !== 'job') return true;
  if (!live || live.scope === 'general' || !live.scope) return false;
  if (record.platform && live.platform && record.platform !== live.platform) return false;
  if (record.jobTitle && live.jobTitle && record.jobTitle !== live.jobTitle) return false;
  return Boolean(live.platform || live.jobTitle);
}

/** The stored answer is the control value only when one option is the same text. */
export function unambiguousControlValue(control: string, options: string[], answer: string): string | null {
  const value = answer.trim();
  if (!value) return null;
  if (!CHOICE.has(control) || options.length === 0) return value;
  const hits = options.filter((o) => o.trim().toLowerCase() === value.toLowerCase());
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * Exact reuse: same normalized question, a verified answer, a compatible context,
 * and one unambiguous control value. No model and no similarity score.
 */
export function exactVerifiedValue(records: ExactRecord[], query: ExactLookup): string | null {
  const normalized = canonicalizeQuestion(query.question).trim();
  if (!normalized) return null;
  const hits = records.filter((r) => r.status === 'verified' && r.normalizedQuestion.trim() === normalized && contextsCompatible(r.context, query.context));
  const answers = [...new Set(hits.map((h) => h.answer.trim()).filter(Boolean))];
  if (answers.length !== 1) return null;
  return unambiguousControlValue(query.control, query.options, answers[0]!);
}
