import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createContentController, type ContentController } from '@/content/controller';
import type { UploadDeps } from '@/services/forms/upload';
import type { ContentResponseMap, PanelToContent } from '@/types/messages';

const DIR = resolve(__dirname, 'fixtures/jobright');

export function pageFor(url: string): string {
  const u = new URL(url);
  const h = u.hostname;
  const p = u.pathname;
  const f = (name: string) => readFileSync(join(DIR, name), 'utf8');
  if (/(^|\.)jobright\.ai$/.test(h)) return /\/jobs\/info\//.test(p) ? f('jobright-job.html') : f('jobright-list.html');
  if (h === 'careers.acme-robotics.com') return f('company-careers.html');
  if (h === 'boards.greenhouse.io') return f('greenhouse-classic.html');
  if (h === 'job-boards.greenhouse.io') return f('greenhouse-new.html');
  if (h === 'jobs.lever.co') return f(/\/apply\/?$/.test(p) ? 'lever-apply.html' : /\/thanks\/?$/.test(p) ? 'lever-thanks.html' : 'lever-posting.html');
  if (h === 'jobs.ashbyhq.com') return f(/\/application\/?$/.test(p) ? 'ashby-application.html' : 'ashby-overview.html');
  if (/myworkdayjobs\.com$/.test(h)) return f('workday.html');
  if (/(^|\.)linkedin\.com$/.test(h)) return f('linkedin.html');
  const name = join(DIR, `${h}.html`);
  return existsSync(name) ? readFileSync(name, 'utf8') : '<!doctype html><title>Not found</title><h1>Not found</h1>';
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const browserlikeUploadDeps: UploadDeps = {
  sleep: realSleep,
  setFiles: (input, file) => {
    Object.defineProperty(input, 'files', { configurable: true, value: Object.assign([file], { item: (i: number) => [file][i] }) });
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  drop: () => undefined,
  verifyMs: 1500,
};

export class FakeBrowser {
  url = '';
  history: string[] = [];
  ctl!: ContentController;
  page: Record<string, unknown> = {};
  loads = 0;

  constructor(start: string) {
    this.load(start);
  }

  load(url: string): void {
    this.url = new URL(url, this.url || undefined).toString();
    this.history.push(this.url);
    this.loads++;
    const html = pageFor(this.url).replace(/^<!doctype html>/i, '');
    document.documentElement.innerHTML = html.replace(/^\s*<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
    const u = new URL(this.url);
    const self = this;
    const loc = {
      get href() {
        return self.url;
      },
      get pathname() {
        return new URL(self.url).pathname;
      },
      get search() {
        return new URL(self.url).search;
      },
      get hostname() {
        return u.hostname;
      },
      assign: (to: string) => setTimeout(() => self.load(new URL(to, self.url).toString()), 0),
    };
    const page: Record<string, unknown> = {};
    this.page = page;
    const win = new Proxy(window, {
      get: (t, k) => (k in page ? page[k as string] : k === 'open' ? (to?: string) => self.open(to) : (t as unknown as Record<string | symbol, unknown>)[k]),
      set: (_t, k, v) => {
        page[k as string] = v;
        return true;
      },
    });
    const hist = { pushState: (_s: unknown, _t: string, to: string) => (self.url = new URL(to, self.url).toString()) };
    for (const s of Array.from(document.querySelectorAll('script'))) {
      if (s.type && s.type !== 'text/javascript') continue;
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function('location', 'window', 'history', 'sessionStorage', s.textContent ?? '')(loc, win, hist, { setItem: () => undefined, getItem: () => null });
    }
    this.ctl = createContentController({
      doc: document,
      url: () => this.url,
      version: 'test',
      uploadDeps: browserlikeUploadDeps,
      navigate: (to) => setTimeout(() => this.load(to), 0),
      successTimeoutMs: 2500,
      stepTimeoutMs: 800,
    });
  }

  open(to?: string): unknown {
    this.opened.push(to ?? '');
    if (to && !/^about:blank/i.test(to)) {
      setTimeout(() => this.load(new URL(to, this.url).toString()), 0);
      return null;
    }
    const go = (u: string) => setTimeout(() => this.load(new URL(u, this.url).toString()), 0);
    const location = { set href(u: string) { go(u); }, assign: go, replace: go };
    return {
      get location() {
        return location;
      },
      set location(u: string | typeof location) {
        go(String(u));
      },
    };
  }

  opened: string[] = [];

  send = async <K extends PanelToContent['type']>(msg: Extract<PanelToContent, { type: K }>): Promise<ContentResponseMap[K]> => (await this.ctl.handle(msg as never)) as ContentResponseMap[K];
}
