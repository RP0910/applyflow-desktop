export type EvidenceStatus = 'strong' | 'partial' | 'none' | 'conflict' | 'needs_confirmation';

export interface SkillEvidence {
  skill: string;
  importance: 'required' | 'preferred';
  status: EvidenceStatus;
  /** Verbatim snippets from the master resume that support the skill. */
  evidence: string[];
  /** Plain-language reason for the classification. */
  note: string;
  /** How a 'partial' was reached. 'related' and 'claude' never allow naming the skill itself. */
  via?: 'listed' | 'profile' | 'related' | 'claude';
}

export interface RiskWarning {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category:
    | 'clearance'
    | 'work_authorization'
    | 'sponsorship'
    | 'education'
    | 'experience'
    | 'location'
    | 'skills'
    | 'duplicate'
    | 'extraction'
    | 'other';
  message: string;
}

export interface JobAnalysis {
  category: string;
  seniority: 'entry' | 'mid' | 'senior' | 'staff' | 'principal' | 'lead' | 'manager' | 'director' | 'executive' | 'unknown';
  requiredSkills: string[];
  preferredSkills: string[];
  tools: string[];
  responsibilities: string[];
  industryTerms: string[];
  softSkills: string[];
  expectedOutcomes: string[];
  screeningQuestions: string[];
  resumeKeywords: string[];
  requiredYears: number | null;
  missingQualifications: string[];
  risks: RiskWarning[];
  suggestedResumeTitle: string;
  summaryDirection: string;
  engine: 'local' | 'claude';
  model: string | null;
  analyzedAt: string;
}

export interface ScoreComponent {
  key: 'required_skills' | 'relevant_experience' | 'title_alignment' | 'ats_structure' | 'evidence_quality' | 'missing_requirements' | 'unsupported_claims';
  label: string;
  score: number;
  max: number;
  /** Negative components have max 0 and score <= 0. */
  isPenalty: boolean;
  explanation: string;
}

export interface MatchScore {
  total: number;
  components: ScoreComponent[];
  /** Always shown next to the number in the UI. */
  disclaimer: string;
  band: 'strong' | 'good' | 'fair' | 'weak';
  computedFor: 'master' | 'tailored';
  computedAt: string;
}
