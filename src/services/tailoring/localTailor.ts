import type { AtsPlan, CareerProfile, ChangeNote, ContactInfo, JobAnalysis, JobPosting, MasterResume, SkillEvidence, TailoredExperience, TailoredResume } from '@/types';
import { hasForm } from '@/services/ats/terms';
import { SKILLS_CAP, TECH_CAP, coreSkills, groupSkills, rankTechnologies, topKeywords } from './atsTailor';
import { allowedResume } from '@/services/resume/facts';
import { findSkills, isKnownSkill, mentionsSkill } from '@/services/skills/extract';
import { similarity, splitIntoLines, truncate, uniqCaseInsensitive } from '@/utils/text';
import { nowIso } from '@/utils/dates';
import { yearsOfExperience } from '@/services/matching/experience';
import { rankByJobEmphasis } from '@/services/matching/evidence';

export interface TailorInput {
  master: MasterResume;
  profile?: CareerProfile;
  job: JobPosting;
  analysis: JobAnalysis;
  evidence: SkillEvidence[];
  length: 'one_page' | 'two_pages' | 'flexible';
  version: number;
  plan?: AtsPlan | null;
}

function keywordScore(line: string, plan: AtsPlan | null | undefined): number {
  if (!plan) return 0;
  return plan.keywords.reduce((n, k) => n + (k.support === 'supported' && k.kind !== 'title' && k.forms.some((f) => hasForm(line, f)) ? k.weight : 0), 0);
}

export function contactFor(master: MasterResume, profile?: CareerProfile): ContactInfo {
  const c = master.parsed.contact;
  const links = uniqCaseInsensitive([
    ...(profile?.linkedinUrl ? [profile.linkedinUrl] : []),
    ...(profile?.githubUrl ? [profile.githubUrl] : []),
    ...(profile?.portfolioLinks ?? []),
    ...c.links,
  ]).slice(0, 4);
  return {
    fullName: profile?.fullName || c.fullName,
    email: profile?.email || c.email,
    phone: profile?.phone || c.phone,
    location: profile?.location || c.location,
    links,
  };
}

export function relevance(line: string, required: string[], preferred: string[], responsibilities: string[]): number {
  let s = 0;
  for (const k of required) if (mentionsSkill(line, k)) s += 2;
  for (const k of preferred) if (mentionsSkill(line, k)) s += 1;
  const best = responsibilities.reduce((m, r) => Math.max(m, similarity(line, r)), 0);
  s += best * 6;
  if (/\d/.test(line)) s += 0.5;
  return s;
}

function bulletCap(index: number, length: TailorInput['length']): number {
  if (length === 'flexible') return Infinity;
  if (length === 'one_page') return index === 0 ? 4 : index === 1 ? 3 : 2;
  return index === 0 ? 6 : index === 1 ? 4 : 3;
}

