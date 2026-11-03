/**
 * The ATS plan: which job keywords the candidate can truthfully use and where, the headline
 * title, the years figure, and how many bullets each job gets. Built before any writing so
 * Claude and the local engine work from the same, checkable instructions.
 */
import type { AtsKeyword, AtsPlan, CareerProfile, JobPosting, KeywordEvidence, MasterResume, SupportedKeyword } from '@/types';
import { allowedResume } from '@/services/resume/facts';
import { yearsOfExperience } from '@/services/matching/experience';
import { seniorityOf } from '@/services/matching/score';
import { canonicalSkill, relatedSkills, mentionsSkill } from '@/services/skills/extract';
import { SKILL_BY_NAME, SOFT_SKILLS } from '@/services/skills/taxonomy';
import { parseResumeDate } from '@/utils/dates';
import { tokens } from '@/utils/text';
import { cleanJobTitle, coreTitle } from './keywords';
import { hasStem } from './terms';
import { isBacked } from './backing';

interface Part {
  sourceId: string | null;
  where: KeywordEvidence['where'];
  text: string;
}

/** Every piece of the master resume (and confirmed profile skills) a keyword could be backed by. */
export function evidenceParts(master: MasterResume, profile?: CareerProfile): Part[] {
  const a = allowedResume(master, profile);
  const userSkills = master.facts.filter((f) => f.kind === 'skill' && f.source !== 'resume' && f.status === 'confirmed').map((f) => f.text);
  return [
    ...(a.headline ? [{ sourceId: null, where: 'headline' as const, text: a.headline }] : []),
    ...(a.summary ? [{ sourceId: null, where: 'summary' as const, text: a.summary }] : []),
    ...a.experience.flatMap((e) => [
      { sourceId: e.id, where: 'title' as const, text: e.title },
      ...e.bullets.map((b) => ({ sourceId: e.id, where: 'experience' as const, text: b })),
      ...((e.technologies ?? []).length ? [{ sourceId: e.id, where: 'technologies' as const, text: e.technologies!.join(', ') }] : []),
    ]),
    ...a.skills.map((s) => ({ sourceId: null, where: 'skills' as const, text: s })),
    ...a.projects.flatMap((p) => [p.name, p.description, ...p.bullets].filter(Boolean).map((t) => ({ sourceId: null, where: 'experience' as const, text: t }))),
    ...a.education.map((e) => ({ sourceId: null, where: 'education' as const, text: [e.degree, e.institution, ...e.details].filter(Boolean).join(', ') })),
    ...a.certifications.map((c) => ({ sourceId: null, where: 'certifications' as const, text: c })),
    ...[...(profile?.verifiedSkills ?? []), ...userSkills].map((s) => ({ sourceId: null, where: 'profile' as const, text: s })),
  ];
}

const FAMILY = /\b(engineer|developer|architect|manager|scientist|analyst|designer|administrator|consultant|lead|director|specialist|programmer)\b/i;

/** Does one of the candidate's real titles line up with the job title? */
type Alignment = 'same' | 'close' | 'family' | 'none';

export function titleAlignment(jobTitle: string, candidateTitles: string[]): Alignment {
  const core = coreTitle(jobTitle).toLowerCase();
  const coreTokens = new Set(tokens(core));
  let best: Alignment = 'none';
  const rank = { same: 3, close: 2, family: 1, none: 0 };
  for (const t of candidateTitles) {
    const c = coreTitle(t).toLowerCase();
    if (!c) continue;
    let r: Alignment = 'none';
    if (c === core) r = 'same';
    else {
      const ct = new Set(tokens(c));
      const shared = Array.from(coreTokens).filter((x) => ct.has(x)).length;
      const fam = core.match(FAMILY)?.[1]?.toLowerCase();
      const sameFamily = fam && new RegExp(`\\b${fam}\\b`, 'i').test(c);
      if (sameFamily && shared >= Math.max(2, coreTokens.size - 1)) r = 'close';
      else if (sameFamily && shared >= 2) r = 'close';
      else if (sameFamily || (FAMILY.test(c) && FAMILY.test(core) && /engineer|developer|programmer/i.test(c) && /engineer|developer|programmer/i.test(core))) r = 'family';
    }
    if (rank[r] > rank[best]) best = r;
  }
  return best;
}

