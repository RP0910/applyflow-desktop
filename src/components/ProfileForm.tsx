import { useEffect, useState } from 'react';
import type { ApprovedAnswer, CareerProfile, SensitiveCategory } from '@/types';
import { SENSITIVE_LABELS } from '@/services/forms/sensitive';
import { newId } from '@/utils/id';
import { nowIso } from '@/utils/dates';
import { WarningBanner } from './WarningBanner';

const list = (s: string) => s.split(/\s*[,\n]\s*/).map((x) => x.trim()).filter(Boolean);

export function ProfileForm({ profile, onSave }: { profile: CareerProfile; onSave: (p: CareerProfile) => void }) {
  const [p, setP] = useState(profile);
  const [ans, setAns] = useState<{ category: ApprovedAnswer['category']; pattern: string; answer: string }>({ category: 'work_authorization', pattern: '', answer: '' });
  useEffect(() => setP(profile), [profile]);
  const set = <K extends keyof CareerProfile>(k: K, v: CareerProfile[K]) => setP((x) => ({ ...x, [k]: v }));
  const text = (k: keyof CareerProfile, label: string, opts: { type?: string; hint?: string; area?: boolean } = {}) => (
    <div className="field">
      <label htmlFor={`pf-${String(k)}`}>{label}</label>
      {opts.area ? (
        <textarea id={`pf-${String(k)}`} className="textarea" value={String(p[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} />
      ) : (
        <input id={`pf-${String(k)}`} className="input" type={opts.type ?? 'text'} value={String(p[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} />
      )}
      {opts.hint ? <span className="hint">{opts.hint}</span> : null}
    </div>
  );
  const arr = (k: 'verifiedSkills' | 'preferredTitles' | 'preferredLocations' | 'portfolioLinks', label: string, hint: string) => (
    <div className="field">
      <label htmlFor={`pf-${k}`}>{label}</label>
      <textarea id={`pf-${k}`} className="textarea" style={{ minHeight: 60 }} value={p[k].join(', ')} onChange={(e) => set(k, list(e.target.value))} />
      <span className="hint">{hint}</span>
    </div>
  );
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(p);
      }}
    >
      <section className="card stack" aria-labelledby="pf-contact">
        <h2 className="section-title" id="pf-contact">
          Contact details
        </h2>
        <p className="section-sub">Used for form fields and added to documents locally. Never sent to Claude.</p>
        <div className="grid-2">
          {text('fullName', 'Full name')}
          {text('email', 'Email', { type: 'email' })}
          {text('phone', 'Phone', { type: 'tel' })}
          {text('location', 'Location', { hint: 'As it should appear on your resume, e.g. “Chicago, IL”.' })}
          {text('linkedinUrl', 'LinkedIn URL', { type: 'url' })}
          {text('githubUrl', 'GitHub URL', { type: 'url' })}
        </div>
        {arr('portfolioLinks', 'Portfolio links', 'Separate with commas.')}
      </section>
      <section className="card stack" aria-labelledby="pf-career">
        <h2 className="section-title" id="pf-career">
          Career profile
        </h2>
        {text('headline', 'Professional headline')}
        {text('professionalSummary', 'Professional summary', { area: true, hint: 'Used only if your master resume has no summary.' })}
        {arr('verifiedSkills', 'Verified skills', 'Skills you can demonstrate that aren’t in your resume. These count as confirmed, but ApplyFlow will still note when no resume bullet shows them.')}
        {arr('preferredTitles', 'Preferred job titles', 'Separate with commas.')}
        {arr('preferredLocations', 'Preferred locations', 'Separate with commas.')}
        <div className="grid-2">
          <div className="field">
            <label htmlFor="pf-remote">Remote preference</label>
            <select id="pf-remote" className="select" value={p.remotePreference} onChange={(e) => set('remotePreference', e.target.value as CareerProfile['remotePreference'])}>
              <option value="any">No preference</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </select>
          </div>
          {text('availability', 'Availability', { hint: 'e.g. “Two weeks’ notice”.' })}
          {text('salaryPreference', 'Salary preference (for your reference)', { hint: 'Never filled into forms automatically.' })}
          {text('workAuthorizationNote', 'Work authorization (for your reference)', { hint: 'Never sent to Claude or filled automatically.' })}
        </div>
      </section>
      <section className="card stack" aria-labelledby="pf-answers">
        <h2 className="section-title" id="pf-answers">
          Saved answers
        </h2>
        <WarningBanner tone="info">
          ApplyFlow never guesses answers. Answers you save here, or with “Remember answers” in the panel, are reused on similar screening questions across Greenhouse, Lever, Ashby, Jobvite and Dice (same kind of question, similar wording and matching options). Auto-filled answers appear in the review so you can edit them before you submit. Turn this off under Settings → Applying. Leave the question text empty to use an answer for every question of that kind.
        </WarningBanner>
        {p.approvedAnswers.length ? (
          <ul className="list-plain stack-sm">
            {p.approvedAnswers.map((a) => (
              <li key={a.id} className="row-between card" style={{ padding: '8px 10px' }}>
                <span className="small">
                  <strong>{a.category === 'general' ? 'General' : SENSITIVE_LABELS[a.category]}</strong>
                  {a.questionPattern ? ` (questions containing “${a.questionPattern}”)` : ''}: {a.answer}
                </span>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => set('approvedAnswers', p.approvedAnswers.filter((x) => x.id !== a.id))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No saved answers.</p>
        )}
        <div className="grid-2">
          <div className="field">
            <label htmlFor="pa-cat">Question type</label>
            <select id="pa-cat" className="select" value={ans.category} onChange={(e) => setAns((a) => ({ ...a, category: e.target.value as ApprovedAnswer['category'] }))}>
              {(Object.keys(SENSITIVE_LABELS) as SensitiveCategory[]).map((c) => (
                <option key={c} value={c}>
                  {SENSITIVE_LABELS[c]}
                </option>
              ))}
              <option value="general">General question</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="pa-pat">Only for questions containing (optional)</label>
            <input id="pa-pat" className="input" value={ans.pattern} onChange={(e) => setAns((a) => ({ ...a, pattern: e.target.value }))} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="pa-ans">Your answer</label>
          <input id="pa-ans" className="input" value={ans.answer} onChange={(e) => setAns((a) => ({ ...a, answer: e.target.value }))} />
        </div>
        <div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!ans.answer.trim()}
            onClick={() => {
              set('approvedAnswers', [...p.approvedAnswers, { id: newId('ans'), category: ans.category, questionPattern: ans.pattern.trim(), answer: ans.answer.trim(), approvedAt: nowIso() }]);
              setAns((a) => ({ ...a, pattern: '', answer: '' }));
            }}
          >
            Add approved answer
          </button>
        </div>
      </section>
      <div>
        <button type="submit" className="btn btn-primary">
          Save profile
        </button>
      </div>
    </form>
  );
}
