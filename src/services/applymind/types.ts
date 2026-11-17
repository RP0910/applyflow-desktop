/** ApplyMind records. Answer text and profile-fact values are not stored in these objects once they leave memory. */

export type AnswerStatus = 'verified' | 'accepted' | 'prediction';

export type QuestionType =
  | 'short_text'
  | 'long_form'
  | 'yes_no'
  | 'multiple_choice'
  | 'dropdown'
  | 'numeric'
  | 'experience'
  | 'technical'
  | 'availability_authorization'
  | 'salary';

export interface AnswerContext {
  platform: string | null;
  jobTitle: string | null;
  skills: string[];
  location: string | null;
  remote: string | null;
  seniority: string | null;
  employmentType: string | null;
  /** `general` means the answer was saved without a specific job. */
  scope: 'general' | 'job';
}

export interface Provenance {
  kind: 'user_entered' | 'profile_fact' | 'verified_answer' | 'autofill';
  sourceAnswerId: string | null;
  catalogId: string | null;
  factId: string | null;
}

export interface PlannedRecord {
  id: string;
  sourceAnswerId: string;
  deviceId: string;
  patternId: string;
  originalQuestion: string;
  normalizedQuestion: string;
  category: string;
  questionType: QuestionType;
  options: string[];
  answer: string;
  status: AnswerStatus;
  provenance: Provenance;
  context: AnswerContext;
  platform: string | null;
  answeredAt: string;
  confirmedAt: string;
  freshnessDays: number | null;
}

export interface PlannedProposal {
  id: string;
  factKey: string;
  kind: string;
  label: string;
  country: string | null;
  sourceAnswerId: string;
  question: string;
  value: string;
  freshnessDays: number | null;
}

export interface FactSkip {
  sourceAnswerId: string;
  catalogId: string | null;
  reason: 'context_dependent' | 'computed_from_dates' | 'job_specific' | 'legal_consent' | 'custom_wording' | 'ambiguous_catalog' | 'answer_not_in_options' | 'conflicting_values' | 'empty';
}

export interface MigrationPlan {
  records: PlannedRecord[];
  proposals: PlannedProposal[];
  skips: FactSkip[];
}

export interface TrainingRecord {
  id: string;
  patternId: string;
  category: string;
  questionType: string;
  normalized: string;
  original: string;
  answer: string;
}

export interface LearnedBundle {
  version: string;
  trainedAt: string;
  records: number;
  patterns: number;
  heldOutPatterns: number;
  heldOutWrong: number;
  classifier: {
    categories: string[];
    dim: number;
    weights: number[][];
    trainAccuracy: number;
    heldOutAccuracy: number | null;
  };
  reranker: {
    weights: number[];
    trainTop1: number;
    heldOutTop1: number | null;
  };
  calibrator: {
    a: number;
    b: number;
  };
  tierAUnlocked: boolean;
}

export interface ProposalView {
  id: string;
  factKey: string;
  kind: string;
  label: string;
  country: string | null;
  question: string;
  value: string;
  freshnessDays: number | null;
  sourceAnswerId: string;
}

export interface ApplyMindStatus {
  records: number;
  patterns: number;
  verified: number;
  proposedFacts: number;
  confirmedFacts: number;
  modelVersion: string | null;
  tierAUnlocked: boolean;
  trainedRecords: number;
  backupAt: string | null;
}
