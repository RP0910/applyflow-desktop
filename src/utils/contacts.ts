
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})\b(?:\s*(?:x|ext\.?|extension)\s*(\d{1,6}))?/gi;

export function phoneDigits(phone: string): string {
  const d = phone.replace(/\s*(?:x|ext\.?|extension|#)\s*\d{1,6}\s*$/i, '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

export function formatPhone(phone: string): string {
  const d = phoneDigits(phone);
  const ext = /(?:x|ext\.?|extension|#)\s*(\d{1,6})\s*$/i.exec(phone.trim())?.[1];
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}${ext ? ` x${ext}` : ''}` : phone.trim();
}

export function extractContacts(text: string): { phones: string[]; emails: string[] } {
  const emails = new Set<string>();
  for (const m of text.matchAll(EMAIL_RE)) {
    const e = m[0].replace(/[.,;:]+$/, '').toLowerCase();
    if (/\.(png|jpe?g|gif|svg)$/i.test(e)) continue;
    emails.add(e);
  }
  const phones = new Map<string, string>();
  for (const m of text.matchAll(PHONE_RE)) {
    const before = text.slice(Math.max(0, m.index - 2), m.index);
    const context = text.slice(Math.max(0, m.index - 18), m.index);
    if (/[$\d]/.test(before)) continue;
    if (/^\+?\d+$/.test(m[0].trim()) && !/(phone|call|tel|mobile|cell|text|reach)\W*\s*(me|us|at)?\W*$/i.test(context)) continue;
    const digits = `${m[1]}${m[2]}${m[3]}`;
    if (/^(\d)\1+$/.test(digits)) continue;
    const ext = m[4] ? ` x${m[4]}` : '';
    if (!phones.has(digits)) phones.set(digits, `${formatPhone(digits)}${ext}`);
  }
  return { phones: [...phones.values()], emails: [...emails] };
}

export function withoutContacts(text: string): string {
  return text
    .replace(EMAIL_RE, ' ')
    .replace(PHONE_RE, ' ')
    .replace(/https?:\/\/\S+/gi, ' ');
}
