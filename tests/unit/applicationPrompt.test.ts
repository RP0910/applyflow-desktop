import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/types';
import { ClaudeProvider } from '@/services/claude/provider';
import { applicationSchema, buildApplicationPrompt, compactFacts, compactJob, compactPlan, systemBlocks, toTailorReply } from '@/prompts/application';
import { TRUTHFULNESS_RULES } from '@/prompts/system';
import { buildTailorResumePrompt } from '@/prompts/tailorResume';
import { buildCoverLetterPrompt } from '@/prompts/coverLetter';
import { candidateFactsForPrompt } from '@/services/resume/facts';
import { promptPlan } from '@/services/tailoring/atsTailor';
import { jobForPrompt, planAts, runAnalysis } from '@/services/workflow/engine';
import { exampleResume, mockJob } from '../helpers';

const job = mockJob();
const master = exampleResume();
master.parsed.contact.email = 'jordan@example.com';
master.parsed.contact.phone = '(312) 555-0148';

describe('one compact Claude request per job', () => {
  it('never sends contact details, and serializes facts the same way every time (so the cache hits)', () => {
    const a = compactFacts(master);
    const b = compactFacts(structuredClone(master));
    expect(a.text).toBe(b.text);
    expect(a.text).not.toMatch(/jordan@example\.com|555-0148|linkedin/i);
    expect(Object.keys(a.jobIds)).toEqual(master.parsed.experience.map((_, i) => `j${i + 1}`));
    expect(a.text).not.toMatch(/\n {2}/); // no pretty-printing
  });

  it('puts a cache breakpoint after the rules and the candidate, and keeps the job out of the cached part', () => {
    const blocks = systemBlocks(compactFacts(master));
    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.cache).toBe(true);
    expect(blocks.map((b) => b.text).join('')).not.toContain(job.company);
  });

  it('drops legal boilerplate from the posting and shortens job ids in the plan', async () => {
    const withEeo = { ...job, description: `${job.description}\n\nWe are an Equal Opportunity Employer and do not discriminate without regard to race.` };
    expect(String(compactJob(withEeo, true).description)).not.toMatch(/Equal Opportunity/);
    const a = await runAnalysis(job, false, master, undefined, { settings: { ...DEFAULT_SETTINGS, engine: 'local' }, apiKey: null });
    const { plan } = planAts(job, a.analysis, master, undefined, 'two_pages');
    const facts = compactFacts(master);
    const cp = compactPlan(promptPlan(plan, master), facts.jobIds);
    expect(Object.keys(cp.bullets as object).every((k) => /^j\d+$/.test(k))).toBe(true);
    for (const row of cp.keywords as unknown[][]) expect(String(row[2])).not.toMatch(/exp:/);
  });

  it('uses fewer input tokens than 1.x (resume + cover letter requests)', async () => {
    const a = await runAnalysis(job, false, master, undefined, { settings: { ...DEFAULT_SETTINGS, engine: 'local' }, apiKey: null });
    const { plan } = planAts(job, a.analysis, master, undefined, 'two_pages');
    const pp = promptPlan(plan, master);
    const facts = compactFacts(master);
    // 1.x: two requests, each with the system rules, the job and the candidate's facts.
    const old =
      TRUTHFULNESS_RULES.length * 2 +
      buildTailorResumePrompt({ job: jobForPrompt(job, true), candidateFacts: candidateFactsForPrompt(master), allowedKeywords: ['a'], forbiddenKeywords: ['b'], length: 'two_pages', suggestedTitle: plan.targetTitle, summaryDirection: '', plan: pp }).length +
      buildCoverLetterPrompt({ job: jobForPrompt(job, true), candidateFacts: candidateFactsForPrompt(master), allowedKeywords: ['a'], forbiddenKeywords: ['b'], tone: 'professional', minWords: 250, maxWords: 400, candidateName: 'J' }).length;
    const cached = systemBlocks(facts).reduce((n, b) => n + b.text.length, 0);
    const perJob = buildApplicationPrompt({ job: compactJob(job, true), plan: compactPlan(pp, facts.jobIds), forbidden: ['b'], length: 'two_pages', summaryHint: '', letter: { tone: 'professional', minWords: 250, maxWords: 400 } }).length;
    const first = cached + perJob;
    // Cached reads are billed at ~10% of normal input.
    const later = cached * 0.1 + perJob;
    console.log(`input characters per job — 1.x: ${old}; 2.0 first job: ${first}; 2.0 next jobs (cache): ~${Math.round(later)}`);
    expect(first).toBeLessThan(old * 0.75);
    expect(later).toBeLessThan(old * 0.4);
  });

  it('asks for the letter only when wanted, and maps the reply back to the master resume ids', () => {
    expect((applicationSchema(true).required as string[]).includes('letter')).toBe(true);
    expect((applicationSchema(false).required as string[]).includes('letter')).toBe(false);
    const facts = compactFacts(master);
    const r = toTailorReply({ headline: 'h', summary: 's', skills: [{ group: 'Languages', items: ['Java'] }], jobs: [{ id: 'j1', bullets: ['b'], tech: ['Java'] }], projects: [], certs: [0], gaps: ['LLMs'] }, facts.jobIds);
    expect(r.experience[0]!.sourceId).toBe(master.parsed.experience[0]!.id);
    expect(r.skillGroups).toEqual([{ name: 'Languages', skills: ['Java'] }]);
    expect(r.unsupportedRequirements).toEqual(['LLMs']);
  });

  it('sends system blocks with cache_control and reports cached tokens', async () => {
    const reply = { headline: 'h', summary: 's', skills: [], jobs: [], projects: [], certs: [], gaps: [], letter: ['Dear Hiring Team,', 'Body.', 'Sincerely,\nJ'] };
    const f = vi.fn(async () => new Response(JSON.stringify({ model: 'claude-sonnet-5-5', content: [{ type: 'text', text: JSON.stringify(reply) }], stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 1500, cache_read_input_tokens: 4100, cache_creation_input_tokens: 0 } }), { status: 200 }));
    const usage = vi.fn();
    const p = new ClaudeProvider('sk-ant-test', DEFAULT_SETTINGS, { fetchImpl: f as unknown as typeof fetch, sleep: async () => undefined, isOnline: () => true, onUsage: usage });
    const out = await p.writeApplication(compactFacts(master), { job: compactJob(job, true), plan: {}, forbidden: [], length: 'two_pages', summaryHint: '', letter: { tone: 'professional', minWords: 250, maxWords: 400 } });
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(f).toHaveBeenCalledTimes(1);
    expect(body.system[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.output_config.format.schema.required).toContain('letter');
    expect(out.data.letter).toHaveLength(3);
    expect(usage).toHaveBeenCalledWith('application', 'claude-sonnet-5-5', { inputTokens: 900, outputTokens: 1500, cacheReadTokens: 4100, cacheWriteTokens: 0 });
  });

  it('can use a 1-hour cache or none', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ model: 'm', content: [{ type: 'text', text: '{"letter":["x"]}' }], stop_reason: 'end_turn', usage: {} }), { status: 200 }));
    const run = async (promptCache: '1h' | 'off') => {
      const p = new ClaudeProvider('sk-ant-test', { ...DEFAULT_SETTINGS, promptCache }, { fetchImpl: f as unknown as typeof fetch, sleep: async () => undefined, isOnline: () => true });
      await p.writeLetter(compactFacts(master), { job: {}, forbidden: [], tone: 'warm', minWords: 200, maxWords: 300, current: null, action: null });
      return JSON.parse(String((f.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body)).system[1].cache_control;
    };
    expect(await run('1h')).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(await run('off')).toBeUndefined();
  });
});

describe('job posting cleanup', () => {
  it('drops legal sentences, never the whole posting, even without paragraph breaks', () => {
    const one = 'We build payment APIs in Go and Kafka. You will design services on AWS. We are an Equal Opportunity Employer. Background check required.';
    const out = String(compactJob({ ...mockJob(), description: one }, true).description);
    expect(out).toMatch(/payment APIs in Go and Kafka/);
    expect(out).not.toMatch(/Equal Opportunity/);
    const legalHeavy = 'Equal opportunity employer. Background check. Drug-free workplace. E-Verify. Write Go.';
    expect(String(compactJob({ ...mockJob(), description: legalHeavy }, true).description)).toMatch(/Write Go/);
  });
});
