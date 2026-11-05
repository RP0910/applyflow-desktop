// @vitest-environment node
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readPdf } from '@/services/resume/fileReaders';
import { buildMasterResume } from '@/services/resume/facts';
import { extractDiceJob } from '@/services/platforms/dice/adapter';
import { analyzeJobLocally } from '@/services/analysis/localAnalyzer';
import { extractJobKeywords, buildAtsPlan, scanResume, docFromMaster } from '@/services/ats';
import { JSDOM } from 'jsdom';
import { fixture } from '../helpers';

async function nodeLoader(data: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, disableFontFace: true }).promise as never;
}

it.skipIf(!process.env.USER_PDF)('ATS probe', async () => {
  (globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM('').window.DOMParser;
  const buf = readFileSync(process.env.USER_PDF!);
  const text = await readPdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, nodeLoader);
  const master = buildMasterResume('Master', text, 'pdf', 'r.pdf');
  const job = extractDiceJob(new JSDOM(fixture(process.env.JOB ?? 'job-detail-video-playback.html')).window.document, 'https://www.dice.com/job-detail/5b2e9d10-4a3c-4f1e-8d7a-61c0b9e2f4a8').job!;
  const analysis = analyzeJobLocally(job, master);
  const kws = extractJobKeywords(job, analysis);
  const plan = buildAtsPlan(job, master, undefined, kws, 'two_pages', analysis.requiredYears, new Date('2026-10-30'));
  console.log('TITLE', plan.targetTitle, plan.titleSource, 'YEARS', plan.years, 'BUDGET', JSON.stringify(plan.bulletBudget));
  for (const k of plan.keywords) console.log(k.support.padEnd(10), k.kind.padEnd(8), k.importance.padEnd(10), String(k.weight).padEnd(4), k.term, '|', k.forms.slice(1, 5).join(' / '), k.relatedTo ? `(near ${k.relatedTo})` : '', k.placements.join(','));
  const rep = scanResume(docFromMaster(master), { plan, masterJobs: master.parsed.experience.length, computedFor: 'master', now: new Date('2026-10-30') });
  console.log('MASTER SCORE', rep.score, 'reachable', rep.reachable);
  for (const c of rep.categories) console.log('  ', c.label, c.score, '/', c.max, c.applicable ? '' : '(n/a)', c.detail);
  for (const c of rep.checks) console.log('  ', c.status, c.label, c.detail ?? '');
}, 60000);
