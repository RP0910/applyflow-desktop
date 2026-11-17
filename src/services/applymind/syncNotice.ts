import type { CareerProfile } from '@/types';

/** Shown when Screening Q&A saved and the knowledge store did not. */
export class KnowledgeSyncError extends Error {
  constructor(
    message: string,
    readonly profile: CareerProfile,
  ) {
    super(message);
    this.name = 'KnowledgeSyncError';
  }
}

export function knowledgeSyncMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'ApplyMind could not store that answer. Your Screening Q&A answer was saved.';
}

export function profileSaveFeedback(syncError: string | null): { tone: 'success' | 'critical'; text: string } {
  if (syncError) return { tone: 'critical', text: syncError };
  return { tone: 'success', text: 'Profile saved.' };
}
