import type { AtsKeyword, JobAnalysis, JobPosting, KeywordKind } from '@/types';
import { findSkillMentions, findSoftSkills, canonicalSkill } from '@/services/skills/extract';
import { SKILL_BY_NAME, SOFT_SKILLS } from '@/services/skills/taxonomy';
import { withoutContacts } from '@/utils/contacts';
import { acronymPairs, countForm, sameKeyword, synonymsOf, termKey } from './terms';

export const STOP_TOKENS = new Set(
  (
    'US USA U.S. EEO EOE EEOC PTO W2 W-2 C2C C2H H1B H-1B GC USC NA N/A OR AND THE IT HR CEO CTO CIO CFO COO VP SVP EVP II III IV LLC INC LTD AM PM ' +
    'EST PST CST MST ET PT CT MT FTE ADA TBD ETC NYC SF LA DC UK EU APAC EMEA LATAM ID DOB SSN ' +
    'AL AK AZ AR CA CO CT DE FL GA HI IA IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK PA RI SC SD TN TX UT VA VT WA WI WV WY ' +
    'BS BA MS MA MBA PHD PhD BSc MSc B.S. M.S. Q1 Q2 Q3 Q4 KPI KPIs ROI SLA SLAs SOW RFP RFPs FAQ ASAP OOO TL;DR EOD COB YoY'
  ).split(/\s+/),
);

const GENERIC = new Set(
  (
    'a an the and or of for to in on at by with from as is are be will you your we our us they their this that these those it its our ' +
    'experience experienced years year ability able strong excellent good great solid proven skills skill knowledge understanding work working ' +
    'team teams role position job candidate candidates company opportunity benefits salary pay including include etc must plus preferred required ' +
    'responsibilities requirements qualifications new other across within using use used help ensure support build building develop developing ' +
    'environment environments level high highly well best world class fast paced closely across multiple various related relevant time ' +
    'day days week weeks month months hours equal employer applicants status minimum least looking join us more than about who what when where ' +
    'such like also all any each every some one two three four five six seven eight nine ten per own other others'
  ).split(/\s+/),
);

const SENIORITY = /\b(senior|sr\.?|junior|jr\.?|lead|staff|principal|chief|associate|entry[- ]level|mid[- ]level|intern|i{1,3}|iv|[123])\b\.?/gi;

export function cleanJobTitle(title: string): string {
  return title
    .replace(/\(([^)]*)\)/g, (m, inner: string) => (/remote|hybrid|on-?site|w-?2|c2c|contract|full|part|\d|[A-Z]{2}\b/i.test(inner) ? ' ' : m))
    .replace(/\s+[-–—|/]\s+.*$/, (m) => (/remote|hybrid|on-?site|w-?2|c2c|contract|full[- ]time|part[- ]time|\d|,\s*[A-Z]{2}\b/i.test(m) ? '' : m))
    .replace(/\b(remote|hybrid|on-?site|w-?2|c2c|1099|contract(?:or)?|full[- ]time|part[- ]time|urgent(?:ly)?|immediate|hiring|needed)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–|,/:]+|[\s\-–|,/:]+$/g, '')
    .trim();
}

export function coreTitle(title: string): string {
  return cleanJobTitle(title).replace(SENIORITY, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s,-]+|[\s,-]+$/g, '').trim();
}

interface Draft {
  term: string;
  canon?: string;
  forms: Set<string>;
  kind: KeywordKind;
  importance: AtsKeyword['importance'];
  jobCount: number;
  inTitle: boolean;
}

const IMPORTANCE_RANK = { required: 3, preferred: 2, mentioned: 1 } as const;

function weightOf(d: Draft): number {
  if (d.kind === 'title') return 6;
  if (d.kind === 'soft') return 0.5;
  if (d.kind === 'education') return d.importance === 'required' ? 1.5 : 1;
  if (d.kind === 'certification') return d.importance === 'required' ? 2.5 : 1.5;
  const base = d.kind === 'domain' ? 1 : d.importance === 'required' ? 3 : d.importance === 'preferred' ? 2 : 1.2;
  const freq = Math.min(2, Math.max(0, d.jobCount - 1) * 0.5);
  return Math.round((base + freq + (d.inTitle ? 1 : 0)) * 10) / 10;
}

