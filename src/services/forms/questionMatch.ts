/**
 * Conventional (non-AI) screening-question matching: normalize wording, expand synonyms,
 * score overlap, and map saved answers onto live form options.
 */
import type { ApprovedAnswer, FormFieldDescriptor, ScreeningControl } from '@/types';
import { similarity, tokens } from '@/utils/text';
import { SCREENING_CATALOG } from './screeningCatalog';

/** Phrase groups that mean the same thing across employer forms. First entry is canonical. */
const SYNONYM_GROUPS: string[][] = [
  ['hear about', 'learn about', 'find out about', 'find about', 'come across', 'know about'],
  ['this job', 'this role', 'this position', 'this opportunity', 'this opening', 'us'],
  ['visa sponsorship', 'sponsorship for employment', 'immigration sponsorship', 'require sponsorship', 'need sponsorship', 'h-1b sponsorship', 'employment visa status'],
  ['authorized to work', 'legally authorized', 'eligible to work', 'right to work', 'work authorization', 'legally eligible', 'legally permitted'],
  ['united states', 'u.s.', 'u.s.a.', 'usa', 'us'],
  ['relocate', 'relocation', 'willing to move', 'open to relocation'],
  ['on-site', 'onsite', 'in office', 'in-office', 'work on site'],
  ['salary expectations', 'expected salary', 'desired salary', 'desired compensation', 'compensation expectations', 'pay expectation', 'desired pay'],
  ['start date', 'available to start', 'earliest start', 'when can you start', 'notice period'],
  ['years of experience', 'years experience', 'how many years', 'yrs of experience', 'years of professional experience'],
  ['previously employed', 'former employee', 'worked for this company', 'previously worked', 'ever been employed'],
  ['security clearance', 'clearance level', 'active clearance'],
  ['criminal', 'convicted', 'conviction', 'felony', 'background check'],
  ['veteran status', 'protected veteran', 'military service', 'armed forces'],
  ['disability', 'disability status', 'reasonable accommodation'],
  ['gender', 'gender identity', 'sex'],
  ['race', 'ethnicity', 'racial ethnic', 'racial/ethnic'],
  ['how did you', 'where did you', 'how do you'],
  ['referred by', 'referral name', 'who referred'],
];

const STOP = new Set([
  'the', 'you', 'your', 'are', 'for', 'and', 'this', 'that', 'with', 'have', 'any', 'please', 'will', 'can',
  'what', 'our', 'job', 'position', 'role', 'company', 'a', 'an', 'of', 'to', 'in', 'on', 'or', 'is', 'do',
  'does', 'did', 'be', 'been', 'being', 'at', 'by', 'from', 'as', 'if', 'we', 'they', 'their', 'about',
]);

/** Collapse synonym phrases to a shared token, then light stem. */
export function canonicalizeQuestion(text: string): string {
  let s = ` ${text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9+#./\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
  for (const group of SYNONYM_GROUPS) {
    const canon = group[0]!.replace(/\s+/g, '_');
    for (const phrase of group) {
      const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'gi');
      s = s.replace(re, ` ${canon} `);
    }
  }
  return s.replace(/\s+/g, ' ').trim();
}

function lightStem(w: string): string {
  if (w.includes('_') || w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 5) return `${w.slice(0, -3)}y`;
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && w.length > 4 && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Keywords used for screening-question overlap (canonicalized). */
export function questionWords(text: string): string[] {
  return Array.from(
    new Set(
      canonicalizeQuestion(text)
        .split(/\s+/)
        .map(lightStem)
        .filter((w) => w.length > 2 && !STOP.has(w)),
    ),
  );
}

/** Jaccard on canonical tokens, plus token overlap ratio. */
export function questionSimilarity(a: string, b: string): number {
  const wa = questionWords(a);
  const wb = questionWords(b);
  if (!wa.length || !wb.length) return 0;
  const sa = new Set(wa);
  const sb = new Set(wb);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const jaccard = inter / (sa.size + sb.size - inter);
  const overlap = inter / Math.max(sa.size, sb.size);
  const raw = similarity(canonicalizeQuestion(a), canonicalizeQuestion(b));
  return Math.max(jaccard, overlap * 0.95, raw);
}

/** Best score of a live field label/context against a saved pattern + aliases (+ catalog aliases). */
export function scoreAgainstPatterns(fieldText: string, patterns: string[]): number {
  const text = fieldText.trim();
  if (!text) return 0;
  const fieldWords = questionWords(text);
  let best = 0;
  for (const pattern of patterns) {
    const p = pattern.trim();
    if (!p) continue;
    const words = questionWords(p);
    if (!words.length) {
      best = Math.max(best, 0.78);
      continue;
    }
    const hay = canonicalizeQuestion(text);
    const all = words.every((w) => hay.includes(w) || fieldWords.includes(w));
    const overlap = fieldWords.length ? words.filter((w) => fieldWords.includes(w)).length / Math.max(words.length, fieldWords.length) : 0;
    const sim = questionSimilarity(p, text);
    best = Math.max(best, all ? 1 : Math.max(overlap, sim));
  }
  return best;
}

export function patternsForAnswer(a: ApprovedAnswer): string[] {
  const out = [a.questionPattern, ...(a.aliases ?? [])];
  if (a.catalogId) {
    const cat = SCREENING_CATALOG.find((q) => q.id === a.catalogId);
    if (cat) out.push(cat.prompt, ...cat.aliases);
  }
  return out.filter((s) => s.trim());
}

export function matchOption(options: string[], value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const exact = options.find((o) => o.trim().toLowerCase() === v);
  if (exact) return exact;
  const contains = options.find((o) => {
    const oL = o.toLowerCase();
    return oL.includes(v) || v.includes(oL);
  });
  if (contains) return contains;
  // Soft match: prefer options that contain the saved answer's keywords
  // ("Not a Veteran" → "I am not a protected veteran").
  let best: { o: string; score: number } | null = null;
  const vt = new Set(tokens(value));
  for (const o of options) {
    const ot = new Set(tokens(o));
    if (!ot.size || !vt.size) continue;
    let inter = 0;
    for (const t of vt) if (ot.has(t)) inter++;
    const containment = inter / Math.min(vt.size, ot.size);
    const jaccard = inter / (vt.size + ot.size - inter);
    const score = Math.max(containment, jaccard);
    if (score >= 0.55 && (!best || score > best.score)) best = { o, score };
  }
  return best?.o ?? null;
}

const CHOICE: ScreeningControl[] = ['radio', 'select', 'combobox'];

export function answerFitsField(
  a: ApprovedAnswer,
  f: Pick<FormFieldDescriptor, 'options' | 'control'>,
): boolean {
  const choice = f.control === 'radio' || f.control === 'select' || f.control === 'combobox';
  if (!f.options.length || !choice) return true;
  return Boolean(matchOption(f.options, a.answer));
}

/** Minimum score to reuse a saved answer (after synonym expansion). */
export const MATCH_THRESHOLD = 0.42;

export function controlCompatible(saved?: ScreeningControl, live?: FormFieldDescriptor['control']): boolean {
  if (!saved || !live) return true;
  if (saved === live) return true;
  // Dropdown-like controls are interchangeable for matching purposes.
  if (CHOICE.includes(saved) && (live === 'radio' || live === 'select' || live === 'combobox')) return true;
  if ((saved === 'text' || saved === 'textarea') && (live === 'text' || live === 'textarea' || live === 'email' || live === 'tel' || live === 'url' || live === 'number' || live === 'other')) return true;
  if (saved === 'checkbox' && live === 'checkbox') return true;
  return true; // never block solely on control mismatch — options gate is enough
}
