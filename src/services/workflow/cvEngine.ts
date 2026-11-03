import type { CareerProfile, JobSession, MasterResume, TailoredResume } from '@/types';
import type { CvReply } from '@/prompts/cvGenerate';
import { validateCv } from '@/prompts/cvGenerate';
import { compactFacts } from '@/prompts/application';
import type { CompanyResearchReply } from '@/prompts/companyResearch';

/** Placeholder / synthetic employer names (used by tests and UI helpers). */
export const PLACEHOLDER_COMPANY = /^(company[_\s-]?\d+|employer[_\s-]?\d+|org(anization)?[_\s-]?\d+|acme(\s+(inc|corp|corporation|co\.?))?|placeholder|tbd|n\/?a|none|untitled|your company|company name|example (systems|corp|inc)|test company|new company)$/i;

export function isPlaceholderCompany(name: string | null | undefined): boolean {
  const t = (name ?? '').trim();
  return !t || PLACEHOLDER_COMPANY.test(t);
}

/**
 * Apply researched company names + public HQ onto the working master used for CV generate.
 * Dates and titles stay from Profile; employer names and locations become researched values
 * so the assembled resume shows each firm's real HQ city (not the profile period city).
 */
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
    if (!to) return e;
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

/** Employers/dates/contact data are assembled locally, never entrusted to model output. */
export function assembleCv(r: CvReply, master: MasterResume, profile: CareerProfile | undefined, session: Pick<JobSession, 'resume'>, model: string): TailoredResume {
  const ids = Object.values(compactFacts(master, profile).jobIds);
  const jobs = ids.map(id => master.parsed.experience.find(e => e.id === id)!);
  validateCv(r, jobs.length);
  if (r.experience.some((e,i) => e.company.trim().toLowerCase() !== jobs[i]!.company.trim().toLowerCase())) throw new Error('Claude changed or reordered an employer. Retry generation.');
  const contact = master.parsed.contact;
  return {
    contentSource: 'cv-generate', sourceJson: JSON.stringify(r), version: (session.resume?.version ?? 0)+1,
    contact: { fullName: profile?.fullName || contact.fullName, email: profile?.email || contact.email, phone: profile?.phone || contact.phone, location: profile?.location || contact.location, links: profile ? [profile.linkedinUrl,profile.githubUrl,...profile.portfolioLinks].filter(Boolean) : contact.links },
    headline: r.subtitle, summary: r.summary,
    skills: r.skill_groups.flatMap(g => g.items), skillGroups: r.skill_groups.map(g => ({name:g.category,skills:g.items})),
    experience: jobs.map((e,i) => ({ sourceId:e.id, company:e.company, title:e.title || r.experience[i]!.role_title, location:e.location, startDate:e.startDate,endDate:e.endDate, bullets:[r.experience[i]!.role_description,...r.experience[i]!.bullets].filter(Boolean), technologies:[] })),
    education:master.parsed.education, certifications:master.parsed.certifications, projects:[],
    additional:r.additional_categories.map(g => `${g.category}: ${g.items.join(', ')}`), changes:[],
    issues:[{id:'ai-draft',severity:'warning',code:'unsupported_skill',message:'AI-generated descriptions and achievements are illustrative. Verify these claims before submitting.',autoFixable:false}],
    engine:'claude',model,generatedAt:new Date().toISOString(),editedByUser:false,
  };
}
/** Transient document corpus for measuring draft coverage; never saved as verified candidate facts. */
export function draftCorpus(t: TailoredResume, master: MasterResume): MasterResume {
  return {...master, facts:[], parsed:{...master.parsed,contact:t.contact,headline:t.headline,summary:t.summary,skills:t.skills,experience:t.experience.map(e=>({...e,id:e.sourceId}))}};
}
