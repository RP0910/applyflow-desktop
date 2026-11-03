import type { ValidationIssue } from '@/types';
import { WarningBanner } from './WarningBanner';

export function IssueList({ issues, onAutoFix }: { issues: ValidationIssue[]; onAutoFix?: () => void }) {
  if (!issues.length) {
    return <WarningBanner tone="success" title="Truthfulness check passed">Every claim traces back to your master resume or confirmed facts.</WarningBanner>;
  }
  const critical = issues.filter((i) => i.severity === 'critical');
  const other = issues.filter((i) => i.severity !== 'critical');
  return (
    <div className="stack-sm">
      {critical.length ? (
        <WarningBanner
          tone="critical"
          title={`${critical.length} truthfulness issue${critical.length > 1 ? 's' : ''} must be fixed before submitting`}
          actions={onAutoFix && critical.some((c) => c.autoFixable) ? <button type="button" className="btn btn-sm" onClick={onAutoFix}>Fix automatically (revert to your wording)</button> : null}
        >
          <ul className="bullets">
            {critical.map((i) => (
              <li key={i.id}>
                {i.message}
                {i.excerpt ? <span className="muted"> “{i.excerpt}”</span> : null}
              </li>
            ))}
          </ul>
        </WarningBanner>
      ) : null}
      {other.length ? (
        <WarningBanner tone="warning" title={`${other.length} suggestion${other.length > 1 ? 's' : ''} to review`}>
          <ul className="bullets">
            {other.map((i) => (
              <li key={i.id}>
                {i.message}
                {i.excerpt ? <span className="muted"> “{i.excerpt}”</span> : null}
              </li>
            ))}
          </ul>
        </WarningBanner>
      ) : null}
    </div>
  );
}
