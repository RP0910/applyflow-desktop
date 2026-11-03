import type { CoverLetterAction, CoverLetterTone } from '@/types';
import { block } from './system';

export const COVER_LETTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: { text: { type: 'string' } },
} as const;

export interface CoverLetterReply {
  text: string;
}

const TONE_GUIDE: Record<CoverLetterTone, string> = {
  professional: 'Professional and measured. Clear, courteous, no slang.',
  warm: 'Warm and personable, still concise. Shows genuine interest without gushing.',
  direct: 'Direct and economical. Short sentences. Lead with the strongest fit.',
  technical: 'Technical. Name specific systems, tools and architectural decisions from the facts.',
  startup: 'Startup-oriented. Emphasize ownership, speed, scrappiness and breadth — only where the facts show it.',
};

export interface CoverLetterPromptInput {
  job: unknown;
  candidateFacts: unknown;
  allowedKeywords: string[];
  forbiddenKeywords: string[];
  tone: CoverLetterTone;
  minWords: number;
  maxWords: number;
  candidateName: string;
}

export function buildCoverLetterPrompt(i: CoverLetterPromptInput): string {
  return [
    `Write a cover letter of ${i.minWords}–${i.maxWords} words for this job.`,
    `Tone: ${TONE_GUIDE[i.tone]}`,
    'Structure: a clear opening naming the role; one or two concrete examples from the candidate’s real experience that map to the job’s most important responsibilities; a sentence on remote/location fit only if the facts state it; a simple closing call to action.',
    'Sound like a person wrote it. No flattery of the company beyond one specific, factual reason for interest drawn from the posting. No headers, no placeholders like [Company Address].',
    `Start with "Dear Hiring Team," (or the hiring manager's name if the posting gives one) and sign off with the candidate's name: ${i.candidateName || 'the candidate'}.`,
    block('ALLOWED_KEYWORDS', i.allowedKeywords.join(', ') || '(none)'),
    block('FORBIDDEN_KEYWORDS', i.forbiddenKeywords.join(', ') || '(none)'),
    block('JOB_POSTING', i.job),
    block('CANDIDATE_FACTS', i.candidateFacts),
  ].join('\n\n');
}

const ACTION_GUIDE: Record<CoverLetterAction, string> = {
  regenerate: 'Write a fresh version with a different opening and a different concrete example where the facts allow.',
  shorter: 'Make it about 30% shorter while keeping the strongest example and the call to action. Do not go under 180 words.',
  more_natural: 'Make it sound more natural and conversational, like a thoughtful person wrote it. Remove stiff phrasing and clichés.',
  more_technical: 'Make it more technical: name the specific systems, tools, and design decisions from the facts. Do not add anything not in the facts.',
};

export function buildReviseCoverLetterPrompt(current: string, action: CoverLetterAction, base: CoverLetterPromptInput): string {
  return [
    `Revise the cover letter below. ${ACTION_GUIDE[action]}`,
    'All original rules still apply: facts only, no invented metrics, no forbidden keywords.',
    block('CURRENT_LETTER', current),
    buildCoverLetterPrompt(base),
  ].join('\n\n');
}
