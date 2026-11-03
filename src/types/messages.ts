import type { ExtractionResult, PageBlocker, PageState, SiteId } from './job';
import type { FillInstruction, FillResult, FormFieldDescriptor } from './fields';

export interface FilePayload {
  name: string;
  mime: string;
  base64: string;
}

/**
 * Typed message protocol. The content script never receives the API key or any
 * setting other than what it needs to act on the page.
 */
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
  /** `direct`: open the employer's posting from the page data instead of pressing the site's Apply button. */
  | { type: 'AF_OPEN_APPLICATION'; direct?: boolean }
  | { type: 'AF_ARM_SUBMIT'; token: string }
  /** `expectKey`: the application the run opened (formKeyFor); the page refuses if it shows another one. */
  | { type: 'AF_SUBMIT'; token: string; expectKey?: string | null }
  | { type: 'AF_SET_LAUNCHER'; visible: boolean }
  | { type: 'AF_DIAGNOSE' }
  /** Desktop: after a submit that reloaded the page, does the new page show Dice's confirmation? */
  | { type: 'AF_CHECK_SUCCESS' };

/** Where a document can be attached on the current step. */
export interface UploadTarget {
  /** 'input' = a file input exists; 'replace-menu' = Dice shows a saved file with a menu to replace it; 'dropzone' = drag-and-drop area only. */
  method: 'input' | 'replace-menu' | 'dropzone' | null;
  /** File name currently shown on Dice for this slot, if any. */
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
  /** "Step 1 of 2" when Dice shows it. */
  step: { current: number; total: number } | null;
  /** Validation messages Dice is showing ("This field is required"). */
  pageErrors: string[];
  error?: string;
  site?: SiteId | null;
  siteName?: string;
  /** ApplyFlow may press this site's Submit button (after you confirm). False on best-effort sites. */
  canSubmit?: boolean;
  /** The form reads the uploaded resume and fills fields itself (Lever, Ashby, Greenhouse). */
  parsesResume?: boolean;
  blocker?: PageBlocker | null;
}

export interface UploadResult {
  ok: boolean;
  method: UploadTarget['method'];
  /** True when the new file name is visible on the Dice page afterwards. */
  verified: boolean;
  /** Dice moved to another step while ApplyFlow was opening its menu (e.g. an edit button). */
  navigated?: boolean;
  fileName: string;
  message: string;
}

export interface NextStepResponse {
  ok: boolean;
  label: string | null;
  /** True when Dice moved to a different step (or a different page) after the click. */
  advanced: boolean;
  /** Validation messages Dice showed instead of advancing. */
  pageErrors: string[];
  message: string;
}

export interface SubmitResponse {
  ok: boolean;
  outcome: 'clicked' | 'confirmed' | 'refused';
  /** Present when the page showed a recognizable success message after submit. */
  successDetected: boolean;
  message: string;
  /** Submit was pressed but the site now needs the person (a CAPTCHA challenge): not applied yet. */
  needsUser?: boolean;
}

export interface OpenApplicationResponse {
  ok: boolean;
  external: boolean;
  message: string;
  /** The page is navigating to the application form (or the employer's site). */
  navigating?: boolean;
  blocker?: PageBlocker | null;
  /** For external applications: where the employer's form is. */
  externalUrl?: string | null;
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
  AF_ARM_SUBMIT: { ok: boolean };
  AF_SUBMIT: SubmitResponse;
  AF_SET_LAUNCHER: { ok: boolean };
  AF_DIAGNOSE: { ok: boolean; text: string };
  AF_CHECK_SUCCESS: { ok: boolean; success: boolean };
};

/** Broadcasts from the content script (runtime.sendMessage). */
export type ContentEvent =
  | { type: 'AF_PAGE_CHANGED'; state: PageState }
  | { type: 'AF_APPLICATION_SUBMITTED'; url: string }
  | { type: 'AF_OPEN_PANEL' };

/** Requests to the service worker. */
export type BackgroundRequest =
  | { type: 'AF_BG_OPEN_PANEL' }
  | { type: 'AF_BG_SET_REMINDER'; applicationId: string; whenIso: string; label: string }
  | { type: 'AF_BG_CLEAR_REMINDER'; applicationId: string };
