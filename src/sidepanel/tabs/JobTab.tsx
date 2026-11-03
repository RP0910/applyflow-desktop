import { useState } from 'react';
import type { FieldConfidence, JobPosting } from '@/types';
import type { Workflow } from '../useWorkflow';
import { WarningBanner } from '@/components/WarningBanner';
import { JobDetailsEditor } from '@/components/JobDetailsEditor';
import { Icon } from '@/components/Icon';
import { formatDisplayDate } from '@/utils/dates';
import { jobKeyFor } from '@/utils/jobKey';

const REMOTE: Record<JobPosting['remoteStatus'], string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site', unknown: 'Not stated' };

function Conf({ c }: { c: FieldConfidence | undefined }) {
  if (!c || c === 'high') return null;
  return <span className={`chip ${c === 'missing' ? 'chip-red' : 'chip-amber'}`} style={{ marginLeft: 6 }}>{c === 'missing' ? 'Not found' : c === 'low' ? 'Check this' : 'Probably right'}</span>;
}

function List({ title, items, tone }: { title: string; items: string[]; tone?: 'warning' }) {
  if (!items.length) return null;
  return (
    <details className="card" open={tone === 'warning'}>
      <summary className="strong" style={{ cursor: 'pointer' }}>
        {title} <span className="muted">({items.length})</span>
      </summary>
      <ul className="bullets small">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </details>
  );
}

function blankJob(url: string): JobPosting {
  return {
    jobKey: jobKeyFor(url), platform: 'dice', jobId: null, url, applicationUrl: null, title: '', company: '', location: '', remoteStatus: 'unknown', salary: null, employmentType: null,
    contractDuration: null, datePosted: null, description: '', requiredSkills: [], preferredSkills: [], responsibilities: [], qualifications: [], benefits: [],
    educationRequirements: [], clearanceRequirements: [], workAuthorizationRequirements: [], sponsorshipLanguage: [], externalApply: false,
  };
}

