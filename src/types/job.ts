/** A job posting as extracted from a job board page. All fields are what the page said — never inferred facts about the user. */
export type RemoteStatus = 'remote' | 'hybrid' | 'onsite' | 'unknown';

export interface JobPosting {
  /** Stable key used for duplicate detection, e.g. "dice:7f3c…". */
  jobKey: string;
  /** Where the job was found (the application itself may happen on the employer's own site). */
  platform: 'dice' | 'jobright';
  /** Platform job identifier when one is present in the URL or structured data. */
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
  /** True when the posting says applications happen on an external company site. */
  externalApply: boolean;
}

export type ExtractionSource = 'structured-data' | 'selectors' | 'heuristics' | 'user-edited';

export type FieldConfidence = 'high' | 'medium' | 'low' | 'missing';

export interface ExtractionResult {
  ok: boolean;
  job: JobPosting | null;
  /** Per-field confidence so the UI can show exactly what needs review. */
  confidence: Partial<Record<keyof JobPosting, FieldConfidence>>;
  sources: ExtractionSource[];
  /** True if any key field is low/missing — triggers the "could not be verified" banner. */
  uncertain: boolean;
  warnings: string[];
  /** When ok=false, a safe, user-facing reason. */
  failureReason?: string;
}

export type PageType = 'job-detail' | 'application' | 'search' | 'other' | 'unsupported';

/** Which site's support is active on a page. */
export type SiteId = 'dice' | 'jobright' | 'greenhouse' | 'lever' | 'ashby' | 'jobvite' | 'generic';

/** Why ApplyFlow can't (or shouldn't) apply on this page. */
export interface PageBlocker {
  /**
   * closed       the employer no longer accepts applications for this job
   * applied      the site says you already applied
   * unsupported  a site ApplyFlow must not or cannot fill (LinkedIn, Indeed, account-only portals…)
   * referral     a Jobright referral ("Send My Profile") role with no employer application
   */
  kind: 'closed' | 'applied' | 'unsupported' | 'referral';
  message: string;
}

export interface PageState {
  tabId?: number;
  url: string;
  pageType: PageType;
  jobKey: string | null;
  title: string;
  /** Set when an application form appears to be on screen. */
  hasApplicationForm: boolean;
  captchaDetected: boolean;
  loginRequired: boolean;
  /** "Step 1 of 2" on Dice's application wizard. */
  step?: { current: number; total: number } | null;
  /** Which site support handles this page (Dice, Jobright, Greenhouse, Lever, Ashby, or best-effort). */
  site?: SiteId | null;
  /** Display name: "Dice", "Jobright", "Greenhouse"… or the employer site's host. */
  siteName?: string;
  blocker?: PageBlocker | null;
  /** A question the site asked in a dialog on the way to the application, with the choice ApplyFlow will press (Jobright). */
  pendingChoice?: string | null;
}
