/**
 * DOM side of form assistance (runs in the content script).
 * Scans visible controls, labels them, and fills only what the panel explicitly sends.
 */
import type { FieldControl, FillInstruction, FillResult, FormFieldDescriptor } from '@/types';
import { classifyFieldSensitivity } from './sensitive';
import { isPageChrome, isVisible } from '@/services/platforms/dom';

export const FIELD_ATTR = 'data-applyflow-field';
let counter = 0;

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

// File inputs are handled by the upload engine (forms/upload.ts), not as form fields.
const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'password', 'search', 'file']);

function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** A text box that is really a dropdown (react-select on Greenhouse, Ashby's pickers, autocompletes). */
export function isCombobox(el: Element): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  return el.getAttribute('role') === 'combobox' || /^(list|both)$/.test(el.getAttribute('aria-autocomplete') ?? '') || /(^|\s)select__input|react-select/.test(`${el.className} ${el.id}`);
}

/** The control box around a combobox input (react-select's "control", or a few levels up). */
function comboboxBox(el: Element): Element {
  const up = el.parentElement;
  return up?.closest('[class*="control" i]') ?? up?.closest('[class*="select" i], [role="group"]') ?? up?.parentElement ?? el;
}

/** What a combobox shows as chosen (react-select keeps it next to the input, not in it). */
export function comboboxValue(el: HTMLInputElement): string {
  const box = comboboxBox(el);
  const chosen = Array.from(box.querySelectorAll('[class*="single-value" i], [class*="singleValue" i], [class*="multi-value__label" i], [class*="multiValue" i] [class*="label" i]'))
    .map((n) => textOf(n))
    .filter(Boolean);
  return chosen.length ? chosen.join(', ') : el.value.trim();
}

export const OPTIONS_ATTR = 'data-applyflow-options';

function controlType(el: Control): FieldControl {
  if (isCombobox(el)) return 'combobox';
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el instanceof HTMLSelectElement) return 'select';
  const t = (el.type || 'text').toLowerCase();
  if (['text', 'email', 'tel', 'url', 'number', 'radio', 'checkbox', 'file', 'date'].includes(t)) return t as FieldControl;
  return 'other';
}

/** Custom radio/checkbox widgets hide the real input but show a styled control next to it. */
function isStyledChoice(el: Control): boolean {
  const t = (el as HTMLInputElement).type;
  return (t === 'radio' || t === 'checkbox') && Boolean(el.closest('label') ?? el.parentElement) && isVisible(el.closest('label') ?? el.parentElement!);
}

export function labelFor(el: Control, root?: Element): { label: string; context: string; starred: boolean; nearest: string } {
  const doc = el.ownerDocument;
  let label = '';
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) label = labelledBy.split(/\s+/).map((id) => textOf(doc.getElementById(id))).join(' ').trim();
  if (!label && el.id) {
    const forLabel = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (forLabel) label = textOf(forLabel);
  }
  if (!label) {
    const wrap = el.closest('label');
    if (wrap) label = textOf(wrap).replace(textOf(el as Element), '').trim();
  }
  if (!label) label = el.getAttribute('aria-label') ?? '';
  if (!label && 'placeholder' in el) label = (el as HTMLInputElement).placeholder ?? '';
  const fieldset = el.closest('fieldset');
  const legend = textOf(fieldset?.querySelector('legend'));
  if ((el.type === 'radio' || el.type === 'checkbox') && legend) {
    // For choice inputs, the question is the legend; the label is the option text.
    label = legend;
  }
  // Nearby text: the closest preceding heading/paragraph within the field's container.
  let context = legend;
  // The text closest above the control (for a radio group: the question itself).
  let nearest = legend;
  let node: Element | null = el.parentElement;
  // Choice groups sit deeper (Lever: label › li › ul › field, with the question beside the field).
  const maxDepth = el.type === 'radio' || el.type === 'checkbox' ? 5 : 3;
  for (let depth = 0; node && depth < maxDepth && context.length < 200; depth++, node = node.parentElement) {
    // Never borrow text from outside the application (e.g. the site's navigation bar).
    if (root && !root.contains(node)) break;
    const prev = node.previousElementSibling;
    if (prev && !prev.querySelector('input,select,textarea') && !isPageChrome(prev) && prev.getAttribute('role') !== 'alert') {
      const t = textOf(prev);
      if (t && !nearest) nearest = t;
      context = `${context} ${t}`.trim();
    }
  }
  if (!label && context) label = context.slice(0, 120);
  if (!label) label = (el.getAttribute('name') ?? '').replace(/[_\-[\]]+/g, ' ').trim();
  // "*" and Lever's "✱" mark required fields.
  const starred = /[*✱]\s*$/.test(label) || /[*✱]\s*$/.test(legend);
  return { label: label.replace(/\s*[*✱]\s*$/, '').replace(/\s+/g, ' ').trim(), context: context.slice(0, 300), starred, nearest: nearest.slice(0, 300) };
}

