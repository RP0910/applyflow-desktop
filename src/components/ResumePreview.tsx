import { useMemo, useState } from 'react';
import type { ChangeNote, ParsedResume, TailoredResume } from '@/types';
import { compareResumes, changeStats, type DiffLine } from '@/services/tailoring/diff';
import { contactLine } from '@/services/export/render';
import { formatDateText, formatRange, skillLines } from '@/services/export/layout';

export type ResumeView = 'preview' | 'compare' | 'edit';

const TAG: Record<DiffLine['status'], string> = { same: 'Same', moved: 'Moved', reworded: 'Reworded', added: 'New', removed: 'Removed' };

export function ResumePaper({ resume }: { resume: TailoredResume }) {
  return (
    <article className="paper" aria-label="Tailored resume preview">
      <div className="name">{resume.contact.fullName}</div>
      {resume.headline ? <div className="headline">{resume.headline}</div> : null}
      <div className="contact">{contactLine(resume)}</div>
      {resume.summary ? (
        <>
          <h3>Professional summary</h3>
          <p>{resume.summary}</p>
        </>
      ) : null}
      {skillLines(resume).length ? (
        <>
          <h3>Technical skills</h3>
          {skillLines(resume).map((g) => (
            <p key={g.name || 'skills'} className="skill-line">
              {g.name ? <b>{g.name}: </b> : null}
              {g.skills.join(', ')}
            </p>
          ))}
        </>
      ) : null}
      <h3>Professional experience</h3>
      {resume.experience.map((e) => (
        <div key={e.sourceId}>
          <div className="role role-split">
            <span>{e.title}</span>
            <span className="role-dates">{formatRange(e.startDate, e.endDate, 'mon_yyyy')}</span>
          </div>
          <div className="role-meta">{[e.company, e.location].filter(Boolean).join(' | ')}</div>
          <ul>
            {e.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
          {e.technologies?.length ? (
            <p className="tech-line">
              <b>Technologies: </b>
              {e.technologies.join(', ')}
            </p>
          ) : null}
        </div>
      ))}
      {resume.projects.length ? (
        <>
          <h3>Projects</h3>
          {resume.projects.map((p) => (
            <div key={p.name}>
              <div className="role">{p.description ? `${p.name}: ${p.description}` : p.name}</div>
              <ul>
                {p.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </>
      ) : null}
      {resume.education.length ? (
        <>
          <h3>Education</h3>
          {resume.education.map((e) => (
            <p key={e.id}>{[e.degree, e.institution, e.location, formatDateText(e.date, 'mon_yyyy')].filter(Boolean).join(' | ')}</p>
          ))}
        </>
      ) : null}
      {resume.certifications.length ? (
        <>
          <h3>Certifications</h3>
          <ul>
            {resume.certifications.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      ) : null}
      {resume.additional.length ? (
        <>
          <h3>Additional information</h3>
          <ul>
            {resume.additional.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}

function Lines({ lines }: { lines: DiffLine[] }) {
  if (!lines.length) return <p className="small muted">(none)</p>;
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} className={`diff-line diff-${l.status}`} title={l.original ? `Original: ${l.original}` : undefined}>
          <span className="tag">{TAG[l.status]}</span>
          <span>{l.text}</span>
        </div>
      ))}
    </>
  );
}

export function ResumeCompare({ master, tailored, changes }: { master: ParsedResume; tailored: TailoredResume; changes: ChangeNote[] }) {
  const diffs = useMemo(() => compareResumes(master, tailored), [master, tailored]);
  const stats = changeStats(diffs);
  return (
    <div className="stack">
      <p className="small muted">
        {stats.moved} moved, {stats.reworded} reworded, {stats.added} new, {stats.removed} removed. Labels mark every change, so nothing relies on color.
      </p>
      {changes.length ? (
        <section className="card card-quiet">
          <h3 className="section-title">Why these changes</h3>
          <ul className="bullets small">
            {changes.map((c, i) => (
              <li key={i}>
                <strong>{c.section}:</strong> {c.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {diffs.map((d) => (
        <section key={d.section} className="compare-section">
          <header>{d.section}</header>
          <div className="compare-cols">
            <div>
              <h5>Original</h5>
              <Lines lines={d.original} />
            </div>
            <div>
              <h5>Tailored</h5>
              <Lines lines={d.tailored} />
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

/** "Languages: Swift, Kotlin" lines → skill groups and the flat list. */
export function parseSkillText(text: string): Pick<TailoredResume, 'skills' | 'skillGroups'> {
  const groups = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^([^:,]{2,40}):\s*(.*)$/);
      return { name: m ? m[1]!.trim() : '', skills: (m ? m[2]! : l).split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean) };
    })
    .filter((g) => g.skills.length);
  const named = groups.every((g) => g.name);
  return { skills: groups.flatMap((g) => g.skills), skillGroups: named ? groups : undefined };
}

/** Structured editor: fields map 1:1 to the resume, so employer/title/dates stay read-only. */
export function ResumeEditor({ resume, onSave, onCancel }: { resume: TailoredResume; onSave: (r: TailoredResume) => void; onCancel: () => void }) {
  const [headline, setHeadline] = useState(resume.headline);
  const [summary, setSummary] = useState(resume.summary);
  const [skills, setSkills] = useState(skillLines(resume).map((g) => (g.name ? `${g.name}: ${g.skills.join(', ')}` : g.skills.join(', '))).join('\n'));
  const [bullets, setBullets] = useState<Record<string, string>>(() => Object.fromEntries(resume.experience.map((e) => [e.sourceId, e.bullets.join('\n')])));
  const save = () =>
    onSave({
      ...resume,
      headline: headline.trim(),
      summary: summary.trim(),
      ...parseSkillText(skills),
      experience: resume.experience.map((e) => ({ ...e, bullets: (bullets[e.sourceId] ?? '').split('\n').map((b) => b.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean) })),
    });
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <p className="small muted">Employers, titles and dates come from your master resume and can’t be changed here. Edits are re-checked for truthfulness when you save.</p>
      <div className="field">
        <label htmlFor="ed-headline">Headline</label>
        <input id="ed-headline" className="input" value={headline} onChange={(e) => setHeadline(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ed-summary">Summary</label>
        <textarea id="ed-summary" className="textarea" value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ed-skills">Technical skills</label>
        <textarea id="ed-skills" className="textarea" style={{ minHeight: 96 }} value={skills} onChange={(e) => setSkills(e.target.value)} />
        <span className="hint">One group per line, like “Languages: Swift, Kotlin”.</span>
      </div>
      {resume.experience.map((e) => (
        <div className="field" key={e.sourceId}>
          <label htmlFor={`ed-${e.sourceId}`}>
            {e.title}, {e.company} <span className="muted">({e.startDate} – {e.endDate})</span>
          </label>
          <textarea id={`ed-${e.sourceId}`} className="textarea" value={bullets[e.sourceId] ?? ''} onChange={(ev) => setBullets((b) => ({ ...b, [e.sourceId]: ev.target.value }))} />
          <span className="hint">One bullet per line.</span>
        </div>
      ))}
      <div className="row">
        <button type="submit" className="btn btn-primary">
          Save and re-check
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
