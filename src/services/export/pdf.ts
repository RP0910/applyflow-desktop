/**
 * ATS-friendly resume PDF: real, selectable text with Unicode maps in an embedded ATS-safe
 * font, one column, standard section headings, no tables, text boxes, images or icons, and
 * contact details in the body (not a header). Built with pdf-lib so it works offline.
 *
 * Layout (Letter):
 *   NAME (20 pt bold)
 *   Target Title | key skills
 *   City, ST | phone | email | links
 *   PROFESSIONAL SUMMARY ─────────
 *   TECHNICAL SKILLS ─────────    Category: a, b, c
 *   PROFESSIONAL EXPERIENCE ──────
 *   Job Title                                   Feb 2023 – May 2026
 *   Company | City, ST
 *   • bullet
 *   Technologies: a, b, c
 *   EDUCATION ─────────
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { ResumeFormat, TailoredResume } from '@/types';
import { DEFAULT_RESUME_FORMAT } from '@/types';
import { FONT_FILES, loadFontFile } from './fonts';
import { SECTION, contactParts, educationLine, formatDateText, formatRange, skillLines } from './layout';

const PAGE_W = 612;
const PAGE_H = 792;
const INK = rgb(0.08, 0.09, 0.11);
const SUBTLE = rgb(0.28, 0.3, 0.34);
const RULE = rgb(0.55, 0.57, 0.6);

/** Template look. Every template is one column with standard headings (ATS-safe). */
interface Style {
  lead: number;
  nameExtra: number;
  nameColor: ReturnType<typeof rgb>;
  headColor: ReturnType<typeof rgb>;
  ruleColor: ReturnType<typeof rgb>;
  ruleThickness: number;
  headGap: number;
  jobGap: number;
}

