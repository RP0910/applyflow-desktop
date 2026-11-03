/**
 * Field → proposed value. Pure function: no DOM access, fully testable.
 * Every proposal carries its source and a confidence so the user can see why.
 */
import type { CareerProfile, CoverLetter, FieldProposal, FieldSemantic, FormFieldDescriptor, TailoredResume, ApprovedAnswer, ScreeningControl } from '@/types';
import { formatLocationLine } from '@/utils/address';
import { SENSITIVE_LABELS } from './sensitive';
import { truncate } from '@/utils/text';
import {
  MATCH_THRESHOLD,
  answerFitsField,
  matchOption,
  patternsForAnswer,
  questionSimilarity,
  questionWords,
  scoreAgainstPatterns,
} from './questionMatch';

/** Merge remembered answers when patterns are clearly the same question. */
const REMEMBER_MERGE_THRESHOLD = 0.55;

export { questionWords, matchOption } from './questionMatch';

/** Map a live form control onto the Screening Q&A control set. */
export function toScreeningControl(control: FormFieldDescriptor['control']): ScreeningControl | undefined {
  if (control === 'text' || control === 'textarea' || control === 'select' || control === 'combobox' || control === 'radio' || control === 'checkbox') return control;
  if (control === 'email' || control === 'tel' || control === 'url' || control === 'number' || control === 'date') return 'text';
  return undefined;
}

