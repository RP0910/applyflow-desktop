import { block } from './system';

const str = { type: 'string' } as const;
const strArr = { type: 'array', items: str } as const;

export const ANALYZE_JOB_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'category', 'seniority', 'requiredSkills', 'preferredSkills', 'tools', 'responsibilities', 'industryTerms',
    'softSkills', 'expectedOutcomes', 'screeningQuestions', 'resumeKeywords', 'requiredYears', 'suggestedResumeTitle',
    'summaryDirection', 'risks', 'skillEvidence',
  ],
  properties: {
    category: str,
    seniority: { type: 'string', enum: ['entry', 'mid', 'senior', 'staff', 'principal', 'lead', 'manager', 'director', 'executive', 'unknown'] },
    requiredSkills: strArr,
    preferredSkills: strArr,
    tools: strArr,
    responsibilities: strArr,
    industryTerms: strArr,
    softSkills: strArr,
    expectedOutcomes: strArr,
    screeningQuestions: strArr,
    resumeKeywords: strArr,
    requiredYears: { type: ['integer', 'null'] },
    suggestedResumeTitle: str,
    summaryDirection: str,
    risks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'category', 'message'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
          category: { type: 'string', enum: ['clearance', 'work_authorization', 'sponsorship', 'education', 'experience', 'location', 'skills', 'other'] },
          message: str,
        },
      },
    },
    skillEvidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['skill', 'importance', 'status', 'evidenceQuotes'],
        properties: {
          skill: str,
          importance: { type: 'string', enum: ['required', 'preferred'] },
          status: { type: 'string', enum: ['strong', 'partial', 'none', 'conflict', 'needs_confirmation'] },
          evidenceQuotes: strArr,
        },
      },
    },
  },
} as const;

export interface AnalyzeJobReply {
  category: string;
  seniority: string;
  requiredSkills: string[];
  preferredSkills: string[];
  tools: string[];
  responsibilities: string[];
  industryTerms: string[];
  softSkills: string[];
  expectedOutcomes: string[];
  screeningQuestions: string[];
  resumeKeywords: string[];
  requiredYears: number | null;
  suggestedResumeTitle: string;
  summaryDirection: string;
  risks: { severity: 'critical' | 'warning' | 'info'; category: string; message: string }[];
  skillEvidence: { skill: string; importance: 'required' | 'preferred'; status: string; evidenceQuotes: string[] }[];
}

export function buildAnalyzeJobPrompt(job: unknown, candidateFacts: unknown): string {
  return [
    'Analyze this job posting against the candidate facts.',
    'For skillEvidence, list each required and preferred skill. evidenceQuotes must be copied VERBATIM from CANDIDATE_FACTS (short fragments are fine). Use status "none" when there is no evidence — never stretch.',
    'risks: flag hard requirements the candidate may not meet (clearance, citizenship/work authorization, sponsorship restrictions, required degrees, years of experience, onsite location).',
    'suggestedResumeTitle must be honest: a title close to the candidate’s real titles, phrased to align with this job where truthful.',
    'screeningQuestions: questions an employer is likely to ask; do not answer them.',
    block('JOB_POSTING', job),
    block('CANDIDATE_FACTS', candidateFacts),
  ].join('\n\n');
}
