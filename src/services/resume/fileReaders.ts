import JSZip from 'jszip';
import { DATE_RANGE_RE, isSectionHeading } from './parser';

export class ResumeFileError extends Error {
  constructor(
    readonly code: 'docx_failed' | 'pdf_failed' | 'pdf_scanned' | 'unsupported' | 'empty' | 'too_large',
    message: string,
  ) {
    super(message);
    this.name = 'ResumeFileError';
  }
}

const MAX_BYTES = 10 * 1024 * 1024;
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export async function readDocx(data: ArrayBuffer): Promise<string> {
  if (data.byteLength > MAX_BYTES) throw new ResumeFileError('too_large', 'This file is larger than 10 MB. Save a smaller copy and try again.');
  let xml: string;
  try {
    const zip = await JSZip.loadAsync(data);
    const doc = zip.file('word/document.xml');
    if (!doc) throw new Error('missing word/document.xml');
    xml = await doc.async('string');
  } catch {
    throw new ResumeFileError('docx_failed', 'This DOCX file could not be read. Re-save it from Word or Google Docs, or paste the text instead.');
  }
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  if (parsed.getElementsByTagName('parsererror').length) {
    throw new ResumeFileError('docx_failed', 'This DOCX file appears to be damaged. Re-save it, or paste the text instead.');
  }
  const out: string[] = [];
  const paragraphs = parsed.getElementsByTagNameNS(W_NS, 'p');
  for (const p of Array.from(paragraphs)) {
    let line = '';
    const walker = (node: Element): void => {
      for (const child of Array.from(node.children)) {
        if (child.namespaceURI !== W_NS) {
          walker(child);
          continue;
        }
        switch (child.localName) {
          case 't':
            line += child.textContent ?? '';
            break;
          case 'tab':
            line += '\t';
            break;
          case 'br':
          case 'cr':
            line += '\n';
            break;
          case 'p':
            break;
          default:
            walker(child);
        }
      }
    };
    walker(p);
    const isList = p.getElementsByTagNameNS(W_NS, 'numPr').length > 0;
    const text = line.replace(/[  ]+/g, ' ').trimEnd();
    out.push(isList && text.trim() ? `• ${text.trim()}` : text);
  }
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new ResumeFileError('empty', 'No text was found in this DOCX file.');
  return text;
}

export interface PdfTextItem {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
  fontName?: string;
  hasEOL?: boolean;
}

const BULLET_START = /^\s*(?:[•·▪●◦►■◆❖➢⦁\uF0B7\uF0A7]\s*|[-*–—]\s|\d+[.)]\s)/;
const HEADING_LIKE = /^[A-Z][A-Z &/]{2,40}$/;
const LABEL_START = /^[A-Z][A-Za-z &/+\-]{1,40}:\s/;
const LINE_END = /[.!?:;]["')\]]?$/;
const LONE_BULLET = /^\s*[•\-*–—·▪●◦►]\s*$/;

interface Row {
  y: number;
  text: string;
  left: number;
  textLeft: number;
  right: number;
  font: string;
  size: number;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

export function pdfItemsToLines(items: PdfTextItem[]): string[] {
  const groups = new Map<number, { x: number; right: number; s: string; font: string; size: number }[]>();
  for (const it of items) {
    if (!it.str.trim()) continue;
    const y = Math.round((it.transform[5] ?? 0) / 2) * 2;
    const x = it.transform[4] ?? 0;
    const right = x + (it.width ?? it.str.length * 5);
    const size = it.height || Math.abs(it.transform[3] ?? 0) || 0;
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y)!.push({ x, right, s: it.str, font: it.fontName ?? '', size });
  }
  for (const y of Array.from(groups.keys())) {
    const parts = groups.get(y)!;
    if (!parts.every((p) => LONE_BULLET.test(p.s))) continue;
    const bx = Math.min(...parts.map((p) => p.x));
    let best: number | null = null;
    for (const [oy, op] of groups) {
      if (oy === y || Math.abs(oy - y) > 6 || op.every((p) => LONE_BULLET.test(p.s))) continue;
      const first = Math.min(...op.map((p) => p.x));
      if (first >= bx && first - bx <= 30 && (best === null || Math.abs(oy - y) < Math.abs(best - y))) best = oy;
    }
    if (best !== null) {
      groups.get(best)!.push(...parts);
      groups.delete(y);
    }
  }
  const rows: Row[] = Array.from(groups.keys())
    .sort((a, b) => b - a)
    .map((y) => {
      const parts = groups.get(y)!.sort((a, b) => a.x - b.x);
      let text = '';
      let lastRight = -Infinity;
      for (const p of parts) {
        if (text && p.x - lastRight > 18) text += '  ';
        else if (text && !text.endsWith(' ') && !p.s.startsWith(' ')) text += p.x - lastRight > 1 ? ' ' : '';
        text += p.s;
        lastRight = p.right;
      }
      const textPart = parts.find((p) => !LONE_BULLET.test(p.s)) ?? parts[0]!;
      const main = parts.reduce((a, b) => (b.s.trim().length > a.s.trim().length ? b : a));
      return {
        y,
        text: text.replace(/\s{3,}/g, '  ').trimEnd(),
        left: parts[0]!.x,
        textLeft: textPart.x,
        right: Math.max(...parts.map((p) => p.right)),
        font: main.font,
        size: Math.max(...parts.map((p) => p.size)),
      };
    });
  const maxRight = Math.max(0, ...rows.map((r) => r.right));
  const lead = median(rows.slice(1).map((r, i) => rows[i]!.y - r.y).filter((g) => g > 0));
  const out: { text: string; last: Row }[] = [];
  for (const row of rows) {
    const prev = out[out.length - 1];
    const t = row.text.trim();
    const p = prev?.last;
    const softWrap =
      prev !== undefined &&
      p !== undefined &&
      p.right >= maxRight * 0.86 &&
      (!lead || p.y - row.y <= lead * 1.25) &&
      (!p.font || !row.font || p.font === row.font) &&
      (!p.size || !row.size || Math.abs(p.size - row.size) < 0.6) &&
      row.left >= p.textLeft - 3 &&
      !LINE_END.test(p.text.trim()) &&
      !BULLET_START.test(row.text) &&
      !HEADING_LIKE.test(t) &&
      !LABEL_START.test(t) &&
      !isSectionHeading(t) &&
      !DATE_RANGE_RE.test(t) &&
      !DATE_RANGE_RE.test(p.text);
    if (softWrap) {
      prev.text = prev.text.endsWith('-') && /^[a-z]/.test(t) ? `${prev.text}${t}` : `${prev.text} ${t}`;
      prev.last = row;
    } else {
      out.push({ text: row.text, last: row });
    }
  }
  return out.map((r) => r.text);
}

type PdfLoader = (data: ArrayBuffer) => Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }> }>;

