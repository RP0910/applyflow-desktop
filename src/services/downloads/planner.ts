/**
 * Plans every file for an application into the folder structure:
 *   ApplyFlow/<Company>/<YYYY-MM-DD>_<Job-Title>/resume_tailored.pdf …
 * Paths are relative to the browser's download directory (a Chrome limitation).
 */
import type { ApplicationRecord, JobSession, OutputFormat, SavedFile, Settings } from '@/types';
import { buildApplicationFolder, sanitizeRelativePath } from '@/utils/filename';
import { todayLocal } from '@/utils/dates';
import { APP_VERSION } from '@/version';
import { toResumeDocument } from '@/resume-renderer';

export interface PlannedFile {
  kind: SavedFile['kind'];
  format: string;
  relativePath: string;
  mime: string;
  data: Blob;
}

export interface GeneratedDocs {
  resume: Partial<Record<OutputFormat, Blob>>;
  coverLetter: Partial<Record<OutputFormat, Blob>>;
}

export const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

export function folderFor(session: Pick<JobSession, 'job'>, settings: Settings, date = todayLocal()): string {
  return buildApplicationFolder({
    root: settings.downloadRootFolder,
    company: session.job.company || 'Unknown company',
    title: session.job.title || 'Job',
    date,
    fileNameFormat: settings.fileNameFormat,
    createFolderPerApplication: settings.createFolderPerApplication,
    includeCompany: settings.includeCompanyInPath,
    includeTitle: settings.includeJobTitleInPath,
  });
}

export function metadataFor(record: ApplicationRecord, session: JobSession) {
  return {
    applicationId: record.id,
    datePrepared: record.datePrepared,
    dateSubmitted: record.dateApplied,
    jobTitle: record.title,
    company: record.company,
    location: record.location,
    remoteStatus: record.remoteStatus,
    salary: record.salary,
    jobUrl: record.jobUrl,
    resumeFilename: record.resumeFileName,
    coverLetterFilename: record.coverLetterFileName,
    matchScore: {
      master: record.matchScore,
      tailored: record.tailoredScore,
      note: 'Estimated internal ApplyFlow score — not an employer ATS score.',
    },
    atsCheck: session.atsTailored
      ? {
          master: session.atsMaster?.score ?? null,
          tailored: session.atsTailored.score,
          reachable: session.atsTailored.reachable,
          keywordsOnResume: session.atsTailored.keywords.filter((k) => k.found !== 'missing' && k.kind !== 'title').map((k) => k.term),
          keywordsNotOnResume: session.atsTailored.keywords.filter((k) => k.found === 'missing' && k.kind !== 'soft').map((k) => k.term),
          parseTest: session.atsParse ? { ok: session.atsParse.ok, jobsFound: session.atsParse.jobsFound, jobsExpected: session.atsParse.jobsExpected } : null,
          note: 'ApplyFlow’s simulation of a keyword-based ATS filter — real systems differ.',
        }
      : null,
    importantKeywords: record.keywords,
    missingQualifications: record.missingQualifications,
    applicationStatus: record.stage,
    followUpDate: record.followUpDate,
    notes: record.notes.map((n) => n.text),
    resumeVersion: record.resumeVersion,
    coverLetterVersion: record.coverLetterVersion || null,
    engine: session.resume?.engine ?? null,
    model: session.resume?.model ?? null,
    generatedBy: `ApplyFlow Desktop v${APP_VERSION}`,
  };
}

export function planApplicationFiles(record: ApplicationRecord, session: JobSession, settings: Settings, docs: GeneratedDocs, folder: string): PlannedFile[] {
  const out: PlannedFile[] = [];
  const at = (name: string) => sanitizeRelativePath(`${folder}/${name}`);
  for (const fmt of ['pdf', 'docx', 'txt', 'md'] as OutputFormat[]) {
    const blob = docs.resume[fmt];
    if (blob) out.push({ kind: 'resume', format: fmt, relativePath: at(`resume_tailored.${fmt}`), mime: MIME[fmt]!, data: blob });
  }
  if (session.includeCoverLetter) {
    for (const fmt of ['pdf', 'docx', 'txt', 'md'] as OutputFormat[]) {
      const blob = docs.coverLetter[fmt];
      if (blob) out.push({ kind: 'cover_letter', format: fmt, relativePath: at(`cover_letter.${fmt}`), mime: MIME[fmt]!, data: blob });
    }
  }
  // The resume as JSON (applyflow.resume/1): re-render it any time in PDF Studio — no AI, no tokens.
  if (session.resume) {
    const doc = toResumeDocument(session.resume, session.includeCoverLetter ? session.coverLetter : null, { jobTitle: session.job.title, company: session.job.company, jobUrl: session.job.url });
    out.push({ kind: 'resume_json', format: 'json', relativePath: at('resume.json'), mime: MIME.json!, data: new Blob([JSON.stringify(doc, null, 2)], { type: MIME.json }) });
  }
  if (settings.saveJobDescriptionFile && session.job.description) {
    const header = `${session.job.title}\n${session.job.company} — ${session.job.location}\n${session.job.url}\n\n`;
    out.push({ kind: 'job_description', format: 'txt', relativePath: at('job_description.txt'), mime: MIME.txt!, data: new Blob([header + session.job.description], { type: MIME.txt }) });
  }
  if (settings.saveMetadataFile) {
    out.push({ kind: 'metadata', format: 'json', relativePath: at('application_metadata.json'), mime: MIME.json!, data: new Blob([JSON.stringify(metadataFor(record, session), null, 2)], { type: MIME.json }) });
  }
  out.push({ kind: 'job_url', format: 'txt', relativePath: at('job_url.txt'), mime: MIME.txt!, data: new Blob([`${session.job.url}\n`], { type: MIME.txt }) });
  return out;
}
