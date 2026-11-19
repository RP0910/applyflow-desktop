import type { CareerProfile, FieldProposal, FieldSemantic, FillInstruction, JobSession, PageBlocker, PageState, Settings, SiteCredential } from '@/types';
import type { ContentResponseMap, FilePayload, PanelToContent, ScanResponse, SignInResponse } from '@/types/messages';
import type { LoginAction } from '@/services/forms/siteLogin';
import { proposeFieldValues, rememberAnswer, toScreeningControl } from '@/services/forms/mapper';
import { classifyCapture, isLongFormQuestion, type PageLearnItem } from '@/services/applymind/capture';
import { countryFromLocation, matchFactQuestion, optionsKey, resolvedFactKey, type StoredFact } from '@/services/applymind/factRules';
import { formKeyFor } from '@/services/platforms/registry';
import {
  identityFromSession,
  isConfidentMatch,
  matchJobIdentity,
  observedFromPage,
  pageLeftThisJob,
} from '@/services/workflow/jobIdentity';
import {
  isJobBoardSyndicationUrl,
  pickEmployerApplyUrl,
  shouldAvoidDirectNavigate,
  unexpectedSyndicationDestination,
} from '@/services/platforms/applyDestination';
import { log } from '@/utils/logger';

export type StageKey = 'documents' | 'open' | 'attach' | 'questions' | 'review';
export type StageState = 'todo' | 'active' | 'done' | 'skipped' | 'error';

export interface AttachState {
  state: 'pending' | 'done' | 'unverified' | 'failed' | 'skipped' | 'not_offered';
  fileName: string | null;
  message?: string;
  tries?: number;
  byUser?: boolean;
}

export type RunStatus = 'idle' | 'working' | 'questions' | 'attention' | 'ready' | 'external' | 'submitting' | 'submitted';

export interface ApplyRunState {
  status: RunStatus;
  label: string;
  stages: Record<StageKey, StageState>;
  questions: FieldProposal[];
  optional: FieldProposal[];
  attachments: { resume: AttachState; coverLetter: AttachState };
  message: string | null;
  externalUrl: string | null;
  step: { current: number; total: number } | null;
  lastStepKey: string | null;
  submittedConfirmed: boolean;
  originalFiles: { resume: string | null; coverLetter: string | null };
  need: 'resume' | null;
  allowOriginalResume: boolean;
  formKey: string | null;
  /** Address of the application form ApplyFlow opened, so it can go back there. */
  formUrl: string | null;
  learned: { count: number; longFormIds: string[]; previousAnswers: CareerProfile['approvedAnswers'] } | null;
  factPrompts: { factKey: string; label: string; value: string; question: string; country: string | null }[];
}

export const INITIAL_RUN: ApplyRunState = {
  status: 'idle',
  label: '',
  stages: { documents: 'todo', open: 'todo', attach: 'todo', questions: 'todo', review: 'todo' },
  questions: [],
  optional: [],
  attachments: { resume: { state: 'pending', fileName: null }, coverLetter: { state: 'pending', fileName: null } },
  message: null,
  externalUrl: null,
  step: null,
  lastStepKey: null,
  submittedConfirmed: false,
  originalFiles: { resume: null, coverLetter: null },
  need: null,
  allowOriginalResume: false,
  formKey: null,
  formUrl: null,
  learned: null,
  factPrompts: [],
};

type Send = <K extends PanelToContent['type']>(msg: Extract<PanelToContent, { type: K }>) => Promise<ContentResponseMap[K]>;

export interface RunnerIO {
  send: Send;
  session: () => JobSession | null;
  saveSession: (s: JobSession) => Promise<void>;
  settings: Settings;
  profile: CareerProfile;
  saveProfile?: (p: CareerProfile) => Promise<CareerProfile>;
  /** Exact verified answer for this question text, or null. Does not use a model. */
  exactAnswer?: (q: { question: string; options: string[]; control: string }) => Promise<string | null>;
  /** Normalized questions with an open review or conflict. Not filled from saved answers either. */
  blockedQuestions?: () => Promise<string[]>;
  /** Record a fill the user has not approved. Must not create a verified answer. */
  recordAccepted?: (items: { question: string; answer: string; category: string; options: string[]; control: string }[]) => Promise<void>;
  fillContext?: () => Promise<{ facts: StoredFact[]; drafts: Record<string, string> }>;
  learnPage?: (items: PageLearnItem[]) => Promise<{ profileAnswers: { category: string; questionPattern: string; answer: string; control: string; options: string[] }[]; longFormIds: string[]; prompts: ApplyRunState['factPrompts']; trained: boolean }>;
  ensureSiteCredential?: (url: string, email: string) => Promise<SiteCredential | null>;
  /** Keep the login a new account was created with, so a later default-password change doesn't lock it out. */
  rememberSiteLogin?: (c: SiteCredential) => Promise<unknown>;
  payload: (kind: 'resume' | 'cover_letter') => Promise<FilePayload | null>;
  fileName: (kind: 'resume' | 'cover_letter') => string | null;
  sleep: (ms: number) => Promise<void>;
  aborted: () => boolean;
  state: () => ApplyRunState;
  report: (next: ApplyRunState) => void;
  pollMs?: number;
  /** Load a URL in the job tab (used to get back to this job when the tab wandered off). */
  navigate?: (url: string) => Promise<void>;
}

