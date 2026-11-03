// @vitest-environment node
/**
 * The ATS resume engine end to end on a two-column FlowCV-style resume and a video playback
 * job: keywords, plan, truthfulness, Claude draft + refine (mocked), export and parse test.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import type { JobPosting, MasterResume, Settings, TailoredResume } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import type { TailorResumeReply } from '@/prompts/tailorResume';
import { readPdf } from '@/services/resume/fileReaders';
import { buildMasterResume } from '@/services/resume/facts';
import { extractDiceJob } from '@/services/platforms/dice/adapter';
import { analyzeJobLocally } from '@/services/analysis/localAnalyzer';
import { buildAtsPlan, cleanJobTitle, coreTitle, docFromMaster, extractJobKeywords, scanResume, targetTitleFor } from '@/services/ats';
import { runAnalysis, runTailoring, type EngineDeps } from '@/services/workflow/engine';
import { validateTailoredResume } from '@/services/tailoring/validator';
import { assembleFromClaude } from '@/services/tailoring/assemble';
import { resumeToPdf } from '@/services/export/pdf';
import { resumeToDocx } from '@/services/export/docx';
import { resumeToText } from '@/services/export/render';
import { formatDate, formatDateText } from '@/services/export/layout';
import { parseCheckPdf, checkParsedText } from '@/services/ats/parseCheck';
import { setFontLoader } from '@/services/export/fonts';
import type { ClaudeProvider } from '@/services/claude/provider';
import { ROOT, fixture, emptySession } from '../helpers';
import JSZip from 'jszip';

async function nodeLoader(data: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, disableFontFace: true }).promise as never;
}

const NOW = new Date('2026-10-30T12:00:00Z');
let master: MasterResume;
let job: JobPosting;

beforeAll(async () => {
  (globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM('').window.DOMParser;
  setFontLoader(async (f) => {
    const b = readFileSync(resolve(ROOT, 'public/fonts', f));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });
  const buf = readFileSync(resolve(ROOT, 'docs/examples/example-master-resume-two-column.pdf'));
  const text = await readPdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, nodeLoader);
  master = buildMasterResume('Jordan', text, 'pdf', 'jordan.pdf');
  job = extractDiceJob(new JSDOM(fixture('job-detail-video-playback.html')).window.document, 'https://www.dice.com/job-detail/5b2e9d10-4a3c-4f1e-8d7a-61c0b9e2f4a8').job!;
}, 30000);

const plan = () => buildAtsPlan(job, master, undefined, extractJobKeywords(job, analyzeJobLocally(job, master)), 'two_pages', 7, NOW);

describe('job keywords', () => {
  it('cleans the job title and takes the posting’s own words', () => {
    expect(cleanJobTitle('Senior Video Playback Engineer - Remote (W2)')).toBe('Senior Video Playback Engineer');
    expect(coreTitle('Sr. Video Playback Engineer II')).toBe('Video Playback Engineer');
    const kws = extractJobKeywords(job, analyzeJobLocally(job, master));
    const terms = kws.map((k) => k.term);
    expect(kws[0]).toMatchObject({ term: 'Senior Video Playback Engineer', kind: 'title', weight: 6 });
    for (const t of ['HLS', 'MPEG-DASH', 'DRM', 'ExoPlayer', 'AVFoundation', 'Kubernetes', 'Samsung Tizen', 'LG webOS', 'Microservices', 'Distributed Systems']) expect(terms).toContain(t);
    expect(terms.some((t) => /^LLMs?$/.test(t))).toBe(true);
    // Fragments of longer keywords are not keywords of their own.
    for (const t of ['TV', 'MPEG', 'Shaka', 'SceneGraph', 'Tizen']) expect(terms).not.toContain(t);
    expect(kws.find((k) => k.kind === 'education')?.term).toBe('Bachelor’s degree');
    expect(kws.some((k) => k.kind === 'soft')).toBe(true);
    // Required-section skills outweigh preferred ones.
    const preferred = kws.filter((k) => k.importance === 'preferred' && k.kind === 'hard');
    expect(preferred.length).toBeGreaterThan(0);
    expect(kws.find((k) => k.term === 'HLS')!.weight).toBeGreaterThan(Math.max(...preferred.map((k) => k.weight)));
  });
});

describe('ATS plan', () => {
  it('only lets the resume use keywords the master resume backs', () => {
    const p = plan();
    const support = (t: string) => p.keywords.find((k) => k.term === t)?.support;
    expect(support('HLS')).toBe('supported');
    expect(support('Kubernetes')).toBe('supported');
    expect(support('Microservices')).not.toBe('supported');
    expect(support('Distributed Systems')).toBe('missing');
    expect(p.keywords.find((k) => /^LLMs?$/.test(k.term))!.support).toBe('missing');
    // Kubernetes is only proven at Signalwave, so it may only be placed in that job.
    const k8s = p.keywords.find((k) => k.term === 'Kubernetes')!;
    expect(k8s.placements).toContain(`exp:${master.parsed.experience[1]!.id}`);
    expect(k8s.placements).not.toContain(`exp:${master.parsed.experience[0]!.id}`);
  });

  it('uses the job title when the candidate’s titles match, never a higher level they haven’t held', () => {
    expect(targetTitleFor(job, master)).toEqual({ title: 'Senior Video Playback Engineer', source: 'job' });
    expect(targetTitleFor({ title: 'Principal Video Playback Engineer' }, master)).toEqual({ title: 'Video Playback Engineer', source: 'job' });
    expect(targetTitleFor({ title: 'Data Scientist' }, master).source).toBe('resume');
  });

  it('counts years from all jobs and gives every job bullets, recent ones more', () => {
    const p = plan();
    expect(p.years).toBe(11);
    const ids = master.parsed.experience.map((e) => e.id);
    expect(ids.every((id) => p.bulletBudget[id]! >= 2)).toBe(true);
    expect(p.bulletBudget[ids[0]!]).toBeGreaterThanOrEqual(p.bulletBudget[ids[3]!]!);
  });
});

describe('ATS scan', () => {
  it('scores the master resume and explains every point', () => {
    const r = scanResume(docFromMaster(master), { plan: plan(), masterJobs: 4, computedFor: 'master', now: NOW });
    expect(r.score).toBeGreaterThan(50);
    expect(r.reachable).toBeGreaterThanOrEqual(r.score);
    expect(r.categories.find((c) => c.key === 'format')!.applicable).toBe(false);
    expect(r.checks.find((c) => c.id === 'all_jobs')!.status).toBe('pass');
    expect(r.keywords.find((k) => k.term === 'Distributed Systems')).toMatchObject({ found: 'missing', support: 'missing' });
  });

  it('fails the "all jobs" check when a job is missing', () => {
    const doc = docFromMaster(master);
    doc.experience = doc.experience.slice(0, 1);
    const r = scanResume(doc, { plan: plan(), masterJobs: 4, computedFor: 'tailored', now: NOW });
    expect(r.checks.find((c) => c.id === 'all_jobs')).toMatchObject({ status: 'fail', label: 'Only 1 of 4 jobs included' });
  });
});

const ids = () => master.parsed.experience.map((e) => e.id);

/** A plausible Claude draft with the mistakes models make: banned skills, moved skills, inflated years, a dropped job. */
function badDraft(): TailorResumeReply {
  const [a, b, , d] = ids();
  return {
    headline: 'Senior Video Playback Engineer | HLS, DRM, Microservices',
    summary:
      'Senior Video Playback Engineer with 15+ years of experience building cross-platform player SDKs for OTT and connected TV. Built LLM-based tooling for playback diagnostics. Deep expertise in HLS, MPEG-DASH, CMAF and DRM with Widevine and FairPlay.',
    skillGroups: [
      { name: 'Video Streaming', skills: ['HLS', 'MPEG-DASH', 'CMAF', 'DRM', 'Widevine', 'FairPlay', 'LL-HLS'] },
      { name: 'Players & Devices', skills: ['ExoPlayer', 'Android Media3', 'AVFoundation', 'AVPlayer', 'Shaka Player', 'HLS.js', 'Roku'] },
      { name: 'AI', skills: ['LLM', 'AI agents'] },
      { name: 'Cloud & DevOps', skills: ['AWS', 'Docker', 'Kubernetes', 'Terraform'] },
    ],
    experience: [
      {
        sourceId: a!,
        bullets: [
          'Designed the Apple playback architecture using AVFoundation, AVPlayer, AVPlayerItem and AVPictureInPictureController.',
          'Migrated the Android player framework from ExoPlayer 2 to Android Media3 across phone, tablet and Android TV apps.',
          'Built adaptive bitrate (ABR) heuristics that reduced rebuffering by 18% using playback telemetry.',
          'Deployed playback services on Kubernetes with Docker for millions of monthly viewers.',
        ],
        technologies: ['Swift', 'Kotlin', 'Kubernetes'],
      },
      {
        sourceId: b!,
        bullets: [
          'Built Low-Latency HLS (LL-HLS), MPEG-DASH and CMAF packaging workflows with FFmpeg and GStreamer.',
          'Designed live ingest pipelines supporting SRT, RTMP and MPEG-TS for 40 broadcast channels.',
          'Integrated AWS MediaLive, MediaPackage and MediaTailor into cloud broadcast workflows.',
          'Automated deployments using Docker, Kubernetes and Terraform.',
        ],
        technologies: ['FFmpeg', 'GStreamer', 'Docker', 'Kubernetes'],
      },
      { sourceId: d!, bullets: ['Developed RESTful microservices using Java and Spring Boot.'], technologies: ['Java', 'Spring Boot'] },
    ],
    projects: [],
    certificationIndexes: [],
    additional: ['Bachelor’s degree in Computer Science, University of Washington'],
    changes: [{ section: 'Summary', before: '', after: '', reason: 'Targets the job.' }],
    unsupportedRequirements: ['LLMs', 'AI agents', 'Distributed systems'],
  };
}

