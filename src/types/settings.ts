import type { CoverLetterTone, OutputFormat } from './documents';
import { DEFAULT_RESUME_FORMAT, type ResumeFormat } from './ats';

export type AiEngine = 'claude' | 'local';

export type ResumeGenerationMethod = 'api' | 'chat';

export type ApiVersion = '2026-10-21' | '2023-06-01';

export interface ModelOption {
  id: string;
  displayName: string;
  lifecycle: 'active' | 'deprecated' | 'retired' | 'unknown';
  source: 'api' | 'fallback' | 'manual';
}

export interface Settings {
  engine: AiEngine;
  resumeGenerationMethod: ResumeGenerationMethod;
  model: string;
  availableModels: ModelOption[];
  modelsRefreshedAt: string | null;
  apiVersion: ApiVersion;
  sendTemperature: boolean;
  temperature: number;
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
  saveDocumentsWhenReady: boolean;
  followUpDays: number;
  showPageLauncher: boolean;
  autoAdvanceSteps: boolean;
  autoFillSavedAnswers: boolean;
  includeCoverLetterByDefault: boolean;
  deepAnalysisWithClaude: boolean;
  atsRefinePass: boolean;
  resumeFormat: ResumeFormat;
  promptCache: '5m' | '1h' | 'off';
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
