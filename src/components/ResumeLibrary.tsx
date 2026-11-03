import { CandidateSetup } from './CandidateSetup';
import { useRef, useState } from 'react';
import type { FactStatus, MasterResume, VerifiedFact } from '@/types';
import type { LibraryController } from '@/hooks/useLibrary';
import { WarningBanner } from './WarningBanner';
import { Icon } from './Icon';
import { formatDisplayDate } from '@/utils/dates';
import { ResumeBuilder } from './ResumeBuilder';
import { builderFromParsed } from '@/services/resume/builder';

const STATUS_LABEL: Record<FactStatus, string> = { confirmed: 'Confirmed', needs_review: 'Needs review', do_not_use: 'Do not use' };
const KIND_LABEL: Record<VerifiedFact['kind'], string> = { skill: 'Skills', experience: 'Experience bullets', project: 'Projects', education: 'Education', certification: 'Certifications', achievement: 'Achievements', other: 'Other' };

export function ResumeImport({ lib, compact = false }: { lib: LibraryController; compact?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  return (
    <div className="stack">
      <div
        className="dropzone"
        data-over={over}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) void lib.addFromFile(f);
        }}
      >
        <strong>Add a master resume</strong>
        <span className="small">Upload a DOCX or PDF, or paste the text. Files are read on this device and never uploaded.</span>
        <div className="row">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()} disabled={lib.busy}>
            <Icon name="upload" size={14} /> Upload DOCX or PDF
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setPasting((p) => !p)} aria-expanded={pasting}>
            Paste text
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".docx,.pdf,.txt,.md" className="sr-only" aria-label="Choose a resume file" onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void lib.addFromFile(f);
          e.target.value = '';
        }} />
      </div>
      {pasting ? (
        <form
          className="stack-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await lib.addFromText(name || 'Pasted resume', text)) {
              setText('');
              setName('');
              setPasting(false);
            }
          }}
        >
          <div className="field">
            <label htmlFor="paste-name">Name for this resume</label>
            <input id="paste-name" className="input" placeholder="e.g. AI platform architect" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="paste-text">Resume text</label>
            <textarea id="paste-text" className="textarea" style={{ minHeight: compact ? 180 : 260 }} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={text.trim().length < 50}>
            Save resume
          </button>
        </form>
      ) : null}
      {lib.message ? (
        <WarningBanner tone={lib.message.tone} live>
          {lib.message.text}
          {lib.message.details?.length ? (
            <ul className="bullets">
              {lib.message.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </WarningBanner>
      ) : null}
    </div>
  );
}

function ResumeEditorCard({ r, lib }: { r: MasterResume; lib: LibraryController }) {
  const [editing, setEditing] = useState(false);
  const [formMode, setFormMode] = useState(false);
  const isForm = r.sourceFormat === 'form';
  const [name, setName] = useState(r.name);
  const [text, setText] = useState(r.rawText);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <article className="card stack-sm">
      <div className="row-between">
        <div>
          <div className="strong">
            {r.name} {r.isDefault ? <span className="chip chip-blue">Default</span> : null}
          </div>
          <div className="small muted">
            {isForm ? 'Entered in the form' : r.sourceFileName ?? 'Pasted text'}. Updated {formatDisplayDate(r.updatedAt)}. {r.parsed.experience.length} jobs, {r.parsed.skills.length} skills.
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {!r.isDefault ? (
            <button type="button" className="btn btn-sm" onClick={() => void lib.makeDefault(r.id)}>
              Make default
            </button>
          ) : null}
          <button type="button" className="btn btn-sm" onClick={() => setFormMode((e) => !e)} aria-expanded={formMode}>
            <Icon name="edit" size={14} /> {isForm ? 'Edit' : 'Edit in the form'}
          </button>
          {!isForm ? (
            <button type="button" className="btn btn-sm" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
              Edit text
            </button>
          ) : null}
          {confirmDelete ? (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void lib.remove(r.id)}>
              Confirm delete
            </button>
          ) : (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
        </div>
      </div>
      {formMode ? (
        <ResumeBuilder lib={lib} existing={r} initial={isForm ? undefined : builderFromParsed(r.parsed)} onDone={() => setFormMode(false)} onCancel={() => setFormMode(false)} />
      ) : null}
      {editing && !formMode ? (
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void lib.updateText(r, name, text).then(() => setEditing(false));
          }}
        >
          <div className="field">
            <label htmlFor={`rn-${r.id}`}>Name</label>
            <input id={`rn-${r.id}`} className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`rt-${r.id}`}>Resume text</label>
            <textarea id={`rt-${r.id}`} className="textarea" style={{ minHeight: 320 }} value={text} onChange={(e) => setText(e.target.value)} />
            <span className="hint">Saving re-parses the resume. Fact statuses you set are kept for unchanged lines.</span>
          </div>
          <div className="row">
            <button type="submit" className="btn btn-primary btn-sm">
              Save and re-parse
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {r.parsed.unparsed.length ? (
        <WarningBanner tone="info" title="Lines ApplyFlow couldn’t place in a section">
          <ul className="bullets small">
            {r.parsed.unparsed.slice(0, 6).map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </WarningBanner>
      ) : null}
    </article>
  );
}

export function VerifiedFacts({ r, lib }: { r: MasterResume; lib: LibraryController }) {
  const [newFact, setNewFact] = useState('');
  const [kind, setKind] = useState<VerifiedFact['kind']>('skill');
  const kinds = Array.from(new Set(r.facts.map((f) => f.kind)));
  const counts = { confirmed: 0, needs_review: 0, do_not_use: 0 };
  r.facts.forEach((f) => counts[f.status]++);
  return (
    <section className="card stack" aria-labelledby={`vf-${r.id}`}>
      <div>
        <h2 className="section-title" id={`vf-${r.id}`}>
          Verified facts
        </h2>
        <p className="section-sub">
          ApplyFlow and Claude only use facts marked Confirmed. Mark anything you can’t stand behind in an interview as Needs review or Do not use. {counts.confirmed} confirmed, {counts.needs_review} need review, {counts.do_not_use} not used.
        </p>
      </div>
      <div className="row">
        <button type="button" className="btn btn-sm" onClick={() => void lib.setAllFacts(r, 'all', 'confirmed')}>
          Confirm all
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void lib.setAllFacts(r, 'all', 'needs_review')}>
          Mark all for review
        </button>
      </div>
      {kinds.map((k) => (
        <details key={k} open={k === 'skill'}>
          <summary className="strong" style={{ cursor: 'pointer' }}>
            {KIND_LABEL[k]} ({r.facts.filter((f) => f.kind === k).length})
          </summary>
          <ul className="list-plain stack-sm" style={{ marginTop: 8 }}>
            {r.facts
              .filter((f) => f.kind === k)
              .map((f) => (
                <li key={f.id} className="row-between" style={{ alignItems: 'flex-start', gap: 10 }}>
                  <span className="small" style={{ flex: 1, minWidth: 160, textDecoration: f.status === 'do_not_use' ? 'line-through' : undefined }}>
                    {f.text}
                    {f.source !== 'resume' ? <span className="chip" style={{ marginLeft: 6 }}>Added by you</span> : null}
                  </span>
                  <label className="sr-only" htmlFor={`fs-${f.id}`}>
                    Status for {f.text}
                  </label>
                  <select id={`fs-${f.id}`} className="select" style={{ width: 150, minHeight: 30, padding: '3px 6px' }} value={f.status} onChange={(e) => void lib.setFactStatus(r, f.id, e.target.value as FactStatus)}>
                    {(Object.keys(STATUS_LABEL) as FactStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
          </ul>
        </details>
      ))}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void lib.addFact(r, kind, newFact).then(() => setNewFact(''));
        }}
      >
        <label className="sr-only" htmlFor={`nf-kind-${r.id}`}>
          Fact type
        </label>
        <select id={`nf-kind-${r.id}`} className="select" style={{ width: 150 }} value={kind} onChange={(e) => setKind(e.target.value as VerifiedFact['kind'])}>
          <option value="skill">Skill</option>
          <option value="achievement">Achievement</option>
          <option value="certification">Certification</option>
          <option value="other">Other</option>
        </select>
        <label className="sr-only" htmlFor={`nf-${r.id}`}>
          New fact
        </label>
        <input id={`nf-${r.id}`} className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Add a fact you can verify, e.g. “Terraform”" value={newFact} onChange={(e) => setNewFact(e.target.value)} />
        <button type="submit" className="btn btn-sm" disabled={!newFact.trim()}>
          Add confirmed fact
        </button>
      </form>
    </section>
  );
}

/** Two ways to give ApplyFlow your history: type it in the form, or upload a resume file. */
export function ResumeStart({ lib, onOpenForm }: { lib: LibraryController; compact?: boolean; onOpenForm?: () => void }) {
  return onOpenForm ? <div className="card stack-sm"><strong>Set up your candidate details</strong><p>Enter your contact details, employer names and employment dates. Claude writes the resume content.</p><button className="btn btn-primary" onClick={onOpenForm}>Open candidate setup</button></div> : <CandidateSetup lib={lib} />;
}

export function ResumeLibrary({ lib }: { lib: LibraryController }) {
  const [selected, setSelected] = useState<string | null>(null);
  const current = lib.resumes.find((r) => r.id === selected) ?? lib.resumes[0];
  return (
    <div className="stack">
      <ResumeStart lib={lib} />

      {lib.resumes.length ? (
        <>
          <div className="stack-sm">
            {lib.resumes.map((r) => (
              <div key={r.id} onFocusCapture={() => setSelected(r.id)} onClickCapture={() => setSelected(r.id)}>
                <ResumeEditorCard r={r} lib={lib} />
              </div>
            ))}
          </div>
          {current ? (
            <>
              {lib.resumes.length > 1 ? (
                <div className="field" style={{ maxWidth: 320 }}>
                  <label htmlFor="vf-pick">Show verified facts for</label>
                  <select id="vf-pick" className="select" value={current.id} onChange={(e) => setSelected(e.target.value)}>
                    {lib.resumes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <VerifiedFacts r={current} lib={lib} />
            </>
          ) : null}
        </>
      ) : (
        <div className="empty">
          <strong>No work history yet.</strong>
          <span>Fill in the form above with your real jobs. ApplyFlow writes a resume for each Dice job from it and never adds experience you didn’t enter.</span>
        </div>
      )}
    </div>
  );
}
