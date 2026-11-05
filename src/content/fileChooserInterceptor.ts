export const INTERCEPT_ATTR = 'data-applyflow-intercept';
export const CAPTURED_ATTR = 'data-applyflow-file-target';
const INSTALLED = '__applyflowFileChooser';

type Proto = HTMLInputElement & { showPicker?: () => void; [INSTALLED]?: boolean };

function active(input: HTMLInputElement): boolean {
  return input.type === 'file' && input.ownerDocument?.documentElement?.getAttribute(INTERCEPT_ATTR) === '1';
}

function capture(input: HTMLInputElement): void {
  input.setAttribute(CAPTURED_ATTR, String(Date.now()));
  if (!input.isConnected) {
    input.style.display = 'none';
    input.ownerDocument.body.appendChild(input);
  }
}

export function installFileChooserInterceptor(proto: HTMLInputElement): boolean {
  const p = proto as Proto;
  if (p[INSTALLED]) return false;
  Object.defineProperty(p, INSTALLED, { value: true });
  const originalClick = p.click;
  p.click = function click(this: HTMLInputElement) {
    if (active(this)) return capture(this);
    return originalClick.call(this);
  };
  const originalPicker = p.showPicker;
  if (typeof originalPicker === 'function') {
    p.showPicker = function showPicker(this: HTMLInputElement) {
      if (active(this)) return capture(this);
      return originalPicker.call(this);
    };
  }
  return true;
}