const SEMANTIC_RULES: { semantic: FieldSemantic; re: RegExp; controls?: FormFieldDescriptor['control'][] }[] = [
  { semantic: 'resume_upload', re: /resume|\bcv\b|curriculum/i, controls: ['file'] },
  { semantic: 'cover_letter_upload', re: /cover/i, controls: ['file'] },
  { semantic: 'cover_letter_text', re: /cover letter|letter of interest|motivation letter/i, controls: ['textarea'] },
  { semantic: 'first_name', re: /first[\s_-]?name|given[\s_-]?name|\bfname\b/i, controls: ['text', 'email', 'tel', 'url', 'other'] },
  { semantic: 'last_name', re: /last[\s_-]?name|surname|family[\s_-]?name|\blname\b/i, controls: ['text', 'email', 'tel', 'url', 'other'] },
  { semantic: 'full_name', re: /full[\s_-]?name|legal name|^name\b|your name/i, controls: ['text', 'email', 'tel', 'url', 'other'] },
  { semantic: 'email', re: /\be-?mail\b/i, controls: ['text', 'email', 'tel', 'url', 'other'] },
  { semantic: 'phone', re: /\b(phone|mobile|cell(?:ular)?(?: ?phone)?|telephone|tel)\b/i, controls: ['text', 'email', 'tel', 'url', 'other'] },
  { semantic: 'linkedin', re: /linked\s?in/i, controls: ['text', 'email', 'tel', 'url', 'other'] },
  { semantic: 'github', re: /github/i, controls: ['text', 'email', 'tel', 'url', 'other'] },
  { semantic: 'portfolio', re: /portfolio|personal (?:site|website)/i, controls: ['text', 'email', 'tel', 'url', 'other'] },
  { semantic: 'website', re: /website|\burl\b|homepage/i, controls: ['text', 'email', 'tel', 'url', 'other'] },
  // Line 2 before line 1 so "Address Line 2" is not classified as street.
  { semantic: 'address_line2', re: /address\s*(line)?\s*2\b|apt\.?\s*#?|apartment|suite|unit\b|#\s*\w/i, controls: ['text', 'textarea', 'other'] },
  { semantic: 'street', re: /address\s*(line)?\s*1\b|^street\b|street address|mailing address|home address|^address$/i, controls: ['text', 'textarea', 'other'] },
  { semantic: 'city', re: /^city\b|town\/?city|municipality/i },
  { semantic: 'state', re: /^(state|province|region)\b|state\/province|state or province/i, controls: ['select', 'combobox', 'text', 'other'] },
  { semantic: 'postal_code', re: /postal|zip\s*code|zip\/postal|post\s*code|\bzip\b/i, controls: ['text', 'number', 'other'] },
  { semantic: 'country', re: /^country( of residence)?$|^country\b(?!.*(code|citizenship|born))/i, controls: ['select', 'combobox', 'text'] },
  { semantic: 'location', re: /current location|^location\b|city,? (?:and )?state|where are you (?:located|based)/i },
  { semantic: 'headline', re: /headline|current (?:job )?title|professional title/i },
  { semantic: 'summary', re: /^(professional )?summary$|^(profile|professional) summary|^about (?:you|yourself|me)$|^tell us about yourself$|^introduction$/i, controls: ['textarea', 'text'] },
  { semantic: 'skills', re: /\bskills?\b|technologies|tech stack/i, controls: ['textarea', 'text'] },
];

/** Questions about someone else (a referrer, a manager, an emergency contact): never your own details. */
const SOMEONE_ELSE = /\b(refer(?:r(?:al|er|ed)|ence)s?|referred by|emergency|manager|supervisor|recruiter|hiring|contact person|parent|guardian|spouse|partner|friend|employee who|who referred)\b/i;
const CONTACT_SEMANTICS = new Set<FieldSemantic>(['first_name', 'last_name', 'full_name', 'email', 'phone', 'linkedin', 'github', 'portfolio', 'website', 'location', 'street', 'address_line2', 'city', 'state', 'postal_code', 'country']);

export function semanticOf(f: Pick<FormFieldDescriptor, 'label' | 'name' | 'control'>): FieldSemantic {
  const s = semanticOfRaw(f);
  return CONTACT_SEMANTICS.has(s) && SOMEONE_ELSE.test(f.label) ? 'unknown' : s;
}

function semanticOfRaw(f: Pick<FormFieldDescriptor, 'label' | 'name' | 'control'>): FieldSemantic {
  const hay = `${f.label} ${f.name}`;
  // Lever's "Additional information" box is where a cover letter goes.
  if (f.control === 'textarea' && f.name === 'comments') return 'cover_letter_text';
  for (const r of SEMANTIC_RULES) {
    if (r.controls && !r.controls.includes(f.control)) continue;
    if (r.re.test(f.label) || (!f.label && r.re.test(f.name))) return r.semantic;
  }
  if (f.control === 'email') return 'email';
  if (f.control === 'tel') return 'phone';
  if (f.control === 'file' && /resume|cv/i.test(hay)) return 'resume_upload';
  return 'unknown';
}

export interface MapperContext {
  profile: CareerProfile;
  resume: TailoredResume | null;
  coverLetter: CoverLetter | null;
  includeCoverLetter: boolean;
  resumeFileName: string | null;
  coverLetterFileName: string | null;
  /** Apply answers the user saved earlier (each one approved by the user). */
  useSavedAnswers?: boolean;
  /**
   * Fields to correct even when already filled: employer forms that read the uploaded resume fill
   * name, email and phone themselves, sometimes wrongly. Your profile wins for these.
   */
  overwrite?: FieldSemantic[];
}

/** The country in a profile location ("St. Petersburg, FL 33702, US" → "United States"). */
export function countryOf(location: string): string {
  const l = location.trim();
  if (!l) return '';
  if (/(,|\s)(us|usa|u\.s\.a?\.?|united states( of america)?)\s*$/i.test(l) || /,\s*[A-Z]{2}(\s+\d{5}(-\d{4})?)?\s*$/.test(l)) return 'United States';
  const last = l.split(',').pop()!.trim();
  return /^[A-Za-z][A-Za-z .'-]{2,}$/.test(last) && !/\d/.test(last) && last.length > 3 ? last : '';
}

function profileCountry(p: CareerProfile): string {
  const c = p.country.trim();
  if (c) {
    if (/^(us|usa|u\.s\.a?\.?)$/i.test(c)) return 'United States';
    return c;
  }
  return countryOf(formatLocationLine(p) || p.location);
}

function profileCity(p: CareerProfile, resumeLocation: string): string {
  if (p.city.trim()) return p.city.trim();
  return (p.location || resumeLocation || '').split(',')[0]?.trim() ?? '';
}

function profileState(p: CareerProfile): string {
  if (p.state.trim()) return p.state.trim();
  const loc = p.location.trim();
  const m = loc.match(/,\s*([A-Z]{2})\b/) || loc.match(/,\s*([A-Za-z][A-Za-z .'-]+?)(?:\s+\d{5}|,|$)/);
  return m?.[1]?.trim() ?? '';
}

function profilePostal(p: CareerProfile): string {
  if (p.postalCode.trim()) return p.postalCode.trim();
  const m = (p.location || '').match(/\b(\d{5}(?:-\d{4})?)\b/);
  return m?.[1] ?? '';
}

const same = (a: string, b: string) => {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9@.+]/g, '');
  const digits = (s: string) => s.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return n(a) === n(b) || (digits(a).length >= 7 && digits(a) === digits(b));
};

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] ?? '', last: parts.length > 1 ? parts[parts.length - 1]! : '' };
}