export function JobTab({ wf }: { wf: Workflow }) {
  const [editing, setEditing] = useState(false);
  const s = wf.session;
  const supported = wf.page && (wf.page.pageType === 'job-detail' || wf.page.pageType === 'application');

  if (!s && !wf.extractionError) {
    return (
      <div className="empty">
        <strong>{wf.busy ? 'Looking for a job on this page…' : 'Open a Dice job to get started.'}</strong>
        <span>{supported ? 'ApplyFlow is reading this page.' : 'Go to any job on dice.com. ApplyFlow reads the job, compares it with your candidate details and prepares truthful documents.'}</span>
        {!wf.busy ? (
          <div>
            <button type="button" className="btn btn-sm" onClick={() => void wf.detect()}>
              <Icon name="refresh" size={14} /> Check this page again
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (editing && (s || wf.page)) {
    return (
      <JobDetailsEditor
        job={s?.job ?? blankJob(wf.page!.url)}
        onCancel={() => setEditing(false)}
        onSave={(job) => {
          void wf.editJob(job).then(() => setEditing(false));
        }}
      />
    );
  }

  return (
    <div className="stack">
      {wf.extractionError ? (
        <WarningBanner
          tone="critical"
          title="Job details could not be read safely"
          actions={
            <>
              <button type="button" className="btn btn-sm" onClick={() => void wf.detect()}>
                Retry detection
              </button>
              {s || wf.page ? (
                <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
                  Edit job details
                </button>
              ) : null}
            </>
          }
        >
          {wf.extractionError}
        </WarningBanner>
      ) : null}
      {s ? (
        <>
          {wf.duplicateApplied && wf.duplicates?.exact ? (
            <WarningBanner tone="warning" title="You already applied to this job">
              Recorded as “{wf.duplicates.exact.stage}” on {formatDisplayDate(wf.duplicates.exact.dateApplied ?? wf.duplicates.exact.datePrepared)}.
            </WarningBanner>
          ) : wf.duplicates?.similar.length ? (
            <WarningBanner tone="info" title="Similar application found">
              You have a record for “{wf.duplicates.similar[0]!.title}” at {wf.duplicates.similar[0]!.company} from {formatDisplayDate(wf.duplicates.similar[0]!.createdAt)}.
            </WarningBanner>
          ) : null}
          {s.extraction.uncertain && !s.jobConfirmed ? (
            <WarningBanner tone="warning" title="Some job information could not be verified. Please review the extracted content.">
              {s.extraction.warnings.length ? (
                <ul className="bullets">
                  {s.extraction.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              <label className="check" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={s.jobConfirmed} onChange={(e) => void wf.patchSession({ jobConfirmed: e.target.checked })} />
                I checked these details and they’re correct
              </label>
            </WarningBanner>
          ) : null}
          {s.job.externalApply ? <WarningBanner tone="info">This job is applied for on the employer’s site. ApplyFlow will prepare documents, but it can’t fill the employer’s form.</WarningBanner> : null}

          <section className="card" aria-labelledby="job-details">
            <div className="row-between" style={{ marginBottom: 8 }}>
              <h2 className="section-title" id="job-details">
                Extracted details
              </h2>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
                <Icon name="edit" size={14} /> Edit job details
              </button>
            </div>
            <dl className="kv">
              <dt>Title</dt>
              <dd>{s.job.title || '—'}<Conf c={s.extraction.confidence.title} /></dd>
              <dt>Company</dt>
              <dd>{s.job.company || '—'}<Conf c={s.extraction.confidence.company} /></dd>
              <dt>Location</dt>
              <dd>{s.job.location || '—'}<Conf c={s.extraction.confidence.location} /></dd>
              <dt>Arrangement</dt>
              <dd>{REMOTE[s.job.remoteStatus]}</dd>
              <dt>Salary</dt>
              <dd>{s.job.salary ?? 'Not listed'}</dd>
              <dt>Type</dt>
              <dd>{[s.job.employmentType, s.job.contractDuration].filter(Boolean).join(', ') || 'Not listed'}</dd>
              <dt>Posted</dt>
              <dd>{s.job.datePosted ? (/^\d{4}-\d{2}-\d{2}/.test(s.job.datePosted) ? formatDisplayDate(s.job.datePosted) : s.job.datePosted) : '—'}</dd>
              <dt>Job link</dt>
              <dd>
                <a href={s.job.url} target="_blank" rel="noreferrer noopener" className="wrap-anywhere">
                  {s.job.url.replace(/^https:\/\//, '')}
                </a>
              </dd>
            </dl>
            <p className="small muted" style={{ marginTop: 8 }}>
              Read from {s.extraction.sources.map((x) => x.replace('-', ' ')).join(', ') || 'the page'}.
            </p>
          </section>

          {s.job.clearanceRequirements.length || s.job.workAuthorizationRequirements.length || s.job.sponsorshipLanguage.length ? (
            <WarningBanner tone="warning" title="Requirements you’ll answer yourself">
              <ul className="bullets">
                {[...s.job.clearanceRequirements, ...s.job.workAuthorizationRequirements, ...s.job.sponsorshipLanguage]
                  .filter((x, i, arr) => arr.indexOf(x) === i)
                  .map((x) => (
                    <li key={x}>{x}</li>
                  ))}
              </ul>
            </WarningBanner>
          ) : null}

          <section className="card stack-sm">
            <h2 className="section-title">Skills in this posting</h2>
            <div className="row" style={{ gap: 6 }}>
              {s.job.requiredSkills.map((k) => (
                <span key={k} className="chip chip-blue">
                  {k}
                </span>
              ))}
              {s.job.preferredSkills.map((k) => (
                <span key={k} className="chip">
                  {k} <span className="sr-only">(preferred)</span>
                </span>
              ))}
            </div>
            <p className="small muted">Blue chips are required, outlined chips are preferred or mentioned.</p>
          </section>
          <List title="Responsibilities" items={s.job.responsibilities} />
          <List title="Qualifications" items={s.job.qualifications} />
          <List title="Education" items={s.job.educationRequirements} />
          <List title="Benefits" items={s.job.benefits} />
          <details className="card">
            <summary className="strong" style={{ cursor: 'pointer' }}>
              Full job description
            </summary>
            <p className="small pre" style={{ marginTop: 8 }}>
              {s.job.description || 'Not saved (see Privacy settings).'}
            </p>
          </details>
        </>
      ) : null}
    </div>
  );
}
