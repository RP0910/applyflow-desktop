import type { CareerProfile, MasterResume } from '@/types';
import { cleanJobTitle, coreTitle } from '@/services/ats/keywords';
import { titleAlignment } from '@/services/ats/plan';
import { allowedResume } from '@/services/resume/facts';
import { seniorityOf } from '@/services/matching/score';
import type { CompanyResearchReply } from '@/prompts/companyResearch';
import type { RoleTitleEntry } from '@/prompts/roleTitles';

const LEVELS = ['intern', 'junior', 'mid', 'senior', 'lead', 'staff', 'principal', 'manager', 'director', 'executive'] as const;

function seniorityPrefix(level: string): string {
  switch (level) {
    case 'intern':
      return 'Intern ';
    case 'junior':
      return 'Junior ';
    case 'mid':
      return '';
    case 'senior':
      return 'Senior ';
    case 'lead':
      return 'Lead ';
    case 'staff':
      return 'Staff ';
    case 'principal':
      return 'Principal ';
    case 'manager':
      return '';
    case 'director':
      return 'Director ';
    default:
      return '';
  }
}

/** Career ladder from the target posting title (index 0 = most recent employment period). */
export function ladderRoleTitles(jdTitle: string, count: number): string[] {
  const n = Math.max(0, count);
  if (!n) return [];
  const cleaned = cleanJobTitle(jdTitle);
  const core = coreTitle(jdTitle) || 'Software Engineer';
  const topIdx = Math.max(LEVELS.indexOf('junior'), LEVELS.indexOf(seniorityOf(jdTitle)));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0 && cleaned) {
      out.push(cleaned);
      continue;
    }
    const idx = Math.max(LEVELS.indexOf('junior'), topIdx - i);
    const level = LEVELS[idx] ?? 'mid';
    const title = `${seniorityPrefix(level)}${core}`.replace(/\s{2,}/g, ' ').trim();
    out.push(title || core);
  }
  return out;
}

/** Research pass supplies roleTitle when possible; otherwise derive from the job posting ladder. */
export function roleTitlesForCv(jdTitle: string, count: number, research?: CompanyResearchReply | null): string[] {
  const ladder = ladderRoleTitles(jdTitle, count);
  const byPeriod = new Map<number, string>();
  for (const c of research?.companies ?? []) {
    const t = c.roleTitle?.trim();
    if (t) byPeriod.set(c.periodIndex, t);
  }
  return ladder.map((fallback, i) => byPeriod.get(i) || fallback);
}

export class RoleTitleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleTitleValidationError';
  }
}

function levelRank(title: string): number {
  return LEVELS.indexOf(seniorityOf(title));
}

/** Structural + ATS checks before titles enter the CV Generate prompt (no master profile). */
export function validateRoleTitlePlan(roles: RoleTitleEntry[], count: number, jobTitle: string): string[] {
  if (roles.length !== count) throw new RoleTitleValidationError('Wrong number of role titles.');
  const byPeriod = new Map<number, string>();
  for (const r of roles) {
    const t = r.role_title.trim();
    if (r.periodIndex < 0 || r.periodIndex >= count || !t) throw new RoleTitleValidationError('Missing role title.');
    if (byPeriod.has(r.periodIndex)) throw new RoleTitleValidationError('Duplicate employment period.');
    if (t.length > 80) throw new RoleTitleValidationError('Role title too long.');
    byPeriod.set(r.periodIndex, t);
  }
  const titles = Array.from({ length: count }, (_, i) => byPeriod.get(i)!);
  for (let i = 1; i < titles.length; i++) {
    if (levelRank(titles[i]!) > levelRank(titles[i - 1]!) + 1) {
      throw new RoleTitleValidationError('Role seniority must not increase for older employment periods.');
    }
  }
  if (titles[0] && titleAlignment(jobTitle, [titles[0]]) === 'none') {
    throw new RoleTitleValidationError('The most recent role title does not align with the job posting.');
  }
  return titles;
}

/** Whether a JD-only suggested title is safe to use instead of the verified profile title. */
export function suggestedTitleAcceptable(suggested: string, verified: string, jobTitle: string, periodIndex: number): boolean {
  const s = suggested.trim();
  if (!s) return false;
  const v = verified.trim();
  if (periodIndex === 0 && titleAlignment(jobTitle, [s]) === 'none') return false;
  if (!v) return true;
  if (levelRank(s) > levelRank(v) + 1) return false;
  const rel = titleAlignment(v, [s]);
  return rel === 'same' || rel === 'close' || rel === 'family';
}

/** Map JD titles onto employment periods; keep verified titles when suggestions are not acceptable. */
export function applyTitlesWithVerifiedExperience(
  jdSuggested: string[],
  jobTitle: string,
  master: MasterResume,
  profile?: CareerProfile,
): { titles: string[]; keptVerified: number } {
  const exp = allowedResume(master, profile).experience;
  const titles: string[] = [];
  let keptVerified = 0;
  for (let i = 0; i < jdSuggested.length; i++) {
    const verified = exp[i]?.title.trim() ?? '';
    const suggested = jdSuggested[i]!.trim();
    if (suggested && suggestedTitleAcceptable(suggested, verified, jobTitle, i)) titles.push(suggested);
    else if (verified) {
      titles.push(verified);
      keptVerified++;
    } else if (suggested) titles.push(suggested);
    else titles.push(ladderRoleTitles(jobTitle, jdSuggested.length)[i]!);
  }
  return { titles, keptVerified };
}

export function researchHasSavedRoleTitles(research: CompanyResearchReply, count: number): boolean {
  const slice = research.companies
    .slice()
    .sort((a, b) => a.periodIndex - b.periodIndex)
    .slice(0, count);
  return slice.length >= count && slice.every((c) => c.roleTitle.trim().length > 0);
}

export function mergeRoleTitlesIntoResearch(research: CompanyResearchReply, titles: string[]): CompanyResearchReply {
  return {
    companies: research.companies.map((c) => ({
      ...c,
      roleTitle: titles[c.periodIndex]?.trim() || c.roleTitle,
    })),
  };
}
