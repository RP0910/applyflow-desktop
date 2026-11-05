import type { Settings } from '@/types';
import type { CompanyResearchReply } from '@/prompts/companyResearch';
import { COMPANY_RESEARCH_SYSTEM, companyResearchUser, validateCompanyResearch } from '@/prompts/companyResearch';
import type { CompactFacts } from '@/prompts/application';
import { cvSystem, cvUser, validateCv, type CvReply } from '@/prompts/cvGenerate';
import { bridge, type ClaudeChatCompleteResult } from '@/platform/bridge';
import { newId } from '@/utils/id';
import { ClaudeError } from './errors';
import { ClaudeProvider, type ProviderResult, type UsageReporter } from './provider';

export interface ChatCompleteRequest {
  prompt: string;
  title: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ChatResumeDeps {
  settings: Settings;
  apiKey: string | null;
  onUsage?: UsageReporter;
  providerFactory?: (apiKey: string, settings: Settings) => ClaudeProvider;
  chatComplete?: (req: ChatCompleteRequest) => Promise<{ text: string; model: string }>;
}

export function claudeChatTitle(company: unknown, role: unknown): string {
  return claudeChatTitlePrefix('', company, role);
}

export function claudeChatResearchTitle(company: unknown, role: unknown): string {
  return claudeChatTitlePrefix('Research — ', company, role);
}

function claudeChatTitlePrefix(prefix: string, company: unknown, role: unknown): string {
  const one = (value: unknown, fallback: string) => {
    const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
    return text || fallback;
  };
  const title = `${prefix}${one(company, 'Company')} — ${one(role, 'Role')}`;
  const chars = [...title];
  return chars.length > 120 ? `${chars.slice(0, 119).join('')}…` : title;
}

export function buildClaudeChatPrompt(system: string, user: string): string {
  return `${system.trim()}\n\n${user.trim()}\n\nReply with one JSON object only. No markdown fences and no text before or after the JSON.`;
}

export function parseClaudeChatJson<T>(text: string): T {
  const objects = topLevelJsonObjects(text);
  const parsed: unknown[] = [];
  for (const raw of objects) {
    try { parsed.push(JSON.parse(raw) as unknown); } catch {  }
  }
  const picked = pickPayload(parsed);
  if (picked !== undefined) return picked as T;
  if (text.includes('{')) throw new ClaudeError('truncated', { retryable: true, detail: text.slice(0, 180) });
  throw new ClaudeError('parse', { retryable: true, detail: text.slice(0, 180) });
}

export class ClaudeChatProvider {
  private apiProvider: ClaudeProvider | null = null;

  constructor(private readonly deps: ChatResumeDeps) {}

  analyzeJob(...args: Parameters<ClaudeProvider['analyzeJob']>): ReturnType<ClaudeProvider['analyzeJob']> {
    return this.api().analyzeJob(...args);
  }

  writeApplication(...args: Parameters<ClaudeProvider['writeApplication']>): ReturnType<ClaudeProvider['writeApplication']> {
    return this.api().writeApplication(...args);
  }

  refineApplication(...args: Parameters<ClaudeProvider['refineApplication']>): ReturnType<ClaudeProvider['refineApplication']> {
    return this.api().refineApplication(...args);
  }

  writeLetter(...args: Parameters<ClaudeProvider['writeLetter']>): ReturnType<ClaudeProvider['writeLetter']> {
    return this.api().writeLetter(...args);
  }

  researchCompanies(_facts: CompactFacts, job: Record<string, unknown>, tech: string[], signal?: AbortSignal): Promise<ProviderResult<CompanyResearchReply>> {
    const prompt = buildClaudeChatPrompt(COMPANY_RESEARCH_SYSTEM, companyResearchUser(job, tech));
    return this.attempt(claudeChatResearchTitle(job.company, job.title), prompt, signal, (text, model) => {
      const data = parseClaudeChatJson<CompanyResearchReply>(text);
      validateCompanyResearch(data);
      return { data, model };
    });
  }

  generateCv(facts: CompactFacts, job: Record<string, unknown>, signal?: AbortSignal, revision?: string): Promise<ProviderResult<CvReply>> {
    const system = cvSystem(facts).map((block) => block.text).join('\n\n');
    const prompt = buildClaudeChatPrompt(system, cvUser(job, revision));
    const count = Object.keys(facts.jobIds).length;
    return this.attempt(claudeChatTitle(job.company, job.title), prompt, signal, (text, model) => {
      const data = parseClaudeChatJson<CvReply>(text);
      validateCv(data, count);
      return { data, model };
    });
  }

