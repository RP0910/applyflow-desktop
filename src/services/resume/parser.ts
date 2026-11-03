/**
 * Plain-text resume → structured sections.
 * Deterministic and conservative: anything it can't classify goes to `unparsed`
 * (shown to the user) rather than being dropped or guessed.
 */
import type { ContactInfo, EducationEntry, ExperienceEntry, ParsedResume, ProjectEntry } from '@/types';
import { uniqCaseInsensitive } from '@/utils/text';

type SectionKey = 'summary' | 'skills' | 'experience' | 'education' | 'certifications' | 'projects' | 'publications' | 'languages' | 'links' | 'other';

const HEADINGS: Record<Exclude<SectionKey, 'other'>, string[]> = {
  summary: ['summary', 'professional summary', 'profile', 'professional profile', 'about', 'about me', 'objective', 'career objective', 'career summary', 'executive summary', 'overview', 'qualifications summary', 'summary of qualifications'],
  skills: ['skills', 'technical skills', 'core skills', 'key skills', 'core competencies', 'competencies', 'technologies', 'tech stack', 'technical expertise', 'areas of expertise', 'expertise', 'skills & tools', 'skills and tools', 'tools', 'technical proficiencies', 'skills summary'],
  experience: ['experience', 'work experience', 'professional experience', 'employment', 'employment history', 'work history', 'career history', 'relevant experience', 'professional background', 'experience highlights'],
  education: ['education', 'academic background', 'education & training', 'education and training', 'academics'],
  certifications: ['certifications', 'certification', 'certificates', 'licenses & certifications', 'licenses and certifications', 'professional certifications', 'credentials'],
  projects: ['projects', 'selected projects', 'key projects', 'personal projects', 'side projects', 'open source', 'open-source projects', 'project highlights'],
  publications: ['publications', 'papers', 'talks', 'publications & talks', 'publications and talks', 'patents', 'speaking'],
  languages: ['languages', 'spoken languages'],
  links: ['links', 'online presence', 'profiles', 'portfolio'],
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|gitlab\.com|[a-z0-9-]+\.(?:dev|io|me|com|net|org))(?:\/[^\s|,;]*)?/gi;
const STATE_CODES = 'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|PR';
const PLACE_NAMES = 'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|USA|United States|United States of America|Canada|India|UK|United Kingdom|England|Mexico|Germany|Ireland|Japan|China|Singapore|Australia|New Zealand|France|Spain|Italy|Portugal|Netherlands|Belgium|Switzerland|Austria|Sweden|Norway|Denmark|Finland|Poland|Ukraine|Romania|Czech Republic|Czechia|Hungary|Greece|Turkey|Israel|United Arab Emirates|UAE|Saudi Arabia|Egypt|Nigeria|Kenya|South Africa|Brazil|Argentina|Chile|Colombia|Peru|Philippines|Vietnam|Thailand|Malaysia|Indonesia|South Korea|Korea|Taiwan|Hong Kong|Pakistan|Bangladesh|Sri Lanka|Russia|Belarus|Serbia|Croatia|Bulgaria|Estonia|Latvia|Lithuania|Costa Rica|Puerto Rico';
const LOCATION_RE = new RegExp(
  `\\b([A-Z][a-zA-Z.]+(?:[ -][A-Z][a-zA-Z.]+)*,\\s*(?:${STATE_CODES}|${PLACE_NAMES}))\\b(?:\\s+\\d{5})?|\\bRemote(?:\\s*\\([^)]*\\))?`,
);
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE_TOKEN = `(?:${MONTH}\\s+\\d{4}|${MONTH}\\s*['’]\\d{2}|\\d{1,2}[/.]\\d{4}|\\d{4})`;
export const DATE_RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to|until)\\s*(${DATE_TOKEN}|present|current|now|today)`, 'i');
/** Glyph bullets may touch the text ("•Built …" in FlowCV PDFs); dashes and numbers need a space. */
const BULLET_RE = /^\s*(?:[•·▪●◦►‣⁃■□○◆❖➢✓✔⦁\uF0B7\uF0A7\uF076\uF0D8]\s*|[-*–—]\s+|\d+[.)]\s+)(?=\S)/;
const TITLE_WORDS = /\b(engineer|developer|architect|manager|director|analyst|lead|consultant|scientist|specialist|administrator|designer|intern|officer|head|vp|vice president|president|principal|staff|programmer|owner|founder|co-founder|associate|coordinator|technician|strategist|researcher|advisor|partner|cto|cio|ceo)\b/i;
const DEGREE_WORDS = /\b(b\.?s\.?c?|b\.?a\.?|m\.?s\.?c?|m\.?a\.?|mba|ph\.?d|doctor(ate)?|bachelor'?s?|master'?s?|associate'?s?|diploma|degree|b\.?tech|m\.?tech|b\.?e\.?|m\.?eng)\b/i;
const SCHOOL_WORDS = /\b(university|college|institute|school|academy|polytechnic)\b/i;

function headingKey(line: string): SectionKey | null {
  const clean = line.replace(/[:：]\s*$/, '').replace(/[^\p{L}&\s-]/gu, '').trim().toLowerCase();
  if (!clean || clean.length > 40) return null;
  for (const [key, names] of Object.entries(HEADINGS)) {
    if (names.includes(clean)) return key as SectionKey;
  }
  return null;
}

/** "Professional Experience", "EDUCATION:" … — a known resume section heading. */
export function isSectionHeading(line: string): boolean {
  return headingKey(line) !== null;
}

function isBullet(line: string): boolean {
  return BULLET_RE.test(line);
}

function stripBullet(line: string): string {
  return line.replace(BULLET_RE, '').trim();
}

let idCounter = 0;
function localId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(36)}`;
}

