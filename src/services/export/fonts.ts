/**
 * Fonts for resume PDFs. ATS-safe choices are embedded as real text (with Unicode maps, so
 * every word stays searchable and parseable). The bundled files are open fonts that are
 * metric-compatible with the familiar Office fonts, so layout matches the DOCX.
 */
import type { ResumeFormat } from '@/types';

export interface FontFiles {
  regular: string;
  bold: string;
  italic: string;
  /** What the font is compatible with — used in the DOCX, where Word supplies the real font. */
  docxName: string;
  /** Subset the embedded font (smaller PDF). Carlito renders wrongly when subset by fontkit, so it is embedded whole. */
  subset: boolean;
}

export const FONT_FILES: Record<ResumeFormat['font'], FontFiles | null> = {
  calibri: { regular: 'Carlito-Regular.ttf', bold: 'Carlito-Bold.ttf', italic: 'Carlito-Italic.ttf', docxName: 'Calibri', subset: false },
  arial: { regular: 'LiberationSans-Regular.ttf', bold: 'LiberationSans-Bold.ttf', italic: 'LiberationSans-Italic.ttf', docxName: 'Arial', subset: true },
  times: { regular: 'LiberationSerif-Regular.ttf', bold: 'LiberationSerif-Bold.ttf', italic: 'LiberationSerif-Italic.ttf', docxName: 'Times New Roman', subset: true },
  cambria: { regular: 'Caladea-Regular.ttf', bold: 'Caladea-Bold.ttf', italic: 'Caladea-Italic.ttf', docxName: 'Cambria', subset: true },
  // Helvetica is a standard PDF font; nothing to embed.
  helvetica: null,
};

export const DOCX_FONT: Record<ResumeFormat['font'], string> = {
  calibri: 'Calibri',
  arial: 'Arial',
  times: 'Times New Roman',
  cambria: 'Cambria',
  helvetica: 'Arial',
};

export type FontLoader = (file: string) => Promise<ArrayBuffer>;

const defaultLoader: FontLoader = async (file) => {
  const c = (globalThis as { chrome?: { runtime?: { getURL?: (p: string) => string } } }).chrome;
  const url = c?.runtime?.getURL ? c.runtime.getURL(`fonts/${file}`) : `fonts/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font ${file} not found`);
  return res.arrayBuffer();
};

let loader: FontLoader = defaultLoader;
const cache = new Map<string, Promise<ArrayBuffer>>();

/** Tests and the Node example script read fonts from disk. */
export function setFontLoader(l: FontLoader | null): void {
  loader = l ?? defaultLoader;
  cache.clear();
}

export function loadFontFile(file: string): Promise<ArrayBuffer> {
  let p = cache.get(file);
  if (!p) {
    p = loader(file);
    cache.set(file, p);
    p.catch(() => cache.delete(file));
  }
  return p;
}
