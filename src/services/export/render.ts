/** Plain-text and Markdown renderers for the tailored resume and cover letter. */
import type { ResumeFormat, TailoredResume } from '@/types';
import { DEFAULT_RESUME_FORMAT } from '@/types';
import type { ResumeView } from '@/services/matching/score';
import type { ParsedResume } from '@/types';
import { SECTION, contactParts, formatDateText, formatRange, skillLines } from './layout';

export function contactLine(t: Pick<TailoredResume, 'contact'>): string {
  return contactParts(t).join(' | ');
}

export function resumeToText(t: TailoredResume, format: ResumeFormat = DEFAULT_RESUME_FORMAT): string {
  const ds = format.dateStyle;
  const out: string[] = [t.contact.fullName.toUpperCase(), t.headline, contactLine(t)];
  if (t.summary) out.push('', SECTION.summary.toUpperCase(), t.summary);
  const groups = skillLines(t);
  if (groups.length) out.push('', SECTION.skills.toUpperCase(), ...groups.map((g) => (g.name ? `${g.name}: ${g.skills.join(', ')}` : g.skills.join(', '))));
  if (t.experience.length) {
    out.push('', SECTION.experience.toUpperCase());
    t.experience.forEach((e, i) => {
      if (i) out.push('');
      out.push(`${e.title} | ${formatRange(e.startDate, e.endDate, ds)}`);
      out.push([e.company, e.location].filter(Boolean).join(' | '));
      e.bullets.forEach((b) => out.push(`- ${b}`));
      if (format.showJobTechnologies && e.technologies?.length) out.push(`Technologies: ${e.technologies.join(', ')}`);
    });
  }
  if (t.projects.length) {
    out.push('', 'PROJECTS');
    t.projects.forEach((p) => {
      out.push(p.description ? `${p.name} — ${p.description}` : p.name);
      p.bullets.forEach((b) => out.push(`- ${b}`));
    });
  }
  if (t.education.length) {
    out.push('', 'EDUCATION');
    t.education.forEach((e) => out.push([e.degree, e.institution, e.location, formatDateText(e.date, ds)].filter(Boolean).join(' | ')));
  }
  if (t.certifications.length) {
    out.push('', 'CERTIFICATIONS');
    t.certifications.forEach((c) => out.push(`- ${c}`));
  }
  if (t.additional.length) {
    out.push('', 'ADDITIONAL INFORMATION');
    t.additional.forEach((a) => out.push(`- ${a}`));
  }
  return out.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n').trim() + '\n';
}

export function resumeToMarkdown(t: TailoredResume, format: ResumeFormat = DEFAULT_RESUME_FORMAT): string {
  const ds = format.dateStyle;
  const out: string[] = [`# ${t.contact.fullName}`, '', `**${t.headline}**`, '', contactLine(t)];
  if (t.summary) out.push('', `## ${SECTION.summary}`, '', t.summary);
  const groups = skillLines(t);
  if (groups.length) out.push('', `## ${SECTION.skills}`, '', ...groups.map((g) => (g.name ? `- **${g.name}:** ${g.skills.join(', ')}` : g.skills.join(', '))));
  if (t.experience.length) {
    out.push('', `## ${SECTION.experience}`);
    t.experience.forEach((e) => {
      out.push('', `### ${e.title} — ${e.company}`, `${[e.location, formatRange(e.startDate, e.endDate, ds)].filter(Boolean).join(' | ')}`, '');
      e.bullets.forEach((b) => out.push(`- ${b}`));
      if (format.showJobTechnologies && e.technologies?.length) out.push('', `*Technologies:* ${e.technologies.join(', ')}`);
    });
  }
  if (t.projects.length) {
    out.push('', '## Projects');
    t.projects.forEach((p) => {
      out.push('', `**${p.name}**${p.description ? ` — ${p.description}` : ''}`);
      p.bullets.forEach((b) => out.push(`- ${b}`));
    });
  }
  if (t.education.length) out.push('', '## Education', '', ...t.education.map((e) => `- ${[e.degree, e.institution, e.location, formatDateText(e.date, ds)].filter(Boolean).join(', ')}`));
  if (t.certifications.length) out.push('', '## Certifications', '', ...t.certifications.map((c) => `- ${c}`));
  if (t.additional.length) out.push('', '## Additional Information', '', ...t.additional.map((a) => `- ${a}`));
  return out.join('\n').trim() + '\n';
}

export function coverLetterToMarkdown(text: string, t: Pick<TailoredResume, 'contact'>): string {
  return `**${t.contact.fullName}**  \n${contactLine(t as TailoredResume)}\n\n${text.trim()}\n`;
}

export function tailoredToView(t: TailoredResume): ResumeView {
  return {
    email: t.contact.email,
    phone: t.contact.phone,
    headline: t.headline,
    summary: t.summary,
    skills: t.skills,
    experience: t.experience,
    education: t.education,
    sectionsPresent: { summary: Boolean(t.summary), skills: t.skills.length > 0, experience: t.experience.length > 0, education: t.education.length > 0 },
  };
}

export function parsedToView(p: ParsedResume): ResumeView {
  return {
    email: p.contact.email,
    phone: p.contact.phone,
    headline: p.headline,
    summary: p.summary,
    skills: p.skills,
    experience: p.experience,
    education: p.education,
    sectionsPresent: { summary: Boolean(p.summary), skills: p.skills.length > 0, experience: p.experience.length > 0, education: p.education.length > 0 },
  };
}