function emptyContact(): ContactInfo {
  return { fullName: '', email: '', phone: '', location: '', links: [] };
}

/** Per-job technology lists ("Technologies", "Tech stack: …", "Environment: …"). */
const STRONG_JOB_SUBS = new Set([
  'technologies', 'technology', 'tech stack', 'stack', 'tech', 'environment', 'technical environment', 'tools used', 'technologies used',
  'tools & technologies', 'tools and technologies', 'key technologies', 'skills used', 'technologies & tools', 'technologies and tools', 'tech used',
]);
const WEAK_JOB_SUBS = new Set(['tools', 'skills', 'key skills', 'technical skills']);

export function jobSubheading(line: string): { label: string; rest: string; strong: boolean } | null {
  const m = line.trim().match(/^([A-Za-z][A-Za-z &/]{1,38}?)\s*(?:[:：]\s*(.*))?$/);
  if (!m) return null;
  const label = m[1]!.toLowerCase().replace(/\s+/g, ' ').trim();
  const strong = STRONG_JOB_SUBS.has(label);
  if (!strong && !WEAK_JOB_SUBS.has(label)) return null;
  return { label, rest: (m[2] ?? '').trim(), strong };
}

/**
 * Is this "Technologies"-style line a sub-heading inside a job (true) or the start of a
 * top-level Skills section (false)? Sub-headings are followed by another dated role before the
 * next real section, repeat under several jobs, or are styled differently from the main headings.
 */
function isJobSubheadingAt(lines: string[], i: number, sub: { rest: string; strong: boolean }, headingCaps: boolean, seenBefore: boolean): boolean {
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j]!.trim();
    if (!l) continue;
    if (jobSubheading(l)) continue;
    if (headingKey(l)) break;
    if (DATE_RANGE_RE.test(l)) return true;
  }
  if (seenBefore) return true;
  const raw = lines[i]!.trim();
  const caps = raw === raw.toUpperCase();
  if (sub.strong && (sub.rest || (headingCaps && !caps))) return true;
  return false;
}

