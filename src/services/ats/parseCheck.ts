/**
 * Parse test: read the exported resume PDF back with a text extractor and resume parser —
 * what an ATS does on upload — and confirm the name, contact details and every job survive.
 */
import type { ParseCheck, TailoredResume } from '@/types';
import { readPdf } from '@/services/resume/fileReaders';
import { parseResumeText } from '@/services/resume/parser';
import { parseResumeDate } from '@/utils/dates';
import { nowIso } from '@/utils/dates';
import { termKey } from './terms';

type Loader = Parameters<typeof readPdf>[1];

export function checkParsedText(text: string, t: TailoredResume): ParseCheck {
  const p = parseResumeText(text);
  const problems: string[] = [];
  const name = termKey(p.contact.fullName) === termKey(t.contact.fullName);
  const email = !t.contact.email || p.contact.email.toLowerCase() === t.contact.email.toLowerCase();
  const phone = !t.contact.phone || p.contact.phone.replace(/\D/g, '').endsWith(t.contact.phone.replace(/\D/g, '').slice(-10));
  if (!name) problems.push(`The name was read as “${p.contact.fullName || '(nothing)'}”.`);
  if (!email) problems.push('The email address could not be read.');
  if (!phone) problems.push('The phone number could not be read.');
  let found = 0;
  for (const e of t.experience) {
    const hit = p.experience.find(
      (x) => termKey(x.company) === termKey(e.company) && termKey(x.title) === termKey(e.title) && parseResumeDate(x.startDate) === parseResumeDate(e.startDate),
    );
    if (hit) found++;
    else problems.push(`“${e.title}” at ${e.company} was not read back as a separate job with its dates.`);
  }
  const sections = [p.summary && 'Summary', p.skills.length && 'Skills', p.experience.length && 'Experience', p.education.length && 'Education'].filter(Boolean) as string[];
  if (t.education.length && !p.education.length) problems.push('The Education section was not recognized.');
  // Every word must come out intact — a broken glyph map turns "platforms" into "pla orms".
  const words = (s: string) => s.toLowerCase().normalize('NFKC').match(/[a-z0-9][a-z0-9+#.-]*[a-z0-9+#]|[a-z0-9]/g) ?? [];
  const got = new Set(words(text));
  const expected = Array.from(new Set(words([t.headline, t.summary, ...t.skills, ...t.experience.flatMap((e) => [e.title, e.company, ...e.bullets])].join(' ')).filter((w) => w.length >= 3)));
  const lost = expected.filter((w) => !got.has(w));
  const textIntegrity = expected.length ? (expected.length - lost.length) / expected.length : 1;
  if (textIntegrity < 0.995) problems.push(`Some words don’t come out of the PDF intact (${lost.slice(0, 5).map((w) => `“${w}”`).join(', ')}).`);
  return { ok: problems.length === 0, jobsExpected: t.experience.length, jobsFound: found, name, email, phone, sections, textIntegrity, problems, checkedAt: nowIso() };
}

export async function parseCheckPdf(bytes: Uint8Array, t: TailoredResume, loader?: Loader): Promise<ParseCheck> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const text = await readPdf(buf, loader);
  return checkParsedText(text, t);
}