function isRequired(el: Control, label: string, starred: boolean): boolean {
  return starred || el.required || el.getAttribute('aria-required') === 'true' || /\(required\)/i.test(label);
}

/** The question a radio group asks: its legend, or the text above the group when the label is just an option ("Yes"). */
function questionText(label: string, nearest: string, options: string[]): { question: string; starred: boolean } {
  if (!options.includes(label) || !nearest) return { question: label, starred: false };
  const lead = nearest.replace(new RegExp(`\\b(${options.map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g'), ' ').replace(/\s+/g, ' ').trim();
  const q = lead.slice(0, 200);
  return { question: q.replace(/\s*[*✱]\s*$/, '').trim() || label, starred: /[*✱]\s*$/.test(q) };
}

function ensureId(el: Element): string {
  let id = el.getAttribute(FIELD_ATTR);
  if (!id) {
    counter += 1;
    id = `af-${counter}`;
    el.setAttribute(FIELD_ATTR, id);
  }
  return id;
}

export function scanFields(root: ParentNode): FormFieldDescriptor[] {
  const controls = Array.from(root.querySelectorAll<Control>('input, textarea, select')).filter(
    (el) => !SKIP_TYPES.has((el as HTMLInputElement).type?.toLowerCase?.() ?? '') && !el.disabled && !isPageChrome(el) && (isVisible(el) || isStyledChoice(el)),
  );
  const out: FormFieldDescriptor[] = [];
  const radioGroups = new Set<string>();
  for (const el of controls) {
    const control = controlType(el);
    if (control === 'radio') {
      const name = el.getAttribute('name') ?? '';
      if (name && radioGroups.has(name)) continue;
      radioGroups.add(name);
      const group = name ? Array.from(root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`)) : [el as HTMLInputElement];
      const { label: raw, context, starred, nearest } = labelFor(el, root as Element);
      const options = group.map((r) => labelOfOption(r));
      const { question: label, starred: qStarred } = questionText(raw, nearest, options);
      const checked = group.find((r) => r.checked);
      out.push({
        fieldId: ensureId(el),
        label,
        context,
        control,
        name,
        required: starred || qStarred || group.some((r) => r.required || r.getAttribute('aria-required') === 'true') || Boolean(el.closest('[role="radiogroup"][aria-required="true"]')),
        options,
        currentValue: checked ? labelOfOption(checked) : '',
        accept: '',
        sensitive: classifyFieldSensitivity(label, `${context} ${options.join(' ')}`),
      });
      continue;
    }
    const { label, context, starred } = labelFor(el, root as Element);
    let options = el instanceof HTMLSelectElement ? Array.from(el.options).filter((o) => o.value !== '').map((o) => o.text.trim()) : [];
    if (control === 'combobox') {
      try {
        options = JSON.parse(el.getAttribute(OPTIONS_ATTR) ?? '[]') as string[];
      } catch {
        options = [];
      }
    }
    let currentValue = '';
    if (control === 'combobox') currentValue = comboboxValue(el as HTMLInputElement);
    else if (el instanceof HTMLSelectElement) currentValue = el.value ? el.selectedOptions[0]?.text.trim() ?? '' : '';
    else if (control === 'checkbox') currentValue = (el as HTMLInputElement).checked ? 'checked' : '';
    else if (control === 'file') currentValue = Array.from((el as HTMLInputElement).files ?? []).map((f) => f.name).join(', ');
    else currentValue = el.value;
    out.push({
      fieldId: ensureId(el),
      label,
      context,
      control,
      name: el.getAttribute('name') ?? '',
      required: isRequired(el, label, starred),
      options,
      currentValue,
      accept: el.getAttribute('accept') ?? '',
      sensitive: classifyFieldSensitivity(label, `${context} ${options.join(' ')}`),
    });
  }
  out.push(...scanChoiceGroups(root));
  return out;
}

