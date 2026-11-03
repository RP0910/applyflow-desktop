import { useEffect, useState } from 'react';
import type { CoverLetter, CoverLetterAction, CoverLetterTone } from '@/types';
import { wordCount } from '@/utils/text';
import { IssueList } from './IssueList';

const TONES: { id: CoverLetterTone; label: string }[] = [
  { id: 'professional', label: 'Professional' },
  { id: 'warm', label: 'Warm' },
  { id: 'direct', label: 'Direct' },
  { id: 'technical', label: 'Technical' },
  { id: 'startup', label: 'Startup-oriented' },
];

const ACTIONS: { id: CoverLetterAction; label: string }[] = [
  { id: 'regenerate', label: 'Regenerate' },
  { id: 'shorter', label: 'Make shorter' },
  { id: 'more_natural', label: 'Make more natural' },
  { id: 'more_technical', label: 'Make more technical' },
];

export function CoverLetterEditor({
  letter,
  tone,
  busy,
  onToneChange,
  onAction,
  onSaveText,
}: {
  letter: CoverLetter;
  tone: CoverLetterTone;
  busy: boolean;
  onToneChange: (t: CoverLetterTone) => void;
  onAction: (a: CoverLetterAction) => void;
  onSaveText: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(letter.text);
  useEffect(() => setDraft(letter.text), [letter.text]);
  const words = wordCount(editing ? draft : letter.text);
  const inRange = words >= 250 && words <= 400;
  return (
    <div className="stack">
      <div className="row-between">
        <div className="field" style={{ minWidth: 180 }}>
          <label htmlFor="cl-tone">Tone</label>
          <select id="cl-tone" className="select" value={tone} onChange={(e) => onToneChange(e.target.value as CoverLetterTone)} disabled={busy}>
            {TONES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <span className={`chip ${inRange ? 'chip-green' : 'chip-amber'}`}>
          {words} words{inRange ? '' : ' (target 250–400)'}
        </span>
      </div>
      <div className="row" role="group" aria-label="Revise the cover letter">
        {ACTIONS.map((a) => (
          <button key={a.id} type="button" className="btn btn-sm" onClick={() => onAction(a.id)} disabled={busy || editing}>
            {a.label}
          </button>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => setEditing((e) => !e)} disabled={busy} aria-pressed={editing}>
          Edit manually
        </button>
      </div>
      {editing ? (
        <div className="stack-sm">
          <label className="sr-only" htmlFor="cl-text">
            Cover letter text
          </label>
          <textarea id="cl-text" className="textarea" style={{ minHeight: 320 }} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="row">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                onSaveText(draft);
                setEditing(false);
              }}
            >
              Save and re-check
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setDraft(letter.text);
                setEditing(false);
              }}
            >
              Discard edits
            </button>
          </div>
        </div>
      ) : (
        <article className="paper pre" aria-label="Cover letter" style={{ fontSize: 13.5 }}>
          {letter.text}
        </article>
      )}
      <IssueList issues={letter.issues} />
      <p className="small muted">
        {letter.engine === 'claude' ? `Written by ${letter.model ?? 'Claude'} from your confirmed facts.` : 'Local draft built only from your own resume lines. Connect Claude in Settings for more natural writing.'} Version {letter.version}.
      </p>
    </div>
  );
}
