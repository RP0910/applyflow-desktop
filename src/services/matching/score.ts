/**
 * Transparent, estimated internal match score.
 * Factors and weights are fixed and explained in plain language. This is NOT an
 * employer ATS score and must always be shown with its disclaimer.
 *
 *   Required skills            40  (32 required coverage + 8 preferred/keyword coverage)
 *   Relevant experience        30  (15 years vs. requirement + 15 responsibility overlap)
 *   Job-title alignment        15
 *   ATS structure & readability 10
 *   Evidence quality             5
 *   Missing/uncertain requirements  0 to −15
 *   Unsupported claims (tailored only) 0 to −10
 */
import type { CareerProfile, JobAnalysis, JobPosting, MatchScore, ScoreComponent, SkillEvidence, ValidationIssue } from '@/types';
import { similarity, tokens, wordCount } from '@/utils/text';
import { findSkills } from '@/services/skills/extract';
import { yearsOfExperience } from './experience';

export const SCORE_DISCLAIMER =
  'Estimated internal score based on the factors below. It is not an employer’s ATS score and does not predict an interview.';

export interface ResumeView {
  email: string;
  phone: string;
  headline: string;
  summary: string;
  skills: string[];
  experience: { title: string; startDate: string; endDate: string; bullets: string[] }[];
  education: unknown[];
  sectionsPresent: { summary: boolean; skills: boolean; experience: boolean; education: boolean };
}

const WEIGHT: Record<SkillEvidence['status'], number> = { strong: 1, partial: 0.6, needs_confirmation: 0.3, conflict: 0, none: 0 };

const ROLE_FAMILIES: Record<string, string[]> = {
  architect: ['architect', 'architecture'],
  engineer: ['engineer', 'engineering', 'developer', 'programmer', 'swe'],
  manager: ['manager', 'management', 'head', 'director', 'vp'],
  scientist: ['scientist', 'researcher'],
  analyst: ['analyst', 'analytics'],
  designer: ['designer', 'ux', 'ui'],
  admin: ['administrator', 'admin', 'sre', 'operations'],
  consultant: ['consultant', 'advisor'],
  product: ['product'],
};
const RELATED_FAMILIES: [string, string][] = [['architect', 'engineer'], ['engineer', 'admin'], ['scientist', 'engineer'], ['manager', 'product']];
const SENIORITY_ORDER = ['intern', 'junior', 'mid', 'senior', 'lead', 'staff', 'principal', 'manager', 'director', 'executive'];

function familiesOf(title: string): string[] {
  const t = tokens(title);
  return Object.entries(ROLE_FAMILIES)
    .filter(([, words]) => words.some((w) => t.includes(w)))
    .map(([k]) => k);
}

