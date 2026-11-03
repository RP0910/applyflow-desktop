/**
 * Minimal Anthropic Messages API client.
 *  - The key is passed in per call (desktop: decrypted from the OS keychain) and never logged.
 *  - Requests go directly to api.anthropic.com — never through a developer server.
 *  - Prompt caching: system blocks marked `cache` are cached by the API, so the rules and the
 *    candidate's facts — identical for every job — are billed at the cached rate after the first job.
 */
import type { ApiVersion, ModelOption } from '@/types';
import { ClaudeError, errorFromResponse } from './errors';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

export interface ClientConfig {
  apiKey: string;
  apiVersion: ApiVersion;
  timeoutMs: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  isOnline?: () => boolean;
}

/** A system prompt block. `cache: true` puts a cache breakpoint after it. */
export interface SystemBlock {
  text: string;
  cache?: boolean;
}

export interface MessageRequest {
  model: string;
  system: string | SystemBlock[];
  /** Prompt-cache lifetime for cached system blocks. */
  cacheTtl?: '5m' | '1h' | 'off';
  user: string;
  maxTokens: number;
  /** JSON Schema for structured output. Falls back to prompt-only JSON if the model rejects it. */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  /** output_config.effort — dropped automatically if the model doesn't support it. */
  effort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
}

export interface MessageResult {
  text: string;
  model: string;
  stopReason: string | null;
  usage: Usage;
  requestId: string | null;
}