const patch = (io: RunnerIO, p: Partial<ApplyRunState>) => io.report({ ...io.state(), ...p });
const stage = (io: RunnerIO, k: StageKey, v: StageState) => {
  const s = io.state();
  io.report({ ...s, stages: { ...s.stages, [k]: v } });
};
const attention = (io: RunnerIO, message: string, label = 'Needs your attention', need: ApplyRunState['need'] = null): 'stopped' => {
  patch(io, { status: 'attention', label, message, need });
  return 'stopped';
};

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export const stepKey = (url: string, step: { current: number } | null | undefined) => `${url}#${step?.current ?? '-'}`;

function stopFor(io: RunnerIO, b: PageBlocker): 'external' | 'stopped' {
  if (b.kind === 'unsupported' || b.kind === 'referral' || b.kind === 'apply_now') {
    stage(io, 'open', 'skipped');
    patch(io, {
      status: 'external',
      label: b.kind === 'referral' ? 'Jobright referral role' : b.kind === 'apply_now' ? 'SKIPPED — Apply Now' : 'Apply on the employer’s site yourself',
      message: b.message,
      externalUrl: null,
    });
    return 'external';
  }
  stage(io, 'open', 'error');
  return attention(io, b.message, b.kind === 'closed' ? 'Job closed' : 'Already applied');
}

const siteOf = (s: Pick<PageState, 'siteName'> | null | undefined) => s?.siteName || 'the site';

function identityOpts(io: RunnerIO) {
  const r = io.state();
  return { formKey: r.formKey, formUrl: r.formUrl };
}

function verifyAgainstSession(io: RunnerIO, st: PageState) {
  const session = io.session();
  if (!session) return null;
  return matchJobIdentity(identityFromSession(session), observedFromPage(st), identityOpts(io));
}

function formOpened(io: RunnerIO, st: PageState): 'open' | 'stopped' {
  const key = formKeyFor(st.url);
  const prev = io.state().formKey;
  if (prev && prev !== key) {
    return attention(io, `This page isn’t the application ApplyFlow opened for this job (${siteOf(st)}). Go back to that application to continue, or open the job you want and press Tailor & Apply there. Nothing was filled here.`, 'Different application');
  }
  const match = verifyAgainstSession(io, st);
  if (match?.verdict === 'mismatch') {
    stage(io, 'open', 'error');
    return attention(
      io,
      `This application doesn’t match the job used for your tailored resume (${io.session()?.job.title || 'this job'} at ${io.session()?.job.company || 'the employer'}). ${match.reasons[0] ?? ''} Open the correct job, then press Continue.`.trim(),
      'Wrong job application',
    );
  }
  stage(io, 'open', 'done');
  if (!prev) patch(io, { formKey: key, formUrl: st.url });
  return 'open';
}

/**
 * The job tab shows a job list or a different job instead of this job or its
 * application (e.g. Jobright closed its job drawer and dropped ?jobId=). Its
 * Apply buttons belong to other jobs, so nothing may be pressed there.
 */
export function leftThisJob(st: PageState | null | undefined, session: Pick<JobSession, 'jobKey' | 'job'> | null | undefined): boolean {
  return pageLeftThisJob(st, session);
}

/** Where to send the job tab to get back to this job: the form already opened, else the job page. */
export function returnUrl(run: Pick<ApplyRunState, 'formUrl'>, session: Pick<JobSession, 'job'> | null | undefined): string | null {
  return run.formUrl || session?.job.url || null;
}

function landedOnThisJob(io: RunnerIO, s: PageState): boolean {
  if (s.blocker) return true;
  const match = verifyAgainstSession(io, s);
  if (!match) return false;
  if (s.hasApplicationForm) {
    if (isConfidentMatch(match)) return true;
    const r = io.state();
    if (r.formUrl && s.url.split('#')[0] === r.formUrl.split('#')[0]) return true;
    if (r.formKey && formKeyFor(s.url) === r.formKey) return true;
    return false;
  }
  return s.pageType === 'job-detail' && isConfidentMatch(match);
}

async function returnToJob(io: RunnerIO, st: PageState): Promise<PageState | 'stopped'> {
  const target = returnUrl(io.state(), io.session());
  const where = st.pageType === 'search' ? `${siteOf(st)}’s job list` : 'a different job';
  if (!target || !io.navigate) {
    stage(io, 'open', 'error');
    return attention(io, `The browser is on ${where}, not this job. Open ${io.session()?.job.title || 'the job'} again, then press Continue.`, 'Go back to the job');
  }
  patch(io, { status: 'working', label: 'Going back to this job…' });
  await io.navigate(target);
  const poll = io.pollMs ?? 400;
  for (let i = 0; i < Math.ceil(20000 / poll); i++) {
    if (io.aborted()) return 'stopped';
    await io.sleep(poll);
    const s = await safe(io.send({ type: 'AF_GET_PAGE_STATE' }));
    if (!s || s.url === st.url) continue;
    if (landedOnThisJob(io, s)) return s;
  }
  stage(io, 'open', 'error');
  return attention(io, `ApplyFlow couldn’t get back to ${io.session()?.job.title || 'this job'}. Open it in the Jobs tab, then press Continue.`, 'Go back to the job');
}

/**
 * Before clicking Apply, require the Jobs tab to show this session’s job (or its
 * already-opened form). Recover by navigating to the job/form URL when needed.
 */
