
export function normalizeWhitespace(s: string): string {
  return s.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

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

export function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function splitIntoLines(s: string): string[] {
  return s
    .split(/\n|(?<=[.!?])\s+(?=[A-Z])/)
    .map((l) => l.replace(/^[\s•\-*–—·▪●◦]+/, '').trim())
    .filter((l) => l.length > 2);
}

export function extractMetrics(s: string): string[] {
  const num = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?';
  const re = new RegExp(
    `(?:[$€£]\\s?(?:${num})\\s?(?:k|mm|m|bn|b|million|billion|thousand)?\\b)|(?:\\b(?:${num})\\s?(?:%|x\\b|\\+|k\\b|m\\b|b\\b|million\\b|billion\\b|thousand\\b))|(?:\\b(?:\\d{1,3}(?:,\\d{3})+|\\d{2,})(?:\\.\\d+)?\\b)`,
    'gi',
  );
  const out: string[] = [];
  for (const m of s.matchAll(re)) {
    const v = m[0].trim();
    if (/^(19|20)\d{2}$/.test(v)) continue;
    out.push(v);
  }
  return out;
}

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

export function shingles(s: string, n: number): Set<string> {
  const words = normalizeForMatch(s).trim().split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

export function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => (w.length <= 3 && /^(and|of|the|for|in|to|a)$/i.test(w) ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1)));
}
