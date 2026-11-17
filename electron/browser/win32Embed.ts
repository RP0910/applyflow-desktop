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
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static void Front(long hwnd, long owner) {
    var h = new IntPtr(hwnd);
    if (owner != 0) SetWindowLongPtr(h, -8, new IntPtr(owner));
    ShowWindow(h, 9);
    SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
    SetWindowPos(h, new IntPtr(-2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    BringWindowToTop(h);
    SetForegroundWindow(h);
  }
  delegate bool ChildProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, ChildProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr hWnd, IntPtr rgn, bool redraw);
  [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int l, int t, int r, int b);
  public static string Content(long hwnd) {
    var h = new IntPtr(hwnd);
    RECT w; if (!GetWindowRect(h, out w)) return "";
    RECT best = new RECT(); long area = 0;
    EnumChildWindows(h, (c, l) => {
      var sb = new StringBuilder(64); GetClassName(c, sb, 64);
      if (sb.ToString() != "Chrome_RenderWidgetHostHWND" || !IsWindowVisible(c)) return true;
      RECT r; if (!GetWindowRect(c, out r)) return true;
      long a = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
      if (a > area) { area = a; best = r; }
      return true;
    }, IntPtr.Zero);
    if (area == 0) return "";
    return (best.Left - w.Left) + ":" + (best.Top - w.Top) + ":" + (w.Right - best.Right) + ":" + (w.Bottom - best.Bottom);
  }
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
  // Puts an embedded window above its siblings. The host's own (invisible) input window must not sit on top:
  // it would take every click while the embedded page still shows through it.
  public static bool Raise(long hwnd) {
    var h = new IntPtr(hwnd);
    if (GetWindow(h, 3) == IntPtr.Zero) return false;
    SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
    return true;
  }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
  [StructLayout(LayoutKind.Sequential)] struct GUITHREADINFO { public int cbSize; public int flags; public IntPtr hwndActive; public IntPtr hwndFocus; public IntPtr hwndCapture; public IntPtr hwndMenuOwner; public IntPtr hwndMoveSize; public IntPtr hwndCaret; public RECT rcCaret; }
  // Gives an embedded window keyboard focus while its host is the foreground window. Windows does not move focus
  // into a child that belongs to another process on a click, so typing would otherwise go to the host.
  public static string Focus(long hwnd) {
    var h = new IntPtr(hwnd);
    var fg = GetForegroundWindow();
    if (fg == IntPtr.Zero || GetAncestor(h, 2) != fg) return "background";
    uint pid;
    uint fgThread = GetWindowThreadProcessId(fg, out pid);
    var info = new GUITHREADINFO(); info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    if (GetGUIThreadInfo(fgThread, ref info) && (info.hwndFocus == h || IsChild(h, info.hwndFocus))) return "ok";
    uint me = GetCurrentThreadId();
    uint target = GetWindowThreadProcessId(h, out pid);
    AttachThreadInput(me, fgThread, true);
    if (target != fgThread) AttachThreadInput(me, target, true);
    SetFocus(h);
    if (target != fgThread) AttachThreadInput(me, target, false);
    AttachThreadInput(me, fgThread, false);
    return "focused";
  }
  public static void Crop(long hwnd, int l, int t, int r, int b) {
    SetWindowRgn(new IntPtr(hwnd), CreateRectRgn(l, t, r, b), true);
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
      'front' { [AfWin]::Front([int64]$p[1], [int64]$p[2]); reply 'ok' }
      'content' { reply ("content " + [AfWin]::Content([int64]$p[1])) }
      'crop' { [AfWin]::Crop([int64]$p[1], [int]$p[2], [int]$p[3], [int]$p[4], [int]$p[5]); reply 'ok' }
      'tool' { [AfWin]::Tool([int64]$p[1]); reply 'ok' }
      'focus' { reply ([AfWin]::Focus([int64]$p[1])) }
      'raise' { reply $(if ([AfWin]::Raise([int64]$p[1])) { 'raised' } else { 'ok' }) }
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

  async content(hwnd: bigint): Promise<{ left: number; top: number; right: number; bottom: number } | null> {
    const line = (await this.call(`content ${hwnd}`)).replace(/^content\s*/, '').trim();
    const parts = line.split(':').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
    const [left, top, right, bottom] = parts as [number, number, number, number];
    return { left, top, right, bottom };
  }

  crop(hwnd: bigint, left: number, top: number, right: number, bottom: number): Promise<void> {
    return this.call(`crop ${hwnd} ${left} ${top} ${right} ${bottom}`).then(() => undefined);
  }

  front(hwnd: bigint, owner: bigint | null): Promise<void> {
    return this.call(`front ${hwnd} ${owner ?? 0n}`).then(() => undefined);
  }

  /** Keyboard focus for an embedded window whose host is in front: 'focused', 'ok' (already had it) or 'background'. */
  focus(hwnd: bigint): Promise<string> {
    return this.call(`focus ${hwnd}`).then((line) => line.trim());
  }

  /** Keeps an embedded window on top of its siblings; true when something had covered it. */
  raise(hwnd: bigint): Promise<boolean> {
    return this.call(`raise ${hwnd}`).then((line) => line.trim() === 'raised');
  }

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
