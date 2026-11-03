import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseResumeText, assessParse, parseSkills } from '@/services/resume/parser';
import { readDocx, readPdf, readResumeFile, pdfItemsToLines, ResumeFileError } from '@/services/resume/fileReaders';
import { buildMasterResume, allowedResume, candidateFactsForPrompt, deriveFacts } from '@/services/resume/facts';
import { yearsOfExperience, employmentGaps } from '@/services/matching/experience';
import { exampleResumeText, ROOT } from '../helpers';

describe('resume section parsing', () => {
  const p = parseResumeText(exampleResumeText());

  it('extracts contact information', () => {
    expect(p.contact).toMatchObject({ fullName: 'Jordan Rivera', email: 'jordan.rivera@example.com', phone: '(312) 555-0148', location: 'Chicago, IL' });
    expect(p.contact.links).toEqual(['linkedin.com/in/jordan-rivera-example', 'github.com/jrivera-example']);
    expect(p.headline).toBe('Principal Software Engineer, AI Platforms');
  });

  it('parses every section without dropping content', () => {
    expect(p.summary).toMatch(/^Software engineer and architect/);
    expect(p.experience.map((e) => [e.title, e.company, e.location, e.startDate, e.endDate, e.bullets.length])).toEqual([
      ['Principal Software Engineer, AI Platform', 'Northlake Payments', 'Chicago, IL', 'Mar 2021', 'Present', 5],
      ['Senior Software Engineer', 'Northlake Payments', 'Chicago, IL', 'Jun 2017', 'Feb 2021', 3],
      ['Software Engineer', 'Brightline Logistics', 'Evanston, IL', 'Jul 2014', 'May 2017', 3],
    ]);
    expect(p.education[0]).toMatchObject({ degree: 'B.S. Computer Science', institution: 'University of Illinois Urbana-Champaign', date: '2014' });
    expect(p.certifications).toHaveLength(2);
    expect(p.projects[0]!.name).toBe('Open-source LLM evaluation harness');
    expect(p.unparsed).toEqual([]);
    expect(assessParse(p)).toEqual({ ok: true, problems: [] });
  });

  it('keeps parenthesized skill groups intact and ignores category labels', () => {
    expect(parseSkills(['Cloud & Platform: AWS (EC2, EKS, Lambda), Kubernetes | Docker'])).toEqual(['AWS (EC2, EKS, Lambda)', 'Kubernetes', 'Docker']);
    expect(p.skills).toContain('AWS (EC2, EKS, Lambda, S3, SageMaker, Bedrock)');
    expect(parseSkills(['Terraform, Helm AI & Data: Large Language Models, MLOps'])).toEqual(['Terraform', 'Helm', 'Large Language Models', 'MLOps']);
    expect(p.skills).not.toContain('Languages');
  });

  it('handles a title line followed by a separate date line', () => {
    const r = parseResumeText(`Sam Lee\nsam@example.com\n\nWork Experience\nData Analyst, Acme Corp\nJan 2019 - Dec 2022\n- Built dashboards in Tableau\n- Wrote SQL\n\nEducation\nBachelor of Science, State University, 2018\n\nSkills\nSQL, Tableau`);
    expect(r.experience[0]).toMatchObject({ title: 'Data Analyst', company: 'Acme Corp', startDate: 'Jan 2019', endDate: 'Dec 2022' });
    expect(r.experience[0]!.bullets).toEqual(['Built dashboards in Tableau', 'Wrote SQL']);
    expect(r.skills).toEqual(['SQL', 'Tableau']);
  });

  it('reports a malformed resume clearly', () => {
    const a = assessParse(parseResumeText('Just some notes without any structure at all.'));
    expect(a.ok).toBe(false);
    expect(a.problems.join(' ')).toMatch(/No work experience/);
  });

  it('computes years of experience and finds gaps', () => {
    expect(yearsOfExperience(p.experience, new Date('2026-10-30'))).toBeCloseTo(12.3, 1);
    expect(employmentGaps([{ startDate: 'Jan 2015', endDate: 'Dec 2016' }, { startDate: 'Jan 2018', endDate: 'Dec 2019' }])[0]!.months).toBe(12);
  });
});

