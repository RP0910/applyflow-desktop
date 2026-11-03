/**
 * The submit gate. "Submit application" is enabled only when Dice's final step is on screen
 * and nothing below blocks it. Pressing that button — after the review summary — is the
 * user's final confirmation; ApplyFlow then clicks Dice's Submit button exactly once.
 */
import type { JobSession, ValidationIssue } from '@/types';
import type { ApplyRunState } from './applyRunner';

export function unresolvedCritical(session: JobSession | null): ValidationIssue[] {
  if (!session) return [];
  return [...(session.resume?.issues ?? []), ...(session.includeCoverLetter ? session.coverLetter?.issues ?? [] : [])].filter((i) => i.severity === 'critical');
}

export interface GateInput {
  session: JobSession | null;
  run: ApplyRunState;
  duplicateApplied: boolean;
}

/** Reasons the application can't be submitted yet. Empty = ready. */
export function submitBlockers({ session, run, duplicateApplied }: GateInput): string[] {
  const out: string[] = [];
  if (!session) return ['Open a Dice job first.'];
  if (session.submittedAt) return ['Already submitted.'];
  if (!session.resume) out.push('Your tailored resume hasn’t been written yet.');
  const critical = unresolvedCritical(session);
  if (critical.length) out.push(`${critical.length} line${critical.length > 1 ? 's' : ''} in your documents couldn’t be verified — fix ${critical.length > 1 ? 'them' : 'it'} under Documents.`);
  if (duplicateApplied && !session.duplicateAcknowledged) out.push('You already applied to this job.');
  if (run.questions.length) out.push('Some questions still need your answer.');
  if (run.attachments.resume.state === 'failed' && !run.allowOriginalResume) out.push('Your tailored resume isn’t attached on Dice yet.');
  if (run.status !== 'ready') out.push('Dice’s final step (with its Submit button) isn’t on screen yet.');
  return out;
}
