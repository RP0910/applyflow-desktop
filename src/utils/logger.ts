const KEY_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_\-]{8,}/g,
  /(x-api-key["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi,
  /(authorization["']?\s*[:=]\s*["']?bearer\s+)[^"'\s,}]+/gi,
];

export function redact(input: unknown): string {
  let s: string;
  if (typeof input === 'string') s = input;
  else if (input instanceof Error) s = `${input.name}: ${input.message}`;
  else {
    try {
      s = JSON.stringify(input);
    } catch {
      s = String(input);
    }
  }
  for (const re of KEY_PATTERNS) {
    s = s.replace(re, (match, prefix?: string) => (typeof prefix === 'string' && match.startsWith(prefix) ? `${prefix}[REDACTED]` : '[REDACTED]'));
  }
  return s;
}

const isDev = typeof import.meta !== 'undefined' && Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);

export const log = {
  debug(...args: unknown[]): void {
    if (isDev) console.debug('[ApplyFlow]', ...args.map(redact));
  },
  warn(...args: unknown[]): void {
    console.warn('[ApplyFlow]', ...args.map(redact));
  },
  error(...args: unknown[]): void {
    console.error('[ApplyFlow]', ...args.map(redact));
  },
};

export function maskApiKey(key: string | null | undefined): string {
  if (!key) return '';
  const k = key.trim();
  if (k.length <= 10) return '••••';
  return `${k.slice(0, 7)}••••••••${k.slice(-4)}`;
}
