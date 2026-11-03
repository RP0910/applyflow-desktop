import { useLibrary } from '@/hooks/useLibrary';
import { assembleCv } from '@/services/workflow/cvEngine';
import { toResumeDocument } from '@/resume-renderer';
import type { CvReply } from '@/prompts/cvGenerate';
/**
 * PDF Studio — ApplyFlow's non-AI resume renderer with a live preview.
 * Paste or open resume JSON (applyflow.resume/1 or JSON Resume), pick a template and font,
 * and save PDF/DOCX. Nothing here calls Claude.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ResumeFormat } from '@/types';
import { bridge, type StoredDocument } from '@/platform/bridge';
import { RESUME_JSON_SCHEMA, readResumeDocument, renderCoverLetterPdf, renderResumeDocx, renderResumePdf, type ResumeDocument } from '@/resume-renderer';
import { useSettings } from '@/hooks/useSettings';
import { Icon } from '@/components/Icon';
import { WarningBanner } from '@/components/WarningBanner';
import { sanitizeFilename } from '@/utils/filename';
import { PdfFrame } from './PdfFrame';

export const SAMPLE_RESUME: ResumeDocument = {
  $schema: 'applyflow.resume/1',
  basics: { name: 'Alex Rivera', headline: 'Senior Software Engineer | TypeScript, React, AWS', email: 'alex.rivera@example.com', phone: '(555) 010-2030', location: 'Denver, CO', links: ['linkedin.com/in/alexrivera-example'] },
  summary: 'Senior Software Engineer with 8+ years of experience building web platforms in TypeScript and React on AWS. Delivers customer-facing features end to end, from API design to accessible UI, and improves reliability with automated testing and observability.',
  skills: [
    { group: 'Languages', items: ['TypeScript', 'JavaScript', 'Python', 'SQL'] },
    { group: 'Frontend', items: ['React', 'Next.js', 'Accessibility (WCAG)'] },
    { group: 'Cloud & DevOps', items: ['AWS', 'Docker', 'Terraform', 'GitHub Actions'] },
  ],
  experience: [
    {
      title: 'Senior Software Engineer', company: 'Example Health', location: 'Denver, CO', start: '03/2021', end: 'Present',
      bullets: ['Built a React and TypeScript scheduling app used by 40 clinics, replacing three legacy tools.', 'Cut API p95 latency from 900 ms to 250 ms by adding caching and query indexes in PostgreSQL.'],
      technologies: ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'AWS'],
    },
    {
      title: 'Software Engineer', company: 'Sample Retail Co', location: 'Boulder, CO', start: '06/2017', end: '02/2021',
      bullets: ['Developed checkout features in React and Node.js for a site with 2 million monthly visitors.', 'Automated deployments with Docker and GitHub Actions, reducing release time from 2 hours to 15 minutes.'],
      technologies: ['React', 'Node.js', 'Docker'],
    },
  ],
  projects: [],
  education: [{ degree: 'B.S. in Computer Science', institution: 'University of Colorado', location: 'Boulder, CO', date: '2017', details: [] }],
  certifications: ['AWS Certified Developer – Associate'],
  additional: [],
  coverLetter: { paragraphs: ['Dear Hiring Team,', 'I’m applying for the Senior Software Engineer role. At Example Health I built a React and TypeScript scheduling app now used by 40 clinics…', 'Thank you for your time and consideration.', 'Sincerely,\nAlex Rivera'] },
};

const TEMPLATES: { id: NonNullable<ResumeFormat['template']>; label: string }[] = [
  { id: 'classic', label: 'Classic (ATS)' },
  { id: 'modern', label: 'Modern accent' },
  { id: 'compact', label: 'Compact' },
];

const toBytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

export function PdfStudio({ initial }: { initial: { json: string; title: string } | null }) {
  const { settings, update } = useSettings();
  const lib = useLibrary();
  const [json, setJson] = useState(() => initial?.json ? pretty(initial.json) : JSON.stringify(SAMPLE_RESUME, null, 2));
  const [title, setTitle] = useState(initial?.title ?? 'Sample resume');
  const [format, setFormat] = useState<ResumeFormat>(settings.resumeFormat);
  const changeFormat = (next: ResumeFormat) => { setFormat(next); void update({ resumeFormat: next }); };
  const [which, setWhich] = useState<'resume' | 'letter'>('resume');
  const [pdf, setPdf] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recent, setRecent] = useState<StoredDocument[]>([]);

  useEffect(() => setFormat(settings.resumeFormat), [settings.resumeFormat]);
  useEffect(() => {
    if (initial) {
      setJson(pretty(initial.json));
      setTitle(initial.title);
    }
  }, [initial]);
  useEffect(() => {
    void bridge()?.invoke('documents.list', {}).then((d) => setRecent(d.filter((x) => x.kind === 'resume').slice(0, 30)));
  }, []);

  const read = useMemo(() => {
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === 'object' && 'skill_groups' in parsed && 'subtitle' in parsed) {
        const master = lib.resumes.find(r => r.isDefault) ?? lib.resumes[0];
        if (!master) return {doc:null,errors:['Save candidate details in Profile & answers before opening Claude JSON.'],warnings:[]};
        const t = assembleCv(parsed as CvReply, master, lib.profile, {resume:null}, 'imported-claude-json');
        return readResumeDocument(toResumeDocument(t, {text:parsed.cover_letter}));
      }
    } catch (e) {
      if (!(e instanceof SyntaxError)) return {doc:null,errors:[e instanceof Error ? e.message : 'Invalid Claude JSON.'],warnings:[]};
    }
    return readResumeDocument(json);
  }, [json, lib.resumes, lib.profile]);

  // Live preview, re-rendered shortly after typing stops.
  useEffect(() => {
    if (!read.doc) { setPdf(null); setBusy(false); return; }
    let live = true;
    const t = setTimeout(() => {
      setBusy(true);
      const job = which === 'resume' ? renderResumePdf(read.doc!, format) : renderCoverLetterPdf(read.doc!, format);
      void job
        .then((bytes) => live && setPdf(bytes))
        .catch((e: unknown) => live && setMessage(e instanceof Error ? e.message : 'Rendering failed.'))
        .finally(() => live && setBusy(false));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [read.doc, format, which]);

  const name = sanitizeFilename(read.doc?.basics.name || 'Resume', 'Resume', 40);
  const save = async (bytes: Uint8Array | null, defaultName: string, ext: string) => {
    if (!bytes) return;
    const b = bridge();
    if (!b) return;
    const path = await b.invoke('files.saveAs', { defaultName, bytes, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (path) setMessage(`Saved ${path}`);
  };

  const openJson = async () => {
    const f = await bridge()?.invoke('files.pickOpen', { filters: [{ name: 'Resume JSON', extensions: ['json'] }] });
    if (!f) return;
    setJson(pretty(new TextDecoder().decode(f.bytes)));
    setTitle(f.name);
  };

  return (
    <div className="studio">
      <section className="studio-editor card stack-sm">
        <div className="row-between">
          <div>
            <h2 className="section-title">Resume JSON</h2>
            <p className="section-sub">{title}</p>
          </div>
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => void openJson()}>
              <Icon name="upload" size={13} /> Open JSON…
            </button>
            {recent.length ? (
              <select
                className="select studio-recent"
                value=""
                aria-label="Load a saved resume"
                onChange={(e) => {
                  const d = recent.find((x) => x.id === e.target.value);
                  if (d) {
                    setJson(pretty(d.json));
                    const r = readResumeDocument(d.json);
                    setTitle(`${r.doc?.meta?.company ?? ''} — ${r.doc?.meta?.jobTitle ?? ''} (v${d.version})`);
                  }
                }}
              >
                <option value="">Load a saved resume…</option>
                {recent.map((d) => {
                  const m = readResumeDocument(d.json).doc?.meta;
                  return (
                    <option key={d.id} value={d.id}>
                      {m?.company || 'Unknown'} — {m?.jobTitle || d.jobKey} (v{d.version})
                    </option>
                  );
                })}
              </select>
            ) : null}
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => setJson(JSON.stringify(SAMPLE_RESUME, null, 2))}>
              Sample
            </button>
          </div>
        </div>
        <textarea className="textarea code" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} aria-label="Resume JSON" />
        {read.errors.length ? (
          <WarningBanner tone="critical">{read.errors.join(' ')}</WarningBanner>
        ) : read.warnings.length ? (
          <WarningBanner tone="info">{read.warnings.join(' ')}</WarningBanner>
        ) : null}
        <div className="row">
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setJson(pretty(json))}>
            Format JSON
          </button>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => void save(new TextEncoder().encode(json), `${name}-resume.json`, 'json')} disabled={!read.doc}>
            Save JSON…
          </button>
          {read.doc?.meta?.sourceJson ? <button className="btn btn-sm" onClick={() => void save(new TextEncoder().encode(read.doc!.meta!.sourceJson!), `${name}-claude.json`, 'json')}>Save Claude JSON…</button> : null}
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => void save(new TextEncoder().encode(JSON.stringify(RESUME_JSON_SCHEMA, null, 2)), 'applyflow-resume.schema.json', 'json')}>
            Save JSON schema…
          </button>
        </div>
      </section>

      <section className="studio-preview stack-sm">
        <div className="card row studio-controls">
          <div className="segmented" role="group" aria-label="Document">
            <button type="button" aria-pressed={which === 'resume'} onClick={() => setWhich('resume')}>
              Resume
            </button>
            <button type="button" aria-pressed={which === 'letter'} onClick={() => setWhich('letter')} disabled={!read.doc?.coverLetter?.paragraphs.length}>
              Cover letter
            </button>
          </div>
          <label className="field-inline">
            Template
            <select className="select" value={format.template ?? 'classic'} onChange={(e) => changeFormat({ ...format, template: e.target.value as ResumeFormat['template'] })}>
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field-inline">
            Font
            <select className="select" value={format.font} onChange={(e) => changeFormat({ ...format, font: e.target.value as ResumeFormat['font'] })}>
              <option value="arial">Arial</option>
              <option value="calibri">Calibri</option>
              <option value="helvetica">Helvetica</option>
              <option value="cambria">Cambria</option>
              <option value="times">Times New Roman</option>
            </select>
          </label>
          <label className="field-inline">
            Size
            <select className="select" value={String(format.bodySize)} onChange={(e) => changeFormat({ ...format, bodySize: Number(e.target.value) })}>
              {[10, 10.5, 11, 11.5, 12].map((n) => (
                <option key={n} value={n}>
                  {n} pt
                </option>
              ))}
            </select>
          </label>
          {format.template === 'modern' ? (
            <label className="field-inline">
              Accent
              <input type="color" className="color" value={format.accentColor ?? '#007595'} onChange={(e) => changeFormat({ ...format, accentColor: e.target.value })} />
            </label>
          ) : null}
          <span className="studio-save row">
            <button type="button" className="btn btn-primary btn-sm" disabled={!pdf || busy} onClick={() => void save(pdf, `${name}-${which === 'resume' ? 'Resume' : 'Cover-Letter'}.pdf`, 'pdf')}>
              <Icon name="download" size={13} /> Save PDF…
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!read.doc || which !== 'resume'}
              onClick={() => void renderResumeDocx(read.doc!, format).then(async (b) => save(await toBytes(b), `${name}-Resume.docx`, 'docx'))}
            >
              DOCX…
            </button>
          </span>
        </div>
        {message ? (
          <WarningBanner tone="success" actions={<button type="button" className="btn btn-sm btn-quiet" onClick={() => setMessage(null)}>Dismiss</button>}>
            {message}
          </WarningBanner>
        ) : null}
        <div className="card studio-canvas">
          {busy ? <span className="studio-busy"><span className="spinner" aria-hidden="true" /> Rendering…</span> : null}
          {pdf ? <PdfFrame bytes={pdf} title={which === 'resume' ? 'Resume preview' : 'Cover letter preview'} height={2000} /> : <p className="muted">Fix the JSON to see the preview.</p>}
        </div>
        <p className="small muted">Rendered on this computer by ApplyFlow’s own renderer — no AI, no tokens. One column, real text, embedded fonts: ATS-safe in every template.</p>
      </section>
    </div>
  );
}

function pretty(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
