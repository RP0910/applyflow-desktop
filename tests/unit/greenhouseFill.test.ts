import { describe, expect, it } from 'vitest';
import { FIELD_ATTR } from '@/services/forms/domFields';
import { fillGreenhouseFields, orderGreenhouseFills } from '@/services/platforms/ats/greenhouseFill';

const sleep = async () => undefined;

describe('Greenhouse fill order', () => {
  it('sets the phone country before the number, and leaves other sites’ field order alone', () => {
    document.body.innerHTML =
      `<input id="phone" type="tel" ${FIELD_ATTR}="p">` +
      `<input id="first_name" ${FIELD_ATTR}="f">` +
      `<fieldset class="phone-input"><input id="country" role="combobox" ${FIELD_ATTR}="c"></fieldset>` +
      `<input id="candidate-location" role="combobox" ${FIELD_ATTR}="l">`;
    const ordered = orderGreenhouseFills(document, [
      { fieldId: 'p', kind: 'value', value: '555' },
      { fieldId: 'f', kind: 'value', value: 'Grant' },
      { fieldId: 'l', kind: 'value', value: 'St. Petersburg' },
      { fieldId: 'c', kind: 'value', value: 'United States' },
    ]);
    expect(ordered.map((x) => x.fieldId)).toEqual(['c', 'p', 'l', 'f']);
  });

  it('presses Enter on a Greenhouse select that does not take a click', async () => {
    document.body.innerHTML =
      `<div data-combo="country"><input id="country" role="combobox" ${FIELD_ATTR}="c"><input type="hidden" value=""></div>`;
    const input = document.getElementById('country') as HTMLInputElement;
    const hidden = document.querySelector('input[type="hidden"]') as HTMLInputElement;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && !document.getElementById('list')) {
        const menu = document.createElement('div');
        menu.id = 'list';
        menu.setAttribute('role', 'listbox');
        menu.innerHTML = '<div role="option" id="opt-us">United States</div>';
        document.body.appendChild(menu);
        input.setAttribute('aria-controls', 'list');
      }
      if (e.key === 'Enter') {
        const opt = document.querySelector('.select__option--is-focused');
        if (opt) hidden.value = opt.textContent ?? '';
      }
    });
    const results = await fillGreenhouseFields(document, [{ fieldId: 'c', kind: 'value', value: 'United States' }], sleep);
    expect(results[0]).toMatchObject({ ok: true, finalValue: 'United States' });
    expect(hidden.value).toBe('United States');
  });
});
