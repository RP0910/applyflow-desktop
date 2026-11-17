/** Classify a field at the end of a step. Does not store keystrokes. */

export type CaptureClass = 'verified' | 'correction' | 'accepted' | 'prefill' | 'rejected' | 'excluded';

export interface CaptureField {
  fieldId: string;
  label: string;
  control: string;
  options: string[];
  sensitive: string | null;
  /** Value at the first scan of this step, before the filler wrote anything. */
  baseline: string;
  finalValue: string;
  /** Value the filler wrote, or null if the filler did not write this field. */
  fillerValue: string | null;
  /** The user changed this field through a trusted event. */
  touched: boolean;
  /** The page rejected this field with its own validation. */
  rejected: boolean;
}

const SECRET = /\b(password|passcode|social security|ssn|national insurance|passport|driver'?s licen[cs]e|credit card|debit card|bank account|routing number|security (?:question|answer)|maiden name|government id|tax id|national id)\b/i;

export function isExcludedCapture(label: string, sensitive: string | null, control: string): boolean {
  if (control === 'file') return true;
  if (sensitive === 'legal_consent') return true;
  if (/\bcertif/i.test(label)) return true;
  if (SECRET.test(label)) return true;
  return false;
}

export function isLongFormQuestion(label: string, control: string): boolean {
  if (control !== 'textarea' && control !== 'text') return false;
  return /\b(why|explain|describe|ideal candidate|tell us about|motivation|walk us through)\b/i.test(label);
}

export function classifyCapture(field: CaptureField): CaptureClass {
  if (isExcludedCapture(field.label, field.sensitive, field.control)) return 'excluded';
  if (field.rejected || !field.finalValue.trim()) return 'rejected';
  const base = field.baseline.trim();
  const final = field.finalValue.trim();
  const filler = field.fillerValue?.trim() ?? null;
  if (field.touched && final !== base) return filler == null ? 'verified' : 'correction';
  if (filler != null && !field.touched && final === filler) return 'accepted';
  return 'prefill';
}

export interface PageLearnItem {
  kind: 'verified' | 'correction' | 'accepted';
  question: string;
  answer: string;
  control: string;
  options: string[];
  category: string;
  longForm: boolean;
  platform: string | null;
  jobTitle: string | null;
  company: string | null;
  country: string | null;
  factKey: string | null;
  factLabel: string | null;
  optionsKey: string | null;
}

export interface FactPrompt {
  factKey: string;
  label: string;
  value: string;
  question: string;
  country: string | null;
}

/** A page error names this question, so the page did not accept the value. */
export function fieldRejected(label: string, pageErrors: readonly string[]): boolean {
  const key = label.trim().toLowerCase();
  if (!key) return false;
  return pageErrors.some((e) => e.toLowerCase().includes(key));
}
