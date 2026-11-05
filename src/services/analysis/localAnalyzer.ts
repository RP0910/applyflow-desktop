import type { CareerProfile, JobAnalysis, JobPosting, MasterResume, RiskWarning, SkillEvidence } from '@/types';
import { findSkills, findSoftSkills, canonicalSkill } from '@/services/skills/extract';
import { SKILL_BY_NAME } from '@/services/skills/taxonomy';
import { uniqCaseInsensitive, truncate as clip } from '@/utils/text';

const truncate = (s: string, n: number) => clip(s.trim().replace(/[.\s]+$/, ''), n);
import { nowIso } from '@/utils/dates';
import { newId } from '@/utils/id';
import { yearsOfExperience } from '@/services/matching/experience';
import { seniorityOf } from '@/services/matching/score';

const CATEGORY_RULES: { re: RegExp; category: string }[] = [
  { re: /\b(ai|ml|machine learning|llm|genai|generative|data scien|deep learning|nlp)\b/i, category: 'AI / Machine Learning' },
  { re: /\b(architect|architecture)\b/i, category: 'Software & Solutions Architecture' },
  { re: /\b(data engineer|analytics engineer|etl|data platform)\b/i, category: 'Data Engineering' },
  { re: /\b(devops|sre|site reliability|cloud engineer|platform engineer|infrastructure)\b/i, category: 'Cloud, DevOps & SRE' },
  { re: /\b(security|cyber|soc analyst|appsec|iam)\b/i, category: 'Security' },
  { re: /\b(qa|quality assurance|test|sdet)\b/i, category: 'QA & Test Engineering' },
  { re: /\b(product manager|product owner)\b/i, category: 'Product Management' },
  { re: /\b(project manager|program manager|scrum master)\b/i, category: 'Project & Program Management' },
  { re: /\b(analyst|business intelligence|bi developer)\b/i, category: 'Data & Business Analysis' },
  { re: /\b(engineer|developer|programmer|software)\b/i, category: 'Software Engineering' },
];

const SENIORITY_MAP: Record<string, JobAnalysis['seniority']> = {
  intern: 'entry', junior: 'entry', mid: 'mid', senior: 'senior', lead: 'lead', staff: 'staff', principal: 'principal', manager: 'manager', director: 'director', executive: 'executive',
};

const DOMAIN_TERMS = /\b(credit|lending|payments?|fintech|banking|insurance|healthcare|clinical|retail|e-?commerce|logistics|supply chain|telecom|government|federal|defense|regulated|regulatory|compliance|risk|fraud|identity|privacy|consumer data|marketing|advertising|energy|utilities|automotive|manufacturing)\b/gi;
const OUTCOME_VERB = /\b(improve|reduce|increase|deliver|enable|scale|establish|accelerate|drive|ensure|modernize|standardize|optimi[sz]e|launch)\b/i;

export function categorize(job: Pick<JobPosting, 'title' | 'description'>): string {
  for (const r of CATEGORY_RULES) if (r.re.test(job.title)) return r.category;
  for (const r of CATEGORY_RULES) if (r.re.test(job.description.slice(0, 1500))) return r.category;
  return 'General';
}

export function buildRisks(job: JobPosting, resume: MasterResume | null, profile?: CareerProfile, extractionUncertain = false): RiskWarning[] {
  const risks: RiskWarning[] = [];
  const add = (severity: RiskWarning['severity'], category: RiskWarning['category'], message: string) =>
    risks.push({ id: newId('risk'), severity, category, message });
  if (job.clearanceRequirements.length) {
    add('critical', 'clearance', `Security clearance mentioned: “${truncate(job.clearanceRequirements[0]!, 140)}”. ApplyFlow won’t answer clearance questions — review them yourself.`);
  }
  const citizen = job.workAuthorizationRequirements.find((l) => /citizen|green card|permanent resident/i.test(l));
  if (citizen) add('critical', 'work_authorization', `Citizenship or residency requirement: “${truncate(citizen, 140)}”. Confirm you meet it before applying.`);
  else if (job.workAuthorizationRequirements.length) add('warning', 'work_authorization', 'The posting mentions work authorization. You’ll answer that question manually.');
  if (job.sponsorshipLanguage.length) add('warning', 'sponsorship', `Sponsorship or contract-type restriction: “${truncate(job.sponsorshipLanguage[0]!, 140)}”.`);
  if (resume) {
    const hasDegree = resume.parsed.education.length > 0;
    const advanced = job.educationRequirements.find((l) => /master|ph\.?\s?d|doctorate|mba/i.test(l) && /required|must/i.test(l));
    if (job.educationRequirements.length && !hasDegree) add('warning', 'education', 'The posting lists an education requirement and no degree was found in your master resume.');
    else if (advanced && !resume.parsed.education.some((e) => /master|m\.s|ph\.?d|mba|doctor/i.test(e.degree))) {
      add('warning', 'education', `Advanced degree requirement: “${truncate(advanced, 120)}”. Your resume lists ${resume.parsed.education[0]?.degree || 'a different degree'}.`);
    }
  }
  if (job.remoteStatus === 'onsite' && profile?.remotePreference === 'remote') {
    add('warning', 'location', `This role is on-site in ${job.location || 'the listed location'}, and your profile prefers remote work.`);
  }
  if (job.externalApply) add('info', 'other', 'This job is applied for on the employer’s site. ApplyFlow can prepare documents but can’t fill that form.');
  if (extractionUncertain) add('warning', 'extraction', 'Some job information could not be verified. Please review the extracted content.');
  return risks;
}

