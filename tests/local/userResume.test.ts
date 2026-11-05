// @vitest-environment node
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { readPdf } from '@/services/resume/fileReaders';
import { parseResumeText } from '@/services/resume/parser';

async function nodeLoader(data: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, disableFontFace: true }).promise as never;
}

it.skipIf(!process.env.USER_PDF)('reads the resume at USER_PDF', async () => {
  const buf = readFileSync(process.env.USER_PDF!);
  const text = await readPdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, nodeLoader);
  const p = parseResumeText(text);
  if (process.env.USER_OUT) {
    writeFileSync(`${process.env.USER_OUT}.txt`, text);
    writeFileSync(`${process.env.USER_OUT}.json`, JSON.stringify(p, null, 2));
  }
}, 60000);
