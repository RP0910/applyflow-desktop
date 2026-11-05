import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserPane } from '@/desktop/BrowserPane';
import type { BrowserState, BrowserTab, BrowserTabsState } from '@/platform/bridge';

const jobsState: BrowserState = { url: 'https://jobright.ai/jobs/recommend', title: 'Jobright', searchUrl: null, onSearch: false, onApplication: false, canGoBack: false, canGoForward: false, loading: false, ready: true };
const tab = (over: Partial<BrowserTab>): BrowserTab => ({ id: 1, kind: 'jobs', title: 'Jobright', url: jobsState.url, loading: false, canGoBack: false, canGoForward: false, challenge: false, challengeLoop: false, error: null, crashed: false, ...over });

let tabsState: BrowserTabsState;
let listeners: Record<string, (p: unknown) => void>;
let invoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  tabsState = { activeId: 1, jobsId: 1, tabs: [tab({}), tab({ id: 2, kind: 'web', title: 'Example Domain', url: 'https://example.com/' })] };
  listeners = {};
  invoke = vi.fn(async (method: string) => {
    if (method === 'dice.state') return jobsState;
    if (method === 'browser.state') return tabsState;
    if (method === 'browser.newTab') return 3;
    if (method === 'browser.diagnostics') return { electron: '45.2.1', chromium: '156.0.8078.75', userAgent: 'UA', partitions: [{ partition: 'persist:dice', persistent: true, cookies: 12, sites: 3, clearanceSites: ['example.com'] }], events: [] };
    return undefined;
  });
  (window as unknown as { applyflow: unknown }).applyflow = {
    invoke,
    on: (event: string, cb: (p: unknown) => void) => {
      listeners[event] = cb;
      return () => delete listeners[event];
    },
  };
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
});

afterEach(() => {
  delete (window as unknown as { applyflow?: unknown }).applyflow;
});

const push = (next: BrowserTabsState) => act(() => listeners['browser:tabs']?.(next));

describe('built-in browser tabs', () => {
  it('shows a pinned Jobs tab and closable web tabs, and opens a new tab', async () => {
    render(<BrowserPane visible />);
    const strip = await screen.findByRole('tablist', { name: 'Browser tabs' });
    expect(within(strip).getByRole('tab', { name: /Jobs/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(strip).getByRole('tab', { name: /Example Domain/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close Jobs' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close Example Domain' }));
    expect(invoke).toHaveBeenCalledWith('browser.closeTab', 2);
    await userEvent.click(screen.getByRole('button', { name: 'New tab' }));
    expect(invoke).toHaveBeenCalledWith('browser.newTab');
  });

  it('sends the address bar to the Jobs tab’s Dice search, or to the active web tab', async () => {
    render(<BrowserPane visible />);
    const input = await screen.findByPlaceholderText('Search Dice jobs or paste a job link');
    await userEvent.clear(input);
    await userEvent.type(input, 'data engineer{Enter}');
    expect(invoke).toHaveBeenCalledWith('dice.navigate', 'data engineer');
    push({ ...tabsState, activeId: 2 });
    const web = await screen.findByPlaceholderText('Search the web or type an address');
    await userEvent.clear(web);
    await userEvent.type(web, 'example.org{Enter}');
    expect(invoke).toHaveBeenCalledWith('browser.navigate', 2, 'example.org');
  });

  it('offers the system browser when a security check keeps coming back, without retrying by itself', async () => {
    render(<BrowserPane visible />);
    await screen.findByRole('tablist');
    push({ ...tabsState, activeId: 2, tabs: [tabsState.tabs[0]!, tab({ id: 2, kind: 'web', title: 'Just a moment...', url: 'https://example.com/', challenge: true, challengeLoop: true })] });
    expect(await screen.findByText('This site’s security check isn’t accepting this browser')).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith('browser.retryCheck', 2);
    await userEvent.click(screen.getByRole('button', { name: /Open in my browser/ }));
    expect(invoke).toHaveBeenCalledWith('browser.openExternal', 2);
    await userEvent.click(screen.getByRole('button', { name: 'Try again here' }));
    expect(invoke).toHaveBeenCalledWith('browser.retryCheck', 2);
  });

  it('says a security check is for the person to complete', async () => {
    render(<BrowserPane visible />);
    await screen.findByRole('tablist');
    push({ ...tabsState, tabs: [tab({ challenge: true, title: 'Just a moment...' }), tabsState.tabs[1]!] });
    expect(await screen.findByText(/ApplyFlow doesn’t interact with it, and waits until it’s done/)).toBeInTheDocument();
  });

  it('shows a load error with a retry', async () => {
    render(<BrowserPane visible />);
    await screen.findByRole('tablist');
    push({ ...tabsState, activeId: 2, tabs: [tabsState.tabs[0]!, tab({ id: 2, kind: 'web', url: 'https://down.example/', error: { code: -105, description: 'ERR_NAME_NOT_RESOLVED', url: 'https://down.example/' } })] });
    expect(await screen.findByText(/ERR_NAME_NOT_RESOLVED \(error -105\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(invoke).toHaveBeenCalledWith('browser.reload', 2);
  });

  it('opens the session dialog with profile status, and asks before resetting', async () => {
    render(<BrowserPane visible />);
    await userEvent.click(await screen.findByRole('button', { name: /session and diagnostics/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Built-in browser' });
    expect(await within(dialog).findByText(/kept on this computer, 12 cookies from 3 sites/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset browser session…' }));
    expect(invoke).not.toHaveBeenCalledWith('browser.resetSession');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));
    expect(invoke).toHaveBeenCalledWith('browser.resetSession');
  });
});
