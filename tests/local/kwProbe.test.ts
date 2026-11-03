// @vitest-environment node
import { it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractDiceJob } from '@/services/platforms/dice/adapter';
import { analyzeJobLocally } from '@/services/analysis/localAnalyzer';
import { extractJobKeywords } from '@/services/ats';
import { fixture } from '../helpers';
it.skipIf(!process.env.KW)('kw', () => {
  (globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM('').window.DOMParser;
  const job = extractDiceJob(new JSDOM(fixture(process.env.KW!)).window.document, 'https://www.dice.com/job-detail/5b2e9d10-4a3c-4f1e-8d7a-61c0b9e2f4a8').job!;
  const a = analyzeJobLocally(job, null);
  console.log('REQ', a.requiredSkills.join(', '));
  console.log('PREF', a.preferredSkills.join(', '));
  for (const k of extractJobKeywords(job, a)) console.log(k.kind.padEnd(8), k.importance.padEnd(10), String(k.weight).padEnd(4), k.term, '|', k.forms.join(' / '));
});
