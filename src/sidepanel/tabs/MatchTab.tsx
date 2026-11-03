import { useState } from 'react';
import type { Workflow } from '../useWorkflow';
import type { LibraryController } from '@/hooks/useLibrary';
import type { Settings } from '@/types';
import { MatchScoreCard } from '@/components/MatchScoreCard';
import { SkillEvidenceList } from '@/components/SkillEvidenceList';
import { WarningBanner } from '@/components/WarningBanner';
import { ResumeStart } from '@/components/ResumeLibrary';
import { openWorkspace } from './OtherTabs';
import { ClaudeProvider } from '@/services/claude/provider';
import { ClaudeError } from '@/services/claude/errors';
import { getApiKey } from '@/storage/settingsStore';
import { jobForPrompt } from '@/services/workflow/engine';

function Tags({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="stack-sm">
      <h3 className="field-label">{title}</h3>
      <div className="row" style={{ gap: 6 }}>
        {items.map((x) => (
          <span key={x} className="chip">
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ResumePicker({ wf, lib }: { wf: Workflow; lib: LibraryController }) {
  if (lib.resumes.length < 2) return null;
  return (
    <div className="field">
      <label htmlFor="pick-resume">Candidate details</label>
      <select id="pick-resume" className="select" value={wf.master?.id ?? ''} onChange={(e) => void wf.selectResume(e.target.value)}>
        {lib.resumes.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
            {r.isDefault ? ' (default)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

export function MatchTab({ wf, lib, settings }: { wf: Workflow; lib: LibraryController; settings: Settings }) {
  const s = wf.session;
  const [explain, setExplain] = useState<{ text: string; tips: string[] } | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainErr, setExplainErr] = useState<string | null>(null);

  if (!s?.analysis) {
    return (
      <div className="stack">
        {!lib.resumes.length ? <ResumeStart lib={lib} compact onOpenForm={() => openWorkspace('library')} /> : null}
        <div className="empty">
          <strong>No match score yet.</strong>
          <span>It appears automatically once a job is open and your candidate details is added. Every point is explained.</span>
        </div>
      </div>
    );
  }
  const a = s.analysis;
  const canExplain = settings.engine === 'claude' && s.masterScore;
  return (
    <div className="stack">
      {!lib.resumes.length ? (
        <>
          <WarningBanner tone="info" title="Add your candidate details to see how you match">The job analysis below doesn’t need it, but the match score and tailoring do.</WarningBanner>
          <ResumeStart lib={lib} compact onOpenForm={() => openWorkspace('library')} />
        </>
      ) : (
        <ResumePicker wf={wf} lib={lib} />
      )}
      {a.risks.map((r) => (
        <WarningBanner key={r.id} tone={r.severity}>
          {r.message}
        </WarningBanner>
      ))}
      {s.tailoredScore ? <MatchScoreCard score={s.tailoredScore} title="Tailored resume" compareTo={s.masterScore} /> : null}
      {s.masterScore ? <MatchScoreCard score={s.masterScore} title={s.tailoredScore ? 'Candidate details' : 'Estimated match'} /> : null}
      {canExplain ? (
        <section className="card stack-sm">
          <div className="row-between">
            <h2 className="section-title">Plain-language explanation</h2>
            <button
              type="button"
              className="btn btn-sm"
              disabled={explaining}
              onClick={async () => {
                setExplaining(true);
                setExplainErr(null);
                try {
                  const p = new ClaudeProvider(await getApiKey(), settings);
                  const r = await p.explainMatchScore(s.masterScore, s.evidence.map((e) => ({ skill: e.skill, importance: e.importance, status: e.status })), jobForPrompt(s.job, false));
                  setExplain({ text: r.data.explanation, tips: r.data.improvements });
                } catch (e: unknown) {
                  setExplainErr(e instanceof ClaudeError ? e.userMessage : 'Could not get an explanation.');
                } finally {
                  setExplaining(false);
                }
              }}
            >
              {explaining ? <span className="spinner" aria-hidden="true" /> : null}
              Ask Claude to explain
            </button>
          </div>
          {explainErr ? <WarningBanner tone="warning">{explainErr}</WarningBanner> : null}
          {explain ? (
            <>
              <p className="small">{explain.text}</p>
              {explain.tips.length ? (
                <ul className="bullets small">
                  {explain.tips.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
      <section className="card" aria-labelledby="ev-title">
        <h2 className="section-title" id="ev-title" style={{ marginBottom: 8 }}>
          Skill evidence
        </h2>
        <SkillEvidenceList evidence={s.evidence} />
      </section>
      {a.missingQualifications.length ? (
        <WarningBanner tone="warning" title="Missing or unconfirmed qualifications">
          <ul className="bullets">
            {a.missingQualifications.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          These stay off your resume unless you add real evidence to your candidate details or confirm them in Verified Facts.
        </WarningBanner>
      ) : null}
      <section className="card stack">
        <h2 className="section-title">Job analysis</h2>
        <dl className="kv">
          <dt>Category</dt>
          <dd>{a.category}</dd>
          <dt>Seniority</dt>
          <dd style={{ textTransform: 'capitalize' }}>{a.seniority}</dd>
          <dt>Experience</dt>
          <dd>{a.requiredYears ? `${a.requiredYears}+ years requested` : 'Not stated'}</dd>
          <dt>Suggested title</dt>
          <dd>{a.suggestedResumeTitle}</dd>
          <dt>Direction</dt>
          <dd>{a.summaryDirection}</dd>
          <dt>Analyzed by</dt>
          <dd>{a.engine === 'claude' ? `Claude (${a.model})` : 'Local engine'}</dd>
        </dl>
        <Tags title="Tools and technologies" items={a.tools} />
        <Tags title="Industry terms" items={a.industryTerms} />
        <Tags title="Soft skills" items={a.softSkills} />
        <Tags title="Resume keywords (used only where supported)" items={a.resumeKeywords} />
        {a.expectedOutcomes.length ? (
          <div>
            <h3 className="field-label">Expected outcomes</h3>
            <ul className="bullets small">
              {a.expectedOutcomes.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {a.screeningQuestions.length ? (
          <div>
            <h3 className="field-label">Likely screening questions</h3>
            <ul className="bullets small">
              {a.screeningQuestions.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