function listItems(line: string): string[] {
  const out: string[] = [];
  const grabs = [
    ...Array.from(line.matchAll(/\b(?:experience|proficien\w*|familiar\w*|knowledge|expertise|skills?|background|hands-on|work(?:ing)?|fluency|exposure)\s+(?:with|in|of|using|on)\s+([^.;:]+)/gi)).map((m) => m[1]!),
    ...Array.from(line.matchAll(/\((?:e\.g\.,?|i\.e\.,?|such as|including)?\s*([^)]+)\)/gi)).map((m) => m[1]!),
    ...Array.from(line.matchAll(/\b(?:such as|including|like)\s+([^.;:]+)/gi)).map((m) => m[1]!),
  ];
  for (const g of grabs) {
    const pieces = g.split(/,|;|\s+(?:and|or|and\/or)\s+|\s\/\s/).flatMap((x) => (/^\s*[\w.+#-]{3,}\/[\w.+#-]{3,}\s*$/.test(x) ? x.split('/') : [x]));
    for (const raw of pieces) {
      const item = raw.replace(/^(?:and|or|the|a|an|modern|common|popular|major|other|similar|related|various)\s+/i, '').replace(/\s+(?:etc\.?|or similar|or equivalent|frameworks?|platforms?|tools?)$/i, '').trim();
      const words = item.split(/\s+/);
      if (!item || words.length > 4 || item.length < 2 || item.length > 40) continue;
      if (!words.every((w) => /^(?:[A-Z0-9][\w.+#/-]*|[a-z]+[A-Z][\w.+#-]*|\.NET|of|and|for)$/.test(w))) continue;
      if (words.every((w) => GENERIC.has(w.toLowerCase()))) continue;
      out.push(item);
    }
  }
  return out;
}

export const TECH_TOKEN = /(?<![A-Za-z0-9.])((?:[A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*)|(?:[a-z]+[A-Z][A-Za-z0-9]*)|(?:[A-Za-z]+\d+[A-Za-z0-9]*)|(?:[A-Za-z]+\.js)|(?:H\.26[45]))(?![A-Za-z0-9])/g;

const CERT_RE = /\b(AWS Certified [A-Z][\w-]*(?:\s[A-Z][\w-]*){0,4}|Certified Kubernetes (?:Administrator|Application Developer|Security Specialist)|CKA|CKAD|PMP|CISSP|CISM|CISA|CompTIA (?:Security\+|Network\+|A\+|Cloud\+)|Security\+|Certified Scrum Master|CSM|PSM I{0,2}|Google Cloud (?:Professional|Associate) [A-Z][\w ]{3,40}?(?= certification|,|\.|$)|Azure (?:Solutions Architect|Administrator|Developer) (?:Expert|Associate)|(?:AZ|DP|AI)-\d{3})\b/g;

function requirementText(job: JobPosting): string {
  return [...job.qualifications, ...job.responsibilities].join('\n');
}

const VENDOR = /^(?:google|amazon|aws|microsoft|apache|ibm|oracle|adobe|meta|elastic)\s+/i;

function vendorVariant(a: string, b: string): boolean {
  const strip = (x: string) => x.replace(VENDOR, '').trim().toLowerCase();
  return strip(a) === strip(b) && strip(a).length >= 2;
}

const NOT_SKILL_LINE = /\b(authori[sz]|sponsor|citizen|green card|visa|clearance|equal opportunity|eeo|disabilit|veteran|background check|drug|benefits?|salary|compensation|401k|pto|relocat)/i;
const PLACE_ONLY = new RegExp(`^(?:the\\s+)?(?:${'United States|USA|US|U\\.S\\.|Canada|India|Europe|North America|EMEA|APAC|LATAM|[A-Z][a-z]+,\\s*[A-Z]{2}'})$`);

function freeOccurrences(text: string, token: string, longer: string[]): number {
  let masked = text;
  for (const f of longer.filter((x) => x.length > token.length && x.toLowerCase().includes(token.toLowerCase())).sort((a, b) => b.length - a.length)) {
    masked = masked.replace(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+'), 'gi'), ' ');
  }
  return countForm(masked, token);
}

export function extractJobKeywords(job: JobPosting, analysis?: Pick<JobAnalysis, 'requiredSkills' | 'preferredSkills' | 'resumeKeywords'> | null): AtsKeyword[] {
  const description = withoutContacts(job.description || '');
  job = { ...job, description };
  const reqText = requirementText(job);
  const prefLines = description.split('\n').filter((l) => /\b(preferred|nice to have|bonus|plus)\b/i.test(l)).join('\n');
  const companyWords = new Set(job.company.split(/\s+/).map((w) => w.toLowerCase()));
  const required = new Set([...(analysis?.requiredSkills ?? []), ...job.requiredSkills].map((s) => canonicalSkill(s).toLowerCase()));
  const preferred = new Set([...(analysis?.preferredSkills ?? []), ...job.preferredSkills].map((s) => canonicalSkill(s).toLowerCase()));
  const drafts: Draft[] = [];
  const title = cleanJobTitle(job.title);
  const titleLower = title.toLowerCase();

  const importanceFor = (name: string, surface: string): AtsKeyword['importance'] => {
    const c = canonicalSkill(name).toLowerCase();
    if (required.has(c) || required.has(surface.toLowerCase())) return 'required';
    if (preferred.has(c) || preferred.has(surface.toLowerCase())) return 'preferred';
    if (countForm(reqText, surface) && !countForm(prefLines, surface)) return 'required';
    if (countForm(prefLines, surface)) return 'preferred';
    return 'mentioned';
  };
  const add = (term: string, kind: KeywordKind, importance: AtsKeyword['importance'], forms: string[] = []) => {
    const t = term.trim();
    if (!t) return;
    const all = [t, ...forms, ...synonymsOf(t)];
    if (PLACE_ONLY.test(t)) return;
    const existing = drafts.find((d) => d.kind !== 'title' && (sameKeyword(d.term, t) || Array.from(d.forms).some((f) => sameKeyword(f, t) || vendorVariant(f, t))));
    if (existing) {
      all.forEach((f) => existing.forms.add(f));
      if (IMPORTANCE_RANK[importance] > IMPORTANCE_RANK[existing.importance]) existing.importance = importance;
      if (kind === 'hard' && existing.kind === 'domain') existing.kind = 'hard';
      return;
    }
    const jobCount = Math.max(1, ...all.map((f) => countForm(`${job.title}\n${description}`, f)));
    drafts.push({ term: t, forms: new Set(all), kind, importance, jobCount, inTitle: all.some((f) => countForm(job.title, f) > 0) });
  };

  if (title) {
    const core = coreTitle(title);
    drafts.push({ term: title, forms: new Set([title, ...(core && core !== title ? [core] : [])]), kind: 'title', importance: 'required', jobCount: 1, inTitle: true });
  }

  for (const m of findSkillMentions(`${job.title}\n${description}`)) {
    const def = SKILL_BY_NAME.get(m.name.toLowerCase());
    const surfaces = Array.from(m.surfaces.entries()).sort((a, b) => b[1] - a[1]);
    const lowerName = m.name.toLowerCase();
    const isSame = (s: string) => {
      const l = s.toLowerCase();
      if (sameKeyword(s, m.name) || termKey(s) === termKey(m.name)) return true;
      if (lowerName.includes(l)) return true;
      if (l.includes(lowerName) && l !== lowerName) return false;
      const productLike = /[A-Z0-9.+#]/.test(s) && s !== s.toLowerCase();
      return !productLike;
    };
    const same = surfaces.filter(([s]) => isSame(s));
    const members = surfaces.filter(([s]) => !isSame(s) && !same.some(([x]) => x.toLowerCase().includes(s.toLowerCase())));
    for (const [s, n] of surfaces) if (!isSame(s) && same.some(([x]) => x.toLowerCase().includes(s.toLowerCase()))) same.push([s, n]);
    const memberGroups: [string, number][][] = [];
    for (const mem of members) {
      const g = memberGroups.find((grp) => grp.some(([x]) => x.toLowerCase().includes(mem[0].toLowerCase()) || mem[0].toLowerCase().includes(x.toLowerCase())));
      if (g) g.push(mem);
      else memberGroups.push([mem]);
    }
    if (same.length) {
      const surface = [...same].filter(([s]) => s !== s.toLowerCase()).sort((x, y) => y[0].length - x[0].length)[0]?.[0] ?? same[0]![0];
      const term = surface === surface.toLowerCase() ? m.name : surface;
      add(term, 'hard', importanceFor(m.name, surface), [m.name, ...same.map(([s]) => s)]);
      const d = drafts.find((x) => x.forms.has(term));
      if (d) d.canon = m.name;
    }
    for (const grp of memberGroups) {
      const longest = [...grp].sort((a, b) => b[0].length - a[0].length)[0]![0];
      void def;
      add(longest, 'hard', importanceFor(m.name, longest), grp.map(([s]) => s));
    }
  }
  const hasCanon = (tag: string) => drafts.some((d) => d.canon && d.canon.toLowerCase() === canonicalSkill(tag).toLowerCase());
  for (const tag of job.requiredSkills) if (!hasCanon(tag)) add(tag, 'hard', 'required');
  for (const tag of job.preferredSkills) if (!hasCanon(tag)) add(tag, 'hard', 'preferred');

  const tokenCounts = new Map<string, number>();
  for (const m of description.matchAll(TECH_TOKEN)) {
    const tok = m[1]!;
    if (STOP_TOKENS.has(tok) || STOP_TOKENS.has(tok.toUpperCase()) || companyWords.has(tok.toLowerCase()) || /^\d/.test(tok) || tok.length < 2) continue;
    tokenCounts.set(tok, (tokenCounts.get(tok) ?? 0) + 1);
  }
  const knownForms = () => drafts.flatMap((d) => Array.from(d.forms));
  for (const [tok, n] of tokenCounts) {
    if (n < 2 && !countForm(reqText, tok)) continue;
    if (!freeOccurrences(`${job.title}\n${description}`, tok, knownForms())) continue;
    add(tok, 'hard', importanceFor(tok, tok));
  }

  for (const line of [...job.qualifications, ...job.responsibilities, ...description.split('\n')]) {
    if (NOT_SKILL_LINE.test(line)) continue;
    for (const item of listItems(line)) {
      if (item.split(/\s+/).some((w) => companyWords.has(w.toLowerCase()))) continue;
      if (!freeOccurrences(`${job.title}\n${description}`, item, knownForms())) continue;
      add(item, 'hard', importanceFor(item, item));
    }
  }

  for (const [long, short] of acronymPairs(description)) {
    const d = drafts.find((x) => sameKeyword(x.term, short) || sameKeyword(x.term, long));
    if (d) {
      d.forms.add(long);
      d.forms.add(short);
    } else add(short, 'hard', importanceFor(short, short), [long]);
  }

  const phraseCounts = new Map<string, number>();
  for (const sentence of description.toLowerCase().split(/[.\n;:!?()•]+/)) {
    const words = sentence.split(/[^a-z0-9+#-]+/).filter(Boolean);
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const w = words.slice(i, i + n);
        if (GENERIC.has(w[0]!) || GENERIC.has(w[n - 1]!) || w.some((x) => x.length < 2 || /^\d+$/.test(x)) || w.filter((x) => GENERIC.has(x)).length > 0) continue;
        const p = w.join(' ');
        phraseCounts.set(p, (phraseCounts.get(p) ?? 0) + 1);
      }
    }
  }
  const company = job.company.toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|co|company)\b\.?/g, '').trim();
  const companyFirst = company.split(/\s+/)[0] ?? '';
  const phrases = Array.from(phraseCounts.entries())
    .filter(([p]) => !(company && (p.includes(company) || company.includes(p) || (companyFirst.length >= 4 && p.split(' ').includes(companyFirst)))))
    .filter(([p, n]) => (n >= 2 || titleLower.includes(p)) && !drafts.some((d) => Array.from(d.forms).some((f) => f.toLowerCase().includes(p) || p.includes(f.toLowerCase()))))
    .sort((a, b) => b[1] * b[0].length - a[1] * a[0].length)
    .slice(0, 8);
  for (const [p, n] of phrases) {
    if (phrases.some(([q, m]) => q !== p && q.includes(p) && m >= n)) continue;
    add(p, 'domain', titleLower.includes(p) ? 'required' : 'mentioned');
  }

  for (const s of findSoftSkills(description)) {
    const def = SOFT_SKILLS.find((x) => x.name === s)!;
    drafts.push({ term: s, forms: new Set([s, ...def.aliases]), kind: 'soft', importance: 'mentioned', jobCount: 1, inTitle: false });
  }

  const edu = job.educationRequirements.join(' ') || (description.match(/[^.\n]*\b(?:bachelor|master|ph\.?d|degree)\b[^.\n]*/i)?.[0] ?? '');
  if (edu) {
    const req = /\b(required|must|minimum)\b/i.test(edu) && !/\bor equivalent experience\b/i.test(edu) ? 'required' : 'preferred';
    if (/\bph\.?\s?d|doctor/i.test(edu)) drafts.push({ term: 'PhD', forms: new Set(['PhD', 'Ph.D', 'Doctorate', 'Doctor of Philosophy']), kind: 'education', importance: req, jobCount: 1, inTitle: false });
    else if (/\bmaster/i.test(edu)) drafts.push({ term: 'Master’s degree', forms: new Set(['Master', 'Masters', 'M.S', 'MS', 'MSc', 'M.Sc', 'MBA', 'M.Eng']), kind: 'education', importance: req, jobCount: 1, inTitle: false });
    else if (/\bbachelor|\bb\.?s\.?\b|\bdegree\b/i.test(edu)) drafts.push({ term: 'Bachelor’s degree', forms: new Set(['Bachelor', 'Bachelors', 'B.S', 'BS', 'BSc', 'B.Sc', 'B.A', 'BA', 'B.Tech', 'B.E']), kind: 'education', importance: req, jobCount: 1, inTitle: false });
    const field = edu.match(/\b(Computer Science|Computer Engineering|Electrical Engineering|Software Engineering|Information Technology|Information Systems|Mathematics|Statistics|Data Science|Engineering)\b/i)?.[1];
    if (field) drafts.push({ term: field.replace(/\b\w/g, (c) => c.toUpperCase()), forms: new Set([field]), kind: 'education', importance: req, jobCount: 1, inTitle: false });
  }

  for (const m of description.matchAll(CERT_RE)) add(m[1]!, 'certification', /\brequired|must\b/i.test(description.slice(Math.max(0, m.index! - 80), m.index! + 120)) ? 'required' : 'preferred');

  const out: AtsKeyword[] = drafts.map((d) => ({
    term: d.term,
    forms: Array.from(new Set(Array.from(d.forms).map((f) => f.trim()).filter(Boolean))),
    kind: d.kind,
    importance: d.importance,
    weight: weightOf(d),
    jobCount: d.jobCount,
  }));
  const byWeight = (a: AtsKeyword, b: AtsKeyword) => b.weight - a.weight || b.jobCount - a.jobCount;
  const titleKw = out.filter((k) => k.kind === 'title');
  const tech = out.filter((k) => k.kind === 'hard' || k.kind === 'domain').sort(byWeight);
  const technical = [...tech.filter((k) => k.importance !== 'preferred').slice(0, 70), ...tech.filter((k) => k.importance === 'preferred').slice(0, 15)].sort(byWeight);
  const other = out.filter((k) => k.kind === 'soft' || k.kind === 'education' || k.kind === 'certification').sort(byWeight);
  return [...titleKw, ...technical, ...other.slice(0, 10)];
}
