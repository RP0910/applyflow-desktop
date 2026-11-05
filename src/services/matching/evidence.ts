import type { CareerProfile, EvidenceStatus, MasterResume, SkillEvidence } from '@/types';
import { mentionsSkill, patternsFor, relatedSkills } from '@/services/skills/extract';
import { truncate } from '@/utils/text';
import { allowedResume } from '@/services/resume/facts';

export interface EvidenceIndex {
  contextLines: string[];
  skillLines: string[];
  profileSkills: string[];
  needsReview: string[];
  doNotUse: string[];
}

export function buildEvidenceIndex(resume: MasterResume, profile?: CareerProfile): EvidenceIndex {
  const a = allowedResume(resume);
  return {
    contextLines: [
      ...a.experience.flatMap((e) => e.bullets.map((b) => b)),
      ...a.experience.filter((e) => e.technologies?.length).map((e) => `Technologies at ${e.company || e.title}: ${e.technologies!.join(', ')}`),
      ...a.projects.flatMap((p) => [p.description ? `${p.name} — ${p.description}` : '', ...p.bullets]).filter(Boolean),
      ...a.experience.map((e) => e.title).filter(Boolean),
      a.summary,
    ].filter(Boolean),
    skillLines: [...a.skills, ...a.certifications],
    profileSkills: profile?.verifiedSkills ?? [],
    needsReview: resume.facts.filter((f) => f.status === 'needs_review').map((f) => f.text),
    doNotUse: resume.facts.filter((f) => f.status === 'do_not_use').map((f) => f.text),
  };
}

export function classifySkill(skill: string, importance: SkillEvidence['importance'], idx: EvidenceIndex): SkillEvidence {
  const ctx = idx.contextLines.filter((l) => mentionsSkill(l, skill));
  const doNotUse = idx.doNotUse.filter((l) => mentionsSkill(l, skill));
  const make = (status: EvidenceStatus, evidence: string[], note: string): SkillEvidence => ({
    skill,
    importance,
    status,
    evidence: evidence.slice(0, 3).map((e) => truncate(e, 180)),
    note,
  });

  if (ctx.length) {
    return make('strong', ctx, ctx.length > 1 ? `Shown in ${ctx.length} places in your experience.` : 'Shown in your work experience.');
  }
  if (doNotUse.length && !idx.skillLines.some((l) => mentionsSkill(l, skill))) {
    return make('conflict', doNotUse, 'Your resume mentions this, but you marked it “Do not use”. It won’t be added unless you change that.');
  }
  const listed = idx.skillLines.filter((l) => mentionsSkill(l, skill));
  if (listed.length) {
    return { ...make('partial', listed, 'Listed in your skills, but no work example mentions it. Add a bullet showing where you used it, if you have one.'), via: 'listed' };
  }
  if (idx.profileSkills.some((s) => mentionsSkill(s, skill) || s.toLowerCase() === skill.toLowerCase())) {
    return { ...make('partial', [], 'You confirmed this skill in your profile, but no resume bullet shows it.'), via: 'profile' };
  }
  const rel = relatedSkills(skill);
  for (const r of rel) {
    const relCtx = idx.contextLines.filter((l) => mentionsSkill(l, r));
    if (relCtx.length) {
      return { ...make('partial', relCtx, `Related experience found (${r}). ApplyFlow won’t claim ${skill} itself unless you confirm it.`), via: 'related' };
    }
  }
  const review = idx.needsReview.filter((l) => mentionsSkill(l, skill));
  if (review.length) {
    return make('needs_confirmation', review, 'Only found in facts marked “Needs review”. Confirm them in Verified Facts to use this.');
  }
  return make('none', [], 'No evidence in your master resume or profile.');
}

export function classifySkills(required: string[], preferred: string[], resume: MasterResume, profile?: CareerProfile): SkillEvidence[] {
  const idx = buildEvidenceIndex(resume, profile);
  const seen = new Set<string>();
  const out: SkillEvidence[] = [];
  for (const [list, importance] of [[required, 'required'], [preferred, 'preferred']] as const) {
    for (const s of list) {
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(classifySkill(s, importance, idx));
    }
  }
  return out;
}

export function mergeClaudeEvidence(
  local: SkillEvidence[],
  claude: { skill: string; importance: 'required' | 'preferred'; status: string; evidenceQuotes: string[] }[],
  allowedText: string,
): SkillEvidence[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%$+#.]+/g, ' ').trim();
  const corpus = norm(allowedText);
  const out = [...local];
  for (const c of claude) {
    const existing = out.find((e) => e.skill.toLowerCase() === c.skill.toLowerCase());
    const verified = c.evidenceQuotes.filter((q) => q.trim().length > 8 && corpus.includes(norm(q)));
    if (existing) {
      if (existing.status === 'none' && verified.length && (c.status === 'strong' || c.status === 'partial')) {
        existing.status = 'partial';
        existing.via = 'claude';
        existing.evidence = verified.slice(0, 3).map((q) => truncate(q, 180));
        existing.note = 'Claude found related wording in your resume. Review it — ApplyFlow treats it as partial evidence.';
      }
      continue;
    }
    if (c.status === 'strong' || c.status === 'partial') {
      out.push({
        skill: c.skill,
        importance: c.importance,
        status: verified.length ? 'partial' : 'needs_confirmation',
        via: 'claude' as const,
        evidence: verified.slice(0, 3),
        note: verified.length
          ? 'Identified by Claude with matching wording in your resume.'
          : 'Claude suggested evidence that could not be found word-for-word in your resume. Confirm before using.',
      });
    } else {
      out.push({ skill: c.skill, importance: c.importance, status: 'none', evidence: [], note: 'Identified by Claude as a job requirement. No evidence in your master resume.' });
    }
  }
  return out;
}

export function rankByJobEmphasis(skills: string[], jobText: string): string[] {
  const count = (s: string) => patternsFor(s).reduce((n, re) => n + (jobText.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))?.length ?? 0), 0);
  return skills.map((s, i) => ({ s, i, c: count(s) })).sort((a, b) => b.c - a.c || a.i - b.i).map((x) => x.s);
}

export function supportedKeywords(evidence: SkillEvidence[]): string[] {
  return evidence.filter((e) => e.status === 'strong' || (e.status === 'partial' && e.via !== 'related' && e.via !== 'claude')).map((e) => e.skill);
}

export function unsupportedKeywords(evidence: SkillEvidence[]): string[] {
  return evidence
    .filter((e) => e.status === 'none' || e.status === 'conflict' || e.status === 'needs_confirmation' || (e.status === 'partial' && (e.via === 'related' || e.via === 'claude')))
    .map((e) => e.skill);
}
