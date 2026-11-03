/**
 * Tiny cross-page data bus. The side panel and the workspace are separate extension
 * pages; a write in one must refresh the other (e.g. "Applied" shows up in history at once).
 */
export type DataTopic = 'applications' | 'resumes' | 'profile' | 'sessions';

const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('applyflow-data') : null;
const local = new Set<(t: DataTopic) => void>();

export function emitChange(topic: DataTopic): void {
  try {
    channel?.postMessage(topic);
  } catch {
    /* channel closed */
  }
  // BroadcastChannel doesn't echo to the sender, so notify same-page listeners directly.
  local.forEach((l) => l(topic));
}

export function onDataChange(cb: (topic: DataTopic) => void): () => void {
  const handler = (e: MessageEvent) => cb(e.data as DataTopic);
  channel?.addEventListener('message', handler);
  local.add(cb);
  return () => {
    channel?.removeEventListener('message', handler);
    local.delete(cb);
  };
}
