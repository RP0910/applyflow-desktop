import { describe, expect, it, vi } from 'vitest';
import { ClaudeProvider } from '@/services/claude/provider';
import { AnthropicClient, parseJsonReply } from '@/services/claude/client';
import { ClaudeError, errorFromResponse } from '@/services/claude/errors';
import { DEFAULT_SETTINGS } from '@/types';
import { redact, maskApiKey } from '@/utils/logger';

const KEY = 'sk-ant-api03-TESTKEY1234567890abcdef';

function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

const ok = (text: string, extra: Record<string, unknown> = {}) =>
  res(200, { model: 'claude-sonnet-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, ...extra });

function provider(fetchImpl: typeof fetch, settings = {}) {
  return new ClaudeProvider(KEY, { ...DEFAULT_SETTINGS, ...settings }, { fetchImpl, sleep: async () => undefined, isOnline: () => true });
}

describe('Claude API client', () => {
  it('sends the key only in the auth header, to api.anthropic.com, with no credentials', async () => {
    const f = vi.fn(async () => ok('OK'));
    await provider(f as unknown as typeof fetch).testConnection();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const h = init.headers as Record<string, string>;
    expect(h.authorization).toBe(`Bearer ${KEY}`);
    expect(h['x-api-key']).toBeUndefined();
    expect(h['anthropic-version']).toBe('2026-10-21');
    expect(init.credentials).toBe('omit');
    expect(String(init.body)).not.toContain(KEY);
  });

  it('uses x-api-key and sends temperature only on the legacy API version', async () => {
    const f = vi.fn(async () => ok('OK'));
    await provider(f as unknown as typeof fetch, { apiVersion: '2023-06-01', sendTemperature: true, temperature: 0.2 }).testConnection();
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
    expect(JSON.parse(String(init.body)).temperature).toBe(0.2);

    const g = vi.fn(async () => ok('OK'));
    await provider(g as unknown as typeof fetch, { sendTemperature: true, temperature: 0.2 }).testConnection();
    expect(JSON.parse(String((g.mock.calls[0] as unknown as [string, RequestInit])[1].body)).temperature).toBeUndefined();
  });

  it('maps API errors to clear messages', async () => {
    const cases: [number, unknown, ClaudeError['code'], RegExp][] = [
      [401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid_key', /could not be verified/],
      [404, { error: { type: 'not_found_error', message: 'model: claude-x not found' } }, 'model_not_found', /model is not available/],
      [400, { error: { type: 'invalid_request_error', message: 'Unsupported model: foo' } }, 'model_not_found', /model/],
      [402, { error: { type: 'billing_error', message: 'x' } }, 'billing', /billing/],
      [413, { error: { type: 'request_too_large', message: 'x' } }, 'too_large', /too large/],
    ];
    for (const [status, body, code, msg] of cases) {
      const f = vi.fn(async () => res(status, body));
      const err = await provider(f as unknown as typeof fetch).testConnection().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ClaudeError);
      expect((err as ClaudeError).code).toBe(code);
      expect((err as ClaudeError).message).toMatch(msg);
    }
  });

  it('retries rate limits that include retry-after, but not spend-cap 429s', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(429, { error: { type: 'rate_limit_error', message: 'x' } }, { 'retry-after': '2' })).mockResolvedValueOnce(ok('OK'));
    await expect(provider(f as unknown as typeof fetch).testConnection()).resolves.toBeTruthy();
    expect(f).toHaveBeenCalledTimes(2);

    const g = vi.fn(async () => res(429, { error: { type: 'rate_limit_error', message: 'monthly spend limit' } }));
    const err = (await provider(g as unknown as typeof fetch).testConnection().catch((e: unknown) => e)) as ClaudeError;
    expect(err.code).toBe('rate_limit');
    expect(g).toHaveBeenCalledTimes(1);
  });

  it('retries overloaded and network errors, then gives up', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(529, { error: { type: 'overloaded_error', message: 'x' } })).mockResolvedValueOnce(ok('OK'));
    await provider(f as unknown as typeof fetch).testConnection();
    expect(f).toHaveBeenCalledTimes(2);
    const g = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = (await provider(g as unknown as typeof fetch).testConnection().catch((e: unknown) => e)) as ClaudeError;
    expect(err.code).toBe('network');
    expect(g).toHaveBeenCalledTimes(3);
  });

  it('reports offline, timeouts, truncation and refusals', async () => {
    const off = new ClaudeProvider(KEY, DEFAULT_SETTINGS, { fetchImpl: vi.fn() as unknown as typeof fetch, isOnline: () => false });
    expect(((await off.testConnection().catch((e: unknown) => e)) as ClaudeError).code).toBe('offline');

    const slow = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_r, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))));
    const client = new AnthropicClient({ apiKey: KEY, apiVersion: '2026-10-21', timeoutMs: 20, maxRetries: 0, fetchImpl: slow as unknown as typeof fetch, isOnline: () => true });
    const t = (await client.createMessage({ model: 'm', system: '', user: 'x', maxTokens: 5 }).catch((e: unknown) => e)) as ClaudeError;
    expect(t.code).toBe('timeout');

    const trunc = vi.fn(async () => ok('{"a":', { stop_reason: 'max_tokens' }));
    expect(((await provider(trunc as unknown as typeof fetch).testConnection().catch((e: unknown) => e)) as ClaudeError).code).toBe('truncated');
    const refuse = vi.fn(async () => ok('', { stop_reason: 'refusal' }));
    expect(((await provider(refuse as unknown as typeof fetch).testConnection().catch((e: unknown) => e)) as ClaudeError).code).toBe('refusal');
  });

  it('requests structured JSON and falls back to prompt-only JSON if the model rejects it', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(res(400, { error: { type: 'invalid_request_error', message: 'output_config.format is not supported for this model' } }))
      .mockResolvedValueOnce(ok('```json\n{"explanation":"Fine","improvements":[]}\n```'));
    const r = await provider(f as unknown as typeof fetch).explainMatchScore({}, [], {});
    expect(r.data.explanation).toBe('Fine');
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).output_config.format.type).toBe('json_schema');
    expect(JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body)).output_config?.format).toBeUndefined();
  });

  it('asks for low effort by default and drops it if a model rejects the option', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(res(400, { error: { type: 'invalid_request_error', message: 'output_config.effort: this model does not support effort' } }))
      .mockResolvedValueOnce(ok('{"explanation":"Fine","improvements":[]}'));
    const r = await provider(f as unknown as typeof fetch).explainMatchScore({}, [], {});
    expect(r.data.explanation).toBe('Fine');
    const first = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const second = JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(first.output_config.effort).toBe('low');
    expect(second.output_config.effort).toBeUndefined();
    expect(second.output_config.format.type).toBe('json_schema');
  });

  it('gives long documents room to finish: high token floor, one automatic retry with more room', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(ok('{"letter":"Dear', { stop_reason: 'max_tokens' }))
      .mockResolvedValueOnce(ok('{"explanation":"Done","improvements":[]}'));
    const r = await provider(f as unknown as typeof fetch, { maxOutputTokens: 2000 }).explainMatchScore({}, [], {});
    expect(r.data.explanation).toBe('Done');
    const a = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).max_tokens;
    const b = JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body)).max_tokens;
    expect(a).toBeGreaterThanOrEqual(4000);
    expect(b).toBe(a * 2);
  });

  it('lists models with pagination and skips retired ones', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(res(200, { data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', lifecycle: 'active' }], has_more: true, last_id: 'claude-opus-5-5' }))
      .mockResolvedValueOnce(res(200, { data: [{ id: 'old', display_name: 'Old', lifecycle: 'retired' }, { id: 'claude-haiku-5-5', lifecycle: 'deprecated' }], has_more: false }));
    const models = await provider(f as unknown as typeof fetch).listModels();
    expect(models.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5']);
    expect(String((f.mock.calls[1] as unknown as [string])[0])).toContain('after_id=claude-opus-5-5');
  });

  it('refuses to run without a key or model', () => {
    expect(() => new ClaudeProvider(null, DEFAULT_SETTINGS)).toThrow(ClaudeError);
    expect(() => new ClaudeProvider(KEY, { ...DEFAULT_SETTINGS, model: ' ' })).toThrow(ClaudeError);
  });

  it('parses JSON replies robustly', () => {
    expect(parseJsonReply<{ a: number }>('Here you go: {"a": 1} hope it helps')).toEqual({ a: 1 });
    expect(() => parseJsonReply('no json')).toThrow(ClaudeError);
    expect(errorFromResponse(500, null, new Headers()).retryable).toBe(true);
  });
});

describe('API key safety', () => {
  it('redacts keys from anything that could be logged', () => {
    expect(redact(`calling with ${KEY}`)).not.toContain('TESTKEY');
    expect(redact({ headers: { 'x-api-key': KEY } })).not.toContain('TESTKEY');
    expect(redact('Authorization: Bearer abc.def.ghi')).toContain('[REDACTED]');
    expect(redact(new Error(`bad ${KEY}`))).toContain('[REDACTED]');
  });

  it('masks keys in the UI', () => {
    expect(maskApiKey(KEY)).toBe('sk-ant-••••••••cdef');
    expect(maskApiKey(null)).toBe('');
  });
});
