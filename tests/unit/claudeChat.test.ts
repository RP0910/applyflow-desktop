import { describe, expect, it, vi } from 'vitest';
import { CLAUDE_PAGE_API } from '../../electron/claudePage';
import { ClaudeError } from '@/services/claude/errors';
import { claudeChatTitle, parseClaudeChatJson, ClaudeChatProvider } from '@/services/claude/chatResume';
import { compactFacts } from '@/prompts/application';
import { runAnalysis, runDocuments } from '@/services/workflow/engine';
import { buildMasterFromForm, emptyBuilder } from '@/services/resume/builder';
import { EMPTY_PROFILE } from '@/storage/repositories';
import type { CvReply } from '@/prompts/cvGenerate';
import { DEFAULT_SETTINGS } from '@/types';
import { emptySession, mockJob } from '../helpers';

const form = emptyBuilder();
form.jobs[0] = { ...form.jobs[0]!, company: 'Example Systems', start: '2020-01', current: true };
const profile = { ...EMPTY_PROFILE, fullName: 'Test Candidate', email: 'candidate@example.com', phone: '555-0100' };
const master = buildMasterFromForm(form, profile, 'Candidate');
const session = emptySession(mockJob(), master.id);
const reply: CvReply = {
  company_name: 'Hiring Co',
  role_title: 'Software Engineer',
  subtitle: 'Software Engineer | TypeScript',
  summary: 'Software engineer building TypeScript services.',
  cover_letter: 'Dear Hiring Team,\n\nI build TypeScript services.\n\nSincerely,\nTest Candidate',
  skill_groups: [{ category: 'Languages', items: ['TypeScript'] }],
  additional_categories: [],
  experience: [{ company: 'Example Systems', role_title: 'Software Engineer', location: 'Austin, TX', dates: '2020 - Present', role_description: 'Built reliable customer platforms.', bullets: ['Developed TypeScript API services with automated regression tests.'] }],
};

describe('Claude.ai chat resume generation', () => {
  it('names each chat with the company and the role', () => {
    expect(claudeChatTitle('  Acme   Corp \n', 'Staff\tEngineer')).toBe('Acme Corp — Staff Engineer');
    expect(claudeChatTitle('', '')).toBe('Company — Role');
    expect(claudeChatTitle('A'.repeat(200), 'Role').length).toBeLessThanOrEqual(120);
  });

  it('reads resume JSON out of a fenced chat reply', () => {
    const text = `Here is the draft.\n\`\`\`json\n${JSON.stringify(reply)}\n\`\`\`\nDone.`;
    expect(parseClaudeChatJson<CvReply>(text).company_name).toBe('Hiring Co');
    expect(() => parseClaudeChatJson('{"company_name": "cut')).toThrow(ClaudeError);
  });

  it('loads the claude.ai page helper', () => {
    expect(() => new Function(CLAUDE_PAGE_API)()).not.toThrow();
    const api = (globalThis as unknown as { __afClaude: { snapshot: () => { composer: boolean; signedOut: boolean } } }).__afClaude;
    const snap = api.snapshot();
    expect(snap.composer).toBe(false);
    expect(snap.signedOut).toBe(false);
  });

  it('uses the chat session for research and the resume, then the existing document pipeline', async () => {
    const titles: string[] = [];
    const cvBodies: string[] = [];
    let cvCalls = 0;
    const research = { companies: [{ periodIndex: 0, name: 'Example Systems', activeYears: '2020-Present', techFit: 'TypeScript services', hq: '' }] };
    const chatComplete = vi.fn(async ({ prompt, title }: { prompt: string; title: string }) => {
      titles.push(title);
      if (prompt.includes('"task":"company_research"')) return { text: '```json\n' + JSON.stringify(research) + '\n```', model: 'claude.ai' };
      cvCalls += 1;
      cvBodies.push(prompt);
      if (cvCalls === 1) return { text: '{"company_name": "Hiring Co"', model: 'claude.ai' };
      return { text: JSON.stringify(reply), model: 'claude.ai (Sonnet 5.5 Medium)' };
    });
    const settings = { ...DEFAULT_SETTINGS, engine: 'claude' as const, resumeGenerationMethod: 'chat' as const };
    const deps = { settings, apiKey: null, chatComplete };
    const analyzed = await runAnalysis(session.job, false, master, profile, deps);
    const result = await runDocuments({ ...session, analysis: analyzed.analysis }, master, profile, deps, 'professional');
    const expected = claudeChatTitle(session.job.company, session.job.title);
    expect(titles.length).toBeGreaterThanOrEqual(2);
    expect(titles.every((title) => title === expected)).toBe(true);
    expect(cvBodies[0]).toContain('<output_schema>');
    expect(cvBodies[0]).toContain('JOB DESCRIPTION');
    expect(cvBodies[0]).not.toContain(profile.email);
    expect(result.resume.contentSource).toBe('cv-generate');
    expect(result.resume.experience[0]?.company).toBe('Example Systems');
    expect(result.resume.model).toBe('claude.ai (Sonnet 5.5 Medium)');
    expect(result.coverLetter?.text).toContain('Dear Hiring Team');
    expect(cvCalls).toBeGreaterThanOrEqual(2);
  });

  it('stops when the Claude.ai session is signed out', async () => {
    const chatComplete = vi.fn(async () => {
      throw new ClaudeError('chat_signed_out');
    });
    const provider = new ClaudeChatProvider({
      settings: { ...DEFAULT_SETTINGS, resumeGenerationMethod: 'chat' },
      apiKey: null,
      chatComplete,
    });
    await expect(provider.researchCompanies(compactFacts(master, profile), { company: 'Acme', title: 'Engineer' }, ['TypeScript'])).rejects.toThrow(/signed out/);
    expect(chatComplete).toHaveBeenCalledTimes(1);
  });
});
