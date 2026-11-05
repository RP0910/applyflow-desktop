import type { PageState } from '@/types';
import type {
  ContentResponseMap,
  NextStepResponse,
  OpenApplicationResponse,
  PanelToContent,
  ScanResponse,
  SignInResponse,
  SubmitResponse,
  UploadResult,
} from '@/types/messages';
import { adapterForUrl, formKeyFor, siteName } from '@/services/platforms/registry';
import { detectCaptcha, detectLoginRequired } from '@/services/platforms/dice/adapter';
import { describeWizard, findDocumentCard, findFileInputFor, findNextControl, pageErrors, uploadTargets, wizardStep } from '@/services/platforms/dice/wizard';
import type { FormSupport, JobSiteAdapter } from '@/services/platforms/types';
import { ATS_SUCCESS_PATTERNS } from '@/services/platforms/ats/common';
import { appliedConfirmDialog, confirmAppliedControl } from '@/services/platforms/jobright/adapter';
import { controlLabel, deepQueryAll, isVisible, visibleText } from '@/services/platforms/dom';
import { answerFieldAsync, fillFieldsAsync, highlightField, probeComboboxes, scanFields } from '@/services/forms/domFields';
import { browserUploadDeps, uploadDocument, type UploadDeps } from '@/services/forms/upload';

export interface ControllerEnv {
  doc: Document;
  url: () => string;
  version: string;
  now?: () => number;
  successTimeoutMs?: number;
  stepTimeoutMs?: number;
  uploadDeps?: UploadDeps;
  sleep?: (ms: number) => Promise<void>;
  navigate?: (url: string) => void;
}

const DICE_FORMS: FormSupport = {
  findNextControl,
  uploadTargets,
  documents: { findCard: findDocumentCard, findInput: findFileInputFor },
  step: (doc) => wizardStep(doc),
  pageErrors,
};

export function formsOf(adapter: JobSiteAdapter | null): FormSupport {
  return { ...DICE_FORMS, ...(adapter?.forms ?? {}) };
}

const captchaOn = (adapter: JobSiteAdapter | null, doc: Document) => (adapter?.captchaVisible ? adapter.captchaVisible(doc) : detectCaptcha(doc));
const loginOn = (adapter: JobSiteAdapter | null, doc: Document) => (adapter?.loginRequired ? adapter.loginRequired(doc) : detectLoginRequired(doc));

const NO_UPLOADS = { resume: { method: null, currentFileName: null }, coverLetter: { method: null, currentFileName: null } } as const;