async function ensureOnThisJob(io: RunnerIO, st: PageState | null): Promise<PageState | 'stopped'> {
  if (!st) return attention(io, 'ApplyFlow can’t reach this page. Reload it and try again.') as 'stopped';
  const session = io.session();
  if (!session) return attention(io, 'Open the job first.') as 'stopped';

  if (st.hasApplicationForm) {
    const match = verifyAgainstSession(io, st);
    if (match?.verdict === 'mismatch') {
      const back = await returnToJob(io, st);
      return back;
    }
    return st;
  }

  const match = verifyAgainstSession(io, st);
  if (match && isConfidentMatch(match)) return st;

  // Already at the session job URL but signals are thin — still safe to open Apply.
  if (match && match.verdict === 'unknown' && st.pageType === 'job-detail') {
    const atJobUrl = returnUrl({ formUrl: null }, session) && st.url.split('#')[0] === session.job.url.split('#')[0];
    const sameKey = Boolean(st.jobKey && st.jobKey === session.jobKey);
    if (sameKey || atJobUrl) return st;
  }

  // Only recover from board/list mismatches here. Employer ATS pages (login walls,
  // postings mid-hop) are handled after Apply is pressed — do not bounce back to the board.
  if (leftThisJob(st, session) || match?.verdict === 'mismatch') {
    const back = await returnToJob(io, st);
    if (back === 'stopped') return 'stopped';
    const again = verifyAgainstSession(io, back);
    if (back.hasApplicationForm) return back;
    if (again && isConfidentMatch(again)) return back;
    if (again?.verdict === 'mismatch') {
      stage(io, 'open', 'error');
      return attention(
        io,
        `The browser still doesn’t show the job for your tailored resume (${session.job.title} at ${session.job.company}). Open that job in the Jobs tab, then press Continue.`,
        'Wrong job page',
      ) as 'stopped';
    }
    return back;
  }
  return st;
}

