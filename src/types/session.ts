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

export interface JobSession {
  jobKey: string;
  job: JobPosting;
  extraction: Pick<ExtractionResult, 'confidence' | 'sources' | 'uncertain' | 'warnings'>;
  jobConfirmed: boolean;
  resumeId: string | null;
  analysis: JobAnalysis | null;
  evidence: SkillEvidence[];
  masterScore: MatchScore | null;
  tailoredScore: MatchScore | null;
  resume: TailoredResume | null;
  coverLetter: CoverLetter | null;
  atsPlan?: AtsPlan | null;
  atsMaster?: AtsReport | null;
  atsTailored?: AtsReport | null;
  atsParse?: ParseCheck | null;
  documentsFrom?: string;
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