/** The 2.0 compact reply for a draft written in the 1.x shape (job ids pass through unchanged). */
function asApplication(r: TailorResumeReply) {
  return {
    headline: r.headline,
    summary: r.summary,
    skills: (r.skillGroups ?? []).map((g) => ({ group: g.name, items: g.skills })),
    jobs: r.experience.map((e) => ({ id: e.sourceId, bullets: e.bullets, tech: e.technologies ?? [] })),
    projects: r.projects.map((p) => ({ name: p.sourceName, bullets: p.bullets })),
    certs: r.certificationIndexes,
    gaps: r.unsupportedRequirements,
  };
}

function fakeProvider(draft: TailorResumeReply, refined?: TailorResumeReply) {
  const calls: string[] = [];
  const p = {
    writeApplication: async () => {
      calls.push('tailor');
      return { data: asApplication(draft), model: 'claude-opus-5-5' };
    },
    refineApplication: async (_facts: unknown, input: { findings: string[] }) => {
      calls.push(`refine:${input.findings.length}`);
      if (!refined) throw new Error('no refine');
      return { data: asApplication(refined), model: 'claude-opus-5-5' };
    },
  };
  return { calls, factory: () => p as unknown as ClaudeProvider };
}

async function tailor(draft: TailorResumeReply, refined?: TailorResumeReply, over: Partial<Settings> = {}) {
  const settings: Settings = { ...DEFAULT_SETTINGS, engine: 'claude', ...over };
  const f = fakeProvider(draft, refined);
  const deps: EngineDeps = { settings, apiKey: 'sk-ant-test', providerFactory: f.factory };
  const a = await runAnalysis(job, false, master, undefined, { ...deps, settings: { ...settings, deepAnalysisWithClaude: false } });
  const session = { ...emptySession(job, master.id), analysis: a.analysis, evidence: a.evidence };
  return { r: await runTailoring(session, master, undefined, deps), calls: f.calls, session };
}