export function seniorityOf(title: string): string {
  const t = title.toLowerCase();
  if (/\b(intern|internship)\b/.test(t)) return 'intern';
  if (/\b(junior|jr\.?|entry|associate)\b/.test(t)) return 'junior';
  if (/\b(chief|cto|cio|vp|vice president|svp|evp)\b/.test(t)) return 'executive';
  if (/\b(director|head of)\b/.test(t)) return 'director';
  if (/\bprincipal\b/.test(t)) return 'principal';
  if (/\bstaff\b/.test(t)) return 'staff';
  if (/\b(lead|team lead)\b/.test(t)) return 'lead';
  if (/\bmanager\b/.test(t)) return 'manager';
  if (/\b(senior|sr\.?|architect)\b/.test(t)) return 'senior';
  return 'mid';
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function listNames(xs: string[], max = 4): string {
  if (!xs.length) return '';
  const shown = xs.slice(0, max).join(', ');
  return xs.length > max ? `${shown} and ${xs.length - max} more` : shown;
}

export function scoreRequiredSkills(evidence: SkillEvidence[]): ScoreComponent {
  const req = evidence.filter((e) => e.importance === 'required');
  const pref = evidence.filter((e) => e.importance === 'preferred');
  const cov = (xs: SkillEvidence[]) => (xs.length ? xs.reduce((s, e) => s + WEIGHT[e.status], 0) / xs.length : 0);
  let score: number;
  if (!req.length && !pref.length) score = 20;
  else if (!pref.length) score = 40 * cov(req);
  else if (!req.length) score = 40 * cov(pref);
  else score = 32 * cov(req) + 8 * cov(pref);
  const strong = req.filter((e) => e.status === 'strong').length;
  const partial = req.filter((e) => e.status === 'partial').length;
  const missing = req.filter((e) => e.status === 'none' || e.status === 'conflict').map((e) => e.skill);
  const prefStrong = pref.filter((e) => e.status === 'strong' || e.status === 'partial').length;
  let explanation = req.length
    ? `Strong evidence for ${strong} of ${req.length} required skills${partial ? `, partial evidence for ${partial}` : ''}.`
    : 'The posting lists no clearly required skills, so preferred skills were used.';
  if (missing.length) explanation += ` No evidence for ${listNames(missing)}.`;
  if (pref.length) explanation += ` ${prefStrong} of ${pref.length} preferred or related keywords are supported.`;
  return { key: 'required_skills', label: 'Required skills', score: round1(score), max: 40, isPenalty: false, explanation };
}

export function scoreExperience(resume: ResumeView, job: Pick<JobPosting, 'responsibilities' | 'qualifications' | 'description'>, requiredYears: number | null, now = new Date()): ScoreComponent {
  const years = yearsOfExperience(resume.experience, now);
  const yearsScore = requiredYears ? 15 * clamp(years / requiredYears, 0, 1) : clamp(years * 3, 0, 15);
  const lines = (job.responsibilities.length ? job.responsibilities : job.qualifications).slice(0, 12);
  const bullets = resume.experience.flatMap((e) => e.bullets);
  let covered = 0;
  for (const l of lines) {
    const lSkills = findSkills(l);
    const hit = bullets.some((b) => similarity(l, b) >= 0.12 || (lSkills.length > 0 && lSkills.filter((s) => findSkills(b).includes(s)).length >= Math.min(2, lSkills.length)));
    if (hit) covered++;
  }
  const ctxScore = lines.length ? 15 * (covered / lines.length) : 7.5;
  const yearsText = requiredYears
    ? `Your resume dates show about ${years} years of experience; the job asks for ${requiredYears}+.`
    : `Your resume dates show about ${years} years of experience; the job does not state a minimum.`;
  const ctxText = lines.length
    ? ` ${covered} of ${lines.length} listed responsibilities resemble work described in your resume.`
    : ' The posting has no separate responsibilities list, so this part is neutral.';
  return { key: 'relevant_experience', label: 'Relevant experience', score: round1(yearsScore + ctxScore), max: 30, isPenalty: false, explanation: yearsText + ctxText };
}

export function scoreTitle(resume: ResumeView, jobTitle: string, profile?: Pick<CareerProfile, 'preferredTitles'>): ScoreComponent {
  const recent = resume.experience[0]?.title ?? '';
  const allTitles = [resume.headline, ...resume.experience.map((e) => e.title), ...(profile?.preferredTitles ?? [])].filter(Boolean);
  const jobFam = familiesOf(jobTitle);
  const recentFam = familiesOf(`${recent} ${resume.headline}`);
  const anyFam = new Set(allTitles.flatMap(familiesOf));
  let fam = 0;
  let famText: string;
  if (jobFam.some((f) => recentFam.includes(f))) {
    fam = 9;
    famText = `Your recent title (“${recent || resume.headline}”) is in the same role family.`;
  } else if (jobFam.some((f) => anyFam.has(f))) {
    fam = 6;
    famText = 'An earlier title or your headline is in the same role family.';
  } else if (jobFam.some((f) => RELATED_FAMILIES.some(([a, b]) => (a === f && recentFam.includes(b)) || (b === f && recentFam.includes(a))))) {
    fam = 5;
    famText = `Your recent title (“${recent}”) is in a closely related role family.`;
  } else {
    famText = 'Your titles are in a different role family than this job.';
  }
  const js = SENIORITY_ORDER.indexOf(seniorityOf(jobTitle));
  const rs = SENIORITY_ORDER.indexOf(seniorityOf(recent || resume.headline));
  const gap = Math.abs(js - rs);
  const sen = gap === 0 ? 3 : gap <= 2 ? 2 : gap <= 3 ? 1 : 0;
  const jt = new Set(tokens(jobTitle).filter((t) => !Object.values(ROLE_FAMILIES).flat().includes(t)));
  const rt = new Set(allTitles.flatMap(tokens));
  const overlap = Array.from(jt).filter((t) => rt.has(t));
  const dom = jt.size ? 3 * Math.min(1, overlap.length / Math.max(1, Math.min(jt.size, 3))) : 1.5;
  const explanation = `${famText} Seniority: job reads as ${seniorityOf(jobTitle)}, you as ${seniorityOf(recent || resume.headline)}.${overlap.length ? ` Shared focus words: ${overlap.slice(0, 4).join(', ')}.` : ''}`;
  return { key: 'title_alignment', label: 'Job-title alignment', score: round1(fam + sen + dom), max: 15, isPenalty: false, explanation };
}

export function scoreStructure(resume: ResumeView): ScoreComponent {
  const notes: string[] = [];
  let s = 0;
  if (resume.email && resume.phone) s += 2;
  else notes.push('add both email and phone');
  const sp = resume.sectionsPresent;
  const sections = [sp.experience, sp.skills, sp.education].filter(Boolean).length;
  s += (2 * sections) / 3;
  if (sections < 3) notes.push('use standard Experience, Skills and Education headings');
  const dated = resume.experience.filter((e) => e.startDate).length;
  if (resume.experience.length && dated === resume.experience.length) s += 2;
  else notes.push('give every role start and end dates');
  const bulletCounts = resume.experience.slice(0, 3).map((e) => e.bullets.length);
  if (bulletCounts.length && bulletCounts.every((n) => n >= 2 && n <= 8)) s += 2;
  else notes.push('keep 2–8 bullets for each recent role');
  const allText = [resume.summary, ...resume.skills, ...resume.experience.flatMap((e) => e.bullets)].join(' ');
  const wc = wordCount(allText);
  const longBullets = resume.experience.flatMap((e) => e.bullets).filter((b) => wordCount(b) > 45).length;
  if (wc >= 250 && wc <= 1200 && longBullets === 0) s += 2;
  else notes.push(wc > 1200 ? 'trim length' : longBullets ? 'shorten bullets over 45 words' : 'add more detail');
  const explanation = notes.length
    ? `Standard, parseable structure overall. To improve: ${notes.join('; ')}.`
    : 'Contact details, standard headings, consistent dates, bullet lengths and overall length all look ATS-friendly.';
  return { key: 'ats_structure', label: 'ATS structure & readability', score: round1(s), max: 10, isPenalty: false, explanation };
}

const ACTION_VERB = /^(architected|built|designed|led|developed|delivered|implemented|created|launched|reduced|increased|improved|migrated|automated|defined|introduced|owned|drove|scaled|mentored|managed|optimized|partnered|established|re-architected|productionized|wrote|maintained|cut|raised|shipped|deployed|integrated)\b/i;

export function scoreEvidenceQuality(resume: ResumeView, unconfirmedFacts: number, totalFacts: number): ScoreComponent {
  const bullets = resume.experience.flatMap((e) => e.bullets);
  const withMetric = bullets.filter((b) => /\d/.test(b)).length;
  const withVerb = bullets.filter((b) => ACTION_VERB.test(b.trim())).length;
  const n = Math.max(1, bullets.length);
  const metric = 2.5 * Math.min(1, withMetric / n / 0.5);
  const verbs = 1.5 * (withVerb / n);
  const confirmed = totalFacts ? 1 - unconfirmedFacts / totalFacts : 1;
  const score = metric + verbs + confirmed;
  const explanation = `${withMetric} of ${bullets.length} bullets include a measurable result and ${withVerb} start with a strong action verb.${unconfirmedFacts ? ` ${unconfirmedFacts} fact(s) are still marked “Needs review”.` : ''}`;
  return { key: 'evidence_quality', label: 'Evidence quality', score: round1(score), max: 5, isPenalty: false, explanation };
}

export function scoreMissing(evidence: SkillEvidence[], analysis: Pick<JobAnalysis, 'risks'>): ScoreComponent {
  const missing = evidence.filter((e) => e.importance === 'required' && (e.status === 'none' || e.status === 'conflict'));
  const unconfirmed = evidence.filter((e) => e.importance === 'required' && e.status === 'needs_confirmation');
  const critical = analysis.risks.filter((r) => r.severity === 'critical');
  const p = Math.min(9, missing.length * 3) + Math.min(3, unconfirmed.length) + Math.min(6, critical.length * 3);
  const parts: string[] = [];
  if (missing.length) parts.push(`${missing.length} required skill(s) with no evidence (${listNames(missing.map((m) => m.skill), 3)})`);
  if (unconfirmed.length) parts.push(`${unconfirmed.length} awaiting your confirmation`);
  if (critical.length) parts.push(`${critical.length} hard requirement(s) to check: ${critical.map((c) => c.category.replace('_', ' ')).join(', ')}`);
  return {
    key: 'missing_requirements',
    label: 'Missing or uncertain requirements',
    score: p ? -Math.min(15, p) : 0,
    max: 0,
    isPenalty: true,
    explanation: parts.length ? `Deducted for ${parts.join('; ')}. These are shown, never hidden.` : 'No missing required skills or hard-requirement conflicts were found.',
  };
}

export function scoreUnsupported(issues: ValidationIssue[]): ScoreComponent {
  const critical = issues.filter((i) => i.severity === 'critical').length;
  const warn = issues.filter((i) => i.severity === 'warning' && (i.code === 'unsupported_skill' || i.code === 'copied_job_text')).length;
  const p = Math.min(10, critical * 2 + warn);
  return {
    key: 'unsupported_claims',
    label: 'Unsupported or unverified claims',
    score: p ? -p : 0,
    max: 0,
    isPenalty: true,
    explanation: p ? `${critical} critical and ${warn} other truthfulness issue(s) in the tailored resume. Resolve them before submitting.` : 'Every claim in the tailored resume traces back to your master resume.',
  };
}

export function bandFor(total: number): MatchScore['band'] {
  if (total >= 80) return 'strong';
  if (total >= 65) return 'good';
  if (total >= 50) return 'fair';
  return 'weak';
}

export interface ScoreInput {
  resume: ResumeView;
  job: Pick<JobPosting, 'title' | 'responsibilities' | 'qualifications' | 'description'>;
  analysis: Pick<JobAnalysis, 'risks' | 'requiredYears'>;
  evidence: SkillEvidence[];
  profile?: Pick<CareerProfile, 'preferredTitles'>;
  unconfirmedFacts: number;
  totalFacts: number;
  issues?: ValidationIssue[];
  computedFor: MatchScore['computedFor'];
  now?: Date;
}

export function computeMatchScore(i: ScoreInput): MatchScore {
  const components: ScoreComponent[] = [
    scoreRequiredSkills(i.evidence),
    scoreExperience(i.resume, i.job, i.analysis.requiredYears, i.now),
    scoreTitle(i.resume, i.job.title, i.profile),
    scoreStructure(i.resume),
    scoreEvidenceQuality(i.resume, i.unconfirmedFacts, i.totalFacts),
    scoreMissing(i.evidence, i.analysis),
  ];
  if (i.computedFor === 'tailored') components.push(scoreUnsupported(i.issues ?? []));
  const total = Math.round(clamp(components.reduce((s, c) => s + c.score, 0), 0, 100));
  return { total, components, disclaimer: SCORE_DISCLAIMER, band: bandFor(total), computedFor: i.computedFor, computedAt: new Date().toISOString() };
}