export async function ensureApplicationOpen(io: RunnerIO): Promise<'open' | 'external' | 'stopped'> {
  const poll = io.pollMs ?? 400;
  let st = await safe(io.send({ type: 'AF_GET_PAGE_STATE' }));
  const session0 = io.session();
  const expectedApply = pickEmployerApplyUrl(session0?.job.applicationUrl);
  log.info('Navigation open', {
    jobKey: session0?.jobKey ?? null,
    company: session0?.job.company ?? null,
    title: session0?.job.title ?? null,
    sourceUrl: session0?.job.url ?? null,
    expectedApply,
    pageUrl: st?.url ?? null,
  });
  let syndicationRecoveries = 0;
  // If the Jobs tab already shows a job-board mirror/authwall but this session has a real
  // employer apply URL, go there before treating LinkedIn/Indeed as a terminal “unsupported”.
  if (st && unexpectedSyndicationDestination(st.url, expectedApply) && expectedApply && io.navigate) {
    syndicationRecoveries += 1;
    log.warn('Navigation mismatch on entry: recovering to employer apply URL', {
      jobKey: session0?.jobKey ?? null,
      expectedApply,
      actual: st.url,
    });
    patch(io, {
      status: 'working',
      label: 'Wrong site opened — going to the employer application…',
      message: `Application navigation mismatch detected. Expected ${session0?.job.company || 'the employer'}’s application, but the browser opened a job-board page. Recovering…`,
    });
    await io.navigate(expectedApply);
    st = await safe(io.send({ type: 'AF_GET_PAGE_STATE' }));
  }
  const ensured = await ensureOnThisJob(io, st);
  if (ensured === 'stopped') return 'stopped';
  st = ensured;
  if (st.blocker) {
    if (unexpectedSyndicationDestination(st.url, expectedApply) && expectedApply) {
      return attention(
        io,
        `Application navigation mismatch detected. Expected ${session0?.job.company || 'the employer'}’s ${session0?.job.title || 'job'} application, but the browser opened a job-board page. Autofill was paused to prevent applying to the wrong job. Open the employer’s application, then press Continue.`,
        'Wrong application site',
      );
    }
    return stopFor(io, st.blocker);
  }
  if (st.hasApplicationForm) return formOpened(io, st);
  stage(io, 'open', 'active');
  patch(io, { status: 'working', label: 'Opening the application…' });
  const multiHop = st.site !== 'dice';
  const settleMs = Math.min(2500, poll * 6);
  let direct = false;
  let lastPressed = '';
  let signedInAt = '';
  const idle = new Map<string, number>();
  for (let hop = 0; hop < (multiHop ? 6 : 1); hop++) {
    if (io.aborted()) return 'stopped';
    // On the board, refuse to press Apply if the SPA swapped to another posting.
    if (st.site === 'dice' || st.site === 'jobright') {
      const gate = await ensureOnThisJob(io, st);
      if (gate === 'stopped') return 'stopped';
      st = gate;
      if (st.hasApplicationForm) return formOpened(io, st);
      if (st.blocker) return stopFor(io, st.blocker);
    }
    const before = st.url;
    let openMessage = 'Opening the application…';
    // Prefer a verified employer apply URL over a Jobright “direct” assign to a bad formUrl.
    if (direct && expectedApply && !shouldAvoidDirectNavigate(expectedApply) && io.navigate && (st.site === 'jobright' || st.site === 'dice')) {
      log.info('Navigation direct-to-expected', { expectedApply, from: st.url });
      openMessage = 'Opening the employer’s application…';
      patch(io, { label: openMessage });
      await io.navigate(expectedApply);
      direct = false;
    } else {
      const open = await safe(io.send({ type: 'AF_OPEN_APPLICATION', direct }));
      if (!open) return attention(io, 'ApplyFlow can’t reach this page. Reload it and try again.');
      if (!open.ok) {
        if (open.blocker) return stopFor(io, open.blocker);
        if (open.external) {
          stage(io, 'open', 'skipped');
          patch(io, { status: 'external', label: 'Applies on the employer’s site', message: open.message, externalUrl: open.externalUrl ?? null });
          return 'external';
        }
        if (st.site === 'jobright' && !direct) {
          // Only flip to direct when we have a safe employer URL to assign (or click path exhausted).
          if (expectedApply && !shouldAvoidDirectNavigate(expectedApply)) direct = true;
          else if (!expectedApply || !isJobBoardSyndicationUrl(expectedApply)) direct = true;
          else {
            stage(io, 'open', 'error');
            return attention(io, open.message);
          }
          continue;
        }
        stage(io, 'open', 'error');
        return attention(io, open.message);
      }
      openMessage = open.message;
      if (multiHop) patch(io, { label: open.message });
    }
    let movedAt = 0;
    let lastUrl = before;
    const started = Date.now();
    for (let i = 0; i < Math.ceil(25000 / poll); i++) {
      if (io.aborted()) return 'stopped';
      await io.sleep(poll);
      const s = await safe(io.send({ type: 'AF_GET_PAGE_STATE' }));
      if (!s) continue;
      st = s;
      if (s.loginRequired) {
        if (signedInAt === s.url) {
          return attention(io, `${siteOf(s)} still wants you to sign in. Check the password under Profile settings → Job site logins, then press Continue.`, `Sign in to ${siteOf(s)}`);
        }
        const signed = await trySignIn(io, s);
        if (signed === 'signed') {
          signedInAt = s.url;
          movedAt = Date.now();
          lastUrl = s.url;
          continue;
        }
        if (signed === 'stopped') return 'stopped';
        return attention(io, `${siteOf(s)} wants you to sign in. Sign in on the page, then press Continue.`, `Sign in to ${siteOf(s)}`);
      }
      if (s.captchaDetected) return attention(io, `${siteOf(s)} is showing a CAPTCHA. Complete it on the page, then press Continue.`, 'Complete the CAPTCHA');
      // Landed on LinkedIn/Indeed/… while this job’s real apply URL is an employer ATS → recover once.
      if (unexpectedSyndicationDestination(s.url, expectedApply) && expectedApply && io.navigate && syndicationRecoveries < 2) {
        syndicationRecoveries += 1;
        log.warn('Navigation mismatch: syndication instead of employer apply', {
          jobKey: io.session()?.jobKey ?? null,
          expectedApply,
          actual: s.url,
          recovery: syndicationRecoveries,
        });
        patch(io, {
          status: 'working',
          label: 'Wrong site opened — going to the employer application…',
          message: `Application navigation mismatch detected. Expected ${io.session()?.job.company || 'the employer'}’s application, but the browser opened a job-board page. Recovering…`,
        });
        await io.navigate(expectedApply);
        movedAt = Date.now();
        lastUrl = s.url;
        continue;
      }
      if (s.blocker) {
        if (unexpectedSyndicationDestination(s.url, expectedApply) && expectedApply) {
          return attention(
            io,
            `Application navigation mismatch detected. Expected ${io.session()?.job.company || 'the employer'}’s ${io.session()?.job.title || 'job'} application, but the browser opened a job-board page. Autofill was paused to prevent applying to the wrong job. Open the employer’s application, then press Continue.`,
            'Wrong application site',
          );
        }
        return stopFor(io, s.blocker);
      }
      if (s.hasApplicationForm) return formOpened(io, s);
      if (!multiHop) continue;
      if (s.url !== lastUrl) {
        lastUrl = s.url;
        movedAt = Date.now();
        continue;
      }
      if (movedAt && Date.now() - movedAt >= settleMs) break;
      if (s.pendingChoice && s.site === 'jobright' && Date.now() - started >= poll * 2) break;
      if (!movedAt && Date.now() - started >= Math.max(settleMs * 2, poll * 12)) {
        if (s.site === 'jobright') {
          if (expectedApply && !shouldAvoidDirectNavigate(expectedApply)) direct = true;
          else if (!expectedApply || !isJobBoardSyndicationUrl(expectedApply)) direct = true;
        }
        break;
      }
    }
    if (!movedAt && st.site === 'jobright' && !st.pendingChoice) {
      const n = (idle.get(openMessage) ?? 0) + 1;
      idle.set(openMessage, n);
      if (n >= 2) {
        stage(io, 'open', 'error');
        return attention(
          io,
          'Jobright didn’t open the employer’s application. On the Jobright page, press Apply; if Jobright offers to customize your resume, choose “Apply Without Customizing”. When the employer’s page opens here, press Continue.',
          'Open the application on Jobright',
        );
      }
    }
    if (!movedAt && !direct && st.site !== 'jobright') {
      if (openMessage === lastPressed) break;
      lastPressed = openMessage;
    }
  }
  stage(io, 'open', 'error');
  return attention(io, st.site === 'dice' || !multiHop ? 'Dice didn’t open its application form. Click Dice’s Apply button, then press Continue.' : `ApplyFlow couldn’t reach the application form on ${siteOf(st)}. Open it on the page (its Apply button), then press Continue.`);
}

