import type { SensitiveCategory } from './resume';

/** 'combobox' = a dropdown that is really a text box with a list (react-select, Ashby, autocompletes). */
export type FieldControl = 'text' | 'email' | 'tel' | 'url' | 'number' | 'textarea' | 'select' | 'combobox' | 'radio' | 'checkbox' | 'file' | 'date' | 'other';

/** A form control discovered on the application page. Serializable: crosses the content-script boundary. */
export interface FormFieldDescriptor {
  /** Value of the data-applyflow-field attribute the content script assigned. */
  fieldId: string;
  label: string;
  /** Extra nearby text (help text, legend) used for matching. */
  context: string;
  control: FieldControl;
  name: string;
  required: boolean;
  options: string[];
  currentValue: string;
  accept: string;
  sensitive: SensitiveCategory | null;
}

export type FieldSemantic =
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'email'
  | 'phone'
  | 'location'
  | 'city'
  | 'linkedin'
  | 'github'
  | 'portfolio'
  | 'website'
  | 'summary'
  | 'skills'
  | 'headline'
  | 'resume_upload'
  | 'cover_letter_upload'
  | 'cover_letter_text'
  | 'country'
  | 'unknown';

/** fill = safe value; answer = your saved answer (choices too); upload = document; manual = you answer. */
export type FieldAction = 'fill' | 'answer' | 'upload' | 'manual' | 'skip';

export interface FieldProposal {
  fieldId: string;
  label: string;
  control: FieldControl;
  semantic: FieldSemantic;
  action: FieldAction;
  proposedValue: string;
  /** Human-readable origin, e.g. "Career profile → Email". */
  source: string;
  confidence: 'high' | 'medium' | 'low';
  required: boolean;
  sensitive: SensitiveCategory | null;
  /** Why the field needs manual input, when action = manual. */
  reason: string;
  /** Saved answer the user approved earlier; applied only on an explicit click. */
  approvedSuggestion: string | null;
  status: 'pending' | 'filled' | 'failed' | 'user-completed' | 'skipped';
  error?: string;
  /** URL of the Dice step where the field was found (multi-step applications). */
  stepUrl?: string;
  /** Choices for radio/select questions, so the panel can offer one-tap answers. */
  options?: string[];
}

export interface FillInstruction {
  fieldId: string;
  kind: 'value' | 'file';
  value?: string;
  /** After typing, pick the site's matching suggestion (location and city autocompletes). */
  suggest?: boolean;
  file?: { name: string; mime: string; base64: string };
}

export interface FillResult {
  fieldId: string;
  ok: boolean;
  error?: string;
  finalValue?: string;
}
