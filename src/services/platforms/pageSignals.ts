import { DICE_SELECTORS } from './dice/selectors';
import { cleanText, deepQueryAll, firstMatch } from './dom';

/** Cheap company name for page-state identity checks (no full job extract). */
export function peekPageCompany(doc: Document): string | null {
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const raw = JSON.parse(s.textContent ?? '');
      const items: unknown[] = Array.isArray(raw) ? raw : raw?.['@graph'] ?? [raw];
      for (const it of items) {
        const o = it as Record<string, unknown>;
        const type = o['@type'];
        if (!(type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting')))) continue;
        const org = o.hiringOrganization as { name?: string } | string | undefined;
        const name = typeof org === 'string' ? org : org?.name;
        if (name?.trim()) return name.trim();
      }
    } catch {
      /* ignore bad JSON-LD */
    }
  }

  const dice = firstMatch(doc, DICE_SELECTORS.company as unknown as string[]);
  if (dice) {
    const t = cleanText(dice.el);
    if (t) return t;
  }

  for (const el of deepQueryAll<HTMLElement>(doc, 'h2, h3, [class*="company" i]', 40)) {
    const t = (el.innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const m = t.match(/^(.{2,80}?)\s*[·•]\s*\d+\s+\w+\s+ago$/i);
    if (m?.[1]?.trim()) return m[1]!.trim();
  }

  const meta =
    doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() ||
    doc.querySelector('meta[name="author"]')?.getAttribute('content')?.trim() ||
    null;
  return meta || null;
}