/**
 * Get past a sign-in wall with the default login (or this site's own login): email-first screens,
 * Sign in, and — when the site has no account for that email — Create account. Stops with a clear
 * message when the user has to act (verify the email, a password the site rejects, an existing
 * account with a different password).
 */
async function trySignIn(io: RunnerIO, s: PageState): Promise<'signed' | 'stopped' | 'manual'> {
  if (!io.ensureSiteCredential) return 'manual';
  const site = siteOf(s);
  const title = `Sign in to ${site}`;
  const cred = await io.ensureSiteCredential(s.url, io.profile.email.trim());
  if (!cred?.password || !cred.email) {
    return attention(io, `${site} asks you to sign in. Set your default job-site login (email and password) under Profile settings → Job site logins, or sign in on the page, then press Continue.`, title) as 'stopped';
  }
  const [firstName, ...rest] = io.profile.fullName.trim().split(/\s+/);
  const lastName = rest.join(' ');
  const settle = Math.min(2500, (io.pollMs ?? 400) * 6);
  let after: LoginAction | null = null;
  for (let i = 0; i < 7; i++) {
    if (io.aborted()) return 'stopped';
    const res: SignInResponse | null = await safe(io.send({ type: 'AF_SIGN_IN', email: cred.email, password: cred.password, firstName, lastName, after, allowCreate: true }));
    if (!res) return attention(io, `ApplyFlow can’t reach ${site}’s sign-in page. Sign in there, then press Continue.`, title) as 'stopped';
    if (res.action === 'verify-email') return attention(io, res.message, 'Verify your email') as 'stopped';
    if (!res.ok || !res.submitted) {
      // "Not asking for a sign-in" right after a step means that step got us through.
      if (after && !res.action) return 'signed';
      return attention(io, res.message, title) as 'stopped';
    }
    patch(io, { label: res.message });
    if (res.action === 'created' && io.rememberSiteLogin) await io.rememberSiteLogin(cred).catch(() => undefined);
    after = res.action ?? 'signed-in';
    await io.sleep(settle);
    const now = await safe(io.send({ type: 'AF_GET_PAGE_STATE' }));
    if (now && !now.loginRequired && after !== 'created' && after !== 'opened-signin' && after !== 'opened-signup') return 'signed';
  }
  return attention(io, `${site} still wants you to sign in. Finish signing in on the page, then press Continue.`, title) as 'stopped';
}

export function mergeProposals(prev: FieldProposal[], next: FieldProposal[]): FieldProposal[] {
  const answered = (p: FieldProposal | undefined) => Boolean(p && (p.status === 'filled' || p.status === 'user-completed'));
  const merged = next.map((p) => {
    const old = prev.find((x) => x.fieldId === p.fieldId);
    return p.action === 'skip' && answered(old) ? old! : p;
  });
  return [...prev.filter((x) => !next.some((p) => p.fieldId === x.fieldId)), ...merged];
}

