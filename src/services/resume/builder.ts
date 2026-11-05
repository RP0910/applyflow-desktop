import type { BuilderEducation, BuilderForm, BuilderJob, CareerProfile, MasterResume, ParsedResume } from '@/types';
import { newId } from '@/utils/id';
import { nowIso } from '@/utils/dates';
import { uniqCaseInsensitive } from '@/utils/text';
import { deriveFacts, PARSER_VERSION } from './facts';
import { parsedToText, parseSkills } from './parser';

export function emptyJob(): BuilderJob {
  return { id: newId('job'), company: '', title: '', city: '', start: '', end: '', current: false, did: '', technologies: '' };
}

export function emptyEducation(): BuilderEducation {
  return { id: newId('edu'), degree: '', field: '', school: '', city: '', start: '', end: '', details: '' };
}

export function emptyBuilder(): BuilderForm {
  return { headline: '', summary: '', skills: '', certifications: '', languages: '', jobs: [emptyJob()], education: [emptyEducation()] };
}

export function monthToResume(v: string): string {
  const m = v.trim().match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : v.trim();
}

export function resumeToMonth(v: string): string {
  const t = v.trim();
  const mm = t.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (mm) return `${mm[2]}-${mm[1]!.padStart(2, '0')}`;
  const mon = t.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (mon) {
    const i = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(mon[1]!.toLowerCase());
    if (i >= 0) return `${mon[2]}-${String(i + 1).padStart(2, '0')}`;
  }
  const y = t.match(/^(\d{4})$/);
  return y ? `${y[1]}-01` : '';
}

const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[•\-*–·▪●]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);

const list = (s: string) => uniqCaseInsensitive(parseSkills(s.split(/\n/)));

export function sortJobs(jobs: BuilderJob[]): BuilderJob[] {
  const key = (j: BuilderJob) => (j.current ? '9999-99' : j.end || j.start || '0000-00');
  return [...jobs].sort((a, b) => key(b).localeCompare(key(a)) || (b.start || '').localeCompare(a.start || ''));
}

export function isBlankJob(j: BuilderJob): boolean {
  return !j.company.trim() && !j.title.trim() && !j.did.trim();
}

export function builderToParsed(form: BuilderForm, profile?: CareerProfile): ParsedResume {
  const jobs = sortJobs(form.jobs.filter((j) => !isBlankJob(j)));
  const education = form.education.filter((e) => e.school.trim() || e.degree.trim());
  return {
    contact: {
      fullName: profile?.fullName ?? '',
      email: profile?.email ?? '',
      phone: profile?.phone ?? '',
      location: profile?.location ?? '',
      links: [profile?.linkedinUrl, profile?.githubUrl, ...(profile?.portfolioLinks ?? [])].filter((l): l is string => Boolean(l)),
    },
    headline: form.headline.trim(),
    summary: form.summary.trim(),
    skills: list(form.skills),
    experience: jobs.map((j) => ({
      id: j.id,
      title: j.title.trim(),
      company: j.company.trim(),
      location: j.city.trim(),
      startDate: monthToResume(j.start),
      endDate: j.current ? 'Present' : monthToResume(j.end),
      bullets: lines(j.did),
      technologies: list(j.technologies),
    })),
    education: education.map((e) => ({
      id: e.id,
      degree: [e.degree.trim(), e.field.trim()].filter(Boolean).join(' in '),
      institution: e.school.trim(),
      date: e.start && e.end ? `${monthToResume(e.start)} – ${monthToResume(e.end)}` : monthToResume(e.end || e.start),
      details: lines(e.details ?? ''),
      location: e.city.trim() || undefined,
    })),
    certifications: lines(form.certifications),
    projects: [],
    publications: [],
    languages: list(form.languages),
    links: [],
    unparsed: [],
  };
}

export function builderProblems(form: BuilderForm): string[] {
  const out: string[] = [];
  const jobs = form.jobs.filter((j) => !isBlankJob(j));
  if (!jobs.length) out.push('Add at least one job.');
  jobs.forEach((j, i) => {
    const name = j.company.trim() || j.title.trim() || `Job ${i + 1}`;
    if (!j.company.trim()) out.push(`${name}: add the company name.`);

    if (!j.start) out.push(`${name}: add the start month.`);
    if (!j.current && !j.end) out.push(`${name}: add the end month, or tick “I work here now”.`);
    if (j.start && j.end && !j.current && j.end < j.start) out.push(`${name}: the end month is before the start month.`);

  });
  form.education.forEach((e, i) => {
    const blank = !e.school.trim() && !e.degree.trim() && !e.field.trim();
    if (blank) return;
    const name = e.school.trim() || e.degree.trim() || `Education ${i + 1}`;
    if (!e.school.trim()) out.push(`${name}: add the university or school name.`);
    if (e.start && e.end && e.end < e.start) out.push(`${name}: the end month is before the start month.`);
  });
  return out;
}

export function builderFromParsed(p: ParsedResume): BuilderForm {
  return {
    headline: p.headline,
    summary: p.summary,
    skills: p.skills.join(', '),
    certifications: p.certifications.join('\n'),
    languages: p.languages.join(', '),
    jobs: p.experience.length
      ? p.experience.map((e) => ({
          id: newId('job'),
          company: e.company,
          title: e.title,
          city: e.location,
          start: resumeToMonth(e.startDate),
          end: /present|current/i.test(e.endDate) ? '' : resumeToMonth(e.endDate),
          current: /present|current/i.test(e.endDate),
          did: e.bullets.join('\n'),
          technologies: (e.technologies ?? []).join(', '),
        }))
      : [emptyJob()],
    education: p.education.length
      ? p.education.map((e) => {
          const at = e.degree.search(/\s+in\s+/);
          const deg = at >= 0 ? e.degree.slice(0, at) : e.degree;
          const field = at >= 0 ? e.degree.slice(at).replace(/^\s+in\s+/, '') : '';
          const [start, end] = e.date.split(/\s*[–—]\s*|\s+-\s+/);
          return { id: newId('edu'), degree: deg, field, school: e.institution, city: e.location ?? '', start: end ? resumeToMonth(start ?? '') : '', end: resumeToMonth(end ?? start ?? ''), details: (e.details ?? []).join('\n') };
        })
      : [emptyEducation()],
  };
}

export function buildMasterFromForm(form: BuilderForm, profile: CareerProfile | undefined, name: string, existing?: MasterResume): MasterResume {
  const parsed = builderToParsed(form, profile);
  const now = nowIso();
  return {
    id: existing?.id ?? newId('res'),
    name: name.trim() || existing?.name || 'My resume',
    isDefault: existing?.isDefault ?? false,
    rawText: parsedToText(parsed),
    parsed,
    facts: deriveFacts(parsed, existing?.facts ?? []),
    sourceFileName: null,
    sourceFormat: 'form',
    builder: form,
    sourceData: null,
    parserVersion: PARSER_VERSION,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
