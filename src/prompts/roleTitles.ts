export interface RoleTitleEntry {
  periodIndex: number;
  role_title: string;
}

export interface RoleTitlesReply {
  roles: RoleTitleEntry[];
}

const str = { type: 'string' };
const num = { type: 'integer' };
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

export const ROLE_TITLES_SCHEMA = object({
  roles: {
    type: 'array',
    items: object({ periodIndex: num, role_title: str }),
  },
});

export const ROLE_TITLES_SYSTEM = `You suggest standard US job titles for a tailored resume draft. Reply with one JSON object only: {"roles":[{"periodIndex":0,"role_title":""}]}.

Rules:
- Use only the target job description in the user message. No employer names, company research, résumé, or candidate history is provided.
- Return exactly one role_title per employment periodIndex (0 = most recent). Do not add or remove periods.
- Derive titles from the posting's responsibilities, technical skills, keywords, and seniority. Index 0 should be closest to the posting title; each later index should step down one plausible seniority level in the same technical family.
- role_title is under 10 words, no company name, no dates, no emojis.
- Output plausible ATS-friendly titles that match the job; ApplyFlow maps them to employers separately.`;

export function roleTitlesUser(job: Record<string, unknown>, periodCount: number): string {
  return JSON.stringify({
    task: 'suggest_role_titles',
    periodCount,
    job,
  });
}

export function validateRoleTitlesReply(value: unknown, count: number): asserts value is RoleTitlesReply {
  const v = value as RoleTitlesReply;
  if (!v || typeof v !== 'object' || !Array.isArray(v.roles)) throw new Error('Claude returned invalid role title JSON.');
  if (v.roles.length !== count) throw new Error('Claude returned the wrong number of role titles.');
  const seen = new Set<number>();
  for (const r of v.roles) {
    if (!r || typeof r !== 'object') throw new Error('Invalid role title entry.');
    if (typeof r.periodIndex !== 'number' || r.periodIndex < 0 || r.periodIndex >= count) throw new Error('Invalid periodIndex in role titles.');
    if (seen.has(r.periodIndex)) throw new Error('Duplicate periodIndex in role titles.');
    seen.add(r.periodIndex);
    if (typeof r.role_title !== 'string' || !r.role_title.trim()) throw new Error('Empty role_title in Claude JSON.');
  }
}
