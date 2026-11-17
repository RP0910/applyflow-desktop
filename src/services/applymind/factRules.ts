/** Strict question-family rules. Similarity is never used here. */

export type FactFamily = 'work_authorization' | 'sponsorship' | 'gender' | 'ethnicity' | 'veteran' | 'disability' | 'pronouns';

export type FactDirection = 'yes_is_true' | 'yes_is_false';

export interface StrictFactMatch {
  family: FactFamily;
  direction: FactDirection;
  /** `job` means the question points at the job's country. A code is named in the question. */
  country: 'job' | string | null;
  demographic: boolean;
  factKey: string;
}

export interface StoredFact {
  factKey: string;
  family: FactFamily;
  country: string | null;
  value: string;
  wordings: string[];
  choices: { optionsKey: string; choice: string }[];
}

export type FactProposal =
  | { action: 'fill'; value: string; needsReview: boolean; source: string; factKey: string }
  | { action: 'ask'; reason: string };

const JOB_COUNTRY = /country (?:in which|where) (?:this |the )?job is located|country of (?:employment|the position)|this country/i;
const NAMED: [RegExp, string][] = [
  [/\b(united states|u\.s\.a?\.?|usa)\b/i, 'US'],
  [/\bcanada\b/i, 'CA'],
  [/\b(united kingdom|great britain|england|scotland|wales)\b/i, 'GB'],
  [/\b(india)\b/i, 'IN'],
  [/\b(germany)\b/i, 'DE'],
  [/\b(australia)\b/i, 'AU'],
];

const US_STATE = /,\s*(AL|AK|AZ|AR|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY|DC)\b/;

export function normOption(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function optionsKey(options: readonly string[]): string {
  return options.map(normOption).filter(Boolean).sort().join('|');
}

export function countryFromLocation(location: string | null | undefined): string | null {
  if (!location?.trim()) return null;
  for (const [re, code] of NAMED) if (re.test(location)) return code;
  if (US_STATE.test(location)) return 'US';
  return null;
}

function namedCountry(text: string): 'job' | string | null {
  if (JOB_COUNTRY.test(text)) return 'job';
  for (const [re, code] of NAMED) if (re.test(text)) return code;
  return null;
}

export function factFamilyOf(factKey: string): FactFamily | null {
  if (factKey.startsWith('work_authorization.')) return 'work_authorization';
  if (factKey.startsWith('sponsorship.')) return 'sponsorship';
  if (factKey === 'eeo.gender') return 'gender';
  if (factKey === 'eeo.race_ethnicity') return 'ethnicity';
  if (factKey === 'eeo.veteran') return 'veteran';
  if (factKey === 'eeo.disability') return 'disability';
  if (factKey === 'eeo.pronouns') return 'pronouns';
  return null;
}

export function factStoreKind(factKey: string): string {
  if (factKey.startsWith('work_authorization')) return 'work_authorization';
  if (factKey.startsWith('sponsorship')) return 'sponsorship';
  if (factKey === 'eeo.gender') return 'gender';
  if (factKey === 'eeo.race_ethnicity') return 'race_ethnicity';
  if (factKey === 'eeo.veteran') return 'veteran_status';
  if (factKey === 'eeo.disability') return 'disability_status';
  if (factKey === 'eeo.pronouns') return 'pronouns';
  return 'general';
}

export function resolvedFactKey(match: StrictFactMatch, jobCountry: string | null): string | null {
  if (match.family === 'work_authorization' || match.family === 'sponsorship') {
    const country = match.country === 'job' ? jobCountry : match.country;
    if (!country || country === 'job') return null;
    return familyKey(match.family, country);
  }
  return match.factKey;
}

function familyKey(family: FactFamily, country: string | null): string {
  if (family === 'work_authorization' || family === 'sponsorship') return `${family}.${country ?? 'unknown'}`;
  if (family === 'gender') return 'eeo.gender';
  if (family === 'ethnicity') return 'eeo.race_ethnicity';
  if (family === 'veteran') return 'eeo.veteran';
  if (family === 'disability') return 'eeo.disability';
  return 'eeo.pronouns';
}

/** A question is one of the standard families only when the wording and its direction are explicit. */
export function matchFactQuestion(label: string): StrictFactMatch | null {
  const text = label.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 240) return null;
  if (/\bpronouns?\b/i.test(text)) {
    return { family: 'pronouns', direction: 'yes_is_true', country: null, demographic: true, factKey: familyKey('pronouns', null) };
  }
  if (/^(what is your )?gender\b|\bgender identity\b|\bsex\b/i.test(text) && !/\b(equal opportunity|sexual orientation)\b/i.test(text)) {
    return { family: 'gender', direction: 'yes_is_true', country: null, demographic: true, factKey: familyKey('gender', null) };
  }
  if (/\b(ethnicity|race)\b/i.test(text) && !/\b(regardless|equal opportunity|culture or origin)\b/i.test(text)) {
    return { family: 'ethnicity', direction: 'yes_is_true', country: null, demographic: true, factKey: familyKey('ethnicity', null) };
  }
  if (/\bveteran\b/i.test(text) && !/\bspouse\b/i.test(text) && (/\bstatus\b/i.test(text) || /\bare you\b/i.test(text) || /^veteran\b/i.test(text))) {
    return { family: 'veteran', direction: 'yes_is_true', country: null, demographic: false, factKey: familyKey('veteran', null) };
  }
  if (/\bdisabilit/i.test(text) && !/\baccommodation\b/i.test(text)) {
    return { family: 'disability', direction: 'yes_is_true', country: null, demographic: false, factKey: familyKey('disability', null) };
  }
  if (/\bsponsor/i.test(text)) {
    const opposite = /\bwithout (?:visa |employer |immigration )?sponsorship\b|\bnot require sponsorship\b|\bno sponsorship\b|\bable to work without\b/i.test(text);
    const affirmative = /\b(will|do|would) you\b/i.test(text) || /\brequire(?:s|d)? (?:visa |employer |immigration )?sponsorship\b/i.test(text) || /\bneed sponsorship\b/i.test(text);
    if (opposite === affirmative) return null;
    const country = namedCountry(text);
    return { family: 'sponsorship', direction: opposite ? 'yes_is_false' : 'yes_is_true', country, demographic: false, factKey: familyKey('sponsorship', country === 'job' ? null : country) };
  }
  if (/\b(legally authorized|authorized to work|authorised to work|legally eligible to work|eligible to work|legally permitted to work)\b/i.test(text)) {
    const country = namedCountry(text);
    return { family: 'work_authorization', direction: 'yes_is_true', country, demographic: false, factKey: familyKey('work_authorization', country === 'job' ? null : country) };
  }
  return null;
}

