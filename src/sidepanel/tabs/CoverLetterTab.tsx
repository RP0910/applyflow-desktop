import type { Workflow } from '../useWorkflow';
import { CoverLetterEditor } from '@/components/CoverLetterEditor';

export function CoverLetterTab({ wf }: { wf: Workflow }) {
  const s = wf.session;
  if (!s?.resume) {
    return (
      <div className="empty">
        <strong>No cover letter yet.</strong>
        <span>It’s written together with your tailored resume when you press “Tailor &amp; Apply”, from the same confirmed facts.</span>
      </div>
    );
  }
  return (
    <div className="stack">
      <label className="switch">
        <input type="checkbox" checked={s.includeCoverLetter} onChange={(e) => void wf.patchSession({ includeCoverLetter: e.target.checked })} />
        Include a cover letter with this application
      </label>
      {s.includeCoverLetter ? (
        s.coverLetter ? (
          <CoverLetterEditor
            letter={s.coverLetter}
            tone={wf.tone}
            busy={wf.busy}
            onToneChange={(t) => void wf.coverLetterAction('regenerate', t)}
            onAction={(a) => void wf.coverLetterAction(a)}
            onSaveText={(t) => void wf.saveLetterText(t)}
          />
        ) : (
          <div className="empty">
            <strong>Cover letter not generated.</strong>
            <button type="button" className="btn btn-sm" onClick={() => void wf.coverLetterAction(null)} disabled={wf.busy}>
              Generate cover letter
            </button>
          </div>
        )
      ) : (
        <p className="small muted">No cover letter will be uploaded or saved for this application.</p>
      )}
    </div>
  );
}
