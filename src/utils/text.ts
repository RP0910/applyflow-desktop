/** Text helpers shared by extraction, matching, tailoring and validation. Pure functions only. */

export function normalizeWhitespace(s: string): string {
  return s.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Lowercase, strip punctuation except characters that matter in tech names (+ # . /). */
export function normalizeForMatch(s: string): string {
  return ` ${s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9+#./\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

export function wordCount(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const STOP = new Set(
  'a an and are as at be by for from has have in is it its of on or our that the this to with will you your we they their who what when where which while within without into over under per via using use including include etc senior junior lead principal staff sr jr ii iii iv i'.split(' '),
);

export function tokens(s: string): string[] {
  return normalizeForMatch(s)
    .split(' ')
    .map((t) => t.replace(/^[./-]+|[./-]+$/g, ''))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/** Case-insensitive de-duplication that keeps the first spelling seen. */
export function uniqCaseInsensitive(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    const k = item.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item.trim());
  }
  return out;
}

/** Jaccard similarity of token sets, 0..1. */
export function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Split text into sentences/bullets for evidence snippets. */
export function splitIntoLines(s: string): string[] {
  return s
    .split(/\n|(?<=[.!?])\s+(?=[A-Z])/)
    .map((l) => l.replace(/^[\s•\-*–—·▪●◦]+/, '').trim())
    .filter((l) => l.length > 2);
}

/** Pull numeric claims (metrics) out of text: 35%, $2M, 1.2B, 40+, 10x, 3,000. */
export function extractMetrics(s: string): string[] {
  // Thousands separators are matched whole ("9,000", not "000") so different numbers never collide.
  const num = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?';
  const re = new RegExp(
    `(?:[$€£]\\s?(?:${num})\\s?(?:k|mm|m|bn|b|million|billion|thousand)?\\b)|(?:\\b(?:${num})\\s?(?:%|x\\b|\\+|k\\b|m\\b|b\\b|million\\b|billion\\b|thousand\\b))|(?:\\b(?:\\d{1,3}(?:,\\d{3})+|\\d{2,})(?:\\.\\d+)?\\b)`,
    'gi',
  );
  const out: string[] = [];
  for (const m of s.matchAll(re)) {
    const v = m[0].trim();
    // Ignore years (1990–2039) – dates are validated separately.
    if (/^(19|20)\d{2}$/.test(v)) continue;
    out.push(v);
  }
  return out;
}

/** Canonical numeric form for metric comparison: "$2.5M" → "2.5m", "35 %" → "35%". */
export function canonicalMetric(m: string): string {
  return m
    .toLowerCase()
    .replace(/[$€£,\s]/g, '')
    .replace(/million|mm/g, 'm')
    .replace(/billion|bn/g, 'b')
    .replace(/thousand/g, 'k');
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** n-word shingles used to detect copied job-description text. */
export function shingles(s: string, n: number): Set<string> {
  const words = normalizeForMatch(s).trim().split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

export function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => (w.length <= 3 && /^(and|of|the|for|in|to|a)$/i.test(w) ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1)));
}
