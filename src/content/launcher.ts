let host: HTMLElement | null = null;
let onOpen: () => void = () => undefined;

export function setLauncherHandler(fn: () => void): void {
  onOpen = fn;
}
let userHidden = false;
let allowed = true;

const CSS = `
  :host { all: initial; }
  .wrap { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; display: flex; align-items: center; gap: 2px;
    font: 600 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif; }
  button { all: unset; cursor: pointer; box-sizing: border-box; }
  .open { display: inline-flex; align-items: center; gap: 8px; background: #007595; color: #fff; padding: 11px 16px;
    border-radius: 999px 0 0 999px; box-shadow: 0 2px 10px rgba(24,24,27,.22); }
  .open:hover { background: #005F78; }
  .close { background: #007595; color: #CFF3FA; padding: 11px 12px 11px 9px; border-radius: 0 999px 999px 0; border-left: 1px solid #2B93AD;
    box-shadow: 0 2px 10px rgba(24,24,27,.22); }
  .close:hover { color: #fff; background: #005F78; }
  button:focus-visible { outline: 3px solid #18181B; outline-offset: 2px; }
  svg { width: 16px; height: 16px; }
`;

export function mountLauncher(isJobPage: boolean): void {
  const show = isJobPage && allowed && !userHidden;
  if (!show) {
    host?.remove();
    host = null;
    return;
  }
  if (host && document.documentElement.contains(host)) return;
  host = document.createElement('applyflow-launcher');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  const open = document.createElement('button');
  open.className = 'open';
  open.setAttribute('aria-label', 'Tailor and apply with ApplyFlow');
  open.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="#fff" d="M4 1.5h5l3.5 3.5v9a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M5.5 9l1.8 1.8L10.8 7" fill="none" stroke="#007595" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Tailor &amp; Apply</span>';
  open.addEventListener('click', () => {
    onOpen();
  });
  const close = document.createElement('button');
  close.className = 'close';
  close.setAttribute('aria-label', 'Hide ApplyFlow button on this page');
  close.textContent = '✕';
  close.addEventListener('click', () => {
    userHidden = true;
    mountLauncher(false);
  });
  wrap.append(open, close);
  root.append(style, wrap);
  document.documentElement.appendChild(host);
}

export function setLauncherVisible(visible: boolean): void {
  allowed = visible;
  if (!visible) mountLauncher(false);
}
