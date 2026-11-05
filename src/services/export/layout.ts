import type { ResumeFormat, SkillGroup, TailoredResume } from '@/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(d: string, style: ResumeFormat['dateStyle']): string {
  const t = d.trim();
  if (!t || style === 'as_written') return t;
  if (/^(present|current|now|today)$/i.test(t)) return 'Present';
  const mm = t.match(/^(\d{1,2})[/.-](\d{4})$/);
  const mon = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  let month: number | null = null;
  let year = '';
  if (mm) {
    month = Number(mm[1]) - 1;
    year = mm[2]!;
  } else if (mon) {
    const i = MONTHS.findIndex((m) => m.toLowerCase() === mon[1]!.slice(0, 3).toLowerCase());
    if (i >= 0) month = i;
    year = mon[2]!;
  }
  if (month === null || month < 0 || month > 11) return t;
  return style === 'mon_yyyy' ? `${MONTHS[month]} ${year}` : `${String(month + 1).padStart(2, '0')}/${year}`;
}

export function formatRange(start: string, end: string, style: ResumeFormat['dateStyle']): string {
  if (!start) return end ? formatDate(end, style) : '';
  return `${formatDate(start, style)} – ${formatDate(end || 'Present', style)}`;
}

export function formatDateText(text: string, style: ResumeFormat['dateStyle']): string {
  const parts = text.split(/\s*[–—-]\s*/);
  if (parts.length === 2 && parts.every((p) => /\d{4}|present/i.test(p))) return formatRange(parts[0]!, parts[1]!, style);
  return formatDate(text, style);
}

export function contactParts(t: Pick<TailoredResume, 'contact'>): string[] {
  const c = t.contact;
  return [c.location, c.phone, c.email, ...c.links.map((l) => l.replace(/^https?:\/\/(www\.)?/, ''))].filter(Boolean);
}

export function skillLines(t: Pick<TailoredResume, 'skills' | 'skillGroups'>): SkillGroup[] {
  if (t.skillGroups?.length) return t.skillGroups.filter((g) => g.skills.length);
  return t.skills.length ? [{ name: '', skills: t.skills }] : [];
}

export function educationLine(e: TailoredResume['education'][number]): { left: string; right: string; second: string } {
  return { left: e.degree || e.institution, right: e.date, second: [e.degree ? e.institution : '', e.location ?? ''].filter(Boolean).join(' | ') };
}

export const SECTION = {
  summary: 'Professional Summary',
  skills: 'Technical Skills',
  experience: 'Professional Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
  additional: 'Additional Information',
} as const;
