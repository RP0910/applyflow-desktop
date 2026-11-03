/**
 * Built-in catalog of common ATS screening questions (Greenhouse, Lever, Ashby, Workday, Dice, etc.).
 * Pure data — no AI. Users review these on Screening Q&A and save their own answers locally.
 */
import type { ApprovedAnswer, ScreeningControl, SensitiveCategory } from '@/types';

export type ScreeningCatalogGroup =
  | 'eligibility'
  | 'work_logistics'
  | 'compensation'
  | 'background'
  | 'experience'
  | 'source'
  | 'eeo'
  | 'consent'
  | 'other';

export const SCREENING_GROUP_LABELS: Record<ScreeningCatalogGroup, string> = {
  eligibility: 'Work eligibility',
  work_logistics: 'Location & logistics',
  compensation: 'Compensation & timing',
  background: 'Background & clearance',
  experience: 'Experience & skills',
  source: 'How you found the job',
  eeo: 'Voluntary EEO / demographics',
  consent: 'Agreements & consent',
  other: 'Other common questions',
};

export interface ScreeningCatalogQuestion {
  id: string;
  /** Primary wording shown in the UI. */
  prompt: string;
  /** Other wordings that mean the same thing on real forms. */
  aliases: string[];
  group: ScreeningCatalogGroup;
  category: SensitiveCategory | 'general';
  control: ScreeningControl;
  /** Typical choice labels (sites vary; used as suggestions when answering). */
  options?: string[];
  /** Short help shown under the prompt. */
  hint?: string;
}

const YN = ['Yes', 'No'] as const;

