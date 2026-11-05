import type { AtsPlan, AtsReport, CareerProfile, MasterResume, SkillGroup, TailoredResume } from '@/types';
import type { PromptPlan } from '@/prompts/tailorResume';
import { allowedResume } from '@/services/resume/facts';
import { canonicalSkill, skillCategory } from '@/services/skills/extract';
import { CATEGORY_LABELS } from '@/services/skills/taxonomy';
import { hasForm, sameKeyword, termKey } from '@/services/ats/terms';
import { uniqCaseInsensitive, wordCount } from '@/utils/text';

export function allowedSkillNames(master: MasterResume, profile: CareerProfile | undefined, plan: AtsPlan | null): string[] {
  const a = allowedResume(master, profile);
  const user = master.facts.filter((f) => f.kind === 'skill' && f.source !== 'resume' && f.status === 'confirmed').map((f) => f.text);
  const supported = (plan?.keywords ?? []).filter((k) => k.support === 'supported' && (k.kind === 'hard' || k.kind === 'certification')).map((k) => k.term);
  return uniqCaseInsensitive([...supported, ...a.skills, ...a.experience.flatMap((e) => e.technologies ?? []), ...user, ...(profile?.verifiedSkills ?? [])]);
}

export function isAllowedSkill(name: string, allowed: string[]): boolean {
  const k = termKey(name);
  return allowed.some((a) => termKey(a) === k || sameKeyword(a, name));
}

function keywordWeight(name: string, plan: AtsPlan | null): number {
  const k = plan?.keywords.find((x) => x.support === 'supported' && (sameKeyword(x.term, name) || x.forms.some((f) => sameKeyword(f, name))));
  return k ? k.weight : 0;
}

