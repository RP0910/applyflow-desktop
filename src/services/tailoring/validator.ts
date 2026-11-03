/**
 * Truthfulness validator. Runs on every tailored resume and cover letter — whether
 * written by Claude, the local engine, or edited by the user — before anything is submitted.
 */
import type { AtsPlan, CareerProfile, JobPosting, MasterResume, SkillEvidence, TailoredResume, ValidationIssue } from '@/types';
import { allowedCorpus, allowedResume } from '@/services/resume/facts';
import { findSkillMentions, findSkills, mentionsSkill } from '@/services/skills/extract';
import { hasForm, sameKeyword, termKey } from '@/services/ats/terms';
import { isBacked } from '@/services/ats/backing';
import { STOP_TOKENS, TECH_TOKEN } from '@/services/ats/keywords';
import { yearsOfExperience } from '@/services/matching/experience';
import { supportedKeywords } from '@/services/matching/evidence';
import { canonicalMetric, extractMetrics, normalizeForMatch, shingles, similarity, truncate, wordCount } from '@/utils/text';
import { newId } from '@/utils/id';
import { employmentGaps } from '@/services/matching/experience';

function issue(severity: ValidationIssue['severity'], code: ValidationIssue['code'], message: string, excerpt?: string, autoFixable = true): ValidationIssue {
  return { id: newId('iss'), severity, code, message, excerpt: excerpt ? truncate(excerpt, 200) : undefined, autoFixable };
}

const norm = (s: string) => normalizeForMatch(s).trim();

export function tailoredText(t: Pick<TailoredResume, 'headline' | 'summary' | 'skills' | 'experience' | 'projects' | 'additional'> & { skillGroups?: TailoredResume['skillGroups'] }): string {
  return [
    t.headline,
    t.summary,
    t.skills.join(', '),
    ...(t.skillGroups ?? []).map((g) => g.skills.join(', ')),
    ...t.experience.flatMap((e) => [...e.bullets, (e.technologies ?? []).join(', ')]),
    ...t.projects.flatMap((p) => [p.name, p.description, ...p.bullets]),
    ...t.additional,
  ].join('\n');
}

/** Metrics present in the master corpus, in canonical form. */
function metricSet(text: string): Set<string> {
  return new Set(extractMetrics(text).map(canonicalMetric));
}

export function findInventedMetrics(text: string, sourceText: string): string[] {
  const allowed = metricSet(sourceText);
  return Array.from(new Set(extractMetrics(text))).filter((m) => !allowed.has(canonicalMetric(m)));
}

export function findUnsupportedSkills(text: string, corpus: string, extraAllowed: string[] = []): string[] {
  return findSkills(text).filter((s) => !isBacked(s, corpus) && !extraAllowed.some((a) => a.toLowerCase() === s.toLowerCase()));
}

/** 8-word sequences copied from the job description (and not already in the user's own resume). */
export function findCopiedJobText(text: string, jobDescription: string, ownText: string): string[] {
  const jd = shingles(jobDescription, 8);
  const own = shingles(ownText, 8);
  const hits: string[] = [];
  for (const sh of shingles(text, 8)) if (jd.has(sh) && !own.has(sh)) hits.push(sh);
  return hits.slice(0, 5);
}

const AI_CLICHES = [
  /\bi am (?:thrilled|excited|delighted) to\b/i,
  /\bpassionate about leveraging\b/i,
  /\bfast-paced environment\b/i,
  /\bdelve\b/i,
  /\btapestry\b/i,
  /\bi am writing to express my (?:keen |strong )?interest\b/i,
  /\bsynerg(?:y|ies|ize)\b/i,
  /\bin today'?s (?:ever-evolving|rapidly changing|dynamic) (?:landscape|world)\b/i,
  /\bunwavering\b/i,
  /\btestament to\b/i,
  /\bseamless(?:ly)? integrat/i,
];

export function findCliches(text: string): string[] {
  return AI_CLICHES.map((re) => text.match(re)?.[0]).filter((m): m is string => Boolean(m));
}