describe('verified facts', () => {
  it('only exposes confirmed facts and never sends contact or authorization data to Claude', () => {
    const r = buildMasterResume('x', exampleResumeText(), 'text', null);
    r.facts.find((f) => f.text === 'Bash')!.status = 'do_not_use';
    r.facts.find((f) => f.text.startsWith('Mentored 8 engineers'))!.status = 'needs_review';
    const a = allowedResume(r);
    expect(a.skills).not.toContain('Bash');
    expect(a.experience[0]!.bullets.some((b) => b.startsWith('Mentored'))).toBe(false);
    expect(a.experience).toHaveLength(3); // roles are never hidden
    const facts = candidateFactsForPrompt(r, { workAuthorizationNote: 'H-1B', salaryPreference: '$200k' } as never);
    const json = JSON.stringify(facts);
    expect(json).not.toMatch(/jordan\.rivera@example\.com|555-0148|linkedin|H-1B|\$200k|Bash"/);
  });

  it('keeps statuses the user set when the resume is re-parsed', () => {
    const r = buildMasterResume('x', exampleResumeText(), 'text', null);
    r.facts.find((f) => f.text === 'Helm')!.status = 'do_not_use';
    const again = deriveFacts(parseResumeText(`${exampleResumeText()}\n`), r.facts);
    expect(again.find((f) => f.text === 'Helm')!.status).toBe('do_not_use');
  });
});

describe('resume file readers', () => {
  it('reads a real DOCX, including list bullets', async () => {
    const buf = readFileSync(resolve(ROOT, 'docs/examples/example-master-resume.docx'));
    const text = await readDocx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(text).toMatch(/^Jordan Rivera/);
    expect(text).toMatch(/• Designed and led delivery of an internal LLM gateway/);
    const parsed = parseResumeText(text);
    expect(parsed.experience).toHaveLength(3);
    expect(parsed.experience[0]!.bullets).toHaveLength(5);
  });

  it('rejects broken and unsupported files with a useful message', async () => {
    await expect(readDocx(new TextEncoder().encode('not a zip').buffer)).rejects.toMatchObject({ code: 'docx_failed' });
    await expect(readResumeFile(new File(['x'], 'resume.doc'))).rejects.toMatchObject({ code: 'unsupported' });
    await expect(readResumeFile(new File(['x'], 'resume.png'))).rejects.toBeInstanceOf(ResumeFileError);
  });

  it('turns PDF failures and scanned PDFs into clear errors', async () => {
    await expect(readPdf(new ArrayBuffer(8), async () => { throw new Error('bad'); })).rejects.toMatchObject({ code: 'pdf_failed' });
    const empty = async () => ({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [] }) }) });
    await expect(readPdf(new ArrayBuffer(8), empty)).rejects.toMatchObject({ code: 'pdf_scanned' });
  });

  it('re-joins lines that the PDF layout wrapped, but not separate bullets or headings', () => {
    const item = (str: string, x: number, y: number, width: number) => ({ str, transform: [1, 0, 0, 1, x, y], width });
    const lines = pdfItemsToLines([
      item('EXPERIENCE', 54, 700, 80),
      item('• Designed and led delivery of an internal LLM gateway on AWS EKS that routes requests', 54, 686, 500),
      item('across multiple providers.', 64, 672, 140),
      item('• Built a retrieval service.', 54, 658, 160),
      item('SKILLS', 54, 640, 50),
      item('Cloud: AWS (EC2, EKS, Lambda, S3, SageMaker, Bedrock), Kubernetes, Docker, Terraform, Helm', 54, 626, 500),
      item('AI & Data: Large Language Models, MLOps', 54, 612, 220),
    ]);
    expect(lines).toEqual([
      'EXPERIENCE',
      '• Designed and led delivery of an internal LLM gateway on AWS EKS that routes requests across multiple providers.',
      '• Built a retrieval service.',
      'SKILLS',
      'Cloud: AWS (EC2, EKS, Lambda, S3, SageMaker, Bedrock), Kubernetes, Docker, Terraform, Helm',
      'AI & Data: Large Language Models, MLOps',
    ]);
  });
});

