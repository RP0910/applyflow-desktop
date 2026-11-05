export interface ContactInfo {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  links: string[];
}

export interface ExperienceEntry {
  id: string;
  title: string;
  company: string;
  location: string;
  startDate: string;
  endDate: string;
  bullets: string[];
  technologies?: string[];
}

export interface EducationEntry {
  id: string;
  degree: string;
  institution: string;
  date: string;
  details: string[];
  location?: string;
}

export interface ProjectEntry {
  id: string;
  name: string;
  description: string;
  bullets: string[];
}

export interface ParsedResume {
  contact: ContactInfo;
  headline: string;
  summary: string;
  skills: string[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  certifications: string[];
  projects: ProjectEntry[];
  publications: string[];
  languages: string[];
  links: string[];
  unparsed: string[];
}

export type FactStatus = 'confirmed' | 'needs_review' | 'do_not_use';

export type FactKind = 'skill' | 'experience' | 'education' | 'certification' | 'project' | 'achievement' | 'other';

export interface VerifiedFact {
  id: string;
  kind: FactKind;
  text: string;
  status: FactStatus;
  source: 'resume' | 'profile' | 'user';
}

export interface BuilderJob {
  id: string;
  company: string;
  title: string;
  city: string;
  start: string;
  end: string;
  current: boolean;
  did: string;
  technologies: string;
}

export interface BuilderEducation {
  id: string;
  degree: string;
  field: string;
  school: string;
  city: string;
  start: string;
  end: string;
  details?: string;
}

export interface BuilderForm {
  headline: string;
  summary: string;
  skills: string;
  certifications: string;
  languages: string;
  jobs: BuilderJob[];
  education: BuilderEducation[];
}

export interface MasterResume {
  id: string;
  name: string;
  isDefault: boolean;
  rawText: string;
  parsed: ParsedResume;
  facts: VerifiedFact[];
  sourceFileName: string | null;
  sourceFormat: 'docx' | 'pdf' | 'text' | 'form';
  builder?: BuilderForm | null;
  parserVersion?: number;
  sourceData?: ArrayBuffer | null;
  createdAt: string;
  updatedAt: string;
}

export type SensitiveCategory =
  | 'sponsorship'
  | 'work_authorization'
  | 'security_clearance'
  | 'criminal_background'
  | 'disability'
  | 'veteran'
  | 'demographic'
  | 'salary'
  | 'relocation'
  | 'years_experience'
  | 'legal_consent'
  | 'date_of_birth';

export type ScreeningControl = 'text' | 'textarea' | 'select' | 'combobox' | 'radio' | 'checkbox';

export interface ApprovedAnswer {
  id: string;
  category: SensitiveCategory | 'general';
  questionPattern: string;
  answer: string;
  approvedAt: string;
  lastUsedAt?: string;
  useCount?: number;
  control?: ScreeningControl;
  options?: string[];
  aliases?: string[];
  catalogId?: string;
}

export interface CareerProfile {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  streetAddress: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  headline: string;
  professionalSummary: string;
  verifiedSkills: string[];
  workAuthorizationNote: string;
  preferredTitles: string[];
  preferredLocations: string[];
  remotePreference: 'remote' | 'hybrid' | 'onsite' | 'any';
  salaryPreference: string;
  availability: string;
  portfolioLinks: string[];
  linkedinUrl: string;
  githubUrl: string;
  approvedAnswers: ApprovedAnswer[];
  updatedAt: string;
}
