import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { __resetDb } from '@/storage/db';
import { __resetMemoryStorage } from '@/storage/chromeStorage';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setFontLoader } from '@/services/export/fonts';

setFontLoader(async (file) => {
  const b = readFileSync(resolve(__dirname, '../public/fonts', file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
});

if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined' || !(globalThis as { CSS?: { escape?: unknown } }).CSS?.escape) {
  (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`) };
}
if (!URL.createObjectURL) {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => undefined;
}

beforeEach(async () => {
  await __resetDb();
  globalThis.indexedDB = new IDBFactory();
  __resetMemoryStorage();
});

afterEach(() => {
  cleanup();
});