function invertYesNo(value: string, direction: FactDirection): string | null {
  if (direction === 'yes_is_true') return value.trim();
  const n = normOption(value);
  if (n === 'yes') return 'No';
  if (n === 'no') return 'Yes';
  return null;
}

export function mapFactToOptions(factValue: string, options: readonly string[], knownChoice: string | null, direction: FactDirection): { value: string | null; reason: 'known-list' | 'single' | 'none' | 'many' | 'direction' } {
  const wanted = invertYesNo(factValue, direction);
  if (wanted == null) return { value: null, reason: 'direction' };
  if (!options.length) return { value: wanted, reason: 'single' };
  if (knownChoice) {
    const known = options.filter((o) => normOption(o) === normOption(knownChoice));
    if (known.length === 1) return { value: known[0]!, reason: 'known-list' };
  }
  const hits = options.filter((o) => normOption(o) === normOption(wanted));
  if (hits.length === 1) return { value: hits[0]!, reason: 'single' };
  if (hits.length > 1) return { value: null, reason: 'many' };
  return { value: null, reason: 'none' };
}

/**
 * Fill from a confirmed fact, or ask. Returns null when this question is not a standard family.
 * A US fact is never used for a different country. An unknown country is not filled.
 */
export function proposeFactFill(label: string, options: readonly string[], facts: readonly StoredFact[], jobCountry: string | null, learnDemographics: boolean, normalized: string): FactProposal | null {
  const match = matchFactQuestion(label);
  if (!match) return null;
  if (match.demographic && !learnDemographics) return { action: 'ask', reason: 'Demographic answers are turned off in Settings.' };
  let country = match.country;
  if (country === 'job') {
    if (!jobCountry) return { action: 'ask', reason: 'This question depends on the job’s country, and that country is not known.' };
    country = jobCountry;
  }
  if ((match.family === 'work_authorization' || match.family === 'sponsorship') && !country) {
    const couldMisapply = facts.some((f) => f.factKey.startsWith(`${match.family}.`));
    if (couldMisapply) return { action: 'ask', reason: 'The country for this question is not known, so ApplyFlow will not fill it.' };
    return null;
  }
  const factKey = familyKey(match.family, country);
  const fact = facts.find((f) => f.factKey === factKey);
  if (!fact) return null;
  if (fact.country && country && fact.country !== country) return { action: 'ask', reason: 'The saved answer is for a different country.' };
  const known = fact.choices.find((c) => c.optionsKey === optionsKey(options))?.choice ?? null;
  const mapped = mapFactToOptions(fact.value, options, known, match.direction);
  if (!mapped.value) {
    const reason = mapped.reason === 'many'
      ? 'More than one option matches your saved answer. Choose one.'
      : mapped.reason === 'direction'
        ? 'This question is worded the other way, and the saved answer is not yes or no.'
        : 'None of the options match your saved answer. Choose one.';
    return { action: 'ask', reason };
  }
  const approved = fact.wordings.some((w) => w === normalized);
  return {
    action: 'fill',
    value: mapped.value,
    needsReview: !approved,
    source: approved ? 'Your saved answer' : 'Your saved answer — check this wording',
    factKey,
  };
}