export function approvedFor(answers: ApprovedAnswer[], f: Pick<FormFieldDescriptor, 'label' | 'context' | 'sensitive' | 'options' | 'control'>): string | null {
  const fieldText = `${f.label} ${f.context}`.trim();
  const category = f.sensitive ? f.sensitive : 'general';
  const ranked = answers
    .filter((a) => a.category === category && answerFitsField(a, f))
    .map((a) => {
      const patterns = patternsForAnswer(a);
      if (!patterns.length || patterns.every((p) => !questionWords(p).length)) return { a, score: 0.78 };
      return { a, score: scoreAgainstPatterns(fieldText, patterns) };
    })
    .filter((x) => x.score >= MATCH_THRESHOLD)
    .sort((x, y) => y.score - x.score || (y.a.useCount ?? 0) - (x.a.useCount ?? 0));
  if (ranked[0]) return ranked[0].a.answer;
  // Single saved answer for this category that fits the options — reuse it (e.g. Gender / Race / Veteran).
  const categoryOnly = answers.filter((a) => a.category === category && answerFitsField(a, f));
  if (categoryOnly.length === 1) return categoryOnly[0]!.answer;
  return null;
}

/** Upsert a remembered screening answer (same category + similar pattern → replace). */
export function rememberAnswer(
  answers: ApprovedAnswer[],
  next: Omit<ApprovedAnswer, 'id' | 'approvedAt'> & { id?: string; approvedAt?: string },
  idFactory: () => string,
  now: string,
): ApprovedAnswer[] {
  const pattern = next.questionPattern.trim();
  const nextPatterns = [pattern, ...(next.aliases ?? [])].filter(Boolean);
  const rest = answers.filter((a) => {
    if (next.catalogId && a.catalogId === next.catalogId) return false;
    if (a.category !== next.category) return true;
    if (!pattern && !a.questionPattern.trim() && !next.catalogId) return false;
    const existing = patternsForAnswer(a);
    if (pattern && existing.some((p) => p.trim().toLowerCase() === pattern.toLowerCase())) return false;
    if (nextPatterns.length && existing.some((p) => nextPatterns.some((n) => n && scoreAgainstPatterns(n, [p]) >= REMEMBER_MERGE_THRESHOLD))) return false;
    if (pattern && a.questionPattern.trim() && questionSimilarity(a.questionPattern, pattern) >= REMEMBER_MERGE_THRESHOLD) return false;
    return true;
  });
  const aliases = Array.from(
    new Set([...(next.aliases ?? []), ...((answers.find((a) => a.catalogId && a.catalogId === next.catalogId)?.aliases) ?? [])]
      .map((s) => s.trim())
      .filter((s) => s && s.toLowerCase() !== pattern.toLowerCase())),
  );
  const options = next.options?.map((o) => o.trim()).filter(Boolean);
  return [
    ...rest,
    {
      id: next.id ?? idFactory(),
      category: next.category,
      questionPattern: pattern,
      answer: next.answer.trim(),
      approvedAt: next.approvedAt ?? now,
      lastUsedAt: next.lastUsedAt,
      useCount: next.useCount ?? 0,
      control: next.control,
      options: options?.length ? options : undefined,
      aliases: aliases.length ? aliases : undefined,
      catalogId: next.catalogId,
    },
  ];
}