export function screeningQuestionsFor(job: JobPosting, requiredYears: number | null, topSkills: string[]): string[] {
  const q: string[] = [];
  if (requiredYears) q.push(`Do you have ${requiredYears}+ years of relevant experience?`);
  if (job.workAuthorizationRequirements.length) q.push('Are you legally authorized to work in the United States?');
  if (job.sponsorshipLanguage.length || job.workAuthorizationRequirements.length) q.push('Will you now or in the future require visa sponsorship?');
  if (job.clearanceRequirements.length) q.push('Do you hold an active security clearance? At what level?');
  if (job.remoteStatus === 'onsite' || job.remoteStatus === 'hybrid') q.push(`Are you able to work ${job.remoteStatus === 'hybrid' ? 'hybrid' : 'on-site'} in ${job.location || 'the listed location'}?`);
  if (job.salary) q.push('What are your salary expectations?');
  for (const s of topSkills.slice(0, 3)) q.push(`Describe a project where you used ${s}.`);
  return q;
}

export function analyzeJobLocally(job: JobPosting, resume: MasterResume | null, profile?: CareerProfile, extractionUncertain = false): JobAnalysis {
  const required = uniqCaseInsensitive(job.requiredSkills.map(canonicalSkill));
  const preferred = uniqCaseInsensitive(job.preferredSkills.map(canonicalSkill)).filter((p) => !required.some((r) => r.toLowerCase() === p.toLowerCase()));
  const all = [...required, ...preferred];
  const tools = all.filter((s) => {
    const def = SKILL_BY_NAME.get(s.toLowerCase());
    return def && ['tool', 'devops', 'database', 'cloud', 'data', 'testing'].includes(def.category);
  });
  const industryTerms = uniqCaseInsensitive([
    ...all.filter((s) => SKILL_BY_NAME.get(s.toLowerCase())?.category === 'business'),
    ...Array.from(job.description.matchAll(DOMAIN_TERMS)).map((m) => m[0].toLowerCase()),
  ]).slice(0, 10);
  const requiredYears = (() => {
    const m = [...job.qualifications, ...job.responsibilities, job.description].join('\n').match(/(\d{1,2})\s*\+?\s*(?:years|yrs)/i);
    const n = m ? Number(m[1]) : null;
    return n && n <= 30 ? n : null;
  })();
  const seniority = SENIORITY_MAP[seniorityOf(job.title)] ?? 'unknown';
  const recentTitle = resume?.parsed.experience[0]?.title ?? resume?.parsed.headline ?? '';
  const years = resume ? Math.floor(yearsOfExperience(resume.parsed.experience)) : 0;
  const resumeText = resume ? resume.rawText : '';
  const evidencedTop = required.filter((s) => findSkills(resumeText).includes(s)).slice(0, 3);
  return {
    category: categorize(job),
    seniority,
    requiredSkills: required,
    preferredSkills: preferred,
    tools,
    responsibilities: job.responsibilities.slice(0, 12),
    industryTerms,
    softSkills: findSoftSkills(job.description),
    expectedOutcomes: job.responsibilities.filter((r) => OUTCOME_VERB.test(r)).slice(0, 5),
    screeningQuestions: screeningQuestionsFor(job, requiredYears, required),
    resumeKeywords: uniqCaseInsensitive([...required, ...preferred, ...tools]).slice(0, 25),
    requiredYears,
    missingQualifications: [],
    risks: buildRisks(job, resume, profile, extractionUncertain),
    suggestedResumeTitle: recentTitle || job.title,
    summaryDirection: resume
      ? `Lead with your ${years ? `${years}+ years` : 'experience'} as ${recentTitle || 'a professional'}${evidencedTop.length ? `, emphasizing ${evidencedTop.join(', ')}` : ''}. Mention only requirements your resume already supports.`
      : 'Add a master resume to get a personalized direction.',
    engine: 'local',
    model: null,
    analyzedAt: nowIso(),
  };
}

export function missingQualifications(evidence: SkillEvidence[], risks: RiskWarning[]): string[] {
  return [
    ...evidence.filter((e) => e.importance === 'required' && (e.status === 'none' || e.status === 'conflict')).map((e) => e.skill),
    ...risks.filter((r) => r.severity === 'critical').map((r) => r.message.split('.')[0]!),
  ];
}
