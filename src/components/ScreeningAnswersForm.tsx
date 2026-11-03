import { useEffect, useMemo, useState } from 'react';
import type { ApprovedAnswer, CareerProfile, ScreeningControl, SensitiveCategory } from '@/types';
import { SENSITIVE_LABELS } from '@/services/forms/sensitive';
import { rememberAnswer } from '@/services/forms/mapper';
import {
  SCREENING_CATALOG,
  SCREENING_CONTROL_LABELS,
  SCREENING_GROUP_LABELS,
  catalogGroups,
  savedForCatalog,
  type ScreeningCatalogGroup,
  type ScreeningCatalogQuestion,
} from '@/services/forms/screeningCatalog';
import { newId } from '@/utils/id';
import { nowIso } from '@/utils/dates';
import { WarningBanner } from './WarningBanner';

type Tab = 'common' | 'saved' | 'custom';

const CONTROL_OPTIONS: ScreeningControl[] = ['text', 'textarea', 'select', 'combobox', 'radio', 'checkbox'];

const CATEGORY_OPTIONS: { value: ApprovedAnswer['category']; label: string }[] = [
  { value: 'general', label: 'General question' },
  ...(Object.keys(SENSITIVE_LABELS) as SensitiveCategory[]).map((c) => ({ value: c, label: SENSITIVE_LABELS[c] })),
];

function categoryLabel(c: ApprovedAnswer['category']): string {
  return c === 'general' ? 'General' : SENSITIVE_LABELS[c];
}