/** Mark a reused answer as used (for ranking and Profile review). */
export function markAnswerUsed(answers: ApprovedAnswer[], answerText: string, category: ApprovedAnswer['category'], now: string): ApprovedAnswer[] {
  return answers.map((a) =>
    a.category === category && a.answer.trim().toLowerCase() === answerText.trim().toLowerCase()
      ? { ...a, lastUsedAt: now, useCount: (a.useCount ?? 0) + 1 }
      : a,
  );
}

export function proposeFieldValues(fields: FormFieldDescriptor[], ctx: MapperContext): FieldProposal[] {
  const p = ctx.profile;
  const r = ctx.resume;
  const fullName = p.fullName || r?.contact.fullName || '';
  const { first, last } = splitName(fullName);
  const links = r?.contact.links ?? [];
  const linkedin = p.linkedinUrl || links.find((l) => /linkedin/i.test(l)) || '';
  const github = p.githubUrl || links.find((l) => /github/i.test(l)) || '';
  const portfolio = p.portfolioLinks[0] || links.find((l) => !/linkedin|github/i.test(l)) || '';

  return fields.map((f): FieldProposal => {
    const base: FieldProposal = {
      fieldId: f.fieldId,
      label: f.label || f.name || 'Unlabeled field',
      control: f.control,
      semantic: semanticOf(f),
      action: 'manual',
      proposedValue: '',
      source: '',
      confidence: 'low',
      required: f.required,
      sensitive: f.sensitive,
      reason: '',
      approvedSuggestion: null,
      status: 'pending',
      options: f.options.length ? f.options : undefined,
    };
    // An answer the user saved earlier for this kind of question: apply it (it is shown in the review before submit).
    const saved = (): FieldProposal | null => {
      // Legal attestations ("I certify…", terms) are confirmed by the user on every application.
      if (!ctx.useSavedAnswers || f.currentValue || f.sensitive === 'legal_consent') return null;
      const ans = approvedFor(p.approvedAnswers, f);
      if (!ans) return null;
      const value = f.options.length && (f.control === 'radio' || f.control === 'select' || f.control === 'combobox') ? matchOption(f.options, ans) : ans;
      return value ? { ...base, action: 'answer', proposedValue: value, approvedSuggestion: ans, source: 'Your saved answer', confidence: 'high', reason: 'You saved this answer earlier.' } : null;
    };

    if (f.sensitive) {
      const s = saved();
      if (s) return s;
      if (f.currentValue) return { ...base, action: 'skip', proposedValue: f.currentValue, source: 'Already answered on the page', confidence: 'high', reason: 'Already answered.', status: 'skipped' };
      return {
        ...base,
        action: 'manual',
        reason: `${SENSITIVE_LABELS[f.sensitive]} — ApplyFlow won’t guess this. Choose your answer; you can save it for next time.`,
        approvedSuggestion: approvedFor(p.approvedAnswers, f),
        source: 'You (manual)',
      };
    }
    if (f.control === 'checkbox' || f.control === 'radio') {
      const s = saved();
      if (s) return s;
      if (f.currentValue) return { ...base, action: 'skip', proposedValue: f.currentValue, source: 'Already answered on the page', confidence: 'high', reason: 'Already answered.', status: 'skipped' };
      return { ...base, action: 'manual', reason: 'ApplyFlow won’t guess this. Choose your answer; you can save it for next time.', approvedSuggestion: approvedFor(p.approvedAnswers, f), source: 'You (manual)' };
    }
    const correctable = Boolean(ctx.overwrite?.includes(base.semantic));
    if (f.currentValue && f.control !== 'file' && !correctable) {
      return { ...base, action: 'skip', proposedValue: f.currentValue, source: 'Already filled on the page', confidence: 'high', reason: 'Already filled on the page. ApplyFlow leaves it as-is.', status: 'skipped' };
    }

    const set = (value: string, source: string, confidence: FieldProposal['confidence'] = 'high'): FieldProposal => {
      if (f.currentValue && correctable) {
        // Filled by the site from your resume: keep it when it matches your profile, correct it otherwise.
        if (!value || same(f.currentValue, value)) return { ...base, action: 'skip', proposedValue: f.currentValue, source: 'Already filled on the page', confidence: 'high', reason: 'Already filled correctly.', status: 'skipped' };
        return { ...base, action: 'fill', proposedValue: value, source: `${source} (corrected what the site read from your resume)`, confidence };
      }
      if (!value) return { ...base, action: 'manual', reason: `No value saved for ${source.split('→').pop()?.trim() ?? 'this field'}. Add it to your profile or type it on the page.`, source };
      if (f.control === 'combobox' && f.options.length) {
        const opt = matchOption(f.options, value);
        if (!opt) return { ...base, action: 'manual', reason: `None of the options match “${truncate(value, 40)}”.`, source };
        return { ...base, action: 'fill', proposedValue: opt, source, confidence: 'medium' };
      }
      if (f.control === 'select') {
        const opt = matchOption(f.options, value);
        if (!opt) return { ...base, action: 'manual', reason: `None of the options match “${truncate(value, 40)}”.`, source };
        return { ...base, action: 'fill', proposedValue: opt, source, confidence: 'medium' };
      }
      return { ...base, action: 'fill', proposedValue: value, source, confidence };
    };

    switch (base.semantic) {
      case 'first_name': return set(first, 'Profile → Name');
      case 'last_name': return set(last, 'Profile → Name');
      case 'full_name': return set(fullName, 'Profile → Name');
      case 'email': return set(p.email || r?.contact.email || '', 'Profile → Email');
      case 'phone': return set(p.phone || r?.contact.phone || '', 'Profile → Phone');
      case 'street': return set(p.streetAddress || '', 'Profile → Street address');
      case 'address_line2': return set(p.addressLine2 || '', 'Profile → Address line 2', p.addressLine2 ? 'high' : 'medium');
      case 'city': return set(profileCity(p, r?.contact.location || ''), 'Profile → City');
      case 'state': return set(profileState(p), 'Profile → State', 'medium');
      case 'postal_code': return set(profilePostal(p), 'Profile → Postal code');
      case 'location': {
        // City/region for “Current location” pickers — never the street (that’s Address Line 1).
        const line = p.location.trim() || formatLocationLine(p) || r?.contact.location || '';
        return set(line, 'Profile → Location');
      }
      case 'country': return set(profileCountry(p), 'Profile → Country', 'medium');
      case 'linkedin': return set(linkedin, 'Profile → LinkedIn');
      case 'github': return set(github, 'Profile → GitHub');
      case 'portfolio': return set(portfolio, 'Profile → Portfolio');
      case 'website': return set(portfolio || linkedin, 'Profile → Links', 'medium');
      case 'headline': return set(r?.experience[0]?.title || r?.headline || p.headline, 'Tailored resume → Most recent title', 'medium');
      case 'summary': return set(r?.summary || p.professionalSummary, 'Tailored resume → Summary', 'medium');
      case 'skills': return set((r?.skills ?? []).join(', '), 'Tailored resume → Core skills', 'medium');
      case 'cover_letter_text':
        if (!ctx.includeCoverLetter) return { ...base, action: 'skip', reason: 'You chose not to include a cover letter.', source: 'Settings', status: 'skipped' };
        return set(ctx.coverLetter?.text ?? '', 'Tailored cover letter', 'high');
      case 'resume_upload':
        if (!r || !ctx.resumeFileName) return { ...base, action: 'manual', reason: 'Generate the tailored resume first.', source: 'Tailored resume' };
        return { ...base, action: 'upload', proposedValue: ctx.resumeFileName, source: `Tailored resume v${r.version}`, confidence: 'high' };
      case 'cover_letter_upload':
        if (!ctx.includeCoverLetter) return { ...base, action: 'skip', reason: 'You chose not to include a cover letter.', source: 'Settings', status: 'skipped' };
        if (!ctx.coverLetter || !ctx.coverLetterFileName) return { ...base, action: 'manual', reason: 'Generate the cover letter first.', source: 'Cover letter' };
        return { ...base, action: 'upload', proposedValue: ctx.coverLetterFileName, source: `Cover letter v${ctx.coverLetter.version}`, confidence: 'high' };
      default: {
        const s = saved();
        if (s) return s;
        const approved = approvedFor(p.approvedAnswers, f);
        return { ...base, action: 'manual', reason: 'ApplyFlow won’t guess this. Answer it once and save it for next time.', approvedSuggestion: approved, source: 'You (manual)' };
      }
    }
  });
}
