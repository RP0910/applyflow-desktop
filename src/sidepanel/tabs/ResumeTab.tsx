import { useState } from 'react';
import type { Workflow } from '../useWorkflow';
import type { LibraryController } from '@/hooks/useLibrary';
import type { OutputFormat, Settings } from '@/types';
import { ResumeCompare, ResumeEditor, ResumePaper, type ResumeView } from '@/components/ResumePreview';
import { IssueList } from '@/components/IssueList';
import { ResumeStart } from '@/components/ResumeLibrary';
import { openWorkspace } from './OtherTabs';
import { WarningBanner } from '@/components/WarningBanner';
import { Icon } from '@/components/Icon';
import { ResumePicker } from './MatchTab';
import { buildResumeFormats } from '@/services/export/bundle';
import { downloadFiles } from '@/services/downloads/downloader';
import { folderFor, MIME } from '@/services/downloads/planner';
import { ClaudeProvider } from '@/services/claude/provider';
import { ClaudeError } from '@/services/claude/errors';
import { getApiKey } from '@/storage/settingsStore';
import { supportedKeywords } from '@/services/matching/evidence';
import { AtsReportCard } from '@/components/AtsReportCard';

function BulletImprover({ wf, settings }: { wf: Workflow; settings: Settings }) {
  const r = wf.session?.resume;
  const [pick, setPick] = useState('');
  const [out, setOut] = useState<{ suggestions: string[]; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!r || settings.engine !== 'claude') return null;
  const all = r.experience.flatMap((e) => e.bullets.map((b, i) => ({ key: `${e.sourceId}:${i}`, label: `${e.company}: ${b}`, b, e, i })));
  const sel = all.find((x) => x.key === pick);
  return (
    <details className="card">
      <summary className="strong" style={{ cursor: 'pointer' }}>
        Improve a bullet with Claude
      </summary>
      <div className="stack-sm" style={{ marginTop: 8 }}>
        <label className="field-label" htmlFor="imp-pick">
          Bullet
        </label>
        <select id="imp-pick" className="select" value={pick} onChange={(e) => {
          setPick(e.target.value);
          setOut(null);
        }}>
          <option value="">Choose a bullet…</option>
          {all.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label.length > 90 ? `${x.label.slice(0, 89)}…` : x.label}
            </option>
          ))}
        </select>
        <div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!sel || busy}
            onClick={async () => {
              if (!sel || !wf.session) return;
              setBusy(true);
              setErr(null);
              try {
                const p = new ClaudeProvider(await getApiKey(), settings);
                const res = await p.improveResumeBullet(sel.b, { title: wf.session.job.title, responsibilities: wf.session.job.responsibilities.slice(0, 6) }, supportedKeywords(wf.session.evidence));
                setOut(res.data);
              } catch (e: unknown) {
                setErr(e instanceof ClaudeError ? e.userMessage : 'Could not get suggestions.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            Suggest wording
          </button>
        </div>
        {err ? <WarningBanner tone="warning">{err}</WarningBanner> : null}
        {out ? (
          <ul className="list-plain stack-sm">
            {out.suggestions.map((sug) => (
              <li key={sug} className="card" style={{ padding: '8px 10px' }}>
                <p className="small">{sug}</p>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ marginTop: 6 }}
                  onClick={() => {
                    if (!sel) return;
                    void wf.updateResume({ ...r, experience: r.experience.map((e) => (e.sourceId === sel.e.sourceId ? { ...e, bullets: e.bullets.map((b, i) => (i === sel.i ? sug : b)) } : e)) });
                    setOut(null);
                    setPick('');
                  }}
                >
                  Use this wording
                </button>
              </li>
            ))}
            {out.note ? <li className="small muted">{out.note}</li> : null}
          </ul>
        ) : null}
        <p className="small muted">Suggestions keep your facts and numbers; every change is re-checked for truthfulness.</p>
      </div>
    </details>
  );
}

