/**
 * ATS (applicant tracking system) engine types. ApplyFlow simulates how keyword-based ATS
 * filters read a resume against a job: exact keywords, job title, structure, dates and format.
 */

export type KeywordKind = 'title' | 'hard' | 'domain' | 'soft' | 'education' | 'certification';

export interface AtsKeyword {
  /** How the job writes it ("Kubernetes", "HLS", "Senior Video Playback Engineer"). */
  term: string;
  /** Every spelling that counts as the same keyword (the term itself, synonyms, acronym ↔ expansion). */
  forms: string[];
  kind: KeywordKind;
  importance: 'required' | 'preferred' | 'mentioned';
  /** Relative importance used by the score (title 6 … soft skill 0.5). */
  weight: number;
  /** How many times the job posting uses it. */
  jobCount: number;
}

/** Whether the candidate's master resume (or confirmed skills) backs a keyword. */
export type KeywordSupport = 'supported' | 'related' | 'missing';

export interface KeywordEvidence {
  /** ExperienceEntry.id when the evidence is inside a job. */
  sourceId: string | null;
  where: 'experience' | 'technologies' | 'skills' | 'summary' | 'headline' | 'education' | 'certifications' | 'profile' | 'title';
  text: string;
}

export interface SupportedKeyword extends AtsKeyword {
  support: KeywordSupport;
  evidence: KeywordEvidence[];
  /** Where the tailored resume should use it. */
  placements: string[];
  /** For 'related': the nearby skill the resume does show. */
  relatedTo?: string;
}

export interface AtsPlan {
  targetTitle: string;
  titleSource: 'job' | 'resume';
  /** Whole years covered by the jobs in the master resume (overlaps counted once). */
  years: number;
  pageTarget: 'one_page' | 'two_pages' | 'flexible';
  /** Bullets to write for each job, keyed by ExperienceEntry.id. */
  bulletBudget: Record<string, number>;
  keywords: SupportedKeyword[];
  requiredYears: number | null;
}

export type AtsCategoryKey = 'keywords' | 'title' | 'experience' | 'sections' | 'writing' | 'soft_education' | 'format';

export interface AtsCategory {
  key: AtsCategoryKey;
  label: string;
  score: number;
  max: number;
  /** false when this category can't be judged for this document (e.g. the format of your original file). */
  applicable: boolean;
  detail: string;
}

export interface AtsCheck {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  label: string;
  detail?: string;
}

export interface KeywordResult {
  term: string;
  kind: KeywordKind;
  importance: AtsKeyword['importance'];
  weight: number;
  support: KeywordSupport;
  /** 'exact' = the job's own words; 'synonym' = another accepted spelling. */
  found: 'exact' | 'synonym' | 'missing';
  count: number;
  inExperience: boolean;
  inSkills: boolean;
  inSummary: boolean;
}

export interface AtsReport {
  /** 0–100 over the categories that apply. */
  score: number;
  /** The best score this candidate can reach truthfully (every supported keyword used well). */
  reachable: number;
  band: 'excellent' | 'good' | 'fair' | 'low';
  categories: AtsCategory[];
  keywords: KeywordResult[];
  checks: AtsCheck[];
  computedFor: 'master' | 'tailored';
  disclaimer: string;
  computedAt: string;
}

/** What an ATS-style reader recovered from the exported PDF. */
export interface ParseCheck {
  ok: boolean;
  jobsExpected: number;
  jobsFound: number;
  name: boolean;
  email: boolean;
  phone: boolean;
  sections: string[];
  /** Share of the resume's words that came out of the PDF intact (1 = all). */
  textIntegrity: number;
  problems: string[];
  checkedAt: string;
}

/** Resume layout used for the PDF and DOCX files. */
export interface ResumeFormat {
  font: 'calibri' | 'arial' | 'helvetica' | 'times' | 'cambria';
  bodySize: number;
  dateStyle: 'mon_yyyy' | 'mm_yyyy' | 'as_written';
  /** "Technologies: …" line under each job. */
  showJobTechnologies: boolean;
  margins: 'narrow' | 'normal';
  /** Look of the PDF — all three stay one-column, real text and ATS-safe. */
  template?: 'classic' | 'modern' | 'compact';
  /** Accent color for the "modern" template (#RRGGBB). */
  accentColor?: string;
}

export const DEFAULT_RESUME_FORMAT: ResumeFormat = {
  font: 'arial',
  bodySize: 10.5,
  dateStyle: 'mon_yyyy',
  showJobTechnologies: true,
  margins: 'normal',
  template: 'classic',
  accentColor: '#007595',
};
