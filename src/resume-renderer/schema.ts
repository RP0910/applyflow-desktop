/**
 * The resume JSON format — "applyflow.resume/1".
 *
 * Every tailored resume is stored as this JSON (in the database and as resume.json next to the
 * PDF). ApplyFlow's renderer turns it into a PDF/DOCX without any AI, so a resume can be
 * re-rendered in another template or font at no token cost, edited by hand, or produced by any
 * other tool. JSON Resume (jsonresume.org) files are accepted too.
 */

export const RESUME_FORMAT_ID = 'applyflow.resume/1';

export interface ResumeDocument {
  $schema?: string;
  basics: {
    name: string;
    /** "Senior Video Playback Engineer | HLS, DRM, Player SDKs" */
    headline: string;
    email: string;
    phone: string;
    /** "Denver, CO" */
    location: string;
    links: string[];
  };
  summary: string;
  skills: { group: string; items: string[] }[];
  experience: {
    title: string;
    company: string;
    location: string;
    /** "02/2023", "Feb 2023" or "2023" */
    start: string;
    /** "Present" for a current job */
    end: string;
    bullets: string[];
    technologies: string[];
  }[];
  projects: { name: string; description: string; bullets: string[] }[];
  education: { degree: string; institution: string; location: string; date: string; details: string[] }[];
  certifications: string[];
  additional: string[];
  /** Optional cover letter, one paragraph per entry (greeting first, sign-off last). */
  coverLetter?: { paragraphs: string[] } | null;
  /** Where it came from — not printed. */
  meta?: {
    contentSource?: "cv-generate";
    sourceJson?: string;
    jobTitle?: string;
    company?: string;
    jobUrl?: string;
    generatedAt?: string;
    engine?: string | null;
    model?: string | null;
    version?: number;
  };
}

/** JSON Schema (draft 2020-12) for editors and other tools. */
export const RESUME_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: RESUME_FORMAT_ID,
  title: 'ApplyFlow resume',
  type: 'object',
  required: ['basics', 'experience'],
  properties: {
    basics: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        headline: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        location: { type: 'string' },
        links: { type: 'array', items: { type: 'string' } },
      },
    },
    summary: { type: 'string' },
    skills: { type: 'array', items: { type: 'object', required: ['items'], properties: { group: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } } } },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'company'],
        properties: {
          title: { type: 'string' },
          company: { type: 'string' },
          location: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
          technologies: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    projects: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } } } } },
    education: {
      type: 'array',
      items: { type: 'object', properties: { degree: { type: 'string' }, institution: { type: 'string' }, location: { type: 'string' }, date: { type: 'string' }, details: { type: 'array', items: { type: 'string' } } } },
    },
    certifications: { type: 'array', items: { type: 'string' } },
    additional: { type: 'array', items: { type: 'string' } },
    coverLetter: { type: ['object', 'null'], properties: { paragraphs: { type: 'array', items: { type: 'string' } } } },
    meta: { type: 'object' },
  },
} as const;

// ---------------------------------------------------------------- lenient reading

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
/** A list of strings from an array, or from a newline/semicolon separated string. */
const list = (v: unknown, sep = /\n/): string[] =>
  (Array.isArray(v) ? v.map(text) : typeof v === 'string' ? v.split(sep).map((s) => s.trim()) : []).map((s) => s.replace(/^[•\-*]\s*/, '')).filter(Boolean);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

export interface ReadResult {
  doc: ResumeDocument | null;
  /** Problems that stop rendering. */
  errors: string[];
  /** Things worth knowing that don't stop rendering. */
  warnings: string[];
  /** 'applyflow' or 'jsonresume' */
  source: 'applyflow' | 'jsonresume' | null;
}