export interface Usage {
  /** Uncached input tokens. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface RawMessage {
  model?: string;
  content?: { type: string; text?: string }[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class AnthropicClient {
  private readonly cfg: Required<Omit<ClientConfig, 'fetchImpl'>> & { fetchImpl: typeof fetch };

  constructor(cfg: ClientConfig) {
    if (!cfg.apiKey) throw new ClaudeError('no_key');
    this.cfg = {
      maxRetries: 2,
      sleep: defaultSleep,
      isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
      ...cfg,
      fetchImpl: cfg.fetchImpl ?? fetch.bind(globalThis),
    };
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': this.cfg.apiVersion,
      // Required by the API for requests that originate from a browser context.
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    if (this.cfg.apiVersion === '2023-06-01') h['x-api-key'] = this.cfg.apiKey;
    else h.authorization = `Bearer ${this.cfg.apiKey}`;
    return h;
  }

  private async request(path: string, init: { method: string; body?: string; signal?: AbortSignal }): Promise<{ json: unknown; requestId: string | null }> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (!this.cfg.isOnline()) throw new ClaudeError('offline');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), this.cfg.timeoutMs);
      const onOuterAbort = () => controller.abort(init.signal?.reason);
      init.signal?.addEventListener('abort', onOuterAbort, { once: true });
      try {
        const res = await this.cfg.fetchImpl(`${ANTHROPIC_BASE_URL}${path}`, {
          method: init.method,
          headers: this.headers(),
          body: init.body,
          signal: controller.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        const requestId = res.headers.get('request-id');
        let json: unknown = null;
        try {
          json = await res.json();
        } catch {
          json = null;
        }
        if (!res.ok) {
          const err = errorFromResponse(res.status, json as Parameters<typeof errorFromResponse>[1], res.headers);
          if (err.retryable && attempt < this.cfg.maxRetries) {
            attempt++;
            await this.cfg.sleep(Math.min(err.retryAfterMs ?? 1000 * 3 ** (attempt - 1), 20_000));
            continue;
          }
          throw err;
        }
        return { json, requestId };
      } catch (e: unknown) {
        if (e instanceof ClaudeError) throw e;
        if (init.signal?.aborted) throw new ClaudeError('aborted');
        const isTimeout = controller.signal.aborted;
        const err = new ClaudeError(isTimeout ? 'timeout' : 'network', { retryable: true, detail: String(e) });
        if (attempt < this.cfg.maxRetries && !isTimeout) {
          attempt++;
          await this.cfg.sleep(1000 * 3 ** (attempt - 1));
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
        init.signal?.removeEventListener('abort', onOuterAbort);
      }
    }
  }

  async createMessage(req: MessageRequest): Promise<MessageResult> {
    let useEffort = Boolean(req.effort);
    let useSchema = Boolean(req.jsonSchema);
    let useCache = req.cacheTtl !== 'off';
    let maxTokens = req.maxTokens;
    let truncatedOnce = false;
    // Tokens of an attempt that was cut off are billed too.
    const spent = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

    const build = (): Record<string, unknown> => {
      const body: Record<string, unknown> = {
        model: req.model,
        max_tokens: maxTokens,
        system: systemFor(req.system, useCache ? req.cacheTtl ?? '5m' : 'off'),
        messages: [{ role: 'user', content: req.user }],
      };
      // temperature was removed in API version 2026-10-21; only send it on the legacy version.
      if (req.temperature !== undefined && this.cfg.apiVersion === '2023-06-01') body.temperature = req.temperature;
      const oc: Record<string, unknown> = {};
      if (useSchema) oc.format = { type: 'json_schema', schema: req.jsonSchema };
      // Thinking tokens count toward max_tokens; lower effort keeps short writing tasks fast and un-truncated.
      if (useEffort) oc.effort = req.effort;
      if (Object.keys(oc).length) body.output_config = oc;
      return body;
    };

    // Up to 4 attempts: drop an unsupported option, or retry once with a larger budget after truncation.
    for (let attempt = 0; attempt < 5; attempt++) {
      let raw: { json: unknown; requestId: string | null };
      try {
        raw = await this.request('/v1/messages', { method: 'POST', body: JSON.stringify(build()), signal: req.signal });
      } catch (e: unknown) {
        const detail = e instanceof ClaudeError && e.code === 'bad_request' ? e.detail ?? '' : '';
        if (useEffort && /effort/i.test(detail)) {
          useEffort = false;
          continue;
        }
        if (useSchema && /output_config|format|schema/i.test(detail)) {
          useSchema = false;
          continue;
        }
        if (useCache && /cache_control|ttl/i.test(detail)) {
          useCache = false;
          continue;
        }
        throw e;
      }
      const msg = raw.json as RawMessage;
      const text = (msg.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('');
      if (msg.stop_reason === 'refusal') throw new ClaudeError('refusal', { requestId: raw.requestId ?? undefined });
      if (msg.stop_reason === 'max_tokens') {
        spent.input += msg.usage?.input_tokens ?? 0;
        spent.output += msg.usage?.output_tokens ?? 0;
        spent.cacheRead += msg.usage?.cache_read_input_tokens ?? 0;
        spent.cacheWrite += msg.usage?.cache_creation_input_tokens ?? 0;
        if (!truncatedOnce) {
          truncatedOnce = true;
          maxTokens = Math.min(64_000, maxTokens * 2);
          continue;
        }
        throw new ClaudeError('truncated', { requestId: raw.requestId ?? undefined });
      }
      return {
        text,
        model: msg.model ?? req.model,
        stopReason: msg.stop_reason ?? null,
        usage: {
          inputTokens: (msg.usage?.input_tokens ?? 0) + spent.input,
          outputTokens: (msg.usage?.output_tokens ?? 0) + spent.output,
          cacheReadTokens: (msg.usage?.cache_read_input_tokens ?? 0) + spent.cacheRead,
          cacheWriteTokens: (msg.usage?.cache_creation_input_tokens ?? 0) + spent.cacheWrite,
        },
        requestId: raw.requestId,
      };
    }
    throw new ClaudeError('bad_request', { detail: 'Request options could not be negotiated with this model.' });
  }

  /** GET /v1/models — newest first. Paginates up to 5 pages. */
  async listModels(): Promise<ModelOption[]> {
    const out: ModelOption[] = [];
    let after: string | null = null;
    for (let page = 0; page < 5; page++) {
      const qs = new URLSearchParams({ limit: '100' });
      if (after) qs.set('after_id', after);
      const { json } = await this.request(`/v1/models?${qs.toString()}`, { method: 'GET' });
      const data = json as {
        data?: { id: string; display_name?: string; lifecycle?: string }[];
        has_more?: boolean;
        last_id?: string;
      };
      for (const m of data.data ?? []) {
        const lifecycle = m.lifecycle === 'active' || m.lifecycle === 'deprecated' || m.lifecycle === 'retired' ? m.lifecycle : 'unknown';
        if (lifecycle === 'retired') continue;
        out.push({ id: m.id, displayName: m.display_name ?? m.id, lifecycle, source: 'api' });
      }
      if (!data.has_more || !data.last_id) break;
      after = data.last_id;
    }
    return out;
  }
}

/** System prompt in the API's shape: a plain string, or text blocks with cache breakpoints. */
export function systemFor(system: string | SystemBlock[], ttl: '5m' | '1h' | 'off'): string | Record<string, unknown>[] {
  if (typeof system === 'string') return system;
  return system.map((b) => {
    const block: Record<string, unknown> = { type: 'text', text: b.text };
    if (b.cache && ttl !== 'off') block.cache_control = ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
    return block;
  });
}

/** Parse JSON from a model reply, tolerating code fences or leading prose. */
export function parseJsonReply<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
    throw new ClaudeError('parse', { detail: text.slice(0, 200) });
  }
}
