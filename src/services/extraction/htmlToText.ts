const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TR', 'TABLE', 'BLOCKQUOTE', 'PRE', 'HEADER', 'FOOTER']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'BUTTON', 'IFRAME', 'TEMPLATE']);

export function elementToText(root: Element): string {
  const out: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      out.push((node.textContent ?? '').replace(/\s+/g, ' '));
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (SKIP.has(el.tagName)) return;
    if (el.getAttribute('aria-hidden') === 'true') return;
    if (el.tagName === 'BR') {
      out.push('\n');
      return;
    }
    const isLi = el.tagName === 'LI';
    const isHeading = /^H[1-6]$/.test(el.tagName);
    if (isLi) out.push('\n• ');
    else if (BLOCK.has(el.tagName)) out.push('\n');
    const beforeLen = out.length;
    el.childNodes.forEach(walk);
    if (isHeading) out.push(':');
    if (isLi || BLOCK.has(el.tagName)) out.push('\n');
    if (out.length === beforeLen) out.pop();
  };
  walk(root);
  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/::/g, ':')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function htmlToText(html: string, parser: DOMParser = new DOMParser()): string {
  const doc = parser.parseFromString(`<div id="af-root">${html}</div>`, 'text/html');
  const root = doc.getElementById('af-root');
  return root ? elementToText(root) : '';
}