describe('Claude draft → verified resume', () => {
  it('keeps every job, reverts unsupported or moved claims, and fixes inflated years', async () => {
    const { r } = await tailor(badDraft(), undefined, { atsRefinePass: false });
    const t = r.resume;
    expect(t.experience.map((e) => e.company)).toEqual(['Lumenstream', 'Signalwave Media', 'Northbeam Video Inc', 'Hanbit Apps']);
    expect(t.experience[2]!.bullets.length).toBeGreaterThanOrEqual(2); // the dropped job is restored with its own bullets
    expect(t.issues.filter((i) => i.severity === 'critical')).toEqual([]);
    const all = resumeToText(t);
    expect(all).not.toMatch(/Microservices|microservices|\bLLM|AI agents|Roku/);
    expect(t.summary).toMatch(/11\+ years/);
    expect(t.summary).not.toMatch(/15\+/);
    // Kubernetes was proven at Signalwave, not Lumenstream: it stays there and leaves Lumenstream.
    expect(t.experience[0]!.bullets.join(' ')).not.toMatch(/Kubernetes/);
    expect(t.experience[0]!.technologies).not.toContain('Kubernetes');
    expect(t.experience[1]!.bullets.join(' ')).toMatch(/Kubernetes/);
    expect(t.additional).toEqual([]);
    expect(t.headline.startsWith('Senior Video Playback Engineer')).toBe(true);
    // Every supported hard keyword is on the resume, in the job's spelling.
    for (const k of r.atsPlan.keywords.filter((x) => x.support === 'supported' && x.kind === 'hard')) {
      expect(r.atsTailored.keywords.find((x) => x.term === k.term)!.found).not.toBe('missing');
    }
    expect(r.atsTailored.score).toBeGreaterThanOrEqual(r.atsMaster.score - 3);
    expect(validateTailoredResume(t, { master, job, evidence: [], length: 'two_pages', plan: r.atsPlan }).filter((i) => i.severity === 'critical')).toEqual([]);
  });

  it('runs one ATS refine pass and keeps it only when it scores at least as well', async () => {
    const better = badDraft();
    better.headline = 'Senior Video Playback Engineer | HLS, MPEG-DASH, DRM, Player SDK';
    better.summary =
      'Senior Video Playback Engineer with 11+ years of experience building OTT playback SDKs, live streaming pipelines and ad-supported video platforms across iOS, Android and connected TV. Builds HLS, MPEG-DASH and CMAF playback with DRM (Widevine, FairPlay) and adaptive bitrate (ABR) logic. Integrates client-side ad insertion with VAST, VMAP and the Google IMA SDK.';
    better.experience[2] = { sourceId: ids()[2]!, bullets: ['Developed C++ services for video ingest, transcoding orchestration and media workflow automation.', 'Built HLS and DASH packaging services for VOD and live streaming platforms.', 'Integrated PostgreSQL, Redis and Elasticsearch into stream management systems.'], technologies: ['C++', 'FFmpeg', 'HLS'] };
    const { r, calls } = await tailor(badDraft(), better, { atsRefinePass: true });
    expect(calls[0]).toBe('tailor');
    expect(calls[1]).toMatch(/^refine:\d+$/);
    expect(r.resume.summary).toMatch(/Google IMA SDK/);
    expect(r.resume.changes.some((c) => c.section === 'ATS check')).toBe(true);
    expect(r.resume.issues.filter((i) => i.severity === 'critical')).toEqual([]);
  });

  it('keeps the first draft when the refine call fails', async () => {
    const { r, calls } = await tailor(badDraft(), undefined, { atsRefinePass: true });
    expect(calls).toHaveLength(2);
    expect(r.resume.experience).toHaveLength(4);
  });
});

