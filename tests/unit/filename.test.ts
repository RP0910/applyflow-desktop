import { describe, expect, it } from 'vitest';
import { sanitizeFilename, sanitizeRelativePath, buildApplicationFolder, formatTemplate } from '@/utils/filename';

describe('filename sanitization', () => {
  it('removes characters that are invalid on Windows, macOS or Linux', () => {
    expect(sanitizeFilename('Acme: "R&D" <Labs>/Inc?*|')).toBe('Acme-R&D-Labs-Inc');
    expect(sanitizeFilename('Senior Architect AI Engineering and Platforms')).toBe('Senior-Architect-AI-Engineering-and-Platforms');
  });

  it('handles accents, control characters, reserved names, dots and empty input', () => {
    expect(sanitizeFilename('Société Générale')).toBe('Societe-Generale');
    expect(sanitizeFilename('bad\u0000name\u001f')).toBe('bad-name');
    expect(sanitizeFilename('CON')).toBe('CON_');
    expect(sanitizeFilename('...hidden...')).toBe('hidden');
    expect(sanitizeFilename('   ', 'fallback')).toBe('fallback');
  });

  it('limits length', () => {
    expect(sanitizeFilename('x'.repeat(300)).length).toBeLessThanOrEqual(80);
  });

  it('blocks path traversal in relative paths', () => {
    expect(sanitizeRelativePath('../../etc/passwd')).toBe('etc/passwd');
    expect(sanitizeRelativePath('ApplyFlow/Acme: Inc/2026-10-30_Job?/resume_tailored.pdf')).toBe('ApplyFlow/Acme-Inc/2026-10-30_Job/resume_tailored.pdf');
  });

  it('builds the per-application folder from settings', () => {
    const base = { root: 'ApplyFlow', company: 'Meridian Credit Analytics LLC', title: 'Senior Architect', date: '2026-10-30', fileNameFormat: '{date}_{title}', createFolderPerApplication: true, includeCompany: true, includeTitle: true };
    expect(buildApplicationFolder(base)).toBe('ApplyFlow/Meridian-Credit-Analytics-LLC/2026-10-30_Senior-Architect');
    expect(buildApplicationFolder({ ...base, includeCompany: false })).toBe('ApplyFlow/2026-10-30_Senior-Architect');
    expect(buildApplicationFolder({ ...base, includeTitle: false })).toBe('ApplyFlow/Meridian-Credit-Analytics-LLC/2026-10-30');
    expect(buildApplicationFolder({ ...base, createFolderPerApplication: false })).toBe('ApplyFlow/Meridian-Credit-Analytics-LLC');
    expect(formatTemplate('{company}_{title}_{date}', { company: 'A', title: 'B', date: 'C' })).toBe('A_B_C');
  });
});
