/**
 * Attach the tailored resume / cover letter on Dice's wizard (content-script side).
 *
 * Strategies, in order (each one retried once after Dice re-renders the card):
 *   1. input      — put the file on the (usually hidden) <input type=file> for that slot
 *   2. menu       — open the card's "…" ("File options") menu → "Replace", and answer the file
 *                   chooser Dice opens with the tailored file
 *   3. dropzone   — click the drop area / Upload button the same way, or drop the file on it
 * Then confirm any "Upload / Save" dialog, and verify the new file name appears on the page.
 *
 * How the file reaches Dice. In the desktop app the page helper has real input (deps.trusted,
 * electron/diceInput.ts): genuine mouse clicks — menus that ignore scripted clicks open, and Dice is
 * allowed to open its file chooser — and the browser itself answers that chooser with the tailored
 * file, exactly as if you had picked it in the Windows "Open" dialog. At the same time the page-world
 * helper (content/fileChooserInterceptor.ts) catches Dice's input.click() and hands that input over,
 * so either way the file lands on the input Dice is listening to. Without real input (tests, or if
 * it is unavailable) scripted clicks and DataTransfer are used, as before.
 *
 * If a click takes Dice to another step (e.g. the review page's edit button), it stops and says so,
 * so the caller can handle the new step — it never clicks anything on a page it didn't expect.
 */
import type { FilePayload, UploadResult } from '@/types/messages';
import { controlLabel, deepQueryAll, isVisible, visibleText } from '@/services/platforms/dom';
import { classifyFileInput, clickables, fileInputs, findDocumentCard, findFileInputFor, findWizardRoot, normalizeLabel, wizardStep } from '@/services/platforms/dice/wizard';
import { CAPTURED_ATTR, INTERCEPT_ATTR } from '@/content/fileChooserInterceptor';
import type { DocumentLocator } from '@/services/platforms/types';

/** Dice's resume/cover-letter cards (the default). Employer forms pass their own (platforms/ats). */
const DICE_DOCUMENTS: DocumentLocator = { findCard: findDocumentCard, findInput: findFileInputFor };

export { CAPTURED_ATTR, INTERCEPT_ATTR };

/** Marks the input real input should put the file on (electron/diceInput.ts looks for it). */
export const UPLOAD_MARKER_ATTR = 'data-applyflow-upload';

/** Real input from the desktop app (absent in tests and plain browsers). */
export interface TrustedInput {
  /** A genuine left click at a point of the page (CSS pixels, viewport coordinates). */
  clickAt: (x: number, y: number) => Promise<boolean>;
  /** Answer the next file chooser the page opens with this file. Returns an id, or null if unavailable. */
  armFileChooser: (file: FilePayload) => Promise<string | null>;
  /** Wait up to `ms` for the armed chooser to be answered. */
  waitFileChooser: (id: string, ms: number) => Promise<boolean>;
  disarmFileChooser: (id: string) => Promise<void>;
  /** Put the file on this input the way a user's choice does (genuine input/change events). */
  setInputFile: (input: HTMLInputElement, file: FilePayload) => Promise<boolean>;
  /** element.click() run as a user gesture (for elements a point-click can't reach). */
  clickElement: (el: HTMLElement) => Promise<boolean>;
}

export interface UploadDeps {
  sleep: (ms: number) => Promise<void>;
  /** Attach a File to an input (DataTransfer in browsers; injectable for tests). */
  setFiles: (input: HTMLInputElement, file: File) => boolean;
  /** Dispatch a drop of the File onto an element. */
  drop: (target: Element, file: File) => void;
  /** How long to wait for Dice to show the new file name (it uploads the file first). */
  verifyMs: number;
  /** Real clicks and file-chooser answers (desktop app). */
  trusted?: TrustedInput | null;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toFile(p: FilePayload): File {
  return new File([base64ToBytes(p.base64) as BlobPart], p.name, { type: p.mime });
}

export const browserUploadDeps: UploadDeps = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  setFiles: (input, file) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.files?.[0]?.name === file.name;
  },
  drop: (target, file) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  },
  verifyMs: 30000,
};

