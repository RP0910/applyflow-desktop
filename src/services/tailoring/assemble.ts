/**
 * Assemble a TailoredResume from Claude's reply. Employer, title, dates, location,
 * education and certification text always come from the master resume, and every job
 * stays on the resume even if Claude leaves one out.
 */
import type { AtsPlan, CareerProfile, MasterResume, SkillGroup, TailoredResume } from '@/types';
import type { TailorResumeReply } from '@/prompts/tailorResume';
import { allowedResume } from '@/services/resume/facts';
import { nowIso } from '@/utils/dates';
import { similarity } from '@/utils/text';
import { hasForm } from '@/services/ats/terms';
import { contactFor } from './localTailor';
import { allowedSkillNames, groupSkills, isAllowedSkill } from './atsTailor';

export function keywordWeightOf(text: string, plan: AtsPlan | null): number {
  return (plan?.keywords ?? []).filter((k) => k.support === 'supported' && k.kind !== 'title').reduce((n, k) => n + (k.forms.some((f) => hasForm(text, f)) ? k.weight : 0), 0);
}

/** Master bullets ordered by how many supported job keywords they carry. */
export function rankBullets(bullets: string[], plan: AtsPlan | null): string[] {
  const kws = (plan?.keywords ?? []).filter((k) => k.support === 'supported' && k.kind !== 'title');
  return bullets
    .map((b, i) => ({ b, i, w: kws.reduce((n, k) => n + (k.forms.some((f) => hasForm(b, f)) ? k.weight : 0), 0) }))
    .sort((x, y) => y.w - x.w || x.i - y.i)
    .map((x) => x.b);
}

export function assembleFromClaude(
  reply: TailorResumeReply,
  master: MasterResume,
  profile: CareerProfile | undefined,
  version: number,
  model: string,
  plan: AtsPlan | null = null,
): TailoredResume {
  const a = allowedResume(master, profile);
  const changes = reply.changes.map((c) => ({ section: c.section, before: c.before, after: c.after, reason: c.reason }));
  const experience = a.experience.map((m) => {
    const r = reply.experience.find((x) => x.sourceId === m.id);
    const want = plan?.bulletBudget[m.id] ?? 2;
    const base = { sourceId: m.id, title: m.title, company: m.company, location: m.location, startDate: m.startDate, endDate: m.endDate, technologies: r?.technologies ?? m.technologies ?? [] };
    if (!r || !r.bullets.length) {
      if (m.bullets.length) {
        changes.push({ section: `${m.title} at ${m.company}`, before: '(omitted by Claude)', after: `${Math.min(want, m.bullets.length)} original bullet(s)`, reason: 'Restored so every job and date range stays on your resume.' });
      }
      return { ...base, bullets: rankBullets(m.bullets, plan).slice(0, Math.max(2, want)) };
    }
    let bullets = r.bullets.map((b) => b.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean);
    // Too few bullets for this job: top up with its own best original bullets.
    const floor = Math.min(m.bullets.length, Math.max(2, want - 1));
    if (bullets.length < floor) {
      const extra = rankBullets(m.bullets, plan).filter((o) => !bullets.some((b) => similarity(b, o) >= 0.45));
      const added = extra.slice(0, floor - bullets.length);
      if (added.length) changes.push({ section: `${m.title} at ${m.company}`, before: `${bullets.length} bullet(s)`, after: `${bullets.length + added.length} bullets`, reason: 'Added your own bullets so this job has enough detail.' });
      bullets = [...bullets, ...added];
    }
    return { ...base, bullets };
  });
  let projects = reply.projects
    .map((rp) => {
      const m = a.projects.find((p) => p.name.trim().toLowerCase() === rp.sourceName.trim().toLowerCase());
      return m ? { name: m.name, description: m.description, bullets: rp.bullets.length ? rp.bullets : m.bullets } : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  // No projects returned at all: keep the most relevant ones rather than silently losing them.
  if (!projects.length && a.projects.length) {
    projects = a.projects
      .map((p) => ({ p, w: keywordWeightOf(`${p.name} ${p.description} ${p.bullets.join(' ')}`, plan) }))
      .sort((x, y) => y.w - x.w)
      .slice(0, 2)
      .map(({ p }) => ({ name: p.name, description: p.description, bullets: p.bullets }));
  }
  const certIdx = reply.certificationIndexes.filter((n) => Number.isInteger(n) && n >= 0 && n < a.certifications.length);
  const certifications = certIdx.length ? Array.from(new Set(certIdx)).map((n) => a.certifications[n]!) : a.certifications;

  // Skills: Claude's groups, keeping only names the candidate has.
  const allowed = allowedSkillNames(master, profile, plan);
  let skillGroups: SkillGroup[] = (reply.skillGroups ?? [])
    .map((g) => ({ name: g.name.trim(), skills: g.skills.map((s) => s.trim()).filter((s) => s && isAllowedSkill(s, allowed)) }))
    .filter((g) => g.name && g.skills.length);
  if (!skillGroups.length) skillGroups = groupSkills((reply.skills ?? []).filter((s) => isAllowedSkill(s, allowed)), plan, 42);
  const dropped = [...(reply.skillGroups ?? []).flatMap((g) => g.skills), ...(reply.skills ?? [])].filter((s) => s.trim() && !isAllowedSkill(s, allowed));
  if (dropped.length) changes.push({ section: 'Skills', before: dropped.join(', '), after: '(removed)', reason: 'Not in your master resume or confirmed skills.' });

  return {
    version,
    contact: contactFor(master, profile),
    headline: reply.headline.trim(),
    summary: reply.summary.trim(),
    skills: skillGroups.flatMap((g) => g.skills),
    skillGroups,
    experience,
    projects,
    education: a.education,
    certifications,
    // Only what the master resume states (languages, publications) — never model-written lines.
    additional: [...(a.languages.length ? [`Languages: ${a.languages.join(', ')}`] : []), ...a.publications.slice(0, 4)],
    changes,
    issues: [],
    engine: 'claude',
    model,
    generatedAt: nowIso(),
    editedByUser: false,
  };
}