function hexColor(hex: string | undefined, fallback: ReturnType<typeof rgb>): ReturnType<typeof rgb> {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return fallback;
  const n = parseInt(m[1]!, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export function styleFor(fmt: ResumeFormat): Style {
  const accent = hexColor(fmt.accentColor, rgb(0, 0.46, 0.58));
  if (fmt.template === 'modern') return { lead: 1.26, nameExtra: 11, nameColor: accent, headColor: accent, ruleColor: accent, ruleThickness: 1.1, headGap: 1.1, jobGap: 0.7 };
  if (fmt.template === 'compact') return { lead: 1.16, nameExtra: 7, nameColor: INK, headColor: INK, ruleColor: RULE, ruleThickness: 0.6, headGap: 0.7, jobGap: 0.4 };
  return { lead: 1.24, nameExtra: 9.5, nameColor: INK, headColor: INK, ruleColor: RULE, ruleThickness: 0.75, headGap: 1.05, jobGap: 0.6 };
}

const FALLBACKS: Record<string, string> = { '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '✓': '-', '★': '*', ' ': ' ', ' ': ' ', '‑': '-', '−': '-', '​': '' };

const NO_LIGATURES = { liga: false, rlig: false, dlig: false, clig: false, calt: false, hlig: false };

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  embedded: boolean;
}

/** Replace characters the font can't draw (rare symbols) with plain equivalents. */
function makeSanitizer(fonts: Fonts) {
  const sets = [fonts.regular, fonts.bold, fonts.italic].map((f) => {
    try {
      return new Set(f.getCharacterSet());
    } catch {
      return null;
    }
  });
  const cache = new Map<string, string>();
  return (s: string): string =>
    Array.from(s.replace(/\t/g, ' '))
      .map((ch) => {
        if (cache.has(ch)) return cache.get(ch)!;
        const cp = ch.codePointAt(0)!;
        let ok = sets.every((set) => !set || set.has(cp));
        if (ok && !fonts.embedded) {
          try {
            fonts.regular.encodeText(ch);
          } catch {
            ok = false;
          }
        }
        const out = ok ? ch : FALLBACKS[ch] ?? (ch.normalize('NFKD').replace(/[^\x20-\x7e]/g, '') || '');
        cache.set(ch, out);
        return out;
      })
      .join('');
}

async function loadFonts(doc: PDFDocument, font: ResumeFormat['font']): Promise<Fonts> {
  const files = FONT_FILES[font];
  if (files) {
    try {
      doc.registerFontkit(fontkit);
      const [r, b, i] = await Promise.all([loadFontFile(files.regular), loadFontFile(files.bold), loadFontFile(files.italic)]);
      // Ligatures ("ti", "fi") would be written as single glyphs that extract as nothing:
      // "platforms" would reach the ATS as "pla orms". Plain glyphs keep every keyword intact.
      const opts = { subset: files.subset, features: NO_LIGATURES };
      return {
        regular: await doc.embedFont(r, opts),
        bold: await doc.embedFont(b, opts),
        italic: await doc.embedFont(i, opts),
        embedded: true,
      };
    } catch {
      // Fall through to the standard font if the font file can't be loaded.
    }
  }
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    embedded: false,
  };
}

interface Seg {
  text: string;
  font: PDFFont;
}

class Writer {
  page: PDFPage;
  y: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  constructor(
    private readonly doc: PDFDocument,
    readonly f: Fonts,
    readonly clean: (s: string) => string,
    readonly size: number,
    margins: ResumeFormat['margins'],
    readonly style: Style = styleFor(DEFAULT_RESUME_FORMAT),
  ) {
    const side = margins === 'narrow' ? 40 : 50;
    const vert = margins === 'narrow' ? 36 : 42;
    this.left = side;
    this.right = PAGE_W - side;
    this.top = PAGE_H - vert;
    this.bottom = vert;
    this.page = doc.addPage([PAGE_W, PAGE_H]);
    this.y = this.top;
  }
  get width(): number {
    return this.right - this.left;
  }
  lead(size = this.size): number {
    return size * this.style.lead;
  }
  newPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = this.top;
  }
  ensure(h: number): void {
    if (this.y - h < this.bottom) this.newPage();
  }
  /** Wrap mixed-font text into lines that fit `width`. */
  wrap(segs: Seg[], size: number, width: number): Seg[][] {
    const words: Seg[] = [];
    for (const s of segs) {
      const parts = this.clean(s.text).split(/(\s+)/).filter((p) => p.length);
      for (const p of parts) words.push({ text: p, font: s.font });
    }
    const lines: Seg[][] = [];
    let cur: Seg[] = [];
    let w = 0;
    for (const word of words) {
      const ww = word.font.widthOfTextAtSize(word.text, size);
      if (/^\s+$/.test(word.text)) {
        if (cur.length) {
          cur.push({ text: ' ', font: word.font });
          w += word.font.widthOfTextAtSize(' ', size);
        }
        continue;
      }
      if (w + ww > width && cur.length) {
        while (cur.length && /^\s+$/.test(cur[cur.length - 1]!.text)) cur.pop();
        lines.push(cur);
        cur = [];
        w = 0;
      }
      cur.push(word);
      w += ww;
    }
    while (cur.length && /^\s+$/.test(cur[cur.length - 1]!.text)) cur.pop();
    if (cur.length) lines.push(cur);
    return lines.length ? lines : [[{ text: '', font: segs[0]?.font ?? this.f.regular }]];
  }
  drawSegs(line: Seg[], x: number, size: number, color = INK): void {
    let cx = x;
    // Merge runs of the same font so each run is one text object (cleaner extraction).
    const runs: Seg[] = [];
    for (const s of line) {
      const last = runs[runs.length - 1];
      if (last && last.font === s.font) last.text += s.text;
      else runs.push({ ...s });
    }
    for (const r of runs) {
      this.page.drawText(r.text, { x: cx, y: this.y, size, font: r.font, color });
      cx += r.font.widthOfTextAtSize(r.text, size);
    }
  }
  paragraph(segs: Seg[], o: { size?: number; indent?: number; hanging?: number; bullet?: boolean; gapAfter?: number; color?: ReturnType<typeof rgb>; keep?: number } = {}): void {
    const size = o.size ?? this.size;
    const indent = o.indent ?? 0;
    const bulletIndent = o.bullet ? size * 1.1 : 0;
    const lines = this.wrap(segs, size, this.width - indent - bulletIndent - (o.hanging ?? 0));
    const lh = this.lead(size);
    this.ensure(lh * Math.min(lines.length, o.keep ?? 2));
    lines.forEach((line, i) => {
      this.ensure(lh);
      this.y -= lh;
      if (o.bullet && i === 0) this.page.drawText('•', { x: this.left + indent, y: this.y, size, font: this.f.regular, color: INK });
      this.drawSegs(line, this.left + indent + bulletIndent + (i > 0 ? o.hanging ?? 0 : 0), size, o.color);
    });
    this.y -= o.gapAfter ?? 0;
  }
  /** "Left text ............. right text" on one line (role title and dates). */
  split(left: Seg[], right: string, o: { size?: number; rightFont?: PDFFont } = {}): void {
    const size = o.size ?? this.size;
    const rf = o.rightFont ?? this.f.regular;
    const r = this.clean(right);
    const rw = r ? rf.widthOfTextAtSize(r, size) : 0;
    const lines = this.wrap(left, size, this.width - rw - 16);
    const lh = this.lead(size);
    lines.forEach((line, i) => {
      this.y -= lh;
      this.drawSegs(line, this.left, size);
      if (i === 0 && r) this.page.drawText(r, { x: this.right - rw, y: this.y, size, font: rf, color: INK });
    });
  }
  heading(text: string): void {
    const size = this.size + 1;
    this.ensure(this.lead(size) + this.lead() * 3 + 10);
    this.y -= this.size * this.style.headGap;
    this.y -= this.lead(size);
    this.page.drawText(this.clean(text.toUpperCase()), { x: this.left, y: this.y, size, font: this.f.bold, color: this.style.headColor });
    this.y -= 4;
    this.page.drawLine({ start: { x: this.left, y: this.y }, end: { x: this.right, y: this.y }, thickness: this.style.ruleThickness, color: this.style.ruleColor });
    this.y -= 1.5;
  }
}

