import { findSkills, canonicalSkill } from '@/services/skills/extract';
import { uniqCaseInsensitive } from '@/utils/text';

export interface DescriptionSections {
  responsibilities: string[];
  requirements: string[];
  preferred: string[];
  benefits: string[];
  other: string[];
}

const SECTION_PATTERNS: { key: keyof Omit<DescriptionSections, 'other'>; re: RegExp }[] = [
  { key: 'preferred', re: /\b(preferred|nice[- ]to[- ]have|bonus|pluses|desired|good to have|plus if|extra credit)\b/i },
  { key: 'benefits', re: /\b(benefits?|perks|what we offer|we offer|compensation|total rewards|why join|why you'?ll love)\b/i },
  { key: 'requirements', re: /\b(requirements?|qualifications?|what you'?ll (?:need|bring)|must[- ]haves?|required|who you are|you have|minimum|basic qualifications|skills (?:and|&) experience|experience required|what we'?re looking for|about you|skills required)\b/i },
  { key: 'responsibilities', re: /\b(responsibilit(?:y|ies)|what you'?ll do|duties|the role|key accountabilities|day[- ]to[- ]day|what you will do|your impact|in this role|role overview|job duties|you will)\b/i },
];

function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.startsWith('•')) return false;
  if (t.length > 70) return false;
  return /:\s*$/.test(t) || (t.split(/\s+/).length <= 6 && !/[.!?]$/.test(t) && /^[A-Z]/.test(t));
}

function sectionFor(heading: string): keyof DescriptionSections | null {
  for (const p of SECTION_PATTERNS) if (p.re.test(heading)) return p.key;
  return null;
}

const RESP_VERB = /^(design|lead|build|develop|own|drive|partner|architect|define|establish|create|implement|manage|mentor|collaborate|deliver|evaluate|guide|oversee|champion|influence|ensure|work|support|provide|maintain|identify|translate|serve|participate|contribute|set|shape|scale)\b/i;
const REQ_HINT = /\b(experience (?:with|in)|proficien|knowledge of|familiarity|years|degree|expertise in|hands-on|strong understanding|ability to|track record)\b/i;

export function splitDescription(text: string): DescriptionSections {
  const out: DescriptionSections = { responsibilities: [], requirements: [], preferred: [], benefits: [], other: [] };
  let current: keyof DescriptionSections | null = null;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (isHeadingLine(line)) {
      const s = sectionFor(line);
      if (s) {
        current = s;
        continue;
      }
    }
    const item = line.replace(/^•\s*/, '').trim();
    if (!item) continue;
    if (current) {
      out[current].push(item);
    } else if (line.startsWith('•')) {
      if (REQ_HINT.test(item)) out.requirements.push(item);
      else if (RESP_VERB.test(item)) out.responsibilities.push(item);
      else out.other.push(item);
    } else {
      out.other.push(item);
    }
  }
  return out;
}

export interface RequirementSignals {
  clearance: string[];
  workAuthorization: string[];
  sponsorship: string[];
  education: string[];
  requiredYears: number | null;
  contractDuration: string | null;
}

const EEO_RE = /equal (?:employment )?opportunity|without regard to|regardless of|protected (?:by|under) (?:federal|state|applicable)?\s*law|protected (?:veteran|characteristic)|reasonable accommodation|e-?verify|affirmative action/i;
const CLEARANCE_RE = /\b(security clearance|secret clearance|top secret|ts\/sci|ts-sci|public trust|clearance (?:is )?required|active clearance|dod clearance|polygraph|clearable)\b/i;
const WORK_AUTH_RE = /\b(authori[sz]ed to work|work authori[sz]ation|u\.?s\.? citizens?(?:hip)?|citizenship|green card|permanent resident|gc holders?|\bead\b|eligible to work|legally (?:able|eligible) to work)\b/i;
const SPONSOR_RE = /\b(sponsor(?:ship)?|visas?|h-?1b|no c2c|c2c|corp[- ]to[- ]corp|w-?2 only|third[- ]part(?:y|ies)|1099|independent contractors?)\b/i;
const EDU_RE = /\b(bachelor'?s?|master'?s?|ph\.?\s?d|doctorate|degree|b\.s\.|m\.s\.|bs\/ms|mba|computer science or related)\b/i;
const YEARS_RE = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|to|–)\s*\d{1,2}\s*)?(?:\+\s*)?years?/gi;
const DURATION_RE = /\b(?:duration|length|contract(?: length| term)?)\s*[:\-]?\s*(\d{1,2}\s*\+?\s*(?:months?|mos?\.?|weeks?|years?))|\b(\d{1,2}\s*\+?\s*(?:months?|mos?\.?))\s*(?:contract|assignment|engagement|project)\b/i;

export function detectSignals(text: string): RequirementSignals {
  const lines = text
    .split('\n')
    .flatMap((l) => l.replace(/^•\s*/, '').split(/(?<=[.!?])\s+(?=[A-Z])/))
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !EEO_RE.test(l));
  const pick = (re: RegExp) => uniqCaseInsensitive(lines.filter((l) => re.test(l))).slice(0, 5);
  let requiredYears: number | null = null;
  for (const l of lines) {
    if (/\b(company|founded|history|since|serving)\b/i.test(l) && !/experience/i.test(l)) continue;
    for (const m of l.matchAll(YEARS_RE)) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 30 && /experience|exp\b|background|working/i.test(l)) requiredYears = Math.max(requiredYears ?? 0, n);
    }
  }
  const dm = text.match(DURATION_RE);
  return {
    clearance: pick(CLEARANCE_RE),
    workAuthorization: pick(WORK_AUTH_RE),
    sponsorship: pick(SPONSOR_RE),
    education: pick(EDU_RE),
    requiredYears,
    contractDuration: dm ? (dm[1] ?? dm[2] ?? '').trim() || null : null,
  };
}

export function classifyJobSkills(sections: DescriptionSections, fullText: string, platformSkills: string[]): { required: string[]; preferred: string[] } {
  const reqText = [...sections.requirements, ...sections.responsibilities].join('\n');
  const prefText = sections.preferred.join('\n');
  const tagged = platformSkills.map(canonicalSkill);
  let required = uniqCaseInsensitive([...tagged, ...findSkills(reqText)]);
  let preferred = findSkills(prefText).filter((s) => !required.some((r) => r.toLowerCase() === s.toLowerCase()));
  if (!required.length && !preferred.length) required = findSkills(fullText);
  else {
    const elsewhere = findSkills(fullText).filter((s) => !required.includes(s) && !preferred.includes(s));
    preferred = [...preferred, ...elsewhere];
  }
  return { required: required.slice(0, 30), preferred: uniqCaseInsensitive(preferred).slice(0, 20) };
}

export function detectRemoteStatus(text: string): 'remote' | 'hybrid' | 'onsite' | 'unknown' {
  if (/\bhybrid\b/i.test(text)) return 'hybrid';
  if (/\b(on[- ]?site|in[- ]office|onsite)\b/i.test(text)) return 'onsite';
  if (/\b(remote|work from home|wfh|telecommute)\b/i.test(text)) return 'remote';
  return 'unknown';
}
