import type { EvidenceStatus, SkillEvidence } from '@/types';

const GROUPS: { status: EvidenceStatus; title: string; marker: string }[] = [
  { status: 'conflict', title: 'Conflicting information', marker: 'marker-conflict' },
  { status: 'needs_confirmation', title: 'Requires your confirmation', marker: 'marker-needs' },
  { status: 'none', title: 'No evidence in your resume', marker: 'marker-none' },
  { status: 'partial', title: 'Partial evidence', marker: 'marker-partial' },
  { status: 'strong', title: 'Strong evidence', marker: 'marker-strong' },
];

export function SkillEvidenceList({ evidence }: { evidence: SkillEvidence[] }) {
  if (!evidence.length) return <p className="muted">Add a master resume to compare your experience with this job.</p>;
  return (
    <div>
      {GROUPS.map((g) => {
        const items = evidence.filter((e) => e.status === g.status);
        if (!items.length) return null;
        return (
          <section key={g.status} className="evidence-group" aria-label={`${g.title}: ${items.length}`}>
            <h4>
              <span className={`marker ${g.marker}`} aria-hidden="true" />
              {g.title} <span className="muted">({items.length})</span>
            </h4>
            <ul className="list-plain">
              {items.map((e) => (
                <li key={e.skill} className="evidence-item">
                  <details>
                    <summary>
                      <span className={`marker ${g.marker}`} aria-hidden="true" />
                      <span className="skill">{e.skill}</span>
                      <span className={`chip ${e.importance === 'required' ? 'chip-blue' : ''}`}>{e.importance === 'required' ? 'Required' : 'Preferred'}</span>
                    </summary>
                    <div className="detail">
                      <p>{e.note}</p>
                      {e.evidence.map((q, i) => (
                        <p key={i} className="quote">
                          {q}
                        </p>
                      ))}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
