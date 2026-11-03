/**
 * Replacing the resume on Dice's "Resume & Cover Letter" step — the shapes of Dice's resume card
 * that made ApplyFlow 2.1.0 leave the "…" menu open without replacing anything (2.1.1 fix).
 * The same shapes run in real Chromium in scripts/e2e-replace.mjs (tests/fixtures/dice/wizard-realistic.html).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { installFileChooserInterceptor, INTERCEPT_ATTR } from '@/content/fileChooserInterceptor';
import { findWizardRoot } from '@/services/platforms/dice/wizard';
import { uploadDocument, type TrustedInput, type UploadDeps } from '@/services/forms/upload';
import type { FilePayload } from '@/types/messages';
import { testUploadDeps } from '../wizardHelpers';

const pdf = (name: string): FilePayload => ({ name, mime: 'application/pdf', base64: btoa('%PDF-1.7 test') });
const NEW_NAME = 'Grant-Howard-Resume-SAIC-Engineering-Technician-III-v3.pdf';

interface Opts {
  /** Menu item markup: icon SVG with a <title>, or an icon-font ligature before the label. */
  icon?: 'svg-title' | 'ligature' | 'plain';
  /** Event that opens the "…" menu. */
  openOn?: 'click' | 'mousedown';
  /** Links and list items before the menu (Dice's mega-menu and footer). */
  filler?: number;
  /** Replace removes the file, re-renders the card, then clicks the input (like a React effect). */
  async?: boolean;
}

/** A Dice-like step 1: resume card with "File options" menu (portal at the end of <body>) and a cover letter drop area. */
function mountRealisticWizard(doc: Document, opts: Opts = {}) {
  const state = { resume: 'Grant-Howard-FlowCV-Resume-20251222.pdf' as string | null, replaceClicks: 0, deleteClicks: 0, menuOpen: false };
  const icon = (title: string, ligature: string) =>
    opts.icon === 'svg-title' ? `<svg aria-hidden="true"><title>${title}</title><path d="M0 0"/></svg>` : opts.icon === 'ligature' ? `<span class="material-icons" aria-hidden="true">${ligature}</span>` : '<svg aria-hidden="true"><path d="M0 0"/></svg>';
  const filler = Array.from({ length: opts.filler ?? 0 }, (_, i) => `<li><a href="/jobs/q-${i}">Skill ${i} jobs</a></li>`).join('');
  doc.body.innerHTML =
    `<header class="site-header"><a href="/">Dice</a><nav><a href="/jobs">Job Search</a><a href="/companies">Companies</a></nav><ul class="mega">${filler}</ul></header>` +
    '<div id="app"><main class="wizard"><p>You’re Applying for</p><h1>Engineering Technician III</h1><p>@ SAIC in Indianapolis, IN</p><p>Step 1 of 2</p>' +
    '<h2>Resume &amp; Cover Letter</h2><div class="card" id="resume-card"></div>' +
    '<div class="card"><h3>Cover letter</h3><label class="drop"><span>Upload your cover letter</span><input type="file" id="cl-in" style="display:none"></label><p>File types supported .pdf, .doc, .docx up to 2MB</p></div>' +
    '<div class="nav"><button type="button">Next</button></div></main></div>' +
    `<footer class="site-footer">${filler.replace(/<\/?li>/g, '')}</footer>`;
  const main = doc.querySelector('main')!;
  const card = doc.getElementById('resume-card')!;
  // Dice keeps the resume uploader's input at the application level, with a generated id.
  const input = doc.createElement('input');
  input.type = 'file';
  input.id = ':r1a:';
  input.style.display = 'none';
  main.appendChild(input);
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) {
      state.resume = f.name;
      render();
    }
  });
  const closeMenu = () => {
    doc.getElementById('file-menu')?.remove();
    state.menuOpen = false;
  };
  const openMenu = () => {
    if (state.menuOpen) return closeMenu();
    state.menuOpen = true;
    const menu = doc.createElement('div');
    menu.id = 'file-menu';
    menu.className = 'menu-popover';
    menu.setAttribute('role', 'menu');
    menu.innerHTML =
      `<div role="menuitem" tabindex="-1" class="replace">${icon('Replace icon', 'sync')}<span>Replace</span></div>` +
      `<div role="menuitem" tabindex="-1" class="delete">${icon('Delete icon', 'delete')}<span>Delete</span></div>`;
    doc.body.appendChild(menu);
    menu.querySelector('.replace')!.addEventListener('click', () => {
      state.replaceClicks++;
      state.resume = null; // Replace removes the current file at once
      closeMenu();
      render();
      const open = () => input.click();
      if (opts.async) setTimeout(open, 0);
      else open();
    });
    menu.querySelector('.delete')!.addEventListener('click', () => {
      state.deleteClicks++;
      state.resume = null;
      closeMenu();
      render();
    });
  };
  const render = () => {
    card.innerHTML = state.resume
      ? `<h3>Resume <span>*</span></h3><div class="row">${icon('File icon', 'description')}<a href="#">${state.resume}</a>` +
        `<button type="button" aria-label="File options" aria-haspopup="menu">${icon('More options icon', 'more_vert')}</button></div><p>Uploaded to profile on 8/26/2026</p>`
      : '<h3>Resume <span>*</span></h3><p>Add a resume to continue.</p>';
    card.querySelector('button')?.addEventListener(opts.openOn ?? 'click', openMenu);
  };
  render();
  return state;
}

