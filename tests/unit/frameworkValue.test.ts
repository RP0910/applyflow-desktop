import { describe, expect, it } from 'vitest';
import { answerField, fillFields, fillFieldsAsync, pageAccepted, scanFields, setNativeValue } from '@/services/forms/domFields';

/** A stand-in for a framework that ignores a value assignment once its tracker already matches. */
function installModel(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
  const proto = Object.getOwnPropertyDescriptor(
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
    'value',
  );
  let tracked = '';
  Object.defineProperty(el, '_valueTracker', { value: { setValue: (v: string) => { tracked = v; }, getValue: () => tracked } });
  if (proto?.get && proto.set) {
    Object.defineProperty(el, 'value', {
      configurable: true,
      get: () => proto.get!.call(el),
      set: (v: string) => {
        proto.set!.call(el, v);
        tracked = v;
      },
    });
  }
  el.setAttribute('data-model', '');
  el.addEventListener('input', () => {
    const tracker = (el as unknown as { _valueTracker: { getValue: () => string } })._valueTracker;
    if (tracker.getValue() !== el.value) el.setAttribute('data-model', el.value);
  });
}

function oldWrite(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

describe('framework-controlled values', () => {
  it('the old assignment leaves the model empty and the prototype write updates it', () => {
    document.body.innerHTML = '<label>Why you<textarea data-applyflow-field="essay"></textarea></label>';
    const el = document.querySelector('textarea')!;
    installModel(el);
    oldWrite(el, 'I build reliable systems.');
    expect(el.value).toBe('I build reliable systems.');
    expect(el.getAttribute('data-model')).toBe('');
    expect(pageAccepted(el, 'I build reliable systems.').ok).toBe(false);

    setNativeValue(el, 'I build reliable systems.');
    expect(el.getAttribute('data-model')).toBe('I build reliable systems.');
    expect(pageAccepted(el, 'I build reliable systems.').ok).toBe(true);
  });

  it('a select, a checkbox, and a radio update the model the page reads', () => {
    document.body.innerHTML = `
      <label>Level<select data-applyflow-field="level"><option value="">Select</option><option value="ba">Bachelor's</option></select></label>
      <label>Agree<input type="checkbox" data-applyflow-field="agree" /></label>
      <label>Yes<input type="radio" name="auth" value="yes" data-applyflow-field="yes" /></label>
    `;
    const select = document.querySelector('select')!;
    installModel(select);
    setNativeValue(select, 'ba');
    expect(select.getAttribute('data-model')).toBe('ba');
    expect(pageAccepted(select, 'ba').ok).toBe(true);

    const box = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.addEventListener('change', () => box.setAttribute('data-model', box.checked ? 'checked' : ''));
    const checked = answerField(document, 'agree', 'Yes');
    expect(checked.ok).toBe(true);
    expect(box.getAttribute('data-model')).toBe('checked');

    const radio = document.querySelector<HTMLInputElement>('input[type="radio"]')!;
    radio.addEventListener('change', () => radio.setAttribute('data-model', 'Yes'));
    const chosen = answerField(document, 'yes', 'Yes');
    expect(chosen.ok).toBe(true);
    expect(radio.checked).toBe(true);
  });

  it('does not report a fill the page marked invalid', () => {
    document.body.innerHTML = '<label>Essay<textarea data-applyflow-field="essay" aria-invalid="true"></textarea></label>';
    const result = fillFields(document, [{ fieldId: 'essay', kind: 'value', value: 'A sentence.' }]);
    expect(result[0]).toMatchObject({ ok: false });
    expect(result[0]?.error).toMatch(/invalid/i);
  });

  it('reads and selects a button listbox without using another dropdown’s options', () => {
    document.body.innerHTML = `
      <div>
        <div>Gender</div>
        <button type="button" aria-haspopup="listbox" aria-controls="g">Select One</button>
        <div id="g" role="listbox">
          <div role="option">Decline to self-identify</div>
          <div role="option">Woman</div>
        </div>
      </div>
      <div>
        <div>Pronouns</div>
        <button type="button" aria-haspopup="listbox" aria-controls="p">Select One</button>
        <div id="p" role="listbox"><div role="option">They/them</div><div role="option">She/her</div></div>
      </div>
    `;
    const fields = scanFields(document.body);
    const gender = fields.find((f) => f.label === 'Gender');
    const pronouns = fields.find((f) => f.label === 'Pronouns');
    expect(gender?.options).toEqual(['Decline to self-identify', 'Woman']);
    expect(pronouns?.options).toEqual(['They/them', 'She/her']);
    expect(gender?.currentValue).toBe('');

    document.getElementById('g')!.addEventListener('click', (ev) => {
      const option = (ev.target as Element).closest('[role="option"]');
      if (!option) return;
      document.querySelector('button')!.textContent = option.textContent;
    });
    const filled = fillFields(document, [{ fieldId: gender!.fieldId, kind: 'value', value: 'Decline to self-identify' }]);
    expect(filled[0]).toMatchObject({ ok: true, finalValue: 'Decline to self-identify' });
    expect(document.querySelector('button')!.textContent).toBe('Decline to self-identify');
  });

  it('chooses the full address suggestion for a street, not an exact option match', async () => {
    document.body.innerHTML = '<div class="select"><input id="addr" role="combobox" data-applyflow-field="street" autocomplete="street-address"><input type="hidden" value=""></div>';
    const input = document.getElementById('addr') as HTMLInputElement;
    const hidden = document.querySelector('input[type="hidden"]') as HTMLInputElement;
    const suggestion = '7109 Meadowlawn Dr N, St. Petersburg, FL, USA';
    input.addEventListener('input', () => {
      if (document.getElementById('addr-list')) return;
      const menu = document.createElement('div');
      menu.id = 'addr-list';
      menu.setAttribute('role', 'listbox');
      menu.innerHTML = `<div role="option">${suggestion}</div>`;
      document.body.appendChild(menu);
      input.setAttribute('aria-controls', 'addr-list');
    });
    document.body.addEventListener('click', (ev) => {
      const option = (ev.target as Element).closest('[role="option"]');
      if (!option) return;
      hidden.value = option.textContent ?? '';
      const shown = document.createElement('div');
      shown.className = 'select__single-value';
      shown.textContent = option.textContent;
      input.parentElement!.appendChild(shown);
    });
    const [result] = await fillFieldsAsync(document, [{ fieldId: 'street', kind: 'value', value: '7109 MEADOWLAWN DR N', suggest: true }], async () => undefined);
    expect(result).toMatchObject({ ok: true });
    expect(hidden.value).toBe(suggestion);
  });
});
