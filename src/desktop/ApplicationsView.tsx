import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApplicationRecord, ApplicationStage, JobSession } from '@/types';
import { APPLICATION_STAGES } from '@/types';
import { bridge, type Contact, type SearchHit, type StoredDocument, type UsageSummary } from '@/platform/bridge';
import { addNote, setStage } from '@/services/history/history';
import { saveApplication } from '@/storage/repositories';
import { onDataChange } from '@/storage/events';
import { readResumeDocument, renderCoverLetterPdf, renderResumePdf } from '@/resume-renderer';
import { useSettings } from '@/hooks/useSettings';
import { useHistory } from '@/hooks/useHistory';
import { HistoryTable } from '@/components/HistoryTable';
import { Icon } from '@/components/Icon';
import { WarningBanner } from '@/components/WarningBanner';
import { formatPhone } from '@/utils/contacts';
import { newId } from '@/utils/id';
import { PdfFrame } from './PdfFrame';

const MATCH_LABEL: Record<SearchHit['matchedOn'][number], string> = {
  phone: 'Phone number',
  email: 'Email',
  company: 'Company',
  title: 'Job title',
  contact: 'Contact',
  text: 'Job posting',
};

function stageTone(stage: ApplicationStage): string {
  if (['Interview', 'Technical Interview', 'Offer', 'Recruiter Contacted'].includes(stage)) return 'chip-green';
  if (['Rejected', 'Withdrawn', 'No Response'].includes(stage)) return 'chip-red';
  if (stage === 'Applied') return 'chip-blue';
  return '';
}

