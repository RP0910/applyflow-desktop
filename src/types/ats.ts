
export type KeywordKind = 'title' | 'hard' | 'domain' | 'soft' | 'education' | 'certification';

export interface AtsKeyword {
  term: string;
  forms: string[];
  kind: KeywordKind;
  importance: 'required' | 'preferred' | 'mentioned';
  weight: number;
  jobCount: number;
}

export type KeywordSupport = 'supported' | 'related' | 'missing';

export interface KeywordEvidence {
  sourceId: string | null;
  where: 'experience' | 'technologies' | 'skills' | 'summary' | 'headline' | 'education' | 'certifications' | 'profile' | 'title';
  text: string;
}

export interface SupportedKeyword extends AtsKeyword {
  support: KeywordSupport;
  evidence: KeywordEvidence[];
  placements: string[];
  relatedTo?: string;
}

export interface AtsPlan {
  targetTitle: string;
  titleSource: 'job' | 'resume';
  years: number;
  pageTarget: 'one_page' | 'two_pages' | 'flexible';
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
  found: 'exact' | 'synonym' | 'missing';
  count: number;
  inExperience: boolean;
  inSkills: boolean;
  inSummary: boolean;
}

export interface AtsReport {
  score: number;
  reachable: number;
  band: 'excellent' | 'good' | 'fair' | 'low';
  categories: AtsCategory[];
  keywords: KeywordResult[];
  checks: AtsCheck[];
  computedFor: 'master' | 'tailored';
  disclaimer: string;
  computedAt: string;
}

export interface ParseCheck {
  ok: boolean;
  jobsExpected: number;
  jobsFound: number;
  name: boolean;
  email: boolean;
  phone: boolean;
  sections: string[];
  textIntegrity: number;
  problems: string[];
  checkedAt: string;
}

export interface ResumeFormat {
  font: 'calibri' | 'arial' | 'helvetica' | 'times' | 'cambria';
  bodySize: number;
  dateStyle: 'mon_yyyy' | 'mm_yyyy' | 'as_written';
  showJobTechnologies: boolean;
  margins: 'narrow' | 'normal';
  template?: 'classic' | 'modern' | 'compact';
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
