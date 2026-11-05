export type ClaudeErrorCode =
  | 'no_key'
  | 'offline'
  | 'network'
  | 'timeout'
  | 'invalid_key'
  | 'permission'
  | 'billing'
  | 'model_not_found'
  | 'rate_limit'
  | 'overloaded'
  | 'server'
  | 'bad_request'
  | 'too_large'
  | 'parse'
  | 'refusal'
  | 'truncated'
  | 'aborted'
  | 'chat_signed_out'
  | 'chat_unavailable';

const USER_MESSAGES: Record<ClaudeErrorCode, string> = {
  no_key: 'Add your Claude API key in Settings, or switch the engine to Local.',
  offline: 'You appear to be offline. Reconnect and try again — nothing was lost.',
  network: 'Could not reach the Claude API. Check your connection and try again.',
  timeout: 'Claude took too long to respond. Try again, or raise the timeout in Settings.',
  invalid_key: 'Your API key could not be verified. Check the key and selected model.',
  permission: 'This API key does not have permission for that request. Check the key’s workspace and model access.',
  billing: 'The Claude API reported a billing problem on this account. Check your Anthropic Console billing settings.',
  model_not_found: 'The selected Claude model is not available to this key. Choose another model or refresh the model list.',
  rate_limit: 'The Claude API rate limit was reached. Wait a moment and try again.',
  overloaded: 'The Claude API is temporarily overloaded. Try again in a minute.',
  server: 'The Claude API returned a server error. Try again shortly.',
  bad_request: 'The Claude API rejected the request. Check the selected model and settings.',
  too_large: 'The request is too large. Try turning off “Send full job description” or shortening the resume.',
  parse: 'Claude returned a response ApplyFlow could not read. Try again.',
  refusal: 'Claude declined to produce this content. Review the job and resume text, then try again.',
  truncated: 'Claude’s answer was cut off. Increase “Maximum output tokens” in Settings and try again.',
  aborted: 'The request was cancelled.',
  chat_signed_out: 'Claude.ai is signed out. Click the Claude.ai indicator at the bottom of the sidebar, sign in, and try again.',
  chat_unavailable: 'Claude.ai Chat is not ready. If a sign-in check or CAPTCHA is showing, finish it in the sign-in window. ApplyFlow will not bypass it.',
};

export class ClaudeError extends Error {
  readonly code: ClaudeErrorCode;
  readonly status: number | undefined;
  readonly requestId: string | undefined;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly detail: string | undefined;

  constructor(
    code: ClaudeErrorCode,
    opts: { status?: number; requestId?: string; retryable?: boolean; retryAfterMs?: number; detail?: string } = {},
  ) {
    super(USER_MESSAGES[code]);
    this.name = 'ClaudeError';
    this.code = code;
    this.status = opts.status;
    this.requestId = opts.requestId;
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs;
    this.detail = opts.detail;
  }

  get userMessage(): string {
    const d = this.detail?.trim();
    if (d) {
      if (this.code === 'timeout') return d;
      if (this.code === 'chat_unavailable' || this.code === 'chat_signed_out') return d;
      if (this.code === 'truncated' && /claude\.ai|JSON|incomplete|message box|time limit|background tab/i.test(d)) {
        return d.endsWith('.') ? d : `${d}. Try again.`;
      }
    }
    return this.message;
  }
}

export function userMessageFor(code: ClaudeErrorCode): string {
  return USER_MESSAGES[code];
}

export function errorFromResponse(
  status: number,
  body: { error?: { type?: string; message?: string }; request_id?: string } | null,
  headers: { get(name: string): string | null },
): ClaudeError {
  const type = body?.error?.type ?? '';
  const detail = body?.error?.message ?? '';
  const requestId = body?.request_id ?? headers.get('request-id') ?? undefined;
  const retryAfterRaw = headers.get('retry-after');
  const retryAfterMs = retryAfterRaw && !Number.isNaN(Number(retryAfterRaw)) ? Number(retryAfterRaw) * 1000 : undefined;
  const base = { status, requestId, detail };

  if (status === 401 || type === 'authentication_error') return new ClaudeError('invalid_key', base);
  if (status === 403 || type === 'permission_error') return new ClaudeError('permission', base);
  if (status === 402 || type === 'billing_error') return new ClaudeError('billing', base);
  if (status === 404 || type === 'not_found_error') {
    return new ClaudeError(/model/i.test(detail) || !detail ? 'model_not_found' : 'bad_request', base);
  }
  if (status === 413 || type === 'request_too_large') return new ClaudeError('too_large', base);
  if (status === 429 || type === 'rate_limit_error') {
    return new ClaudeError('rate_limit', { ...base, retryable: retryAfterMs !== undefined, retryAfterMs });
  }
  if (status === 529 || type === 'overloaded_error') return new ClaudeError('overloaded', { ...base, retryable: true, retryAfterMs });
  if (status === 504 || type === 'timeout_error') return new ClaudeError('timeout', { ...base, retryable: true });
  if (status >= 500) return new ClaudeError('server', { ...base, retryable: true, retryAfterMs });
  const aboutModelId = /\b(?:invalid|unknown|unsupported)\s+model\b|\bmodel[:\s]+["'`]?[\w.\-@:]+["'`]?\s+(?:not found|does not exist|is not (?:available|supported))/i;
  if (status === 400 && aboutModelId.test(detail) && !/output_config|format|schema|parameter/i.test(detail)) {
    return new ClaudeError('model_not_found', base);
  }
  return new ClaudeError('bad_request', base);
}
