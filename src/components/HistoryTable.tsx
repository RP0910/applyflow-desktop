import { Fragment, useMemo, useRef, useState } from 'react';
import { APPLICATION_STAGES, EMPTY_FILTERS, type ApplicationRecord, type ApplicationStage, type HistoryFilters } from '@/types';
import type { HistoryController } from '@/hooks/useHistory';
import { filterApplications, isFollowUpDue, sortApplications, type SortKey } from '@/services/history/history';
import { formatDisplayDate, addDays, todayLocal } from '@/utils/dates';
import { Icon } from './Icon';
import { WarningBanner } from './WarningBanner';
import { ConfirmationModal } from './ConfirmationModal';

function StageSelect({ r, onChange, id }: { r: ApplicationRecord; onChange: (s: ApplicationStage) => void; id: string }) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        Stage for {r.title} at {r.company}
      </label>
      <select id={id} className="select" style={{ minHeight: 30, padding: '3px 6px', width: 'auto' }} value={r.stage} onChange={(e) => onChange(e.target.value as ApplicationStage)}>
        {APPLICATION_STAGES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </>
  );
}

function scoreOf(r: ApplicationRecord): string {
  const s = r.tailoredScore ?? r.matchScore;
  return s === null ? '—' : String(s);
}

function RowActions({ r, h, onCreateResume, onAskDelete }: { r: ApplicationRecord; h: HistoryController; onCreateResume?: (r: ApplicationRecord) => void; onAskDelete: (r: ApplicationRecord) => void }) {
  const [mode, setMode] = useState<null | 'note' | 'follow'>(null);
  const [text, setText] = useState('');
  const [date, setDate] = useState(r.followUpDate ?? addDays(todayLocal(), 7));
  return (
    <div className="stack-sm">
      <div className="row" style={{ gap: 4 }}>
        <button type="button" className="btn btn-sm" onClick={() => h.openJob(r)}>
          <Icon name="external" size={13} /> Open job
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void h.openFolder(r)} disabled={!r.files.length}>
          <Icon name="folder" size={13} /> Open saved folder
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void h.duplicate(r)}>
          <Icon name="copy" size={13} /> Duplicate
        </button>
        <button type="button" className="btn btn-sm" onClick={() => (onCreateResume ? onCreateResume(r) : h.openJob(r))} title="Opens the job so you can tailor a new resume version">
          <Icon name="refresh" size={13} /> New tailored resume
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setMode(mode === 'note' ? null : 'note')} aria-expanded={mode === 'note'}>
          <Icon name="note" size={13} /> Add note
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setMode(mode === 'follow' ? null : 'follow')} aria-expanded={mode === 'follow'}>
          <Icon name="bell" size={13} /> Follow-up
        </button>
        <button type="button" className="btn btn-sm btn-danger" onClick={() => onAskDelete(r)}>
          <Icon name="trash" size={13} /> Delete
        </button>
      </div>
      {mode === 'note' ? (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void h.note(r, text).then(() => {
              setText('');
              setMode(null);
            });
          }}
        >
          <label className="sr-only" htmlFor={`note-${r.id}`}>
            Note
          </label>
          <input id={`note-${r.id}`} className="input" style={{ flex: 1, minWidth: 180 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Recruiter call scheduled for Tuesday" />
          <button type="submit" className="btn btn-sm btn-primary" disabled={!text.trim()}>
            Save note
          </button>
        </form>
      ) : null}
      {mode === 'follow' ? (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void h.setFollowUp(r, date).then(() => setMode(null));
          }}
        >
          <label htmlFor={`fu-${r.id}`} className="small">
            Remind me on
          </label>
          <input id={`fu-${r.id}`} className="input" type="date" style={{ width: 170 }} value={date} onChange={(e) => setDate(e.target.value)} />
          <button type="submit" className="btn btn-sm btn-primary">
            Set reminder
          </button>
          {r.followUpDate ? (
            <button type="button" className="btn btn-sm" onClick={() => void h.setFollowUp(r, null).then(() => setMode(null))}>
              Clear
            </button>
          ) : null}
        </form>
      ) : null}
      {r.notes.length ? (
        <ul className="bullets small">
          {r.notes.map((n) => (
            <li key={n.id}>
              <span className="muted">{formatDisplayDate(n.createdAt)}:</span> {n.text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function HistoryFiltersBar({ f, setF }: { f: HistoryFilters; setF: (f: HistoryFilters) => void }) {
  const set = <K extends keyof HistoryFilters>(k: K, v: HistoryFilters[K]) => setF({ ...f, [k]: v });
  return (
    <fieldset className="card" style={{ margin: 0 }}>
      <legend className="sr-only">Filter applications</legend>
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <div className="field">
          <label htmlFor="hf-company">Company</label>
          <input id="hf-company" className="input" value={f.company} onChange={(e) => set('company', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="hf-title">Job title</label>
          <input id="hf-title" className="input" value={f.title} onChange={(e) => set('title', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="hf-tech">Technology</label>
          <input id="hf-tech" className="input" value={f.technology} onChange={(e) => set('technology', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="hf-stage">Status</label>
          <select id="hf-stage" className="select" value={f.stages[0] ?? ''} onChange={(e) => set('stages', e.target.value ? [e.target.value as ApplicationStage] : [])}>
            <option value="">All statuses</option>
            {APPLICATION_STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="hf-remote">Remote status</label>
          <select id="hf-remote" className="select" value={f.remoteStatus} onChange={(e) => set('remoteStatus', e.target.value as HistoryFilters['remoteStatus'])}>
            <option value="any">Any</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">On-site</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="hf-from">Applied from</label>
          <input id="hf-from" className="input" type="date" value={f.dateFrom} onChange={(e) => set('dateFrom', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="hf-to">Applied to</label>
          <input id="hf-to" className="input" type="date" value={f.dateTo} onChange={(e) => set('dateTo', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="hf-min">Min. match score</label>
          <input id="hf-min" className="input" type="number" min={0} max={100} value={f.minScore ?? ''} onChange={(e) => set('minScore', e.target.value === '' ? null : Number(e.target.value))} />
        </div>
      </div>
      <div className="row-between" style={{ marginTop: 10 }}>
        <label className="check" htmlFor="hf-due">
          <input id="hf-due" type="checkbox" checked={f.followUpDue} onChange={(e) => set('followUpDue', e.target.checked)} />
          Follow-up due
        </label>
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => setF(EMPTY_FILTERS)}>
          Clear filters
        </button>
      </div>
    </fieldset>
  );
}

export function HistoryTable({ h, focusId, onCreateResume }: { h: HistoryController; focusId?: string | null; onCreateResume?: (r: ApplicationRecord) => void }) {
  const [f, setF] = useState<HistoryFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [open, setOpen] = useState<string | null>(focusId ?? null);
  const [deleting, setDeleting] = useState<ApplicationRecord | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => sortApplications(filterApplications(h.records, f), sort.key, sort.dir), [h.records, f, sort]);
  const th = (key: SortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}>
        {label} <Icon name="sort" size={12} />
      </button>
    </th>
  );
  return (
    <div className="stack">
      <HistoryFiltersBar f={f} setF={setF} />
      <div className="row-between">
        <span className="small muted" aria-live="polite">
          Showing {rows.length} of {h.records.length} applications
        </span>
        <span className="row" style={{ gap: 4 }}>
          <button type="button" className="btn btn-sm" onClick={() => void h.exportCsv(rows)} disabled={!rows.length}>
            <Icon name="download" size={13} /> Export CSV
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void h.exportJson(rows)} disabled={!rows.length}>
            <Icon name="download" size={13} /> Export JSON
          </button>
          <button type="button" className="btn btn-sm" onClick={() => importRef.current?.click()}>
            <Icon name="upload" size={13} /> Import JSON
          </button>
          <input ref={importRef} type="file" accept=".json,application/json" className="sr-only" aria-label="Import an ApplyFlow JSON export" onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void h.importJson(file);
            e.target.value = '';
          }} />
        </span>
      </div>
      {h.message ? <WarningBanner tone="info" live>{h.message}</WarningBanner> : null}
      {rows.length ? (
        <div className="table-wrap">
          <table className="data">
            <caption className="sr-only">Application history</caption>
            <thead>
              <tr>
                {th('company', 'Company')}
                {th('title', 'Job title')}
                <th>Location</th>
                {th('date', 'Date applied')}
                {th('stage', 'Status')}
                {th('score', 'Match (est.)')}
                <th>Resume / letter</th>
                {th('followUp', 'Follow-up')}
                <th>
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr data-focus={focusId === r.id}>
                    <td className="strong">{r.company}</td>
                    <td>
                      <a href={r.jobUrl} target="_blank" rel="noreferrer noopener">
                        {r.title}
                      </a>
                    </td>
                    <td>
                      {r.location}
                      <div className="small muted">{r.remoteStatus === 'unknown' ? '' : r.remoteStatus}</div>
                    </td>
                    <td>{r.dateApplied ? formatDisplayDate(r.dateApplied) : <span className="muted">Prepared {formatDisplayDate(r.datePrepared)}</span>}</td>
                    <td>
                      <StageSelect id={`st-${r.id}`} r={r} onChange={(s) => void h.changeStage(r, s)} />
                    </td>
                    <td className="score-cell">{scoreOf(r)}</td>
                    <td className="small">
                      v{r.resumeVersion}
                      {r.coverLetterVersion ? ` / v${r.coverLetterVersion}` : ' / none'}
                    </td>
                    <td>
                      {r.followUpDate ? (
                        <span className={`chip ${isFollowUpDue(r) ? 'chip-amber' : ''}`}>
                          {isFollowUpDue(r) ? 'Due ' : ''}
                          {formatDisplayDate(r.followUpDate)}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <button type="button" className="btn btn-sm btn-quiet" aria-expanded={open === r.id} aria-controls={`act-${r.id}`} onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {open === r.id ? 'Hide' : 'Actions'}
                      </button>
                    </td>
                  </tr>
                  {open === r.id ? (
                    <tr>
                      <td colSpan={9} id={`act-${r.id}`} style={{ background: 'var(--panel)' }}>
                        <RowActions r={r} h={h} onCreateResume={onCreateResume} onAskDelete={setDeleting} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <strong>{h.records.length ? 'No applications match these filters.' : 'No applications yet.'}</strong>
          <span>{h.records.length ? 'Clear a filter to see more.' : 'Applications you prepare or submit with ApplyFlow appear here.'}</span>
        </div>
      )}
      <ConfirmationModal
        open={Boolean(deleting)}
        title="Delete this application record?"
        confirmLabel="Delete record"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void h.remove(deleting);
          setDeleting(null);
        }}
      >
        <p>
          The history entry for <strong>{deleting?.title}</strong> at <strong>{deleting?.company}</strong> will be removed from ApplyFlow. Files already saved on your computer are not deleted.
        </p>
      </ConfirmationModal>
    </div>
  );
}

/** Compact list for the narrow side panel. */
export function HistoryList({ h, onOpenDashboard }: { h: HistoryController; onOpenDashboard: () => void }) {
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<ApplicationStage | ''>('');
  const rows = h.records.filter((r) => (!stage || r.stage === stage) && (!q.trim() || `${r.company} ${r.title}`.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <div className="stack">
      <div className="row">
        <label className="sr-only" htmlFor="hl-q">
          Search applications
        </label>
        <input id="hl-q" className="input" style={{ flex: 1, minWidth: 140 }} placeholder="Search company or title" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="sr-only" htmlFor="hl-stage">
          Filter by status
        </label>
        <select id="hl-stage" className="select" style={{ width: 'auto' }} value={stage} onChange={(e) => setStage(e.target.value as ApplicationStage | '')}>
          <option value="">All statuses</option>
          {APPLICATION_STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {h.message ? <WarningBanner tone="info" live>{h.message}</WarningBanner> : null}
      {rows.length ? (
        <ul className="list-plain stack-sm">
          {rows.map((r) => (
            <li key={r.id} className="history-card">
              <div className="row-between">
                <span className="h-title">{r.title}</span>
                <span className="strong mono-num" aria-label={`Estimated match ${scoreOf(r)}`}>{scoreOf(r)}</span>
              </div>
              <span className="h-sub">
                {r.company}, {r.location}
              </span>
              <div className="row-between">
                <span className="small muted">{r.dateApplied ? `Applied ${formatDisplayDate(r.dateApplied)}` : `Prepared ${formatDisplayDate(r.datePrepared)}`}</span>
                <StageSelect id={`hls-${r.id}`} r={r} onChange={(s) => void h.changeStage(r, s)} />
              </div>
              <div className="row" style={{ gap: 4 }}>
                <button type="button" className="btn btn-sm btn-quiet" onClick={() => h.openJob(r)}>
                  Open job
                </button>
                <button type="button" className="btn btn-sm btn-quiet" onClick={() => void h.openFolder(r)} disabled={!r.files.length}>
                  Open saved folder
                </button>
                {r.followUpDate ? <span className={`chip ${isFollowUpDue(r) ? 'chip-amber' : ''}`}>Follow up {formatDisplayDate(r.followUpDate)}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty">
          <strong>{h.records.length ? 'No matches.' : 'No applications yet.'}</strong>
          <span>{h.records.length ? 'Try another search.' : 'Submitted and prepared applications are saved here automatically.'}</span>
        </div>
      )}
      <button type="button" className="btn" onClick={onOpenDashboard}>
        <Icon name="history" /> Open full history dashboard
      </button>
    </div>
  );
}
