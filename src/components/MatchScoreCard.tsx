import type { MatchScore } from '@/types';

const SHADES = ['#007595', '#2b93ad', '#5fb0c4', '#93cbd9', '#c3e3eb'];
const BAND_TEXT: Record<MatchScore['band'], string> = { strong: 'Strong match', good: 'Good match', fair: 'Fair match', weak: 'Weak match' };

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function MatchScoreCard({ score, title = 'Estimated match', compareTo }: { score: MatchScore; title?: string; compareTo?: MatchScore | null }) {
  const positives = score.components.filter((c) => !c.isPenalty);
  const penalties = score.components.filter((c) => c.isPenalty);
  const penaltyTotal = penalties.reduce((s, c) => s + c.score, 0);
  return (
    <section className="card" aria-labelledby={`ledger-${score.computedFor}`}>
      <div className="ledger-head">
        <div>
          <h2 className="section-title" id={`ledger-${score.computedFor}`}>
            {title}
          </h2>
          <div className="section-sub">{BAND_TEXT[score.band]}.{compareTo ? ` Your master resume scored ${compareTo.total}.` : ''}</div>
        </div>
        <div className="ledger-total" aria-label={`${score.total} out of 100, estimated`}>
          {score.total}
          <small>/100</small>
        </div>
      </div>
      <div className="ledger-bar" role="img" aria-label={`Score build-up: ${positives.map((c) => `${c.label} ${fmt(c.score)} of ${c.max}`).join(', ')}; deductions ${fmt(penaltyTotal)}.`}>
        {positives.map((c, i) => (
          <span key={c.key} style={{ width: `${Math.max(0, c.score)}%`, background: SHADES[i % SHADES.length] }} />
        ))}
        {penaltyTotal < 0 ? <span className="pen" style={{ width: `${Math.abs(penaltyTotal)}%` }} /> : null}
      </div>
      <ol className="ledger-rows">
        {score.components.map((c, i) => (
          <li key={c.key} className={`ledger-row${c.isPenalty ? ' penalty' : ''}`}>
            <span className="lbl">
              <span className="swatch" aria-hidden="true" style={c.isPenalty ? { background: 'repeating-linear-gradient(135deg,#b42318 0 2px,#f6c9c4 2px 4px)' } : { background: SHADES[i % SHADES.length] }} />
              {c.label}
            </span>
            <span className="pts">
              {c.isPenalty ? (c.score === 0 ? '0' : `−${fmt(Math.abs(c.score))}`) : fmt(c.score)}
              {!c.isPenalty ? <small> / {c.max}</small> : null}
            </span>
            <p className="why">{c.explanation}</p>
          </li>
        ))}
      </ol>
      <p className="disclaimer">{score.disclaimer}</p>
    </section>
  );
}
