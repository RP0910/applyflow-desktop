import type { ExtractionResult, JobPosting } from './job';
import type { JobAnalysis, MatchScore, SkillEvidence } from './analysis';
import type { CoverLetter, TailoredResume } from './documents';
import type { FieldProposal } from './fields';
import type { AtsPlan, AtsReport, ParseCheck } from './ats';

export type WorkflowStep =
  | 'detect'
  | 'analyze'
  | 'tailor'
  | 'review'
  | 'prepare'
  | 'confirm'
  | 'submitted';

/** Everything ApplyFlow knows about one job, persisted so a multi-page Dice application can resume where it left off. */
export interface JobSession {
  jobKey: string;
  job: JobPosting;
  extraction: Pick<ExtractionResult, 'confidence' | 'sources' | 'uncertain' | 'warnings'>;
  /** User acknowledged the extracted details are correct (or edited them). */
  jobConfirmed: boolean;
  resumeId: string | null;
  analysis: JobAnalysis | null;
  evidence: SkillEvidence[];
  masterScore: MatchScore | null;
  tailoredScore: MatchScore | null;
  resume: TailoredResume | null;
  coverLetter: CoverLetter | null;
  /** ATS engine: job keywords and plan, and scans of the master and tailored resumes. */
  atsPlan?: AtsPlan | null;
  atsMaster?: AtsReport | null;
  atsTailored?: AtsReport | null;
  /** What an ATS-style reader recovered from the exported PDF. */
  atsParse?: ParseCheck | null;
  /** masterStamp() of the master resume the tailored documents were written from. */
  documentsFrom?: string;
  /** Documents already saved to Downloads (resume/cover-letter versions and folder). */
  savedDocs?: { stamp: string; folder: string } | null;
  resumeReviewed: boolean;
  coverLetterReviewed: boolean;
  includeCoverLetter: boolean;
  fieldProposals: FieldProposal[];
  lastScanUrl: string | null;
  duplicateAcknowledged: boolean;
  applicationId: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProgressPhase =
  | 'idle'
  | 'detecting'
  | 'extracting'
  | 'analyzing'
  | 'comparing'
  | 'researching_companies'
  | 'generating_resume'
  | 'generating_cover_letter'
  | 'validating'
  | 'filling'
  | 'waiting_confirmation'
  | 'submitting'
  | 'saving'
  | 'downloading';

export const PROGRESS_LABELS: Record<ProgressPhase, string> = {
  idle: 'Ready',
  detecting: 'Detecting job',
  extracting: 'Extracting description',
  analyzing: 'Analyzing requirements',
  comparing: 'Comparing resume',
  researching_companies: 'Researching companies',
  generating_resume: 'Generating resume',
  generating_cover_letter: 'Generating cover letter',
  validating: 'Validating application',
  filling: 'Filling safe fields',
  waiting_confirmation: 'Waiting for confirmation',
  submitting: 'Submitting on Dice',
  saving: 'Saving application',
  downloading: 'Downloading files',
};