export async function processStep(io: RunnerIO): Promise<'ready' | 'next' | 'moved' | 'stopped'> {
  const s0 = io.session();
  if (!s0) return attention(io, 'Open the Dice job first.');
  patch(io, { status: 'working', label: 'Reading this step…', need: null });
  let page = await safe(io.send({ type: 'AF_GET_PAGE_STATE' }));
  if (page && (leftThisJob(page, s0) || verifyAgainstSession(io, page)?.verdict === 'mismatch')) {
    const back = await returnToJob(io, page);
    if (back === 'stopped') return 'stopped';
    page = back;
    if (!page.hasApplicationForm) {
      const opened = await ensureApplicationOpen(io);
      if (opened !== 'open') return 'stopped';
    } else if (formOpened(io, page) === 'stopped') {
      return 'stopped';
    }
  }
  let scan: ScanResponse | null = await safe(io.send({ type: 'AF_SCAN_FIELDS' }));
  if (!scan) return attention(io, 'ApplyFlow can’t reach this page. Reload it and press Continue.');
  const site = scan.siteName || 'the site';
  if (scan.blocker) {
    stopFor(io, scan.blocker);
    return 'stopped';
  }
  if (scan.captchaDetected) return attention(io, `${site} is showing a CAPTCHA. Complete it on the page, then press Continue.`, 'Complete the CAPTCHA');
  if (scan.loginRequired) {
    const page = await safe(io.send({ type: 'AF_GET_PAGE_STATE' }));
    if (page) {
      const signed = await trySignIn(io, page);
      if (signed === 'signed') {
        scan = (await safe(io.send({ type: 'AF_SCAN_FIELDS' }))) ?? scan;
        if (scan.loginRequired) return attention(io, `${site} still wants you to sign in. Check the password under Profile → Job site logins, then press Continue.`, `Sign in to ${site}`);
      } else if (signed === 'stopped') return 'stopped';
      else return attention(io, `${site} wants you to sign in. Sign in on the page, then press Continue.`, `Sign in to ${site}`);
    } else {
      return attention(io, `${site} wants you to sign in. Sign in on the page, then press Continue.`, `Sign in to ${site}`);
    }
  }
  if (!scan.formFound) return attention(io, scan.error ?? 'No application form is visible.');
  if (!scan.ok) return attention(io, scan.error ?? 'Dice changed this page layout, so I could not safely identify the application fields.');
  await learnFinishedStep(io, scan);
  const here = stepKey(scan.pageUrl, scan.step);
  if (io.state().lastStepKey !== here) {
    const a = io.state().attachments;
    patch(io, { attachments: { resume: { ...a.resume, tries: 0 }, coverLetter: { ...a.coverLetter, tries: 0 } } });
  }
  patch(io, { step: scan.step, lastStepKey: here });

  const slots: { kind: 'resume' | 'cover_letter'; key: 'resume' | 'coverLetter' }[] = [
    { kind: 'resume', key: 'resume' },
    { kind: 'cover_letter', key: 'coverLetter' },
  ];
  let attempted = false;
  for (const { kind, key } of slots) {
    const target = scan.uploads[key];
    if (!target.method) continue;
    const setSlot = (a: AttachState) => {
      const st = io.state();
      patch(io, { attachments: { ...st.attachments, [key]: a } });
    };
    if (kind === 'cover_letter' && !s0.includeCoverLetter) {
      setSlot({ state: 'skipped', fileName: null });
      continue;
    }
    const name = io.fileName(kind);
    if (!name) continue;
    const shown = target.currentFileName;
    const st = io.state();
    if (shown && shown !== name && !st.originalFiles[key] && st.attachments[key].state === 'pending') {
      patch(io, { originalFiles: { ...st.originalFiles, [key]: shown } });
    }
    if (shown && shown === name) {
      if (io.state().attachments[key].state !== 'done') setSlot({ state: 'done', fileName: name });
      continue;
    }
    if (kind === 'resume' && io.state().allowOriginalResume) continue;
    const prev = io.state().attachments[key];
    if ((prev.tries ?? 0) >= 3 && prev.state === 'failed') continue;
    stage(io, 'attach', 'active');
    patch(io, { label: kind === 'resume' ? 'Replacing your resume with the tailored one…' : 'Attaching your cover letter…' });
    const payload = await io.payload(kind);
    if (!payload) continue;
    attempted = true;
    let res = await safe(io.send({ type: 'AF_UPLOAD_DOCUMENT', kind, file: payload }));
    if (res && !res.ok && !res.navigated && (prev.tries ?? 0) < 2) {
      await io.sleep(600);
      res = (await safe(io.send({ type: 'AF_UPLOAD_DOCUMENT', kind, file: payload }))) ?? res;
    }
    if (res?.navigated) {
      patch(io, { label: 'The site opened the resume step…' });
      return 'moved';
    }
    setSlot(
      !res
        ? { state: 'failed', fileName: payload.name, message: 'The tab stopped responding while attaching.', tries: (prev.tries ?? 0) + 1 }
        : { state: res.ok ? (res.verified ? 'done' : 'unverified') : 'failed', fileName: payload.name, message: res.message, tries: (prev.tries ?? 0) + 1 },
    );
  }
  if (attempted) {
    const a = io.state().attachments;
    stage(io, 'attach', a.resume.state === 'failed' || a.coverLetter.state === 'failed' ? 'error' : 'done');
    if (scan.parsesResume && a.resume.state !== 'failed') {
      patch(io, { label: `Waiting for ${site} to read your resume…` });
      await io.sleep(Math.min(3500, (io.pollMs ?? 400) * 9));
    }
    scan = (await safe(io.send({ type: 'AF_SCAN_FIELDS' }))) ?? scan;
    if (stepKey(scan.pageUrl, scan.step) !== here) return 'moved';
  } else if (io.state().stages.attach === 'active') {
    stage(io, 'attach', 'done');
  }

  patch(io, { label: 'Filling in your details…' });
  const exactAnswers: Record<string, string> = {};
  if (io.exactAnswer) {
    for (const f of scan.fields) {
      if (f.control === 'file' || f.currentValue.trim() || !f.label.trim() || f.sensitive === 'legal_consent') continue;
      const value = await io.exactAnswer({ question: f.label, options: f.options, control: f.control }).catch(() => null);
      if (value?.trim()) exactAnswers[f.fieldId] = value.trim();
    }
  }
  const learned = io.fillContext ? await io.fillContext().catch(() => null) : null;
  const ctx = {
    profile: io.profile,
    resume: s0.resume,
    coverLetter: s0.coverLetter,
    includeCoverLetter: s0.includeCoverLetter,
    resumeFileName: io.fileName('resume'),
    coverLetterFileName: io.fileName('cover_letter'),
    useSavedAnswers: io.settings.autoFillSavedAnswers,
    overwrite: scan.parsesResume && attempted ? (['first_name', 'last_name', 'full_name', 'email', 'phone'] as FieldSemantic[]) : undefined,
    exactAnswers,
    blockedQuestions: io.blockedQuestions ? await io.blockedQuestions() : [],
    facts: learned?.facts,
    longFormDrafts: learned?.drafts,
    jobCountry: countryFromLocation(s0.job.location),
    learnDemographics: io.settings.learnDemographics !== false,
  };
  let proposals = proposeFieldValues(scan.fields, ctx).map((p) => ({ ...p, stepUrl: scan!.pageUrl }));
  const fills: FillInstruction[] = [];
  for (const p of proposals) {
    const f = scan.fields.find((x) => x.fieldId === p.fieldId);
    const correcting = Boolean(f?.currentValue && ctx.overwrite?.includes(p.semantic));
    if (p.action === 'fill' && p.proposedValue && (!f?.currentValue || correcting)) {
      fills.push({
        fieldId: p.fieldId,
        kind: 'value',
        value: p.proposedValue,
        suggest: p.semantic === 'location' || p.semantic === 'city' || p.semantic === 'state' || p.semantic === 'country' || p.semantic === 'street' ? true : undefined,
      });
    }
  }
  if (fills.length) {
    const res = await safe(io.send({ type: 'AF_FILL_FIELDS', instructions: fills }));
    proposals = proposals.map((p) => {
      const r = res?.results.find((x) => x.fieldId === p.fieldId);
      return r ? { ...p, status: r.ok ? 'filled' : 'failed', error: r.ok ? undefined : r.error } : p;
    });
  }
  for (const p of proposals.filter((x) => x.action === 'answer')) {
    const r = await safe(io.send({ type: 'AF_ANSWER_FIELD', fieldId: p.fieldId, value: p.proposedValue }));
    proposals = proposals.map((x) => (x.fieldId === p.fieldId ? { ...x, status: r?.ok ? 'filled' : 'failed', error: r?.ok ? undefined : r?.error } : x));
  }
  if (io.recordAccepted) {
    const accepted = proposals.filter((p) => p.action === 'answer' && p.status === 'filled' && p.proposedValue.trim() && p.sensitive !== 'legal_consent' && p.source !== 'Your verified answer');
    if (accepted.length) {
      await io.recordAccepted(accepted.map((p) => ({
        question: p.label.trim().slice(0, 220),
        answer: p.proposedValue.trim(),
        category: p.sensitive ?? 'general',
        options: p.options ?? [],
        control: p.control,
      })));
    }
  }
  if (fills.length || proposals.some((p) => p.action === 'answer')) scan = (await safe(io.send({ type: 'AF_SCAN_FIELDS' }))) ?? scan;

  const s1 = io.session() ?? s0;
  await io.saveSession({ ...s1, fieldProposals: mergeProposals(s1.fieldProposals, proposals), lastScanUrl: scan.pageUrl });
  return decide(io, scan, proposals, false);
}

