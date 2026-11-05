import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function chromeCandidatePaths(env: NodeJS.ProcessEnv): string[] {
  const local = env.LOCALAPPDATA ?? '';
  const pf = env.ProgramFiles ?? 'C:\\Program Files';
  const pf86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  return [
    join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local ? join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
  ].filter(Boolean);
}

export function findChromeExecutable(env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync): string | null {
  return chromeCandidatePaths(env).find((path) => exists(path)) ?? null;
}