export function ResumeTab({ wf, lib, settings }: { wf: Workflow; lib: LibraryController; settings: Settings }) {
  const [view, setView] = useState<ResumeView>('preview');
  const [dlMsg, setDlMsg] = useState<string | null>(null);
  const s = wf.session;
  const r = s?.resume;

  if (!lib.resumes.length) {
    return (
      <div className="stack">
        <ResumeStart lib={lib} compact onOpenForm={() => openWorkspace('library')} />
        <p className="small muted">Manage employer names and dates in Profile settings.</p>
      </div>
    );
  }
  if (!r || !s) {
    return (
      <div className="stack">
        <ResumePicker wf={wf} lib={lib} />
        <div className="empty">
          <strong>No tailored resume yet.</strong>
          <span>Press “Tailor &amp; Apply” — or write the documents now and look them over first. Claude writes the content using your CV Generate prompt. Review generated claims before use.</span>
          {s ? (
            <div>
              <button type="button" className="btn btn-sm btn-primary" disabled={wf.busy} onClick={() => void wf.regenerate()}>
                Write resume and cover letter
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const downloadOne = async (fmt: OutputFormat) => {
    const blobs = await buildResumeFormats(s, [fmt], settings.resumeFormat);
    const blob = blobs[fmt];
    if (!blob) return;
    const folder = folderFor(s, settings);
    const [res] = await downloadFiles([{ kind: 'resume', format: fmt, relativePath: `${folder}/resume_tailored.${fmt}`, mime: MIME[fmt]!, data: blob }]);
    setDlMsg(res?.state === 'failed' ? res.error ?? 'Download failed.' : `Saved to ${res?.absolutePath ?? `${folder}/resume_tailored.${fmt}`}`);
  };

  return (
    <div className="stack">
      <ResumePicker wf={wf} lib={lib} />
      <div className="row-between">
        <div className="segmented" role="group" aria-label="Resume view">
          {(['preview', 'compare', 'edit'] as ResumeView[]).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'preview' ? 'Preview' : v === 'compare' ? 'Compare' : 'Edit'}
            </button>
          ))}
        </div>
        <span className="small muted">
          Version {r.version}, {r.engine === 'claude' ? `Claude (${r.model})` : 'local engine'}
          {r.editedByUser ? ', edited by you' : ''}
        </span>
      </div>
      {s.atsTailored ? <AtsReportCard report={s.atsTailored} before={s.atsMaster} expanded busy={wf.busy} onConfirmSkills={(terms) => void wf.confirmSkills(terms, true)} onOptimize={s.submittedAt ? undefined : () => void wf.optimizeResume()} /> : null}
      <IssueList issues={r.issues} onAutoFix={() => void wf.autoFixResume()} />
      {view === 'preview' ? <ResumePaper resume={r} /> : null}
      {view === 'compare' && wf.master ? <ResumeCompare master={wf.master.parsed} tailored={r} changes={r.changes} /> : null}
      {view === 'edit' ? (
        <ResumeEditor
          resume={r}
          onCancel={() => setView('preview')}
          onSave={(t) => {
            void wf.updateResume(t).then(() => setView('preview'));
          }}
        />
      ) : null}
      <BulletImprover wf={wf} settings={settings} />
      <section className="card stack-sm">
        <h2 className="section-title">Download this resume</h2>
        <div className="row" style={{ gap: 6 }}>
          {(['pdf', 'docx', 'txt', 'md'] as OutputFormat[]).map((f) => (
            <button key={f} type="button" className="btn btn-sm" onClick={() => void downloadOne(f)}>
              <Icon name="download" size={13} /> {f === 'md' ? 'Markdown' : f.toUpperCase()}
            </button>
          ))}
        </div>
        {dlMsg ? <p className="small muted" role="status">{dlMsg}</p> : null}
      </section>
      <div>
        <button type="button" className="btn btn-sm" disabled={wf.busy} onClick={() => void wf.regenerate()}>
          <Icon name="refresh" size={13} /> Rewrite resume and cover letter
        </button>
      </div>
    </div>
  );
}
