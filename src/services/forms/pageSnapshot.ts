/** Saves the current form's markup. Opens lists only to read them, and never changes a value. */

const NAV = /^(save and continue|continue|next|submit|back|cancel)$/i;
const NAV_HAS = /\b(save and continue|submit application|submit)\b/i;

export interface PageSnapshot {
  html: string;
  unopened: string[];
}

export async function capturePageSnapshot(doc: Document, opts: {
  pageUrl: string;
  root: Element | null;
  click: (el: HTMLElement) => Promise<void>;
  key: (key: 'Escape') => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  delayMs?: number;
}): Promise<PageSnapshot> {
  const delay = Math.min(Math.max(0, opts.delayMs ?? 0), 8000);
  if (delay) await opts.sleep(delay);
  const root = opts.root ?? doc.body;
  const unopened: string[] = [];
  const lists: string[] = [];
  const seen = new Set<string>();
  for (const el of dropdowns(root)) {
    const label = controlLabel(el);
    const markup = await readList(doc, el, opts);
    if (!markup) {
      unopened.push(label || 'Unlabeled dropdown');
      continue;
    }
    if (seen.has(markup)) continue;
    seen.add(markup);
    lists.push(`<section data-snapshot-list="${escapeAttr(label)}">${markup}</section>`);
  }
  const essays = essayMarkup(root);
  const form = serializeForm(root);
  const html = redactHost(
    `<!-- url: ${opts.pageUrl} -->\n<!-- unopened: ${unopened.join(' | ') || 'none'} -->\n${form}\n<section data-snapshot="lists">\n${lists.join('\n')}\n</section>\n<section data-snapshot="essays">\n${essays.join('\n')}\n</section>`,
    opts.pageUrl,
  );
  return { html, unopened };
}

function dropdowns(root: Element): HTMLElement[] {
  const found = Array.from(root.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"], [role="combobox"][aria-haspopup="listbox"], button[aria-haspopup="true"]'));
  return found.filter((el) => {
    if (el instanceof HTMLInputElement && (el.type === 'password' || el.disabled)) return false;
    if (el.closest('input[type="password"]')) return false;
    if (el instanceof HTMLButtonElement && el.type === 'submit') return false;
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (NAV.test(text) || NAV_HAS.test(text)) return false;
    return true;
  });
}

async function readList(doc: Document, el: HTMLElement, opts: { click: (el: HTMLElement) => Promise<void>; key: (key: 'Escape') => Promise<void>; sleep: (ms: number) => Promise<void> }): Promise<string | null> {
  const already = listFor(doc, el);
  if (already) return already.outerHTML;
  await opts.click(el);
  await opts.sleep(200);
  const opened = listFor(doc, el);
  await opts.key('Escape');
  await opts.sleep(50);
  return opened ? opened.outerHTML : null;
}

function listFor(doc: Document, el: HTMLElement): Element | null {
  const id = el.getAttribute('aria-controls');
  if (id) {
    const named = doc.getElementById(id);
    return named?.querySelector('[role="option"]') ? named : null;
  }
  const ownedByOther = (list: Element) => {
    const listId = list.id;
    if (!listId) return false;
    const owner = doc.querySelector(`[aria-controls="${CSS.escape(listId)}"]`);
    return Boolean(owner && owner !== el);
  };
  const usable = (list: Element | undefined) => Boolean(list && !list.hasAttribute('hidden') && list.getAttribute('aria-hidden') !== 'true' && list.querySelector('[role="option"]') && !ownedByOther(list));
  const parent = el.parentElement;
  const sibling = parent ? Array.from(parent.children).find((n) => n !== el && n.getAttribute('role') === 'listbox' && usable(n)) : null;
  if (sibling) return sibling;
  const lists = Array.from(doc.querySelectorAll('[role="listbox"]')).filter((n) => usable(n));
  return lists.length === 1 ? lists[0]! : null;
}

function essayMarkup(root: Element): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"]')).map((box) => {
    let parent: HTMLElement | null = box.parentElement;
    while (parent && parent !== root) {
      if (parent.hasAttribute('data-automation-id') || parent.hasAttribute('aria-invalid')) return parent.outerHTML;
      parent = parent.parentElement;
    }
    return box.outerHTML;
  });
}

function serializeForm(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  copyEnteredValues(root, clone);
  clone.querySelectorAll('input[type="password"], input[autocomplete="current-password"], input[autocomplete="new-password"]').forEach((el) => el.remove());
  return clone.outerHTML;
}

function copyEnteredValues(live: Element, clone: Element): void {
  const from = [live, ...Array.from(live.querySelectorAll('*'))];
  const to = [clone, ...Array.from(clone.querySelectorAll('*'))];
  for (let i = 0; i < from.length && i < to.length; i++) {
    const a = from[i]!;
    const b = to[i]!;
    if (a instanceof HTMLInputElement && b instanceof HTMLInputElement) {
      if (a.type === 'password' || a.type === 'file') continue;
      if (a.type === 'checkbox' || a.type === 'radio') {
        if (a.checked) b.setAttribute('checked', '');
        else b.removeAttribute('checked');
      } else b.setAttribute('value', a.value);
    } else if (a instanceof HTMLTextAreaElement && b instanceof HTMLTextAreaElement) {
      b.textContent = a.value;
    } else if (a instanceof HTMLSelectElement && b instanceof HTMLSelectElement) {
      const idx = a.selectedIndex;
      Array.from(b.options).forEach((o, n) => (n === idx ? o.setAttribute('selected', '') : o.removeAttribute('selected')));
    }
  }
}

function controlLabel(el: HTMLElement): string {
  const labelled = el.getAttribute('aria-labelledby');
  if (labelled) {
    const text = labelled.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 120);
  }
  const own = el.getAttribute('aria-label') || (el.innerText || el.textContent || '');
  return own.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function redactHost(html: string, pageUrl: string): string {
  let host = '';
  try {
    host = new URL(pageUrl).host;
  } catch {
    host = '';
  }
  let out = host ? html.split(host).join('*.myworkdayjobs.com') : html;
  out = out.replace(/\b[\w.-]*myworkdaysite\.com\b/gi, '*.myworkdayjobs.com');
  out = out.replace(/\b[\w.-]*myworkdayjobs\.com\b/gi, '*.myworkdayjobs.com');
  out = out.replace(/\*\.\*\.myworkdayjobs\.com/g, '*.myworkdayjobs.com');
  return out;
}