export function tailorLocally(i: TailorInput): TailoredResume {
  const a = allowedResume(i.master, i.profile);
  const changes: ChangeNote[] = [];
  const req = i.evidence.filter((e) => e.importance === 'required').map((e) => e.skill);
  const pref = i.evidence.filter((e) => e.importance === 'preferred').map((e) => e.skill);
  const resp = [...i.job.responsibilities, ...i.job.qualifications];
  const supported = i.evidence.filter((e) => e.status === 'strong' || e.status === 'partial');

  const rank = (s: string) => {
    const ev = i.evidence.find((e) => e.skill.toLowerCase() === s.toLowerCase() || mentionsSkill(s, e.skill));
    if (!ev) return 0;
    return (ev.importance === 'required' ? 10 : 5) + (ev.status === 'strong' ? 3 : ev.status === 'partial' ? 1 : -20);
  };
  const strongNames = supported.filter((e) => e.status === 'strong').map((e) => e.skill);
  const pool = uniqCaseInsensitive([...a.skills, ...strongNames.filter((n) => !a.skills.some((s) => mentionsSkill(s, n)))]);
  const sortedSkills = pool
    .map((s, idx) => ({ s, score: rank(s), idx }))
    .sort((x, y) => y.score - x.score || x.idx - y.idx)
    .map((x) => x.s);
  const skillCap = i.length === 'one_page' ? 14 : 20;
  const skills = sortedSkills.slice(0, skillCap);
  const promoted = skills.slice(0, 5).filter((s, idx) => a.skills.indexOf(s) !== idx);
  if (promoted.length) {
    changes.push({ section: 'Skills', before: a.skills.slice(0, 5).join(', '), after: skills.slice(0, 5).join(', '), reason: `Moved ${promoted.slice(0, 3).join(', ')} to the top because the job asks for them and your experience shows them.` });
  }
  const added = skills.filter((s) => !a.skills.some((x) => x.toLowerCase() === s.toLowerCase()));
  if (added.length) {
    changes.push({ section: 'Skills', before: '', after: added.join(', '), reason: 'Named explicitly because your work bullets already show these (not added from the job description alone).' });
  }

  const experience: TailoredExperience[] = a.experience.map((e, idx) => {
    const scored = e.bullets.map((b, bi) => ({ b, bi, s: relevance(b, req, pref, resp) + keywordScore(b, i.plan) * 0.6 }));
    const ordered = [...scored].sort((x, y) => y.s - x.s || x.bi - y.bi);
    const cap = Math.max(1, i.plan?.bulletBudget[e.id] ?? bulletCap(idx, i.length));
    const kwsIn = (b: string) => (i.plan?.keywords ?? []).filter((k) => k.support === 'supported' && k.kind !== 'title' && k.forms.some((f) => hasForm(b, f)));
    const intro = (b: string) => /^(?:lead|leading|working|responsible|started|focused|helping|supporting)\b/i.test(b) || /\b(?:my|I)\b/.test(b);
    const covered = new Set<string>();
    const keep: typeof scored = [];
    const left = [...scored];
    while (keep.length < cap && left.length) {
      left.sort((x, y) => {
        const gain = (z: (typeof scored)[number]) => kwsIn(z.b).filter((k) => !covered.has(k.term)).reduce((n, k) => n + k.weight, 0) + z.s * 0.3 - (intro(z.b) ? 4 : 0);
        return gain(y) - gain(x) || x.bi - y.bi;
      });
      const pick = left.shift()!;
      keep.push(pick);
      for (const k of kwsIn(pick.b)) covered.add(k.term);
    }
    const dropped = ordered.length - keep.length;
    if (keep.length && keep[0]!.bi !== 0) {
      changes.push({ section: `${e.title} at ${e.company}`, before: truncate(e.bullets[0] ?? '', 120), after: truncate(keep[0]!.b, 120), reason: 'Leads with the bullet that best matches the job’s responsibilities.' });
    }
    if (dropped > 0) {
      changes.push({ section: `${e.title} at ${e.company}`, before: `${e.bullets.length} bullets`, after: `${keep.length} bullets`, reason: `Removed ${dropped} less relevant bullet(s) to fit the ${i.length.replace('_', ' ')} target. The role and its dates stay.` });
    }
    return {
      sourceId: e.id,
      title: e.title,
      company: e.company,
      location: e.location,
      startDate: e.startDate,
      endDate: e.endDate,
      bullets: keep.map((k) => k.b),
      technologies: rankTechnologies(e.technologies ?? [], i.plan ?? null, TECH_CAP),
    };
  });

  const years = Math.floor(yearsOfExperience(a.experience));
  const recent = a.experience[0];
  let summary: string;
  const sentences = splitIntoLines(a.summary || i.profile?.professionalSummary || '');
  if (sentences.length) {
    const leads = (x: string) => (i.plan && hasForm(x, i.plan.targetTitle)) || /\b\d{1,2}\+?\s*years\b/i.test(x);
    const ordered = sentences.map((s, idx) => ({ s, idx, r: relevance(s, req, pref, resp) + keywordScore(s, i.plan) * 0.3 + (leads(s) ? 1000 : 0) })).sort((x, y) => y.r - x.r || x.idx - y.idx);
    summary = ordered.map((o) => (/[.!?]$/.test(o.s) ? o.s : `${o.s}.`)).join(' ');
    if (ordered[0]!.idx !== 0) changes.push({ section: 'Summary', before: truncate(sentences[0]!, 120), after: truncate(ordered[0]!.s, 120), reason: 'Reordered so the most job-relevant sentence comes first.' });
    const plan = i.plan;
    if (plan && plan.titleSource === 'job' && !hasForm(summary, plan.targetTitle)) {
      const top = topKeywords(plan, 3);
      const opener = `${plan.targetTitle} with ${plan.years ? `${plan.years}+ years of experience` : 'hands-on experience'}${top.length ? ` in ${top.join(', ')}` : ''}.`;
      summary = `${opener} ${summary}`;
      changes.push({ section: 'Summary', before: '', after: opener, reason: 'Opens with the job’s title (your past titles match it) and the years your job dates show.' });
    }
  } else {
    const top = strongNames.slice(0, 4);
    summary = `${recent?.title ?? 'Professional'} with ${years}+ years of experience${top.length ? `, including ${top.join(', ')}` : ''}.`;
    changes.push({ section: 'Summary', before: '(none)', after: summary, reason: 'Built only from your titles, dates and evidenced skills because the master resume has no summary.' });
  }

  const topStrong = rankByJobEmphasis(
    i.evidence.filter((e) => e.importance === 'required' && e.status === 'strong' && isKnownSkill(e.skill)).map((e) => e.skill),
    i.job.description,
  ).slice(0, 3);
  const baseTitle = i.plan?.titleSource === 'job' ? i.plan.targetTitle : a.headline || recent?.title || i.analysis.suggestedResumeTitle;
  const headKeys = i.plan ? topKeywords(i.plan, 3) : topStrong;
  const headline = headKeys.length ? `${baseTitle} | ${headKeys.join(', ')}` : baseTitle;

  const projects = a.projects
    .map((p) => ({ p, r: relevance(`${p.name} ${p.description} ${p.bullets.join(' ')}`, req, pref, resp) }))
    .filter((x, _, arr) => x.r > 0 || arr.length <= 2)
    .sort((x, y) => y.r - x.r)
    .slice(0, i.length === 'one_page' ? 1 : 3)
    .map(({ p }) => ({ name: p.name, description: p.description, bullets: p.bullets }));
  const certifications = [...a.certifications].sort((x, y) => findSkills(y).filter((s) => req.includes(s)).length - findSkills(x).filter((s) => req.includes(s)).length);

  const skillGroups = i.plan
    ? groupSkills(
        [
          ...i.plan.keywords.filter((k) => k.support === 'supported' && (k.kind === 'hard' || k.kind === 'certification')).map((k) => k.term),
          ...a.skills,
          ...a.experience.flatMap((e) => e.technologies ?? []),
        ],
        i.plan,
        SKILLS_CAP[i.length],
        coreSkills(i.master, i.profile),
      )
    : undefined;
  return {
    version: i.version,
    contact: contactFor(i.master, i.profile),
    headline,
    summary,
    skills: skillGroups ? skillGroups.flatMap((g) => g.skills) : skills,
    ...(skillGroups ? { skillGroups } : {}),
    experience,
    projects,
    education: a.education,
    certifications,
    additional: a.languages.length ? [`Languages: ${a.languages.join(', ')}`] : [],
    changes,
    issues: [],
    engine: 'local',
    model: null,
    generatedAt: nowIso(),
    editedByUser: false,
  };
}
