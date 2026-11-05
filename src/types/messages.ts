import type { ExtractionResult, PageBlocker, PageState, SiteId } from './job';
import type { FillInstruction, FillResult, FormFieldDescriptor } from './fields';
import type { LoginAction } from '@/services/forms/siteLogin';

export interface FilePayload {
  name: string;
  mime: string;
  base64: string;
}

export type PanelToContent =
  | { type: 'AF_PING' }
  | { type: 'AF_GET_PAGE_STATE' }
  | { type: 'AF_EXTRACT_JOB' }
  | { type: 'AF_SCAN_FIELDS' }
  | { type: 'AF_FILL_FIELDS'; instructions: FillInstruction[] }
  | { type: 'AF_ANSWER_FIELD'; fieldId: string; value: string }
  | { type: 'AF_UPLOAD_DOCUMENT'; kind: 'resume' | 'cover_letter'; file: FilePayload }
  | { type: 'AF_NEXT_STEP' }
  | { type: 'AF_HIGHLIGHT_FIELD'; fieldId: string }
  | { type: 'AF_OPEN_APPLICATION'; direct?: boolean }
  | { type: 'AF_SIGN_IN'; email: string; password: string; firstName?: string; lastName?: string; after?: LoginAction | null; allowCreate?: boolean }
  | { type: 'AF_ARM_SUBMIT'; token: string }
  | { type: 'AF_SUBMIT'; token: string; expectKey?: string | null }
  | { type: 'AF_SET_LAUNCHER'; visible: boolean }
  | { type: 'AF_DIAGNOSE' }
  | { type: 'AF_CHECK_SUCCESS' }
  | { type: 'AF_CONFIRM_JOBRIGHT_APPLIED' };

export interface UploadTarget {
  method: 'input' | 'replace-menu' | 'dropzone' | null;
  currentFileName: string | null;
}

export interface ScanResponse {
  ok: boolean;
  fields: FormFieldDescriptor[];
  pageUrl: string;
  formFound: boolean;
  captchaDetected: boolean;
  loginRequired: boolean;
  submitControlFound: boolean;
  submitControlLabel: string | null;
  nextControlLabel: string | null;
  uploads: { resume: UploadTarget; coverLetter: UploadTarget };
  step: { current: number; total: number } | null;
  pageErrors: string[];
  error?: string;
  site?: SiteId | null;
  siteName?: string;
  canSubmit?: boolean;
  parsesResume?: boolean;
  blocker?: PageBlocker | null;
}

export interface UploadResult {
  ok: boolean;
  method: UploadTarget['method'];
  verified: boolean;
  navigated?: boolean;
  fileName: string;
  message: string;
}

export interface NextStepResponse {
  ok: boolean;
  label: string | null;
  advanced: boolean;
  pageErrors: string[];
  message: string;
}

export interface SubmitResponse {
  ok: boolean;
  outcome: 'clicked' | 'confirmed' | 'refused';
  successDetected: boolean;
  message: string;
  needsUser?: boolean;
}

export interface OpenApplicationResponse {
  ok: boolean;
  external: boolean;
  message: string;
  navigating?: boolean;
  blocker?: PageBlocker | null;
  externalUrl?: string | null;
}

export interface SignInResponse {
  ok: boolean;
  submitted: boolean;
  message: string;
  action?: LoginAction;
}

export type ContentResponseMap = {
  AF_PING: { ok: true; version: string };
  AF_GET_PAGE_STATE: PageState;
  AF_EXTRACT_JOB: ExtractionResult;
  AF_SCAN_FIELDS: ScanResponse;
  AF_FILL_FIELDS: { ok: boolean; results: FillResult[] };
  AF_ANSWER_FIELD: FillResult;
  AF_UPLOAD_DOCUMENT: UploadResult;
  AF_NEXT_STEP: NextStepResponse;
  AF_HIGHLIGHT_FIELD: { ok: boolean };
  AF_OPEN_APPLICATION: OpenApplicationResponse;
  AF_SIGN_IN: SignInResponse;
  AF_ARM_SUBMIT: { ok: boolean };
  AF_SUBMIT: SubmitResponse;
  AF_SET_LAUNCHER: { ok: boolean };
  AF_DIAGNOSE: { ok: boolean; text: string };
  AF_CHECK_SUCCESS: { ok: boolean; success: boolean };
  AF_CONFIRM_JOBRIGHT_APPLIED: { ok: boolean; clicked: boolean; message: string };
};

export type ContentEvent =
  | { type: 'AF_PAGE_CHANGED'; state: PageState }
  | { type: 'AF_APPLICATION_SUBMITTED'; url: string }
  | { type: 'AF_OPEN_PANEL' };

export type BackgroundRequest =
  | { type: 'AF_BG_OPEN_PANEL' }
  | { type: 'AF_BG_SET_REMINDER'; applicationId: string; whenIso: string; label: string }
  | { type: 'AF_BG_CLEAR_REMINDER'; applicationId: string };