export function parseResumeText(input: string): ParsedResume {
  idCounter = 0;
  const lines = input
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/\t+/g, '  ').replace(/[ ]{3,}/g, '  ').trimEnd());

  const sections: Record<SectionKey, string[]> = {
    summary: [], skills: [], experience: [], education: [], certifications: [], projects: [], publications: [], languages: [], links: [], other: [],
  };
  const header: string[] = [];
  let current: SectionKey | 'header' = 'header';
  let experienceHeadingCaps = false;
  let seenJobSub = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) {
      if (current !== 'header') sections[current].push('');
      continue;
    }
    // "Technologies" / "Tech stack: …" under a job belongs to that job — it is not the Skills section.
    if (current === 'experience') {
      const sub = jobSubheading(line);
      if (sub && isJobSubheadingAt(lines, i, sub, experienceHeadingCaps, seenJobSub)) {
        seenJobSub = true;
        sections.experience.push(line);
        continue;
      }
    }
    // "Skills: Python, Go" — heading and content on one line.
    // Inside Skills, "Languages: Python, Go" is a category label, not a new section.
    const inline: RegExpMatchArray | null = current === 'skills' ? null : line.match(/^([A-Za-z &]{3,40})[:：]\s+(.+)$/);
    const k: SectionKey | null = headingKey(line) ?? (inline ? headingKey(inline[1]!) : null);
    if (k) {
      current = k;
      if (k === 'experience') {
        experienceHeadingCaps = line === line.toUpperCase() && /[A-Z]/.test(line);
        seenJobSub = false;
      }
      if (inline && headingKey(inline[1]!) && !headingKey(line)) sections[k].push(inline[2]!);
      continue;
    }
    if (current === 'header') header.push(line);
    else sections[current].push(line);
  }

  const contact = emptyContact();
  const allLinks: string[] = [];
  let headline = '';
  const headerLeftovers: string[] = [];
  for (const line of header) {
    const email = line.match(EMAIL_RE)?.[0];
    const phone = line.match(PHONE_RE)?.[0];
    const links = Array.from(line.matchAll(URL_RE)).map((m) => m[0]).filter((u) => !EMAIL_RE.test(u) && !u.includes('@'));
    const loc = line.match(LOCATION_RE)?.[0];
    if (email && !contact.email) contact.email = email;
    if (phone && !contact.phone) contact.phone = phone.trim();
    allLinks.push(...links.filter((l) => !(email && email.includes(l))));
    const isContactLine = Boolean(email || phone || links.length);
    if (!contact.fullName && !isContactLine && line.split(/\s+/).length <= 5 && /^[\p{L}'.\- ]+$/u.test(line)) {
      contact.fullName = line;
      continue;
    }
    if (loc && !contact.location && (isContactLine || line.length < 60)) {
      contact.location = loc.trim();
      if (isContactLine || line.trim() === loc.trim()) continue;
    }
    if (isContactLine) continue;
    if (!headline && contact.fullName && line.length < 110 && !/[.!?]$/.test(line)) {
      headline = line;
      continue;
    }
    headerLeftovers.push(line);
  }
  // A short paragraph directly under the header with no heading reads as a summary.
  let summary = sections.summary.filter(Boolean).join(' ').trim();
  if (!summary && headerLeftovers.length) {
    const prose = headerLeftovers.filter((l) => l.length > 60);
    if (prose.length) {
      summary = prose.join(' ');
      for (const p of prose) headerLeftovers.splice(headerLeftovers.indexOf(p), 1);
    }
  }

  const links = uniqCaseInsensitive([...allLinks, ...sections.links.filter(Boolean).flatMap((l) => Array.from(l.matchAll(URL_RE)).map((m) => m[0]))]);
  contact.links = links;

  return {
    contact,
    headline,
    summary,
    skills: parseSkills(sections.skills),
    experience: parseExperience(sections.experience),
    education: parseEducation(sections.education),
    certifications: parseSimpleList(sections.certifications),
    projects: parseProjects(sections.projects),
    publications: parseSimpleList(sections.publications),
    languages: parseSkills(sections.languages),
    links,
    unparsed: [...headerLeftovers, ...sections.other.filter(Boolean)],
  };
}

/** Split on separators, but never inside parentheses: "AWS (EC2, EKS), Python" → ["AWS (EC2, EKS)", "Python"]. */
function splitTopLevel(line: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '(' || ch === '[') depth++;
    if ((ch === ')' || ch === ']') && depth > 0) depth--;
    const isSep = depth === 0 && (/[,;|•·▪●]/.test(ch) || (ch === ' ' && line[i + 1] === ' '));
    if (isSep) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

const LABEL_WORDS = new Set(
  'ai ml data cloud platform platforms language languages programming tools tooling frameworks framework libraries databases database devops practices architecture other technologies technical methodologies methods frontend front-end backend back-end testing security soft skills infrastructure mobile web analytics core design management certifications concepts systems'.split(' '),
);

/**
 * "Helm AI & Data: Large Language Models" → ["Helm", "Large Language Models"].
 * Walks back from the colon over category words only, so a real skill before the label survives.
 */
function splitEmbeddedLabel(part: string): string[] {
  const idx = part.indexOf(': ');
  if (idx < 0) return [part];
  const words = part.slice(0, idx).trim().split(/\s+/);
  let cut = words.length;
  while (cut > 0 && (LABEL_WORDS.has(words[cut - 1]!.toLowerCase()) || /^(&|and|\/)$/i.test(words[cut - 1]!))) cut--;
  const before = words.slice(0, cut).join(' ');
  return [before, ...splitEmbeddedLabel(part.slice(idx + 2))].filter(Boolean);
}

const GLYPH = /[•·▪●◦►‣⁃■◆❖➢⦁\uF0B7\uF0A7]/;

