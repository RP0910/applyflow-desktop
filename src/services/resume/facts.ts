import type { CareerProfile, MasterResume, ParsedResume, VerifiedFact, FactStatus } from '@/types';
import { newId } from '@/utils/id';
import { nowIso } from '@/utils/dates';
import { parseResumeText } from './parser';

function key(kind: string, text: string): string {
  return `${kind}:${text.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

export function deriveFacts(parsed: ParsedResume, previous: VerifiedFact[] = []): VerifiedFact[] {
  const prev = new Map(previous.map((f) => [key(f.kind, f.text), f]));
  const out: VerifiedFact[] = [];
  const add = (kind: VerifiedFact['kind'], text: string) => {
    const t = text.trim();
    if (!t) return;
    const existing = prev.get(key(kind, t));
    out.push(existing ? { ...existing } : { id: newId('fact'), kind, text: t, status: 'confirmed', source: 'resume' });
  };
  parsed.skills.forEach((s) => add('skill', s));
  const listed = new Set(parsed.skills.map((s) => s.toLowerCase()));
  for (const t of parsed.experience.flatMap((e) => e.technologies ?? [])) {
    if (listed.has(t.toLowerCase())) continue;
    listed.add(t.toLowerCase());
    add('skill', t);
  }
  parsed.experience.forEach((e) => e.bullets.forEach((b) => add('experience', b)));
  parsed.projects.forEach((p) => {
    add('project', p.description ? `${p.name} — ${p.description}` : p.name);
    p.bullets.forEach((b) => add('project', b));
  });
  parsed.education.forEach((e) => add('education', [e.degree, e.institution, e.date].filter(Boolean).join(', ')));
  parsed.certifications.forEach((c) => add('certification', c));
  for (const f of previous) if (f.source !== 'resume' && !out.some((o) => o.id === f.id)) out.push(f);
  return out;
}

export const PARSER_VERSION = 3;

export function masterStamp(r: MasterResume): string {
  const confirmed = r.facts.filter((f) => f.status === 'confirmed').length;
  return `${r.id}|v${r.parserVersion ?? 1}|${r.parsed.experience.length}|${confirmed}/${r.facts.length}`;
}

export function buildMasterResume(
  name: string,
  rawText: string,
  format: MasterResume['sourceFormat'],
  fileName: string | null,
  existing?: MasterResume,
  sourceData?: ArrayBuffer | null,
): MasterResume {
  const parsed = parseResumeText(rawText);
  const now = nowIso();
  return {
    id: existing?.id ?? newId('res'),
    name: name.trim() || existing?.name || parsed.contact.fullName || 'Master resume',
    isDefault: existing?.isDefault ?? false,
    rawText,
    parsed,
    facts: deriveFacts(parsed, existing?.facts ?? []),
    sourceFileName: fileName ?? existing?.sourceFileName ?? null,
    sourceFormat: format,
    sourceData: sourceData !== undefined ? sourceData : (existing?.sourceData ?? null),
    parserVersion: PARSER_VERSION,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function statusOf(resume: MasterResume, kind: VerifiedFact['kind'], text: string): FactStatus {
  const f = resume.facts.find((x) => x.kind === kind && x.text.trim().toLowerCase() === text.trim().toLowerCase());
  return f?.status ?? 'confirmed';
}

export function allowedResume(resume: MasterResume, profile?: CareerProfile): ParsedResume {
  const p = resume.parsed;
  const ok = (kind: VerifiedFact['kind'], text: string) => statusOf(resume, kind, text) === 'confirmed';
  const userSkills = resume.facts.filter((f) => f.kind === 'skill' && f.source !== 'resume' && f.status === 'confirmed').map((f) => f.text);
  const profileSkills = profile?.verifiedSkills ?? [];
  const skills = Array.from(new Set([...p.skills.filter((s) => ok('skill', s)), ...userSkills, ...profileSkills]));
  return {
    ...p,
    skills,
    experience: p.experience.map((e) => ({
      ...e,
      bullets: e.bullets.filter((b) => ok('experience', b)),
      technologies: (e.technologies ?? []).filter((t) => ok('skill', t)),
    })),
    projects: p.projects
      .filter((pr) => ok('project', pr.description ? `${pr.name} — ${pr.description}` : pr.name))
      .map((pr) => ({ ...pr, bullets: pr.bullets.filter((b) => ok('project', b)) })),
    education: p.education.filter((e) => ok('education', [e.degree, e.institution, e.date].filter(Boolean).join(', '))),
    certifications: p.certifications.filter((c) => ok('certification', c)),
  };
}

export function restrictedFacts(resume: MasterResume): VerifiedFact[] {
  return resume.facts.filter((f) => f.status !== 'confirmed');
}

export function allowedCorpus(resume: MasterResume, profile?: CareerProfile): string {
  const a = allowedResume(resume, profile);
  return [
    a.headline,
    a.summary,
    a.skills.join(', '),
    ...a.experience.flatMap((e) => [e.title, e.company, ...e.bullets, (e.technologies ?? []).join(', ')]),
    ...a.projects.flatMap((p) => [p.name, p.description, ...p.bullets]),
    ...a.education.map((e) => [e.degree, e.institution, ...e.details].join(' ')),
    ...a.certifications,
    profile?.professionalSummary ?? '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function candidateFactsForPrompt(resume: MasterResume, profile?: CareerProfile) {
  const a = allowedResume(resume, profile);
  return {
    name: a.contact.fullName || profile?.fullName || '',
    location: profile?.location || a.contact.location,
    headline: a.headline,
    summary: a.summary || profile?.professionalSummary || '',
    skills: a.skills,
    experience: a.experience.map((e) => ({
      sourceId: e.id,
      title: e.title,
      company: e.company,
      location: e.location,
      startDate: e.startDate,
      endDate: e.endDate,
      bullets: e.bullets,
      technologies: e.technologies ?? [],
    })),
    projects: a.projects.map((p) => ({ sourceName: p.name, description: p.description, bullets: p.bullets })),
    education: a.education.map((e) => ({ degree: e.degree, institution: e.institution, date: e.date, location: e.location ?? '' })),
    certifications: a.certifications,
    preferredTitles: profile?.preferredTitles ?? [],
    remotePreference: profile?.remotePreference && profile.remotePreference !== 'any' ? profile.remotePreference : undefined,
  };
}

export type CandidateFacts = ReturnType<typeof candidateFactsForPrompt>;
