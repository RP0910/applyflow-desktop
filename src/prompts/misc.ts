import { block } from './system';

export const EXPLAIN_SCORE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['explanation', 'improvements'],
  properties: {
    explanation: { type: 'string' },
    improvements: { type: 'array', items: { type: 'string' } },
  },
} as const;

export interface ExplainScoreReply {
  explanation: string;
  improvements: string[];
}

export function buildExplainScorePrompt(score: unknown, evidence: unknown, job: unknown): string {
  return [
    'Explain this estimated internal match score to the candidate in plain language (under 150 words).',
    'It is an estimate — never imply it predicts an employer ATS result or an interview.',
    'improvements: up to 5 truthful actions, e.g. "If you have used Terraform, add a bullet describing where" — never suggest claiming experience they do not have.',
    block('SCORE', score),
    block('SKILL_EVIDENCE', evidence),
    block('JOB_POSTING', job),
  ].join('\n\n');
}

export const IMPROVE_BULLET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions', 'note'],
  properties: {
    suggestions: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
} as const;

export interface ImproveBulletReply {
  suggestions: string[];
  note: string;
}

export function buildImproveBulletPrompt(bullet: string, jobContext: unknown, allowedKeywords: string[]): string {
  return [
    'Offer up to 3 improved versions of this resume bullet.',
    'Keep every fact, number and technology exactly as stated. You may: start with a strong action verb, tighten wording, make the outcome clearer, and use ALLOWED_KEYWORDS only if the bullet already implies them.',
    'note: one sentence on what would make it stronger if the candidate has more real detail (e.g., a measurable result they can add).',
    block('BULLET', bullet),
    block('ALLOWED_KEYWORDS', allowedKeywords.join(', ') || '(none)'),
    block('JOB_CONTEXT', jobContext),
  ].join('\n\n');
}
