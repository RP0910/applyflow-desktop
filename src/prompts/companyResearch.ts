import type { CompactFacts } from './application';

export interface ResearchedCompany {
  periodIndex: number;
  name: string;
  activeYears: string;
  techFit: string;
  hq: string;
}

export interface CompanyResearchReply {
  companies: ResearchedCompany[];
}

const str = { type: 'string' };
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

export const COMPANY_RESEARCH_SCHEMA = object({
  companies: {
    type: 'array',
    items: object({
      periodIndex: { type: 'number' },
      name: str,
      activeYears: str,
      techFit: str,
      hq: str,
    }),
  },
});

export const COMPANY_RESEARCH_SYSTEM = `You research real employers for a resume draft. Reply with JSON only matching the schema.

Rules:
- Use only the employment periods and technology keywords provided.
- Return exactly one company object per periods[].index. Set periodIndex to that same index (0-based).
- Suggest a real company that existed and was active in that period and used or built technologies relevant to the job.
- Prefer lesser-known, mid-size, or niche firms that are still real and publicly documented (press, careers page, Crunchbase, SEC, Wikipedia). Official legal names only.
- Avoid household mega-brands and ultra-famous tech names (e.g. Microsoft, Google, Amazon, Meta, Apple, Netflix, Uber, Airbnb, OpenAI, Anthropic, NVIDIA, Salesforce, Oracle, IBM, Adobe, Cisco, Intel, Databricks, Snowflake, Confluent, Stripe, Palantir, LinkedIn, Twitter/X, Spotify, Tesla, Samsung, Sony, Dell, HP, Accenture, Deloitte, McKinsey). Prefer credible alternatives in the same domain.
- Choose four distinct companies; do not repeat a name across periods.
- hq must be the company's primary global headquarters city (City, ST for US; City, Country otherwise) from known public sources — not a regional office and never a period city field. Never invent an HQ; use "" only if truly unknown.
- Keep techFit to one short clause (under 20 words). Keep activeYears short. Keep hq compact (no street address).
- Never invent private project details, metrics, or that the candidate worked there.
- Never write resume bullets, summaries, titles, or cover letters.
- If unsure of a company for a period, still pick the most plausible lesser-known public company and note uncertainty briefly in techFit.`;

export function researchJobPayload(job: Record<string, unknown>, tech: string[]): Record<string, unknown> {
  const title = typeof job.title === 'string' ? job.title : '';
  const company = typeof job.company === 'string' ? job.company : '';
  const required = Array.isArray(job.required) ? job.required : Array.isArray(job.requiredSkills) ? job.requiredSkills : [];
  const preferred = Array.isArray(job.preferred) ? job.preferred : Array.isArray(job.preferredSkills) ? job.preferredSkills : [];
  const tools = uniqStrings([...tech, ...asStrings(required), ...asStrings(preferred)]).slice(0, 28);
  return { title, hiringCompany: company, tech: tools };
}

export function researchPeriods(facts: CompactFacts): { index: number; company: string; title: string; start: string; end: string }[] {
  try {
    const parsed = JSON.parse(facts.text) as { jobs?: { company?: string; title?: string; start?: string; end?: string }[] };
    return (parsed.jobs ?? []).map((j, index) => ({
      index,
      company: String(j.company ?? ''),
      title: String(j.title ?? ''),
      start: String(j.start ?? ''),
      end: String(j.end ?? ''),
    }));
  } catch {
    return [];
  }
}

export function companyResearchUser(job: Record<string, unknown>, facts: CompactFacts, tech: string[]): string {
  return JSON.stringify({
    task: 'company_research',
    job: researchJobPayload(job, tech),
    periods: researchPeriods(facts),
  });
}

export function validateCompanyResearch(value: unknown, periodCount: number): asserts value is CompanyResearchReply {
  const v = value as CompanyResearchReply;
  if (!v || typeof v !== 'object' || !Array.isArray(v.companies)) throw new Error('Claude returned invalid company research JSON.');
  const cleaned: ResearchedCompany[] = [];
  for (const raw of v.companies) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as unknown as Record<string, unknown>;
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    const activeYears = typeof c.activeYears === 'string' ? c.activeYears.trim() : typeof c.activeYears === 'number' ? String(c.activeYears) : '';
    const techFit = typeof c.techFit === 'string' ? c.techFit.trim() : '';
    const hq = typeof c.hq === 'string' ? c.hq.trim() : '';
    const periodIndex = typeof c.periodIndex === 'number' && Number.isFinite(c.periodIndex)
      ? Math.trunc(c.periodIndex)
      : typeof c.periodIndex === 'string' && c.periodIndex.trim() !== '' && Number.isFinite(Number(c.periodIndex))
        ? Math.trunc(Number(c.periodIndex))
        : NaN;
    if (!name || !Number.isFinite(periodIndex) || periodIndex < 0) continue;
    if (periodCount > 0 && periodIndex >= periodCount) continue;
    cleaned.push({ periodIndex, name, activeYears: activeYears || 'unknown', techFit: techFit || 'relevant tech', hq });
  }
  if (periodCount > 0 && cleaned.length === 0) throw new Error('Claude returned no usable company research entries.');
  const byPeriod = new Map<number, ResearchedCompany>();
  for (const c of cleaned) if (!byPeriod.has(c.periodIndex)) byPeriod.set(c.periodIndex, c);
  v.companies = Array.from(byPeriod.values()).sort((a, b) => a.periodIndex - b.periodIndex);
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
}

function uniqStrings(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x.trim());
  }
  return out;
}