function newDoc(opts: Opts = {}) {
  const doc = document.implementation.createHTMLDocument('dice');
  const state = mountRealisticWizard(doc, opts);
  return { doc, state, root: findWizardRoot(doc)! };
}

beforeAll(() => installFileChooserInterceptor(HTMLInputElement.prototype));

describe('replacing the resume through Dice’s “File options” menu', () => {
  it.each<[string, Opts]>([
    ['plain menu', {}],
    ['icons that are SVGs with a <title>', { icon: 'svg-title' }],
    ['icon-font ligatures before the label', { icon: 'ligature' }],
    ['a page with hundreds of links before the menu', { filler: 500 }],
    ['a menu that opens on mousedown, not click()', { openOn: 'mousedown' }],
    ['Replace that opens the chooser after re-rendering', { async: true }],
    ['all of these together', { icon: 'svg-title', filler: 500, openOn: 'mousedown', async: true }],
  ])('%s', async (_name, opts) => {
    const { doc, state, root } = newDoc(opts);
    expect(root.contains(doc.getElementById('resume-card'))).toBe(true);
    const res = await uploadDocument(doc, root, 'resume', pdf(NEW_NAME), testUploadDeps);
    expect(res).toMatchObject({ ok: true, verified: true, method: 'replace-menu' });
    expect(state.resume).toBe(NEW_NAME);
    expect(state.replaceClicks).toBe(1);
    expect(state.deleteClicks).toBe(0);
    expect(doc.getElementById('file-menu')).toBeNull();
    expect(doc.documentElement.hasAttribute(INTERCEPT_ATTR)).toBe(false);
  });

  it('never clicks the menu as a whole (it holds Delete too)', async () => {
    const { doc, state, root } = newDoc({ icon: 'svg-title' });
    // Make the menu's own text look like "Replace…" to a naive matcher.
    const clicks: string[] = [];
    doc.addEventListener('click', (e) => clicks.push((e.target as Element).getAttribute('role') ?? (e.target as Element).tagName), true);
    await uploadDocument(doc, root, 'resume', pdf(NEW_NAME), testUploadDeps);
    expect(clicks).not.toContain('menu');
    expect(state.deleteClicks).toBe(0);
  });

  it('does not touch the cover letter while replacing the resume', async () => {
    const { doc, root } = newDoc();
    await uploadDocument(doc, root, 'resume', pdf(NEW_NAME), testUploadDeps);
    expect((doc.getElementById('cl-in') as HTMLInputElement).files?.length ?? 0).toBe(0);
  });
});

