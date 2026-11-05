
export function deepQueryAll<T extends Element = Element>(root: ParentNode, selector: string, limit = 500): T[] {
  const out: T[] = [];
  const visit = (node: ParentNode): void => {
    if (out.length >= limit) return;
    node.querySelectorAll<T>(selector).forEach((el) => out.length < limit && out.push(el));
    node.querySelectorAll('*').forEach((el) => {
      const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      if (sr) visit(sr);
    });
  };
  visit(root);
  return out;
}

export function deepQuery<T extends Element = Element>(root: ParentNode, selector: string): T | null {
  return deepQueryAll<T>(root, selector, 1)[0] ?? null;
}

export function firstMatch<T extends Element = Element>(root: ParentNode, selectors: string[]): { el: T; selector: string } | null {
  for (const sel of selectors) {
    try {
      const el = deepQuery<T>(root, sel);
      if (el) return { el, selector: sel };
    } catch {
    }
  }
  return null;
}

export function cleanText(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function isVisible(el: Element): boolean {
  const h = el as HTMLElement;
  if (h.hidden || h.closest('[hidden],[aria-hidden="true"]')) return false;
  const view = el.ownerDocument.defaultView;
  if (view) {
    let cur: Element | null = el;
    while (cur) {
      const cs = view.getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      cur = cur.parentElement;
    }
  }
  const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
  if (!isJsdom && typeof h.getBoundingClientRect === 'function') {
    const r = h.getBoundingClientRect();
    if (r.width === 0 && r.height === 0 && (el as HTMLInputElement).type !== 'file') return false;
  }
  return true;
}

export function controlLabel(el: HTMLElement): string {
  return (el.getAttribute('aria-label') || el.textContent || (el as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim();
}

export function isPageChrome(el: Element): boolean {
  if (el.closest('nav, [role="navigation"], [role="search"], [role="banner"], [role="contentinfo"], form[role="search"]')) return true;
  const hf = el.closest('header, footer');
  if (
    hf &&
    !hf.parentElement?.closest('main, form, [role="dialog"], [role="main"], article, section') &&
    (hf.matches('[role="banner"], [role="contentinfo"]') ||
      hf.querySelector('nav, [role="navigation"], [role="search"], input[type="search"], form, a[href="/"], a[href$="dice.com/"]') ||
      hf.querySelectorAll('a[href]').length >= 4)
  ) {
    return true;
  }
  if ((el as HTMLInputElement).type === 'search') return true;
  const form = el.closest('form');
  return Boolean(form && form.querySelector('input[type="search"], input[name="q"], input[name="query"], input[name="keyword"]'));
}

export function visibleText(el: Element | null | undefined, max = 4000): string {
  return ((el as HTMLElement | null)?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, max);
}
