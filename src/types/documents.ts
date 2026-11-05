import type { ContactInfo, EducationEntry } from './resume';

export interface TailoredExperience {
  sourceId: string;
  title: string;
  company: string;
  location: string;
  startDate: string;
  endDate: string;
  bullets: string[];
  technologies?: string[];
}

export interface SkillGroup {
  name: string;
  skills: string[];
}

export interface TailoredProject {
  name: string;
  description: string;
  bullets: string[];
}

export interface ChangeNote {
  section: string;
  before: string;
  after: string;
  reason: string;
}

export interface ValidationIssue {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  code:
    | 'invented_employer'
    | 'invented_title'
    | 'changed_dates'
    | 'invented_education'
    | 'invented_certification'
    | 'invented_metric'
    | 'unsupported_skill'
    | 'copied_job_text'
    | 'hidden_gap'
    | 'location_mismatch'
    | 'restricted_fact'
    | 'length'
    | 'ai_cliche'
    | 'format'
    | 'years_claim'
    | 'moved_skill';
  message: string;
  excerpt?: string;
  autoFixable: boolean;
}

export interface TailoredResume {
  contentSource?: "cv-generate";
  sourceJson?: string;
  version: number;
  contact: ContactInfo;
  headline: string;
  summary: string;
  skills: string[];
  skillGroups?: SkillGroup[];
  experience: TailoredExperience[];
  projects: TailoredProject[];
  education: EducationEntry[];
  certifications: string[];
  additional: string[];
  changes: ChangeNote[];
  issues: ValidationIssue[];
  engine: 'local' | 'claude';
  model: string | null;
  generatedAt: string;
  editedByUser: boolean;
}

export type CoverLetterTone = 'professional' | 'warm' | 'direct' | 'technical' | 'startup';

export type CoverLetterAction = 'regenerate' | 'shorter' | 'more_natural' | 'more_technical';

export interface CoverLetter {
  version: number;
  tone: CoverLetterTone;
  text: string;
  wordCount: number;
  issues: ValidationIssue[];
  engine: 'local' | 'claude';
  model: string | null;
  generatedAt: string;
  editedByUser: boolean;
}

export type OutputFormat = 'docx' | 'pdf' | 'txt' | 'md';
