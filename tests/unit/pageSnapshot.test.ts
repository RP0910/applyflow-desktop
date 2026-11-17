import { describe, expect, it } from 'vitest';
import { capturePageSnapshot } from '@/services/forms/pageSnapshot';

function page() {
  document.body.innerHTML = `
    <form data-testid="application-wizard" action="https://acme.wd5.myworkdayjobs.com/en-US/job">
      <label>Password <input type="password" name="pw" value="secret-value"></label>
      <label for="essay">Explain why you are the ideal candidate</label>
      <div data-automation-id="formField-essay" aria-invalid="true">
        <textarea id="essay">Visible draft</textarea>
      </div>
      <div>Gender</div>
      <button type="button" id="gender" aria-haspopup="listbox" aria-controls="gender-list">Select One</button>
      <div id="gender-list" role="listbox" hidden></div>
      <button type="button" id="closed" aria-haspopup="listbox">Pronouns</button>
      <button type="submit">Submit</button>
      <button type="button">Continue</button>
    </form>
  `;
  const opened: string[] = [];
  document.getElementById('gender')!.addEventListener('click', () => {
    const list = document.getElementById('gender-list')!;
    list.removeAttribute('hidden');
    list.innerHTML = '<div role="option">Decline to self-identify</div><div role="option">Woman</div>';
    opened.push('gender');
  });
  document.body.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') document.getElementById('gender-list')!.setAttribute('hidden', '');
  });
  return opened;
}

describe('page snapshot', () => {
  it('saves the form, the essay parent, and an opened list, and does not touch navigation or passwords', async () => {
    const opened = page();
    const clicked: string[] = [];
    const snap = await capturePageSnapshot(document, {
      pageUrl: 'https://acme.wd5.myworkdayjobs.com/en-US/job/apply',
      root: document.querySelector('form'),
      sleep: async () => undefined,
      click: async (el) => {
        clicked.push(el.id || el.textContent || '');
        el.click();
      },
      key: async () => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      },
    });
    expect(snap.html).not.toContain('secret-value');
    expect(snap.html).not.toContain('type="password"');
    expect(snap.html).not.toContain('acme.wd5.myworkdayjobs.com');
    expect(snap.html).toContain('*.myworkdayjobs.com');
    expect(snap.html).toContain('data-automation-id="formField-essay"');
    expect(snap.html).toContain('Decline to self-identify');
    expect(snap.html).toContain('Visible draft');
    expect(clicked).toContain('gender');
    expect(clicked).not.toContain('Submit');
    expect(clicked.join(' ')).not.toMatch(/Continue/);
    expect(document.getElementById('gender')!.textContent).toBe('Select One');
    expect(opened).toEqual(['gender']);
    expect(snap.unopened).toContain('Pronouns');
  });
});