/** A category label in a skills grid ("Cloud & DevOps", "Video Players") rather than a skill. */
function looksLikeLabel(frag: string): boolean {
  const t = frag.trim();
  const words = t.split(/\s+/);
  return words.length >= 2 && words.length <= 4 && !/[\d(),.+#/]/.test(t) && words.every((w) => /^(?:[A-Z][\p{L}-]*|&|and|of)$/u.test(w));
}

export function parseSkills(lines: string[]): string[] {
  // Grid layouts (FlowCV, Canva) put "•Skill" items in columns with unbulleted category labels between them.
  const frags = lines.flatMap((l) => l.split(/\s{2,}/)).map((f) => f.trim()).filter(Boolean);
  const bulleted = frags.filter((f) => GLYPH.test(f.charAt(0))).length;
  const gridLabels = bulleted >= 6 && bulleted >= frags.length * 0.6;
  const out: string[] = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const pieces = gridLabels ? raw.split(/\s{2,}/).filter((f) => !(f.trim() && !GLYPH.test(f.trim().charAt(0)) && looksLikeLabel(f))) : [raw];
    for (const piece of pieces) {
      // Drop "Cloud & DevOps:" style category labels.
      const line = stripBullet(piece.trim()).replace(/^[A-Za-z][A-Za-z &/+-]{1,40}:\s+/, '');
      for (const rawPart of splitTopLevel(line)) {
        for (const part of splitEmbeddedLabel(rawPart)) {
          const s = part.replace(/^and\s+/i, '').replace(/[.]$/, '').trim();
          if (s && s.length <= 80) out.push(s);
        }
      }
    }
  }
  return uniqCaseInsensitive(out);
}

function parseSimpleList(lines: string[]): string[] {
  return lines.filter((l) => l.trim()).map(stripBullet).filter(Boolean);
}

function splitSegments(header: string): string[] {
  return header
    .split(/\s+\|\s+|\s+[—–]\s+|\s{2,}|\s+@\s+|\s+at\s+(?=[A-Z])|\t/)
    .map((s) => s.replace(/^[,\s]+|[,\s]+$/g, '').trim())
    .filter(Boolean);
}

/** Group lines into role blocks: header lines (until first bullet) + bullets. */
const CONNECTOR = /^(?:of|and|&|for|the|in|at|to|\||[-–—,/@]|ai|ml|it|qa|ui|ux)$/i;

/**
 * Undo lines that an older PDF reader glued together:
 *  - "…for operations teams. Staff Software Engineer, Comcast 06/2018 – 01/2023" (a role header
 *    swallowed by the last bullet of the role above), and
 *  - "Staff Engineer, Comcast 06/2018 – 01/2023 Built the platform that…" (a header that
 *    swallowed the first bullet).
 */
export function splitMergedLine(line: string): string[] {
  const m = DATE_RANGE_RE.exec(line);
  if (!m) return [line];
  const before = line.slice(0, m.index);
  const after = line.slice(m.index + m[0].length);
  // Header glued to the end of a bullet.
  if (before.trim().length > 40) {
    let cut = -1;
    const sentence = Array.from(before.matchAll(/[.!?;](?=\s+[A-Z])/g)).pop();
    if (sentence && sentence.index! > 20) cut = sentence.index! + 1;
    if (cut < 0) {
      // No punctuation: walk back over a Title-Case run ("Staff Software Engineer, Comcast").
      const words = before.trimEnd().split(/(\s+)/);
      let i = words.length;
      let titleish = 0;
      while (i > 0) {
        const w = words[i - 1]!;
        if (/^\s+$/.test(w)) {
          i--;
          continue;
        }
        const bare = w.replace(/[,|()]/g, '');
        if (/^[A-Z0-9]/.test(bare) || CONNECTOR.test(bare) || !bare) {
          if (/^[A-Z]/.test(bare)) titleish++;
          i--;
        } else break;
      }
      const run = words.slice(i).join('').trim();
      // Only when the dates end the line (a header), not mid-sentence in a real bullet.
      if (titleish >= 2 && TITLE_WORDS.test(run) && run.length < before.trim().length - 20 && after.trim().length <= 40) cut = before.lastIndexOf(run);
    }
    if (cut > 0) {
      const header = before.slice(cut).trim();
      if (header.length >= 3 && header.length <= 120 && (TITLE_WORDS.test(header) || /[|,@]|\sat\s/.test(header))) {
        return [before.slice(0, cut).trim(), ...splitMergedLine(`${header} ${line.slice(m.index)}`.trim())];
      }
    }
  }
  // A bullet glued after the header's dates (and optional location).
  const rest = after.trim();
  if (!isBullet(line) && before.trim().length <= 120 && rest.length > 60) {
    const loc = rest.match(new RegExp(`^(?:[|,·•–-]\\s*)?(${LOCATION_RE.source})`))?.[0] ?? '';
    const body = rest.slice(loc.length).trim();
    if (body.length > 50 && /^[A-Z]/.test(body)) return [`${before}${m[0]}${loc ? ` ${loc.trim()}` : ''}`.trim(), body];
  }
  return [line];
}

