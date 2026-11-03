/**
 * Preload for the built-in Dice browser — the desktop version of the extension's content script.
 * It runs in an isolated world next to the Dice page (Dice's scripts can't see it), reads the
 * job, fills the application and attaches documents, all through the tested content controller.
 * It only acts on dice.com; on any other site it stays idle.
 */
import { ipcRenderer } from 'electron';
import type { PanelToContent } from '../src/types/messages';
import { createContentController } from '../src/content/controller';
import { browserUploadDeps, UPLOAD_MARKER_ATTR, type TrustedInput } from '../src/services/forms/upload';
import { mountLauncher, setLauncherHandler, setLauncherVisible } from '../src/content/launcher';
import { APP_VERSION } from '../src/version';

/**
 * Where the helper acts: Dice, Jobright, and the employers' application sites they lead to
 * (Greenhouse, Lever, Ashby, and best effort on other https sites). It only ever acts when the
 * ApplyFlow panel asks it to, for an application you started.
 */
const onWeb = () => /^https:\/\//i.test(location.href);

/** Real clicks and file-chooser answers, done by the main process for this page (electron/diceInput.ts). */
function trustedInput(): TrustedInput {
  const call = (req: Record<string, unknown>) => ipcRenderer.invoke('af:trusted', req);
  const marked = async <T>(el: Element, fn: (marker: string) => Promise<T>): Promise<T> => {
    const marker = `af-${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
    el.setAttribute(UPLOAD_MARKER_ATTR, marker);
    try {
      return await fn(marker);
    } finally {
      el.removeAttribute(UPLOAD_MARKER_ATTR);
    }
  };
  return {
    clickAt: async (x, y) => Boolean(await call({ op: 'clickAt', x, y })),
    armFileChooser: async (f) => ((await call({ op: 'arm', name: f.name, base64: f.base64 })) as string | null) ?? null,
    waitFileChooser: async (armId, ms) => Boolean(((await call({ op: 'wait', armId, timeoutMs: ms })) as { handled?: boolean } | null)?.handled),
    disarmFileChooser: async (armId) => {
      await call({ op: 'disarm', armId });
    },
    setInputFile: (input, f) => marked(input, async (marker) => Boolean(await call({ op: 'setInputFile', marker, name: f.name, base64: f.base64 }))),
    clickElement: (el) => marked(el, async (marker) => Boolean(await call({ op: 'clickMarked', marker }))),
  };
}

function start(): void {
  const controller = createContentController({
    doc: document,
    url: () => location.href,
    version: APP_VERSION,
    uploadDeps: { ...browserUploadDeps, trusted: trustedInput() },
  });
  const emit = (evt: unknown) => ipcRenderer.send('af:event', evt);
  setLauncherHandler(() => emit({ type: 'AF_LAUNCHER_CLICKED' }));

  ipcRenderer.on('af:request', (_e, { id, msg }: { id: number; msg: PanelToContent }) => {
    const reply = (result: unknown) => ipcRenderer.send('af:response', { id, result });
    const fail = (e: unknown) => ipcRenderer.send('af:response', { id, error: String(e instanceof Error ? e.message : e) });
    if (!onWeb()) {
      // Not a web page ApplyFlow works on: answer page-state requests honestly, refuse everything else.
      if (msg.type === 'AF_PING') return reply({ ok: true, version: APP_VERSION });
      if (msg.type === 'AF_GET_PAGE_STATE') return reply({ url: location.href, pageType: 'unsupported', jobKey: null, title: document.title, hasApplicationForm: false, captchaDetected: false, loginRequired: false, step: null });
      return fail('ApplyFlow only works on secure (https) job pages.');
    }
    if (msg.type === 'AF_SET_LAUNCHER') setLauncherVisible(msg.visible);
    if (msg.type === 'AF_CHECK_SUCCESS') return reply({ ok: true, success: controller.successHere() });
    try {
      const out = controller.handle(msg);
      if (out instanceof Promise) out.then(reply, fail);
      else reply(out);
    } catch (e) {
      fail(e);
    }
  });

  emit({ type: 'AF_READY' });
  if (!onWeb()) return;

  // ---- page-change detection (Dice is a single-page app) ----
  let lastUrl = '';
  let lastSignature = '';
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let onWizard = false;
  let reported = false;
  let firstLook = true;
  const watchSuccess = (pageType: string, hasForm: boolean, site: string | null | undefined): void => {
    if (pageType === 'application' && hasForm && !controller.successHere()) {
      onWizard = true;
      reported = false;
      return;
    }
    // Employer sites often load a separate confirmation page (Lever's …/thanks), so a fresh page that
    // shows a confirmation counts too; the panel only records it for an application under way.
    // A fresh confirmation page counts only when the site itself led here (its form → its "thanks" page).
    let sameSiteReferrer = false;
    try {
      sameSiteReferrer = Boolean(document.referrer) && new URL(document.referrer).hostname === location.hostname;
    } catch {
      sameSiteReferrer = false;
    }
    const employerSite = site !== 'dice' && site !== 'jobright' && sameSiteReferrer;
    if ((onWizard || (firstLook && employerSite)) && !reported && controller.successHere()) {
      reported = true;
      onWizard = false;
      emit({ type: 'AF_APPLICATION_SUBMITTED', url: location.href });
    }
  };
  const broadcast = (force = false): void => {
    const state = controller.pageState();
    watchSuccess(state.pageType, state.hasApplicationForm, state.site);
    const signature = `${state.url}|${state.pageType}|${state.hasApplicationForm}|${state.captchaDetected}|${state.step?.current ?? '-'}|${document.querySelectorAll('input,textarea,select').length}`;
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    lastUrl = state.url;
    emit({ type: 'AF_PAGE_CHANGED', state });
    mountLauncher(state.pageType === 'job-detail' && (state.site === 'dice' || state.site === 'jobright'));
  };
  broadcast(true);
  // A confirmation page that just loaded (or renders within a few seconds) counts as one look.
  setTimeout(() => {
    firstLook = false;
  }, 6000);
  setInterval(() => {
    if (location.href !== lastUrl) broadcast();
  }, 800);
  new MutationObserver(() => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => broadcast(), 600);
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', () => broadcast());
}

if (window.top === window) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
