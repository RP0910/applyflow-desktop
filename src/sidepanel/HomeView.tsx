import { useState } from 'react';
import type { FieldProposal, MatchScore, Settings } from '@/types';
import type { LibraryController } from '@/hooks/useLibrary';
import type { Workflow } from './useWorkflow';
import type { AttachState, StageKey, StageState } from '@/services/workflow/applyRunner';
import { WarningBanner } from '@/components/WarningBanner';
import { ResumeStart } from '@/components/ResumeLibrary';
import { Icon, type IconName } from '@/components/Icon';
import { SENSITIVE_LABELS } from '@/services/forms/sensitive';
import { formatDisplayDate } from '@/utils/dates';
import { assessParse } from '@/services/resume/parser';
import { openWorkspace } from './tabs/OtherTabs';
import { backToDiceSearch, bridge } from '@/platform/bridge';
import { AtsReportCard } from '@/components/AtsReportCard';

function ScoreBadge({ score, onOpen }: { score: MatchScore; onOpen: () => void }) {
  return (
    <button type="button" className="score-badge" onClick={onOpen} aria-label={`Estimated match ${score.total} out of 100. Show how it was calculated.`}>
      <span className="score-ring" style={{ ['--v' as string]: score.total }}>
        <b>{score.total}</b>
      </span>
      <small>Estimated match</small>
    </button>
  );
}

function RoundButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button type="button" className="round-btn" onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} size={18} />
    </button>
  );
}

function JobCard({ wf }: { wf: Workflow }) {
  const s = wf.session!;
  const score = s.tailoredScore ?? s.masterScore;
  const locked = wf.run.status !== 'idle' && wf.run.status !== 'submitted';
  const applying = wf.run.status !== 'idle' || wf.page?.pageType === 'application';
  const at = [s.job.company, s.job.location].filter(Boolean);
  return (
    <section className="card job-card" aria-labelledby="job-title">
      <div>
        <p className="eyebrow">{applying ? 'You’re applying for' : s.job.platform === 'jobright' ? 'Jobright job' : 'Dice job'}</p>
        <h1 className="job-title" id="job-title">
          {s.job.title || 'Untitled job'}
        </h1>
        {at.length ? (
          <p className="job-at">
            @ {s.job.company || 'Employer'}
            {s.job.location ? ` in ${s.job.location}` : ''}
          </p>
        ) : null}
      </div>
      {score ? <ScoreBadge score={score} onOpen={() => wf.setView('match')} /> : null}
      <div className="card-foot">
        <label className="switch">
          <input type="checkbox" checked={s.includeCoverLetter} disabled={locked} onChange={(e) => void wf.patchSession({ includeCoverLetter: e.target.checked })} />
          Cover letter
        </label>
        <button type="button" className="link small" onClick={() => wf.setView('match')}>
          Job details
        </button>
      </div>
    </section>
  );
}

const STAGES: { key: StageKey; label: string }[] = [
  { key: 'documents', label: 'Tailor resume & cover letter' },
  { key: 'open', label: 'Open the application' },
  { key: 'attach', label: 'Replace resume & attach cover letter' },
  { key: 'questions', label: 'Answer questions' },
  { key: 'review', label: 'Review and submit' },
];

function attachText(a: AttachState, what: string): string | null {
  switch (a.state) {
    case 'done':
      return `${what}: ${a.fileName}${a.byUser ? ' (attached by you)' : ''}`;
    case 'unverified':
      return `${what}: ${a.fileName} (check it on the page)`;
    case 'failed':
      return `${what}: not attached yet`;
    case 'skipped':
      return a.message ? `${what}: ${a.message.replace(/\.$/, '')}` : `${what}: not included`;
    case 'not_offered':
      return `${what}: the form didn’t ask for one`;
    default:
      return null;
  }
}