const COMPANY_WORDS = /\b(inc|llc|ltd|corp|corporation|company|co|group|technologies|solutions|systems|labs|bank|partners|holdings)\b\.?/i;
const PLACE_ONLY_RE = new RegExp(`^(?:${PLACE_NAMES})$`, 'i');
const CITY_COMMA_RE = /^[A-Z][\p{L}.'’-]+(?:\s[A-Z][\p{L}.'’-]+){0,3},$/u;
const CITY_PLACE_RE = /^[A-Z][\p{L}.'’-]+(?:\s[A-Z][\p{L}.'’-]+){0,3},\s*[A-Z][\p{L}.'’-]+(?:\s[A-Z][\p{L}.'’-]+){0,3}$/u;

/** "Denver, CO", "Boston," (wraps to "United States"), "Tokyo, Japan", "Remote". */
export function isLocationish(s: string): boolean {
  const t = s.replace(/^[|·,\s]+|[|·\s]+$/g, '').trim();
  if (!t || t.length > 40) return false;
  if (/^(?:remote|hybrid|on-?site)\b/i.test(t) && t.length < 30) return true;
  const m = t.match(LOCATION_RE)?.[0];
  if (m && m.length >= t.replace(/,$/, '').length - 1) return true;
  if (PLACE_ONLY_RE.test(t)) return true;
  if (TITLE_WORDS.test(t) || COMPANY_WORDS.test(t)) return false;
  return CITY_COMMA_RE.test(t) || CITY_PLACE_RE.test(t);
}

/**
 * Two-column layouts (dates and city in a narrow left column) come out of the PDF reader as
 * "Denver, CO  AI Video Playback Engineer". Split off the left-column location.
 */
export function splitSideColumn(line: string): { side: string | null; main: string } {
  const idx = line.indexOf('  ');
  if (idx <= 0) return { side: null, main: line };
  const left = line.slice(0, idx).trim();
  const right = line.slice(idx).trim();
  if (!right || left.length > 40 || isBullet(left) || DATE_RANGE_RE.test(right) || DATE_RANGE_RE.test(left)) return { side: null, main: line };
  return isLocationish(left) ? { side: left, main: right } : { side: null, main: line };
}

/** "Swift • Kotlin • Java", "Docker, Kubernetes, Terraform" — a short-item list. */
function isListLine(line: string): boolean {
  const items = line.split(/\s*[•·▪●|,;]\s*/).map((x) => x.trim()).filter(Boolean);
  if (items.length < 2 && !(items.length === 1 && GLYPH.test(line.trim().charAt(0)) && items[0]!.split(/\s+/).length <= 4)) return false;
  return items.every((x) => x.split(/\s+/).length <= 5) && items.reduce((n, x) => n + x.split(/\s+/).length, 0) / items.length <= 3.2;
}

function listItems(line: string): string[] {
  return line
    .split(/\s*[•·▪●|;]\s*|,\s+(?![^()]*\))/)
    .map((x) => x.replace(/^and\s+/i, '').replace(/[.]$/, '').trim())
    .filter((x) => x && x.length <= 60);
}