async function defaultPdfLoader(data: ArrayBuffer): ReturnType<PdfLoader> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, disableFontFace: true });
  return task.promise as unknown as ReturnType<PdfLoader>;
}

export async function readPdf(data: ArrayBuffer, loader: PdfLoader = defaultPdfLoader): Promise<string> {
  if (data.byteLength > MAX_BYTES) throw new ResumeFileError('too_large', 'This file is larger than 10 MB. Save a smaller copy and try again.');
  let doc: Awaited<ReturnType<PdfLoader>>;
  try {
    doc = await loader(data);
  } catch {
    throw new ResumeFileError('pdf_failed', 'This PDF could not be read. Export it again from your editor, upload the DOCX, or paste the text instead.');
  }
  const lines: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items = content.items.filter((i): i is PdfTextItem => typeof (i as PdfTextItem).str === 'string' && (i as PdfTextItem).str.length > 0);
    lines.push(...pdfItemsToLines(items), '');
  }
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.replace(/\s/g, '').length < 80) {
    throw new ResumeFileError('pdf_scanned', 'This PDF looks like a scanned image with no selectable text. Upload the DOCX version or paste the text instead.');
  }
  return text;
}

export async function readResumeFile(file: File): Promise<{ text: string; format: 'docx' | 'pdf' | 'text'; data: ArrayBuffer | null }> {
  const name = file.name.toLowerCase();
  if (file.size > MAX_BYTES) throw new ResumeFileError('too_large', 'This file is larger than 10 MB. Save a smaller copy and try again.');
  if (name.endsWith('.doc')) throw new ResumeFileError('unsupported', 'Older .doc files are not supported. Save it as .docx or PDF, or paste the text.');
  if (!/\.(docx|pdf|txt|md)$/.test(name)) throw new ResumeFileError('unsupported', 'Upload a .docx, .pdf or .txt file, or paste your resume text.');
  const buf = await file.arrayBuffer();
  const data = buf.slice(0);
  if (name.endsWith('.docx')) return { text: await readDocx(buf), format: 'docx', data };
  if (name.endsWith('.pdf')) return { text: await readPdf(buf), format: 'pdf', data };
  const text = new TextDecoder().decode(buf).trim();
  if (!text) throw new ResumeFileError('empty', 'This file is empty.');
  return { text, format: 'text', data: null };
}

export async function rereadSource(data: ArrayBuffer, format: 'docx' | 'pdf' | 'text' | 'form'): Promise<string | null> {
  if (format === 'docx') return readDocx(data.slice(0));
  if (format === 'pdf') return readPdf(data.slice(0));
  return null;
}
