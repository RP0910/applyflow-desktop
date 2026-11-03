/**
 * Automatic, conservative fixes for validator issues: always move the resume
 * back toward the master's facts, never toward new claims.
 */
import type { AtsPlan, CareerProfile, MasterResume, TailoredResume, ValidationIssue } from '@/types';
import { allowedCorpus, allowedResume } from '@/services/resume/facts';
import { findSkills, mentionsSkill } from '@/services/skills/extract';
import { similarity, splitIntoLines } from '@/utils/text';
import { hasForm, sameKeyword, termKey } from '@/services/ats/terms';
import { yearsOfExperience } from '@/services/matching/experience';
import { bulletProblems, findInventedCounts, findInventedMetrics, findUnsupportedSkills, forbiddenForms, grounded, jobFactsText, planForms, techTerms } from './validator';
import { contactFor } from './localTailor';
import { fixYearsClaims, topKeywords } from './atsTailor';

function closestOriginal(line: string, originals: string[], used: Set<string>): string | null {
  let best: string | null = null;
  let bestSim = -1;
  for (const o of originals) {
    if (used.has(o)) continue;
    const s = similarity(line, o);
    if (s > bestSim) {
      bestSim = s;
      best = o;
    }
  }
  return best;
}

export function applyAutoFixes(
  t: TailoredResume,
  master: MasterResume,
  profile: CareerProfile | undefined,
  issues: ValidationIssue[],
  supportedExtra: string[] = [],
  plan: AtsPlan | null = null,
): TailoredResume {
  const a = allowedResume(master, profile);
  const corpus = allowedCorpus(master, profile);
  const extra = [...supportedExtra, ...(profile?.verifiedSkills ?? [])];
  const forbidden = forbiddenForms(plan);
  const formsOf = planForms(plan);
  const next: TailoredResume = structuredClone(t);
  const codes = new Set(issues.filter((i) => i.autoFixable).map((i) => i.code));

  if (codes.has('invented_employer') || codes.has('invented_title') || codes.has('changed_dates') || codes.has('hidden_gap')) {
    next.experience = a.experience.map((m) => {
      const cur = next.experience.find((e) => e.sourceId === m.id);
      return {
        sourceId: m.id, title: m.title, company: m.company, location: m.location, startDate: m.startDate, endDate: m.endDate,
        bullets: cur?.bullets.length ? cur.bullets : m.bullets.slice(0, Math.max(2, plan?.bulletBudget[m.id] ?? 2)),
        technologies: cur?.technologies ?? m.technologies ?? [],
      };
    });
  }
  if (codes.has('invented_metric') || codes.has('unsupported_skill') || codes.has('restricted_fact') || codes.has('moved_skill')) {
    const restricted = master.facts.filter((f) => f.status !== 'confirmed').map((f) => f.text);
    next.experience = next.experience.map((e) => {
      const m = a.experience.find((x) => x.id === e.sourceId);
      const originals = m?.bullets ?? [];
      const jobText = m ? jobFactsText(m) : '';
      const used = new Set<string>(e.bullets.filter((b) => originals.includes(b)));
      const bullets = e.bullets
        .map((b) => {
          const bad =
            findInventedMetrics(b, corpus).length > 0 ||
            findInventedCounts(b, corpus).length > 0 ||
            findUnsupportedSkills(b, corpus, extra).length > 0 ||
            bulletProblems(b, jobText, corpus, forbidden, formsOf).length > 0;
          if (!bad) return b;
          // Back to this job's own closest original bullet.
          const o = closestOriginal(b, originals, used);
          if (o) used.add(o);
          return o;
        })
        .filter((b): b is string => Boolean(b) && !restricted.some((r) => similarity(b!, r) >= 0.6));
      const own = m?.technologies ?? [];
      const technologies = (e.technologies ?? []).filter((x) => own.some((o) => termKey(o) === termKey(x) || sameKeyword(o, x)));
      return { ...e, bullets: Array.from(new Set(bullets)), technologies };
    });
    const okSkill = (s: string) => {
      if (forbidden.some((forms) => forms.some((f) => sameKeyword(s, f) || hasForm(s, f)))) return false;
      if (restricted.some((r) => r.toLowerCase() === s.toLowerCase())) return false;
      const known = findSkills(s);
      return known.length ? known.every((k) => mentionsSkill(corpus, k) || extra.includes(k)) : mentionsSkill(corpus, s) || extra.some((x) => sameKeyword(x, s));
    };
    next.skills = next.skills.filter(okSkill);
    if (next.skillGroups) next.skillGroups = next.skillGroups.map((g) => ({ ...g, skills: g.skills.filter(okSkill) })).filter((g) => g.skills.length);

    // Summary: drop only the sentences with unsupported claims; fall back to the master summary.
    const badSentence = (x: string) =>
      findInventedMetrics(x, corpus).length > 0 ||
      findUnsupportedSkills(x, corpus, extra).length > 0 ||
      forbidden.some((forms) => forms.some((f) => hasForm(x, f))) ||
      findInventedCounts(x, corpus).length > 0 ||
      techTerms(x).some(({ term, canonical }) => !grounded(term, canonical, corpus, formsOf(term)) && !extra.some((v) => sameKeyword(v, term)));
    const sentences = splitIntoLines(next.summary);
    if (sentences.some(badSentence)) {
      const kept = sentences.filter((x) => !badSentence(x));
      next.summary = kept.length >= 2 ? kept.map((x) => (/[.!?]$/.test(x) ? x : `${x}.`)).join(' ') : a.summary || kept.join(' ');
    }
    if (badSentence(next.headline)) {
      next.headline = plan ? [plan.targetTitle, topKeywords(plan, 3).join(', ')].filter(Boolean).join(' | ') : a.headline || a.experience[0]?.title || '';
    }
    next.additional = next.additional.filter((x) => !badSentence(x));
    // Project bullets go back to that project's own wording.
    next.projects = next.projects.map((p) => {
      const mp = a.projects.find((x) => x.name.trim().toLowerCase() === p.name.trim().toLowerCase());
      if (!mp) return p;
      const ptext = [mp.name, mp.description, ...mp.bullets].join('\n');
      const ok = p.bullets.every((b) => !findInventedMetrics(b, corpus).length && !findInventedCounts(b, corpus).length && !bulletProblems(b, ptext, corpus, forbidden, formsOf).length);
      return ok ? p : { ...p, bullets: mp.bullets };
    });
  }
  if (codes.has('years_claim')) {
    const years = plan?.years ?? Math.floor(yearsOfExperience(a.experience));
    next.summary = fixYearsClaims(next.summary, years);
    next.headline = fixYearsClaims(next.headline, years);
  }
  if (codes.has('invented_education')) next.education = a.education;
  if (codes.has('invented_certification')) next.certifications = next.certifications.filter((c) => a.certifications.some((m) => similarity(m, c) >= 0.6));
  if (codes.has('location_mismatch')) next.contact = { ...next.contact, location: contactFor(master, profile).location };
  return next;
}
