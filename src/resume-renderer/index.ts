import type { CoverLetter, ResumeFormat, TailoredResume } from '@/types';
import { DEFAULT_RESUME_FORMAT } from '@/types';
import { coverLetterToPdf, resumeToPdf } from '@/services/export/pdf';
import { coverLetterToDocx, resumeToDocx } from '@/services/export/docx';
import { resumeToMarkdown, resumeToText } from '@/services/export/render';
import { RESUME_FORMAT_ID, type ResumeDocument } from './schema';

export * from './schema';

export function toResumeDocument(
  t: TailoredResume,
  letter: Pick<CoverLetter, 'text'> | null = null,
  meta: ResumeDocument['meta'] = {},
): ResumeDocument {
  return {
    $schema: RESUME_FORMAT_ID,
    basics: {
      name: t.contact.fullName,
      headline: t.headline,
      email: t.contact.email,
      phone: t.contact.phone,
      location: t.contact.location,
      links: t.contact.links,
    },
    summary: t.summary,
    skills: (t.skillGroups?.length ? t.skillGroups : t.skills.length ? [{ name: '', skills: t.skills }] : []).map((g) => ({ group: g.name, items: g.skills })),
    experience: t.experience.map((e) => ({
      title: e.title,
      company: e.company,
      location: e.location,
      start: e.startDate,
      end: e.endDate || 'Present',
      bullets: e.bullets,
      technologies: e.technologies ?? [],
    })),
    projects: t.projects.map((p) => ({ name: p.name, description: p.description, bullets: p.bullets })),
    education: t.education.map((e) => ({ degree: e.degree, institution: e.institution, location: e.location ?? '', date: e.date, details: e.details })),
    certifications: t.certifications,
    additional: t.additional,
    coverLetter: letter?.text ? { paragraphs: letter.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) } : null,
    meta: { contentSource: t.contentSource, sourceJson: t.sourceJson, generatedAt: t.generatedAt, engine: t.engine, model: t.model, version: t.version, ...meta },
  };
}

export function fromResumeDocument(d: ResumeDocument): TailoredResume {
  const skillGroups = d.skills.filter((g) => g.items.length).map((g) => ({ name: g.group, skills: g.items }));
  return {
    contentSource: d.meta?.contentSource,
    sourceJson: d.meta?.sourceJson,
    version: d.meta?.version ?? 1,
    contact: { fullName: d.basics.name, email: d.basics.email, phone: d.basics.phone, location: d.basics.location, links: d.basics.links },
    headline: d.basics.headline,
    summary: d.summary,
    skills: skillGroups.flatMap((g) => g.skills),
    skillGroups: skillGroups.some((g) => g.name) ? skillGroups : undefined,
    experience: d.experience.map((e, i) => ({
      sourceId: `job-${i + 1}`,
      title: e.title,
      company: e.company,
      location: e.location,
      startDate: e.start,
      endDate: /^present$/i.test(e.end) ? '' : e.end,
      bullets: e.bullets,
      technologies: e.technologies,
    })),
    projects: d.projects,
    education: d.education.map((e, i) => ({ id: `edu-${i + 1}`, degree: e.degree, institution: e.institution, date: e.date, details: e.details, location: e.location })),
    certifications: d.certifications,
    additional: d.additional,
    changes: [],
    issues: [],
    engine: d.meta?.engine === 'claude' ? 'claude' : 'local',
    model: d.meta?.model ?? null,
    generatedAt: d.meta?.generatedAt ?? new Date().toISOString(),
    editedByUser: false,
  };
}

const fmtOf = (f?: Partial<ResumeFormat>): ResumeFormat => ({ ...DEFAULT_RESUME_FORMAT, ...(f ?? {}) });

export function renderResumePdf(d: ResumeDocument, format?: Partial<ResumeFormat>, keywords: string[] = []): Promise<Uint8Array> {
  return resumeToPdf(fromResumeDocument(d), fmtOf(format), keywords);
}

export function renderResumeDocx(d: ResumeDocument, format?: Partial<ResumeFormat>): Promise<Blob> {
  return resumeToDocx(fromResumeDocument(d), fmtOf(format));
}

export function renderResumeText(d: ResumeDocument, format?: Partial<ResumeFormat>): string {
  return resumeToText(fromResumeDocument(d), fmtOf(format));
}

export function renderResumeMarkdown(d: ResumeDocument, format?: Partial<ResumeFormat>): string {
  return resumeToMarkdown(fromResumeDocument(d), fmtOf(format));
}

export function letterTextOf(d: ResumeDocument): string | null {
  const ps = d.coverLetter?.paragraphs?.filter(Boolean) ?? [];
  return ps.length ? ps.join('\n\n') : null;
}

export async function renderCoverLetterPdf(d: ResumeDocument, format?: Partial<ResumeFormat>): Promise<Uint8Array | null> {
  const text = letterTextOf(d);
  return text ? coverLetterToPdf(text, fromResumeDocument(d), fmtOf(format)) : null;
}

export async function renderCoverLetterDocx(d: ResumeDocument, format?: Partial<ResumeFormat>): Promise<Blob | null> {
  const text = letterTextOf(d);
  return text ? coverLetterToDocx(text, fromResumeDocument(d), fmtOf(format)) : null;
}