const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]*\])/g);
  return (
    <span className="snippet">
      {parts.map((p, i) => (p.startsWith('[') && p.endsWith(']') ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}
    </span>
  );
}

export function ApplicationsView({ focus, searchSignal, onOpenStudio }: { focus: string | null; searchSignal: number; onOpenStudio: (json: string, title: string) => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState<string | null>(focus);
  const [mode, setMode] = useState<'search' | 'table'>('search');
  const [tick, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const history = useHistory();

  useEffect(() => onDataChange((t) => (t === 'applications' || t === 'sessions') && setTick((n) => n + 1)), []);
  useEffect(() => {
    if (focus) setSelected(focus);
  }, [focus]);
  useEffect(() => {
    if (!searchSignal) return;
    setMode('search');
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
  }, [searchSignal]);

  useEffect(() => {
    const b = bridge();
    if (!b) return;
    let live = true;
    const t = setTimeout(() => {
      void b.invoke('search.query', query, 80).then((r) => {
        if (!live) return;
        setHits(r);
        if (query.trim() && r[0] && !r.some((h) => h.application.id === selected)) setSelected(r[0].application.id);
        if (!query.trim() && !selected && r[0]) setSelected(r[0].application.id);
      });
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (mode === 'table') {
    return (
      <div className="stack">
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={() => setMode('search')}>
            <Icon name="search" size={14} /> Search view
          </button>
        </div>
        <HistoryTable h={history} focusId={selected} />
      </div>
    );
  }

  return (
    <div className="apps">
      <aside className="apps-list" aria-label="Applications">
        <div className="apps-search">
          <Icon name="search" />
          <input
            ref={inputRef}
            className="apps-search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Company, recruiter, phone, email, title, skill…"
            aria-label="Search applications"
            autoFocus
          />
        </div>
        <div className="row-between apps-list-head">
          <span className="small muted">{query.trim() ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : `${hits.length} most recent`}</span>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setMode('table')}>
            Table view
          </button>
        </div>
        <ul className="list-plain apps-results">
          {hits.map((h) => {
            const a = h.application;
            return (
              <li key={a.id}>
                <button type="button" className="apps-item" aria-current={selected === a.id ? 'true' : undefined} onClick={() => setSelected(a.id)}>
                  <span className="row-between">
                    <span className="apps-company">{a.company || 'Unknown company'}</span>
                    <span className={`chip ${stageTone(a.stage)}`}>{a.stage}</span>
                  </span>
                  <span className="apps-title">{a.title}</span>
                  <span className="small muted">
                    {a.dateApplied ? `Applied ${fmtDate(a.dateApplied)}` : `Prepared ${fmtDate(a.datePrepared)}`}
                    {a.location ? ` · ${a.location}` : ''}
                  </span>
                  {query.trim() && h.matchedOn.length ? (
                    <span className="chip-row">
                      {h.matchedOn.map((m) => (
                        <span key={m} className={`chip ${m === 'phone' || m === 'email' || m === 'contact' ? 'chip-green' : 'chip-blue'}`}>
                          {m === 'phone' ? <Icon name="phone" size={11} /> : null}
                          {MATCH_LABEL[m]}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {h.snippet && query.trim() ? <Snippet text={h.snippet} /> : null}
                </button>
              </li>
            );
          })}
          {!hits.length ? (
            <li className="empty">
              {query.trim() ? (
                <>
                  <strong>No application matches “{query}”.</strong>
                  <span>Try the company name, part of the phone number, or a word from the job title.</span>
                </>
              ) : (
                <>
                  <strong>No applications yet.</strong>
                  <span>Applications you prepare or submit in Apply appear here with the resume that was sent.</span>
                </>
              )}
            </li>
          ) : null}
        </ul>
      </aside>
      <section className="apps-detail" aria-label="Application details">
        {selected ? <ApplicationDetail key={selected} id={selected} tick={tick} onOpenStudio={onOpenStudio} /> : <div className="empty">Select an application.</div>}
      </section>
    </div>
  );
}

function ApplicationDetail({ id, tick, onOpenStudio }: { id: string; tick: number; onOpenStudio: (json: string, title: string) => void }) {
  const [rec, setRec] = useState<ApplicationRecord | null>(null);
  const [session, setSession] = useState<JobSession | null>(null);
  const [docs, setDocs] = useState<StoredDocument[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [preview, setPreview] = useState<{ bytes: Uint8Array; title: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showJob, setShowJob] = useState(false);
  const [noteText, setNoteText] = useState('');
  const { settings } = useSettings();

  const load = useCallback(async () => {
    const b = bridge();
    if (!b) return;
    const r = await b.invoke('applications.get', id);
    setRec(r);
    if (!r) return;
    const [s, d, c, u] = await Promise.all([b.invoke('sessions.get', r.jobKey), b.invoke('documents.list', { applicationId: id }), b.invoke('contacts.list', id), b.invoke('usage.summary', { jobKey: r.jobKey })]);
    setSession(s);
    setDocs(d);
    setContacts(c);
    setUsage(u);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  const resumes = useMemo(() => docs.filter((d) => d.kind === 'resume'), [docs]);
  const letters = useMemo(() => docs.filter((d) => d.kind === 'cover_letter'), [docs]);

  if (!rec) return <div className="empty">This application was deleted.</div>;

  const persist = async (next: ApplicationRecord) => {
    setRec(await saveApplication(next));
  };

  const pdfOf = async (d: StoredDocument): Promise<Uint8Array | null> => {
    const b = bridge()!;
    const newest = docs.filter((x) => x.kind === d.kind).sort((x, y) => y.version - x.version)[0];
    if (d.filePath && d.filePath.endsWith('.pdf') && newest?.id === d.id) {
      const bytes = await b.invoke('files.read', d.filePath);
      if (bytes) return bytes;
    }
    const r = readResumeDocument(d.json);
    if (!r.doc) return null;
    return d.kind === 'resume' ? renderResumePdf(r.doc, settings.resumeFormat) : renderCoverLetterPdf(r.doc, settings.resumeFormat);
  };

  const showPdf = async (d: StoredDocument) => {
    const bytes = await pdfOf(d);
    if (bytes) setPreview({ bytes, title: `${d.kind === 'resume' ? 'Resume' : 'Cover letter'} v${d.version}` });
    else setMessage('This document could not be rendered.');
  };

  const openFile = async (d: StoredDocument) => {
    const b = bridge()!;
    const newest = docs.filter((x) => x.kind === d.kind).sort((x, y) => y.version - x.version)[0];
    if (d.filePath && newest?.id === d.id && (await b.invoke('files.exists', d.filePath))) {
      const err = await b.invoke('files.open', d.filePath);
      if (err) setMessage(err);
    } else {
      setMessage(newest?.id === d.id ? 'The file was moved or deleted — showing it rendered from the saved JSON instead.' : 'A newer version replaced this file — showing this version rendered from its saved JSON.');
      void showPdf(d);
    }
  };

  const addContact = async (c: Omit<Contact, 'id' | 'applicationId' | 'source' | 'createdAt'>) => {
    await bridge()!.invoke('contacts.save', { ...c, id: newId('ct'), applicationId: rec.id, source: 'you', createdAt: new Date().toISOString() });
    setContacts(await bridge()!.invoke('contacts.list', rec.id));
  };

  const logCall = async (text: string) => {
    if (!text.trim()) return;
    await persist(addNote(rec, text.trim()));
    setNoteText('');
  };

  const sent = (list: StoredDocument[]) => list.find((d) => d.sentAt) ?? list[0] ?? null;
  const sentResume = sent(resumes);
  const sentLetter = sent(letters);
  const cached = usage ? usage.cacheReadTokens : 0;

  return (
    <div className="stack">
      <header className="detail-head">
        <div>
          <h2 className="detail-company">{rec.company || 'Unknown company'}</h2>
          <p className="detail-title">{rec.title}</p>
          <p className="small muted">
            {[rec.location, rec.remoteStatus !== 'unknown' ? rec.remoteStatus : '', rec.salary ?? ''].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="stack-sm detail-actions">
          <label className="field">
            <span className="field-label">Stage</span>
            <select className="select" value={rec.stage} onChange={(e) => void persist(setStage(rec, e.target.value as ApplicationStage))}>
              {APPLICATION_STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <div className="row">
            {rec.jobUrl ? (
              <button type="button" className="btn btn-sm" onClick={() => window.open(rec.jobUrl, '_blank', 'noopener')}>
                <Icon name="external" size={14} /> Open job
              </button>
            ) : null}
            {rec.files.some((f) => f.absolutePath) ? (
              <button type="button" className="btn btn-sm" onClick={() => void bridge()!.invoke('files.show', rec.files.find((f) => f.absolutePath)!.absolutePath!)}>
                <Icon name="folder" size={14} /> Folder
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {message ? (
        <WarningBanner tone="info" actions={<button type="button" className="btn btn-sm btn-quiet" onClick={() => setMessage(null)}>Dismiss</button>}>
          {message}
        </WarningBanner>
      ) : null}

      <dl className="kv card">
        <dt>Applied</dt>
        <dd>{rec.dateApplied ? fmtDate(rec.dateApplied) : 'Not yet'}</dd>
        <dt>Prepared</dt>
        <dd>{fmtDate(rec.datePrepared)}</dd>
        <dt>Follow-up</dt>
        <dd>{rec.followUpDate ?? '—'}</dd>
        <dt>Match</dt>
        <dd>
          {rec.matchScore ?? '—'} → {rec.tailoredScore ?? '—'} <span className="muted small">(ApplyFlow estimate)</span>
        </dd>
        {usage && usage.calls ? (
          <>
            <dt>Claude</dt>
            <dd>
              {usage.calls} request{usage.calls > 1 ? 's' : ''} · {(usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens).toLocaleString()} input tokens
              {cached ? ` (${cached.toLocaleString()} from cache)` : ''} · {usage.outputTokens.toLocaleString()} output
            </dd>
          </>
        ) : null}
      </dl>

      <section className="card stack-sm">
        <div className="row-between">
          <h3 className="section-title">Resume {rec.dateApplied ? 'sent' : 'prepared'}</h3>
          {sentResume?.sentAt ? <span className="chip chip-green"><Icon name="check" size={11} /> Sent {fmtDate(sentResume.sentAt)}</span> : null}
        </div>
        {resumes.length ? (
          <ul className="list-plain doc-list">
            {resumes.map((d) => (
              <DocRow key={d.id} d={d} highlight={d.id === sentResume?.id} onPreview={() => void showPdf(d)} onOpen={() => void openFile(d)} onStudio={() => onOpenStudio(d.json, `${rec.company} — ${rec.title}`)} />
            ))}
          </ul>
        ) : (
          <p className="small muted">No resume was saved for this application.</p>
        )}
        {letters.length ? (
          <>
            <h3 className="section-title" style={{ marginTop: 6 }}>Cover letter</h3>
            <ul className="list-plain doc-list">
              {letters.map((d) => (
                <DocRow key={d.id} d={d} highlight={d.id === sentLetter?.id} onPreview={() => void showPdf(d)} onOpen={() => void openFile(d)} onStudio={() => onOpenStudio(d.json, `${rec.company} — ${rec.title}`)} />
              ))}
            </ul>
          </>
        ) : null}
        {preview ? (
          <div className="stack-sm">
            <div className="row-between">
              <span className="strong small">{preview.title}</span>
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => setPreview(null)}>
                Close preview
              </button>
            </div>
            <PdfFrame bytes={preview.bytes} title={preview.title} height={620} />
          </div>
        ) : null}
      </section>

      <ContactsCard contacts={contacts} onAdd={addContact} onDelete={async (c) => {
        await bridge()!.invoke('contacts.delete', c.id);
        setContacts(await bridge()!.invoke('contacts.list', rec.id));
      }} />

      <section className="card stack-sm">
        <h3 className="section-title">Calls and notes</h3>
        <div className="row">
          {['Recruiter called', 'Left a voicemail', 'Phone screen scheduled', 'Sent follow-up email'].map((t) => (
            <button key={t} type="button" className="btn btn-sm" onClick={() => void logCall(`${t}.`)}>
              <Icon name="phone" size={12} /> {t}
            </button>
          ))}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void logCall(noteText);
          }}
        >
          <input className="input" style={{ flex: 1 }} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Who called, what they asked, next step…" aria-label="Note" />
          <button type="submit" className="btn btn-sm btn-primary" disabled={!noteText.trim()}>
            Add note
          </button>
        </form>
        {rec.notes.length ? (
          <ul className="list-plain notes">
            {[...rec.notes].reverse().map((n) => (
              <li key={n.id}>
                <span className="small muted">{new Date(n.createdAt).toLocaleString()}</span>
                <p className="pre">{n.text}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="card stack-sm">
        <div className="row-between">
          <h3 className="section-title">Job posting</h3>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setShowJob((v) => !v)} aria-expanded={showJob}>
            {showJob ? 'Hide' : 'Show'}
          </button>
        </div>
        {rec.technologies.length ? <div className="chip-row">{rec.technologies.slice(0, 18).map((t) => <span key={t} className="chip">{t}</span>)}</div> : null}
        {showJob ? <div className="pre job-text">{session?.job.description || 'The job description was not saved (Settings → Privacy).'}</div> : null}
      </section>
    </div>
  );
}

function DocRow({ d, highlight, onPreview, onOpen, onStudio }: { d: StoredDocument; highlight: boolean; onPreview: () => void; onOpen: () => void; onStudio: () => void }) {
  return (
    <li className={`doc-row${highlight ? ' doc-row-sent' : ''}`}>
      <span className="doc-name">
        <Icon name="doc" size={14} /> {d.kind === 'resume' ? 'Resume' : 'Cover letter'} v{d.version}
        <span className="small muted"> · {new Date(d.createdAt).toLocaleString()} · {d.engine === 'claude' ? d.model ?? 'Claude' : 'built-in writer'}</span>
        {d.sentAt ? <span className="chip chip-green">Sent</span> : null}
      </span>
      <span className="row">
        <button type="button" className="btn btn-sm" onClick={onPreview}>
          <Icon name="eye" size={13} /> Preview
        </button>
        <button type="button" className="btn btn-sm" onClick={onOpen}>
          <Icon name="external" size={13} /> Open
        </button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={onStudio} title="Edit the JSON and render a new PDF (no AI)">
          <Icon name="palette" size={13} /> PDF Studio
        </button>
      </span>
    </li>
  );
}

function ContactsCard({ contacts, onAdd, onDelete }: { contacts: Contact[]; onAdd: (c: { name: string; role: string; phone: string; email: string }) => Promise<void>; onDelete: (c: Contact) => Promise<void> }) {
  const [form, setForm] = useState({ name: '', role: 'Recruiter', phone: '', email: '' });
  const [open, setOpen] = useState(false);
  return (
    <section className="card stack-sm">
      <div className="row-between">
        <h3 className="section-title">Contacts</h3>
        <button type="button" className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Icon name="plus" size={13} /> Add contact
        </button>
      </div>
      {contacts.length ? (
        <ul className="list-plain contacts">
          {contacts.map((c) => (
            <li key={c.id} className="row-between">
              <span>
                <span className="strong">{c.name || c.role || 'Contact'}</span>
                {c.name && c.role ? <span className="muted small"> · {c.role}</span> : null}
                {c.source === 'job posting' ? <span className="chip" style={{ marginLeft: 6 }}>from posting</span> : null}
                <br />
                <span className="small">
                  {c.phone ? <><Icon name="phone" size={11} /> {c.phone} </> : null}
                  {c.email ? <><Icon name="mail" size={11} /> <a href={`mailto:${c.email}`}>{c.email}</a></> : null}
                </span>
              </span>
              <button type="button" className="btn icon-btn" aria-label="Delete contact" onClick={() => void onDelete(c)}>
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">Add the recruiter who calls — their number then finds this application.</p>
      )}
      {open ? (
        <form
          className="grid-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name && !form.phone && !form.email) return;
            void onAdd({ ...form, phone: form.phone ? formatPhone(form.phone) : '' }).then(() => {
              setForm({ name: '', role: 'Recruiter', phone: '', email: '' });
              setOpen(false);
            });
          }}
        >
          <label className="field">
            <span className="field-label">Name</span>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </label>
          <label className="field">
            <span className="field-label">Role</span>
            <input className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Phone</span>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
          </label>
          <label className="field">
            <span className="field-label">Email</span>
            <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" />
          </label>
          <div className="row">
            <button type="submit" className="btn btn-primary btn-sm">
              Save contact
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
