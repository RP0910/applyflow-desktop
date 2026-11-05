export type RemoteStatus = 'remote' | 'hybrid' | 'onsite' | 'unknown';

export interface JobPosting {
  jobKey: string;
  platform: 'dice' | 'jobright';
  jobId: string | null;
  url: string;
  applicationUrl: string | null;
  title: string;
  company: string;
  location: string;
  remoteStatus: RemoteStatus;
  salary: string | null;
  employmentType: string | null;
  contractDuration: string | null;
  datePosted: string | null;
  description: string;
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  qualifications: string[];
  benefits: string[];
  educationRequirements: string[];
  clearanceRequirements: string[];
  workAuthorizationRequirements: string[];
  sponsorshipLanguage: string[];
  externalApply: boolean;
}

export type ExtractionSource = 'structured-data' | 'selectors' | 'heuristics' | 'user-edited';

export type FieldConfidence = 'high' | 'medium' | 'low' | 'missing';

export interface ExtractionResult {
  ok: boolean;
  job: JobPosting | null;
  confidence: Partial<Record<keyof JobPosting, FieldConfidence>>;
  sources: ExtractionSource[];
  uncertain: boolean;
  warnings: string[];
  failureReason?: string;
}

export type PageType = 'job-detail' | 'application' | 'search' | 'other' | 'unsupported';

export type SiteId = 'dice' | 'jobright' | 'greenhouse' | 'lever' | 'ashby' | 'jobvite' | 'generic';

export interface PageBlocker {
  kind: 'closed' | 'applied' | 'unsupported' | 'referral';
  message: string;
}

export interface PageState {
  tabId?: number;
  url: string;
  pageType: PageType;
  jobKey: string | null;
  title: string;
  hasApplicationForm: boolean;
  captchaDetected: boolean;
  loginRequired: boolean;
  step?: { current: number; total: number } | null;
  site?: SiteId | null;
  siteName?: string;
  blocker?: PageBlocker | null;
  pendingChoice?: string | null;
}