function Progress({ wf }: { wf: Workflow }) {
  const s = wf.session!;
  const r = wf.run;
  const stateOf = (k: StageKey): StageState => (k === 'documents' && s.resume && r.stages.documents === 'todo' ? 'done' : r.stages[k]);
  const finished = STAGES.filter(({ key }) => ['done', 'skipped'].includes(stateOf(key))).length;
  const current = Math.min(STAGES.length, finished + 1);
  const saved = wf.application?.files.filter((f) => f.kind === 'resume' && f.state === 'complete').length ? wf.application.folderPath : null;
  const detail = (k: StageKey) => {
    if (k === 'documents' && s.resume) {
      return (
        <>
          Resume v{s.resume.version} with {s.resume.experience.length} job{s.resume.experience.length === 1 ? '' : 's'}
          {s.includeCoverLetter && s.coverLetter ? `, cover letter (${s.coverLetter.wordCount} words)` : ''} ·{' '}
          <button type="button" className="link" onClick={() => wf.setView('documents')}>
            Preview
          </button>
          {saved ? (
            <>
              {' · '}
              <button type="button" className="link" onClick={() => void wf.openFolder()}>
                Saved to your ApplyFlow folder
              </button>
            </>
          ) : null}
        </>
      );
    }
    if (k === 'open' && r.step) return `On step ${r.step.current} of ${r.step.total}${wf.page?.siteName ? ` (${wf.page.siteName})` : ''}`;
    if (k === 'open' && wf.page?.siteName && wf.page.site !== 'dice' && wf.page.site !== 'jobright' && r.stages.open === 'done') return `On ${wf.page.siteName}`;
    if (k === 'attach') {
      const lines = [attachText(r.attachments.resume, 'Resume'), s.includeCoverLetter ? attachText(r.attachments.coverLetter, 'Cover letter') : null].filter(Boolean);
      return lines.length ? lines.join(' · ') : null;
    }
    return null;
  };
  return (
    <section className="card" aria-label="Application progress">
      <div className="dice-progress" role="progressbar" aria-label="Application progress" aria-valuemin={0} aria-valuemax={STAGES.length} aria-valuenow={finished}>
        <span style={{ width: `${Math.max(6, (finished / STAGES.length) * 100)}%` }} />
      </div>
      <p className="progress-caption">
        Step {current} of {STAGES.length}
        {r.status === 'working' && r.label ? ` · ${r.label}` : ''}
      </p>
      <ol className="timeline">
        {STAGES.map(({ key, label }) => {
          const st = stateOf(key);
          const d = detail(key);
          return (
            <li key={key} data-state={st}>
              <span className="t-dot" aria-hidden="true">
                {st === 'done' ? <Icon name="check" size={12} /> : st === 'error' ? '!' : st === 'active' && r.status === 'working' ? <span className="spinner" /> : null}
              </span>
              <div>
                <div className="t-label">
                  {label}
                  <span className="sr-only"> — {st === 'done' ? 'done' : st === 'active' ? 'in progress' : st === 'error' ? 'needs attention' : st === 'skipped' ? 'not needed' : 'to do'}</span>
                </div>
                {d ? <div className="t-detail">{d}</div> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function CopyPageDetails({ wf }: { wf: Workflow }) {
  const [state, setState] = useState<'idle' | 'copied' | 'shown'>('idle');
  const [text, setText] = useState('');
  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-quiet"
        onClick={async () => {
          const t = await wf.diagnose();
          setText(t);
          try {
            await navigator.clipboard.writeText(t);
            setState('copied');
          } catch {
            setState('shown');
          }
        }}
      >
        <Icon name="copy" size={13} /> {state === 'copied' ? 'Page details copied' : 'Copy page details'}
      </button>
      {state === 'shown' ? <textarea className="textarea small" readOnly value={text} aria-label="Page details" rows={6} /> : null}
    </>
  );
}

function ResumeNeeded({ wf }: { wf: Workflow }) {
  const r = wf.run;
  const rec = wf.application;
  const resumeFile = rec?.files.find((f) => f.kind === 'resume' && f.format === 'pdf' && f.state === 'complete') ?? rec?.files.find((f) => f.kind === 'resume' && f.state === 'complete');
  const onDice = !wf.page?.site || wf.page.site === 'dice';
  const site = wf.page?.siteName || 'the page';
  return (
    <section className="card stack-sm attention-card" aria-labelledby="resume-needed" role="status">
      <h2 className="card-title" id="resume-needed">
        <Icon name="alert" /> Attach your tailored resume
      </h2>
      {onDice ? (
        <p className="small">{r.attachments.resume.message ?? 'ApplyFlow couldn’t replace your resume on Dice automatically.'} ApplyFlow won’t continue while Dice still has {r.originalFiles.resume ? `“${r.originalFiles.resume}”` : 'your old resume'}.</p>
      ) : (
        <p className="small">{r.attachments.resume.message ?? `ApplyFlow couldn’t attach your resume on ${site} automatically.`} ApplyFlow won’t continue until the tailored resume is attached.</p>
      )}
      <ol className="steps-list small">
        {onDice ? (
          <li>On Dice’s <b>Resume</b> card, click <b>⋯</b> → <b>Replace</b>.</li>
        ) : (
          <li>On the page, use the resume field’s <b>Attach</b> / <b>Upload</b> button.</li>
        )}
        <li>
          Choose <b>{resumeFile ? resumeFile.relativePath.split('/').pop() : 'resume_tailored.pdf'}</b>
          {resumeFile ? (
            <>
              {' '}from <span className="wrap-anywhere">{resumeFile.absolutePath ?? resumeFile.relativePath}</span>
            </>
          ) : null}
          .
        </li>
        <li>Press <b>Continue</b> below.</li>
      </ol>
      <div className="row">
        {resumeFile ? (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => void wf.openFolder()}>
            <Icon name="folder" size={14} /> Show the file
          </button>
        ) : (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => void wf.downloadNow()}>
            <Icon name="download" size={14} /> Save it to your ApplyFlow folder
          </button>
        )}
        {onDice ? (
          <button type="button" className="btn btn-sm btn-quiet" onClick={wf.keepDiceResume}>
            Send the resume already on Dice
          </button>
        ) : null}
      </div>
      <CopyPageDetails wf={wf} />
    </section>
  );
}

function QuestionCard({ q, onAnswer }: { q: FieldProposal; onAnswer: (value: string) => void }) {
  const [text, setText] = useState(q.approvedSuggestion ?? '');
  const choices = q.options?.length ? q.options : null;
  return (
    <div className="q-card" data-sensitive={Boolean(q.sensitive)}>
      <div>
        <div className="q-label">
          {q.label}
          {q.required ? (
            <>
              {' '}
              <span className="req" aria-hidden="true">
                *
              </span>
              <span className="sr-only">(required)</span>
            </>
          ) : null}
        </div>
        {q.sensitive === 'legal_consent' ? (
          <div className="q-why">A statement you agree to for this application. ApplyFlow asks every time and never remembers it.</div>
        ) : q.sensitive ? (
          <div className="q-why">{SENSITIVE_LABELS[q.sensitive]} — ApplyFlow never guesses this; it’s your answer.</div>
        ) : null}
      </div>
      {choices ? (
        <div className="opts" role="group" aria-label={q.label}>
          {choices.map((o) => (
            <button key={o} type="button" className="opt" onClick={() => onAnswer(o)}>
              {o}
            </button>
          ))}
        </div>
      ) : q.control === 'checkbox' ? (
        <div className="opts">
          <button type="button" className="opt" onClick={() => onAnswer('checked')}>
            {q.sensitive === 'legal_consent' ? 'I agree' : 'Yes'}
          </button>
        </div>
      ) : (
        <form
          className="q-text"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onAnswer(text.trim());
          }}
        >
          {q.control === 'textarea' ? (
            <textarea className="textarea" aria-label={q.label} value={text} onChange={(e) => setText(e.target.value)} rows={3} />
          ) : (
            <input className="input" aria-label={q.label} value={text} onChange={(e) => setText(e.target.value)} />
          )}
          <button type="submit" className="btn btn-sm btn-primary" disabled={!text.trim()}>
            Use
          </button>
        </form>
      )}
    </div>
  );
}

function Questions({ wf }: { wf: Workflow }) {
  const [remember, setRemember] = useState(true);
  const r = wf.run;
  return (
    <section className="stack-sm" aria-labelledby="q-title">
      <div className="row-between">
        <h2 className="section-heading" id="q-title">
          {r.questions.length === 1 ? 'One question for you' : `${r.questions.length} questions for you`}
        </h2>
        <label className="switch small">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember answers
        </label>
      </div>
      {r.message ? <WarningBanner tone="warning">{wf.page?.siteName || 'The page'} says: {r.message}</WarningBanner> : null}
      {r.questions.map((q) => (
        <QuestionCard key={q.fieldId} q={q} onAnswer={(v) => void wf.answerQuestion(q, v, remember)} />
      ))}
      <p className="small muted">Tap an answer and ApplyFlow fills it on {wf.page?.siteName || 'the page'} and moves on. You can also answer on the page and press Continue.</p>
    </section>
  );
}

function Review({ wf }: { wf: Workflow }) {
  const s = wf.session!;
  const r = wf.run;
  const filled = s.fieldProposals.filter((p) => (p.status === 'filled' || p.status === 'user-completed') && p.action !== 'upload');
  const docCard = (a: AttachState, what: string, required: boolean) => {
    const status =
      a.state === 'done'
        ? { icon: 'check' as const, cls: 'ok', text: a.byUser ? 'Attached by you' : 'Tailored for this job' }
        : a.state === 'unverified'
          ? { icon: 'alert' as const, cls: 'warn', text: 'Attached — check it on the page' }
          : a.state === 'failed'
            ? { icon: 'stop' as const, cls: 'bad', text: 'Not attached' }
            : a.state === 'skipped'
              ? { icon: 'info' as const, cls: 'muted', text: a.message ?? 'Not included' }
              : { icon: 'info' as const, cls: 'muted', text: 'The form didn’t ask for one' };
    return (
      <div className="review-card">
        <div>
          <div className="review-title">
            {what}
            {required ? (
              <span className="req" aria-label="required">
                {' '}*
              </span>
            ) : null}
          </div>
          {a.fileName && a.state !== 'skipped' && a.state !== 'not_offered' ? <div className="review-value">{a.fileName}</div> : null}
          <div className={`review-status ${status.cls}`}>
            <Icon name={status.icon} size={13} /> {status.text}
          </div>
        </div>
        {a.fileName && (a.state === 'done' || a.state === 'unverified') && !a.byUser ? <RoundButton icon="eye" label={`Preview ${what.toLowerCase()}`} onClick={() => wf.setView('documents')} /> : null}
      </div>
    );
  };
  const unsupported = s.evidence.filter((e) => e.importance === 'required' && (e.status === 'none' || e.status === 'conflict')).map((e) => e.skill);
  return (
    <section className="stack-sm" aria-labelledby="review-title">
      <h2 className="section-heading" id="review-title">
        Ready to submit to {s.job.company || 'this employer'}
      </h2>
      <p className="small muted">Take a moment to review what will be sent. Once you submit, it can’t be undone.</p>
      {docCard(r.attachments.resume, 'Resume', true)}
      {s.includeCoverLetter ? docCard(r.attachments.coverLetter, 'Cover Letter', false) : null}
      <div className="review-card">
        <div>
          <div className="review-title">{filled.length ? `${filled.length} answer${filled.length > 1 ? 's' : ''} filled in` : 'No questions needed answers'}</div>
          {filled.length ? (
            <ul className="answers">
              {filled.slice(0, 10).map((p) => (
                <li key={p.fieldId}>
                  <b>{p.label}:</b> {p.proposedValue.length > 60 ? `${p.proposedValue.slice(0, 59)}…` : p.proposedValue}
                </li>
              ))}
              {filled.length > 10 ? <li>and {filled.length - 10} more</li> : null}
            </ul>
          ) : null}
          {r.optional.length ? (
            <div className="review-status muted">
              <Icon name="info" size={13} /> {r.optional.length} optional question{r.optional.length > 1 ? 's' : ''} left blank: {r.optional.map((q) => q.label).slice(0, 2).join(' · ')}
            </div>
          ) : null}
        </div>
      </div>
      {unsupported.length && s.resume?.contentSource !== 'cv-generate' ? (
        <p className="small muted">
          Not claimed on your resume: {unsupported.slice(0, 4).join(', ')} — the job asks for {unsupported.length > 1 ? 'them' : 'it'}, but your candidate details doesn’t show {unsupported.length > 1 ? 'them' : 'it'}.
        </p>
      ) : null}
    </section>
  );
}

function Submitted({ wf }: { wf: Workflow }) {
  const s = wf.session!;
  const rec = wf.application;
  const saved = rec?.files.filter((f) => f.state === 'complete').length ?? 0;
  return (
    <section className="card stack-sm" aria-live="polite">
      <div className="done-hero">
        <span className="tick">
          <Icon name="check" size={22} />
        </span>
        <h2 className="section-heading">Applied to {s.job.company || 'this job'}</h2>
        <p className="small muted">
          {wf.run.status !== 'submitted'
            ? `Recorded as applied${s.submittedAt ? ` on ${formatDisplayDate(s.submittedAt)}` : ''}.`
            : wf.run.submittedConfirmed
              ? `${wf.page?.siteName || 'The site'} confirmed your application.`
              : 'Check the page for the confirmation.'}
          {rec?.followUpDate ? ` Follow-up reminder on ${formatDisplayDate(rec.followUpDate)}.` : ''}
        </p>
        {saved ? <p className="small">Saved {saved} files to {rec?.folderPath}</p> : null}
      </div>
      {bridge() ? (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn-primary" onClick={() => void backToDiceSearch()}>
            <Icon name="search" size={14} /> Back to search results
          </button>
        </div>
      ) : null}
      <div className="row" style={{ justifyContent: 'center' }}>
        {saved ? (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => void wf.openFolder()}>
            <Icon name="folder" size={14} /> Show files
          </button>
        ) : (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => void wf.downloadNow()}>
            <Icon name="download" size={14} /> Save files
          </button>
        )}
        <button type="button" className="btn btn-sm btn-outline" onClick={() => openWorkspace('history')}>
          <Icon name="briefcase" size={14} /> Applications
        </button>
      </div>
    </section>
  );
}