describe('resumes with several jobs (FlowCV-style PDFs)', () => {
  // Bold header with the dates right-aligned at the margin, regular bullets that wrap to the margin.
  const B = 'Bold', R = 'Regular';
  const it_ = (str: string, x: number, y: number, width: number, fontName = R, height = 10) => ({ str, transform: [height, 0, 0, height, x, y], width, height, fontName });
  const items = [
    it_('Professional Experience', 40, 700, 160, B, 12),
    it_('AI Video Playback Engineer, Lumenstream', 40, 680, 240, B),
    it_('02/2023 – 05/2026', 470, 680, 100, R),
    it_('Denver, CO', 512, 667, 58, R),
    it_('•', 44, 652, 4),
    it_('Architected and deployed LLM-based AI agents and agentic workflows that orchestrate tools, internal', 54, 652, 516),
    it_('APIs and telemetry queries.', 54, 639, 150),
    it_('•', 44, 624, 4),
    it_('Built retrieval-augmented generation pipelines with embeddings and vector search over runbooks and', 54, 624, 516),
    it_('incident history for support and operations teams across the whole organization and its partners', 54, 611, 516),
    it_('Staff Software Engineer, Comcast', 40, 590, 210, B),
    it_('06/2018 – 01/2023', 470, 590, 100, R),
    it_('Philadelphia, PA', 482, 577, 88, R),
    it_('•', 44, 562, 4),
    it_('Led the player platform used by millions of monthly viewers.', 54, 562, 330),
    it_('Software Engineer, Peacock', 40, 541, 180, B),
    it_('2015 – 2018', 505, 541, 65, R),
    it_('•', 44, 526, 4),
    it_('Shipped the first Roku and Fire TV apps.', 54, 526, 220),
    it_('Education', 40, 500, 70, B, 12),
    it_('Bachelor’s Degree, Computer Science, Temple University, 2013', 40, 485, 330),
  ];

  it('keeps every job header on its own line, even after a bullet that runs to the margin', () => {
    const lines = pdfItemsToLines(items);
    expect(lines).toContain('Staff Software Engineer, Comcast  06/2018 – 01/2023');
    expect(lines).toContain('Software Engineer, Peacock  2015 – 2018');
    expect(lines).toContain('Education');
    expect(lines.some((l) => l.includes('partners Staff'))).toBe(false);
    // Real wraps are still joined.
    expect(lines).toContain('• Architected and deployed LLM-based AI agents and agentic workflows that orchestrate tools, internal APIs and telemetry queries.');
  });

  it('parses all three roles with their dates', () => {
    const text = ['Riley Chen', 'grant@example.com', ...pdfItemsToLines(items), 'Skills', 'Python, LLM'].join('\n');
    const p = parseResumeText(text);
    expect(p.experience.map((e) => [e.title, e.company, e.startDate, e.endDate])).toEqual([
      ['AI Video Playback Engineer', 'Lumenstream', '02/2023', '05/2026'],
      ['Staff Software Engineer', 'Comcast', '06/2018', '01/2023'],
      ['Software Engineer', 'Peacock', '2015', '2018'],
    ]);
    expect(p.experience[0]!.bullets).toHaveLength(2);
    expect(assessParse(p).problems.join(' ')).not.toMatch(/merged/);
  });

  it('repairs resumes that an older reader glued together, and warns when it can’t', () => {
    const glued = [
      'Experience',
      'AI Video Playback Engineer, Lumenstream 02/2023 – 05/2026 Denver, CO',
      '• Built retrieval pipelines for support and operations teams. Staff Software Engineer, Comcast 06/2018 – 01/2023 Philadelphia, PA',
      '• Led the player platform used by millions of monthly viewers.',
      '• Mentored engineers on playback architecture Software Engineer, Peacock 2015 – 2018',
      '• Shipped the first Roku and Fire TV apps.',
    ];
    const p = parseResumeText(['Riley Chen', 'grant@example.com', ...glued].join('\n'));
    expect(p.experience.map((e) => e.company)).toEqual(['Lumenstream', 'Comcast', 'Peacock']);
    expect(p.experience[0]!.bullets).toEqual(['Built retrieval pipelines for support and operations teams.']);
    expect(p.experience[1]!.bullets).toEqual(['Led the player platform used by millions of monthly viewers.', 'Mentored engineers on playback architecture']);

    const bad = parseResumeText('Jo Doe\njo@example.com\nExperience\nEngineer, Acme 2020 – 2023\n• Did things; then Senior Engineer at Beta Corp from 2018 – 2020 we shipped a lot of software for many customers worldwide');
    expect(bad.experience).toHaveLength(1);
  });

  it('splits two dated headers in a row (a promotion with no bullets) into two roles', () => {
    const p = parseResumeText('Jo Doe\njo@example.com\nExperience\nSenior Engineer, Acme  Jan 2022 – Present\nEngineer, Acme  Mar 2019 – Dec 2021\n• Built the billing service.');
    expect(p.experience.map((e) => [e.title, e.startDate])).toEqual([
      ['Senior Engineer', 'Jan 2022'],
      ['Engineer', 'Mar 2019'],
    ]);
  });

  it('flags a bullet that still contains another job’s dates', () => {
    const p = parseResumeText('Jo Doe\njo@example.com\nExperience\nEngineer, Acme 2020 – 2023\n• Did many things (as Staff Engineer at Beta 2018 – 2020) for many people worldwide across several product lines');
    expect(assessParse(p).problems.join(' ')).toMatch(/merged/);
  });
});

