import { block } from './system';

const str = { type: 'string' } as const;
const strArr = { type: 'array', items: str } as const;

export const TAILOR_RESUME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'summary', 'skillGroups', 'experience', 'projects', 'certificationIndexes', 'additional', 'changes', 'unsupportedRequirements'],
  properties: {
    headline: str,
    summary: str,
    skillGroups: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['name', 'skills'], properties: { name: str, skills: strArr } },
    },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceId', 'bullets', 'technologies'],
        properties: { sourceId: str, bullets: strArr, technologies: strArr },
      },
    },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceName', 'bullets'],
        properties: { sourceName: str, bullets: strArr },
      },
    },
    certificationIndexes: { type: 'array', items: { type: 'integer' } },
    additional: strArr,
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'before', 'after', 'reason'],
        properties: { section: str, before: str, after: str, reason: str },
      },
    },
    unsupportedRequirements: strArr,
  },
} as const;

export interface TailorResumeReply {
  headline: string;
  summary: string;
  skillGroups?: { name: string; skills: string[] }[];
  skills?: string[];
  experience: { sourceId: string; bullets: string[]; technologies?: string[] }[];
  projects: { sourceName: string; bullets: string[] }[];
  certificationIndexes: number[];
  additional: string[];
  changes: { section: string; before: string; after: string; reason: string }[];
  unsupportedRequirements: string[];
}

export interface PromptPlan {
  today?: string;
  targetTitle: string;
  years: number;
  pageTarget: 'one_page' | 'two_pages' | 'flexible';
  requiredYears: number | null;
  bulletBudget: { sourceId: string; job: string; bullets: number }[];
  keywords: { keyword: string; spellings?: string[]; importance: string; useIn: string[]; evidence: string[] }[];
}

export interface TailorPromptInput {
  job: unknown;
  candidateFacts: unknown;
  allowedKeywords: string[];
  forbiddenKeywords: string[];
  length: 'one_page' | 'two_pages' | 'flexible';
  suggestedTitle: string;
  summaryDirection: string;
  plan?: PromptPlan;
}

export const ATS_WRITING_RULES = [
  'ATS RULES (keyword-based applicant tracking systems match words literally and weight the job title, skills used in recent jobs, and standard structure):',
  '1. Every job in CANDIDATE_FACTS.experience must appear by its sourceId with the number of bullets in PLAN.bulletBudget (one more or one fewer is fine). Never drop, merge or reorder jobs.',
  '2. Use the job posting’s exact wording for each PLAN keyword (its "spellings" are accepted variants), but only where the evidence names the same thing: a platform does not prove its framework ("Roku" is not "Roku SceneGraph"), and a category needs its tool named ("observability with Prometheus and Grafana"). Place each keyword where PLAN.keywords[].useIn says: "skills" → in skillGroups; "summary" → in the summary; "exp:<sourceId>" → in a bullet of THAT job only. Add a bracketed form (e.g. "HTTP Live Streaming (HLS)") only if it appears in that job’s facts or PLAN spellings.',
  '3. Bullets: start with a strong action verb, past tense — present tense only for a job whose endDate is "Present" (compare with PLAN.today). One accomplishment per bullet, 14–30 words: action + what was built or done + technologies + scope or result. Keep scope exactly as written: do not add "Led", "Owned", "Managed", "Architected", team sizes, counts, user numbers or "millions" unless that job’s facts say so. Copy every number exactly; never add or estimate numbers. Rewrite first-person or introductory lines ("Lead development of…", "Started my career…") as past-tense accomplishments. Ground each bullet in that job’s own facts — rephrase, combine or split its original bullets, but never move a technology, client or achievement to a different job.',
  '4. Within each job, put the bullets most relevant to this posting first. Use a job’s introductory description only if it adds scope (product, users, platforms).',
  '5. headline: PLAN.targetTitle, then " | " and 2–4 of the most important matching keywords (e.g. "Senior Video Playback Engineer | HLS, DRM, Player SDKs").',
  '6. summary: 3–4 sentences, 55–85 words, no "I", "my" or "we". Start with PLAN.targetTitle and exactly "PLAN.years+ years" of experience and the core domain; then the strongest matching skills, platforms and scope from the facts. Use 6–10 PLAN keywords naturally.',
  '7. skillGroups: 4–7 groups with plain category names (e.g. "Video Streaming", "Players & Devices", "Languages", "Cloud & DevOps"), 25–45 skills in total. Include every PLAN keyword whose useIn has "skills", in the job’s spelling, first in its group. Then add the candidate’s other relevant skills, languages and each job’s technologies from CANDIDATE_FACTS. Only names that appear in CANDIDATE_FACTS or PLAN.keywords.',
  '8. technologies (per job): up to 8 names taken only from that job’s own "technologies" list in CANDIDATE_FACTS, most relevant to this posting first. Empty array if the job has none.',
  '9. additional: return [] (ApplyFlow adds languages and publications from the facts itself).',
  '10. Never use any FORBIDDEN_KEYWORDS, in any section — the facts don’t show them; don’t list or claim them, and don’t hint at them ("exposure to", "familiar with"). List unmet job requirements in unsupportedRequirements instead.',
  '11. Plain, specific language a recruiter can scan. No clichés ("results-driven", "passionate", "proven track record", "team player", "synergy", "leverage"); don’t start more than two bullets with the same verb.',
].join('\n');

