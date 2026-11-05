import { useMemo, useState } from 'react';
import type { AtsCheck, AtsReport, KeywordResult } from '@/types';
import { Icon } from './Icon';

const STATUS_ICON = { pass: 'check', warn: 'alert', fail: 'stop' } as const;
const STATUS_TEXT = { pass: 'Passed', warn: 'Needs a look', fail: 'Problem' } as const;

function CheckRow({ c }: { c: AtsCheck }) {
  return (
    <li className={`ats-check ats-${c.status}`}>
      <Icon name={STATUS_ICON[c.status]} size={14} title={STATUS_TEXT[c.status]} />
      <span>
        {c.label}
        {c.detail ? <small className="muted"> {c.detail}</small> : null}
      </span>
    </li>
  );
}

function Chips({ items, tone, title }: { items: KeywordResult[]; tone: 'green' | 'amber' | 'muted'; title: string }) {
  if (!items.length) return null;
  return (
    <div className="ats-chips">
      <p className="ats-chips-title">{title}</p>
      <div className="chip-row">
        {items.map((k) => (
          <span key={k.term} className={`chip ${tone === 'muted' ? '' : `chip-${tone}`}`} title={k.found === 'synonym' ? 'Found under another spelling' : undefined}>
            {k.found !== 'missing' ? <Icon name="check" size={11} /> : null}
            {k.term}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface AtsReportCardProps {
  report: AtsReport;
  before?: AtsReport | null;
  expanded?: boolean;
  busy?: boolean;
  onConfirmSkills?: (terms: string[]) => void;
}

export function AtsReportCard({ report, before, expanded = false, busy = false, onConfirmSkills }: AtsReportCardProps) {
  const [open, setOpen] = useState(expanded);
  const [picked, setPicked] = useState<string[]>([]);
  const groups = useMemo(() => {
    const technical = report.keywords.filter((k) => k.kind === 'hard' || k.kind === 'domain' || k.kind === 'certification');
    return {
      found: technical.filter((k) => k.found !== 'missing'),
      usable: technical.filter((k) => k.found === 'missing' && k.support === 'supported'),
      notYours: technical.filter((k) => k.found === 'missing' && k.support !== 'supported').sort((a, b) => b.weight - a.weight),
    };
  }, [report]);
  const problems = report.checks.filter((c) => c.status !== 'pass');
  const tailored = report.computedFor === 'tailored';
  const toggle = (t: string) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  return (
    <section className="card ats-card" aria-labelledby="ats-title">
      <div className="ats-head">
        <div className={`ats-score ats-band-${report.band}`} aria-hidden="true">
          {report.score}
        </div>
        <div className="ats-head-text">
          <h2 className="card-title" id="ats-title">
            ATS check{tailored ? ': tailored resume' : ': your master resume'}
          </h2>
          <p className="small muted">
            <span className="sr-only">Score {report.score} out of 100. </span>
            {tailored && before ? `Was ${before.score} with your master resume. ` : ''}
            {groups.found.length} of {groups.found.length + groups.usable.length + groups.notYours.length} job keywords
            {report.reachable > report.score ? ` · up to ${report.reachable} possible with your experience` : ''}
          </p>
        </div>
      </div>

      {problems.length ? (
        <ul className="list-plain ats-checks">
          {(open ? problems : problems.slice(0, 2)).map((c) => (
            <CheckRow key={c.id} c={c} />
          ))}
        </ul>
      ) : (
        <p className="small ats-allgood">
          <Icon name="check" size={14} /> Every ATS check passed.
        </p>
      )}

      {groups.notYours.length && onConfirmSkills ? (
        <div className="ats-confirm">
          <p className="small">
            <strong>Not on your resume:</strong> the job asks for these and your resume doesn’t show them. ApplyFlow won’t add them unless you have them — tap the ones you do.
          </p>
          <div className="chip-row">
            {groups.notYours.slice(0, 12).map((k) => (
              <button
                type="button"
                key={k.term}
                className={`chip chip-toggle${picked.includes(k.term) ? ' chip-blue' : ''}`}
                aria-pressed={picked.includes(k.term)}
                onClick={() => toggle(k.term)}
              >
                {picked.includes(k.term) ? <Icon name="check" size={11} /> : <Icon name="plus" size={11} />}
                {k.term}
              </button>
            ))}
          </div>
          {picked.length ? (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onConfirmSkills(picked)}>
              I have {picked.length === 1 ? 'it' : `these ${picked.length}`} — add to my skills and rewrite
            </button>
          ) : null}
        </div>
      ) : null}

      <button type="button" className="link small" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide ATS details' : 'Show ATS details'}
      </button>
      {open ? (
        <div className="ats-details">
          <ul className="list-plain ats-cats">
            {report.categories
              .filter((c) => c.applicable)
              .map((c) => (
                <li key={c.key}>
                  <span>{c.label}</span>
                  <span className="ats-bar" aria-hidden="true">
                    <span style={{ width: `${Math.round((c.score / c.max) * 100)}%` }} />
                  </span>
                  <b>
                    {Math.round(c.score)}/{c.max}
                  </b>
                </li>
              ))}
          </ul>
          <Chips items={groups.found} tone="green" title={`On the resume (${groups.found.length})`} />
          <Chips items={groups.usable} tone="amber" title="Backed by your experience but not used yet" />
          <ul className="list-plain ats-checks">
            {report.checks
              .filter((c) => c.status === 'pass')
              .map((c) => (
                <CheckRow key={c.id} c={c} />
              ))}
          </ul>
          <p className="tiny muted">{report.disclaimer}</p>
        </div>
      ) : null}
    </section>
  );
}