/** Curated from recurring ATS / employer application forms. */
export const SCREENING_CATALOG: ScreeningCatalogQuestion[] = [
  // —— Eligibility ——
  {
    id: 'work_auth_us',
    prompt: 'Are you legally authorized to work in the United States?',
    aliases: [
      'Are you authorized to work in the US?',
      'Are you legally eligible to work in the United States?',
      'Do you have the legal right to work in the United States?',
      'Work authorization status',
      'Are you eligible to work in this country?',
    ],
    group: 'eligibility',
    category: 'work_authorization',
    control: 'radio',
    options: [...YN],
  },
  {
    id: 'sponsorship',
    prompt: 'Will you now or in the future require visa sponsorship for employment?',
    aliases: [
      'Do you require visa sponsorship?',
      'Will you require sponsorship for employment visa status?',
      'Do you now or in the future need H-1B sponsorship?',
      'Will you require immigration sponsorship to work?',
      'Sponsorship required',
      'Do you require sponsorship to work in the United States?',
    ],
    group: 'eligibility',
    category: 'sponsorship',
    control: 'radio',
    options: [...YN],
    hint: 'Answer for your situation; wording varies by employer but meaning is the same.',
  },
  {
    id: 'age_18',
    prompt: 'Are you at least 18 years of age?',
    aliases: [
      'Are you over 18?',
      'Are you 18 years of age or older?',
      'Can you provide proof that you are at least 18?',
    ],
    group: 'eligibility',
    category: 'date_of_birth',
    control: 'radio',
    options: [...YN],
  },
  {
    id: 'export_control',
    prompt: 'Are you a U.S. person as defined for export-control purposes?',
    aliases: [
      'Are you a U.S. person under ITAR/EAR?',
      'Export control — U.S. person status',
      'ITAR / EAR eligibility',
    ],
    group: 'eligibility',
    category: 'work_authorization',
    control: 'radio',
    options: [...YN, 'Prefer not to say'],
  },

  // —— Logistics ——
  {
    id: 'relocate',
    prompt: 'Are you willing to relocate for this role?',
    aliases: [
      'Would you be willing to relocate?',
      'Are you open to relocation?',
      'Willingness to relocate',
    ],
    group: 'work_logistics',
    category: 'relocation',
    control: 'radio',
    options: [...YN, 'Already in the area'],
  },
  {
    id: 'onsite_hybrid',
    prompt: 'Are you able to work on-site / hybrid as required?',
    aliases: [
      'Can you work onsite?',
      'Are you able to commute to the office?',
      'Willingness to work in office',
      'Can you work hybrid (e.g. 3 days on-site)?',
    ],
    group: 'work_logistics',
    category: 'relocation',
    control: 'radio',
    options: [...YN],
  },
  {
    id: 'travel',
    prompt: 'Are you willing to travel for this position?',
    aliases: ['Willingness to travel', 'Can you travel as needed?', 'Travel percentage acceptance'],
    group: 'work_logistics',
    category: 'relocation',
    control: 'radio',
    options: [...YN, 'Limited travel only'],
  },
  {
    id: 'remote_location',
    prompt: 'Where are you currently located? (city, state / country)',
    aliases: [
      'Current location',
      'Where are you based?',
      'City and state',
      'What is your current city of residence?',
    ],
    group: 'work_logistics',
    category: 'general',
    control: 'text',
  },

  // —— Compensation & timing ——
  {
    id: 'salary_expectation',
    prompt: 'What are your salary expectations?',
    aliases: [
      'Expected salary',
      'Desired compensation',
      'Compensation expectations',
      'What is your desired pay?',
      'Expected annual salary',
      'Desired hourly rate',
    ],
    group: 'compensation',
    category: 'salary',
    control: 'text',
    hint: 'Use the same format you would type on a form (e.g. 120000 or $120,000).',
  },
  {
    id: 'current_salary',
    prompt: 'What is your current or most recent compensation?',
    aliases: ['Current salary', 'Current annual salary', 'Most recent base salary'],
    group: 'compensation',
    category: 'salary',
    control: 'text',
  },
  {
    id: 'start_date',
    prompt: 'When can you start?',
    aliases: [
      'Available start date',
      'Earliest start date',
      'When are you available to start?',
      'What is your notice period?',
      'Notice period',
    ],
    group: 'compensation',
    category: 'general',
    control: 'text',
  },

  // —— Background ——
  {
    id: 'criminal',
    prompt: 'Have you ever been convicted of a felony?',
    aliases: [
      'Have you been convicted of a crime?',
      'Criminal background',
      'Conviction history',
      'Do you have a criminal record?',
    ],
    group: 'background',
    category: 'criminal_background',
    control: 'radio',
    options: [...YN],
    hint: 'Laws and phrasing vary by jurisdiction; answer truthfully for your situation.',
  },
  {
    id: 'background_check',
    prompt: 'Do you consent to a background check?',
    aliases: ['Background check consent', 'Are you willing to undergo a background check?'],
    group: 'background',
    category: 'criminal_background',
    control: 'radio',
    options: [...YN],
  },
  {
    id: 'clearance',
    prompt: 'Do you hold an active security clearance?',
    aliases: [
      'Security clearance',
      'Clearance level',
      'Do you have a security clearance?',
      'TS/SCI clearance',
    ],
    group: 'background',
    category: 'security_clearance',
    control: 'select',
    options: ['None', 'Confidential', 'Secret', 'Top Secret', 'TS/SCI', 'Public Trust', 'Prefer not to say'],
  },
  {
    id: 'previous_employee',
    prompt: 'Have you previously worked for this company?',
    aliases: [
      'Have you ever been employed by this company?',
      'Former employee?',
      'Previously employed here?',
      'Are you a current or former employee?',
    ],
    group: 'background',
    category: 'general',
    control: 'radio',
    options: [...YN],
  },
  {
    id: 'relative',
    prompt: 'Do you have relatives who work for this company?',
    aliases: [
      'Do any of your relatives work here?',
      'Family members employed by the company?',
      'Related to a current employee?',
    ],
    group: 'background',
    category: 'general',
    control: 'radio',
    options: [...YN],
  },

  // —— Experience ——
  {
    id: 'years_total',
    prompt: 'How many years of professional experience do you have?',
    aliases: [
      'Years of experience',
      'Total years of work experience',
      'How many years have you worked in this field?',
    ],
    group: 'experience',
    category: 'years_experience',
    control: 'text',
  },
  {
    id: 'years_relevant',
    prompt: 'How many years of relevant experience do you have for this role?',
    aliases: [
      'Years of relevant experience',
      'Relevant years of experience',
      'Experience related to this position',
    ],
    group: 'experience',
    category: 'years_experience',
    control: 'text',
  },
  {
    id: 'degree',
    prompt: 'What is your highest level of education?',
    aliases: ['Highest degree', 'Education level', 'Highest educational qualification'],
    group: 'experience',
    category: 'general',
    control: 'select',
    options: ['High school', 'Associate', "Bachelor's", "Master's", 'Doctorate / PhD', 'Other', 'Prefer not to say'],
  },
  {
    id: 'linkedin',
    prompt: 'LinkedIn profile URL',
    aliases: ['LinkedIn', 'LinkedIn URL', 'Link to your LinkedIn profile'],
    group: 'experience',
    category: 'general',
    control: 'text',
  },
  {
    id: 'portfolio',
    prompt: 'Portfolio, GitHub, or personal website',
    aliases: ['Portfolio URL', 'GitHub URL', 'Personal website', 'Website / portfolio'],
    group: 'experience',
    category: 'general',
    control: 'text',
  },
  {
    id: 'why_us',
    prompt: 'Why are you interested in this role / company?',
    aliases: [
      'Why do you want to work here?',
      'What interests you about this position?',
      'Why this company?',
      'Tell us why you are a good fit',
    ],
    group: 'experience',
    category: 'general',
    control: 'textarea',
  },

  // —— Source ——
  {
    id: 'hear_about',
    prompt: 'How did you hear about this job?',
    aliases: [
      'How did you hear about us?',
      'How did you find this position?',
      'Where did you hear about this opportunity?',
      'How did you learn about this role?',
      'Source of application',
      'How did you first hear about this job?',
    ],
    group: 'source',
    category: 'general',
    control: 'combobox',
    options: ['LinkedIn', 'Indeed', 'Dice', 'Company website', 'Referral', 'Recruiter', 'Job board', 'Other'],
    hint: 'Many forms use a dropdown or free-text combo box for this.',
  },
  {
    id: 'referral_name',
    prompt: 'If referred, who referred you?',
    aliases: ['Referral name', 'Referred by', 'Employee referral name', 'Who referred you?'],
    group: 'source',
    category: 'general',
    control: 'text',
  },

  // —— EEO ——
  {
    id: 'gender',
    prompt: 'Gender (voluntary)',
    aliases: ['Gender identity', 'What is your gender?', 'Sex', 'How would you describe your gender identity?'],
    group: 'eeo',
    category: 'demographic',
    control: 'select',
    options: ['Male', 'Female', 'Non-binary', 'Prefer to self-describe', 'Prefer not to say'],
  },
  {
    id: 'race',
    prompt: 'Race / ethnicity (voluntary)',
    aliases: [
      'Ethnicity',
      'Racial / ethnic background',
      'How would you describe your racial/ethnic background?',
      'Race / Ethnicity',
    ],
    group: 'eeo',
    category: 'demographic',
    control: 'select',
    options: [
      'American Indian or Alaska Native',
      'Asian',
      'Black or African American',
      'Hispanic or Latino',
      'Native Hawaiian or Other Pacific Islander',
      'White',
      'Two or more races',
      'Prefer not to say',
    ],
  },
  {
    id: 'veteran',
    prompt: 'Veteran status (voluntary)',
    aliases: [
      'Protected veteran status',
      'Are you a veteran?',
      'Military service status',
      'Are you a veteran or active member of the United States Armed Forces?',
    ],
    group: 'eeo',
    category: 'veteran',
    control: 'select',
    options: [
      'I am not a protected veteran',
      'I identify as a protected veteran',
      'I am a veteran but not a protected veteran',
      'Prefer not to say',
    ],
  },
  {
    id: 'disability',
    prompt: 'Disability status (voluntary)',
    aliases: [
      'Do you have a disability?',
      'Disability / accommodation',
      'Voluntary self-identification of disability',
    ],
    group: 'eeo',
    category: 'disability',
    control: 'select',
    options: ['Yes, I have a disability', 'No, I do not have a disability', 'Prefer not to say'],
  },
  {
    id: 'pronouns',
    prompt: 'Pronouns (optional)',
    aliases: ['Preferred pronouns', 'What are your pronouns?'],
    group: 'eeo',
    category: 'demographic',
    control: 'text',
    options: ['he/him', 'she/her', 'they/them', 'Prefer not to say'],
  },

  // —— Consent ——
  {
    id: 'privacy_consent',
    prompt: 'I agree to the privacy policy / data processing terms',
    aliases: ['Privacy consent', 'I consent to processing of my personal data', 'GDPR consent'],
    group: 'consent',
    category: 'legal_consent',
    control: 'checkbox',
    options: ['checked'],
    hint: 'Legal checkboxes are never auto-filled; saved here only as a reminder of your preference.',
  },
  {
    id: 'sms_consent',
    prompt: 'I consent to receiving SMS / text messages about my application',
    aliases: ['SMS consent', 'Text message consent', 'May we text you?'],
    group: 'consent',
    category: 'general',
    control: 'checkbox',
    options: ['checked'],
  },
  {
    id: 'truthful',
    prompt: 'I certify that the information provided is true and complete',
    aliases: [
      'I attest the information is accurate',
      'Certification of accuracy',
      'I agree the application is truthful',
    ],
    group: 'consent',
    category: 'legal_consent',
    control: 'checkbox',
    options: ['checked'],
    hint: 'Never auto-applied — you confirm this on every application.',
  },

  // —— Other ——
  {
    id: 'contact_employer',
    prompt: 'May we contact your current employer?',
    aliases: ['Can we contact your current employer?', 'Permission to contact current employer'],
    group: 'other',
    category: 'general',
    control: 'radio',
    options: [...YN],
  },
  {
    id: 'non_compete',
    prompt: 'Are you subject to a non-compete or restrictive covenant?',
    aliases: ['Non-compete agreement', 'Restrictive covenant', 'Do you have a non-compete?'],
    group: 'other',
    category: 'general',
    control: 'radio',
    options: [...YN],
  },
  {
    id: 'preferred_name',
    prompt: 'Preferred first name / name you go by',
    aliases: ['Preferred name', 'Name you prefer to go by', 'Chosen name'],
    group: 'other',
    category: 'general',
    control: 'text',
  },
];