function fromJsonResume(j: Obj, warnings: string[]): ResumeDocument {
  const b = isObj(j.basics) ? j.basics : {};
  const loc = isObj(b.location) ? b.location : {};
  const profiles = arr(b.profiles).map((p) => text(p.url)).filter(Boolean);
  warnings.push('Read as a JSON Resume file (jsonresume.org).');
  return {
    $schema: RESUME_FORMAT_ID,
    basics: {
      name: text(b.name),
      headline: text(b.label),
      email: text(b.email),
      phone: text(b.phone),
      location: [text(loc.city), text(loc.region) || text(loc.countryCode)].filter(Boolean).join(', '),
      links: [text(b.url), ...profiles].filter(Boolean),
    },
    summary: text(b.summary) || text(j.summary),
    skills: arr(j.skills).map((s) => ({ group: text(s.name), items: list(s.keywords, /[,\n]/) })).filter((g) => g.items.length || g.group),
    experience: arr(j.work).map((w) => ({
      title: text(w.position),
      company: text(w.name) || text(w.company),
      location: text(w.location),
      start: text(w.startDate),
      end: text(w.endDate) || 'Present',
      bullets: [...(text(w.summary) ? [text(w.summary)] : []), ...list(w.highlights)],
      technologies: list(w.keywords, /[,\n]/),
    })),
    projects: arr(j.projects).map((p) => ({ name: text(p.name), description: text(p.description), bullets: list(p.highlights) })),
    education: arr(j.education).map((e) => ({
      degree: [text(e.studyType), text(e.area)].filter(Boolean).join(' in '),
      institution: text(e.institution),
      location: '',
      date: [text(e.startDate), text(e.endDate)].filter(Boolean).join(' – '),
      details: list(e.courses),
    })),
    certifications: arr(j.certificates).map((c) => [text(c.name), text(c.issuer)].filter(Boolean).join(', ')),
    additional: arr(j.languages).length ? [`Languages: ${arr(j.languages).map((l) => text(l.language)).filter(Boolean).join(', ')}`] : [],
    coverLetter: null,
  };
}

/** Read any resume JSON leniently: missing fields become empty, strings become lists. */
export function readResumeDocument(input: unknown): ReadResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let j: unknown = input;
  if (typeof input === 'string') {
    try {
      j = JSON.parse(input);
    } catch (e) {
      return { doc: null, errors: [`This isn't valid JSON: ${(e as Error).message}`], warnings, source: null };
    }
  }
  if (!isObj(j)) return { doc: null, errors: ['The JSON must be an object ({ … }).'], warnings, source: null };
  if (Array.isArray(j.work) && !Array.isArray(j.experience)) {
    const doc = fromJsonResume(j, warnings);
    if (!doc.basics.name) errors.push('basics.name is missing.');
    return { doc: errors.length ? null : doc, errors, warnings, source: 'jsonresume' };
  }
  const b = isObj(j.basics) ? j.basics : isObj(j.contact) ? j.contact : {};
  const doc: ResumeDocument = {
    $schema: RESUME_FORMAT_ID,
    basics: {
      name: text(b.name) || text(b.fullName),
      headline: text(b.headline) || text(j.headline),
      email: text(b.email),
      phone: text(b.phone),
      location: text(b.location),
      links: list(b.links, /[\n,]/),
    },
    summary: text(j.summary),
    skills: Array.isArray(j.skills) && j.skills.every((s) => typeof s === 'string')
      ? [{ group: '', items: list(j.skills) }]
      : arr(j.skills ?? j.skillGroups).map((g) => ({ group: text(g.group) || text(g.name), items: list(g.items ?? g.skills, /[,\n]/) })).filter((g) => g.items.length),
    experience: arr(j.experience).map((e, i) => {
      const x = {
        title: text(e.title),
        company: text(e.company),
        location: text(e.location),
        start: text(e.start) || text(e.startDate),
        end: text(e.end) || text(e.endDate) || 'Present',
        bullets: list(e.bullets),
        technologies: list(e.technologies, /[,\n]/),
      };
      if (!x.title && !x.company) errors.push(`experience[${i}] needs a title or a company.`);
      if (!x.start) warnings.push(`experience[${i}] (${x.title || x.company}) has no start date.`);
      return x;
    }),
    projects: arr(j.projects).map((p) => ({ name: text(p.name), description: text(p.description), bullets: list(p.bullets) })).filter((p) => p.name),
    education: arr(j.education).map((e) => ({ degree: text(e.degree), institution: text(e.institution), location: text(e.location), date: text(e.date), details: list(e.details) })),
    certifications: list(j.certifications),
    additional: list(j.additional),
    coverLetter: isObj(j.coverLetter) ? { paragraphs: list(j.coverLetter.paragraphs) } : typeof j.coverLetter === 'string' ? { paragraphs: j.coverLetter.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) } : null,
    meta: isObj(j.meta) ? (j.meta as ResumeDocument['meta']) : undefined,
  };
  if (!doc.basics.name) errors.push('basics.name is missing — the resume needs your name.');
  if (!doc.experience.length) warnings.push('No experience entries.');
  if (j.$schema && j.$schema !== RESUME_FORMAT_ID) warnings.push(`Unknown format "${String(j.$schema)}" — read as ${RESUME_FORMAT_ID}.`);
  return { doc: errors.length ? null : doc, errors, warnings, source: 'applyflow' };
}