async function learnFinishedStep(io: RunnerIO, scan: ScanResponse): Promise<void> {
  if (!io.learnPage) return;
  const cap = await safe(io.send({ type: 'AF_READ_CAPTURE' }));
  if (!cap) return;
  const here = `${scan.pageUrl}#${scan.step ? `${scan.step.current}/${scan.step.total}` : '-'}`;
  if (cap.stepKey === here) return;
  const items: PageLearnItem[] = [];
  for (const field of cap.fields) {
    const kind = classifyCapture({ ...field, rejected: field.rejected });
    if (kind !== 'verified' && kind !== 'correction' && kind !== 'accepted') continue;
    const fact = matchFactQuestion(field.label);
    const jobCountry = countryFromLocation(io.session()?.job.location);
    const factKey = fact ? resolvedFactKey(fact, jobCountry) : null;
    items.push({
      kind: kind === 'accepted' ? 'accepted' : kind,
      question: field.label.trim().slice(0, 220),
      answer: field.finalValue.trim(),
      control: field.control,
      options: field.options,
      category: field.sensitive ?? 'general',
      longForm: isLongFormQuestion(field.label, field.control),
      platform: scan.siteName ?? null,
      jobTitle: io.session()?.job.title ?? null,
      company: io.session()?.job.company ?? null,
      country: fact?.country === 'job' ? jobCountry : fact?.country && fact.country !== 'job' ? fact.country : jobCountry,
      factKey,
      factLabel: factKey ? field.label.trim().slice(0, 80) : null,
      optionsKey: field.options.length ? optionsKey(field.options) : null,
    });
  }
  await safe(io.send({ type: 'AF_CLEAR_CAPTURE' }));
  if (!items.length) return;
  const result = await io.learnPage(items).catch(() => null);
  if (!result) return;
  const previousAnswers = io.profile.approvedAnswers;
  if (result.profileAnswers.length && io.saveProfile) {
    let answers = previousAnswers;
    for (const a of result.profileAnswers) {
      const control = toScreeningControl(a.control as FieldProposal['control']);
      answers = rememberAnswer(answers, { category: a.category as CareerProfile['approvedAnswers'][number]['category'], questionPattern: a.questionPattern, answer: a.answer, control, options: a.options.length ? a.options : undefined }, () => `ans_${Math.random().toString(36).slice(2, 10)}`, new Date().toISOString());
    }
    await io.saveProfile({ ...io.profile, approvedAnswers: answers });
  }
  patch(io, {
    learned: { count: items.filter((i) => i.kind !== 'accepted').length, longFormIds: result.longFormIds, previousAnswers },
    factPrompts: result.prompts,
  });
}

