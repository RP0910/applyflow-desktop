import { useEffect, useState } from 'react';
import type { LibraryController } from '@/hooks/useLibrary';
import { builderFromParsed, emptyBuilder, emptyJob } from '@/services/resume/builder';
import type { BuilderJob } from '@/types';

export function CandidateSetup({ lib }: { lib: LibraryController }) {
  const existing = lib.resumes.find(r => r.isDefault) ?? lib.resumes[0];
  const [form, setForm] = useState(() => existing ? builderFromParsed(existing.parsed) : emptyBuilder());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => { setForm(existing ? builderFromParsed(existing.parsed) : emptyBuilder()); }, [existing?.id, existing?.updatedAt]);
  const update = (id: string, patch: Partial<BuilderJob>) => setForm(f => ({ ...f, jobs: f.jobs.map(j => j.id === id ? { ...j, ...patch } : j) }));
  return <section className="card stack" style={{marginTop: 16}}>
    <h2 className="section-title">Resume generation setup</h2>
    <p>Enter employer names and employment dates. Titles are optional. Claude writes the summary, skills, work descriptions and cover letter using CV Generate.txt.</p>
    {form.jobs.map((j, i) => <fieldset className="stack-sm" key={j.id}><legend>Employer {i + 1}</legend>
      <label className="field">Company<input className="input" value={j.company} onChange={e => update(j.id,{company:e.target.value})}/></label>
      <label className="field">Job title (optional)<input className="input" value={j.title} onChange={e => update(j.id,{title:e.target.value})}/></label>
      <div className="row"><label className="field">Start<input className="input" type="month" value={j.start} onChange={e => update(j.id,{start:e.target.value})}/></label>
      <label className="field">End<input className="input" type="month" disabled={j.current} value={j.end} onChange={e => update(j.id,{end:e.target.value})}/></label></div>
      <label><input type="checkbox" checked={j.current} onChange={e => update(j.id,{current:e.target.checked})}/> I work here now</label>
      <button className="btn btn-sm" disabled={form.jobs.length===1} onClick={() => setForm(f => ({...f,jobs:f.jobs.filter(x => x.id!==j.id)}))}>Remove employer</button>
    </fieldset>)}
    <div className="row"><button className="btn" onClick={() => setForm(f => ({...f,jobs:[...f.jobs,emptyJob()]}))}>Add employer</button>
    <button className="btn btn-primary" disabled={busy} onClick={async () => {setBusy(true);setStatus('');try {const r=await lib.saveForm(form,'Candidate setup',existing);setStatus(r?'Candidate setup saved. Open a job and select Tailor & Apply.':'Check company names and employment dates.');}catch(e){setStatus(e instanceof Error?e.message:'Could not save.');}finally{setBusy(false);}}}>Save candidate setup</button></div>
    <p className="small muted">AI-written responsibilities and achievements are illustrative drafts. Verify them before submitting. Match scores measure the draft, not verified qualifications; 95+ is a target, not a guarantee.</p>
    <p role="status">{status || lib.message?.text}</p>
  </section>;
}
