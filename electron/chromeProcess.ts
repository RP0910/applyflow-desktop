import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Waits for Chrome's DevTools endpoint and returns the browser's WebSocket URL. */
export async function waitForChrome(port: number, child: ChildProcess, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  while (Date.now() < deadline) {
    if (exited) throw new Error('Google Chrome closed before it was ready. Close any other ApplyFlow Chrome window and try again.');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const body = (await response.json()) as { webSocketDebuggerUrl?: string };
        if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
      }
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Google Chrome did not start.');
}

export function killChrome(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill();
}
