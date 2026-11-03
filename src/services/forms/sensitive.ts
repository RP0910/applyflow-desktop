/**
 * Sensitive-question detection. Anything matched here is NEVER filled automatically.
 * Order matters: more specific categories are checked first.
 */
import type { SensitiveCategory } from '@/types';

export const SENSITIVE_RULES: { category: SensitiveCategory; re: RegExp }[] = [
  { category: 'sponsorship', re: /\bsponsor(?:ship|ed|ing)?\b|\bh-?1b\b|\bvisa\b/i },
  { category: 'work_authorization', re: /authori[sz](?:ed|ation) to work|work authori[sz]ation|eligible to work|legally (?:able|eligible|permitted|authorized)|\bcitizen(?:ship)?\b|right to work|employment eligibility|immigration status|green card|permanent resident|\bead\b|work permit/i },
  { category: 'security_clearance', re: /\bclearance\b|\bsecret\b|ts\/sci|polygraph|public trust/i },
  { category: 'criminal_background', re: /criminal|convicted|conviction|felony|misdemeanou?r|background check|arrest(?:ed)?|pending charges/i },
  { category: 'disability', re: /disabilit|reasonable accommodation|impairment/i },
  { category: 'veteran', re: /veteran|military service|armed forces|uniformed service|\bvevraa\b/i },
  { category: 'demographic', re: /\bgender\b|\bsex\b|\brace\b|ethnicity|hispanic|latin[oax]|sexual orientation|pronouns?|transgender|marital status|religio|national origin|\blgbt/i },
  { category: 'date_of_birth', re: /date of birth|birth ?date|\bdob\b|\bage\b|how old|over (?:the age of )?18|at least 18/i },
  { category: 'salary', re: /salary|compensation|\bpay\b|desired rate|hourly rate|expected rate|rate expectation|\bctc\b|\bwage|\$\s*\/\s*(?:hr|hour|year)/i },
  { category: 'relocation', re: /relocat|willing(?:ness)? to (?:move|travel|commute)|able to (?:commute|work on-?site|work in (?:the )?office)|on-?site (?:\d|days|requirement)|in[- ]office|hybrid schedule/i },
  { category: 'years_experience', re: /years? of (?:professional |relevant |hands-on |work |industry )?experience|how many years|\byrs\b|years (?:have you|working)/i },
  { category: 'legal_consent', re: /\bi (?:agree|certify|acknowledge|consent|attest|understand)\b|terms (?:and|&) conditions|terms of (?:use|service)|privacy (?:policy|notice)|signature|e-?sign|non-?compete|arbitration|by checking this box|true and (?:complete|accurate)/i },
];

export const SENSITIVE_LABELS: Record<SensitiveCategory, string> = {
  sponsorship: 'Visa sponsorship',
  work_authorization: 'Work authorization',
  security_clearance: 'Security clearance',
  criminal_background: 'Criminal background',
  disability: 'Disability status',
  veteran: 'Veteran status',
  demographic: 'Demographic information',
  date_of_birth: 'Age or date of birth',
  salary: 'Salary expectations',
  relocation: 'Relocation or on-site availability',
  years_experience: 'Years of experience',
  legal_consent: 'Legal agreement or attestation',
};

export function detectSensitive(label: string, context = ''): SensitiveCategory | null {
  const text = `${label} ${context}`.replace(/\s+/g, ' ');
  for (const r of SENSITIVE_RULES) if (r.re.test(text)) return r.category;
  return null;
}

/** The label alone decides most cases; context is only consulted when the label is vague ("Yes/No", "Answer"). */
export function classifyFieldSensitivity(label: string, context: string): SensitiveCategory | null {
  const fromLabel = detectSensitive(label);
  if (fromLabel) return fromLabel;
  const vague = label.trim().length < 4 || /^(yes|no|answer|select|choose|response|please select|option)\b/i.test(label.trim());
  return vague ? detectSensitive('', context) : null;
}
