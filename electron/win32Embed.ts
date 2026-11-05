import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class AfWin {
  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr hWnd, StringBuilder cls, int max);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int w, int h, bool repaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  struct RECT { public int Left, Top, Right, Bottom; }
  public static string Find(uint pid) {
    var list = new List<string>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid) return true;
      var sb = new StringBuilder(256);
      GetClassName(h, sb, 256);
      if (sb.ToString() != "Chrome_WidgetWin_1") return true;
      RECT r; if (!GetWindowRect(h, out r)) return true;
      if (r.Right - r.Left < 200 || r.Bottom - r.Top < 200) return true;
      list.Add(h.ToInt64().ToString() + ":" + r.Left + ":" + r.Top + ":" + r.Right + ":" + r.Bottom);
      return true;
    }, IntPtr.Zero);
    return string.Join(",", list);
  }
  public static void Embed(long child, long parent) {
    var h = new IntPtr(child);
    uint style = (uint)GetWindowLongPtr(h, -16).ToInt64();
    style &= ~0x00C00000u;
    style &= ~0x00040000u;
    style &= ~0x80000000u;
    style |= 0x40000000u;
    SetWindowLongPtr(h, -16, new IntPtr(unchecked((int)style)));
    SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0020 | 0x0010);
    SetParent(h, new IntPtr(parent));
  }
  public static void Tool(long hwnd) {
    var h = new IntPtr(hwnd);
    ShowWindow(h, 0);
    long ex = GetWindowLongPtr(h, -20).ToInt64();
    ex |= 0x00000080L;
    ex &= ~0x00040000L;
    SetWindowLongPtr(h, -20, new IntPtr(ex));
    ShowWindow(h, 4);
  }
}
"@
function reply([string]$s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
reply 'ready'
while (($line = [Console]::In.ReadLine()) -ne $null) {
  if ($line -eq 'quit') { break }
  try {
    $p = $line.Split(' ')
    switch ($p[0]) {
      'find' { reply ("hwnds " + [AfWin]::Find([uint32]$p[1])) }
      'embed' { [AfWin]::Embed([int64]$p[1], [int64]$p[2]); reply 'ok' }
      'tool' { [AfWin]::Tool([int64]$p[1]); reply 'ok' }
      'place' { [void][AfWin]::MoveWindow(([IntPtr][int64]$p[1]), [int]$p[2], [int]$p[3], [int]$p[4], [int]$p[5], $true); reply 'ok' }
      'show' { [void][AfWin]::ShowWindow(([IntPtr][int64]$p[1]), [int]$p[2]); reply 'ok' }
      'alive' { reply $(if ([AfWin]::IsWindow(([IntPtr][int64]$p[1]))) { 'yes' } else { 'no' }) }
      default { reply 'err unknown' }
    }
  } catch { reply ('err ' + $_.Exception.Message) }
}
`;

export function embedPixels(
  frame: { window: { x: number; y: number }; content: { x: number; y: number } },
  pane: { x: number; y: number; width: number; height: number },
  scale: number,
): { x: number; y: number; w: number; h: number } {
  const s = scale > 0 ? scale : 1;
  return {
    x: Math.round((frame.content.x - frame.window.x + pane.x) * s),
    y: Math.round((frame.content.y - frame.window.y + pane.y) * s),
    w: Math.max(0, Math.round(pane.width * s)),
    h: Math.max(0, Math.round(pane.height * s)),
  };
}

export class Win32Embed {
  private readonly proc: ChildProcessWithoutNullStreams;
  private queue: Promise<void> = Promise.resolve();
  private waiter: ((line: string) => void) | null = null;
  private failed = false;

  private constructor(proc: ChildProcessWithoutNullStreams) {
    this.proc = proc;
    let buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      buf += chunk;
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        const waiter = this.waiter;
        this.waiter = null;
        waiter?.(line);
        nl = buf.indexOf('\n');
      }
    });
    proc.on('exit', () => {
      this.failed = true;
      this.waiter?.('err helper exited');
      this.waiter = null;
    });
  }

  static start(): Promise<Win32Embed> {
    const file = join(tmpdir(), 'applyflow-win32-embed.ps1');
    writeFileSync(file, SCRIPT, 'utf8');
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    const embed = new Win32Embed(proc);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The window helper did not start.')), 20_000);
      const waitReady = (line: string) => {
        if (line === 'ready') {
          clearTimeout(timer);
          resolve(embed);
          return;
        }
        embed.waiter = waitReady;
      };
      embed.waiter = waitReady;
    });
  }

  private call(command: string): Promise<string> {
    if (this.failed) return Promise.reject(new Error('The window helper is not running.'));
    const run = this.queue.then(() => new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiter) {
          this.waiter = null;
          reject(new Error('The window helper did not answer.'));
        }
      }, 8_000);
      this.waiter = (line) => {
        clearTimeout(timer);
        if (line.startsWith('err ')) reject(new Error(line.slice(4) || 'Win32 call failed.'));
        else resolve(line);
      };
      this.proc.stdin.write(`${command}\n`);
    }));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async find(pid: number): Promise<{ hwnd: bigint; left: number; top: number; right: number; bottom: number }[]> {
    const line = await this.call(`find ${pid}`);
    const ids = line.replace(/^hwnds\s*/, '').trim();
    if (!ids) return [];
    return ids.split(',').flatMap((part) => {
      const [h, l, t, r, b] = part.split(':');
      if (!h) return [];
      try {
        const hwnd = BigInt(h);
        if (hwnd === 0n) return [];
        return [{ hwnd, left: Number(l), top: Number(t), right: Number(r), bottom: Number(b) }];
      } catch {
        return [];
      }
    });
  }

  embed(child: bigint, parent: bigint): Promise<void> {
    return this.call(`embed ${child} ${parent}`).then(() => undefined);
  }

  place(child: bigint, x: number, y: number, w: number, h: number): Promise<void> {
    return this.call(`place ${child} ${x} ${y} ${Math.max(0, w)} ${Math.max(0, h)}`).then(() => undefined);
  }

  /** Keeps a top-level window visible to Windows but off the taskbar and Alt+Tab (WS_EX_TOOLWINDOW). */
  toolWindow(hwnd: bigint): Promise<void> {
    return this.call(`tool ${hwnd}`).then(() => undefined);
  }

  show(child: bigint, visible: boolean): Promise<void> {
    return this.call(`show ${child} ${visible ? 8 : 0}`).then(() => undefined);
  }

  close(): void {
    try {
      this.proc.stdin.write('quit\n');
    } catch {
    }
    this.proc.kill();
  }
}
