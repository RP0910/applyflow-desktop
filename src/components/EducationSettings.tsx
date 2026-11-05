import { useEffect, useState } from 'react';
import type { LibraryController } from '@/hooks/useLibrary';
import { builderFromParsed, builderProblems, emptyEducation } from '@/services/resume/builder';
import type { BuilderEducation } from '@/types';
import { Icon } from './Icon';

export function EducationSettings({ lib }: { lib: LibraryController }) {
  const existing = lib.resumes.find((r) => r.isDefault) ?? lib.resumes[0];
  const load = (): BuilderEducation[] => {
    const edu = existing ? builderFromParsed(existing.parsed).education : [];
    return edu.length ? edu : [emptyEducation()];
  };
  const [entries, setEntries] = useState<BuilderEducation[]>(load);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'warn'; text: string; details?: string[] } | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setEntries(load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, existing?.updatedAt]);

  const update = (id: string, patch: Partial<BuilderEducation>) => {
    setDirty(true);
    setStatus(null);
    setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const save = async () => {
    if (!existing) return;
    setBusy(true);
    setStatus(null);
    try {
      const form = { ...builderFromParsed(existing.parsed), education: entries };
      const problems = builderProblems(form);
      if (problems.length) {
        setStatus({ tone: 'warn', text: 'Please fix these first:', details: problems });
        return;
      }
      const saved = await lib.saveForm(form, existing.name, existing);
      if (saved) {
        setDirty(false);
        const n = saved.parsed.education.length;
        setStatus({ tone: 'ok', text: n ? `Education saved (${n} ${n === 1 ? 'entry' : 'entries'}). It appears on every resume generated from now on.` : 'Education removed from your resume.' });
      } else {
        setStatus({ tone: 'warn', text: 'Could not save your education. Check Profile settings → Resume generation setup.' });
      }
    } catch (e) {
      setStatus({ tone: 'warn', text: e instanceof Error ? e.message : 'Could not save.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" style={{ marginTop: 16 }} aria-labelledby="set-edu">
      <h2 className="section-title" id="set-edu">
        <Icon name="doc" /> Education
      </h2>
      <span className="hint">Your university or school, degree and dates. Claude never writes or changes education — it goes on every tailored resume exactly as entered here.</span>
      {!existing ? (
        <p>Save your employers in <strong>Resume generation setup</strong> above first. Then add your education here.</p>
      ) : (
        <>
          {entries.map((e, i) => (
            <fieldset className="stack-sm" key={e.id}>
              <legend>Education {entries.length > 1 ? i + 1 : ''}</legend>
              <label className="field">
                University / school
                <input className="input" value={e.school} placeholder="e.g. Purdue University" onChange={(ev) => update(e.id, { school: ev.target.value })} />
              </label>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <label className="field" style={{ flex: 1, minWidth: 220 }}>
                  Degree
                  <input className="input" style={{ width: '100%' }} value={e.degree} placeholder="e.g. Bachelor of Science" onChange={(ev) => update(e.id, { degree: ev.target.value })} />
                </label>
                <label className="field" style={{ flex: 1, minWidth: 220 }}>
                  Field of study
                  <input className="input" style={{ width: '100%' }} value={e.field} placeholder="e.g. Electrical Engineering Technology" onChange={(ev) => update(e.id, { field: ev.target.value })} />
                </label>
              </div>
              <label className="field">
                City (optional)
                <input className="input" value={e.city} placeholder="e.g. West Lafayette, IN" onChange={(ev) => update(e.id, { city: ev.target.value })} />
              </label>
              <div className="row">
                <label className="field">
                  Start (optional)
                  <input className="input" type="month" value={e.start} onChange={(ev) => update(e.id, { start: ev.target.value })} />
                </label>
                <label className="field">
                  End / graduation
                  <input className="input" type="month" value={e.end} onChange={(ev) => update(e.id, { end: ev.target.value })} />
                </label>
              </div>
              <label className="field">
                Details (optional, one per line)
                <textarea className="input" rows={2} value={e.details ?? ''} placeholder={'e.g. GPA 3.7\nDean’s List'} onChange={(ev) => update(e.id, { details: ev.target.value })} />
              </label>
              <div>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setDirty(true);
                    setStatus(null);
                    setEntries((list) => (list.length > 1 ? list.filter((x) => x.id !== e.id) : [emptyEducation()]));
                  }}
                >
                  <Icon name="trash" /> Remove
                </button>
              </div>
            </fieldset>
          ))}
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                setDirty(true);
                setEntries((list) => [...list, emptyEducation()]);
              }}
            >
              <Icon name="plus" /> Add education
            </button>
            <button className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save education'}
            </button>
          </div>
          <span className="hint">Documents already generated for a job keep the education they were made with; new Tailor &amp; Apply runs use these entries.</span>
        </>
      )}
      {status ? (
        <div role="status" className="small" style={{ color: status.tone === 'warn' ? 'var(--danger, #b42318)' : undefined }}>
          {status.text}
          {status.details?.length ? (
            <ul>
              {status.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