export interface ValidateContext {
  master: MasterResume;
  profile?: CareerProfile;
  job: Pick<JobPosting, 'description'>;
  evidence: SkillEvidence[];
  length: 'one_page' | 'two_pages' | 'flexible';
  /** ATS plan: job keywords the candidate does NOT have are blocked everywhere. */
  plan?: AtsPlan | null;
}

/**
 * Specific technical terms written in a line: product names, acronyms and taxonomy skills as
 * written ("Kubernetes", "LL-HLS", "server-side ad insertion"). Single plain lowercase words
 * ("monitoring", "playback") are wording, not claims, and are left to the other checks.
 */
export function techTerms(line: string): { term: string; canonical: string | null }[] {
  const out: { term: string; canonical: string | null }[] = [];
  for (const m of findSkillMentions(line)) {
    for (const surface of m.surfaces.keys()) {
      if (surface !== surface.toLowerCase() || /[\d+#./]/.test(surface) || /[\s-]/.test(surface.trim())) out.push({ term: surface, canonical: m.name });
    }
  }
  for (const m of line.matchAll(TECH_TOKEN)) {
    const tok = m[1]!;
    if (STOP_TOKENS.has(tok) || tok.length < 2) continue;
    if (!out.some((o) => o.term.toLowerCase().includes(tok.toLowerCase()))) out.push({ term: tok, canonical: null });
  }
  return out.filter((o, i) => out.findIndex((x) => x.term.toLowerCase() === o.term.toLowerCase()) === i);
}

/** "Picture-in-Picture (PiP)": an acronym spelled out right next to it is wording, not a new claim. */
function explainedAcronym(term: string, line: string): boolean {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = line.match(new RegExp(`((?:[A-Za-z][\\w]*[\\s-]+){1,5}[A-Za-z][\\w]*)\\s*\\(${esc}\\)`)) ?? line.match(new RegExp(`${esc}\\s*\\(((?:[A-Za-z][\\w]*[\\s-]+){1,5}[A-Za-z][\\w]*)\\)`));
  if (!m) return false;
  const initials = m[1]!.split(/[\s-]+/).map((w) => w[0]!.toLowerCase()).join('');
  const letters = term.replace(/[^A-Za-z]/g, '').toLowerCase();
  return letters.length >= 2 && (initials.endsWith(letters) || initials.includes(letters));
}

/** Is the term backed by this text? The same rule the ATS plan uses (see services/ats/backing.ts). */
export function grounded(term: string, _canonical: string | null, text: string, extraForms: string[] = []): boolean {
  return isBacked(term, text, extraForms);
}

/** Why a tailored bullet for one job isn't backed by that job's own facts (empty = fine). */
export function bulletProblems(
  bullet: string,
  jobText: string,
  corpus: string,
  forbidden: string[][],
  formsOf: (term: string) => string[] = () => [],
): { kind: 'moved' | 'unsupported' | 'forbidden'; term: string }[] {
  const out: { kind: 'moved' | 'unsupported' | 'forbidden'; term: string }[] = [];
  for (const forms of forbidden) if (forms.some((f) => hasForm(bullet, f))) out.push({ kind: 'forbidden', term: forms[0]! });
  for (const { term, canonical } of techTerms(bullet)) {
    if (grounded(term, canonical, jobText, formsOf(term))) continue;
    if (!canonical && explainedAcronym(term, bullet)) continue;
    if (out.some((o) => o.term.toLowerCase() === term.toLowerCase())) continue;
    out.push({ kind: grounded(term, canonical, corpus, formsOf(term)) ? 'moved' : 'unsupported', term });
  }
  return out;
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
const COUNT_RE = /\b(?:team of\s+)?(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|dozens?|hundreds?)\+?\s+(?:[a-z-]+\s+)?(engineers?|developers?|people|members|direct reports|reports|teams?|squads?|countries|clients|customers|products|apps|applications|platforms|services|markets|regions|stakeholders)\b/gi;

/** Counts of people, teams, clients… ("team of 6 engineers", "six developers") that the master resume doesn't state. */
export function findInventedCounts(text: string, corpus: string): string[] {
  const norm = (n: string) => String(NUMBER_WORDS[n.toLowerCase()] ?? n.toLowerCase());
  const known = new Set(Array.from(corpus.matchAll(COUNT_RE)).map((m) => `${norm(m[1]!)}|${m[2]!.toLowerCase().replace(/s$/, '')}`));
  const out: string[] = [];
  for (const m of text.matchAll(COUNT_RE)) {
    const key = `${norm(m[1]!)}|${m[2]!.toLowerCase().replace(/s$/, '')}`;
    if (!known.has(key)) out.push(m[0]);
  }
  return out;
}

/** The facts of one master job, as text: title, company, place, bullets and technologies. */
export function jobFactsText(e: { title: string; company: string; location: string; bullets: string[]; technologies?: string[] }): string {
  return [e.title, e.company, e.location, ...e.bullets, (e.technologies ?? []).join(', ')].join('\n');
}

/** Accepted spellings of a job keyword the plan says the candidate has. */
export function planForms(plan: AtsPlan | null | undefined): (term: string) => string[] {
  const kws = (plan?.keywords ?? []).filter((k) => k.support === 'supported');
  return (term: string) => kws.find((k) => k.forms.some((f) => sameKeyword(f, term)))?.forms ?? [];
}

export function forbiddenForms(plan: AtsPlan | null | undefined): string[][] {
  return (plan?.keywords ?? []).filter((k) => k.support !== 'supported' && (k.kind === 'hard' || k.kind === 'domain' || k.kind === 'certification')).map((k) => k.forms);
}

/** "8+ years" claims larger than the job dates show. */
export function yearsClaims(text: string, maxYears: number): string[] {
  if (!maxYears) return [];
  return Array.from(text.matchAll(/\b(\d{1,2})\s*\+?\s*(?:years|yrs)\b/gi)).filter((m) => Number(m[1]) > maxYears).map((m) => m[0]);
}

export function validateTailoredResume(t: TailoredResume, ctx: ValidateContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const allowed = allowedResume(ctx.master, ctx.profile);
  const corpus = allowedCorpus(ctx.master, ctx.profile);
  const masterById = new Map(allowed.experience.map((e) => [e.id, e]));

  // Employers, titles, dates — must match the master role they claim to come from.
  for (const e of t.experience) {
    const m = masterById.get(e.sourceId);
    if (!m) {
      issues.push(issue('critical', 'invented_employer', `“${e.company || e.title}” is not a role in your master resume.`, `${e.title} — ${e.company}`, true));
      continue;
    }
    if (norm(e.company) !== norm(m.company)) issues.push(issue('critical', 'invented_employer', `Employer changed from “${m.company}” to “${e.company}”.`, e.company));
    if (norm(e.title) !== norm(m.title)) issues.push(issue('critical', 'invented_title', `Job title changed from “${m.title}” to “${e.title}”.`, e.title));
    if (norm(e.startDate) !== norm(m.startDate) || norm(e.endDate) !== norm(m.endDate)) {
      issues.push(issue('critical', 'changed_dates', `Dates for ${m.company} changed from ${m.startDate}–${m.endDate} to ${e.startDate}–${e.endDate}.`));
    }
  }
  // Every role must remain, so no employment gap is hidden.
  const kept = new Set(t.experience.map((e) => e.sourceId));
  const omitted = allowed.experience.filter((e) => !kept.has(e.id));
  if (omitted.length) {
    const gaps = employmentGaps(allowed.experience.filter((e) => kept.has(e.id)));
    issues.push(
      issue(
        'critical',
        'hidden_gap',
        `${omitted.map((o) => `${o.title} at ${o.company}`).join(', ')} ${omitted.length > 1 ? 'were' : 'was'} removed${gaps.length ? ', creating an unexplained gap' : ''}. Every role stays on the resume.`,
      ),
    );
  }

  // Education and certifications must exist in the master.
  for (const ed of t.education) {
    if (!allowed.education.some((m) => norm(m.degree) === norm(ed.degree) && norm(m.institution) === norm(ed.institution))) {
      issues.push(issue('critical', 'invented_education', `Education entry “${ed.degree}, ${ed.institution}” is not in your master resume.`, ed.degree));
    }
  }
  for (const c of t.certifications) {
    if (!allowed.certifications.some((m) => similarity(m, c) >= 0.6 || norm(m).includes(norm(c)))) {
      issues.push(issue('critical', 'invented_certification', `Certification “${c}” is not in your master resume.`, c));
    }
  }

  // Each job's bullets use only that job's own technologies; job keywords the candidate lacks never appear.
  const forbidden = forbiddenForms(ctx.plan);
  const formsOf = planForms(ctx.plan);
  for (const e of t.experience) {
    const m = masterById.get(e.sourceId);
    if (!m) continue;
    const jobText = jobFactsText(m);
    for (const b of e.bullets) {
      for (const p of bulletProblems(b, jobText, corpus, forbidden, formsOf)) {
        if (p.kind === 'moved') issues.push(issue('critical', 'moved_skill', `“${p.term}” is from another job in your resume, not ${m.company || m.title}.`, b));
        else issues.push(issue('critical', 'unsupported_skill', `“${p.term}” isn’t in your master resume or confirmed skills.`, b));
      }
    }
    const own = m.technologies ?? [];
    for (const tech of e.technologies ?? []) {
      if (!own.some((o) => termKey(o) === termKey(tech) || sameKeyword(o, tech))) issues.push(issue('critical', 'moved_skill', `“${tech}” isn’t listed under ${m.company || m.title} in your master resume.`, tech));
    }
  }
  for (const [label, value] of [['Summary', t.summary], ['Headline', t.headline]] as const) {
    for (const forms of forbidden) if (forms.some((f) => hasForm(value, f))) issues.push(issue('critical', 'unsupported_skill', `${label} mentions “${forms[0]}”, which your resume doesn’t show.`, value));
    for (const { term, canonical } of techTerms(value)) {
      if (!grounded(term, canonical, corpus, formsOf(term)) && !explainedAcronym(term, value) && !(ctx.profile?.verifiedSkills ?? []).some((v) => sameKeyword(v, term))) {
        issues.push(issue('critical', 'unsupported_skill', `${label} mentions “${term}”, which isn’t in your master resume.`, value));
      }
    }
  }
  const skillList = [...t.skills, ...(t.skillGroups ?? []).flatMap((g) => g.skills)];
  for (const forms of forbidden) {
    const hit = skillList.find((s) => forms.some((f) => sameKeyword(s, f) || hasForm(s, f)));
    if (hit) issues.push(issue('critical', 'unsupported_skill', `Skill “${hit}” isn’t backed by your resume.`, hit));
  }
  // Team sizes and other counts must be stated in the master resume.
  for (const c of findInventedCounts([t.headline, t.summary, ...t.experience.flatMap((e) => e.bullets), ...t.projects.flatMap((p) => p.bullets)].join('\n'), corpus)) {
    issues.push(issue('critical', 'invented_metric', `“${c}” isn’t stated in your master resume.`, c));
  }
  // Project bullets follow the same rule as job bullets: only that project's own facts.
  for (const p of t.projects) {
    const mp = allowed.projects.find((x) => x.name.trim().toLowerCase() === p.name.trim().toLowerCase());
    const ptext = mp ? [mp.name, mp.description, ...mp.bullets].join('\n') : '';
    for (const b of p.bullets) {
      for (const pr of bulletProblems(b, ptext, corpus, forbidden, formsOf)) {
        issues.push(issue('critical', pr.kind === 'moved' ? 'moved_skill' : 'unsupported_skill', `“${pr.term}” isn’t part of the project “${p.name}” in your master resume.`, b));
      }
    }
  }
  // Years of experience never exceed what the job dates show.
  const maxYears = ctx.plan?.years ?? Math.floor(yearsOfExperience(allowed.experience));
  for (const y of yearsClaims(`${t.headline}\n${t.summary}`, maxYears)) {
    issues.push(issue('critical', 'years_claim', `“${y}” is more than the ${maxYears} years your job dates show.`, y));
  }

  // Metrics must appear in the master.
  const text = tailoredText(t);
  for (const m of findInventedMetrics(text, corpus)) {
    const where = text.split('\n').find((l) => l.includes(m)) ?? m;
    issues.push(issue('critical', 'invented_metric', `The number “${m}” does not appear in your master resume.`, where));
  }

  // Skills must be supported.
  const extra = supportedKeywords(ctx.evidence);
  for (const s of findUnsupportedSkills(text, corpus, [...extra, ...(ctx.profile?.verifiedSkills ?? [])])) {
    issues.push(issue('critical', 'unsupported_skill', `“${s}” isn’t supported by your master resume or confirmed skills.`, s));
  }
  for (const s of t.skills) {
    const known = findSkills(s).length > 0;
    if (!known && !mentionsSkill(corpus, s) && !extra.includes(s)) {
      issues.push(issue('critical', 'unsupported_skill', `Skill “${s}” isn’t in your master resume.`, s));
    }
  }

  // Facts the user restricted.
  const restricted = ctx.master.facts.filter((f) => f.status !== 'confirmed');
  for (const f of restricted) {
    const hit = f.kind === 'skill'
      ? t.skills.some((s) => s.toLowerCase() === f.text.toLowerCase())
      : t.experience.some((e) => e.bullets.some((b) => similarity(b, f.text) >= 0.6));
    if (hit) {
      issues.push(issue('critical', 'restricted_fact', `Uses a fact you marked “${f.status === 'do_not_use' ? 'Do not use' : 'Needs review'}”.`, f.text));
    }
  }

  // Copied job-description text.
  for (const sh of findCopiedJobText(text, ctx.job.description, corpus)) {
    issues.push(issue('warning', 'copied_job_text', 'This phrase is copied word-for-word from the job description. Reword it in your own terms.', sh));
  }

  // Location must not be changed.
  const trueLocation = ctx.profile?.location || ctx.master.parsed.contact.location;
  if (trueLocation && t.contact.location && norm(t.contact.location) !== norm(trueLocation)) {
    issues.push(issue('critical', 'location_mismatch', `Location changed from “${trueLocation}” to “${t.contact.location}”.`, t.contact.location));
  }

  // Length and format.
  const wc = wordCount(text);
  if (ctx.length === 'one_page' && wc > 650) issues.push(issue('warning', 'length', `About ${wc} words — likely more than one page.`, undefined, false));
  if (ctx.length === 'two_pages' && wc > 1150) issues.push(issue('warning', 'length', `About ${wc} words — likely more than two pages.`, undefined, false));
  for (const b of t.experience.flatMap((e) => e.bullets)) {
    if (wordCount(b) > 45) issues.push(issue('info', 'format', 'Long bullet — consider splitting it for readability.', b, false));
  }
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.code}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function validateCoverLetter(text: string, ctx: Omit<ValidateContext, 'length'> & { minWords: number; maxWords: number }): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const corpus = allowedCorpus(ctx.master, ctx.profile);
  const wc = wordCount(text);
  if (wc < ctx.minWords) issues.push(issue('info', 'length', `${wc} words — shorter than the ${ctx.minWords}–${ctx.maxWords} word target.`, undefined, false));
  if (wc > ctx.maxWords) issues.push(issue('warning', 'length', `${wc} words — longer than the ${ctx.minWords}–${ctx.maxWords} word target.`, undefined, false));
  for (const m of findInventedMetrics(text, corpus)) {
    issues.push(issue('critical', 'invented_metric', `The number “${m}” does not appear in your master resume.`, text.split(/(?<=[.!?])\s+/).find((s) => s.includes(m)) ?? m, false));
  }
  const extra = supportedKeywords(ctx.evidence);
  for (const s of findUnsupportedSkills(text, corpus, [...extra, ...(ctx.profile?.verifiedSkills ?? [])])) {
    // Naming the employer's technology in the context of "your team uses X" is common; flag for review rather than block.
    issues.push(issue('warning', 'unsupported_skill', `Mentions “${s}”, which your resume doesn’t support. Make sure it isn’t presented as your experience.`, s, false));
  }
  for (const c of findCliches(text)) issues.push(issue('warning', 'ai_cliche', 'Generic phrasing — rewrite in plain words.', c, false));
  for (const sh of findCopiedJobText(text, ctx.job.description, corpus)) {
    issues.push(issue('warning', 'copied_job_text', 'Copied word-for-word from the job description.', sh, false));
  }
  return issues;
}

export function hasCritical(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'critical');
}