describe('with real input (desktop app)', () => {
  /**
   * Stands in for electron/diceInput.ts: "real" clicks become element.click() (jsdom has no layout,
   * so point-clicks report unavailable and the gesture click is used), and while armed, an input
   * the page clicks is answered with the file the way the browser answers a file chooser.
   */
  function fakeTrusted(doc: Document) {
    const log: string[] = [];
    let armed: { file: FilePayload; handled: boolean } | null = null;
    const proto = HTMLInputElement.prototype;
    const pageClick = proto.click;
    const trusted: TrustedInput = {
      clickAt: async () => false,
      clickElement: async (el) => {
        log.push(`gesture-click ${el.getAttribute('role') ?? el.tagName.toLowerCase()}`);
        el.click();
        return true;
      },
      armFileChooser: async (file) => {
        armed = { file, handled: false };
        log.push('arm');
        proto.click = function (this: HTMLInputElement) {
          if (this.type !== 'file' || !armed) return pageClick.call(this);
          // The page must be left alone while real input answers the chooser.
          log.push(`chooser intercept-attr=${doc.documentElement.hasAttribute(INTERCEPT_ATTR)}`);
          const f = new File(['%PDF'], armed.file.name, { type: armed.file.mime });
          Object.defineProperty(this, 'files', { configurable: true, value: [f] });
          this.dispatchEvent(new Event('input', { bubbles: true }));
          this.dispatchEvent(new Event('change', { bubbles: true }));
          armed.handled = true;
        };
        return 'arm-1';
      },
      waitFileChooser: async () => Boolean(armed?.handled),
      disarmFileChooser: async () => {
        log.push('disarm');
        proto.click = pageClick;
        armed = null;
      },
      setInputFile: async (input, file) => {
        log.push('set-input-file');
        const f = new File(['%PDF'], file.name, { type: file.mime });
        Object.defineProperty(input, 'files', { configurable: true, value: [f] });
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
    };
    return { trusted, log, restore: () => (proto.click = pageClick) };
  }

  it('lets Dice open its own file chooser and answers it, without the page-world hand-over', async () => {
    const { doc, state, root } = newDoc({ icon: 'svg-title', async: true });
    const t = fakeTrusted(doc);
    try {
      const deps: UploadDeps = { ...testUploadDeps, trusted: t.trusted };
      const res = await uploadDocument(doc, root, 'resume', pdf(NEW_NAME), deps);
      expect(res).toMatchObject({ ok: true, verified: true, method: 'replace-menu' });
      expect(state.resume).toBe(NEW_NAME);
      expect(state.replaceClicks).toBe(1);
      expect(state.deleteClicks).toBe(0);
      expect(t.log).toEqual(['arm', 'gesture-click button', 'gesture-click menuitem', 'chooser intercept-attr=false', 'disarm']);
    } finally {
      t.restore();
    }
  });

  it('puts the cover letter on its input through real input', async () => {
    const { doc, root } = newDoc();
    const t = fakeTrusted(doc);
    try {
      const res = await uploadDocument(doc, root, 'cover_letter', pdf('Grant-Howard-Cover-Letter.pdf'), { ...testUploadDeps, trusted: t.trusted });
      expect(res).toMatchObject({ ok: true, method: 'input' });
      expect(t.log).toEqual(['set-input-file']);
    } finally {
      t.restore();
    }
  });

  it('falls back to scripted clicks when real input is unavailable', async () => {
    const { doc, state, root } = newDoc({ icon: 'ligature' });
    const broken: TrustedInput = {
      clickAt: async () => false,
      clickElement: async () => {
        throw new Error('gone');
      },
      armFileChooser: async () => {
        throw new Error('gone');
      },
      waitFileChooser: async () => false,
      disarmFileChooser: async () => undefined,
      setInputFile: async () => false,
    };
    const res = await uploadDocument(doc, root, 'resume', pdf(NEW_NAME), { ...testUploadDeps, trusted: broken });
    expect(res).toMatchObject({ ok: true, verified: true, method: 'replace-menu' });
    expect(state.resume).toBe(NEW_NAME);
    expect(doc.documentElement.hasAttribute(INTERCEPT_ATTR)).toBe(false);
  });
});