async function newDoc(title: string, author: string, keywords: string[], font: ResumeFormat['font']) {
  const doc = await PDFDocument.create();
  doc.setTitle(title, { showInWindowTitleBar: true });
  doc.setAuthor(author);
  doc.setSubject('Resume');
  if (keywords.length) doc.setKeywords(keywords);
  doc.setCreator('ApplyFlow Desktop');
  doc.setProducer('ApplyFlow resume renderer (no AI)');
  doc.setLanguage('en-US');
  const fonts = await loadFonts(doc, font);
  return { doc, fonts };
}

export async function resumeToPdf(t: TailoredResume, format: ResumeFormat = DEFAULT_RESUME_FORMAT, keywords: string[] = []): Promise<Uint8Array> {
  const fmt = { ...DEFAULT_RESUME_FORMAT, ...format };
  const titleText = t.headline.split('|')[0]!.trim();
  const { doc, fonts } = await newDoc(`${t.contact.fullName} — ${titleText || 'Resume'}`, t.contact.fullName, keywords.length ? keywords : t.skills.slice(0, 20), fmt.font);
  const style = styleFor(fmt);
  const w = new Writer(doc, fonts, makeSanitizer(fonts), fmt.bodySize, fmt.template === 'compact' ? 'narrow' : fmt.margins, style);
  const R = fonts.regular;
  const B = fonts.bold;
  const I = fonts.italic;

  // Header: name, headline, contact line — all body text, no PDF header/footer regions.
  const nameSize = fmt.bodySize + style.nameExtra;
  w.y -= nameSize * 0.92;
  w.page.drawText(w.clean(t.contact.fullName), { x: w.left, y: w.y, size: nameSize, font: B, color: style.nameColor });
  w.y -= 3;
  if (t.headline) w.paragraph([{ text: t.headline, font: B }], { size: fmt.bodySize + 1 });
  const contact = contactParts(t);
  if (contact.length) w.paragraph([{ text: contact.join('  |  '), font: R }], { size: fmt.bodySize - 0.5, color: SUBTLE });

  if (t.summary) {
    w.heading(SECTION.summary);
    w.paragraph([{ text: t.summary, font: R }]);
  }
  const groups = skillLines(t);
  if (groups.length) {
    w.heading(SECTION.skills);
    for (const g of groups) {
      w.paragraph(g.name ? [{ text: `${g.name}: `, font: B }, { text: g.skills.join(', '), font: R }] : [{ text: g.skills.join(', '), font: R }], { gapAfter: 1.5 });
    }
  }
  if (t.experience.length) {
    w.heading(SECTION.experience);
    t.experience.forEach((e, i) => {
      // Keep the role header with its first bullet.
      w.ensure(w.lead() * 4 + 6);
      if (i) w.y -= fmt.bodySize * style.jobGap;
      w.split([{ text: e.title, font: B }], formatRange(e.startDate, e.endDate, fmt.dateStyle));
      const where = [e.company, e.location].filter(Boolean).join(' | ');
      if (where) w.paragraph([{ text: where, font: I }], { gapAfter: 1.5 });
      for (const b of e.bullets) w.paragraph([{ text: b, font: R }], { bullet: true, indent: 2, gapAfter: 1 });
      if (fmt.showJobTechnologies && e.technologies?.length) {
        // One line only (least relevant names dropped): a lone word wrapped onto the next line
        // can be mistaken by an ATS for the next job's title.
        const size = fmt.bodySize - 0.5;
        const label = 'Technologies: ';
        let items = [...e.technologies];
        const fits = () => B.widthOfTextAtSize(label, size) + R.widthOfTextAtSize(w.clean(items.join(', ')), size) <= w.width;
        while (items.length > 3 && !fits()) items = items.slice(0, -1);
        w.paragraph([{ text: label, font: B }, { text: items.join(', '), font: R }], { size, gapAfter: 1 });
      }
    });
  }
  if (t.projects.length) {
    w.heading(SECTION.projects);
    for (const p of t.projects) {
      w.paragraph(p.description ? [{ text: p.name, font: B }, { text: ` — ${p.description}`, font: R }] : [{ text: p.name, font: B }]);
      for (const b of p.bullets) w.paragraph([{ text: b, font: R }], { bullet: true, indent: 2, gapAfter: 1 });
    }
  }
  if (t.education.length) {
    w.heading(SECTION.education);
    for (const e of t.education) {
      const l = educationLine(e);
      w.split([{ text: l.left, font: B }], formatDateText(l.right, fmt.dateStyle));
      if (l.second) w.paragraph([{ text: l.second, font: I }], { gapAfter: 2 });
    }
  }
  if (t.certifications.length) {
    w.heading(SECTION.certifications);
    for (const c of t.certifications) w.paragraph([{ text: c, font: R }], { bullet: true, indent: 2 });
  }
  if (t.additional.length) {
    w.heading(SECTION.additional);
    for (const a of t.additional) w.paragraph([{ text: a, font: R }], { bullet: true, indent: 2 });
  }
  // Classic cross-reference tables (no object streams) are read by older ATS parsers too.
  return doc.save({ useObjectStreams: false });
}

