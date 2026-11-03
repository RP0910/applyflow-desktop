/**
 * The resume form: type your real history once — no file needed. ApplyFlow writes a resume
 * targeted to each Dice job from what you enter here (and only from that).
 */
import { useEffect, useMemo, useState } from 'react';
import type { BuilderEducation, BuilderForm, BuilderJob, CareerProfile, MasterResume } from '@/types';
import type { LibraryController } from '@/hooks/useLibrary';
import { builderProblems, emptyBuilder, emptyEducation, emptyJob, isBlankJob, monthToResume, sortJobs } from '@/services/resume/builder';
import { yearsOfExperience } from '@/services/matching/experience';
import { WarningBanner } from './WarningBanner';
import { Icon } from './Icon';

function JobFields({ job, n, onChange, onRemove, canRemove }: { job: BuilderJob; n: number; onChange: (j: BuilderJob) => void; onRemove: () => void; canRemove: boolean }) {
  const id = (f: string) => `job-${job.id}-${f}`;
  const set = (p: Partial<BuilderJob>) => onChange({ ...job, ...p });
  return (
    <fieldset className="card stack-sm builder-job">
      <legend className="sr-only">Job {n}</legend>
      <div className="row-between">
        <h3 className="card-title">{job.company.trim() || `Job ${n}`}</h3>
        {canRemove ? (
          <button type="button" className="btn btn-sm" onClick={onRemove} aria-label={`Remove ${job.company.trim() || `job ${n}`}`}>
            <Icon name="trash" size={13} /> Remove
          </button>
        ) : null}
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor={id('company')}>Company</label>
          <input id={id('company')} className="input" value={job.company} onChange={(e) => set({ company: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={id('title')}>Your job title</label>
          <input id={id('title')} className="input" value={job.title} onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={id('city')}>City</label>
          <input id={id('city')} className="input" placeholder="Boston, MA" value={job.city} onChange={(e) => set({ city: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={id('start')}>Start month</label>
          <input id={id('start')} className="input" type="month" value={job.start} onChange={(e) => set({ start: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={id('end')}>End month</label>
          <input id={id('end')} className="input" type="month" value={job.current ? '' : job.end} disabled={job.current} onChange={(e) => set({ end: e.target.value })} />
        </div>
      </div>
      <label className="check" htmlFor={id('current')}>
        <input id={id('current')} type="checkbox" checked={job.current} onChange={(e) => set({ current: e.target.checked, end: e.target.checked ? '' : job.end })} />
        I work here now
      </label>
      <div className="field">
        <label htmlFor={id('did')}>What you did there — one per line</label>
        <textarea
          id={id('did')}
          className="textarea"
          style={{ minHeight: 120 }}
          placeholder={'Built the iOS and Android video player used by 2 million viewers\nCut video startup time by 30% by tuning HLS buffering\nIntegrated Google IMA SDK for VAST and VMAP ads'}
          value={job.did}
          onChange={(e) => set({ did: e.target.value })}
        />
        <span className="hint">Write what really happened, with tools, scale and numbers where you have them. ApplyFlow rewrites these into polished bullets for each job ad — it never adds work you didn’t write here.</span>
      </div>
      <div className="field">
        <label htmlFor={id('tech')}>Tools and technologies used in this job</label>
        <input id={id('tech')} className="input" placeholder="Swift, Kotlin, ExoPlayer, HLS, Widevine" value={job.technologies} onChange={(e) => set({ technologies: e.target.value })} />
      </div>
    </fieldset>
  );
}

function EducationFields({ ed, onChange, onRemove, canRemove }: { ed: BuilderEducation; onChange: (e: BuilderEducation) => void; onRemove: () => void; canRemove: boolean }) {
  const id = (f: string) => `edu-${ed.id}-${f}`;
  const set = (p: Partial<BuilderEducation>) => onChange({ ...ed, ...p });
  return (
    <fieldset className="card stack-sm">
      <legend className="sr-only">Education</legend>
      <div className="grid-2">
        <div className="field">
          <label htmlFor={id('school')}>School</label>
          <input id={id('school')} className="input" value={ed.school} onChange={(e) => set({ school: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={id('city')}>School city</label>
          <input id={id('city')} className="input" value={ed.city} onChange={(e) => set({ city: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={id('degree')}>Degree</label>
          <input id={id('degree')} className="input" placeholder="Bachelor’s degree" value={ed.degree} onChange={(e) => set({ degree: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={id('field')}>Field of study</label>
          <input id={id('field')} className="input" placeholder="Computer Science" value={ed.field} onChange={(e) => set({ field: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={id('start')}>Started school</label>
          <input id={id('start')} className="input" type="month" value={ed.start} onChange={(e) => set({ start: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={id('end')}>Finished school</label>
          <input id={id('end')} className="input" type="month" value={ed.end} onChange={(e) => set({ end: e.target.value })} />
        </div>
      </div>
      {canRemove ? (
        <div>
          <button type="button" className="btn btn-sm" onClick={onRemove}>
            <Icon name="trash" size={13} /> Remove
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}

export interface ResumeBuilderProps {
  lib: LibraryController;
  /** Edit this resume; omit to create a new one. */
  existing?: MasterResume;
  /** Start from these values (e.g. converted from an imported resume). */
  initial?: BuilderForm;
  onDone?: (r: MasterResume) => void;
  onCancel?: () => void;
}

export function ResumeBuilder({ lib, existing, initial, onDone, onCancel }: ResumeBuilderProps) {
  const [form, setForm] = useState<BuilderForm>(() => structuredClone(initial ?? existing?.builder ?? emptyBuilder()));
  const [name, setName] = useState(existing?.name ?? 'My resume');
  const [contact, setContact] = useState<Pick<CareerProfile, 'fullName' | 'location' | 'phone' | 'email' | 'linkedinUrl'>>(() => ({
    fullName: lib.profile.fullName,
    location: lib.profile.location,
    phone: lib.profile.phone,
    email: lib.profile.email,
    linkedinUrl: lib.profile.linkedinUrl,
  }));
  // The profile loads after the page opens: fill the contact fields once it arrives.
  useEffect(() => {
    setContact((c) =>
      c.fullName || c.email || c.phone || c.location
        ? c
        : { fullName: lib.profile.fullName, location: lib.profile.location, phone: lib.profile.phone, email: lib.profile.email, linkedinUrl: lib.profile.linkedinUrl },
    );
  }, [lib.profile]);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const problems = builderProblems(form);
  const contactMissing = [!contact.fullName.trim() && 'name', !contact.email.trim() && 'email', !contact.phone.trim() && 'phone', !contact.location.trim() && 'city and state'].filter(Boolean) as string[];

  // Total experience, from the dates entered (overlaps counted once).
  const years = useMemo(() => {
    const jobs = form.jobs.filter((j) => !isBlankJob(j) && j.start);
    return yearsOfExperience(jobs.map((j) => ({ startDate: monthToResume(j.start), endDate: j.current || !j.end ? 'Present' : monthToResume(j.end) })));
  }, [form.jobs]);
  const filled = form.jobs.filter((j) => !isBlankJob(j)).length;

  const setJob = (i: number, j: BuilderJob) => setForm((f) => ({ ...f, jobs: f.jobs.map((x, k) => (k === i ? j : x)) }));
  const setEdu = (i: number, e: BuilderEducation) => setForm((f) => ({ ...f, education: f.education.map((x, k) => (k === i ? e : x)) }));

  const save = async () => {
    setTried(true);
    if (problems.length || contactMissing.length) return;
    setSaving(true);
    try {
      const profile = { ...lib.profile, ...contact };
      await lib.updateProfile(profile);
      const r = await lib.saveForm({ ...form, jobs: sortJobs(form.jobs) }, name, existing, profile);
      if (r) onDone?.(r);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="stack builder"
      aria-label="Resume form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="small muted">
        Type your real work history once. For every Dice job, ApplyFlow writes a new resume from it — choosing, ordering and rewording what fits that job, in an ATS-friendly layout. It only uses what you enter here.
      </p>

      <section className="card stack-sm" aria-labelledby="b-contact">
        <h2 className="section-title" id="b-contact">
          <Icon name="user" /> Contact details
        </h2>
        <p className="hint">Saved to your Profile and placed at the top of every resume.</p>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="b-name">Full name</label>
            <input id="b-name" className="input" autoComplete="name" value={contact.fullName} onChange={(e) => setContact({ ...contact, fullName: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="b-loc">City and state</label>
            <input id="b-loc" className="input" placeholder="St. Petersburg, FL" value={contact.location} onChange={(e) => setContact({ ...contact, location: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="b-phone">Phone</label>
            <input id="b-phone" className="input" type="tel" autoComplete="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="b-email">Email</label>
            <input id="b-email" className="input" type="email" autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="b-li">LinkedIn (optional)</label>
            <input id="b-li" className="input" value={contact.linkedinUrl} onChange={(e) => setContact({ ...contact, linkedinUrl: e.target.value })} />
          </div>
        </div>
      </section>

      <section className="card stack-sm" aria-labelledby="b-about">
        <h2 className="section-title" id="b-about">
          <Icon name="target" /> About you
        </h2>
        <div className="field">
          <label htmlFor="b-headline">Your usual job title</label>
          <input id="b-headline" className="input" placeholder="Senior Video Playback Engineer" value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="b-summary">A few sentences about you (optional)</label>
          <textarea id="b-summary" className="textarea" style={{ minHeight: 80 }} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
          <span className="hint">ApplyFlow writes a summary for each job from your history; anything you add here can be used too.</span>
        </div>
      </section>

      <section className="stack-sm" aria-labelledby="b-jobs">
        <div className="row-between">
          <h2 className="section-title" id="b-jobs">
            <Icon name="building" /> Work history
          </h2>
          <span className="small muted" role="status">
            {filled} job{filled === 1 ? '' : 's'}
            {years ? ` · about ${Math.floor(years)} year${Math.floor(years) === 1 ? '' : 's'} of experience` : ''}
          </span>
        </div>
        {form.jobs.map((j, i) => (
          <JobFields key={j.id} job={j} n={i + 1} canRemove={form.jobs.length > 1} onChange={(nj) => setJob(i, nj)} onRemove={() => setForm((f) => ({ ...f, jobs: f.jobs.filter((x) => x.id !== j.id) }))} />
        ))}
        <div>
          <button type="button" className="btn btn-sm" onClick={() => setForm((f) => ({ ...f, jobs: [...f.jobs, emptyJob()] }))}>
            <Icon name="plus" size={13} /> Add another job
          </button>
        </div>
      </section>

      <section className="stack-sm" aria-labelledby="b-edu">
        <h2 className="section-title" id="b-edu">
          <Icon name="doc" /> Education
        </h2>
        {form.education.map((ed, i) => (
          <EducationFields key={ed.id} ed={ed} canRemove={form.education.length > 1} onChange={(ne) => setEdu(i, ne)} onRemove={() => setForm((f) => ({ ...f, education: f.education.filter((x) => x.id !== ed.id) }))} />
        ))}
        <div>
          <button type="button" className="btn btn-sm" onClick={() => setForm((f) => ({ ...f, education: [...f.education, emptyEducation()] }))}>
            <Icon name="plus" size={13} /> Add education
          </button>
        </div>
      </section>

      <section className="card stack-sm" aria-labelledby="b-skills">
        <h2 className="section-title" id="b-skills">
          <Icon name="check" /> Skills
        </h2>
        <div className="field">
          <label htmlFor="b-skill-list">Skills you can talk about in an interview</label>
          <textarea id="b-skill-list" className="textarea" style={{ minHeight: 70 }} placeholder="HLS, MPEG-DASH, DRM, ExoPlayer, AVPlayer, Swift, Kotlin, AWS, Docker" value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} />
          <span className="hint">Separate with commas. Groups like “Languages: Swift, Kotlin” work too.</span>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="b-certs">Certifications (one per line, optional)</label>
            <textarea id="b-certs" className="textarea" style={{ minHeight: 60 }} value={form.certifications} onChange={(e) => setForm({ ...form, certifications: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="b-langs">Languages you speak (optional)</label>
            <input id="b-langs" className="input" placeholder="English, Japanese" value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })} />
          </div>
        </div>
      </section>

      {tried && (problems.length || contactMissing.length) ? (
        <WarningBanner tone="warning" title="A few details are missing" live>
          <ul className="bullets">
            {contactMissing.length ? <li>Contact details: add your {contactMissing.join(', ')}.</li> : null}
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </WarningBanner>
      ) : null}

      <div className="row builder-actions">
        <div className="field" style={{ minWidth: 200 }}>
          <label htmlFor="b-resume-name">Save as</label>
          <input id="b-resume-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? <span className="spinner" aria-hidden="true" /> : null}
          Save resume
        </button>
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
