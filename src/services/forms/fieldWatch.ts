/** Remembers the first scan of a step, filler writes, and trusted user edits. Does not store keystrokes. */

export interface WatchedField {
  fieldId: string;
  label: string;
  control: string;
  options: string[];
  sensitive: string | null;
  baseline: string;
  finalValue: string;
  fillerValue: string | null;
  touched: boolean;
}

export interface FieldWatch {
  stepKey: string;
  baseline: Map<string, string>;
  filler: Map<string, string>;
  touched: Map<string, string>;
  pending: { stepKey: string; fields: WatchedField[] } | null;
}

export function emptyWatch(): FieldWatch {
  return { stepKey: '', baseline: new Map(), filler: new Map(), touched: new Map(), pending: null };
}

export function noteBaseline(watch: FieldWatch, stepKey: string, fields: { fieldId: string; currentValue: string }[]): void {
  if (watch.stepKey === stepKey) return;
  watch.stepKey = stepKey;
  watch.baseline = new Map(fields.map((f) => [f.fieldId, f.currentValue]));
  watch.filler = new Map();
  watch.touched = new Map();
}

export function noteFiller(watch: FieldWatch, fieldId: string, value: string): void {
  watch.filler.set(fieldId, value);
}

/** Record the field's value after a user event. Untrusted events, including the filler's own events, are ignored. */
export function noteTrusted(watch: FieldWatch, fieldId: string, value: string, trusted: boolean): void {
  if (!trusted) return;
  watch.touched.set(fieldId, value);
}

export function snapshot(watch: FieldWatch, fields: { fieldId: string; label: string; control: string; options: string[]; sensitive: string | null; currentValue: string }[]): WatchedField[] {
  return fields.map((f) => ({
    fieldId: f.fieldId,
    label: f.label,
    control: f.control,
    options: f.options,
    sensitive: f.sensitive,
    baseline: watch.baseline.get(f.fieldId) ?? '',
    finalValue: f.currentValue,
    fillerValue: watch.filler.has(f.fieldId) ? watch.filler.get(f.fieldId)! : null,
    touched: watch.touched.has(f.fieldId),
  }));
}