export async function coverLetterToPdf(text: string, t: Pick<TailoredResume, 'contact'>, format: ResumeFormat = DEFAULT_RESUME_FORMAT): Promise<Uint8Array> {
  const fmt = { ...DEFAULT_RESUME_FORMAT, ...format };
  const { doc, fonts } = await newDoc(`${t.contact.fullName} — Cover letter`, t.contact.fullName, [], fmt.font);
  const style = styleFor(fmt);
  const w = new Writer(doc, fonts, makeSanitizer(fonts), fmt.bodySize + 0.5, fmt.margins, { ...style, lead: Math.max(style.lead, 1.24) });
  w.y -= 18;
  w.page.drawText(w.clean(t.contact.fullName), { x: w.left, y: w.y, size: 16, font: fonts.bold, color: style.nameColor });
  w.y -= 2;
  const contact = contactParts(t);
  if (contact.length) w.paragraph([{ text: contact.join('  |  '), font: fonts.regular }], { size: fmt.bodySize - 0.5, color: SUBTLE, gapAfter: 16 });
  for (const para of text.split(/\n{2,}/)) {
    for (const line of para.split('\n')) w.paragraph([{ text: line, font: fonts.regular }]);
    w.y -= 9;
  }
  return doc.save({ useObjectStreams: false });
}
