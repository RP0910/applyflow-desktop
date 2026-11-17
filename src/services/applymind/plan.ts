import type { ApprovedAnswer } from '@/types';
import { SCREENING_CATALOG, type ScreeningCatalogQuestion } from '@/services/forms/screeningCatalog';
import { canonicalizeQuestion, matchOption, questionSimilarity, scoreAgainstPatterns } from '@/services/forms/questionMatch';
import { FRESHNESS_DAYS } from './constants';
import { questionTypeOf } from './questionType';
import { GENERAL_CONTEXT } from './exact';
import type { FactSkip, MigrationPlan, PlannedProposal, PlannedRecord } from './types';

const CATALOG_ATTACH = 0.85;
const CLUSTER = 0.72;

interface FactRule {
  key: string;
  kind: string;
  label: string;
  country?: string;
  freshness?: number;
}

const FACT_RULES: Record<string, FactRule> = {
  work_auth_us: { key: 'work_authorization.US', kind: 'work_authorization', label: 'Legally authorized to work in the United States', country: 'US' },
  sponsorship: { key: 'sponsorship.US', kind: 'sponsorship', label: 'Will require visa sponsorship', country: 'US' },
  age_18: { key: 'age.at_least_18', kind: 'age_at_least_18', label: 'At least 18 years of age' },
  export_control: { key: 'export_control.us_person', kind: 'us_person', label: 'U.S. person for export control' },
  remote_location: { key: 'location.current', kind: 'location', label: 'Current location' },
  salary_expectation: { key: 'compensation.expectation', kind: 'salary_expectation', label: 'Salary expectation', freshness: FRESHNESS_DAYS },
  current_salary: { key: 'compensation.current', kind: 'salary_current', label: 'Current or most recent compensation', freshness: FRESHNESS_DAYS },
  start_date: { key: 'availability.start', kind: 'availability', label: 'When you can start', freshness: FRESHNESS_DAYS },
  criminal: { key: 'background.felony_conviction', kind: 'criminal_conviction', label: 'Felony conviction' },
  background_check: { key: 'background.check_consent', kind: 'background_check_consent', label: 'Consent to a background check' },
  clearance: { key: 'clearance.level', kind: 'security_clearance', label: 'Security clearance' },
  degree: { key: 'education.highest', kind: 'education_level', label: 'Highest level of education' },
  linkedin: { key: 'links.linkedin', kind: 'linkedin', label: 'LinkedIn profile URL' },
  portfolio: { key: 'links.portfolio', kind: 'portfolio', label: 'Portfolio or personal site' },
  gender: { key: 'eeo.gender', kind: 'gender', label: 'Gender' },
  race: { key: 'eeo.race_ethnicity', kind: 'race_ethnicity', label: 'Race / ethnicity' },
  veteran: { key: 'eeo.veteran', kind: 'veteran_status', label: 'Veteran status' },
  disability: { key: 'eeo.disability', kind: 'disability_status', label: 'Disability status' },
  pronouns: { key: 'eeo.pronouns', kind: 'pronouns', label: 'Pronouns' },
  preferred_name: { key: 'identity.preferred_name', kind: 'preferred_name', label: 'Preferred name' },
  sms_consent: { key: 'consent.sms', kind: 'sms_consent', label: 'Consent to SMS about an application' },
  contact_employer: { key: 'employment.contact_current', kind: 'contact_current_employer', label: 'May contact current employer', freshness: FRESHNESS_DAYS },
  non_compete: { key: 'employment.non_compete', kind: 'non_compete', label: 'Subject to a non-compete', freshness: FRESHNESS_DAYS },
};

const NOT_A_FACT: Record<string, FactSkip['reason']> = {
  relocate: 'context_dependent',
  onsite_hybrid: 'context_dependent',
  travel: 'context_dependent',
  years_total: 'computed_from_dates',
  years_relevant: 'context_dependent',
  previous_employee: 'job_specific',
  relative: 'job_specific',
  why_us: 'job_specific',
  hear_about: 'job_specific',
  referral_name: 'job_specific',
  privacy_consent: 'legal_consent',
  truthful: 'legal_consent',
};

const FACT_SIMILARITY = 0.72;

function catalogById(id: string): ScreeningCatalogQuestion | undefined {
  return SCREENING_CATALOG.find((q) => q.id === id);
}

function strictCatalog(a: ApprovedAnswer): ScreeningCatalogQuestion | null {
  if (a.catalogId) return catalogById(a.catalogId) ?? null;
  const text = a.questionPattern.trim();
  if (text.length < 3 || text.length > 220) return null;
  const ranked = SCREENING_CATALOG.map((question) => ({
    question,
    score: Math.max(questionSimilarity(text, question.prompt), ...question.aliases.map((alias) => questionSimilarity(text, alias))),
  })).sort((x, y) => y.score - x.score);
  const best = ranked[0];
  if (!best || best.score < FACT_SIMILARITY) return null;
  const second = ranked[1];
  if (second && second.score >= FACT_SIMILARITY && second.score >= best.score - 0.05) return null;
  if (best.question.id === 'veteran' && /spouse/i.test(text)) return null;
  return best.question;
}

export function resolveCatalog(a: ApprovedAnswer): { question: ScreeningCatalogQuestion; confident: boolean } | null {
  if (a.catalogId) {
    const question = catalogById(a.catalogId);
    return question ? { question, confident: true } : null;
  }
  let best: { question: ScreeningCatalogQuestion; score: number } | null = null;
  const ranked: { question: ScreeningCatalogQuestion; score: number }[] = [];
  for (const question of SCREENING_CATALOG) {
    const score = scoreAgainstPatterns(a.questionPattern, [question.prompt, ...question.aliases]);
    ranked.push({ question, score });
    if (score >= CATALOG_ATTACH && (!best || score > best.score)) best = { question, score };
  }
  if (!best) return null;
  const winner = best;
  const close = ranked.some((r) => r.question.id !== winner.question.id && r.score >= winner.score - 0.05 && r.score >= CATALOG_ATTACH);
  return { question: winner.question, confident: !close };
}

function normValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function acceptedValue(question: ScreeningCatalogQuestion, answer: string): string | null {
  const trimmed = answer.trim();
  if (!trimmed) return null;
  if (!question.options?.length) return trimmed;
  return matchOption(question.options, trimmed);
}

function freshnessFor(catalogId: string | null, category: string, rule?: FactRule): number | null {
  if (rule?.freshness) return rule.freshness;
  if (category === 'salary') return FRESHNESS_DAYS;
  if (catalogId === 'start_date') return FRESHNESS_DAYS;
  return null;
}

function assignPatterns(answers: ApprovedAnswer[]): Map<string, string> {
  const out = new Map<string, string>();
  const groups: { id: string; category: string; exemplars: string[] }[] = [];
  const sorted = [...answers].sort((a, b) => a.approvedAt.localeCompare(b.approvedAt) || a.id.localeCompare(b.id));
  for (const a of sorted) {
    const resolved = resolveCatalog(a);
    if (resolved?.confident) {
      out.set(a.id, `catalog:${resolved.question.id}`);
      continue;
    }
    let group = groups.find((g) => g.category === a.category && g.exemplars.some((e) => scoreAgainstPatterns(a.questionPattern, [e]) >= CLUSTER));
    if (!group) {
      group = { id: `pattern:${a.id}`, category: a.category, exemplars: [] };
      groups.push(group);
    }
    if (a.questionPattern.trim()) group.exemplars.push(a.questionPattern);
    out.set(a.id, group.id);
  }
  return out;
}

export function planMigration(answers: ApprovedAnswer[], deviceId: string, now: string): MigrationPlan {
  const patterns = assignPatterns(answers);
  const records: PlannedRecord[] = [];
  const draft: PlannedProposal[] = [];
  const skips: FactSkip[] = [];

  for (const a of answers) {
    const resolved = resolveCatalog(a);
    const catalogId = resolved?.question.id ?? a.catalogId ?? null;
    const question = a.questionPattern.trim() || resolved?.question.prompt || 'Saved answer';
    const rule = catalogId ? FACT_RULES[catalogId] : undefined;
    records.push({
      id: `kr_${a.id}`,
      sourceAnswerId: a.id,
      deviceId,
      patternId: patterns.get(a.id) ?? `pattern:${a.id}`,
      originalQuestion: question,
      normalizedQuestion: canonicalizeQuestion(question),
      category: a.category,
      questionType: questionTypeOf({ ...a, questionPattern: question }),
      options: a.options?.length ? a.options : (resolved?.question.options ? [...resolved.question.options] : []),
      answer: a.answer,
      status: 'verified',
      provenance: { kind: 'user_entered', sourceAnswerId: a.id, catalogId, factId: null },
      context: GENERAL_CONTEXT,
      platform: null,
      answeredAt: a.approvedAt || now,
      confirmedAt: a.approvedAt || now,
      freshnessDays: freshnessFor(catalogId, a.category, rule),
    });

    if (!a.answer.trim()) {
      skips.push({ sourceAnswerId: a.id, catalogId, reason: 'empty' });
      continue;
    }
    const factQuestion = strictCatalog(a);
    if (!factQuestion) {
      skips.push({ sourceAnswerId: a.id, catalogId: a.catalogId ?? null, reason: 'custom_wording' });
      continue;
    }
    const blocked = NOT_A_FACT[factQuestion.id];
    if (blocked) {
      skips.push({ sourceAnswerId: a.id, catalogId: factQuestion.id, reason: blocked });
      continue;
    }
    const fact = FACT_RULES[factQuestion.id];
    if (!fact) {
      skips.push({ sourceAnswerId: a.id, catalogId: factQuestion.id, reason: 'custom_wording' });
      continue;
    }
    const value = acceptedValue(factQuestion, a.answer);
    if (!value) {
      skips.push({ sourceAnswerId: a.id, catalogId: factQuestion.id, reason: 'answer_not_in_options' });
      continue;
    }
    draft.push({
      id: `fp_${fact.key}`,
      factKey: fact.key,
      kind: fact.kind,
      label: fact.label,
      country: fact.country ?? null,
      sourceAnswerId: a.id,
      question,
      value,
      freshnessDays: fact.freshness ?? null,
    });
  }

  const proposals: PlannedProposal[] = [];
  const byKey = new Map<string, PlannedProposal[]>();
  for (const p of draft) {
    const list = byKey.get(p.factKey) ?? [];
    list.push(p);
    byKey.set(p.factKey, list);
  }
  for (const [key, list] of byKey) {
    const values = new Set(list.map((p) => normValue(p.value)));
    if (values.size > 1) {
      for (const p of list) skips.push({ sourceAnswerId: p.sourceAnswerId, catalogId: null, reason: 'conflicting_values' });
      continue;
    }
    const first = list[0];
    if (!first) continue;
    proposals.push({ ...first, id: `fp_${key}` });
  }

  return { records, proposals, skips };
}

export function migrationLogLine(counts: {
  answersSeen: number;
  created: number;
  unchanged: number;
  edited: number;
  proposals: number;
  tierAUnlocked: boolean;
}): string {
  return `ApplyMind migration: seen ${counts.answersSeen}, created ${counts.created}, unchanged ${counts.unchanged}, edited ${counts.edited}, proposals ${counts.proposals}, tierA ${counts.tierAUnlocked}`;
}