  private api(): ClaudeProvider {
    if (this.apiProvider) return this.apiProvider;
    if (this.deps.providerFactory) {
      this.apiProvider = this.deps.providerFactory(this.deps.apiKey ?? '', this.deps.settings);
      return this.apiProvider;
    }
    this.apiProvider = new ClaudeProvider(this.deps.apiKey, this.deps.settings, { onUsage: this.deps.onUsage });
    return this.apiProvider;
  }

  private timeoutMs(): number {
    return Math.min(600, Math.max(180, this.deps.settings.requestTimeoutSeconds)) * 1000;
  }

  private async attempt<T>(title: string, prompt: string, signal: AbortSignal | undefined, accept: (text: string, model: string) => T): Promise<T> {
    let last: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (signal?.aborted) throw new ClaudeError('aborted');
      const extra = attempt === 1 ? '' : '\n\nYour previous reply was incomplete or invalid. Return one complete JSON object only, with no markdown.';
      try {
        const { text, model } = await this.ask(`${prompt}${extra}`, title, signal);
        return accept(text, model);
      } catch (e) {
        last = e;
        const again = canRetry(e) && attempt < 3;
        if (!again) throw present(e);
        await pause(1200, signal);
      }
    }
    throw present(last);
  }

  private async ask(prompt: string, title: string, signal?: AbortSignal): Promise<{ text: string; model: string }> {
    if (signal?.aborted) throw new ClaudeError('aborted');
    const timeoutMs = this.timeoutMs();
    if (this.deps.chatComplete) return this.deps.chatComplete({ prompt, title, timeoutMs, signal });
    const b = bridge();
    if (!b) throw new ClaudeError('chat_unavailable');
    const requestId = newId('chat');
    const onAbort = () => { void b.invoke('claudeChat.cancel', requestId).catch(() => undefined); };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await b.invoke('claudeChat.complete', { requestId, prompt, title, timeoutMs });
      if (signal?.aborted) throw new ClaudeError('aborted');
      if (!res.ok) throw chatFailure(res);
      return { text: res.text, model: res.model || 'claude.ai' };
    } catch (e) {
      if (e instanceof ClaudeError) throw e;
      throw new ClaudeError('chat_unavailable', { retryable: true, detail: e instanceof Error ? e.message : '' });
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

function present(e: unknown): Error {
  if (e instanceof ClaudeError && e.code === 'truncated' && /message box|Send|prompt/i.test(e.detail ?? '')) {
    return new ClaudeError('chat_unavailable', { detail: e.detail });
  }
  return e instanceof Error ? e : new ClaudeError('parse');
}

function canRetry(e: unknown): boolean {
  if (e instanceof ClaudeError) {
    if (e.code === 'aborted' || e.code === 'chat_signed_out' || e.code === 'refusal' || e.code === 'no_key' || e.code === 'timeout') return false;
    if (e.code === 'chat_unavailable') return e.retryable;
    return e.retryable || e.code === 'parse' || e.code === 'truncated' || e.code === 'rate_limit' || e.code === 'overloaded' || e.code === 'server';
  }
  return e instanceof Error;
}

function chatFailure(res: Extract<ClaudeChatCompleteResult, { ok: false }>): ClaudeError {
  switch (res.code) {
    case 'signed_out': return new ClaudeError('chat_signed_out', { detail: res.detail });
    case 'challenge': return new ClaudeError('chat_unavailable', { detail: res.detail });
    case 'timeout': return new ClaudeError('timeout', { detail: res.detail });
    case 'cancelled': return new ClaudeError('aborted', { detail: res.detail });
    case 'limit': return new ClaudeError('rate_limit', { retryable: true, detail: res.detail });
    case 'empty':
    case 'input': return new ClaudeError('truncated', { retryable: true, detail: res.detail });
    default: return new ClaudeError('chat_unavailable', { detail: res.detail });
  }
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new ClaudeError('aborted')); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(new ClaudeError('aborted')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function topLevelJsonObjects(text: string): string[] {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) depth--;
      if (depth === 0 && start >= 0) {
        out.push(cleaned.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

function pickPayload(parsed: unknown[]): unknown | undefined {
  const objs = parsed.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v));
  const resume = [...objs].reverse().find((o) => typeof o.company_name === 'string' && Array.isArray(o.experience));
  if (resume) return resume;
  const research = [...objs].reverse().find((o) => Array.isArray(o.companies));
  if (research) return research;
  return objs.length ? objs[objs.length - 1] : undefined;
}