describe('local engine (no API key)', () => {
  it('builds a truthful, ATS-structured resume from the plan', async () => {
    const settings = { ...DEFAULT_SETTINGS, engine: 'local' as const };
    const a = await runAnalysis(job, false, master, undefined, { settings, apiKey: null });
    const r = await runTailoring({ ...emptySession(job, master.id), analysis: a.analysis, evidence: a.evidence }, master, undefined, { settings, apiKey: null });
    expect(r.resume.experience).toHaveLength(4);
    expect(r.resume.headline).toMatch(/^Senior Video Playback Engineer \| /);
    expect(r.resume.summary).toMatch(/^Senior video player engineer with 11\+ years|^Senior Video Playback Engineer/i);
    expect(r.resume.skillGroups!.length).toBeGreaterThanOrEqual(3);
    expect(r.resume.issues.filter((i) => i.severity === 'critical')).toEqual([]);
    expect(r.atsTailored.checks.find((c) => c.id === 'all_jobs')!.status).toBe('pass');
  });
});

describe('ATS-formatted files', () => {
  let t: TailoredResume;
  beforeAll(async () => {
    t = (await tailor(badDraft(), undefined, { atsRefinePass: false })).r.resume;
  });

  it('PDF embeds an ATS-safe font as real text and passes the parse test', async () => {
    const pdf = await resumeToPdf(t, { font: 'calibri', bodySize: 10.5, dateStyle: 'mon_yyyy', showJobTechnologies: true, margins: 'normal' }, ['HLS', 'DRM']);
    expect(Buffer.from(pdf).toString('latin1')).toMatch(/Carlito/);
    const check = await parseCheckPdf(pdf, t, nodeLoader);
    expect(check).toMatchObject({ ok: true, jobsExpected: 4, jobsFound: 4, name: true, email: true, phone: true });
    expect(check.sections).toEqual(['Summary', 'Skills', 'Experience', 'Education']);
  }, 30000);

  it('every font choice passes the parse test', async () => {
    for (const font of ['arial', 'times', 'cambria', 'helvetica'] as const) {
      const pdf = await resumeToPdf(t, { font, bodySize: 11, dateStyle: 'mm_yyyy', showJobTechnologies: false, margins: 'narrow' });
      expect((await parseCheckPdf(pdf, t, nodeLoader)).ok).toBe(true);
    }
  }, 60000);

  it('DOCX uses the real Office font name, right-aligned dates and grouped skills', async () => {
    const blob = await resumeToDocx(t, { font: 'calibri', bodySize: 10.5, dateStyle: 'mon_yyyy', showJobTechnologies: true, margins: 'normal' });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toMatch(/w:ascii="Calibri"/);
    expect(xml).toMatch(/w:tab w:val="right"/);
    expect(xml).toMatch(/Video Streaming: /);
    expect(xml).toMatch(/Mar 2022 – Aug 2026/);
    expect(xml).not.toMatch(/<w:tbl>/);
  });

  it('formats dates consistently', () => {
    expect(formatDate('02/2023', 'mon_yyyy')).toBe('Feb 2023');
    expect(formatDate('Feb 2023', 'mm_yyyy')).toBe('02/2023');
    expect(formatDate('Present', 'mm_yyyy')).toBe('Present');
    expect(formatDate('2019', 'mon_yyyy')).toBe('2019');
    expect(formatDateText('09/2011 – 06/2015', 'mon_yyyy')).toBe('Sep 2011 – Jun 2015');
  });

  it('the parse test reads jobs without a city and unusual titles', async () => {
    const odd = structuredClone(t);
    odd.experience[0]!.location = '';
    odd.experience[1]!.title = 'Member of Technical Staff';
    const pdf = await resumeToPdf(odd, { font: 'arial', bodySize: 10.5, dateStyle: 'mon_yyyy', showJobTechnologies: true, margins: 'normal' });
    expect(await parseCheckPdf(pdf, odd, nodeLoader)).toMatchObject({ ok: true, jobsFound: 4 });
  }, 30000);

  it('the parse test reports a job an ATS would lose', () => {
    const text = resumeToText(t).replace(/\nSignalwave Media \| [^\n]+/, '');
    const r = checkParsedText(text, t);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/Signalwave Media/);
  });
});

