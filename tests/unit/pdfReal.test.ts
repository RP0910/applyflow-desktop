// @vitest-environment node
/**
 * The real pdf.js text extraction on a FlowCV-style PDF (bold "Title, Company" with dates
 * right-aligned at the margin, bullets drawn as graphics, text wrapping to the margin).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readPdf } from '@/services/resume/fileReaders';
import { assessParse, parseResumeText } from '@/services/resume/parser';

const ROOT = resolve(__dirname, '../..');

async function nodeLoader(data: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, disableFontFace: true }).promise as never;
}

describe('real PDF resumes', () => {
  for (const file of ['example-master-resume.pdf', 'example-master-resume-flowcv-style.pdf']) {
    it(`reads every job from ${file}`, async () => {
      const buf = readFileSync(resolve(ROOT, 'docs/examples', file));
      const text = await readPdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, nodeLoader);
      const p = parseResumeText(text);
      expect(p.experience.map((e) => [e.title, e.company, e.startDate, e.endDate])).toEqual([
        ['Principal Software Engineer, AI Platform', 'Northlake Payments', 'Mar 2021', 'Present'],
        ['Senior Software Engineer', 'Northlake Payments', 'Jun 2017', 'Feb 2021'],
        ['Software Engineer', 'Brightline Logistics', 'Jul 2014', 'May 2017'],
      ]);
      expect(p.experience.map((e) => e.bullets.length)).toEqual([5, 3, 3]);
      expect(p.education).toHaveLength(1);
    }, 30000);
  }

  it('reads every job from a two-column FlowCV PDF with a Technologies list under each job', async () => {
    const buf = readFileSync(resolve(ROOT, 'docs/examples/example-master-resume-two-column.pdf'));
    const text = await readPdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, nodeLoader);
    const p = parseResumeText(text);
    expect(p.experience.map((e) => [e.title, e.company, e.location, e.startDate, e.endDate])).toEqual([
      ['Senior Video Player Engineer', 'Lumenstream', 'Austin, TX', '03/2022', '08/2026'],
      ['Video Streaming Engineer', 'Signalwave Media', 'Austin, United States', '06/2019', '02/2022'],
      ['Software Engineer', 'Northbeam Video Inc', 'Portland, United States', '01/2017', '05/2019'],
      ['Junior Backend Developer', 'Hanbit Apps', 'Seoul, South Korea', '07/2015', '12/2016'],
    ]);
    expect(p.experience.map((e) => e.bullets.length)).toEqual([5, 5, 4, 3]);
    // Wrapped bullet lines are joined back together, with no stray bullet glyphs.
    expect(p.experience[0]!.bullets[1]).toBe('Designed the Apple playback architecture using AVFoundation, AVPlayer, AVPlayerItem and AVPictureInPictureController.');
    expect(p.experience.flatMap((e) => e.bullets).some((b) => /•/.test(b))).toBe(false);
    expect(p.experience[1]!.technologies).toContain('Kubernetes');
    expect(p.experience[0]!.technologies).toHaveLength(12);
    expect(p.education[0]).toMatchObject({ degree: "Bachelor's degree in Computer Science", institution: 'University of Washington', date: '09/2011 – 06/2015', location: 'Seattle, WA' });
    // Grid category labels ("Video Players", "Cloud & DevOps") are not skills.
    expect(p.skills).toContain('Shaka Player');
    expect(p.skills).not.toContain('Video Players');
    expect(p.skills.some((s) => /Cloud & DevOps|Streaming Infrastructure/.test(s))).toBe(false);
    expect(p.skills.some((s) => /\d{2}\/\d{4}/.test(s))).toBe(false);
    expect(assessParse(p).problems).toEqual([]);
  }, 30000);
});