// ---------------------------------------------------------------- Yes/No buttons and ARIA radio groups

/** Answers a button group can offer (Ashby's Yes/No questions). Anything else is not a question. */
const ANSWER_WORDS = /^(yes|no|maybe|true|false|n\/a|not applicable|prefer not to (say|answer|disclose)|decline to (state|answer|self-identify)|i don['’]t know)$/i;

function choiceOptions(group: Element): HTMLElement[] {
  if (group.getAttribute('role') === 'radiogroup') return Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
  return Array.from(group.children).filter((c): c is HTMLElement => c instanceof HTMLElement && (c.tagName === 'BUTTON' || c.getAttribute('role') === 'button'));
}

function isChosen(el: Element): boolean {
  return el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-state') === 'on' || /(^|[\s_-])(selected|active|checked|isSelected|pressed)([\s_-]|$)/i.test(typeof el.className === 'string' ? el.className : '');
}

/** The question above a button group: its label, legend, or the nearest text before it. */
function groupQuestion(group: Element, root: Element): { label: string; starred: boolean } {
  const doc = group.ownerDocument;
  const by = group.getAttribute('aria-labelledby');
  let label = by ? by.split(/\s+/).map((id) => textOf(doc.getElementById(id))).join(' ') : group.getAttribute('aria-label') ?? '';
  let node: Element | null = group;
  for (let d = 0; !label && node && d < 4 && root.contains(node); d++, node = node.parentElement) {
    const legend = node.tagName === 'FIELDSET' ? node.querySelector('legend') : null;
    if (legend) label = textOf(legend);
    for (let prev = node.previousElementSibling; !label && prev; prev = prev.previousElementSibling) {
      const t = textOf(prev);
      if (t && !prev.querySelector('input, select, textarea, button')) label = t;
    }
  }
  const starred = /[*✱]\s*$/.test(label);
  return { label: label.replace(/\s*[*✱]\s*$/, '').replace(/\s+/g, ' ').trim().slice(0, 300), starred };
}

function scanChoiceGroups(root: ParentNode): FormFieldDescriptor[] {
  const out: FormFieldDescriptor[] = [];
  const seen = new Set<Element>();
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('[role="radiogroup"], button, [role="button"]'));
  for (const c of candidates) {
    const group = c.getAttribute('role') === 'radiogroup' ? c : c.parentElement;
    if (!group || seen.has(group) || isPageChrome(group)) continue;
    seen.add(group);
    if (group.querySelector('input[type="radio"], input[type="file"]')) continue; // native radios are scanned already
    const opts = choiceOptions(group);
    if (opts.length < 2 || opts.length > 6 || !isVisible(group)) continue;
    const labels = opts.map((o) => textOf(o));
    if (group.getAttribute('role') !== 'radiogroup' && !labels.every((l) => ANSWER_WORDS.test(l))) continue;
    const { label, starred } = groupQuestion(group, root as Element);
    if (!label) continue;
    const chosen = opts.find(isChosen);
    out.push({
      fieldId: ensureId(group),
      label,
      context: label,
      control: 'radio',
      name: '',
      required: starred || group.getAttribute('aria-required') === 'true',
      options: labels,
      currentValue: chosen ? textOf(chosen) : '',
      accept: '',
      sensitive: classifyFieldSensitivity(label, labels.join(' ')),
    });
  }
  return out;
}

function labelOfOption(r: HTMLInputElement): string {
  const doc = r.ownerDocument;
  if (r.id) {
    const l = doc.querySelector(`label[for="${CSS.escape(r.id)}"]`);
    if (l) return textOf(l);
  }
  const wrap = r.closest('label');
  if (wrap) return textOf(wrap);
  return r.value;
}

/** Set a value the way a user would, so React/Vue-controlled inputs register it. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  el.focus();
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function fillFields(doc: Document, instructions: FillInstruction[]): FillResult[] {
  return instructions.map((ins): FillResult => {
    const el = doc.querySelector<Control>(`[${FIELD_ATTR}="${CSS.escape(ins.fieldId)}"]`);
    if (!el) return { fieldId: ins.fieldId, ok: false, error: 'This field is no longer on the page. Rescan the form.' };
    if (el.disabled || (el as HTMLInputElement).readOnly) return { fieldId: ins.fieldId, ok: false, error: 'The field is read-only.' };
    try {
      if (ins.kind === 'file') {
        if (!(el instanceof HTMLInputElement) || el.type !== 'file' || !ins.file) return { fieldId: ins.fieldId, ok: false, error: 'Not a file upload control.' };
        const file = new File([base64ToBytes(ins.file.base64) as BlobPart], ins.file.name, { type: ins.file.mime });
        const dt = new DataTransfer();
        dt.items.add(file);
        el.files = dt.files;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        const attached = el.files?.[0]?.name === ins.file.name;
        return attached
          ? { fieldId: ins.fieldId, ok: true, finalValue: ins.file.name }
          : { fieldId: ins.fieldId, ok: false, error: 'Dice did not accept the file programmatically. Attach it yourself — it is in your downloads.' };
      }
      const value = ins.value ?? '';
      if (el instanceof HTMLSelectElement) {
        const opt = Array.from(el.options).find((o) => o.text.trim() === value || o.value === value);
        if (!opt) return { fieldId: ins.fieldId, ok: false, error: `No option “${value}”.` };
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { fieldId: ins.fieldId, ok: true, finalValue: opt.text.trim() };
      }
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
        return { fieldId: ins.fieldId, ok: false, error: 'Checkboxes and choices are never set automatically.' };
      }
      setNativeValue(el, value);
      return { fieldId: ins.fieldId, ok: el.value === value, finalValue: el.value, error: el.value === value ? undefined : 'The page changed the value after it was set.' };
    } catch (e: unknown) {
      return { fieldId: ins.fieldId, ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });
}

export function highlightField(doc: Document, fieldId: string): boolean {
  const el = doc.querySelector<HTMLElement>(`[${FIELD_ATTR}="${CSS.escape(fieldId)}"]`);
  if (!el) return false;
  el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  const prev = el.style.outline;
  el.style.outline = '3px solid #007595';
  el.style.outlineOffset = '2px';
  setTimeout(() => {
    el.style.outline = prev;
  }, 2200);
  el.focus?.();
  return true;
}

/**
 * Apply an answer the user chose or saved (radio, select, checkbox or text). Only called for
 * answers that came from the user, never for guesses.
 */
export function answerField(doc: Document, fieldId: string, value: string): FillResult {
  const el = doc.querySelector<Control>(`[${FIELD_ATTR}="${CSS.escape(fieldId)}"]`);
  if (!el) return { fieldId, ok: false, error: 'This question is no longer on the page.' };
  const want = value.trim().toLowerCase();
  // A Yes/No button group or an ARIA radio group.
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
    const opts = choiceOptions(el);
    const match = opts.find((o) => textOf(o).toLowerCase() === want) ?? opts.find((o) => textOf(o).toLowerCase().startsWith(want));
    if (!match) return { fieldId, ok: false, error: `No option “${value}”.` };
    match.click();
    return { fieldId, ok: true, finalValue: textOf(match) };
  }
  try {
    if (el instanceof HTMLInputElement && el.type === 'radio') {
      const name = el.getAttribute('name');
      const group = name ? Array.from(doc.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`)) : [el];
      const match = group.find((r) => labelOfOption(r).toLowerCase() === want) ?? group.find((r) => labelOfOption(r).toLowerCase().startsWith(want) || r.value.toLowerCase() === want);
      if (!match) return { fieldId, ok: false, error: `No option “${value}”.` };
      match.click();
      if (!match.checked) {
        match.checked = true;
        match.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { fieldId, ok: match.checked, finalValue: labelOfOption(match) };
    }
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      const on = /^(yes|true|checked|agree|i agree|on)$/i.test(value.trim());
      if (el.checked !== on) el.click();
      if (el.checked !== on) {
        el.checked = on;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { fieldId, ok: el.checked === on, finalValue: el.checked ? 'checked' : '' };
    }
    if (el instanceof HTMLSelectElement) {
      const opt = Array.from(el.options).find((o) => o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want) ?? Array.from(el.options).find((o) => o.value && o.text.trim().toLowerCase().startsWith(want));
      if (!opt) return { fieldId, ok: false, error: `No option “${value}”.` };
      el.value = opt.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { fieldId, ok: true, finalValue: opt.text.trim() };
    }
    setNativeValue(el as HTMLInputElement | HTMLTextAreaElement, value);
    return { fieldId, ok: (el as HTMLInputElement).value === value, finalValue: (el as HTMLInputElement).value };
  } catch (e: unknown) {
    return { fieldId, ok: false, error: e instanceof Error ? e.message : 'Could not set the answer.' };
  }
}

// ---------------------------------------------------------------- dropdowns that are text boxes (async)

type Sleep = (ms: number) => Promise<void>;

function fire(el: Element, type: string, init: KeyboardEventInit & MouseEventInit = {}): void {
  const view = el.ownerDocument.defaultView;
  if (/^key/.test(type)) el.dispatchEvent(new (view?.KeyboardEvent ?? KeyboardEvent)(type, { bubbles: true, cancelable: true, ...init }));
  else el.dispatchEvent(new (view?.MouseEvent ?? MouseEvent)(type, { bubbles: true, cancelable: true, button: 0, ...init }));
}

/** The visible list a combobox opened (its aria-controls/aria-owns list, else any open listbox). */
function openList(el: HTMLInputElement): HTMLElement[] {
  const doc = el.ownerDocument;
  const ids = `${el.getAttribute('aria-controls') ?? ''} ${el.getAttribute('aria-owns') ?? ''}`.split(/\s+/).filter(Boolean);
  const lists = ids.map((id) => doc.getElementById(id)).filter((x): x is HTMLElement => Boolean(x));
  const scopes = lists.length ? lists : Array.from(doc.querySelectorAll<HTMLElement>('[role="listbox"], [class*="menu-list" i], [class*="select__menu" i]')).filter(isVisible);
  const out: HTMLElement[] = [];
  const NOTICE = /notice|no-?options|loading|empty|message/i;
  for (const s of scopes) {
    const byRole = Array.from(s.querySelectorAll<HTMLElement>('[role="option"]'));
    // Without ARIA roles, fall back to "option" classes — never the list's own notices ("Loading…", "No options").
    const pool = byRole.length ? byRole : Array.from(s.querySelectorAll<HTMLElement>('[class*="option" i]')).filter((o) => !NOTICE.test(typeof o.className === 'string' ? o.className : ''));
    out.push(...pool.filter((o) => isVisible(o) && textOf(o) && !o.querySelector('[role="option"]') && !/^(loading|no options|no results|start typing|type to search)/i.test(textOf(o))));
  }
  return Array.from(new Set(out));
}

function closeList(el: HTMLInputElement): void {
  fire(el, 'keydown', { key: 'Escape', code: 'Escape' });
  el.blur();
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

/** Open a combobox (click its box, press ArrowDown) and wait for its options. */
async function openCombobox(el: HTMLInputElement, sleep: Sleep, ms = 1500): Promise<HTMLElement[]> {
  const box = comboboxBox(el);
  el.focus();
  fire(box, 'mousedown');
  fire(el, 'keydown', { key: 'ArrowDown', code: 'ArrowDown' });
  for (let t = 0; t < ms; t += 100) {
    const opts = openList(el);
    if (opts.length && !opts.every((o) => /no options|loading|type to search|start typing/i.test(textOf(o)))) return opts;
    await sleep(100);
  }
  return [];
}

/**
 * Read the choices of each closed dropdown once (opening it briefly), so the panel can offer them
 * as one-tap answers. Lists that only appear after typing (location search) stay empty.
 */
export async function probeComboboxes(root: ParentNode, sleep: Sleep, limit = 25): Promise<void> {
  const boxes = Array.from(root.querySelectorAll<HTMLInputElement>('input')).filter((el) => isCombobox(el) && !el.hasAttribute(OPTIONS_ATTR) && !el.disabled && !isPageChrome(el)).slice(0, limit);
  for (const el of boxes) {
    const opts = await openCombobox(el, sleep, 600);
    el.setAttribute(OPTIONS_ATTR, JSON.stringify(Array.from(new Set(opts.map((o) => textOf(o)))).slice(0, 60)));
    closeList(el);
    await sleep(50);
  }
}

const US_STATES: Record<string, string> = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming', dc: 'district of columbia',
};

/** Words of a place, with US state abbreviations and "US/USA" spelled out ("St. Petersburg, FL, US"). */
function placeWords(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().split(/[,()]+/)) {
    const part = raw.trim().replace(/\s+\d{5}(-\d{4})?$/, '');
    if (!part) continue;
    const full = US_STATES[part] ?? (/^(us|usa|u\.s\.a?\.?)$/.test(part) ? 'united states' : part);
    for (const w of full.replace(/[.]/g, '').split(/\s+/)) if (w && !/^\d+$/.test(w)) out.add(w);
  }
  return out;
}

/**
 * The option matching `value`: exact, then starting with it, then containing it. For places
 * (`place`), the suggestion that shares the most words with your location — and only one that
 * names your city — so "St. Petersburg, FL" never becomes "St. Petersburg, Russia".
 */
function bestOption(opts: HTMLElement[], value: string, place: boolean): HTMLElement | null {
  const v = value.trim().toLowerCase();
  const t = (o: HTMLElement) => textOf(o).toLowerCase();
  const direct = opts.find((o) => t(o) === v) ?? opts.find((o) => t(o).startsWith(v)) ?? opts.find((o) => t(o).includes(v) || (t(o).length > 3 && v.includes(t(o))));
  if (direct || !place) return direct ?? null;
  const want = placeWords(value);
  const city = placeWords(value.split(',')[0] ?? '');
  let best: { o: HTMLElement; score: number } | null = null;
  for (const o of opts) {
    const have = placeWords(textOf(o));
    if (![...city].every((w) => have.has(w))) continue;
    const score = [...want].filter((w) => have.has(w)).length - [...have].filter((w) => !want.has(w)).length * 0.25;
    if (!best || score > best.score) best = { o, score };
  }
  return best?.o ?? null;
}

function choose(opt: HTMLElement): void {
  fire(opt, 'mousemove');
  fire(opt, 'mousedown');
  fire(opt, 'mouseup');
  opt.click();
}

/** Type into a combobox and pick the option that matches `value` (`place`: the best-matching location suggestion). */
async function setCombobox(el: HTMLInputElement, value: string, sleep: Sleep, place = false): Promise<FillResult & { fieldId: string }> {
  const fieldId = el.getAttribute(FIELD_ATTR) ?? '';
  let opts = await openCombobox(el, sleep, 500);
  let pick = bestOption(opts, value, false);
  if (!pick) {
    // Searchable lists: type to filter (locations, schools).
    setNativeValueQuiet(el, value.split(',')[0]!.trim());
    for (let t = 0; t < 2500 && !pick; t += 150) {
      await sleep(150);
      opts = openList(el);
      pick = bestOption(opts, value, place);
    }
  }
  if (!pick) {
    closeList(el);
    return { fieldId, ok: false, error: `No option “${value}” in the list.` };
  }
  const text = textOf(pick);
  choose(pick);
  await sleep(150);
  // Chosen when the box shows the option (react-select) or the input now holds it (plain autocompletes).
  const shown = comboboxValue(el);
  const box = comboboxBox(el);
  const displayed = Array.from(box.querySelectorAll('[class*="single-value" i], [class*="singleValue" i], [class*="multi-value" i]')).some((n) => textOf(n) === text);
  const ok = displayed || el.value.trim() === text;
  if (!ok) closeList(el);
  return ok ? { fieldId, ok: true, finalValue: shown || text } : { fieldId, ok: false, error: `The list didn’t take “${text}”. Choose it on the page.` };
}

/** Set a text value without the blur that would close an autocomplete list. */
function setNativeValueQuiet(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  el.focus();
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  fire(el, 'keydown', { key: value.slice(-1) || 'a' });
  fire(el, 'keyup', { key: value.slice(-1) || 'a' });
}

/** After typing a location into a plain text box, pick the site's matching suggestion (Lever, Google Places). */
async function pickSuggestion(el: HTMLInputElement, value: string, sleep: Sleep): Promise<string | null> {
  const doc = el.ownerDocument;
  const near = el.closest('.application-question, .field, [class*="field" i], li, fieldset, div') ?? doc.body;
  for (let t = 0; t < 1500; t += 150) {
    await sleep(150);
    const cands = [
      ...Array.from(near.querySelectorAll<HTMLElement>('[role="option"], .dropdown-location, [class*="suggestion" i] li, [class*="suggestion" i] div, [class*="dropdown-results" i] > div')),
      ...Array.from(doc.querySelectorAll<HTMLElement>('.pac-item, [role="listbox"] [role="option"]')),
    ].filter((o) => isVisible(o) && textOf(o) && o.childElementCount <= 4);
    const pick = bestOption(cands, value, true);
    if (pick) {
      const text = textOf(pick);
      choose(pick);
      return text;
    }
  }
  return null;
}

/** fillFields, plus dropdowns that are text boxes and location suggestions. */
export async function fillFieldsAsync(doc: Document, instructions: FillInstruction[], sleep: Sleep): Promise<FillResult[]> {
  const out: FillResult[] = [];
  for (const ins of instructions) {
    const el = doc.querySelector<Control>(`[${FIELD_ATTR}="${CSS.escape(ins.fieldId)}"]`);
    if (el instanceof HTMLInputElement && isCombobox(el) && ins.kind === 'value') {
      try {
        out.push(await setCombobox(el, ins.value ?? '', sleep, Boolean(ins.suggest)));
      } catch (e) {
        out.push({ fieldId: ins.fieldId, ok: false, error: e instanceof Error ? e.message : 'Could not choose an option.' });
      }
      continue;
    }
    const [r] = fillFields(doc, [ins]);
    if (r && r.ok && ins.suggest && el instanceof HTMLInputElement) {
      const chosen = await pickSuggestion(el, ins.value ?? '', sleep);
      if (chosen) r.finalValue = el.value || chosen;
    }
    out.push(r!);
  }
  return out;
}

/** answerField, plus dropdowns that are text boxes. */
export async function answerFieldAsync(doc: Document, fieldId: string, value: string, sleep: Sleep): Promise<FillResult> {
  const el = doc.querySelector<HTMLElement>(`[${FIELD_ATTR}="${CSS.escape(fieldId)}"]`);
  if (el instanceof HTMLInputElement && isCombobox(el)) return setCombobox(el, value, sleep);
  return answerField(doc, fieldId, value);
}