export const SCREENING_CONTROL_LABELS: Record<ScreeningControl, string> = {
  text: 'Text input',
  textarea: 'Long text',
  select: 'Dropdown',
  combobox: 'Combo box',
  radio: 'Radio buttons',
  checkbox: 'Checkbox',
};

export function catalogById(id: string): ScreeningCatalogQuestion | undefined {
  return SCREENING_CATALOG.find((q) => q.id === id);
}

export function catalogGroups(): ScreeningCatalogGroup[] {
  return (Object.keys(SCREENING_GROUP_LABELS) as ScreeningCatalogGroup[]).filter((g) =>
    SCREENING_CATALOG.some((q) => q.group === g),
  );
}

/** Find a saved answer that already covers this catalog question. */
export function savedForCatalog(answers: ApprovedAnswer[], q: ScreeningCatalogQuestion): ApprovedAnswer | undefined {
  const byId = answers.find((a) => a.catalogId === q.id);
  if (byId) return byId;
  const needles = [q.prompt, ...q.aliases].map((s) => s.trim().toLowerCase()).filter(Boolean);
  return answers.find((a) => {
    if (a.category !== q.category) return false;
    const hay = [a.questionPattern, ...(a.aliases ?? [])].map((s) => s.trim().toLowerCase()).filter(Boolean);
    return needles.some((n) =>
      hay.some((h) => h === n || (h.length > 8 && n.length > 8 && (n.includes(h) || h.includes(n)))),
    );
  });
}
