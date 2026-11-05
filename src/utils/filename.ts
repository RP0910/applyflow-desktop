
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

export function sanitizeFilename(input: string, fallback = 'untitled', maxLength = 80): string {
  let s = (input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ')
    .replace(/[‘’“”]/g, '')
    .replace(/[^\w.\- ()&+,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '');
  if (s.length > maxLength) s = s.slice(0, maxLength).replace(/[.\-]+$/g, '');
  if (!s || WINDOWS_RESERVED.test(s)) s = s ? `${s}_` : fallback;
  return s;
}

export function sanitizeRelativePath(path: string): string {
  return path
    .split(/[\\/]+/)
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .map((seg) => {
      const dot = seg.lastIndexOf('.');
      if (dot > 0 && dot >= seg.length - 6) {
        return `${sanitizeFilename(seg.slice(0, dot))}.${sanitizeFilename(seg.slice(dot + 1), 'txt', 6)}`;
      }
      return sanitizeFilename(seg);
    })
    .join('/');
}

export interface PathOptions {
  root: string;
  company: string;
  title: string;
  date: string;
  fileNameFormat: string;
  createFolderPerApplication: boolean;
  includeCompany: boolean;
  includeTitle: boolean;
}

export function formatTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

export function buildApplicationFolder(o: PathOptions): string {
  const parts: string[] = [sanitizeFilename(o.root || 'ApplyFlow', 'ApplyFlow')];
  if (o.includeCompany) parts.push(sanitizeFilename(o.company, 'Unknown-Company'));
  if (o.createFolderPerApplication) {
    const name = formatTemplate(o.fileNameFormat || '{date}_{title}', {
      date: o.date,
      title: o.includeTitle ? o.title : '',
      company: o.company,
    });
    parts.push(sanitizeFilename(name.replace(/_+$/g, '').replace(/^_+/g, ''), o.date));
  }
  return parts.join('/');
}