export function HomeView({ wf, lib, settings, hasKey }: { wf: Workflow; lib: LibraryController; settings: Settings; hasKey: boolean }) {
  const s = wf.session;
  const r = wf.run;
  const supported = wf.page && (wf.page.pageType === 'job-detail' || wf.page.pageType === 'application');

  if (lib.loaded && !lib.resumes.length) {
    return (
      <div className="stack">
        <section className="card stack-sm">
          <h1 className="section-heading">Welcome to ApplyFlow</h1>
          <p className="small">Enter your contact details, employer names and dates. Claude writes the resume and cover letter using CV Generate.txt, then PDF Studio’s renderer creates the files. Tailor & Apply attaches the tailored resume and fills the application — on Dice, or on the employer’s site when you apply from Jobright (Greenhouse, Lever, Ashby; best effort elsewhere). You review and submit.</p>
        </section>
        <ResumeStart lib={lib} compact onOpenForm={() => openWorkspace('library')} />
        {!hasKey ? <p className="small muted">Add your Claude API key in Settings to enable AI resume generation.</p> : null}
      </div>
    );
  }

  if (!s) {
    return (
      <div className="stack">
        {wf.extractionError ? (
          <WarningBanner
            tone="warning"
            title="Couldn’t read this job"
            actions={
              <>
                <button type="button" className="btn btn-sm" onClick={() => void wf.detect()}>
                  Try again
                </button>
                {wf.page ? (
                  <button type="button" className="btn btn-sm" onClick={() => wf.setView('match')}>
                    Enter job details
                  </button>
                ) : null}
              </>
            }
          >
            {wf.extractionError}
          </WarningBanner>
        ) : (
          <div className="empty">
            <strong>{wf.busy ? 'Reading the job…' : 'Open a job on Dice or Jobright to get started.'}</strong>
            <span>{supported ? 'ApplyFlow is reading this page.' : 'Go to any job on dice.com. Your estimated match appears here right away.'}</span>
            {!wf.busy ? (
              <div>
                <button type="button" className="btn btn-sm" onClick={() => void wf.detect()}>
                  <Icon name="refresh" size={14} /> Check this page again
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  const showRun = r.status !== 'idle' || Boolean(s.resume);
  const merged = wf.master ? assessParse(wf.master.parsed).problems.some((p) => /merged/.test(p)) : false;
  return (
    <div className="stack">
      <JobCard wf={wf} />
      {wf.duplicateApplied && wf.duplicates?.exact && !s.duplicateAcknowledged ? (
        <WarningBanner tone="warning" title="You already applied to this job">
          Recorded as “{wf.duplicates.exact.stage}” on {formatDisplayDate(wf.duplicates.exact.dateApplied ?? wf.duplicates.exact.datePrepared)}.
        </WarningBanner>
      ) : null}
      {wf.master && merged ? (
        <WarningBanner
          tone="warning"
          title="Your resume may be missing a job"
          actions={
            <button type="button" className="btn btn-sm" onClick={() => openWorkspace('library')}>
              Open candidate setup
            </button>
          }
        >
          ApplyFlow found {wf.master.parsed.experience.length} job{wf.master.parsed.experience.length === 1 ? '' : 's'} in “{wf.master.name}”, but one of them seems to contain another job’s dates. Re-import the resume (the DOCX version reads most reliably) so every job appears in tailored resumes.
        </WarningBanner>
      ) : null}
      {s.extraction.uncertain && !s.jobConfirmed ? (
        <WarningBanner tone="info">
          Some job details may be incomplete.{' '}
          <button type="button" className="link" onClick={() => wf.setView('match')}>
            Check them
          </button>
        </WarningBanner>
      ) : null}
      {s.job.externalApply && r.status === 'idle' ? <WarningBanner tone="info">This job applies on the employer’s website. ApplyFlow tailors and saves your documents, then opens that site.</WarningBanner> : null}
      {(s.atsTailored ?? s.atsMaster) && !s.submittedAt && r.status !== 'questions' ? (
        <AtsReportCard report={(s.atsTailored ?? s.atsMaster)!} before={s.atsTailored ? s.atsMaster : null} busy={wf.busy} onConfirmSkills={(terms) => void wf.confirmSkills(terms, Boolean(s.resume))} onOptimize={s.resume && !s.submittedAt ? () => void wf.optimizeResume() : undefined} />
      ) : null}
      {r.status === 'attention' && r.need === 'resume' ? <ResumeNeeded wf={wf} /> : null}
      {r.status === 'attention' && r.need !== 'resume' && r.message ? (
        <WarningBanner tone="warning" title={r.label} live actions={/layout|can’t find|didn’t open/i.test(r.message) ? <CopyPageDetails wf={wf} /> : undefined}>
          {r.message}
        </WarningBanner>
      ) : null}
      {r.status === 'external' ? (
        <WarningBanner tone="info" title={r.label || 'Apply on the employer’s site'} live>
          {r.message}
          {/saved/i.test(r.message ?? '') ? '' : ' Your tailored resume and cover letter were saved to your ApplyFlow folder.'}
        </WarningBanner>
      ) : null}
      {r.status === 'submitted' || s.submittedAt ? <Submitted wf={wf} /> : null}
      {r.status === 'questions' ? <Questions wf={wf} /> : null}
      {r.status === 'ready' ? <Review wf={wf} /> : null}
      {showRun && r.status !== 'submitted' && !s.submittedAt ? <Progress wf={wf} /> : null}
      {r.status === 'ready' || r.status === 'attention' || r.status === 'external' ? (
        <p className="small muted">
          Submitted it yourself?{' '}
          <button type="button" className="link" onClick={() => void wf.recordManualSubmit()}>
            Record it as applied
          </button>
        </p>
      ) : null}
      {r.status === 'idle' && !s.submittedAt ? (
        <p className="small muted">
          {settings.engine === 'claude' && hasKey ? `Writing with Claude (${settings.model}).` : 'Add a Claude API key in Settings to generate documents.'} Employer names and dates stay fixed. Review AI-written claims before submitting.
        </p>
      ) : null}
    </div>
  );
}
