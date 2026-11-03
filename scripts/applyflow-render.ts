/**
 * applyflow-render — ApplyFlow's resume renderer on the command line (no AI, no network).
 *
 *   node dist-cli/applyflow-render.mjs resume.json                 → resume.pdf (+ resume-cover-letter.pdf)
 *   node dist-cli/applyflow-render.mjs resume.json -o out.pdf --template modern --font calibri --size 11
 *   node dist-cli/applyflow-render.mjs resume.json --docx           → also resume.docx
 *
 * Input: applyflow.resume/1 JSON (what ApplyFlow saves as resume.json) or a JSON Resume file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setFontLoader } from '@/services/export/fonts';
import { readResumeDocument, renderCoverLetterPdf, renderResumeDocx, renderResumePdf } from '@/resume-renderer';
import type { ResumeFormat } from '@/types';

const here = dirname(fileURLToPath(import.meta.url));

function usage(code = 0): never {
  console.log(`Usage: applyflow-render <resume.json> [-o out.pdf] [--template classic|modern|compact] [--font arial|calibri|helvetica|cambria|times]
                       [--size 10.5] [--accent #007595] [--dates mon_yyyy|mm_yyyy|as_written] [--no-tech] [--docx] [--no-letter]`);
  process.exit(code);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) usage();
  const input = args[0]!;
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i > 0 ? args[i + 1] : undefined;
  };
  const format: Partial<ResumeFormat> = {};
  if (opt('--template')) format.template = opt('--template') as ResumeFormat['template'];
  if (opt('--font')) format.font = opt('--font') as ResumeFormat['font'];
  if (opt('--size')) format.bodySize = Number(opt('--size'));
  if (opt('--accent')) format.accentColor = opt('--accent');
  if (opt('--dates')) format.dateStyle = opt('--dates') as ResumeFormat['dateStyle'];
  if (args.includes('--no-tech')) format.showJobTechnologies = false;

  setFontLoader(async (file) => {
    const b = readFileSync(join(here, 'fonts', file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });

  const r = readResumeDocument(readFileSync(resolve(input), 'utf8'));
  for (const w of r.warnings) console.warn(`note: ${w}`);
  if (!r.doc) {
    for (const e of r.errors) console.error(`error: ${e}`);
    process.exit(1);
  }
  const out = resolve(opt('-o') ?? join(dirname(input), `${basename(input, extname(input))}.pdf`));
  writeFileSync(out, await renderResumePdf(r.doc, format));
  console.log(`resume       → ${out}`);
  if (!args.includes('--no-letter')) {
    const letter = await renderCoverLetterPdf(r.doc, format);
    if (letter) {
      const p = out.replace(/\.pdf$/i, '') + '-cover-letter.pdf';
      writeFileSync(p, letter);
      console.log(`cover letter → ${p}`);
    }
  }
  if (args.includes('--docx')) {
    const p = out.replace(/\.pdf$/i, '') + '.docx';
    writeFileSync(p, Buffer.from(await (await renderResumeDocx(r.doc, format)).arrayBuffer()));
    console.log(`word         → ${p}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
