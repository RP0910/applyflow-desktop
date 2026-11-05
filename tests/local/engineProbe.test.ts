// @vitest-environment node
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { readPdf } from '@/services/resume/fileReaders';
import { buildMasterResume } from '@/services/resume/facts';
import { extractDiceJob } from '@/services/platforms/dice/adapter';
import { runAnalysis, runTailoring } from '@/services/workflow/engine';
import { DEFAULT_SETTINGS } from '@/types';
import { resumeToPdf } from '@/services/export/pdf';
import { resumeToDocx } from '@/services/export/docx';
import { resumeToText } from '@/services/export/render';
import { parseCheckPdf } from '@/services/ats/parseCheck';
import { scanTailored } from '@/services/workflow/engine';
import { setFontLoader } from '@/services/export/fonts';
import { fixture, emptySession } from '../helpers';

async function nodeLoader(data: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, disableFontFace: true }).promise as never;
}

it.skipIf(!process.env.USER_PDF)('engine probe', async () => {
  (globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM('').window.DOMParser;
  setFontLoader(async (f) => {
    const b = readFileSync(resolve(__dirname, '../../public/fonts', f));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });
  const buf = readFileSync(process.env.USER_PDF!);
  const text = await readPdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, nodeLoader);
  const master = buildMasterResume('Master', text, 'pdf', 'r.pdf');
  const job = extractDiceJob(new JSDOM(fixture(process.env.JOB ?? 'job-detail-video-playback.html')).window.document, 'https://www.dice.com/job-detail/5b2e9d10-4a3c-4f1e-8d7a-61c0b9e2f4a8').job!;
  const settings = { ...DEFAULT_SETTINGS, engine: 'local' as const };
  const a = await runAnalysis(job, false, master, undefined, { settings, apiKey: null });
  const session = { ...emptySession(job, master.id), analysis: a.analysis, evidence: a.evidence };
  const r = await runTailoring(session, master, undefined, { settings, apiKey: null });
  const pdf = await resumeToPdf(r.resume, settings.resumeFormat);
  const parse = await parseCheckPdf(pdf, r.resume, nodeLoader);
  const rep = scanTailored(r.resume, r.atsPlan, master, settings, parse);
  const out = process.env.USER_OUT!;
  writeFileSync(`${out}.pdf`, pdf);
  writeFileSync(`${out}.docx`, Buffer.from(await (await resumeToDocx(r.resume, settings.resumeFormat)).arrayBuffer()));
  writeFileSync(`${out}.txt`, resumeToText(r.resume, settings.resumeFormat));
  console.log('MASTER ATS', r.atsMaster.score, 'TAILORED ATS', rep.score, 'reachable', rep.reachable);
  for (const c of rep.categories) console.log('  ', c.label, c.score, '/', c.max, c.applicable ? '' : '(n/a)', c.detail);
  for (const c of rep.checks) console.log('  ', c.status, c.label, c.detail ?? '');
  console.log('ISSUES', JSON.stringify(r.resume.issues.map((i) => [i.severity, i.code, i.message])));
  console.log('PARSE', JSON.stringify(parse));
}, 60000);
