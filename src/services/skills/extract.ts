import { escapeRegExp } from '@/utils/text';
import { SKILLS, SOFT_SKILLS, SKILL_BY_NAME, type SkillDef } from './taxonomy';

/** Boundary-aware regex for one alias. Handles names like C++, C#, .NET, CI/CD. */
function aliasRegex(alias: string, caseSensitive: boolean): RegExp {
  const body = escapeRegExp(alias);
  // Short aliases ("Go", "ML") must not be followed by a hyphen ("Go-to-market").
  const tail = alias.length <= 2 ? '(?![A-Za-z0-9\\-’\'])' : '(?![A-Za-z0-9])';
  return new RegExp(`(?<![A-Za-z0-9])${body}${tail}`, caseSensitive ? 'g' : 'gi');
}

interface Compiled {
  def: SkillDef;
  patterns: RegExp[];
}

const COMPILED: Compiled[] = SKILLS.map((def) => ({
  def,
  patterns: def.aliases.map((a) => aliasRegex(a, Boolean(def.caseSensitive))),
}));

const SOFT_COMPILED = SOFT_SKILLS.map((s) => ({ name: s.name, patterns: s.aliases.map((a) => aliasRegex(a, false)) }));

const adHocCache = new Map<string, RegExp[]>();

/** Patterns for any skill name — taxonomy aliases when known, the literal name otherwise. */
export function patternsFor(skill: string): RegExp[] {
  const known = SKILL_BY_NAME.get(skill.toLowerCase());
  if (known) return COMPILED.find((c) => c.def === known)!.patterns;
  const viaAlias = COMPILED.find((c) => c.def.aliases.some((a) => a.toLowerCase() === skill.toLowerCase()));
  if (viaAlias) return viaAlias.patterns;
  let cached = adHocCache.get(skill);
  if (!cached) {
    cached = [aliasRegex(skill.trim(), false)];
    adHocCache.set(skill, cached);
  }
  return cached;
}

export function mentionsSkill(text: string, skill: string): boolean {
  return patternsFor(skill).some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

/** All taxonomy skills mentioned in text, in order of first appearance. */
export function findSkills(text: string): string[] {
  const hits: { name: string; index: number }[] = [];
  for (const c of COMPILED) {
    let first = Infinity;
    for (const re of c.patterns) {
      re.lastIndex = 0;
      const m = re.exec(text);
      if (m && m.index < first) first = m.index;
    }
    if (first !== Infinity) hits.push({ name: c.def.name, index: first });
  }
  // Prefer specific skills over umbrella duplicates found at the same place.
  return hits.sort((a, b) => a.index - b.index).map((h) => h.name);
}

export function findSoftSkills(text: string): string[] {
  return SOFT_COMPILED.filter((s) =>
    s.patterns.some((re) => {
      re.lastIndex = 0;
      return re.test(text);
    }),
  ).map((s) => s.name);
}

/** Canonical display name for a skill string (maps aliases to taxonomy names). */
export function canonicalSkill(skill: string): string {
  const t = skill.trim();
  const known = SKILL_BY_NAME.get(t.toLowerCase());
  if (known) return known.name;
  const viaAlias = SKILLS.find((d) => d.aliases.some((a) => a.toLowerCase() === t.toLowerCase()));
  return viaAlias ? viaAlias.name : t;
}

export function relatedSkills(skill: string): string[] {
  const def = SKILL_BY_NAME.get(canonicalSkill(skill).toLowerCase());
  if (!def) return [];
  const forward = def.related ?? [];
  const backward = SKILLS.filter((d) => d.related?.includes(def.name)).map((d) => d.name);
  return Array.from(new Set([...forward, ...backward]));
}

export function isKnownSkill(skill: string): boolean {
  return SKILL_BY_NAME.has(canonicalSkill(skill).toLowerCase());
}

/** Every taxonomy skill in the text with the exact words used and how often ("K8s" ×2 → Kubernetes). */
export function findSkillMentions(text: string): { name: string; surfaces: Map<string, number> }[] {
  const out: { name: string; surfaces: Map<string, number> }[] = [];
  for (const c of COMPILED) {
    const surfaces = new Map<string, number>();
    for (const re of c.patterns) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      for (const m of text.matchAll(g)) surfaces.set(m[0], (surfaces.get(m[0]) ?? 0) + 1);
    }
    if (surfaces.size) out.push({ name: c.def.name, surfaces });
  }
  return out;
}

export function skillCategory(skill: string): SkillDef['category'] | null {
  const direct = SKILL_BY_NAME.get(canonicalSkill(skill).toLowerCase())?.category;
  if (direct) return direct;
  // "Video on Demand (VOD)", "OTT Platforms", "AWS MediaLive": the first known skill inside the name.
  const inside = findSkills(skill)[0];
  return inside ? SKILL_BY_NAME.get(inside.toLowerCase())?.category ?? null : null;
}
