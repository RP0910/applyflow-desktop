import type { JobSession, OutputFormat, ResumeFormat, Settings } from '@/types';
import { DEFAULT_RESUME_FORMAT } from '@/types';
import type { GeneratedDocs } from '@/services/downloads/planner';
import { MIME } from '@/services/downloads/planner';
import { coverLetterToMarkdown, resumeToMarkdown, resumeToText } from './render';
import { coverLetterToDocx, resumeToDocx } from './docx';
import { toResumeDocument, renderResumePdf, renderCoverLetterPdf } from '@/resume-renderer';
import { sanitizeFilename } from '@/utils/filename';

const bytesBlob = (b: Uint8Array, type: string) => new Blob([b as BlobPart], { type });

function pdfKeywords(session: JobSession): string[] {
  return (session.atsPlan?.keywords ?? []).filter((k) => k.support === 'supported' && k.kind === 'hard').slice(0, 25).map((k) => k.term);
}

export async function buildResumeFormats(session: JobSession, formats: OutputFormat[], format: ResumeFormat = DEFAULT_RESUME_FORMAT): Promise<Partial<Record<OutputFormat, Blob>>> {
  const r = session.resume;
  if (!r) return {};
  const out: Partial<Record<OutputFormat, Blob>> = {};
  if (formats.includes('pdf')) out.pdf = bytesBlob(await renderResumePdf(toResumeDocument(r, session.coverLetter), format, pdfKeywords(session)), MIME.pdf!);
  if (formats.includes('docx')) out.docx = await resumeToDocx(r, format);
  if (formats.includes('txt')) out.txt = new Blob([resumeToText(r, format)], { type: MIME.txt });
  if (formats.includes('md')) out.md = new Blob([resumeToMarkdown(r, format)], { type: MIME.md });
  return out;
}

export async function buildCoverLetterFormats(session: JobSession, formats: OutputFormat[], format: ResumeFormat = DEFAULT_RESUME_FORMAT): Promise<Partial<Record<OutputFormat, Blob>>> {
  const r = session.resume;
  const cl = session.coverLetter;
  if (!r || !cl || !session.includeCoverLetter) return {};
  const out: Partial<Record<OutputFormat, Blob>> = {};
  out.pdf = bytesBlob((await renderCoverLetterPdf(toResumeDocument(r, cl), format))!, MIME.pdf!);
  out.txt = new Blob([`${cl.text.trim()}\n`], { type: MIME.txt });
  if (formats.includes('docx')) out.docx = await coverLetterToDocx(cl.text, r, format);
  if (formats.includes('md')) out.md = new Blob([coverLetterToMarkdown(cl.text, r)], { type: MIME.md });
  return out;
}

export async function buildAllDocs(session: JobSession, settings: Settings): Promise<GeneratedDocs> {
  const formats = settings.resumeOutputFormats.length ? settings.resumeOutputFormats : (['pdf'] as OutputFormat[]);
  return { resume: await buildResumeFormats(session, formats, settings.resumeFormat), coverLetter: await buildCoverLetterFormats(session, formats, settings.resumeFormat) };
}

export function uploadFileName(session: JobSession, kind: 'resume' | 'cover_letter', ext: 'pdf' | 'docx'): string {
  const name = sanitizeFilename(session.resume?.contact.fullName || 'Candidate', 'Candidate', 40);
  const job = sanitizeFilename(`${session.job.company}-${session.job.title}`, 'Job', 55);
  const stamp = (session.resume?.generatedAt ?? '').replace(/[^0-9]/g, '');
  return `${name}-${job}-${kind === 'resume' ? 'Resume' : 'Cover-Letter'}-v${session.resume?.version ?? 1}-${stamp}.${ext}`;
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error ?? new Error('Could not read the generated file.'));
    r.readAsDataURL(b);
  });
}

export async function uploadPayload(session: JobSession, settings: Settings, kind: 'resume' | 'cover_letter'): Promise<{ name: string; mime: string; base64: string } | null> {
  const preferDocx = !settings.resumeOutputFormats.includes('pdf') && settings.resumeOutputFormats.includes('docx');
  const ext = preferDocx ? 'docx' : 'pdf';
  const docs = kind === 'resume' ? await buildResumeFormats(session, [ext], settings.resumeFormat) : await buildCoverLetterFormats(session, [ext], settings.resumeFormat);
  const blob = docs[ext];
  if (!blob) return null;
  return { name: uploadFileName(session, kind, ext), mime: MIME[ext]!, base64: await blobToBase64(blob) };
}
