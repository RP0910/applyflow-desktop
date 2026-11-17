import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const enabled = process.env.APPLYFLOW_E2E === '1';

describe.skipIf(!enabled)('trusted page input', () => {
  it('classifies typing, a dropdown choice, a pre-fill, and a filler essay after Continue', async () => {
    const result = join(mkdtempSync(join(tmpdir(), 'af-trusted-')), 'result.json');
    await new Promise<void>((done, reject) => {
      execFile(process.execPath, ['tests/e2e/run.mjs', result], { cwd: resolve(dirname(fileURLToPath(import.meta.url)), '../..') }, (error) => (error ? reject(error) : done()));
    });
    const body = JSON.parse(readFileSync(result, 'utf8')) as {
      ok: boolean;
      oldModel: string;
      filled: { model: string | null };
      classes: { label: string; kind: string; finalValue: string }[];
    };
    expect(body.ok).toBe(true);
    expect(body.oldModel).toBe('');
    expect(body.filled.model).toBe('A sentence the page keeps.');
    const kind = Object.fromEntries(body.classes.map((row) => [row.label, row.kind]));
    expect(kind.City).toBe('verified');
    expect(kind.Level).toBe('verified');
    expect(kind.Phone).toBe('prefill');
    expect(kind['Explain why you are the ideal candidate']).toBe('accepted');
    expect(body.classes.find((row) => row.label === 'City')?.finalValue).toBe('Tampa');
    expect(body.classes.find((row) => row.label === 'Level')?.finalValue).toBe("Bachelor's");
  }, 120_000);
});
