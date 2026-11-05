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

export function claudeReplyReady(body: string): boolean {
  if (!/"company_name"|"companies"/.test(body)) return false;
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0 && /"company_name"|"companies"/.test(body.slice(start, i + 1))) return true;
    }
  }
  return false;
}
