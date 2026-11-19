import type { FillInstruction, FillResult } from '@/types';
import { FIELD_ATTR, answerFieldAsync, fillFieldsAsync } from '@/services/forms/domFields';

type Sleep = (ms: number) => Promise<void>;

function fieldEl(doc: Document, fieldId: string): HTMLElement | null {
  return doc.querySelector<HTMLElement>(`[${FIELD_ATTR}="${CSS.escape(fieldId)}"]`);
}

/** Country (phone flag) before the number, then the location typeahead, then everything else. */
export function orderGreenhouseFills(doc: Document, instructions: FillInstruction[]): FillInstruction[] {
  const rank = (fieldId: string): number => {
    const el = fieldEl(doc, fieldId);
    if (!(el instanceof HTMLInputElement)) return 40;
    if (el.id === 'country' || (el.getAttribute('role') === 'combobox' && Boolean(el.closest('.phone-input')))) return 0;
    if (el.id === 'phone' || el.type === 'tel') return 10;
    if (el.id === 'candidate-location') return 20;
    return 30;
  };
  return [...instructions].sort((a, b) => rank(a.fieldId) - rank(b.fieldId));
}

/**
 * Greenhouse react-select ignores a click once the box has been typed into.
 * Arrow to the option and press Enter, which every Greenhouse select accepts.
 */
async function confirmWithEnter(doc: Document, el: HTMLInputElement, value: string, sleep: Sleep): Promise<boolean> {
  el.focus();
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
  await sleep(200);
  const listId = el.getAttribute('aria-controls');
  const list = (listId ? doc.getElementById(listId) : null) ?? doc.querySelector<HTMLElement>('[role="listbox"]');
  if (!list) return false;
  const want = value.trim().toLowerCase();
  const opt = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]')).find((o) => (o.textContent ?? '').trim().toLowerCase() === want);
  if (!opt) return false;
  opt.classList.add('select__option--is-focused');
  el.setAttribute('aria-activedescendant', opt.id);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  await sleep(50);
  const hidden = el.closest('[data-combo], .select, .field-wrapper')?.querySelector('input[type="hidden"]');
  const shown = el.closest('.select, [data-combo]')?.querySelector('[class*="single-value" i]')?.textContent?.trim() ?? '';
  return hidden?.getAttribute('value') === value || (hidden instanceof HTMLInputElement && hidden.value === value) || shown === value;
}

function nudgeIntlPhone(doc: Document): void {
  const phone = doc.getElementById('phone');
  if (!(phone instanceof HTMLInputElement) || !/\biti__tel-input\b/.test(phone.className)) return;
  if (!phone.value.trim()) return;
  phone.dispatchEvent(new Event('input', { bubbles: true }));
  phone.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Greenhouse-only answer. Other sites keep answerFieldAsync. */
export async function answerGreenhouseField(doc: Document, fieldId: string, value: string, sleep: Sleep): Promise<FillResult> {
  const result = await answerFieldAsync(doc, fieldId, value, sleep);
  if (result.ok) return result;
  const el = fieldEl(doc, fieldId);
  if (el instanceof HTMLInputElement && el.getAttribute('role') === 'combobox' && (await confirmWithEnter(doc, el, value, sleep))) {
    return { ...result, ok: true, finalValue: value, error: undefined };
  }
  return result;
}

/** Greenhouse-only fill. Other sites keep fillFieldsAsync. */
export async function fillGreenhouseFields(doc: Document, instructions: FillInstruction[], sleep: Sleep): Promise<FillResult[]> {
  const ordered = orderGreenhouseFills(doc, instructions);
  const results = await fillFieldsAsync(doc, ordered, sleep);
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const ins = ordered[i];
    if (!result || result.ok || !ins) continue;
    const el = fieldEl(doc, ins.fieldId);
    if (!(el instanceof HTMLInputElement) || el.getAttribute('role') !== 'combobox' || !ins.value) continue;
    if (await confirmWithEnter(doc, el, ins.value, sleep)) {
      results[i] = { ...result, ok: true, finalValue: ins.value, error: undefined };
    }
  }
  nudgeIntlPhone(doc);
  return results;
}
