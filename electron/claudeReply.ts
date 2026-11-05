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
