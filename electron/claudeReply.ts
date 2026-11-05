const JSON_MARKERS = /"company_name"|"companies"/;

export function claudeReplyBody(assistant: string, prompt: string): string {
  const text = assistant.replace(/\s+/g, ' ').trim();
  const src = prompt.replace(/\s+/g, ' ').trim();
  if (text.length < 24) return '';
  if (!src) return text;
  if (src.includes(text)) return '';
  if (text.startsWith(src)) {
    const rest = text.slice(src.length).trim();
    return rest.length >= 24 ? rest : '';
  }
  return text;
}

/** Outermost complete JSON object that looks like research or resume output. */
export function extractClaudeJson(body: string): string | null {
  const cleaned = body.replace(/```(?:json)?/gi, '');
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
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        const slice = cleaned.slice(start, i + 1);
        if (JSON_MARKERS.test(slice)) return slice;
        start = -1;
      }
    }
  }
  return null;
}

export function claudeReplyReady(body: string): boolean {
  return extractClaudeJson(body) !== null;
}

const CURLY = /[“”„‟″‶＂]/;

/**
 * Claude.ai sometimes answers with typographic quotes, so the JSON arrives as
 * {“companies”:[…]}. Straighten only the quotes that sit next to JSON syntax
 * ({ [ , : before, or : , } ] after) so quoted words inside resume prose
 * (“best-in-class”) and apostrophes stay as they are.
 */
export function straightenJsonQuotes(text: string): string {
  const out = text.split('');
  for (let i = 0; i < out.length; i++) {
    if (!CURLY.test(out[i]!)) continue;
    let p = i - 1;
    while (p >= 0 && /\s/.test(text[p]!)) p--;
    let n = i + 1;
    while (n < text.length && /\s/.test(text[n]!)) n++;
    const opens = p >= 0 && '{[,:'.includes(text[p]!);
    const closes = n < text.length && ':,}]'.includes(text[n]!);
    if (opens || closes) out[i] = '"';
  }
  return out.join('');
}

function parsable(json: string): boolean {
  try { JSON.parse(json); return true; } catch { return false; }
}

/** Read JSON from assistant DOM text, code blocks, or fenced sections. */
export function parseAssistantJson(assistant: string, prompt: string): string | null {
  const trimmed = assistant.trim();
  if (!trimmed) return null;
  const candidates = [claudeReplyBody(assistant, prompt), trimmed];
  for (const part of trimmed.split(/```(?:json)?/gi)) candidates.push(part.trim());
  for (const src of candidates) {
    if (!src) continue;
    const json = extractClaudeJson(src);
    if (json) return json;
  }
  if (!CURLY.test(trimmed)) return null;
  for (const src of candidates) {
    if (!src) continue;
    const json = extractClaudeJson(straightenJsonQuotes(src));
    if (json && parsable(json)) return json;
  }
  return null;
}