function parseOptions(raw: string): string[] {
  return raw
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function AnswerInput({
  id,
  control,
  options,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  control: ScreeningControl;
  options?: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  if (control === 'checkbox') {
    return (
      <label className="check">
        <input id={id} type="checkbox" checked={value === 'checked' || /^yes$/i.test(value)} onChange={(e) => onChange(e.target.checked ? 'checked' : '')} />
        <span>Checked / agreed</span>
      </label>
    );
  }
  if ((control === 'radio' || control === 'select' || control === 'combobox') && options?.length) {
    return (
      <div className="stack-sm">
        <select id={id} className="select" value={options.includes(value) ? value : ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select an answer…</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {control === 'combobox' || !options.includes(value) ? (
          <input
            className="input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder ?? 'Or type a custom answer'}
            aria-label="Custom answer"
          />
        ) : null}
      </div>
    );
  }
  if (control === 'textarea') {
    return <textarea id={id} className="textarea" rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
  }
  return <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

function CatalogCard({
  q,
  existing,
  onSave,
}: {
  q: ScreeningCatalogQuestion;
  existing?: ApprovedAnswer;
  onSave: (answer: string, opts?: { options?: string[] }) => void;
}) {
  const [value, setValue] = useState(existing?.answer ?? '');
  const [optsText, setOptsText] = useState((existing?.options ?? q.options ?? []).join('\n'));
  useEffect(() => {
    setValue(existing?.answer ?? '');
    setOptsText((existing?.options ?? q.options ?? []).join('\n'));
  }, [existing?.id, existing?.answer, q.id, q.options]);

  const choice = q.control === 'select' || q.control === 'combobox' || q.control === 'radio';
  const options = parseOptions(optsText);

  return (
    <li className="card stack-sm sq-item" style={{ padding: '12px 14px' }}>
      <div className="row-between">
        <div className="stack-sm" style={{ gap: 4 }}>
          <div className="row" style={{ gap: 6 }}>
            <span className={`chip ${existing ? 'chip-green' : 'chip-blue'}`}>{existing ? 'Answered' : 'Unanswered'}</span>
            <span className="chip">{SCREENING_CONTROL_LABELS[q.control]}</span>
            <span className="chip">{categoryLabel(q.category)}</span>
          </div>
          <strong style={{ fontSize: 14 }}>{q.prompt}</strong>
          {q.hint ? <p className="small muted" style={{ margin: 0 }}>{q.hint}</p> : null}
          {q.aliases.length ? (
            <p className="small muted" style={{ margin: 0 }}>
              Also matches: {q.aliases.slice(0, 3).join(' · ')}
              {q.aliases.length > 3 ? ` · +${q.aliases.length - 3} more` : ''}
            </p>
          ) : null}
        </div>
      </div>
      <div className="field">
        <label htmlFor={`cat-ans-${q.id}`}>Your answer</label>
        <AnswerInput id={`cat-ans-${q.id}`} control={q.control} options={options.length ? options : q.options} value={value} onChange={setValue} placeholder="Type or select your answer" />
      </div>
      {choice ? (
        <div className="field">
          <label htmlFor={`cat-opts-${q.id}`}>Choice options (one per line — edit if a site uses different labels)</label>
          <textarea id={`cat-opts-${q.id}`} className="textarea" rows={3} value={optsText} onChange={(e) => setOptsText(e.target.value)} />
        </div>
      ) : null}
      <div className="row">
        <button type="button" className="btn btn-primary btn-sm" disabled={!value.trim()} onClick={() => onSave(value.trim(), { options: choice ? options : undefined })}>
          {existing ? 'Update answer' : 'Save answer'}
        </button>
        {existing ? <span className="small muted">Saved locally · used {(existing.useCount ?? 0)}×</span> : null}
      </div>
    </li>
  );
}

function SavedCard({
  a,
  onChange,
  onRemove,
}: {
  a: ApprovedAnswer;
  onChange: (next: ApprovedAnswer) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(a);
  useEffect(() => setDraft(a), [a]);
  const dirty =
    draft.questionPattern !== a.questionPattern ||
    draft.answer !== a.answer ||
    draft.category !== a.category ||
    draft.control !== a.control ||
    (draft.aliases ?? []).join('\n') !== (a.aliases ?? []).join('\n') ||
    (draft.options ?? []).join('\n') !== (a.options ?? []).join('\n');

  const control = draft.control ?? 'text';
  const choice = control === 'select' || control === 'combobox' || control === 'radio';

  return (
    <li className="card stack-sm sq-item" style={{ padding: '12px 14px' }}>
      <div className="row-between">
        <div className="row" style={{ gap: 6 }}>
          <span className="chip chip-blue">{categoryLabel(a.category)}</span>
          <span className="chip">{SCREENING_CONTROL_LABELS[control]}</span>
          {a.useCount ? <span className="chip">used {a.useCount}×</span> : null}
          {a.lastUsedAt ? <span className="small muted">last {a.lastUsedAt.slice(0, 10)}</span> : null}
        </div>
        <button type="button" className="btn btn-sm btn-danger" onClick={onRemove}>
          Remove
        </button>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor={`sv-cat-${a.id}`}>Category</label>
          <select
            id={`sv-cat-${a.id}`}
            className="select"
            value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as ApprovedAnswer['category'] }))}
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`sv-ctrl-${a.id}`}>Input type</label>
          <select
            id={`sv-ctrl-${a.id}`}
            className="select"
            value={control}
            onChange={(e) => setDraft((d) => ({ ...d, control: e.target.value as ScreeningControl }))}
          >
            {CONTROL_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {SCREENING_CONTROL_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`sv-pat-${a.id}`}>Question text or keywords</label>
        <input
          id={`sv-pat-${a.id}`}
          className="input"
          value={draft.questionPattern}
          onChange={(e) => setDraft((d) => ({ ...d, questionPattern: e.target.value }))}
          placeholder="How did you hear about us?"
        />
      </div>
      <div className="field">
        <label htmlFor={`sv-alias-${a.id}`}>Similar wordings (one per line)</label>
        <textarea
          id={`sv-alias-${a.id}`}
          className="textarea"
          rows={2}
          value={(draft.aliases ?? []).join('\n')}
          onChange={(e) => setDraft((d) => ({ ...d, aliases: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) }))}
          placeholder="How did you learn about this role?"
        />
      </div>
      {choice ? (
        <div className="field">
          <label htmlFor={`sv-opts-${a.id}`}>Options (one per line)</label>
          <textarea
            id={`sv-opts-${a.id}`}
            className="textarea"
            rows={3}
            value={(draft.options ?? []).join('\n')}
            onChange={(e) => setDraft((d) => ({ ...d, options: parseOptions(e.target.value) }))}
          />
        </div>
      ) : null}
      <div className="field">
        <label htmlFor={`sv-ans-${a.id}`}>Your answer</label>
        <AnswerInput
          id={`sv-ans-${a.id}`}
          control={control}
          options={draft.options}
          value={draft.answer}
          onChange={(v) => setDraft((d) => ({ ...d, answer: v }))}
        />
      </div>
      {dirty ? (
        <div className="row">
          <button type="button" className="btn btn-primary btn-sm" disabled={!draft.answer.trim()} onClick={() => onChange({ ...draft, answer: draft.answer.trim(), questionPattern: draft.questionPattern.trim() })}>
            Save changes
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setDraft(a)}>
            Discard
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function ScreeningAnswersForm({ profile, onSave }: { profile: CareerProfile; onSave: (p: CareerProfile) => void }) {
  const [answers, setAnswers] = useState(profile.approvedAnswers);
  const [tab, setTab] = useState<Tab>('common');
  const [filter, setFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState<ScreeningCatalogGroup | 'all'>('all');
  const [savedFilter, setSavedFilter] = useState('');
  const [showAnswered, setShowAnswered] = useState(true);
  const [custom, setCustom] = useState<{
    category: ApprovedAnswer['category'];
    control: ScreeningControl;
    pattern: string;
    aliases: string;
    options: string;
    answer: string;
  }>({
    category: 'general',
    control: 'text',
    pattern: '',
    aliases: '',
    options: '',
    answer: '',
  });

  useEffect(() => setAnswers(profile.approvedAnswers), [profile]);

  const persist = (next: ApprovedAnswer[]) => {
    setAnswers(next);
    onSave({ ...profile, approvedAnswers: next });
  };

  const upsert = (partial: Omit<ApprovedAnswer, 'id' | 'approvedAt'> & { id?: string; approvedAt?: string }) => {
    persist(rememberAnswer(answers, partial, () => newId('ans'), nowIso()));
  };

  const catalogStats = useMemo(() => {
    let answered = 0;
    for (const q of SCREENING_CATALOG) if (savedForCatalog(answers, q)) answered++;
    return { answered, total: SCREENING_CATALOG.length };
  }, [answers]);

  const groups = catalogGroups();

  const catalogShown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return SCREENING_CATALOG.filter((item) => {
      if (groupFilter !== 'all' && item.group !== groupFilter) return false;
      const existing = savedForCatalog(answers, item);
      if (!showAnswered && existing) return false;
      if (!q) return true;
      const blob = `${item.prompt} ${item.aliases.join(' ')} ${item.category} ${item.hint ?? ''}`.toLowerCase();
      return blob.includes(q);
    });
  }, [answers, filter, groupFilter, showAnswered]);

  const savedShown = useMemo(() => {
    const q = savedFilter.trim().toLowerCase();
    if (!q) return answers;
    return answers.filter((a) => `${a.questionPattern} ${(a.aliases ?? []).join(' ')} ${a.answer} ${a.category} ${a.control ?? ''}`.toLowerCase().includes(q));
  }, [answers, savedFilter]);

  const customChoice = custom.control === 'select' || custom.control === 'combobox' || custom.control === 'radio';

  return (
    <div className="stack sq-page">
      <section className="card stack" aria-labelledby="sq-overview">
        <h2 className="section-title" id="sq-overview">
          Screening questions &amp; answers
        </h2>
        <WarningBanner tone="info">
          Answers you save here — or with “Remember answers” while applying — stay in your local database. When a similar question appears on another site, ApplyFlow matches it with conventional text matching (no AI) and fills the right control. ApplyFlow never invents answers.
        </WarningBanner>
        <div className="row-between sq-progress">
          <p className="small" style={{ margin: 0 }}>
            <strong>{catalogStats.answered}</strong> of <strong>{catalogStats.total}</strong> common questions answered · <strong>{answers.length}</strong> saved in your database
          </p>
          <div className="segmented" role="tablist" aria-label="Screening Q&A sections">
            <button type="button" role="tab" aria-selected={tab === 'common'} aria-pressed={tab === 'common'} onClick={() => setTab('common')}>
              Common questions
            </button>
            <button type="button" role="tab" aria-selected={tab === 'saved'} aria-pressed={tab === 'saved'} onClick={() => setTab('saved')}>
              Saved ({answers.length})
            </button>
            <button type="button" role="tab" aria-selected={tab === 'custom'} aria-pressed={tab === 'custom'} onClick={() => setTab('custom')}>
              Add custom
            </button>
          </div>
        </div>
      </section>

      {tab === 'common' ? (
        <section className="card stack" aria-labelledby="sq-common">
          <div>
            <h2 className="section-title" id="sq-common">
              Review common screening questions
            </h2>
            <p className="section-sub">
              Collected from typical Greenhouse, Lever, Ashby, Workday and job-board applications. Answer the ones that apply to you; similar wording on later forms will reuse these answers.
            </p>
          </div>
          <div className="field">
            <label htmlFor="sq-filter">Search questions</label>
            <input id="sq-filter" className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. sponsorship, hear about, salary" />
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className={`chip chip-toggle${groupFilter === 'all' ? ' chip-blue' : ''}`} aria-pressed={groupFilter === 'all'} onClick={() => setGroupFilter('all')}>
              All categories
            </button>
            {groups.map((g) => (
              <button key={g} type="button" className={`chip chip-toggle${groupFilter === g ? ' chip-blue' : ''}`} aria-pressed={groupFilter === g} onClick={() => setGroupFilter(g)}>
                {SCREENING_GROUP_LABELS[g]}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={showAnswered} onChange={(e) => setShowAnswered(e.target.checked)} />
            <span>Show questions I already answered</span>
          </label>
          {catalogShown.length ? (
            <ul className="list-plain stack">
              {catalogShown.map((q) => (
                <CatalogCard
                  key={q.id}
                  q={q}
                  existing={savedForCatalog(answers, q)}
                  onSave={(answer, opts) =>
                    upsert({
                      category: q.category,
                      questionPattern: q.prompt,
                      answer,
                      control: q.control,
                      options: opts?.options ?? q.options,
                      aliases: q.aliases,
                      catalogId: q.id,
                      useCount: savedForCatalog(answers, q)?.useCount ?? 0,
                      lastUsedAt: savedForCatalog(answers, q)?.lastUsedAt,
                    })
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="small muted">No questions match this filter. Clear search or show answered items.</p>
          )}
        </section>
      ) : null}

      {tab === 'saved' ? (
        <section className="card stack" aria-labelledby="sq-saved">
          <div>
            <h2 className="section-title" id="sq-saved">
              Your saved answers
            </h2>
            <p className="section-sub">Edit question wording, input type, choice options, and aliases so matching stays accurate across sites.</p>
          </div>
          <div className="field">
            <label htmlFor="sq-saved-filter">Search saved answers</label>
            <input id="sq-saved-filter" className="input" value={savedFilter} onChange={(e) => setSavedFilter(e.target.value)} placeholder="e.g. hear about us" />
          </div>
          {savedShown.length ? (
            <ul className="list-plain stack">
              {savedShown.map((a) => (
                <SavedCard
                  key={a.id}
                  a={a}
                  onRemove={() => persist(answers.filter((x) => x.id !== a.id))}
                  onChange={(next) => {
                    const without = answers.filter((x) => x.id !== a.id);
                    persist(
                      rememberAnswer(
                        without,
                        {
                          ...next,
                          id: a.id,
                          approvedAt: a.approvedAt,
                          useCount: a.useCount,
                          lastUsedAt: a.lastUsedAt,
                        },
                        () => a.id,
                        nowIso(),
                      ),
                    );
                  }}
                />
              ))}
            </ul>
          ) : (
            <p className="small muted">
              {answers.length ? 'No answers match your search.' : 'No screening answers saved yet. Review common questions, add a custom answer, or answer while applying with “Remember answers”.'}
            </p>
          )}
        </section>
      ) : null}

      {tab === 'custom' ? (
        <section className="card stack" aria-labelledby="sq-add">
          <div>
            <h2 className="section-title" id="sq-add">
              Add a custom answer
            </h2>
            <p className="section-sub">For questions that are not in the common list. Include alternate wordings so similar phrasing still matches.</p>
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="sq-cat">Category</label>
              <select id="sq-cat" className="select" value={custom.category} onChange={(e) => setCustom((c) => ({ ...c, category: e.target.value as ApprovedAnswer['category'] }))}>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sq-ctrl">Input type</label>
              <select id="sq-ctrl" className="select" value={custom.control} onChange={(e) => setCustom((c) => ({ ...c, control: e.target.value as ScreeningControl }))}>
                {CONTROL_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {SCREENING_CONTROL_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="sq-pat">Question text or keywords</label>
            <input id="sq-pat" className="input" value={custom.pattern} onChange={(e) => setCustom((c) => ({ ...c, pattern: e.target.value }))} placeholder="How did you hear about us?" />
          </div>
          <div className="field">
            <label htmlFor="sq-alias">Similar wordings (one per line, optional)</label>
            <textarea id="sq-alias" className="textarea" rows={2} value={custom.aliases} onChange={(e) => setCustom((c) => ({ ...c, aliases: e.target.value }))} placeholder={"How did you learn about this role?\nWhere did you find this job?"} />
          </div>
          {customChoice ? (
            <div className="field">
              <label htmlFor="sq-opts">Choice options (one per line)</label>
              <textarea id="sq-opts" className="textarea" rows={3} value={custom.options} onChange={(e) => setCustom((c) => ({ ...c, options: e.target.value }))} placeholder={'Yes\nNo'} />
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="sq-ans">Your answer</label>
            <AnswerInput
              id="sq-ans"
              control={custom.control}
              options={customChoice ? parseOptions(custom.options) : undefined}
              value={custom.answer}
              onChange={(v) => setCustom((c) => ({ ...c, answer: v }))}
              placeholder="Indeed"
            />
          </div>
          <div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!custom.answer.trim()}
              onClick={() => {
                upsert({
                  category: custom.category,
                  questionPattern: custom.pattern.trim(),
                  answer: custom.answer.trim(),
                  control: custom.control,
                  options: customChoice ? parseOptions(custom.options) : undefined,
                  aliases: custom.aliases
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                });
                setCustom((c) => ({ ...c, pattern: '', aliases: '', options: customChoice ? c.options : '', answer: '' }));
                setTab('saved');
              }}
            >
              Save answer
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
