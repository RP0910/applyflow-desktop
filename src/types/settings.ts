import type { CoverLetterTone, OutputFormat } from './documents';
import { DEFAULT_RESUME_FORMAT, type ResumeFormat } from './ats';

export type AiEngine = 'claude' | 'local';

/** Claude API uses api.anthropic.com. Claude.ai Chat reuses a signed-in claude.ai session. */
export type ResumeGenerationMethod = 'api' | 'chat';

export type ApiVersion = '2026-10-21' | '2023-06-01';

export interface ModelOption {
  id: string;
  displayName: string;
  lifecycle: 'active' | 'deprecated' | 'retired' | 'unknown';
  source: 'api' | 'fallback' | 'manual';
}

/** Non-secret settings. The API key is stored separately and never part of this object. */
export interface Settings {
  engine: AiEngine;
  /** Which Claude connection writes resume JSON. The PDF path after that is the same either way. */
  resumeGenerationMethod: ResumeGenerationMethod;
  model: string;
  availableModels: ModelOption[];
  modelsRefreshedAt: string | null;
  apiVersion: ApiVersion;
  /** Only sent when explicitly enabled AND apiVersion is 2023-06-01 (removed in 2026-10-21). */
  sendTemperature: boolean;
  temperature: number;
  /** Claude effort: lower is faster and uses fewer thinking tokens. */
  effort: 'low' | 'medium' | 'high' | 'model_default';
  maxOutputTokens: number;
  requestTimeoutSeconds: number;
  resumeOutputFormats: OutputFormat[];
  defaultResumeLength: 'one_page' | 'two_pages' | 'flexible';
  defaultCoverLetterTone: CoverLetterTone;
  sendFullJobDescription: boolean;
  saveJobDescriptionsLocally: boolean;
  downloadRootFolder: string;
  fileNameFormat: string;
  createFolderPerApplication: boolean;
  includeCompanyInPath: boolean;
  includeJobTitleInPath: boolean;
  saveJobDescriptionFile: boolean;
  saveMetadataFile: boolean;
  autoDownloadOnSubmit: boolean;
  /** Save the tailored resume and cover letter to Downloads as soon as they're written (before attaching them). */
  saveDocumentsWhenReady: boolean;
  followUpDays: number;
  showPageLauncher: boolean;
  /** Quick Apply: press Dice's Next button automatically when a step is complete. */
  autoAdvanceSteps: boolean;
  /** Fill questions with answers you saved earlier (you approved each one). */
  autoFillSavedAnswers: boolean;
  includeCoverLetterByDefault: boolean;
  /** Also ask Claude to analyze the job (slower; the local analysis always runs). */
  deepAnalysisWithClaude: boolean;
  /** ATS engine: a second Claude pass that fixes what the ATS scan finds in the first draft. */
  atsRefinePass: boolean;
  /** Font, size and layout of the resume PDF/DOCX. */
  resumeFormat: ResumeFormat;
  /** Desktop: prompt-cache lifetime for the rules + your facts (cached reads cost a fraction of normal input). */
  promptCache: '5m' | '1h' | 'off';
  /** Desktop: the folder that holds the ApplyFlow documents folder. Empty = Documents. */
  saveLocation: string;
}

export const FALLBACK_MODELS: ModelOption[] = [
  { id: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', lifecycle: 'unknown', source: 'fallback' },
  { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5', lifecycle: 'unknown', source: 'fallback' },
  { id: 'claude-haiku-5-5', displayName: 'Claude Haiku 5.5', lifecycle: 'unknown', source: 'fallback' },
];

export const DEFAULT_SETTINGS: Settings = {
  engine: 'claude',
  resumeGenerationMethod: 'api',
  model: 'claude-sonnet-5-5',
  availableModels: FALLBACK_MODELS,
  modelsRefreshedAt: null,
  apiVersion: '2026-10-21',
  sendTemperature: false,
  temperature: 0.3,
  effort: 'low',
  maxOutputTokens: 16000,
  requestTimeoutSeconds: 120,
  resumeOutputFormats: ['pdf', 'docx'],
  defaultResumeLength: 'two_pages',
  defaultCoverLetterTone: 'professional',
  sendFullJobDescription: true,
  saveJobDescriptionsLocally: true,
  downloadRootFolder: 'ApplyFlow',
  fileNameFormat: '{date}_{title}',
  createFolderPerApplication: true,
  includeCompanyInPath: true,
  includeJobTitleInPath: true,
  saveJobDescriptionFile: true,
  saveMetadataFile: true,
  autoDownloadOnSubmit: true,
  saveDocumentsWhenReady: true,
  followUpDays: 7,
  showPageLauncher: true,
  autoAdvanceSteps: true,
  autoFillSavedAnswers: true,
  includeCoverLetterByDefault: true,
  deepAnalysisWithClaude: false,
  atsRefinePass: false,
  resumeFormat: DEFAULT_RESUME_FORMAT,
  promptCache: '5m',
  saveLocation: '',
};