function decide(io: RunnerIO, scan: ScanResponse, proposals: FieldProposal[], includeOptional: boolean): 'ready' | 'next' | 'stopped' {
  const failed = proposals.filter((p) => p.status === 'failed');
  if (failed.length) return attention(io, failed.map((p) => `${p.label}: ${p.error ?? 'The page did not accept this value.'}`).join(' · '));
  const empty = scan.fields.filter((f) => !f.currentValue.trim() && f.control !== 'file');
  const byId = (id: string) => proposals.find((p) => p.fieldId === id);
  const asQuestion = (f: ScanResponse['fields'][number]): FieldProposal =>
    ({ ...(byId(f.fieldId) ?? { fieldId: f.fieldId, label: f.label, control: f.control, semantic: 'unknown', action: 'manual', proposedValue: '', source: 'You', confidence: 'low', required: f.required, sensitive: f.sensitive, reason: '', approvedSuggestion: null, status: 'pending' }), options: f.options.length ? f.options : undefined, required: f.required || includeOptional });
  const questions = empty.filter((f) => f.required || includeOptional).map(asQuestion);
  const here = new Set(scan.fields.map((f) => f.label));
  const earlier = io.state().optional.filter((o) => !here.has(o.label));
  const optional = [...earlier, ...(includeOptional ? [] : empty.filter((f) => !f.required).map(asQuestion))];
  patch(io, { questions, optional });
  if (questions.length) {
    stage(io, 'questions', 'active');
    patch(io, {
      status: 'questions',
      label: questions.length === 1 ? '1 question needs your answer' : `${questions.length} questions need your answer`,
      message: scan.pageErrors.length ? scan.pageErrors.join(' · ') : null,
    });
    return 'stopped';
  }
  if (io.state().stages.questions === 'active') stage(io, 'questions', 'done');
  const r = io.state();
  if (scan.uploads.resume.method && r.attachments.resume.state === 'failed' && !r.allowOriginalResume) {
    stage(io, 'attach', 'error');
    return attention(io, r.attachments.resume.message ?? `ApplyFlow couldn’t attach your resume on ${scan.siteName || 'the page'} automatically.`, 'Attach your tailored resume', 'resume');
  }
  if (scan.submitControlFound && scan.canSubmit === false) {
    if (io.state().stages.questions === 'todo') stage(io, 'questions', 'skipped');
    const st = io.state();
    io.report({
      ...st,
      status: 'attention',
      label: `Finish on ${scan.siteName || 'the employer’s site'}`,
      message: `ApplyFlow filled what it safely could and attached your documents. Check the page, answer anything left, and press its Submit button yourself — ApplyFlow records the application when ${scan.siteName || 'the site'} confirms it.`,
      need: null,
      stages: { ...st.stages, attach: st.stages.attach === 'todo' ? 'skipped' : st.stages.attach, review: 'active' },
    });
    return 'stopped';
  }
  if (scan.submitControlFound) {
    if (io.state().stages.questions === 'todo') stage(io, 'questions', 'skipped');
    const st = io.state();
    const notOffered = (a: AttachState): AttachState => (a.state === 'pending' ? { ...a, state: 'not_offered' } : a);
    io.report({
      ...st,
      status: 'ready',
      label: 'Ready to submit',
      message: null,
      stages: { ...st.stages, attach: st.stages.attach === 'todo' ? 'skipped' : st.stages.attach, review: 'active' },
      attachments: { resume: notOffered(st.attachments.resume), coverLetter: notOffered(st.attachments.coverLetter) },
    });
    return 'ready';
  }
  if (scan.nextControlLabel) return 'next';
  return attention(io, `ApplyFlow can’t find the Next or Submit button on this step. Continue on the page — ApplyFlow picks up on the next step.`);
}

async function waitForForm(io: RunnerIO): Promise<boolean> {
  const poll = io.pollMs ?? 400;
  for (let i = 0; i < Math.ceil(12000 / poll); i++) {
    if (io.aborted()) return false;
    await io.sleep(poll);
    const s = await safe(io.send({ type: 'AF_GET_PAGE_STATE' }));
    if (s?.hasApplicationForm) return true;
  }
  return false;
}

export async function runSteps(io: RunnerIO): Promise<'ready' | 'stopped'> {
  for (let i = 0; i < 12; i++) {
    if (io.aborted()) return 'stopped';
    const r = await processStep(io);
    if (r === 'moved') {
      await io.sleep(io.pollMs ?? 400);
      continue;
    }
    if (r !== 'next') return r;
    if (!io.settings.autoAdvanceSteps) {
      patch(io, { status: 'attention', label: 'Step complete', message: 'This step is done. Press Continue to go to the next one.' });
      return 'stopped';
    }
    patch(io, { status: 'working', label: 'Going to the next step…' });
    const nx = await safe(io.send({ type: 'AF_NEXT_STEP' }));
    if (!nx) {
      if (!(await waitForForm(io))) return attention(io, 'The next step is loading. Press Continue when it’s on screen.');
      continue;
    }
    if (!nx.ok) return attention(io, nx.message);
    if (!nx.advanced) {
      const scan = await safe(io.send({ type: 'AF_SCAN_FIELDS' }));
      if (scan?.ok && scan.formFound) {
        const s = io.session();
        const proposals = s ? s.fieldProposals : [];
        const r2 = decide(io, { ...scan, pageErrors: nx.pageErrors.length ? nx.pageErrors : scan.pageErrors }, proposals, true);
        if (r2 !== 'next') return r2 === 'ready' ? 'ready' : 'stopped';
      }
      return attention(io, nx.pageErrors.length ? `The page says: ${nx.pageErrors.join(' · ')}` : 'The page didn’t move to the next step. Check it, then press Continue.');
    }
    await io.sleep(io.pollMs ?? 400);
  }
  return attention(io, 'This application has more steps than expected. Continue on the Dice page.');
}
