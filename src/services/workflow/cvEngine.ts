import type { CareerProfile, JobSession, MasterResume, TailoredResume } from '@/types';
import type { CvReply } from '@/prompts/cvGenerate';
import { validateCv } from '@/prompts/cvGenerate';
import { compactFacts } from '@/prompts/application';
import { allowedResume } from '@/services/resume/facts';
import type { CompanyResearchReply } from '@/prompts/companyResearch';

function normLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Lines of the draft that repeat a master-resume bullet word for word. Master bullets are no longer sent to
 * CV Generate, so a match is rare; it is reported, not fatal (a finished generation is not thrown away).
 * Job titles come from ApplyFlow (research + JD ladder), not the saved master profile.
 */
export function reusedMasterLines(r: CvReply, master: MasterResume, profile?: CareerProfile): number {
  const jobs = allowedResume(master, profile).experience;
  let count = 0;
  for (let i = 0; i < jobs.length && i < r.experience.length; i++) {
    const masterLines = new Set(jobs[i]!.bullets.map(normLine).filter(Boolean));
    if (!masterLines.size) continue;
    const ex = r.experience[i]!;
    for (const line of [ex.role_description, ...ex.bullets]) if (masterLines.has(normLine(line))) count++;
  }
  return count;
}

export const PLACEHOLDER_COMPANY = /^(company[_\s-]?\d+|employer[_\s-]?\d+|org(anization)?[_\s-]?\d+|acme(\s+(inc|corp|corporation|co\.?))?|placeholder|tbd|n\/?a|none|untitled|your company|company name|example (systems|corp|inc)|test company|new company)$/i;

export function isPlaceholderCompany(name: string | null | undefined): boolean {
  const t = (name ?? '').trim();
  return !t || PLACEHOLDER_COMPANY.test(t);
}

export function alignResearchToEmployers(research: CompanyResearchReply, periodCount: number): CompanyResearchReply {
  const n = Math.max(0, Math.min(periodCount, research.companies.length));
  return { companies: research.companies.slice(0, n).map((c, periodIndex) => ({ ...c, periodIndex })) };
}

export function applyCompanyResearch(master: MasterResume, research: CompanyResearchReply | null | undefined): {
  master: MasterResume;
  replaced: { from: string; to: string; periodIndex: number; location?: string }[];
} {
  if (!research?.companies?.length) return { master, replaced: [] };
  const byPeriod = new Map(research.companies.map((c) => [c.periodIndex, c]));
  const replaced: { from: string; to: string; periodIndex: number; location?: string }[] = [];
  let changed = false;
  const experience = master.parsed.experience.map((e, i) => {
    const hit = byPeriod.get(i);
    const to = hit?.name.trim();
    if (!hit || !to) return e;
    const from = e.company.trim() || '(blank)';
    const hq = (hit.hq ?? '').trim();
    let next = e;
    if (from.toLowerCase() !== to.toLowerCase()) {
      next = { ...next, company: to };
      changed = true;
    }
    if (hq && (next.location || '').trim().toLowerCase() !== hq.toLowerCase()) {
      next = { ...next, location: hq };
      changed = true;
    }
    if (next !== e) replaced.push({ from, to, periodIndex: i, location: hq || undefined });
    return next;
  });
  if (!changed) return { master, replaced: [] };
  return { master: { ...master, parsed: { ...master.parsed, experience }, updatedAt: new Date().toISOString() }, replaced };
}

/** Apply JD-aligned draft titles for CV generation only (does not change the saved master resume). */
export function applyCvRoleTitles(master: MasterResume, titles: string[]): MasterResume {
  let changed = false;
  const experience = master.parsed.experience.map((e, i) => {
    const t = titles[i]?.trim();
    if (!t || normLine(t) === normLine(e.title)) return e;
    changed = true;
    return { ...e, title: t };
  });
  if (!changed) return master;
  return { ...master, parsed: { ...master.parsed, experience }, updatedAt: new Date().toISOString() };
}

export function assembleCv(r: CvReply, master: MasterResume, profile: CareerProfile | undefined, session: Pick<JobSession, 'resume'>, model: string): TailoredResume {
  const ids = Object.values(compactFacts(master, profile).jobIds);
  const jobs = ids.map(id => master.parsed.experience.find(e => e.id === id)!);
  validateCv(r, jobs.length);
  for (let i = 0; i < jobs.length; i++) {
    const expected = jobs[i]!.title.trim();
    if (expected && normLine(r.experience[i]!.role_title) !== normLine(expected)) {
      throw new Error(`Claude returned the wrong job title for ${jobs[i]!.company || `employer ${i + 1}`}. Retry generation.`);
    }
  }
  if (r.experience.some((e,i) => e.company.trim().toLowerCase() !== jobs[i]!.company.trim().toLowerCase())) throw new Error('Claude changed or reordered an employer. Retry generation.');
  const contact = master.parsed.contact;
  return {
    contentSource: 'cv-generate', sourceJson: JSON.stringify(r), version: (session.resume?.version ?? 0)+1,
    contact: { fullName: profile?.fullName || contact.fullName, email: profile?.email || contact.email, phone: profile?.phone || contact.phone, location: profile?.location || contact.location, links: profile ? [profile.linkedinUrl,profile.githubUrl,...profile.portfolioLinks].filter(Boolean) : contact.links },
    headline: r.subtitle, summary: r.summary,
    skills: r.skill_groups.flatMap(g => g.items), skillGroups: r.skill_groups.map(g => ({name:g.category,skills:g.items})),
    experience: jobs.map((e,i) => ({ sourceId:e.id, company:e.company, title:r.experience[i]!.role_title.trim() || e.title, location:e.location, startDate:e.startDate,endDate:e.endDate, bullets:[r.experience[i]!.role_description,...r.experience[i]!.bullets].filter(Boolean), technologies:[] })),
    education:master.parsed.education, certifications:master.parsed.certifications, projects:[],
    additional:r.additional_categories.map(g => `${g.category}: ${g.items.join(', ')}`), changes:[],
    issues:[{id:'ai-draft',severity:'warning',code:'unsupported_skill',message:'AI-generated descriptions and achievements are illustrative. Verify these claims before submitting.',autoFixable:false}],
    engine:'claude',model,generatedAt:new Date().toISOString(),editedByUser:false,
  };
}
export function draftCorpus(t: TailoredResume, master: MasterResume): MasterResume {
  return {...master, facts:[], parsed:{...master.parsed,contact:t.contact,headline:t.headline,summary:t.summary,skills:t.skills,experience:t.experience.map(e=>({...e,id:e.sourceId}))}};
}
