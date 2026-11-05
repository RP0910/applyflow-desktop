
interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

export class CdpClient {
  private next = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: CdpEvent) => void>();
  closed = false;

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      let msg: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
      try {
        msg = JSON.parse(String(ev.data)) as typeof msg;
      } catch {
        return;
      }
      if (msg.id) {
        const waiter = this.pending.get(msg.id);
        if (!waiter) return;
        this.pending.delete(msg.id);
        if (msg.error) waiter.reject(new Error(msg.error.message || 'Chrome rejected a command.'));
        else waiter.resolve(msg.result);
        return;
      }
      if (msg.method) {
        const event = { method: msg.method, params: msg.params ?? {}, sessionId: msg.sessionId };
        for (const listener of this.listeners) listener(event);
      }
    });
    ws.addEventListener('close', () => {
      this.closed = true;
      const error = new Error('Chrome closed.');
      for (const waiter of this.pending.values()) waiter.reject(error);
      this.pending.clear();
    });
  }

  static connect(url: string, timeoutMs = 10_000): Promise<CdpClient> {
    const ws = new WebSocket(url);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('Could not connect to Chrome.'));
      }, timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new CdpClient(ws));
      }, { once: true });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('Could not connect to Chrome.'));
      }, { once: true });
    });
  }

  send<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Chrome closed.'));
    const id = ++this.next;
    const body: Record<string, unknown> = { id, method };
    if (params) body.params = params;
    if (sessionId) body.sessionId = sessionId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.ws.send(JSON.stringify(body));
    });
  }

  onEvent(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
    }
  }
}