export function createContentController(env: ControllerEnv) {
  const now = env.now ?? (() => Date.now());
  const sleep = env.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let armed: { token: string; expires: number } | null = null;
  let busy = false;

  function pageState(): PageState {
    const url = env.url();
    const adapter = adapterForUrl(url);
    const doc = env.doc;
    if (!adapter) {
      return { url, pageType: 'unsupported', jobKey: null, title: doc.title, hasApplicationForm: false, captchaDetected: false, loginRequired: false, step: null };
    }
    const root = adapter.findApplicationRoot(doc);
    const h1 = doc.querySelector('h1')?.textContent?.trim();
    return {
      url,
      pageType: adapter.classifyPage(doc, url),
      jobKey: adapter.jobKeyForUrl(url),
      title: h1 || doc.title,
      hasApplicationForm: Boolean(root),
      captchaDetected: captchaOn(adapter, doc),
      loginRequired: loginOn(adapter, doc),
      step: root ? formsOf(adapter).step(doc) : null,
      site: adapter.id,
      siteName: siteName(url),
      blocker: adapter.blocker?.(doc, url) ?? null,
      pendingChoice: adapter.pendingChoice?.(doc) ?? null,
    };
  }

  function scan(): ScanResponse {
    const doc = env.doc;
    const adapter = adapterForUrl(env.url());
    const forms = formsOf(adapter);
    const base = {
      pageUrl: env.url(),
      captchaDetected: captchaOn(adapter, doc),
      loginRequired: loginOn(adapter, doc),
      site: adapter?.id ?? null,
      siteName: siteName(env.url()),
      canSubmit: adapter?.canSubmit ?? false,
      parsesResume: adapter?.parsesResume ?? false,
      blocker: adapter?.blocker?.(doc, env.url()) ?? null,
      submitControlFound: false,
      submitControlLabel: null,
      nextControlLabel: null,
      uploads: { resume: { ...NO_UPLOADS.resume }, coverLetter: { ...NO_UPLOADS.coverLetter } },
      step: null,
      pageErrors: [],
    };
    if (!adapter) return { ...base, ok: false, fields: [], formFound: false, error: 'This page is not supported.' };
    const root = adapter.findApplicationRoot(doc);
    if (!root) {
      const onApplication = adapter.classifyPage(doc, env.url()) === 'application';
      return onApplication
        ? { ...base, ok: false, fields: [], formFound: false, error: `${siteName(env.url())} changed this page layout, so I could not safely identify the application fields.` }
        : { ...base, ok: true, fields: [], formFound: false, error: 'No application form is visible yet. Open the application (the Apply button).' };
    }
    const fields = scanFields(root);
    const submitFound = adapter.findSubmitControl(root);
    const submit = { el: submitFound.match?.element ?? null, reason: submitFound.reason };
    const next = forms.findNextControl(root);
    const uploads = forms.uploadTargets(root);
    const hasUpload = Boolean(uploads.resume.method || uploads.coverLetter.method);
    const out: ScanResponse = {
      ...base,
      ok: true,
      fields,
      formFound: true,
      submitControlFound: Boolean(submit.el),
      submitControlLabel: submit.el ? controlLabel(submit.el) : null,
      nextControlLabel: next.el ? controlLabel(next.el) : null,
      uploads,
      step: forms.step(doc),
      pageErrors: forms.pageErrors(root),
    };
    if (!fields.length && !submit.el && !next.el && !hasUpload) {
      return { ...out, ok: false, error: submit.reason && !/no submit button (yet|was found)/i.test(submit.reason) ? submit.reason : `${siteName(env.url())} changed this page layout, so I could not safely identify the application fields.` };
    }
    return out;
  }

  async function scanAsync(): Promise<ScanResponse> {
    const adapter = adapterForUrl(env.url());
    const root = adapter?.findApplicationRoot(env.doc);
    if (root) await probeComboboxes(root, sleep);
    return scan();
  }

  function stepSignature(): string {
    const doc = env.doc;
    const adapter = adapterForUrl(env.url());
    const forms = formsOf(adapter);
    const root = adapter?.findApplicationRoot(doc);
    const step = forms.step(doc);
    const labels = root ? scanFields(root).map((f) => f.label).join('|') : '';
    const nav = root && adapter ? `${forms.findNextControl(root).el ? 'N' : ''}${adapter.findSubmitControl(root).match ? 'S' : ''}` : '';
    return `${env.url()}#${step ? `${step.current}/${step.total}` : '-'}#${nav}#${labels}`;
  }

  async function nextStep(): Promise<NextStepResponse> {
    const doc = env.doc;
    const adapter = adapterForUrl(env.url());
    const root = adapter?.findApplicationRoot(doc);
    if (!adapter || !root) return { ok: false, label: null, advanced: false, pageErrors: [], message: 'No application form is visible.' };
    if (captchaOn(adapter, doc)) return { ok: false, label: null, advanced: false, pageErrors: [], message: `${siteName(env.url())} is showing a CAPTCHA. Complete it yourself — ApplyFlow won’t bypass it.` };
    const forms = formsOf(adapter);
    const next = forms.findNextControl(root);
    if (!next.el) return { ok: false, label: null, advanced: false, pageErrors: forms.pageErrors(root), message: next.reason ?? 'There is no Next button on this step.' };
    const label = controlLabel(next.el);
    const before = stepSignature();
    next.el.click();
    const polls = Math.ceil((env.stepTimeoutMs ?? 8000) / 150);
    let errors: string[] = [];
    for (let i = 0; i < polls; i++) {
      await sleep(150);
      if (stepSignature() !== before) return { ok: true, label, advanced: true, pageErrors: [], message: `Clicked “${label}”.` };
      const r = adapter.findApplicationRoot(doc);
      errors = r ? forms.pageErrors(r) : [];
      if (errors.length) break;
    }
    return {
      ok: true,
      label,
      advanced: false,
      pageErrors: errors,
      message: errors.length ? `Dice needs something on this step: ${errors.join(' · ')}` : 'Dice didn’t move to the next step yet.',
    };
  }

  async function upload(kind: 'resume' | 'cover_letter', file: { name: string; mime: string; base64: string }): Promise<UploadResult> {
    const doc = env.doc;
    const adapter = adapterForUrl(env.url());
    const root = adapter?.findApplicationRoot(doc);
    if (!root) return { ok: false, method: null, verified: false, fileName: file.name, message: 'No application form is visible.' };
    if (busy) return { ok: false, method: null, verified: false, fileName: file.name, message: 'Another upload is still running.' };
    busy = true;
    try {
      return await uploadDocument(doc, root, kind, file, env.uploadDeps ?? browserUploadDeps, formsOf(adapter).documents);
    } finally {
      busy = false;
    }
  }

  function successNow(patterns: RegExp[]): boolean {
    const text = visibleText(env.doc.body, 40000);
    return patterns.some((p) => p.test(text));
  }

  function successHere(): boolean {
    const adapter = adapterForUrl(env.url());
    if (!adapter || adapter.kind === 'board' && adapter.id !== 'dice') return false;
    if (adapter.kind === 'ats' && adapter.findApplicationRoot(env.doc)) return false;
    return successNow([...adapter.successPatterns, ...(adapter.kind === 'ats' ? ATS_SUCCESS_PATTERNS : [])]);
  }

  function waitForSuccess(patterns: RegExp[], timeoutMs: number, formGone?: () => boolean): Promise<boolean> {
    const doc = env.doc;
    const startUrl = env.url();
    const confirmed = () => successNow(patterns) && (!formGone || formGone() || env.url() !== startUrl);
    return new Promise((resolve) => {
      if (confirmed()) return resolve(true);
      const obs = new MutationObserver(() => {
        if (confirmed()) {
          obs.disconnect();
          clearTimeout(timer);
          resolve(true);
        }
      });
      obs.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true });
      const timer = setTimeout(() => {
        obs.disconnect();
        resolve(confirmed() || (env.url() !== startUrl && /applied|success|confirmation|thank/i.test(env.url())));
      }, timeoutMs);
    });
  }

  async function submit(token: string, expectKey?: string | null): Promise<SubmitResponse> {
    const valid = armed !== null && armed.token === token && now() < armed.expires;
    armed = null;
    if (!valid) return { ok: false, outcome: 'refused', successDetected: false, message: 'Submission was not confirmed in ApplyFlow. Nothing was submitted.' };
    if (expectKey && formKeyFor(env.url()) !== expectKey) {
      return { ok: false, outcome: 'refused', successDetected: false, message: 'This page is a different application from the one you reviewed. Nothing was submitted.' };
    }
    const doc = env.doc;
    const adapter = adapterForUrl(env.url());
    const name = siteName(env.url());
    if (captchaOn(adapter, doc)) return { ok: false, outcome: 'refused', successDetected: false, message: `${name} is showing a CAPTCHA. Complete it and click Submit yourself — ApplyFlow won’t bypass it.` };
    const root = adapter?.findApplicationRoot(doc);
    if (!adapter || !root) return { ok: false, outcome: 'refused', successDetected: false, message: `${name} changed this page layout, so I could not safely identify the application fields.` };
    if (!adapter.canSubmit) return { ok: false, outcome: 'refused', successDetected: false, message: `ApplyFlow doesn’t press Submit on ${name}. Review the page and submit it yourself.` };
    const { match, reason } = adapter.findSubmitControl(root);
    if (!match) return { ok: false, outcome: 'refused', successDetected: false, message: reason ?? 'No Submit button was found.' };
    match.element.click();
    const successDetected = await waitForSuccess(
      adapter.kind === 'ats' ? [...adapter.successPatterns, ...ATS_SUCCESS_PATTERNS] : adapter.successPatterns,
      env.successTimeoutMs ?? 20000,
      adapter.kind === 'ats' ? () => !adapter.findApplicationRoot(doc) : undefined,
    );
    if (!successDetected && adapter.kind === 'ats') {
      if (captchaOn(adapter, doc)) {
        return { ok: true, outcome: 'clicked', successDetected: false, needsUser: true, message: `${name} is showing a CAPTCHA after Submit. Complete it on the page — ApplyFlow records the application when ${name} confirms it.` };
      }
      const still = adapter.findApplicationRoot(doc);
      const errors = still ? formsOf(adapter).pageErrors(still) : [];
      if (still && errors.length) return { ok: false, outcome: 'clicked', successDetected: false, message: `${name} didn’t accept the form: ${errors.join(' · ')}` };
      if (still) return { ok: true, outcome: 'clicked', successDetected: false, needsUser: true, message: `Submit was pressed, but ${name} hasn’t confirmed the application yet. Check the page — ApplyFlow records it when the confirmation appears (or press “Record it as applied”).` };
    }
    return {
      ok: true,
      outcome: 'clicked',
      successDetected,
      message: successDetected ? 'Dice confirmed the application was submitted.' : 'Submit was clicked. Check the Dice page to confirm it went through.',
    };
  }

  const navigate = (url: string) => (env.navigate ? env.navigate(url) : env.doc.defaultView?.location.assign(url));

  function setInputValue(el: HTMLInputElement, value: string): void {
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function signIn(email: string, password: string): SignInResponse {
    const doc = env.doc;
    const name = siteName(env.url());
    if (!loginOn(adapterForUrl(env.url()), doc)) {
      return { ok: false, submitted: false, message: `${name} is not asking for a sign-in right now.` };
    }
    const inputs = deepQueryAll<HTMLInputElement>(doc, 'input', 80).filter((el) => isVisible(el) && !el.disabled);
    const passwordEl = inputs.find((el) => el.type === 'password');
    if (!passwordEl) return { ok: false, submitted: false, message: `ApplyFlow couldn’t find the password field on ${name}.` };
    const emailEl =
      inputs.find((el) => el.type === 'email') ||
      inputs.find((el) => /e-?mail|username|user\s*id|login/i.test(`${el.name} ${el.id} ${el.getAttribute('autocomplete') ?? ''} ${el.getAttribute('data-automation-id') ?? ''} ${controlLabel(el)}`)) ||
      inputs.find((el) => el !== passwordEl && (el.type === 'text' || !el.type));
    if (!emailEl) return { ok: false, submitted: false, message: `ApplyFlow couldn’t find the email field on ${name}.` };
    setInputValue(emailEl, email);
    setInputValue(passwordEl, password);
    const form = passwordEl.closest('form');
    const submit =
      (form && deepQueryAll<HTMLElement>(form, 'button[type="submit"], input[type="submit"], button:not([type])', 20).find((el) => isVisible(el))) ||
      deepQueryAll<HTMLElement>(doc, 'button, [role="button"], input[type="submit"]', 80).find((el) => {
        if (!isVisible(el)) return false;
        const label = controlLabel(el).replace(/\s+/g, ' ').trim();
        return /^(sign\s*in|log\s*in|continue|next|submit)$/i.test(label);
      });
    if (submit) submit.click();
    else if (form) {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    } else return { ok: false, submitted: false, message: `Credentials were filled, but ApplyFlow couldn’t find Sign In on ${name}. Press it yourself.` };
    return { ok: true, submitted: true, message: `Signed in to ${name} with your saved credentials.` };
  }

  function confirmJobrightApplied(): ContentResponseMap['AF_CONFIRM_JOBRIGHT_APPLIED'] {
    const adapter = adapterForUrl(env.url());
    if (adapter?.id !== 'jobright') {
      return { ok: false, clicked: false, message: 'Open the Jobright job page to mark it as applied there.' };
    }
    const btn = confirmAppliedControl(env.doc);
    if (!btn) {
      return { ok: false, clicked: false, message: 'Jobright’s “I applied” confirmation isn’t on this page yet.' };
    }
    btn.click();
    return { ok: true, clicked: true, message: 'Marked as applied on Jobright.' };
  }

  async function openApplication(direct = false): Promise<OpenApplicationResponse> {
    const adapter = adapterForUrl(env.url());
    const doc = env.doc;
    if (!adapter) return { ok: false, external: false, message: 'This page is not supported.' };
    const name = siteName(env.url());
    const blocker = adapter.blocker?.(doc, env.url()) ?? null;
    if (blocker) return { ok: false, external: blocker.kind === 'unsupported' || blocker.kind === 'referral', blocker, message: blocker.message };
    if (adapter.id === 'jobright') {
      const prompt = appliedConfirmDialog(doc);
      if (prompt?.no) {
        prompt.no.click();
        return { ok: true, external: false, message: 'Opening the employer’s application…' };
      }
    }
    const formUrl = adapter.applicationUrl?.(doc, env.url()) ?? null;
    if (adapter.kind === 'ats' && formUrl && formUrl !== env.url()) {
      navigate(formUrl);
      return { ok: true, external: false, navigating: true, message: `Opening ${siteName(formUrl)}’s application form…` };
    }
    if (adapter.id === 'jobright' && direct && formUrl) {
      navigate(formUrl);
      return { ok: true, external: false, navigating: true, message: `Opening the employer’s application (${siteName(formUrl)})…` };
    }
    const ctl = adapter.findApplyControl(doc);
    if (!ctl) {
      if (formUrl) {
        navigate(formUrl);
        return { ok: true, external: false, navigating: true, message: `Opening the employer’s application (${siteName(formUrl)})…` };
      }
      return { ok: false, external: false, message: `ApplyFlow could not find the Apply button on ${name}. Click it yourself, then press Continue.` };
    }
    if (adapter.id === 'dice' && ctl.external) {
      const href = (ctl.element as HTMLAnchorElement).href || null;
      return { ok: false, external: true, externalUrl: href, message: 'This job applies on the employer’s website. Your documents are ready — apply there.' };
    }
    if (adapter.id === 'jobright' && ctl.href) {
      navigate(ctl.href);
      return { ok: true, external: false, navigating: true, message: `Opening the employer’s application (${siteName(ctl.href)})…` };
    }
    const trusted = adapter.id === 'jobright' ? env.uploadDeps?.trusted : undefined;
    let real = false;
    if (trusted && ctl.element.isConnected) real = await trusted.clickElement(ctl.element).catch(() => false);
    if (!real) ctl.element.click();
    return { ok: true, external: false, message: adapter.id === 'dice' ? 'Opened Dice’s application.' : `Pressed “${ctl.label}” on ${name}.` };
  }

  function handle<K extends PanelToContent['type']>(msg: Extract<PanelToContent, { type: K }>): ContentResponseMap[K] | Promise<ContentResponseMap[K]> {
    const m = msg as PanelToContent;
    switch (m.type) {
      case 'AF_PING':
        return { ok: true, version: env.version } as ContentResponseMap[K];
      case 'AF_GET_PAGE_STATE':
        return pageState() as ContentResponseMap[K];
      case 'AF_EXTRACT_JOB': {
        const adapter = adapterForUrl(env.url());
        if (adapter?.extractJobAsync) return adapter.extractJobAsync(env.doc, env.url()) as Promise<ContentResponseMap[K]>;
        return (adapter
          ? adapter.extractJob(env.doc, env.url())
          : { ok: false, job: null, confidence: {}, sources: [], uncertain: true, warnings: [], failureReason: 'This page is not a supported job page.' }) as ContentResponseMap[K];
      }
      case 'AF_SCAN_FIELDS':
        return scanAsync() as Promise<ContentResponseMap[K]>;
      case 'AF_FILL_FIELDS':
        return fillFieldsAsync(env.doc, m.instructions, sleep).then((results) => ({ ok: true, results })) as Promise<ContentResponseMap[K]>;
      case 'AF_ANSWER_FIELD':
        return answerFieldAsync(env.doc, m.fieldId, m.value, sleep) as Promise<ContentResponseMap[K]>;
      case 'AF_UPLOAD_DOCUMENT':
        return upload(m.kind, m.file) as Promise<ContentResponseMap[K]>;
      case 'AF_NEXT_STEP':
        return nextStep() as Promise<ContentResponseMap[K]>;
      case 'AF_HIGHLIGHT_FIELD':
        return { ok: highlightField(env.doc, m.fieldId) } as ContentResponseMap[K];
      case 'AF_OPEN_APPLICATION':
        return openApplication(Boolean(m.direct)) as Promise<ContentResponseMap[K]>;
      case 'AF_SIGN_IN':
        return signIn(m.email, m.password) as ContentResponseMap[K];
      case 'AF_ARM_SUBMIT':
        armed = { token: m.token, expires: now() + 120_000 };
        return { ok: true } as ContentResponseMap[K];
      case 'AF_SUBMIT':
        return submit(m.token, m.expectKey) as Promise<ContentResponseMap[K]>;
      case 'AF_SET_LAUNCHER':
        return { ok: true } as ContentResponseMap[K];
      case 'AF_DIAGNOSE':
        return { ok: true, text: describeWizard(env.doc) } as ContentResponseMap[K];
      case 'AF_CONFIRM_JOBRIGHT_APPLIED':
        return confirmJobrightApplied() as ContentResponseMap[K];
      default:
        throw new Error('Unknown message');
    }
  }

  return { pageState, scan, submit, nextStep, upload, successNow, successHere, openApplication, signIn, confirmJobrightApplied, handle };
}

export type ContentController = ReturnType<typeof createContentController>;
