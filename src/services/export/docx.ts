import { AlignmentType, BorderStyle, Document, LevelFormat, Packer, Paragraph, TabStopType, TextRun } from 'docx';
import type { ResumeFormat, TailoredResume } from '@/types';
import { DEFAULT_RESUME_FORMAT } from '@/types';
import { DOCX_FONT } from './fonts';
import { SECTION, contactParts, educationLine, formatDateText, formatRange, skillLines } from './layout';

const half = (pt: number) => Math.round(pt * 2);

function pageProps(fmt: ResumeFormat) {
  const side = fmt.margins === 'narrow' ? 800 : 1000;
  const vert = fmt.margins === 'narrow' ? 720 : 840;
  return { page: { size: { width: 12240, height: 15840 }, margin: { top: vert, bottom: vert, left: side, right: side } } };
}

function builder(fmt: ResumeFormat) {
  const font = DOCX_FONT[fmt.font];
  const size = half(fmt.bodySize);
  const rightTab = 12240 - 2 * (fmt.margins === 'narrow' ? 800 : 1000);
  const run = (text: string, o: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) =>
    new TextRun({ text, font, size: o.size ?? size, bold: o.bold, italics: o.italics, color: o.color });
  return {
    run,
    heading: (text: string) =>
      new Paragraph({
        spacing: { before: 200, after: 70 },
        keepNext: true,
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '8C9196', space: 2 } },
        children: [run(text.toUpperCase(), { bold: true, size: size + 2 })],
      }),
    para: (children: TextRun[], o: { after?: number; keepNext?: boolean } = {}) => new Paragraph({ spacing: { after: o.after ?? 50, line: 264 }, keepNext: o.keepNext, children }),
    bullet: (text: string) => new Paragraph({ numbering: { reference: 'af-bullets', level: 0 }, spacing: { after: 30, line: 264 }, children: [run(text)] }),
    split: (left: TextRun[], right: string) =>
      new Paragraph({
        spacing: { before: 100, after: 10 },
        keepNext: true,
        tabStops: [{ type: TabStopType.RIGHT, position: rightTab }],
        children: [...left, ...(right ? [run(`\t${right}`)] : [])],
      }),
  };
}

const numbering = {
  config: [
    {
      reference: 'af-bullets',
      levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 300, hanging: 220 } } } }],
    },
  ],
};

export async function resumeToDocx(t: TailoredResume, format: ResumeFormat = DEFAULT_RESUME_FORMAT): Promise<Blob> {
  const fmt = { ...DEFAULT_RESUME_FORMAT, ...format };
  const b = builder(fmt);
  const size = half(fmt.bodySize);
  const children: Paragraph[] = [
    new Paragraph({ spacing: { after: 30 }, children: [b.run(t.contact.fullName, { bold: true, size: half(fmt.bodySize + 9.5) })] }),
  ];
  if (t.headline) children.push(b.para([b.run(t.headline, { bold: true, size: size + 2 })], { after: 20 }));
  const contact = contactParts(t);
  if (contact.length) children.push(b.para([b.run(contact.join('  |  '), { size: size - 1, color: '474C55' })], { after: 60 }));
  if (t.summary) children.push(b.heading(SECTION.summary), b.para([b.run(t.summary)]));
  const groups = skillLines(t);
  if (groups.length) {
    children.push(b.heading(SECTION.skills));
    for (const g of groups) children.push(b.para(g.name ? [b.run(`${g.name}: `, { bold: true }), b.run(g.skills.join(', '))] : [b.run(g.skills.join(', '))], { after: 30 }));
  }
  if (t.experience.length) {
    children.push(b.heading(SECTION.experience));
    for (const e of t.experience) {
      children.push(b.split([b.run(e.title, { bold: true })], formatRange(e.startDate, e.endDate, fmt.dateStyle)));
      const where = [e.company, e.location].filter(Boolean).join(' | ');
      if (where) children.push(b.para([b.run(where, { italics: true })], { after: 30, keepNext: true }));
      children.push(...e.bullets.map(b.bullet));
      if (fmt.showJobTechnologies && e.technologies?.length) {
        children.push(b.para([b.run('Technologies: ', { bold: true, size: size - 1 }), b.run(e.technologies.join(', '), { size: size - 1 })], { after: 40 }));
      }
    }
  }
  if (t.projects.length) {
    children.push(b.heading(SECTION.projects));
    for (const p of t.projects) {
      children.push(b.para(p.description ? [b.run(p.name, { bold: true }), b.run(` — ${p.description}`)] : [b.run(p.name, { bold: true })]), ...p.bullets.map(b.bullet));
    }
  }
  if (t.education.length) {
    children.push(b.heading(SECTION.education));
    for (const e of t.education) {
      const l = educationLine(e);
      children.push(b.split([b.run(l.left, { bold: true })], formatDateText(l.right, fmt.dateStyle)));
      if (l.second) children.push(b.para([b.run(l.second, { italics: true })]));
    }
  }
  if (t.certifications.length) children.push(b.heading(SECTION.certifications), ...t.certifications.map(b.bullet));
  if (t.additional.length) children.push(b.heading(SECTION.additional), ...t.additional.map(b.bullet));
  const doc = new Document({
    creator: t.contact.fullName || 'ApplyFlow',
    title: `${t.contact.fullName} — Resume`,
    styles: { default: { document: { run: { font: DOCX_FONT[fmt.font], size } } } },
    numbering,
    sections: [{ properties: pageProps(fmt), children }],
  });
  return Packer.toBlob(doc);
}

export async function coverLetterToDocx(text: string, t: Pick<TailoredResume, 'contact'>, format: ResumeFormat = DEFAULT_RESUME_FORMAT): Promise<Blob> {
  const fmt = { ...DEFAULT_RESUME_FORMAT, ...format };
  const b = builder({ ...fmt, bodySize: fmt.bodySize + 0.5 });
  const size = half(fmt.bodySize + 0.5);
  const children: Paragraph[] = [
    new Paragraph({ children: [b.run(t.contact.fullName, { bold: true, size: half(16) })] }),
    b.para([b.run(contactParts(t).join('  |  '), { size: size - 1, color: '474C55' })], { after: 240 }),
    ...text.split(/\n{2,}/).map((para) => new Paragraph({ spacing: { after: 200 }, children: para.split('\n').flatMap((line, i) => [...(i ? [new TextRun({ break: 1 })] : []), b.run(line)]) })),
  ];
  const doc = new Document({ creator: t.contact.fullName || 'ApplyFlow', title: `${t.contact.fullName} — Cover letter`, sections: [{ properties: pageProps(fmt), children }] });
  return Packer.toBlob(doc);
}
