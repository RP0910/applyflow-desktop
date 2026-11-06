import type { Settings } from '@/types';
import { COMPANY_RESEARCH_SYSTEM, companyResearchUser, validateCompanyResearch, type CompanyResearchReply } from '@/prompts/companyResearch';
import { ROLE_TITLES_SYSTEM, roleTitlesUser, validateRoleTitlesReply, type RoleTitlesReply } from '@/prompts/roleTitles';
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
  model?: string;
  modelName?: string;
  effort?: Settings['effort'];
}

export interface ChatResumeDeps {
  settings: Settings;
  apiKey: string | null;
  onUsage?: UsageReporter;
  providerFactory?: (apiKey: string, settings: Settings) => ClaudeProvider;
  chatComplete?: (req: ChatCompleteRequest) => Promise<{ text: string; model: string }>;
  /** Progress line in the panel; used to say why an attempt is being retried. */
  onStatus?: (line: string) => void;
}

export function claudeChatTitle(company: unknown, role: unknown): string {
  return claudeChatTitlePrefix('', company, role);
}

export function claudeChatResearchTitle(company: unknown, role: unknown): string {
  return claudeChatTitlePrefix('Research — ', company, role);
}

export function claudeChatRoleTitlesTitle(company: unknown, role: unknown): string {
  return claudeChatTitlePrefix('Titles — ', company, role);
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

/** Claude.ai may answer with typographic quotes, which are not valid JSON. */
const CHAT_JSON_QUOTES = 'Write the JSON with plain ASCII straight double quotes ("), never curly quotes (“ ”). Inside string values, use single quotes instead of double quotes.';

export function buildClaudeChatPrompt(system: string, user: string): string {
  return `${system.trim()}\n\n${user.trim()}\n\nReply with one JSON object only. No markdown fences and no text before or after the JSON. ${CHAT_JSON_QUOTES}`;
}

export function parseClaudeChatJson<T>(text: string): T {
  const objects = topLevelJsonObjects(text);
  const parsed: unknown[] = [];
  for (const raw of objects) {
    try { parsed.push(JSON.parse(raw) as unknown); } catch {  }
  }
  const picked = pickPayload(parsed);
  if (picked !== undefined) return picked as T;
  if (text.includes('{')) {
    throw new ClaudeError('truncated', {
      retryable: true,
      detail:
        'Claude.ai’s reply was cut off before ApplyFlow had complete JSON. Wait until Claude.ai finishes writing, then run Tailor again. For large resumes, use Claude API in Settings or fewer jobs in Profile.',
    });
  }
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

  suggestRoleTitles(
    job: Record<string, unknown>,
    periodCount: number,
    signal?: AbortSignal,
  ): Promise<ProviderResult<RoleTitlesReply>> {
    const prompt = buildClaudeChatPrompt(ROLE_TITLES_SYSTEM, roleTitlesUser(job, periodCount));
    return this.attempt(claudeChatRoleTitlesTitle(job.company, job.title), prompt, signal, (text, model) => {
      const data = parseClaudeChatJson<RoleTitlesReply>(text);
      validateRoleTitlesReply(data, periodCount);
      return { data, model };
    });
  }

  generateCv(facts: CompactFacts, job: Record<string, unknown>, signal?: AbortSignal, revision?: string): Promise<ProviderResult<CvReply>> {
    const system = cvSystem(facts).map((block) => block.text).join('\n\n');
    const prompt = buildClaudeChatPrompt(system, cvUser(job, revision, facts));
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
      const extra = attempt === 1 ? '' : `\n\nYour previous reply was incomplete or invalid. Return one complete JSON object only, with no markdown. ${CHAT_JSON_QUOTES}`;
      try {
        const { text, model } = await this.ask(`${prompt}${extra}`, title, signal);
        return accept(text, model);
      } catch (e) {
        last = e;
        const again = canRetry(e) && attempt < 3;
        if (!again) throw present(e);
        const shown = present(e);
        const why = ((shown instanceof ClaudeError && shown.detail) || shown.message).replace(/\s+/g, ' ').trim().slice(0, 140).replace(/[.\s]+$/, '');
        this.deps.onStatus?.(`Claude.ai try ${attempt} of 3 didn’t work${why ? `: ${why}` : ''}. Trying again…`);
        await pause(1200, signal);
      }
    }
    throw present(last);
  }

  private chatModel(): { model: string; modelName: string; effort: Settings['effort'] } {
    const { model, availableModels, effort } = this.deps.settings;
    const known = availableModels.find((m) => m.id === model);
    return { model, modelName: known?.displayName || model, effort };
  }

  private async ask(prompt: string, title: string, signal?: AbortSignal): Promise<{ text: string; model: string }> {
    if (signal?.aborted) throw new ClaudeError('aborted');
    const timeoutMs = this.timeoutMs();
    const model = this.chatModel();
    if (this.deps.chatComplete) return this.deps.chatComplete({ prompt, title, timeoutMs, signal, ...model });
    const b = bridge();
    if (!b) throw new ClaudeError('chat_unavailable');
    const requestId = newId('chat');
    const onAbort = () => { void b.invoke('claudeChat.cancel', requestId).catch(() => undefined); };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await b.invoke('claudeChat.complete', { requestId, prompt, title, timeoutMs, ...model });
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
      return new ClaudeError('truncated', { retryable: true, detail: res.detail });
    case 'input': {
      const d = res.detail ?? '';
      if (/time limit|background tab|fresh Claude\.ai tab/i.test(d)) {
        return new ClaudeError('chat_unavailable', { retryable: true, detail: d });
      }
      if (/did not switch this chat|plan upgrade for|did not show its model menu/i.test(d)) {
        return new ClaudeError('chat_unavailable', { detail: d });
      }
      if (/without the JSON|incomplete/i.test(d)) {
        return new ClaudeError('truncated', { retryable: true, detail: d });
      }
      return new ClaudeError('truncated', { retryable: true, detail: d });
    }
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
  // The later object wins: a titles reply follows company research when both are on the page.
  const keyed = [...objs].reverse().find((o) => Array.isArray(o.roles) || Array.isArray(o.companies));
  if (keyed) return keyed;
  return objs.length ? objs[objs.length - 1] : undefined;
}
