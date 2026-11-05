export interface ResearchedCompany {
  periodIndex: number;
  name: string;
  activeYears: string;
  techFit: string;
  hq: string;
  /** JD-aligned draft title for this employment period (ApplyFlow supplies it to CV Generate). */
  roleTitle: string;
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
      name: str,
      activeYears: str,
      techFit: str,
      hq: str,
    }),
  },
});

export const COMPANY_RESEARCH_SYSTEM = `You identify real companies that match a job description. Reply with one JSON object only, in this shape: {"companies":[{"name":"","activeYears":"","techFit":"","hq":""}]}.

Rules:
- Use only the job title, organization, description, responsibilities, and technology keywords provided.
- Return exactly four distinct companies whose products, services, or technical work are relevant to that job.
- List companies in career order: index 0 = most recent plausible employer for this JD, index 3 = earliest. ApplyFlow maps them to the candidate's employment periods in that order.
- Each company must be real and publicly documented (press, careers page, Crunchbase, SEC, or Wikipedia). Use the official legal name.
- Prefer lesser-known, mid-size, or niche firms. Avoid household mega-brands and ultra-famous names (e.g. Microsoft, Google, Amazon, Meta, Apple, Netflix, Uber, Airbnb, OpenAI, Anthropic, NVIDIA, Salesforce, Oracle, IBM, Adobe, Cisco, Intel, Databricks, Snowflake, Confluent, Stripe, Palantir, LinkedIn, Twitter/X, Spotify, Tesla, Samsung, Sony, Dell, HP, Accenture, Deloitte, McKinsey).
- Do not return the organization named in the job, and do not repeat a name.
- hq is the company's primary global headquarters city (City, ST for US; City, Country otherwise) from public sources. Never invent an HQ; use "" only if it is unknown. No street address.
- techFit is one short clause under 20 words describing the public match to the job. activeYears is a short public operating range.
- Do not invent private projects, metrics, customers, or internal facts. Do not suggest job titles; ApplyFlow handles titles separately.
- If a match is uncertain, still choose the closest documented public company and note that briefly in techFit.`;

export function researchJobPayload(job: Record<string, unknown>, tech: string[]): Record<string, unknown> {
  const title = typeof job.title === 'string' ? job.title : '';
  const company = typeof job.company === 'string' ? job.company : '';
  const location = typeof job.location === 'string' ? job.location.trim() : '';
  const description = typeof job.description === 'string' ? job.description.trim() : '';
  const required = Array.isArray(job.required) ? job.required : Array.isArray(job.requiredSkills) ? job.requiredSkills : [];
  const preferred = Array.isArray(job.preferred) ? job.preferred : Array.isArray(job.preferredSkills) ? job.preferredSkills : [];
  const responsibilities = Array.isArray(job.responsibilities) ? job.responsibilities : [];
  const qualifications = Array.isArray(job.qualifications) ? job.qualifications : [];
  const tools = uniqStrings([...tech, ...asStrings(required), ...asStrings(preferred)]).slice(0, 28);
  const duties = uniqStrings([...asStrings(responsibilities), ...asStrings(qualifications)]).slice(0, 24);
  const payload: Record<string, unknown> = { title, organization: company, tech: tools };
  if (location) payload.location = location;
  if (description) payload.description = description.slice(0, 8000);
  if (duties.length) payload.responsibilities = duties;
  return payload;
}

export function companyResearchUser(job: Record<string, unknown>, tech: string[]): string {
  return JSON.stringify({
    task: 'company_research',
    job: researchJobPayload(job, tech),
  });
}

export function validateCompanyResearch(value: unknown): asserts value is CompanyResearchReply {
  const v = value as CompanyResearchReply;
  if (!v || typeof v !== 'object' || !Array.isArray(v.companies)) throw new Error('Claude returned invalid company research JSON.');
  const cleaned: ResearchedCompany[] = [];
  const seen = new Set<string>();
  for (const raw of v.companies) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as unknown as Record<string, unknown>;
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const activeYears = typeof c.activeYears === 'string' ? c.activeYears.trim() : typeof c.activeYears === 'number' ? String(c.activeYears) : '';
    const techFit = typeof c.techFit === 'string' ? c.techFit.trim() : '';
    const hq = typeof c.hq === 'string' ? c.hq.trim() : '';
    cleaned.push({ periodIndex: cleaned.length, name, activeYears: activeYears || 'unknown', techFit: techFit || 'relevant to the role', hq, roleTitle: '' });
    if (cleaned.length >= 8) break;
  }
  if (cleaned.length === 0) throw new Error('Claude returned no usable company research entries.');
  v.companies = cleaned;
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