describe('review findings (v1.3 hardening)', () => {
  const text = [
    'Riley Chen',
    'riley@example.com | (555) 010-2000 | Denver, CO',
    'SUMMARY',
    'Video engineer with 6+ years of experience building players.',
    'EXPERIENCE',
    'Senior Player Engineer, Acme Media | Jan 2022 – Present',
    '- Built the player for Roku, Fire TV, Samsung Tizen and LG webOS apps.',
    '- Added Picture in Picture to the iOS player using AVPictureInPictureController.',
    'Technologies: Swift, Kotlin, Roku, Widevine',
    'Video Engineer, Beta Streams | Jan 2019 – Dec 2021',
    '- Built server-side ad insertion (SSAI) with SCTE-35 markers for 24/7 channels.',
    'SKILLS',
    'C, Python',
    'LANGUAGES',
    'English, Japanese',
  ].join('\n');
  const m = buildMasterResume('Riley', text, 'text', null);
  const asTailored = (): TailoredResume => ({
    version: 1,
    contact: { fullName: 'Riley Chen', email: 'riley@example.com', phone: '(555) 010-2000', location: 'Denver, CO', links: [] },
    headline: 'Senior Player Engineer',
    summary: 'Video engineer with 6+ years of experience building players.',
    skills: ['C', 'Python'],
    experience: m.parsed.experience.map((e) => ({ sourceId: e.id, title: e.title, company: e.company, location: e.location, startDate: e.startDate, endDate: e.endDate, bullets: [...e.bullets], technologies: e.technologies ?? [] })),
    projects: [],
    education: [],
    certifications: [],
    additional: [],
    changes: [],
    issues: [],
    engine: 'claude',
    model: 'x',
    generatedAt: '',
    editedByUser: false,
  });
  const ctx = { master: m, job: { description: '' }, evidence: [], length: 'two_pages' as const };
  const codes = (t: TailoredResume) => validateTailoredResume(t, ctx).filter((i) => i.severity === 'critical').map((i) => `${i.code}:${i.excerpt ?? ''}`);

  it('keeps every required keyword of a long posting (no cap drops skills you have)', () => {
    const terms = extractJobKeywords(job, analyzeJobLocally(job, master)).map((k) => k.term);
    for (const t of ['CSAI', 'SSAI', 'VAST', 'VMAP', 'Google IMA SDK', 'iOS', 'Technical Leadership']) expect(terms).toContain(t);
    // Product pairs are split, and the company name is never a keyword.
    expect(terms.some((t) => t.includes('/') && !/^(?:CI\/CD|TCP\/IP|UI\/UX)$/i.test(t))).toBe(false);
    expect(terms.some((t) => /arcadia/i.test(t))).toBe(false);
  });

  it('a category is backed by its members, a platform never proves its framework', () => {
    const t = asTailored();
    t.experience[0]!.bullets[0] = 'Built the player for smart TV platforms (Samsung Tizen, LG webOS) and Fire TV.';
    expect(codes(t)).toEqual([]);
    t.experience[0]!.bullets[0] = 'Built Roku SceneGraph channels for the player.';
    expect(codes(t).some((c) => /unsupported_skill|moved_skill/.test(c))).toBe(true);
  });

  it('accepts an acronym explained in place, but not a technology moved from another job', () => {
    const t = asTailored();
    t.experience[0]!.bullets[1] = 'Added Picture-in-Picture (PiP) to the iOS player using AVPictureInPictureController.';
    expect(codes(t)).toEqual([]);
    t.experience[0]!.bullets[1] = 'Integrated server-side ad insertion into the iOS player.';
    expect(codes(t).some((c) => c.startsWith('moved_skill'))).toBe(true);
  });

  it('flags invented team sizes and counts, in digits or words', () => {
    const t = asTailored();
    t.experience[0]!.bullets[0] = 'Led a team of 6 engineers building the player for Roku and Fire TV.';
    expect(codes(t).some((c) => c.startsWith('invented_metric'))).toBe(true);
    t.experience[0]!.bullets[0] = 'Mentored six engineers on the Roku and Fire TV player.';
    expect(codes(t).some((c) => c.startsWith('invented_metric'))).toBe(true);
  });

  it('Additional Information only repeats what the master resume states', () => {
    const t = assembleFromClaude({ ...badDraftFor(m), additional: ['Japanese (native), English (fluent)', 'Speaker at NAB 2024'] }, m, undefined, 1, 'x', null);
    expect(t.additional).toEqual(['Languages: English, Japanese']);
  });

  it('does not count version numbers or years as results', () => {
    const r = scanResume(
      { ...docFromMaster(m), experience: [{ title: 'X', company: 'Y', location: 'Denver, CO', startDate: 'Jan 2020', endDate: 'Present', bullets: ['Built SCTE-35 and H.264 support for 24/7 channels in 2021.', 'Cut startup time by 40% for 2 million viewers.'] }] },
      { plan: plan(), masterJobs: 1, computedFor: 'tailored', now: NOW },
    );
    expect(r.checks.find((c) => c.id === 'metrics')!.label).toBe('1 of 2 bullets show a number or result');
  });

  it('never sends soft skills as forbidden words', () => {
    const p = plan();
    const forbidden = p.keywords.filter((k) => k.support !== 'supported' && (k.kind === 'hard' || k.kind === 'domain' || k.kind === 'certification')).map((k) => k.term);
    expect(forbidden.some((t) => /^(Leadership|Communication)$/.test(t))).toBe(false);
  });
});

function badDraftFor(m: MasterResume): TailorResumeReply {
  return {
    headline: 'Senior Player Engineer',
    summary: 'Video engineer.',
    skillGroups: [{ name: 'Languages', skills: ['C', 'Python'] }],
    experience: m.parsed.experience.map((e) => ({ sourceId: e.id, bullets: e.bullets, technologies: e.technologies ?? [] })),
    projects: [],
    certificationIndexes: [],
    additional: [],
    changes: [],
    unsupportedRequirements: [],
  };
}
