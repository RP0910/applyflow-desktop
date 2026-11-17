/** Development-only page hook. Not part of the packaged application. */
import { createContentController } from '@/content/controller';
import { classifyCapture } from '@/services/applymind/capture';

function installModel(el: HTMLTextAreaElement): void {
  const proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  let tracked = '';
  Object.defineProperty(el, '_valueTracker', { configurable: true, value: { setValue: (v: string) => { tracked = v; }, getValue: () => tracked } });
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
    if (tracked !== el.value) el.setAttribute('data-model', el.value);
  });
}

const controller = createContentController({
  doc: document,
  url: () => 'https://www.dice.com/job-applications/apply/trusted-test',
  version: 'e2e',
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

const essay = () => document.querySelector<HTMLTextAreaElement>('#essay')!;

(window as unknown as { __af: Record<string, () => unknown> }).__af = {
  prepare: () => {
    installModel(essay());
    controller.scan();
    return true;
  },
  fillEssayOld: () => {
    const el = essay();
    el.value = 'A sentence the page keeps.';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.getAttribute('data-model');
  },
  fillEssay: async () => {
    const scan = controller.scan();
    const field = scan.fields.find((f) => /ideal candidate/i.test(f.label));
    if (!field) return { ok: false, model: essay().getAttribute('data-model') };
    const filled = await controller.handle({ type: 'AF_FILL_FIELDS', instructions: [{ fieldId: field.fieldId, kind: 'value', value: 'A sentence the page keeps.' }] });
    const result = filled.results[0];
    return { ok: result?.ok ?? false, error: result?.error ?? null, model: essay().getAttribute('data-model') };
  },
  classes: () => {
    const cap = controller.handle({ type: 'AF_READ_CAPTURE' });
    if (!cap) return [];
    return cap.fields.map((field) => ({ label: field.label, kind: classifyCapture(field), finalValue: field.finalValue }));
  },
};
