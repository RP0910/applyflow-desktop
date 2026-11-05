import { useEffect, useState } from 'react';
import { bridge, type ClaudeChatStatus as ChatStatus } from '@/platform/bridge';

const CHECKING: ChatStatus = { state: 'checking', detail: 'Checking Claude.ai…', checkedAt: null };

export function ClaudeChatStatus() {
  const [status, setStatus] = useState<ChatStatus>(() => (bridge() ? CHECKING : { state: 'signed_out', detail: 'Claude.ai Chat is available in the desktop app.', checkedAt: null }));

  useEffect(() => {
    const b = bridge();
    if (!b) return;
    let alive = true;
    void b.invoke('claudeChat.status').then((next) => { if (alive) setStatus(next); }).catch(() => undefined);
    const off = b.on('claudeChat:status', setStatus);
    return () => { alive = false; off(); };
  }, []);

  const dot = status.state === 'ready' ? 'green' : status.state === 'checking' || status.state === 'connecting' ? 'yellow' : 'red';
  const label = status.state === 'ready' ? 'Connected' : status.state === 'checking' ? 'Checking…' : status.state === 'connecting' ? 'Connecting…' : 'Sign in';

  return (
    <button
      type="button"
      className="rail-claude"
      aria-live="polite"
      aria-label={`Claude.ai Chat, ${label}. ${status.detail}`}
      title={status.detail}
      onClick={() => void bridge()?.invoke('claudeChat.open')}
    >
      <span className={`rail-dot rail-dot-${dot}`} aria-hidden="true" />
      <span>
        Claude.ai Chat
        <span className="hint">{label}</span>
      </span>
    </button>
  );
}
