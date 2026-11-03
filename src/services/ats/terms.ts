/**
 * Literal keyword matching the way keyword-based ATS filters do it: whole words, an optional
 * plural, and short acronyms matched case-sensitively ("Go" the language, not "go").
 */
import { escapeRegExp } from '@/utils/text';
import { SYNONYM_GROUPS } from '@/services/skills/taxonomy';

const cache = new Map<string, RegExp>();

/** Short forms with capitals (SRT, Go, iOS, QoE) are matched case-sensitively. */
function caseSensitive(form: string): boolean {
  return form.length <= 4 && /[A-Z]/.test(form) && !/^[A-Z][a-z]{3}$/.test(form);
}

export function termRegex(form: string): RegExp {
  const key = form;
  let re = cache.get(key);
  if (re) return re;
  const f = form.trim();
  // "Low-Latency HLS" also matches "Low Latency HLS" and the reverse.
  const body = escapeRegExp(f).replace(/\s*-\s*|\s+/g, '[\\s\\-]+');
  const plural = /[A-Za-z]$/.test(f) && f.length >= 3 && !/s$/i.test(f) ? '(?:s|es)?' : '';
  const tail = f.length <= 2 ? '(?![A-Za-z0-9\\-’\'])' : '(?![A-Za-z0-9])';
  re = new RegExp(`(?<![A-Za-z0-9])${body}${plural}${tail}`, caseSensitive(f) ? 'g' : 'gi');
  cache.set(key, re);
  return re;
}

export function countForm(text: string, form: string): number {
  if (!form.trim() || !text) return 0;
  const re = termRegex(form);
  re.lastIndex = 0;
  return text.match(re)?.length ?? 0;
}

export function hasForm(text: string, form: string): boolean {
  return countForm(text, form) > 0;
}

/** Lowercased, punctuation-light key used to merge spellings ("Node.js" = "NodeJS"). */
export function termKey(s: string): string {
  return s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9+#]+/g, '');
}

const SYN_INDEX = new Map<string, string[]>();
for (const g of SYNONYM_GROUPS) for (const t of g) SYN_INDEX.set(termKey(t), g);

/** True synonyms of a term (never umbrella members). */
export function synonymsOf(term: string): string[] {
  return SYN_INDEX.get(termKey(term)) ?? [];
}

export function sameKeyword(a: string, b: string): boolean {
  if (termKey(a) === termKey(b)) return true;
  const g = SYN_INDEX.get(termKey(a));
  return Boolean(g && g.some((x) => termKey(x) === termKey(b)));
}

/** "Amazon Web Services (AWS)" / "AWS (Amazon Web Services)" pairs written in a text. */
export function acronymPairs(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of text.matchAll(/((?:[A-Z][\w-]*[\s-]+){1,5}[A-Z][\w-]*)\s*\(([A-Z][A-Za-z0-9&/-]{1,9})\)/g)) {
    const long = m[1]!.trim();
    const short = m[2]!;
    // The acronym's letters should come from the long form's words.
    const initials = long.split(/[\s-]+/).map((w) => w[0]!.toUpperCase()).join('');
    if (initials.includes(short.replace(/[^A-Z]/g, '').slice(0, 2))) out.push([long, short]);
  }
  for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9&/-]{1,9})\s*\(((?:[A-Z][\w-]*[\s-]+){1,5}[A-Z][\w-]*)\)/g)) {
    out.push([m[2]!.trim(), m[1]!]);
  }
  return out;
}

/** Soft skills match any word form: "collaborate" also finds "collaborated", "collaborating". */
export function hasStem(text: string, alias: string): boolean {
  const stem = alias.trim().replace(/(?:e|ing|ed|s)$/i, '');
  if (stem.length < 4) return hasForm(text, alias);
  return new RegExp(`(?<![A-Za-z])${escapeRegExp(stem).replace(/\s+/g, '[\\s-]+')}[a-z]*`, 'i').test(text);
}