const LEVELS = ['intern', 'junior', 'mid', 'senior', 'lead', 'staff', 'principal', 'manager', 'director', 'executive'];

/**
 * The title for the resume headline. ATS systems weight the job title heavily, so the job's own
 * title is used when the candidate's real titles line up with it (same role, seniority no
 * higher than they have held). Otherwise their most recent real title is used.
 */
export function targetTitleFor(job: Pick<JobPosting, 'title'>, master: MasterResume): { title: string; source: 'job' | 'resume' } {
  const a = master.parsed;
  const titles = [...a.experience.map((e) => e.title), a.headline].filter(Boolean);
  const jobTitle = cleanJobTitle(job.title);
  const recent = a.experience[0]?.title || a.headline || jobTitle;
  if (!jobTitle) return { title: recent, source: 'resume' };
  const align = titleAlignment(jobTitle, titles);
  if (align === 'none' || align === 'family') return { title: recent, source: 'resume' };
  const highest = Math.max(...titles.map((t) => LEVELS.indexOf(seniorityOf(t))));
  const wanted = LEVELS.indexOf(seniorityOf(jobTitle));
  if (wanted > highest && wanted >= LEVELS.indexOf('lead')) {
    // Don't claim Staff/Principal/Lead when the candidate hasn't held it: use the role without the level.
    return { title: coreTitle(jobTitle), source: 'job' };
  }
  return { title: jobTitle, source: 'job' };
}

/** Classify every job keyword against the master resume. Only 'supported' keywords may be used. */
export function classifyKeywords(keywords: AtsKeyword[], master: MasterResume, profile?: CareerProfile): SupportedKeyword[] {
  const parts = evidenceParts(master, profile);
  const titles = parts.filter((p) => p.where === 'title' || p.where === 'headline').map((p) => p.text);
  const supportedRank = (k: SupportedKeyword) => (k.support === 'supported' ? 0 : k.support === 'related' ? 1 : 2);
  const out: SupportedKeyword[] = keywords.map((k) => {
    if (k.kind === 'title') {
      const align = titleAlignment(k.term, titles);
      const ev = parts.filter((p) => (p.where === 'title' || p.where === 'headline') && titleAlignment(k.term, [p.text]) !== 'none');
      return {
        ...k,
        support: align === 'same' || align === 'close' ? 'supported' : align === 'family' ? 'related' : 'missing',
        evidence: ev.slice(0, 3).map((p) => ({ sourceId: p.sourceId, where: p.where, text: p.text })),
        placements: align === 'same' || align === 'close' ? ['headline', 'summary'] : [],
      };
    }
    let forms = k.forms;
    if (k.kind === 'soft') forms = [k.term, ...(SOFT_SKILLS.find((s) => s.name === k.term)?.aliases ?? [])];
    // The same rule the validator uses, so a placed keyword is never reverted afterwards.
    const hits =
      k.kind === 'soft'
        ? parts.filter((p) => forms.some((f) => hasStem(p.text, f)))
        : parts.filter((p) => isBacked(k.term, p.text, forms));
    if (hits.length) {
      const jobs = Array.from(new Set(hits.filter((h) => h.sourceId && h.where !== 'title').map((h) => h.sourceId!)));
      const placements = [
        ...(k.kind === 'hard' || k.kind === 'certification' ? ['skills'] : []),
        ...jobs.slice(0, 2).map((id) => `exp:${id}`),
      ];
      return { ...k, support: 'supported' as const, evidence: hits.slice(0, 4).map((p) => ({ sourceId: p.sourceId, where: p.where, text: p.text })), placements };
    }
    // Nearby experience is reported, never used as if it were the keyword itself.
    const canon = canonicalSkill(k.term);
    const def = SKILL_BY_NAME.get(canon.toLowerCase());
    const candidates = [...relatedSkills(canon), ...(def && canon.toLowerCase() !== k.term.toLowerCase() ? [canon] : [])];
    const near = candidates.find((r) => parts.some((p) => mentionsSkill(p.text, r)));
    return { ...k, support: near ? ('related' as const) : ('missing' as const), evidence: [], placements: [], ...(near ? { relatedTo: near } : {}) };
  });
  // The strongest supported keywords also belong in the summary.
  const top = out.filter((k) => k.support === 'supported' && (k.kind === 'hard' || k.kind === 'domain')).sort((a, b) => b.weight - a.weight).slice(0, 8);
  for (const k of top) if (!k.placements.includes('summary')) k.placements.push('summary');
  return out.sort((a, b) => supportedRank(a) - supportedRank(b) || b.weight - a.weight);
}

