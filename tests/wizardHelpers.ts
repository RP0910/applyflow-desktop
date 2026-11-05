import { createRequire } from 'node:module';
import type { UploadDeps } from '@/services/forms/upload';

const require = createRequire(import.meta.url);

export const { mountDiceWizard } = require('./fixtures/dice/mock-dice-wizard.cjs') as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mountDiceWizard: (doc: Document, opts?: Record<string, unknown>) => { state: Record<string, any> };
};

export const testUploadDeps: UploadDeps = {
  sleep: () => new Promise((r) => setTimeout(r, 0)),
  setFiles: (input, file) => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  drop: (target, file) => {
    const e = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: { files: [file] } });
    target.dispatchEvent(e);
  },
  verifyMs: 60,
};
