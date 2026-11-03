import { ClaudeProvider } from '@/services/claude/provider';
import { cvFixture } from '../cvFixture';
import { describe, expect, it } from 'vitest';
import { fromResumeDocument, readResumeDocument, renderCoverLetterPdf, renderResumePdf, renderResumeText, toResumeDocument } from '@/resume-renderer';
import { parseCheckPdf } from '@/services/ats/parseCheck';
import { DEFAULT_SETTINGS } from '@/types';
import { runAnalysis, runDocuments } from '@/services/workflow/engine';
import { extractContacts, phoneDigits, withoutContacts } from '@/utils/contacts';
import { emptySession, exampleResume, mockJob } from '../helpers';

async function nodeLoader(data: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, disableFontFace: true }).promise as never;
}

async function tailored() {
  const job = mockJob();
  const master = exampleResume();
  const settings = { ...DEFAULT_SETTINGS, engine: 'claude' as const };
  const a = await runAnalysis(job, false, master, undefined, { settings, apiKey: null });
  const s = { ...emptySession(job, master.id), analysis: a.analysis, evidence: a.evidence };
  return runDocuments(s, master, undefined, { settings, apiKey: 'test', providerFactory: () => ({ generateCv: async () => ({data:cvFixture(),model:'test'}) } as unknown as ClaudeProvider) }, 'professional');
}

describe('resume JSON → PDF (no AI)', () => {
  it('round-trips a tailored resume through applyflow.resume/1 without losing content', async () => {
    const r = await tailored();
    const doc = toResumeDocument(r.resume, r.coverLetter, { company: 'Meridian' });
    const back = readResumeDocument(JSON.stringify(doc));
    expect(back.errors).toEqual([]);
    expect(back.doc!.experience.map((e) => e.company)).toEqual(r.resume.experience.map((e) => e.company));
    expect(renderResumeText(back.doc!)).toBe(renderResumeText(toResumeDocument(fromResumeDocument(back.doc!))));
    expect(back.doc!.coverLetter!.paragraphs.join('\n\n')).toBe(r.coverLetter!.text.trim());
  });

  it('every template is real text and passes the ATS parse test', async () => {
    const r = await tailored();
    const doc = toResumeDocument(r.resume, r.coverLetter);
    for (const template of ['classic', 'modern', 'compact'] as const) {
      const pdf = await renderResumePdf(doc, { template, font: 'arial' });
      const check = await parseCheckPdf(pdf, fromResumeDocument(doc), nodeLoader);
      expect(check.ok, template).toBe(true);
      expect(check.jobsFound).toBe(doc.experience.length);
    }
    expect((await renderCoverLetterPdf(doc))!.length).toBeGreaterThan(1000);
  }, 60000);

  it('reads hand-written JSON leniently and JSON Resume files', () => {
    const hand = readResumeDocument({ basics: { name: 'Sam Lee' }, experience: [{ title: 'Engineer', company: 'Acme', start: '2020', bullets: '• Built things\n• Shipped things' }], skills: ['Go', 'SQL'] });
    expect(hand.doc!.experience[0]!.bullets).toEqual(['Built things', 'Shipped things']);
    expect(hand.doc!.experience[0]!.end).toBe('Present');
    expect(hand.doc!.skills).toEqual([{ group: '', items: ['Go', 'SQL'] }]);
    const jr = readResumeDocument({ basics: { name: 'Ana', label: 'Data Engineer', location: { city: 'Austin', region: 'TX' } }, work: [{ name: 'Beta', position: 'Engineer', startDate: '2021-01', highlights: ['Moved 40 pipelines to Airflow.'] }], skills: [{ name: 'Data', keywords: ['Airflow', 'dbt'] }] });
    expect(jr.source).toBe('jsonresume');
    expect(jr.doc!.basics.location).toBe('Austin, TX');
    expect(jr.doc!.experience[0]!.bullets).toEqual(['Moved 40 pipelines to Airflow.']);
    expect(readResumeDocument('{oops').errors[0]).toMatch(/valid JSON/);
    expect(readResumeDocument({ experience: [] }).errors[0]).toMatch(/name/);
  });
});

describe('contacts in job postings', () => {
  it('finds phones and emails but not salaries or IDs', () => {
    const t = 'Call (312) 555-0147 x22 or 646.555.0199, email Recruiter@Example.com. Pay $120,000-150,000. Job ID 4155551234.';
    const c = extractContacts(t);
    expect(c.phones).toEqual(['(312) 555-0147 x22', '(646) 555-0199']);
    expect(c.emails).toEqual(['recruiter@example.com']);
    expect(phoneDigits('+1 (312) 555-0147')).toBe('3125550147');
    expect(withoutContacts(t)).not.toMatch(/312|example\.com/);
  });
});