/**
 * Bullets per job: recent and relevant jobs get more, very old ones fewer, every job keeps at
 * least two (or all it has). A page target caps the total.
 */
export function bulletBudget(master: MasterResume, profile: CareerProfile | undefined, keywords: SupportedKeyword[], pageTarget: AtsPlan['pageTarget'], now = new Date()): Record<string, number> {
  const a = allowedResume(master, profile);
  const relevance = new Map<string, number>();
  for (const k of keywords) {
    if (k.support !== 'supported') continue;
    for (const e of k.evidence) if (e.sourceId) relevance.set(e.sourceId, (relevance.get(e.sourceId) ?? 0) + k.weight);
  }
  const most = Math.max(0, ...relevance.values());
  const base = pageTarget === 'one_page' ? [4, 3, 2, 2, 1] : pageTarget === 'two_pages' ? [7, 6, 4, 3, 3] : [9, 8, 6, 5, 4];
  const out: Record<string, number> = {};
  a.experience.forEach((e, i) => {
    let n = base[Math.min(i, base.length - 1)]!;
    const end = parseResumeDate(e.endDate || 'present', now);
    const yearsAgo = end !== null ? (now.getFullYear() * 12 + now.getMonth() - end) / 12 : 0;
    if (yearsAgo > 10) n = Math.min(n, 2);
    const rel = relevance.get(e.id) ?? 0;
    if (most > 0 && rel === most && i > 0) n += 1;
    if (most > 0 && rel < most * 0.15 && n > 2) n -= 1;
    const available = e.bullets.length;
    out[e.id] = Math.max(Math.min(2, available), Math.min(n, available, pageTarget === 'flexible' ? 99 : 7));
  });
  // Fill the page target with the most relevant remaining material (never past 7 per job).
  const target = pageTarget === 'one_page' ? 12 : pageTarget === 'two_pages' ? 22 : 30;
  let total = Object.values(out).reduce((x, y) => x + y, 0);
  while (total < target) {
    const pick = a.experience
      .filter((e) => out[e.id]! < Math.min(e.bullets.length, pageTarget === 'flexible' ? 99 : 7))
      .map((e, i) => ({ e, i, score: ((relevance.get(e.id) ?? 0) + 1) / (out[e.id]! + 1) / (1 + i * 0.25) }))
      .sort((x, y) => y.score - x.score)[0];
    if (!pick) break;
    out[pick.e.id]! += 1;
    total += 1;
  }
  return out;
}

export function buildAtsPlan(
  job: JobPosting,
  master: MasterResume,
  profile: CareerProfile | undefined,
  keywords: AtsKeyword[],
  pageTarget: AtsPlan['pageTarget'],
  requiredYears: number | null,
  now = new Date(),
): AtsPlan {
  const classified = classifyKeywords(keywords, master, profile);
  const a = allowedResume(master, profile);
  const t = targetTitleFor(job, master);
  return {
    targetTitle: t.title,
    titleSource: t.source,
    years: Math.floor(yearsOfExperience(a.experience, now)),
    pageTarget,
    bulletBudget: bulletBudget(master, profile, classified, pageTarget, now),
    keywords: classified,
    requiredYears,
  };
}

/** The keywords Claude and the validator must treat as off-limits. */
export function forbiddenTerms(plan: AtsPlan): string[] {
  return plan.keywords.filter((k) => k.support !== 'supported' && (k.kind === 'hard' || k.kind === 'domain' || k.kind === 'certification')).map((k) => k.term);
}
