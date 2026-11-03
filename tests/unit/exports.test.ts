import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { analyzeJobLocally } from '@/services/analysis/localAnalyzer';
import { classifySkills } from '@/services/matching/evidence';
import { tailorLocally } from '@/services/tailoring/localTailor';
import { resumeToText, resumeToMarkdown } from '@/services/export/render';
import { resumeToPdf, coverLetterToPdf } from '@/services/export/pdf';
import { resumeToDocx } from '@/services/export/docx';
import { planApplicationFiles, metadataFor, folderFor } from '@/services/downloads/planner';
import { recordFromSession } from '@/services/history/history';
import { DEFAULT_SETTINGS } from '@/types';
import { emptySession, exampleResume, mockJob } from '../helpers';

const master = exampleResume();
const job = mockJob();
const analysis = analyzeJobLocally(job, master);
const evidence = classifySkills(analysis.requiredSkills, analysis.preferredSkills, master);
const t = tailorLocally({ master, job, analysis, evidence, length: 'two_pages', version: 1 });

/** jsdom's Blob isn't readable by Node's Response, so read it the browser way. */
function blobBytes(b: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(b);
  });
}

describe('document output', () => {
  it('renders plain text and Markdown with standard headings', () => {
    const txt = resumeToText(t);
    for (const h of ['PROFESSIONAL SUMMARY', 'TECHNICAL SKILLS', 'PROFESSIONAL EXPERIENCE', 'EDUCATION', 'CERTIFICATIONS']) expect(txt).toContain(h);
    expect(txt).toMatch(/^JORDAN RIVERA/);
    expect(resumeToMarkdown(t)).toMatch(/^# Jordan Rivera/);
  });

  it('creates a real PDF with selectable text in a standard font', async () => {
    const pdf = await resumeToPdf(t);
    const head = new TextDecoder().decode(pdf.slice(0, 5));
    expect(head).toBe('%PDF-');
    const raw = new TextDecoder('latin1').decode(pdf);
    expect(raw).toContain('/Helvetica');
    expect(raw).not.toContain('/Image');
    const letter = await coverLetterToPdf('Dear Hiring Team,\n\nHello → there ≥ 5 ★.\n\nSincerely,\nJordan', t);
    expect(letter.length).toBeGreaterThan(500); // unencodable characters were replaced, not crashed on
  });

  it('creates a single-column DOCX without tables or images', async () => {
    const zip = await JSZip.loadAsync(await blobBytes(await resumeToDocx(t)));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Jordan Rivera');
    expect(xml).toContain('PROFESSIONAL EXPERIENCE');
    expect(xml).not.toContain('<w:tbl>');
    expect(xml).not.toContain('<w:drawing>');
    expect(xml).not.toContain('<w:txbxContent>');
  });
});

describe('download planning', () => {
  const session = { ...emptySession(job), resume: t, analysis, evidence };
  const record = { ...recordFromSession(session, 'Applied'), resumeFileName: 'resume_tailored.pdf' };

  it('plans the documented folder structure and file set', () => {
    const folder = folderFor(session, DEFAULT_SETTINGS, '2026-10-30');
    expect(folder).toBe('ApplyFlow/Meridian-Credit-Analytics-LLC/2026-10-30_Senior-Architect-AI-Engineering-and-Platforms');
    const blob = new Blob(['x']);
    const files = planApplicationFiles(record, session, DEFAULT_SETTINGS, { resume: { pdf: blob, docx: blob }, coverLetter: { pdf: blob, txt: blob } }, folder);
    expect(files.map((f) => f.relativePath.split('/').pop())).toEqual([
      'resume_tailored.pdf', 'resume_tailored.docx', 'cover_letter.pdf', 'cover_letter.txt', 'resume.json', 'job_description.txt', 'application_metadata.json', 'job_url.txt',
    ]);
    const noExtras = planApplicationFiles(record, { ...session, includeCoverLetter: false }, { ...DEFAULT_SETTINGS, saveJobDescriptionFile: false, saveMetadataFile: false }, { resume: { pdf: blob }, coverLetter: { pdf: blob } }, folder);
    expect(noExtras.map((f) => f.kind)).toEqual(['resume', 'resume_json', 'job_url']);
  });

  it('writes every required metadata field', () => {
    const m = metadataFor(record, session);
    for (const k of ['applicationId', 'datePrepared', 'dateSubmitted', 'jobTitle', 'company', 'location', 'jobUrl', 'resumeFilename', 'coverLetterFilename', 'matchScore', 'importantKeywords', 'missingQualifications', 'applicationStatus', 'followUpDate', 'notes']) {
      expect(m).toHaveProperty(k);
    }
    expect(m.matchScore.note).toMatch(/Estimated/);
  });
});
