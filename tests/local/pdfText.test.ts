// @vitest-environment node
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { readPdf } from '@/services/resume/fileReaders';
import { parseResumeText } from '@/services/resume/parser';
async function nodeLoader(data: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, disableFontFace: true }).promise as never;
}
it.skipIf(!process.env.PDF_IN)('dump', async () => {
  const b = readFileSync(process.env.PDF_IN!);
  const text = await readPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, nodeLoader);
  writeFileSync(process.env.PDF_IN! + '.txt', text);
  writeFileSync(process.env.PDF_IN! + '.json', JSON.stringify(parseResumeText(text), null, 1));
});