async function waitFor<T>(fn: () => T | null | undefined, ms: number, sleep: UploadDeps['sleep']): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(100);
  }
}

async function quietly<T>(p: Promise<T> | undefined): Promise<T | null> {
  try {
    return (await p) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- labels

/**
 * Words icon fonts and SVG titles add to a label ("sync Replace", "Replace icon Replace").
 * Removed before matching; repeated words collapse ("replace replace" → "replace").
 */
const ICON_NOISE = /\b(icon|svg|sync|autorenew|refresh|cached|swap horiz|swap vert|file upload|cloud upload|upload file|more vert|more horiz|ellipsis|kebab|delete outline|trash)\b/g;

function cleanLabel(raw: string | null | undefined): string {
  const words = normalizeLabel(raw ?? '')
    .replace(ICON_NOISE, ' ')
    .split(' ')
    .filter(Boolean);
  return words.filter((w, i) => w !== words[i - 1]).join(' ');
}

/** Text of an element with its text pieces kept apart, without SVG titles, scripts or styles. */
function spacedText(el: Element, max = 400): string {
  const parts: string[] = [];
  let len = 0;
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n && len < max; n = walker.nextNode()) {
    if (n.parentElement?.closest('title, desc, style, script, noscript')) continue;
    const t = (n.nodeValue ?? '').trim();
    if (t) {
      parts.push(t);
      len += t.length + 1;
    }
  }
  return parts.join(' ').slice(0, max);
}

/** Every way an element can be labelled, cleaned: rendered text, its text pieces, aria-label, title. */
function labelsOf(el: Element): string[] {
  const h = el as HTMLElement;
  const out = [cleanLabel(visibleText(h, 160)), cleanLabel(spacedText(h, 200)), cleanLabel(h.getAttribute('aria-label')), cleanLabel(h.getAttribute('title'))];
  return Array.from(new Set(out.filter(Boolean)));
}

/** Words that mean another action — an element saying any of them is never "Replace" (nor a menu holding it). */
const NOT_REPLACE = /(delete|remove|download|rename|cancel|discard|\bview\b|preview|default|close|submit|\bapply\b|\bnext\b|\bback\b)/;
/** "Replace", "Replace resume", "Replace <file name>", "Upload new"… */
const REPLACE_TEXT = /^(replace\b.*|change( (resume|file|document|cv))?|update( (resume|file|document|cv))?|upload (a )?new( (resume|file|document|cv|version))?|choose (a )?(new|different) (resume|file))$/;
/** "Upload…" / Jobvite "SELECT" — counts inside a menu, dialog or the card itself. */
const UPLOAD_TEXT = /^(upload|upload (a |your )?(new )?(resume|file|document|cv)|choose (a )?(new )?file|browse|browse files|select( (a )?(file|resume|document|cv))?)$/;
const CONFIRM_LABEL = /^(upload|save|done|confirm|replace|attach|use (this )?(file|resume|document)|ok|apply changes)$/;
/** Primary upload trigger on Jobvite and similar ATS UIs. */
const SELECT_TRIGGER = /^(select|select file|choose file|browse|browse files|attach|upload|add (resume|file|cv))$/i;
const MENU_HINT = /file options|options|more|menu|actions|kebab|ellipsis|overflow|dots|manage/i;
const FILE_EXT = /\.(pdf|docx?|rtf|txt|odt)\b/i;

const isReplaceLabel = (l: string) => l.length > 0 && l.length <= 120 && !NOT_REPLACE.test(l) && REPLACE_TEXT.test(l);
const isUploadLabel = (l: string) => l.length > 0 && l.length <= 60 && !NOT_REPLACE.test(l) && UPLOAD_TEXT.test(l);
/** Labelled "Replace" (or "Upload new" in a menu/the card) — and by nothing else. */
function saysReplace(el: Element, popupish: boolean): boolean {
  const labels = labelsOf(el);
  if (!labels.length || labels.some((l) => NOT_REPLACE.test(l))) return false;
  return labels.some(isReplaceLabel) || (popupish && labels.some(isUploadLabel));
}
/** A menu, list or group of several items is never itself the item to click. */
function isContainer(el: Element): boolean {
  return /^(menu|menubar|listbox|list|group|dialog|presentation)$/.test(el.getAttribute('role') ?? '') || el.querySelectorAll('[role="menuitem"], [role="option"], li, button').length > 1;
}

const POPUP = [
  '[role="menu"]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  'dialog[open]',
  '[popover]',
  '[data-radix-popper-content-wrapper]',
  '[data-floating-ui-portal]',
  '[data-headlessui-portal]',
  '[class*="menu" i]',
  '[class*="popover" i]',
  '[class*="popper" i]',
  '[class*="dropdown" i]',
  '[class*="modal" i]',
].join(', ');

/** Elements that might be (or hold) a menu item. */
const ITEMISH = 'button, [role="menuitem"], [role="menuitemradio"], [role="option"], [role="button"], a, li, label, div, span, p';
/** What to click for an item: the menu item / button around its text. */
const CLICK_TARGET = '[role="menuitem"], [role="menuitemradio"], [role="option"], button, [role="button"], a, li, label';

function inPopup(el: Element): boolean {
  return Boolean(el.closest(POPUP));
}

/** Composed (shadow-DOM aware) "a contains b". */
function composedContains(a: Element, b: Node | null): boolean {
  for (let n: Node | null = b; n; n = (n as Node).parentNode ?? ((n as ShadowRoot).host ?? null)) {
    if (n === a) return true;
  }
  return false;
}

/**
 * Elements that say "Replace" (or "Upload new"), mapped to what should be clicked. Scans the whole
 * page including open shadow roots, with a cheap text pre-filter, so a long page (big menus and
 * footers) can't push Dice's menu — rendered at the end of <body> — out of reach.
 */
function replaceTargets(doc: Document, card: Element | null): HTMLElement[] {
  const out = new Set<HTMLElement>();
  for (const el of deepQueryAll<HTMLElement>(doc, ITEMISH, 40000)) {
    // Big containers can't be a menu item; skip them before reading their text.
    if (el.childElementCount > 8 && !el.getAttribute('aria-label')) continue;
    const raw = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''} ${(el.textContent ?? '').slice(0, 400)}`;
    if (!/replace|change|update|upload|browse|choose/i.test(raw)) continue;
    if ((el.textContent ?? '').length > 300 && !el.getAttribute('aria-label')) continue;
    const popupish = inPopup(el) || Boolean(card && card.contains(el));
    if (isContainer(el) || !saysReplace(el, popupish)) continue;
    // Click the menu item / button around the text when it is labelled the same way.
    const around = el.closest<HTMLElement>(CLICK_TARGET);
    const target = around && around !== el && !isContainer(around) && saysReplace(around, popupish) ? around : el;
    out.add(target);
  }
  // Keep the outermost of nested matches (the menu item, not the <span> inside it).
  const all = Array.from(out);
  return all.filter((el) => !all.some((o) => o !== el && o.contains(el)) && isVisible(el));
}

/** The "Replace" item that appeared after opening the menu (or is inside the card / a popup). */
function findReplaceItem(doc: Document, card: Element, before: Set<HTMLElement>): HTMLElement | null {
  const candidates = replaceTargets(doc, card).filter((el) => {
    // The file link itself never counts (its name may contain "update").
    if (el.tagName === 'A' && FILE_EXT.test(visibleText(el, 160))) return false;
    return inPopup(el) || card.contains(el) || !before.has(el);
  });
  const rank = (el: HTMLElement) => (inPopup(el) ? 0 : card.contains(el) ? 1 : 2) + (before.has(el) ? 0.5 : 0) + (labelsOf(el).some(isReplaceLabel) ? 0 : 0.25);
  return candidates.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

function findMenuButton(card: Element): HTMLElement | null {
  const buttons = clickables(card, 40).filter((b) => b.tagName !== 'A' && !FILE_EXT.test(controlLabel(b)));
  const score = (b: HTMLElement): number => {
    const label = cleanLabel(controlLabel(b));
    if (NOT_REPLACE.test(label)) return -1;
    const attrs = `${b.getAttribute('aria-label') ?? ''} ${b.getAttribute('title') ?? ''} ${b.getAttribute('data-testid') ?? ''} ${typeof b.className === 'string' ? b.className : ''}`;
    let s = 0;
    if (MENU_HINT.test(attrs)) s += 3;
    if (b.getAttribute('aria-haspopup') && b.getAttribute('aria-haspopup') !== 'false') s += 3;
    if (/^[.…⋯⋮·\s]*$/.test(b.textContent ?? '')) s += 1;
    if (/\bedit\b/.test(label)) s += 1;
    return s;
  };
  const ranked = buttons.map((b, i) => ({ b, s: score(b), i })).filter((x) => x.s >= 0);
  ranked.sort((x, y) => y.s - x.s || y.i - x.i);
  // Dice's resume card: the menu is the last button (after the file link).
  return ranked[0]?.b ?? null;
}

// ---------------------------------------------------------------- clicking

/** A genuine click on the middle of `el`, when it is on screen and nothing covers it. */
async function realClick(doc: Document, el: HTMLElement, deps: UploadDeps): Promise<boolean> {
  const trusted = deps.trusted;
  const view = doc.defaultView;
  if (!trusted || !view || !el.isConnected) return false;
  const onScreen = () => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= view.innerHeight && r.right <= view.innerWidth;
  };
  if (!onScreen()) {
    el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    await deps.sleep(150);
  }
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const y = r.top + r.height / 2;
  for (const x of [r.left + r.width / 2, r.left + Math.min(12, r.width / 4), r.right - Math.min(12, r.width / 4)]) {
    if (x < 0 || y < 0 || x > view.innerWidth || y > view.innerHeight) continue;
    let hit: Element | null = doc.elementFromPoint(x, y);
    // Look through open shadow roots to the element really under the point.
    for (let i = 0; hit?.shadowRoot && i < 10; i++) {
      const inner: Element | null = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    if (hit && composedContains(el, hit)) return Boolean(await quietly(trusted.clickAt(x, y)));
  }
  return false;
}

/** Scripted press for menus that react to pointer events rather than click(). */
function pointerPress(el: HTMLElement): void {
  const view = el.ownerDocument.defaultView;
  const r = el.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, composed: true, view, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  const P = (view as (Window & { PointerEvent?: typeof PointerEvent }) | null)?.PointerEvent;
  if (P) el.dispatchEvent(new P('pointerdown', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1 }));
  el.dispatchEvent(new MouseEvent('mousedown', { ...init, buttons: 1 }));
  if (P) el.dispatchEvent(new P('pointerup', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 }));
  el.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
}

/**
 * Click like a person when possible: a real click on the element's middle, else element.click() as
 * a user gesture, else a plain scripted click (`beforeScripted` switches on the page-world hand-over,
 * because without a user gesture the browser won't open Dice's file chooser).
 */
async function press(doc: Document, el: HTMLElement, deps: UploadDeps, beforeScripted?: () => void): Promise<'real' | 'scripted'> {
  if (await realClick(doc, el, deps)) return 'real';
  if (deps.trusted && el.isConnected && (await quietly(deps.trusted.clickElement(el)))) return 'real';
  beforeScripted?.();
  el.click();
  return 'scripted';
}

/** Click "Upload"/"Save" in a dialog that appeared after choosing the file. Never touches Submit. */
async function confirmDialog(doc: Document, deps: UploadDeps): Promise<boolean> {
  await deps.sleep(400);
  // Only a dialog about the file (crop/confirm/upload) — never cookie banners, consent or other popups.
  const dialogs = deepQueryAll(doc, '[role="dialog"], [aria-modal="true"], dialog[open], [class*="modal" i]', 10).filter((d) => {
    if (!isVisible(d)) return false;
    const t = visibleText(d, 1500);
    return /upload|file|resume|résumé|\bcv\b|document|attach|replace/i.test(t) && !/cookie|consent|privacy|tracking|newsletter|subscribe/i.test(t);
  });
  for (const d of dialogs) {
    const btn = clickables(d, 30).find((b) => CONFIRM_LABEL.test(normalizeLabel(controlLabel(b))) && !/submit|apply/i.test(controlLabel(b)) && !(b as HTMLButtonElement).disabled);
    if (btn) {
      await press(doc, btn, deps);
      return true;
    }
  }
  return false;
}

/** True when the new file name is visible on the page (Dice re-renders the card, so look at the whole root). */
async function shownOnPage(doc: Document, scope: Element, name: string, deps: UploadDeps): Promise<boolean> {
  const stem = name.replace(/\.[^.]+$/, '');
  const seen = await waitFor(() => {
    const where = doc.contains(scope) ? scope : doc.body;
    const text = `${visibleText(where, 30000)} ${where === doc.body ? '' : visibleText(doc.body, 60000)}`;
    return text.includes(name) || text.includes(stem) ? true : null;
  }, deps.verifyMs, deps.sleep);
  return Boolean(seen);
}

// ---------------------------------------------------------------- file chooser

/** The input Dice tried to open: marked by the page helper, newly added, or the only unlabeled one. */
function captured(doc: Document, before: Set<HTMLInputElement>, kind: 'resume' | 'cover_letter', allowExisting: boolean): HTMLInputElement | null {
  const marked = deepQueryAll<HTMLInputElement>(doc, `input[${CAPTURED_ATTR}]`, 1)[0];
  if (marked) return marked;
  const all = fileInputs(doc);
  const fresh = all.filter((i) => !before.has(i));
  const pick = fresh.find((i) => classifyFileInput(i) === kind) ?? fresh.find((i) => classifyFileInput(i) === null);
  if (pick || !allowExisting) return pick ?? null;
  const other = kind === 'resume' ? 'cover_letter' : 'resume';
  const candidates = all.filter((i) => classifyFileInput(i) !== other && !(i.files && i.files.length));
  return candidates.length === 1 ? candidates[0]! : null;
}

/** Put the file on an input: real (browser-set) when available, else DataTransfer. */
async function attachToInput(input: HTMLInputElement, payload: FilePayload, file: File, deps: UploadDeps): Promise<boolean> {
  if (deps.trusted && input.isConnected && (await quietly(deps.trusted.setInputFile(input, payload)))) return true;
  return deps.setFiles(input, file);
}

type Got = { input: HTMLInputElement | null; handedOver: boolean };

/**
 * Run `trigger` (clicks that should make Dice open its file chooser) with both hand-over routes
 * ready: the browser answers a real chooser with the file, and the page-world helper hands over an
 * input Dice calls click() on. Returns how the file got in, 'moved' if Dice changed step, or null.
 */
async function withFileChooser(
  doc: Document,
  kind: 'resume' | 'cover_letter',
  payload: FilePayload,
  file: File,
  deps: UploadDeps,
  moved: () => boolean,
  trigger: (poll: (ms: number) => Promise<Got | 'moved' | null>, scripted: () => void) => Promise<Got | 'moved' | null>,
): Promise<Got | 'moved' | null> {
  const html = doc.documentElement;
  const beforeInputs = new Set(fileInputs(doc));
  deepQueryAll(doc, `[${CAPTURED_ATTR}]`, 20).forEach((e) => e.removeAttribute(CAPTURED_ATTR));
  const armId = deps.trusted ? await quietly(deps.trusted.armFileChooser(payload)) : null;
  // With real input the browser opens Dice's own chooser and answers it — the page is left untouched.
  // Scripted clicks carry no user gesture, so for those the page-world helper hands the input over.
  const intercept = () => html.setAttribute(INTERCEPT_ATTR, '1');
  if (!armId) intercept();
  const tried = new Set<HTMLInputElement>();
  const poll = async (ms: number): Promise<Got | 'moved' | null> => {
    const end = Date.now() + ms;
    for (;;) {
      if (moved()) return 'moved';
      if (armId && (await quietly(deps.trusted!.waitFileChooser(armId, 0)))) return { input: null, handedOver: true };
      const input = captured(doc, beforeInputs, kind, false);
      if (input && !tried.has(input)) {
        tried.add(input);
        if (await attachToInput(input, payload, file, deps)) return { input, handedOver: true };
      }
      if (Date.now() >= end) return null;
      // Always yield to the page too, so Dice's own timers (re-render, then input.click()) can run.
      if (armId) await quietly(deps.trusted!.waitFileChooser(armId, 100));
      await deps.sleep(armId ? 20 : 100);
    }
  };
  try {
    const got = await trigger(poll, intercept);
    if (got) return got;
    if (moved()) return 'moved';
    // Last look: Dice may reuse an input that was already on the page.
    const late = captured(doc, beforeInputs, kind, true);
    if (late && !tried.has(late) && (await attachToInput(late, payload, file, deps))) return { input: late, handedOver: true };
    return null;
  } finally {
    html.removeAttribute(INTERCEPT_ATTR);
    if (armId) await quietly(deps.trusted!.disarmFileChooser(armId));
  }
}

/** Close a menu ApplyFlow opened but couldn't use. */
function closeMenu(doc: Document, menu: HTMLElement | null): void {
  const target = (doc.activeElement as HTMLElement | null) ?? doc.body;
  for (const el of [target, doc.body]) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  }
  if (menu && doc.contains(menu) && menu.getAttribute('aria-expanded') === 'true') menu.click();
}

const stepKeyOf = (doc: Document) => {
  const s = wizardStep(doc);
  return `${doc.location?.href ?? ''}#${s ? `${s.current}/${s.total}` : '-'}`;
};

export async function uploadDocument(
  doc: Document,
  root: Element,
  kind: 'resume' | 'cover_letter',
  payload: FilePayload,
  deps: UploadDeps = browserUploadDeps,
  documents: DocumentLocator = DICE_DOCUMENTS,
): Promise<UploadResult> {
  const file = toFile(payload);
  const label = kind === 'resume' ? 'resume' : 'cover letter';
  const startStep = stepKeyOf(doc);
  const moved = () => stepKeyOf(doc) !== startStep;
  const navigated = (): UploadResult => ({
    ok: false,
    method: null,
    verified: false,
    navigated: true,
    fileName: file.name,
    message: `Dice opened another step to change the ${label}.`,
  });
  const done = async (method: UploadResult['method'], input: HTMLInputElement | null, handedOver: boolean, scope: Element, verifyMs = deps.verifyMs): Promise<UploadResult> => {
    await confirmDialog(doc, deps);
    const verified = await shownOnPage(doc, scope, file.name, { ...deps, verifyMs });
    const attached = verified || handedOver || input?.files?.[0]?.name === file.name;
    return {
      ok: attached,
      method,
      verified,
      fileName: file.name,
      message: verified
        ? `Attached your tailored ${label} (${file.name}).`
        : attached
          ? `Attached ${file.name}. Dice hasn’t shown the file name yet — check the ${label} on the page before submitting.`
          : `Dice didn’t accept ${file.name}.`,
    };
  };

  let sawCard = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (moved()) return navigated();
    // Dice re-renders the card (Replace removes the old file at once), so look again each time.
    const r = attempt === 0 || doc.contains(root) ? root : (findWizardRoot(doc) ?? root);
    const card = documents.findCard(r, kind);
    sawCard ||= Boolean(card);

    // 1. A file input already exists for this slot.
    const direct = documents.findInput(r, kind);
    if (direct && (await attachToInput(direct, payload, file, deps))) return done('input', direct, false, r);

    // 2. A saved file with a menu: "…" → Replace (or an edit button that opens an upload dialog).
    if (card && card.querySelector('button, [role="button"], [role="combobox"], select')) {
      const beforeItems = new Set(replaceTargets(doc, card));
      let menu: HTMLElement | null = null;
      let menuOpenedNothing = false;
      const got = await withFileChooser(doc, kind, payload, file, deps, moved, async (poll, scripted) => {
        let replace = findReplaceItem(doc, card, beforeItems);
        if (!replace) {
          // Jobvite / similar: a visible SELECT / Choose File control opens the chooser directly.
          const selectBtn = clickables(card, 40).find((b) => SELECT_TRIGGER.test(controlLabel(b).trim()) && isVisible(b));
          if (selectBtn) {
            const how = await press(doc, selectBtn, deps, scripted);
            const opened = await poll(how === 'real' ? 5000 : 3500);
            if (opened) return opened;
            if (how === 'real' && doc.contains(selectBtn)) {
              scripted();
              selectBtn.click();
              const again = await poll(3500);
              if (again) return again;
            }
          }
          menu = findMenuButton(card);
          if (!menu) return null;
          const how = await press(doc, menu, deps, scripted);
          let found = await waitFor<HTMLElement | 'moved'>(() => (moved() ? 'moved' : findReplaceItem(doc, card, beforeItems)), 1500, deps.sleep);
          if (!found && !moved() && doc.contains(menu)) {
            // Menus that open on pointer events (or only on a real click) — try the other way.
            scripted();
            if (how === 'real') menu.click();
            else pointerPress(menu);
            found = await waitFor<HTMLElement | 'moved'>(() => (moved() ? 'moved' : findReplaceItem(doc, card, beforeItems)), 2500, deps.sleep);
          }
          if (found === 'moved' || moved()) return 'moved';
          if (!found) {
            // Some edit buttons open the file chooser or an upload dialog straight away.
            const direct2 = await poll(300);
            if (direct2) return direct2;
            menuOpenedNothing = true;
            return null;
          }
          replace = found;
          await deps.sleep(150); // let the menu finish opening
          if (!doc.contains(replace)) replace = findReplaceItem(doc, card, beforeItems) ?? replace;
        }
        const how = await press(doc, replace, deps, scripted);
        let res = await poll(how === 'real' ? 5000 : 3000);
        if (!res && how === 'real' && doc.contains(replace) && isVisible(replace)) {
          // The item ignored the real click (still on screen): try a scripted one.
          scripted();
          replace.click();
          res = await poll(3000);
        }
        return res;
      });
      if (got === 'moved') return navigated();
      if (got) return done('replace-menu', got.input, got.handedOver, r);
      if (menuOpenedNothing) closeMenu(doc, menu);
    }

    // 3. Drop area / Upload / SELECT button: clicking it opens a file chooser; otherwise drop the file on it.
    const zone = card
      ? (deepQueryAll<HTMLElement>(card, 'label, button, [role="button"], a, div, section, span', 120).find((el) => {
          const label = controlLabel(el);
          const text = visibleText(el, 120);
          if (!isVisible(el) || visibleText(el, 400).length > 220) return false;
          return SELECT_TRIGGER.test(label.trim()) || /upload|drag|drop|browse|choose|select|attach|add resume|add cv/i.test(`${label} ${text}`);
        }) ?? null)
      : null;
    if (zone && !moved()) {
      const button = clickables(zone, 12).find((b) => SELECT_TRIGGER.test(controlLabel(b).trim()) || /upload|browse|choose|select|attach/i.test(controlLabel(b))) ?? zone;
      const got = await withFileChooser(doc, kind, payload, file, deps, moved, async (poll, scripted) => {
        await press(doc, button, deps, scripted);
        return poll(4000);
      });
      if (got === 'moved') return navigated();
      if (got) return done('dropzone', got.input, got.handedOver, r);
      deps.drop(zone, file);
      const res = await done('dropzone', null, false, r, Math.min(deps.verifyMs, 8000));
      if (res.ok) return res;
    }
    // Give the page a moment to re-render before the next attempt.
    await deps.sleep(700);
  }

  return {
    ok: false,
    method: null,
    verified: false,
    fileName: file.name,
    message: sawCard ? `ApplyFlow couldn’t replace the ${label} on this page automatically.` : `ApplyFlow couldn’t find where this site takes the ${label} on this step.`,
  };
}
