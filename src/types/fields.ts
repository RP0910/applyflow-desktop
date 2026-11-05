import type { SensitiveCategory } from './resume';

export type FieldControl = 'text' | 'email' | 'tel' | 'url' | 'number' | 'textarea' | 'select' | 'combobox' | 'radio' | 'checkbox' | 'file' | 'date' | 'other';

export interface FormFieldDescriptor {
  fieldId: string;
  label: string;
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
  | 'street'
  | 'address_line2'
  | 'city'
  | 'state'
  | 'postal_code'
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

export type FieldAction = 'fill' | 'answer' | 'upload' | 'manual' | 'skip';

export interface FieldProposal {
  fieldId: string;
  label: string;
  control: FieldControl;
  semantic: FieldSemantic;
  action: FieldAction;
  proposedValue: string;
  source: string;
  confidence: 'high' | 'medium' | 'low';
  required: boolean;
  sensitive: SensitiveCategory | null;
  reason: string;
  approvedSuggestion: string | null;
  status: 'pending' | 'filled' | 'failed' | 'user-completed' | 'skipped';
  error?: string;
  stepUrl?: string;
  options?: string[];
}

export interface FillInstruction {
  fieldId: string;
  kind: 'value' | 'file';
  value?: string;
  suggest?: boolean;
  file?: { name: string; mime: string; base64: string };
}

export interface FillResult {
  fieldId: string;
  ok: boolean;
  error?: string;
  finalValue?: string;
}