export function buildTailorResumePrompt(i: TailorPromptInput): string {
  const lengthRule =
    i.length === 'one_page'
      ? 'Target one page (about 450–600 words).'
      : i.length === 'two_pages'
        ? 'Target two full pages (about 750–1000 words).'
        : 'No page limit, but keep every bullet relevant.';
  const plan = i.plan ?? {
    targetTitle: i.suggestedTitle,
    years: 0,
    pageTarget: i.length,
    requiredYears: null,
    bulletBudget: [],
    keywords: i.allowedKeywords.map((k) => ({ keyword: k, importance: 'required', useIn: ['skills'], evidence: [] })),
  };
  return [
    'You are an expert technical resume writer and ATS specialist for US tech hiring. Rewrite the candidate’s resume for this job so it ranks at the top of keyword-based ATS filters and reads clearly to a recruiter — using ONLY the candidate’s facts.',
    ATS_WRITING_RULES,
    `12. changes: 3–8 entries explaining the main changes and why they help for this job. ${lengthRule}`,
    block('PLAN', plan),
    block('SUMMARY_DIRECTION', i.summaryDirection),
    block('ALLOWED_KEYWORDS', i.allowedKeywords.join(', ') || '(none)'),
    block('FORBIDDEN_KEYWORDS', i.forbiddenKeywords.join(', ') || '(none)'),
    block('JOB_POSTING', i.job),
    block('CANDIDATE_FACTS', i.candidateFacts),
  ].join('\n\n');
}

export interface RefinePromptInput extends TailorPromptInput {
  draft: unknown;
  findings: string[];
}

export function buildRefineResumePrompt(i: RefinePromptInput): string {
  return [
    'You are an expert technical resume writer and ATS specialist. ApplyFlow scanned the tailored resume draft below like an ATS would. Revise the draft to fix each FINDING — but only where that job’s facts support it; otherwise leave it and list it in unsupportedRequirements. Keep everything else as it is, return projects unchanged (same sourceName and bullets as in DRAFT), and return the complete resume in the same JSON shape.',
    ATS_WRITING_RULES,
    block('FINDINGS', i.findings.map((f, n) => `${n + 1}. ${f}`).join('\n')),
    block('DRAFT', i.draft),
    block('PLAN', i.plan ?? {}),
    block('ALLOWED_KEYWORDS', i.allowedKeywords.join(', ') || '(none)'),
    block('FORBIDDEN_KEYWORDS', i.forbiddenKeywords.join(', ') || '(none)'),
    block('JOB_POSTING', i.job),
    block('CANDIDATE_FACTS', i.candidateFacts),
  ].join('\n\n');
}