export function rankTechnologies(techs: string[], plan: AtsPlan | null, cap = 12): string[] {
  return uniqCaseInsensitive(techs)
    .map((t, i) => ({ t, i, w: keywordWeight(t, plan) }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .slice(0, cap)
    .map((x) => x.t);
}

export function displaySkill(s: string): string {
  return /^[a-z]/.test(s) && !/^(?:i|web|tv|mac)[A-Z]/.test(s) ? s.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s;
}

export function groupSkills(pool: string[], plan: AtsPlan | null, cap: number, core: string[] = []): SkillGroup[] {
  const items = uniqCaseInsensitive(pool.map(displaySkill)).filter((s, i, arr) => arr.findIndex((x) => sameKeyword(x, s)) === i);
  const isCore = (s: string) => core.some((c) => termKey(c) === termKey(s) || sameKeyword(c, s));
  const scored = items.map((s, i) => ({ s, i, w: keywordWeight(s, plan) + (isCore(s) ? 0.1 : 0) }));
  const jobKeywords = scored.filter((x) => x.w >= 1).sort((a, b) => b.w - a.w || a.i - b.i);
  const coreOwn = scored.filter((x) => x.w < 1 && isCore(x.s)).slice(0, 16);
  const rest = scored.filter((x) => x.w < 1 && !isCore(x.s));
  const keep = [...jobKeywords, ...coreOwn, ...rest].slice(0, Math.max(cap, jobKeywords.length + coreOwn.length));
  const groups = new Map<string, { name: string; items: typeof keep; top: number }>();
  for (const it of keep) {
    const cat = skillCategory(it.s);
    const name = cat ? CATEGORY_LABELS[cat] : 'Additional Skills';
    const g = groups.get(name) ?? { name, items: [], top: 0 };
    g.items.push(it);
    g.top = Math.max(g.top, it.w);
    groups.set(name, g);
  }
  let list = Array.from(groups.values());
  if (list.length > 8) {
    const singles = list.filter((g) => g.items.length === 1 && g.name !== 'Additional Skills');
    list = list.filter((g) => !singles.includes(g));
    const extra = singles;
    let other = list.find((g) => g.name === 'Additional Skills');
    if (!other) {
      other = { name: 'Additional Skills', items: [], top: 0 };
      list.push(other);
    }
    for (const g of extra) {
      if (g === other) continue;
      other.items.push(...g.items);
      other.top = Math.max(other.top, g.top);
    }
  }
  return list
    .sort((a, b) => (a.name === 'Additional Skills' ? 1 : 0) - (b.name === 'Additional Skills' ? 1 : 0) || b.top - a.top || b.items.length - a.items.length)
    .map((g) => ({ name: g.name, skills: g.items.sort((a, b) => b.w - a.w || a.i - b.i).map((x) => x.s) }));
}

const YEARS_RE = /\b(\d{1,2})\s*\+?\s*(?:years|yrs)\b/gi;

export function fixYearsClaims(text: string, years: number): string {
  if (!years) return text;
  return text.replace(YEARS_RE, (m, n: string) => (Number(n) > years ? m.replace(n, String(years)) : m));
}

export interface OptimizeContext {
  plan: AtsPlan;
  master: MasterResume;
  profile?: CareerProfile;
}

export function coreSkills(master: MasterResume, profile?: CareerProfile): string[] {
  const a = allowedResume(master, profile);
  return uniqCaseInsensitive([...a.experience.slice(0, 2).flatMap((e) => e.technologies ?? []), ...a.skills.filter((s) => skillCategory(s) === 'language')]);
}

export const SKILLS_CAP = { one_page: 26, two_pages: 46, flexible: 60 } as const;
export const TECH_CAP = 8;

export function optimizeForAts(input: TailoredResume, ctx: OptimizeContext): TailoredResume {
  const t: TailoredResume = structuredClone(input);
  const { plan } = ctx;
  const a = allowedResume(ctx.master, ctx.profile);
  const allowed = allowedSkillNames(ctx.master, ctx.profile, plan);
  const cap = SKILLS_CAP[plan.pageTarget];

  const masterById = new Map(a.experience.map((e) => [e.id, e]));
  for (const e of t.experience) {
    const m = masterById.get(e.sourceId);
    if (!m) continue;
    const own = m.technologies ?? [];
    const kept = (e.technologies ?? []).filter((x) => own.some((o) => termKey(o) === termKey(x) || sameKeyword(o, x)));
    e.technologies = rankTechnologies(kept.length ? [...kept, ...own] : own, plan, TECH_CAP);
  }

  let groups: SkillGroup[] = (t.skillGroups ?? [])
    .map((g) => ({ name: g.name.trim() || 'Skills', skills: uniqCaseInsensitive(g.skills.map((s) => s.trim()).filter((s) => s && isAllowedSkill(s, allowed))) }))
    .filter((g) => g.skills.length);
  if (!groups.length) groups = groupSkills([...t.skills.filter((s) => isAllowedSkill(s, allowed)), ...a.skills], plan, cap, coreSkills(ctx.master, ctx.profile));
  const listed = () => groups.flatMap((g) => g.skills);
  for (const k of plan.keywords) {
    if (k.support !== 'supported' || (k.kind !== 'hard' && k.kind !== 'certification')) continue;
    if (hasForm(listed().join(', '), k.term)) continue;
    const display = /^[a-z]/.test(k.term) ? k.term.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : k.term;
    const syn = groups.find((g) => g.skills.some((s) => sameKeyword(s, k.term)));
    if (syn) {
      syn.skills = syn.skills.map((s) => (sameKeyword(s, k.term) ? display : s));
      continue;
    }
    const cat = skillCategory(canonicalSkill(k.term));
    const label = cat ? CATEGORY_LABELS[cat] : null;
    const target = (label && groups.find((g) => g.name.toLowerCase() === label.toLowerCase())) || groups.find((g) => g.skills.some((s) => skillCategory(s) && skillCategory(s) === cat)) || groups[0];
    if (target) target.skills.unshift(display);
    else groups.push({ name: label ?? 'Core Skills', skills: [display] });
  }
  t.skillGroups = groups.map((g) => ({ name: g.name, skills: uniqCaseInsensitive(g.skills) }));
  t.skills = uniqCaseInsensitive(listed());

  if (plan.titleSource === 'job' && !hasForm(t.headline, plan.targetTitle)) {
    const tail = t.headline.includes('|') ? t.headline.slice(t.headline.indexOf('|') + 1).trim() : topKeywords(plan, 3).join(', ');
    t.headline = tail ? `${plan.targetTitle} | ${tail}` : plan.targetTitle;
  }
  if (!t.headline.trim()) t.headline = [plan.targetTitle, topKeywords(plan, 3).join(', ')].filter(Boolean).join(' | ');

  t.summary = fixYearsClaims(t.summary, plan.years);
  t.headline = fixYearsClaims(t.headline, plan.years);

  const dupOf = [...t.education.map((e) => `${e.degree} ${e.institution}`), ...t.certifications].map(termKey).filter((d) => d.length >= 6);
  t.additional = t.additional.filter((x) => {
    const k = termKey(x);
    return k.length > 2 && !dupOf.some((d) => k === d || k.includes(d) || d.includes(k)) && !/\b(bachelor|master'?s? degree|university|college)\b/i.test(x);
  });
  return t;
}

export function topKeywords(plan: AtsPlan, n: number): string[] {
  return plan.keywords
    .filter((k) => k.support === 'supported' && k.kind === 'hard' && !hasForm(plan.targetTitle, k.term))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n)
    .map((k) => k.term);
}

export function promptPlan(plan: AtsPlan, master: MasterResume): PromptPlan {
  const jobs = new Map(master.parsed.experience.map((e) => [e.id, e]));
  return {
    today: new Date().toISOString().slice(0, 10),
    targetTitle: plan.targetTitle,
    years: plan.years,
    pageTarget: plan.pageTarget,
    requiredYears: plan.requiredYears,
    bulletBudget: Object.entries(plan.bulletBudget).map(([sourceId, bullets]) => ({ sourceId, job: `${jobs.get(sourceId)?.title ?? ''} at ${jobs.get(sourceId)?.company ?? ''}`, bullets })),
    keywords: plan.keywords
      .filter((k) => k.support === 'supported' && k.kind !== 'title' && k.kind !== 'soft')
      .slice(0, 70)
      .map((k) => ({
        keyword: k.term,
        spellings: k.forms.filter((f) => f !== k.term).slice(0, 4),
        importance: k.importance,
        useIn: k.placements,
        evidence: k.evidence.slice(0, 2).map((e) => e.text.slice(0, 160)),
      })),
  };
}

export function refineFindings(t: TailoredResume, report: AtsReport, plan: AtsPlan): string[] {
  const out: string[] = [];
  const planned = new Map(plan.keywords.map((k) => [k.term, k]));
  const missing = report.keywords.filter((r) => r.support === 'supported' && r.found === 'missing' && (r.kind === 'hard' || r.kind === 'domain'));
  if (missing.length) {
    out.push(`These job keywords are backed by the facts but missing from the draft — add each in the job’s exact wording where PLAN says: ${missing.map((r) => `"${r.term}" (${planned.get(r.term)?.placements.join(', ') || 'skills'})`).join('; ')}.`);
  }
  const ctxMissing = report.keywords.filter((r) => r.support === 'supported' && r.found !== 'missing' && !r.inExperience && r.weight >= 3 && planned.get(r.term)?.placements.some((p) => p.startsWith('exp:')));
  if (ctxMissing.length) {
    out.push(`These keywords appear only in the Skills list, but the facts show them in a job — use each in a bullet of that job: ${ctxMissing.slice(0, 8).map((r) => `"${r.term}" (${planned.get(r.term)!.placements.filter((p) => p.startsWith('exp:')).join(', ')})`).join('; ')}.`);
  }
  const synonym = report.keywords.filter((r) => r.support === 'supported' && r.found === 'synonym' && r.weight >= 3);
  if (synonym.length) out.push(`Use the job’s exact wording for: ${synonym.slice(0, 6).map((r) => `"${r.term}"`).join(', ')}.`);
  if (plan.titleSource === 'job' && !hasForm(`${t.headline} ${t.summary}`, plan.targetTitle)) out.push(`Put the job title "${plan.targetTitle}" at the start of the headline and the summary.`);
  for (const e of t.experience) {
    const want = plan.bulletBudget[e.sourceId];
    if (want && Math.abs(e.bullets.length - want) > 1) out.push(`${e.title} at ${e.company} (sourceId ${e.sourceId}) has ${e.bullets.length} bullets; write ${want}.`);
    const long = e.bullets.filter((b) => wordCount(b) > 34);
    if (long.length) out.push(`Shorten these bullets to under 30 words: ${long.slice(0, 3).map((b) => `"${b.slice(0, 70)}…"`).join('; ')}.`);
  }
  const weak = report.checks.find((c) => c.id === 'verbs' && c.status !== 'pass');
  if (weak) out.push('Start every bullet with a strong action verb (Built, Designed, Led, Optimized, Integrated…), not "Responsible for" or "Worked on".');
  const summaryWords = wordCount(t.summary);
  if (summaryWords < 45 || summaryWords > 100) out.push(`The summary has ${summaryWords} words; write 55–85.`);
  return out;
}
