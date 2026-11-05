import { describe, expect, it } from 'vitest';
import { findChromeExecutable } from '../../electron/chromePath';
import { embedPixels } from '../../electron/win32Embed';

describe('embedded Chrome', () => {
  it('finds Google Chrome and skips a missing install', () => {
    const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
    const installed = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    expect(findChromeExecutable(env, (path) => path === installed)).toBe(installed);
    expect(findChromeExecutable(env, () => false)).toBeNull();
  });

  it('places the Chrome window in the pane, under the window frame, in physical pixels', () => {
    expect(embedPixels(
      { window: { x: 10, y: 20 }, content: { x: 18, y: 52 } },
      { x: 100, y: 40, width: 800, height: 600 },
      1.5,
    )).toEqual({ x: 162, y: 108, w: 1200, h: 900 });
  });
});