/** The line above ends mid-thought, so this line continues it. */
const OPEN_END = /(?:[,;:(/&–-]|\b(?:and|or|of|with|using|for|to|the|a|an|in|on|by|including|across|via|from|into|as|at|that|which|while|over|through|between|within|plus|such as))$/i;

const LOCATION_AT_END = new RegExp(`(?:${LOCATION_RE.source})\\s*$`);

export function parseExperience(rawLines: string[]): ExperienceEntry[] {
  const entries: ExperienceEntry[] = [];
  let headerBuf: string[] = [];
  let bullets: string[] = [];
  let techs: string[] = [];
  let sideLoc: string[] = [];
  let techMode = false;
  let lastTechLine = '';
  const lines: string[] = [];
  const sides = new Map<number, string>();
  for (const raw of rawLines.flatMap((l) => splitMergedLine(l.trim()))) {
    const { side, main } = splitSideColumn(raw);
    if (side) sides.set(lines.length, side);
    lines.push(main);
  }

  const flush = () => {
    if (!headerBuf.length && !bullets.length) return;
    const e = buildEntry(headerBuf, bullets);
    if (!e.location && sideLoc.length) e.location = sideLoc.join(' ').replace(/\s+,/g, ',').replace(/,$/, '').trim();
    if (techs.length) e.technologies = uniqCaseInsensitive(techs);
    entries.push(e);
    headerBuf = [];
    bullets = [];
    techs = [];
    sideLoc = [];
  };
  const addSide = (loc: string) => {
    const last = sideLoc[sideLoc.length - 1];
    if (last && /,$/.test(last)) sideLoc[sideLoc.length - 1] = `${last} ${loc}`;
    else if (!last) sideLoc.push(loc);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const side = sides.get(i);
    if (!line) {
      if (side) addSide(side);
      continue;
    }
    const dated = DATE_RANGE_RE.test(line);
    // Technology list under the job ("Technologies" heading, then "Swift • Kotlin • …").
    const sub = jobSubheading(line);
    if (sub && (headerBuf.length || bullets.length)) {
      techMode = true;
      lastTechLine = sub.rest || ',';
      if (sub.rest) techs.push(...listItems(sub.rest));
      continue;
    }
    // A list that ended with a separator continues on the next line, even if that line is one word.
    const listOpen = techMode && /[,•·|;]\s*$/.test(lastTechLine);
    if (techMode && !dated && !side && (isListLine(line) || (listOpen && line.split(/\s+/).length <= 4))) {
      techs.push(...listItems(stripBullet(line)));
      lastTechLine = line;
      continue;
    }
    techMode = false;
    // A line that finishes the bullet above it (the PDF wrapped it).
    const prev = bullets[bullets.length - 1];
    if (prev && !side && !dated && !isBullet(line) && (OPEN_END.test(prev) || /^[a-z(]/.test(line))) {
      bullets[bullets.length - 1] = prev.endsWith('-') && /^[a-z]/.test(line) ? `${prev}${line}` : `${prev} ${line}`;
      continue;
    }
    if (isBullet(line)) {
      bullets.push(stripBullet(line));
      continue;
    }
    // "Denver, CO" or "Remote" on its own line belongs to the role header above it.
    const where = line.match(LOCATION_RE)?.[0];
    if (headerBuf.length && !bullets.length && where && where.length >= line.replace(/^[|,·\s]+|[|,·\s]+$/g, '').length - 1) {
      headerBuf.push(line);
      if (side) addSide(side);
      continue;
    }
    // "Company | City, ST" right under a "Title  dates" line (ApplyFlow's and many templates' layout).
    const companyLine =
      headerBuf.length > 0 &&
      !bullets.length &&
      line.length < 90 &&
      line.split(/\s+/).length <= 9 &&
      !/[.]$/.test(line) &&
      (/\s[|—–·]\s/.test(line) || LOCATION_AT_END.test(line) || (headerBuf.length === 1 && DATE_RANGE_RE.test(headerBuf[0]!) && line.split(/\s+/).length <= 6 && isBullet(lines[i + 1]?.trim() ?? '')));
    const looksLikeHeader = dated || companyLine || (line.length < 100 && !/[.]$/.test(line) && (TITLE_WORDS.test(line) || nextHasDate(lines, i)));
    if (looksLikeHeader) {
      // A second dated header with no bullets in between is the next role (or a promotion), not more of this header.
      const headerHasDate = headerBuf.some((h) => DATE_RANGE_RE.test(h));
      if (bullets.length || techs.length || (headerHasDate && (dated || nextHasDate(lines, i)))) flush();
      headerBuf.push(line);
      if (side) addSide(side);
      continue;
    }
    if (side) addSide(side);
    // Long prose line directly under a header → treat as a bullet (some resumes use paragraphs).
    if (headerBuf.length) bullets.push(line);
    else if (entries.length) entries[entries.length - 1]!.bullets.push(line);
    else headerBuf.push(line);
  }
  flush();
  return entries.filter((e) => e.title || e.company || e.bullets.length);
}

function nextHasDate(lines: string[], i: number): boolean {
  for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
    const l = lines[j]!.trim();
    if (!l) continue;
    if (isBullet(l)) return false;
    if (DATE_RANGE_RE.test(l)) return true;
  }
  return false;
}

function buildEntry(headerLines: string[], bullets: string[]): ExperienceEntry {
  let startDate = '';
  let endDate = '';
  const segments: string[] = [];
  for (const h of headerLines) {
    let line = h;
    const m = line.match(DATE_RANGE_RE);
    if (m && !startDate) {
      startDate = normalizeDateToken(m[1]!);
      endDate = normalizeDateToken(m[2]!);
      line = line.replace(m[0], ' ').replace(/[(),|]\s*$/, '');
    }
    segments.push(...splitSegments(line));
  }
  let title = '';
  let company = '';
  let location = '';
  const rest: string[] = [];
  for (const seg of segments) {
    const s = seg.replace(/^[(,]|[),]$/g, '').trim();
    if (!s) continue;
    if (!location && (LOCATION_RE.test(s) && s.match(LOCATION_RE)?.[0].length === s.length)) {
      location = s;
    } else if (!title && TITLE_WORDS.test(s)) {
      title = s;
    } else {
      rest.push(s);
    }
  }
  // "Title, Company" in a single segment
  if (!company && rest.length) company = rest.shift()!;
  if (!title && rest.length) title = rest.shift()!;
  if (title && !company && title.includes(',')) {
    // "Principal Engineer, AI Platform, Northlake Payments": the employer is after the last comma
    // whose remainder has no job-title words.
    const parts = title.split(',');
    for (let k = parts.length - 1; k >= 1; k--) {
      const t = parts.slice(0, k).join(',').trim();
      const c = parts.slice(k).join(',').trim();
      if (TITLE_WORDS.test(t) && c && !TITLE_WORDS.test(c)) {
        title = t;
        company = c;
        break;
      }
    }
  }
  if (!location) {
    const locInRest = rest.find((r) => LOCATION_RE.test(r));
    if (locInRest) location = locInRest.match(LOCATION_RE)![0];
  }
  return { id: localId('exp'), title, company, location, startDate, endDate, bullets: bullets.filter(Boolean) };
}

function normalizeDateToken(t: string): string {
  const s = t.trim();
  if (/^(present|current|now|today)$/i.test(s)) return 'Present';
  const m = s.match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  if (m) return `${m[1]!.slice(0, 1).toUpperCase()}${m[1]!.slice(1, 3).toLowerCase()} ${m[2]}`;
  return s;
}

/** "Bachelor's degree / Computer Science" → "Bachelor's degree in Computer Science". */
function normalizeDegree(d: string): string {
  const m = d.match(/^(.*\b(?:degree|bachelor'?s?|master'?s?|b\.?s\.?c?|m\.?s\.?c?|b\.?a\.?|m\.?a\.?|ph\.?d\.?|associate'?s?|diploma|mba))\s*[/|]\s*(.+)$/i);
  return m ? `${m[1]!.trim()} in ${m[2]!.trim()}` : d;
}

function parseEducation(lines: string[]): EducationEntry[] {
  const out: EducationEntry[] = [];
  let cur: EducationEntry | null = null;
  for (const raw of lines) {
    const { side, main } = splitSideColumn(raw.trim());
    const line = main.trim();
    if (!line) {
      cur = null;
      continue;
    }
    const text = stripBullet(line);
    const isNew = DEGREE_WORDS.test(text) || SCHOOL_WORDS.test(text);
    if (!cur || (isNew && cur.degree && cur.institution && !isBullet(line))) {
      cur = { id: localId('edu'), degree: '', institution: '', date: '', details: [] };
      out.push(cur);
    }
    if (side && !cur.location) cur.location = side;
    const range = text.match(DATE_RANGE_RE);
    const year = range ? null : text.match(/\b(19|20)\d{2}\b(?:\s*[-–]\s*\b(19|20)\d{2}\b)?/);
    const dateText = range?.[0] ?? year?.[0];
    if (dateText && !cur.date) cur.date = range ? `${normalizeDateToken(range[1]!)} – ${normalizeDateToken(range[2]!)}` : dateText;
    const cleaned = text.replace(dateText ?? '\u0000', '').replace(/^[|,–—-]\s*|[|,–—-]\s*$/g, '').trim();
    const parts = cleaned.split(/\s+\|\s+|\s+[—–]\s+|\s{2,}|,\s+(?=[A-Z][a-z]+ (?:University|College|Institute))/).map((p) => p.trim()).filter(Boolean);
    for (const p of parts) {
      if (!cur.degree && DEGREE_WORDS.test(p)) cur.degree = normalizeDegree(p);
      else if (!cur.institution && SCHOOL_WORDS.test(p)) cur.institution = p;
      else if (!cur.location && isLocationish(p)) cur.location = p;
      else if (p) cur.details.push(p);
    }
  }
  return out.filter((e) => e.degree || e.institution);
}

function parseProjects(lines: string[]): ProjectEntry[] {
  const out: ProjectEntry[] = [];
  let cur: ProjectEntry | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!isBullet(line) && (line.length < 90 || !cur)) {
      const [name, ...desc] = line.split(/\s+[—–|-]\s+|:\s+/);
      cur = { id: localId('proj'), name: (name ?? line).trim(), description: desc.join(' — ').trim(), bullets: [] };
      out.push(cur);
    } else if (cur) {
      cur.bullets.push(stripBullet(line));
    }
  }
  return out;
}

/** Re-render a parsed resume as plain text — used for previews and the "original" side of comparisons. */
export function parsedToText(p: ParsedResume): string {
  const out: string[] = [];
  if (p.contact.fullName) out.push(p.contact.fullName);
  if (p.headline) out.push(p.headline);
  const contactLine = [p.contact.location, p.contact.email, p.contact.phone, ...p.contact.links].filter(Boolean).join(' | ');
  if (contactLine) out.push(contactLine);
  if (p.summary) out.push('', 'SUMMARY', p.summary);
  if (p.skills.length) out.push('', 'SKILLS', p.skills.join(', '));
  if (p.experience.length) {
    out.push('', 'EXPERIENCE');
    for (const e of p.experience) {
      out.push(`${e.title}${e.company ? ` | ${e.company}` : ''}${e.location ? ` | ${e.location}` : ''}${e.startDate ? ` | ${e.startDate} – ${e.endDate}` : ''}`);
      for (const b of e.bullets) out.push(`• ${b}`);
    }
  }
  if (p.projects.length) {
    out.push('', 'PROJECTS');
    for (const pr of p.projects) {
      out.push(pr.description ? `${pr.name} — ${pr.description}` : pr.name);
      for (const b of pr.bullets) out.push(`• ${b}`);
    }
  }
  if (p.education.length) {
    out.push('', 'EDUCATION');
    for (const e of p.education) out.push([e.degree, e.institution, e.date].filter(Boolean).join(' | '));
  }
  if (p.certifications.length) out.push('', 'CERTIFICATIONS', ...p.certifications.map((c) => `• ${c}`));
  if (p.publications.length) out.push('', 'PUBLICATIONS', ...p.publications.map((c) => `• ${c}`));
  if (p.languages.length) out.push('', 'LANGUAGES', p.languages.join(', '));
  return out.join('\n');
}

function coveredYears(entries: ExperienceEntry[]): number {
  const now = new Date();
  const toMonths = (d: string): number | null => {
    if (/present|current|now/i.test(d)) return now.getFullYear() * 12 + now.getMonth();
    const mm = d.match(/^(\d{1,2})[/.](\d{4})$/);
    if (mm) return Number(mm[2]) * 12 + Number(mm[1]) - 1;
    const y = d.match(/(\d{4})/);
    if (!y) return null;
    const mon = d.slice(0, 3).toLowerCase();
    const idx = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(mon);
    return Number(y[1]) * 12 + Math.max(0, idx);
  };
  const spans = entries.map((e) => [toMonths(e.startDate), toMonths(e.endDate || 'present')] as const).filter((s): s is readonly [number, number] => s[0] !== null && s[1] !== null);
  if (!spans.length) return 0;
  return (Math.max(...spans.map((s) => s[1])) - Math.min(...spans.map((s) => s[0]))) / 12;
}

/** Basic structural sanity check used for the "malformed resume" error. */
export function assessParse(p: ParsedResume): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!p.contact.fullName) problems.push('No name found at the top of the resume.');
  if (!p.contact.email) problems.push('No email address found.');
  if (!p.experience.length) problems.push('No work experience section was recognized.');
  if (!p.skills.length) problems.push('No skills section was recognized.');
  const undated = p.experience.filter((e) => !e.startDate).length;
  if (undated) problems.push(`${undated} role(s) have no recognizable dates.`);
  const glued = p.experience.flatMap((e) => e.bullets).filter((b) => DATE_RANGE_RE.test(b) && TITLE_WORDS.test(b));
  if (glued.length) problems.push(`A job may be merged into the role above it (a bullet contains dates: “${glued[0]!.slice(0, 80)}…”). Re-import the resume, or upload the DOCX version.`);
  const jobInSkills = p.skills.filter((s) => DATE_RANGE_RE.test(s) || s.split(/\s+/).length > 8);
  if (jobInSkills.length) problems.push(`Your Skills list contains what looks like job history (“${jobInSkills[0]!.slice(0, 60)}…”), so a job may be missing. Re-import the resume, or upload the DOCX version.`);
  // "8+ years of experience" in the summary but the jobs found cover far less → jobs were missed.
  const claimed = Number((p.summary.match(/(\d{1,2})\+?\s*(?:years|yrs)/i) ?? [])[1] ?? 0);
  const covered = coveredYears(p.experience);
  if (claimed >= 3 && covered > 0 && covered < claimed - 2) {
    problems.push(`Your summary says ${claimed}+ years, but the jobs ApplyFlow found cover about ${Math.round(covered)} years. Some jobs may be missing — check the Experience list, or re-import the resume.`);
  }
  return { ok: p.experience.length > 0, problems };
}
