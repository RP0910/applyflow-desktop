import { useEffect, useMemo, useState } from 'react';
import type { ApprovedAnswer, CareerProfile, SensitiveCategory } from '@/types';
import { SENSITIVE_LABELS } from '@/services/forms/sensitive';
import { newId } from '@/utils/id';
import { nowIso } from '@/utils/dates';
import { WarningBanner } from './WarningBanner';

export function ScreeningAnswersForm({ profile, onSave }: { profile: CareerProfile; onSave: (p: CareerProfile) => void }) {
  const [answers, setAnswers] = useState(profile.approvedAnswers);
  const [filter, setFilter] = useState('');
  const [ans, setAns] = useState<{ category: ApprovedAnswer['category']; pattern: string; answer: string }>({
    category: 'general',
    pattern: '',
    answer: '',
  });
  useEffect(() => setAnswers(profile.approvedAnswers), [profile]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return answers;
    return answers.filter((a) => `${a.questionPattern} ${a.answer} ${a.category}`.toLowerCase().includes(q));
  }, [answers, filter]);

  const persist = (next: ApprovedAnswer[]) => {
    setAnswers(next);
    onSave({ ...profile, approvedAnswers: next });
  };

  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="sq-title">
        <h2 className="section-title" id="sq-title">
          Screening questions &amp; answers
        </h2>
        <WarningBanner tone="info">
          Every answer you approve here — or with “Remember answers” while applying — is stored in your local database and reused when a similar question appears on another application (for example “How did you hear about us?” → “Indeed”). ApplyFlow never invents answers.
        </WarningBanner>
        <div className="field">
          <label htmlFor="sq-filter">Search saved answers</label>
          <input id="sq-filter" className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. hear about us" />
        </div>
        {shown.length ? (
          <ul className="list-plain stack-sm">
            {shown.map((a) => (
              <li key={a.id} className="card stack-sm" style={{ padding: '10px 12px' }}>
                <div className="row-between">
                  <span className="small">
                    <strong>{a.category === 'general' ? 'General' : SENSITIVE_LABELS[a.category]}</strong>
                    {a.useCount ? ` · used ${a.useCount}×` : ''}
                    {a.lastUsedAt ? ` · last ${a.lastUsedAt.slice(0, 10)}` : ''}
                  </span>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => persist(answers.filter((x) => x.id !== a.id))}>
                    Remove
                  </button>
                </div>
                <label className="field">
                  <span>Question (or keywords)</span>
                  <input
                    className="input"
                    value={a.questionPattern}
                    onChange={(e) => setAnswers((all) => all.map((x) => (x.id === a.id ? { ...x, questionPattern: e.target.value } : x)))}
                    onBlur={() => persist(answers)}
                    placeholder="How did you hear about us?"
                  />
                </label>
                <label className="field">
                  <span>Your answer</span>
                  <input
                    className="input"
                    value={a.answer}
                    onChange={(e) => setAnswers((all) => all.map((x) => (x.id === a.id ? { ...x, answer: e.target.value } : x)))}
                    onBlur={() => persist(answers)}
                  />
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">{answers.length ? 'No answers match your search.' : 'No screening answers saved yet. They appear here after you answer questions while applying, or add one below.'}</p>
        )}
      </section>

      <section className="card stack" aria-labelledby="sq-add">
        <h2 className="section-title" id="sq-add">
          Add an answer
        </h2>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="sq-cat">Question type</label>
            <select id="sq-cat" className="select" value={ans.category} onChange={(e) => setAns((a) => ({ ...a, category: e.target.value as ApprovedAnswer['category'] }))}>
              <option value="general">General question</option>
              {(Object.keys(SENSITIVE_LABELS) as SensitiveCategory[]).map((c) => (
                <option key={c} value={c}>
                  {SENSITIVE_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sq-pat">Question text or keywords</label>
            <input id="sq-pat" className="input" value={ans.pattern} onChange={(e) => setAns((a) => ({ ...a, pattern: e.target.value }))} placeholder="How did you hear about us?" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="sq-ans">Your answer</label>
          <input id="sq-ans" className="input" value={ans.answer} onChange={(e) => setAns((a) => ({ ...a, answer: e.target.value }))} placeholder="Indeed" />
        </div>
        <div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ans.answer.trim()}
            onClick={() => {
              persist([
                ...answers,
                {
                  id: newId('ans'),
                  category: ans.category,
                  questionPattern: ans.pattern.trim(),
                  answer: ans.answer.trim(),
                  approvedAt: nowIso(),
                },
              ]);
              setAns((a) => ({ ...a, pattern: '', answer: '' }));
            }}
          >
            Save answer
          </button>
        </div>
      </section>
    </div>
  );
}