describe('technology lists under each job (v1.3)', () => {
  const base = (exp: string[], after: string[] = []) =>
    ['Riley Chen', 'riley@example.com | (555) 010-2000 | Denver, CO', 'PROFESSIONAL EXPERIENCE', ...exp, ...after].join('\n');

  it('keeps every job when each one has a "Technologies" heading', () => {
    const p = parseResumeText(
      base(
        [
          '02/2023 – Present Acme Media',
          'Denver, CO  Senior Player Engineer',
          '• Built the player SDK used by every app.',
          'Technologies',
          'Swift • Kotlin • ExoPlayer',
          '09/2020 – 01/2023 Beta Streams',
          'Boston,  Video Engineer',
          'United States  Ran the live ingest platform.',
          '• Built HLS packaging workflows.',
          'Technologies',
          'C++ • FFmpeg • HLS',
          '• Docker • Kubernetes',
        ],
        ['EDUCATION', 'BS Computer Science, State University, 2014', 'SKILLS', 'Python, Go'],
      ),
    );
    expect(p.experience.map((e) => [e.company, e.title, e.location])).toEqual([
      ['Acme Media', 'Senior Player Engineer', 'Denver, CO'],
      ['Beta Streams', 'Video Engineer', 'Boston, United States'],
    ]);
    expect(p.experience[1]!.technologies).toEqual(['C++', 'FFmpeg', 'HLS', 'Docker', 'Kubernetes']);
    expect(p.experience[1]!.bullets).toEqual(['Ran the live ingest platform.', 'Built HLS packaging workflows.']);
    expect(p.skills).toEqual(['Python', 'Go']);
  });

  it('reads inline "Tech stack:" and "Environment:" lines as the job’s technologies', () => {
    const p = parseResumeText(
      base([
        'Senior Engineer, Acme | Jan 2021 – Present',
        '- Built the billing service.',
        'Tech stack: Java, Spring Boot, AWS',
        'Engineer, Beta | Jan 2018 – Dec 2020',
        '- Built the reporting API.',
        'Environment: Python, Django, PostgreSQL.',
      ]),
    );
    expect(p.experience).toHaveLength(2);
    expect(p.experience[0]!.technologies).toEqual(['Java', 'Spring Boot', 'AWS']);
    expect(p.experience[1]!.technologies).toEqual(['Python', 'Django', 'PostgreSQL']);
  });

  it('still treats a top-level TECHNOLOGIES section after Experience as skills', () => {
    const p = parseResumeText(base(['Senior Engineer, Acme | Jan 2021 – Present', '- Built the billing service.'], ['TECHNOLOGIES', 'Java, Go, Kubernetes']));
    expect(p.experience).toHaveLength(1);
    expect(p.experience[0]!.technologies).toBeUndefined();
    expect(p.skills).toEqual(['Java', 'Go', 'Kubernetes']);
  });

  it('joins bullets the PDF wrapped onto the next line', () => {
    const p = parseResumeText(
      base([
        'Senior Engineer, Acme | Jan 2021 – Present',
        '•Designed the playback architecture using',
        'AVFoundation, AVPlayer and',
        'AVPictureInPictureController.',
        '•Optimized startup latency and seek performance',
        'for HTTP Live Streaming (HLS).',
      ]),
    );
    expect(p.experience[0]!.bullets).toEqual([
      'Designed the playback architecture using AVFoundation, AVPlayer and AVPictureInPictureController.',
      'Optimized startup latency and seek performance for HTTP Live Streaming (HLS).',
    ]);
  });

  it('warns when the summary claims far more years than the jobs found', () => {
    const p = parseResumeText(['Riley Chen', 'riley@example.com', 'SUMMARY', 'Engineer with 10+ years of experience.', 'EXPERIENCE', 'Engineer, Acme | 01/2023 – 05/2026', '- Built things.', 'SKILLS', 'Go'].join('\n'));
    expect(assessParse(p).problems.join(' ')).toMatch(/says 10\+ years.*about 3 years/);
  });
});

