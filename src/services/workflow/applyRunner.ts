/**
 * Quick Apply runner: walks Dice's application wizard step by step.
 *
 *   open the application → per step: attach the tailored resume / cover letter, fill safe
 *   profile fields and answers the user saved → stop for questions only the user can answer →
 *   press Next → … → stop at the step that has Dice's Submit button.
 *
 * It never presses Submit. Submitting is a separate, explicit user action (the panel's
 * "Submit application" button, after the review summary), with a one-time token.
 * Independent of React and chrome.* so it can be tested against the content controller.
 */
import type { CareerProfile, FieldProposal, FieldSemantic, FillInstruction, JobSession, PageBlocker, PageState, Settings } from '@/types';
import type { ContentResponseMap, FilePayload, PanelToContent, ScanResponse } from '@/types/messages';
import { proposeFieldValues } from '@/services/forms/mapper';
import { formKeyFor } from '@/services/platforms/registry';

export type StageKey = 'documents' | 'open' | 'attach' | 'questions' | 'review';
export type StageState = 'todo' | 'active' | 'done' | 'skipped' | 'error';

export interface AttachState {
  state: 'pending' | 'done' | 'unverified' | 'failed' | 'skipped' | 'not_offered';
  fileName: string | null;
  message?: string;
  /** How many times ApplyFlow tried to attach it on the current page. */
  tries?: number;
  /** Attached on Dice by the user rather than by ApplyFlow. */
  byUser?: boolean;
}

export type RunStatus = 'idle' | 'working' | 'questions' | 'attention' | 'ready' | 'external' | 'submitting' | 'submitted';

export interface ApplyRunState {
  status: RunStatus;
  /** What ApplyFlow is doing right now, or what it needs. */
  label: string;
  stages: Record<StageKey, StageState>;
  /** Required questions only the user can answer (shown as one-tap cards). */
  questions: FieldProposal[];
  /** Optional questions left blank. */
  optional: FieldProposal[];
  attachments: { resume: AttachState; coverLetter: AttachState };
  /** Message from Dice or ApplyFlow when status is 'attention'. */
  message: string | null;
  externalUrl: string | null;
  step: { current: number; total: number } | null;
  /** `${url}#${step}` of the last step the runner processed. */
  lastStepKey: string | null;
  submittedConfirmed: boolean;
  /** File names Dice showed before ApplyFlow changed anything (your profile resume). */
  originalFiles: { resume: string | null; coverLetter: string | null };
  /** What the user needs to do when status is 'attention'. */
  need: 'resume' | null;
  /** The user chose to send the resume already on Dice instead of the tailored one. */
  allowOriginalResume: boolean;
  /** The application form this run opened (formKeyFor its address). Other forms are never filled or submitted. */
  formKey: string | null;
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
};

type Send = <K extends PanelToContent['type']>(msg: Extract<PanelToContent, { type: K }>) => Promise<ContentResponseMap[K]>;

export interface RunnerIO {
  send: Send;
  session: () => JobSession | null;
  saveSession: (s: JobSession) => Promise<void>;
  settings: Settings;
  profile: CareerProfile;
  payload: (kind: 'resume' | 'cover_letter') => Promise<FilePayload | null>;
  fileName: (kind: 'resume' | 'cover_letter') => string | null;
  sleep: (ms: number) => Promise<void>;
  aborted: () => boolean;
  state: () => ApplyRunState;
  report: (next: ApplyRunState) => void;
  /** Polls while waiting for Dice (page loads, step changes). */
  pollMs?: number;
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

/** Stop for a page that can't be applied on; 'external' when the documents are all the user needs. */
function stopFor(io: RunnerIO, b: PageBlocker): 'external' | 'stopped' {
  if (b.kind === 'unsupported' || b.kind === 'referral') {
    stage(io, 'open', 'skipped');
    patch(io, { status: 'external', label: b.kind === 'referral' ? 'Jobright referral role' : 'Apply on the employer’s site yourself', message: b.message, externalUrl: null });
    return 'external';
  }
  stage(io, 'open', 'error');
  return attention(io, b.message, b.kind === 'closed' ? 'Job closed' : 'Already applied');
}

const siteOf = (s: Pick<PageState, 'siteName'> | null | undefined) => s?.siteName || 'the site';

/** The form is open: tie the run to it, or stop if it's a different application than the one this run opened. */
function formOpened(io: RunnerIO, st: PageState): 'open' | 'stopped' {
  const key = formKeyFor(st.url);
  const prev = io.state().formKey;
  if (prev && prev !== key) {
    return attention(io, `This page isn’t the application ApplyFlow opened for this job (${siteOf(st)}). Go back to that application to continue, or open the job you want and press Tailor & Apply there. Nothing was filled here.`, 'Different application');
  }
  stage(io, 'open', 'done');
  if (!prev) patch(io, { formKey: key });
  return 'open';
}

/**
 * Make sure the application form is on screen. On Dice: Dice's Apply button. From Jobright it can take
 * a few hops — Jobright's Apply → the employer's job page (or a careers page with the form in a frame)
 * → the form — so each new page gets its own "open the application" step until a form appears.
 */
export async function ensureApplicationOpen(io: RunnerIO): Promise<'open' | 'external' | 'stopped'> {
  const poll = io.pollMs ?? 400;
  let st = await safe(io.send({ type: 'AF_GET_PAGE_STATE' }));
  if (st?.blocker) return stopFor(io, st.blocker);
  if (st?.hasApplicationForm) return formOpened(io, st);
  stage(io, 'open', 'active');
  patch(io, { status: 'working', label: 'Opening the application…' });
  const multiHop = st?.site !== 'dice';
  const settleMs = Math.min(2500, poll * 6);
  let direct = false;
  let lastPressed = '';
  /** Presses on Jobright that led nowhere, by label: the same one twice means ApplyFlow is going in circles. */
  const idle = new Map<string, number>();
  for (let hop = 0; hop < (multiHop ? 6 : 1); hop++) {
    if (io.aborted()) return 'stopped';
    const before = st?.url ?? '';
    const open = await safe(io.send({ type: 'AF_OPEN_APPLICATION', direct }));
    if (!open) return attention(io, 'ApplyFlow can’t reach this page. Reload it and try again.');
    if (!open.ok) {
      if (open.blocker) return stopFor(io, open.blocker);
      if (open.external) {
        stage(io, 'open', 'skipped');
        patch(io, { status: 'external', label: 'Applies on the employer’s site', message: open.message, externalUrl: open.externalUrl ?? null });
        return 'external';
      }
      // Jobright without a usable Apply button: go straight to the employer's posting when the page names it.
      if (st?.site === 'jobright' && !direct) {
        direct = true;
        continue;
      }
      stage(io, 'open', 'error');
      return attention(io, open.message);
    }
    if (multiHop) patch(io, { label: open.message });
    // Wait for the form — or for a new page (the employer's) that needs its own step.
    let movedAt = 0;
    let lastUrl = before;
    const started = Date.now();
    for (let i = 0; i < Math.ceil(25000 / poll); i++) {
      if (io.aborted()) return 'stopped';
      await io.sleep(poll);
      const s = await safe(io.send({ type: 'AF_GET_PAGE_STATE' }));
      if (!s) continue; // the page is loading
      st = s;
      if (s.loginRequired) return attention(io, `${siteOf(s)} wants you to sign in. Sign in on the page, then press Continue.`, `Sign in to ${siteOf(s)}`);
      if (s.captchaDetected) return attention(io, `${siteOf(s)} is showing a CAPTCHA. Complete it on the page, then press Continue.`, 'Complete the CAPTCHA');
      if (s.blocker) return stopFor(io, s.blocker);
      if (s.hasApplicationForm) return formOpened(io, s);
      if (!multiHop) continue;
      if (s.url !== lastUrl) {
        lastUrl = s.url;
        movedAt = Date.now();
        continue;
      }
      // A new page without a form, settled: open the application from there.
      if (movedAt && Date.now() - movedAt >= settleMs) break;
      // Jobright asked something in a dialog ("Customize your resume?"): answer it now.
      if (s.pendingChoice && s.site === 'jobright' && Date.now() - started >= poll * 2) break;
      // Nothing happened after pressing Apply (Jobright): use the employer's posting address next.
      if (!movedAt && Date.now() - started >= Math.max(settleMs * 2, poll * 12)) {
        if (s.site === 'jobright') direct = true;
        break;
      }
    }
    if (!movedAt && st?.site === 'jobright' && !st.pendingChoice) {
      const n = (idle.get(open.message) ?? 0) + 1;
      idle.set(open.message, n);
      if (n >= 2) {
        stage(io, 'open', 'error');
        return attention(
          io,
          'Jobright didn’t open the employer’s application. On the Jobright page, press Apply; if Jobright offers to customize your resume, choose “Apply Without Customizing”. When the employer’s page opens here, press Continue.',
          'Open the application on Jobright',
        );
      }
    }
    // Same address: go on only if the page offered a new step (e.g. Workday's "Apply" → "Apply Manually").
    if (!movedAt && !direct && st?.site !== 'jobright') {
      if (open.message === lastPressed) break;
      lastPressed = open.message;
    }
  }
  stage(io, 'open', 'error');
  return attention(io, st?.site === 'dice' || !multiHop ? 'Dice didn’t open its application form. Click Dice’s Apply button, then press Continue.' : `ApplyFlow couldn’t reach the application form on ${siteOf(st)}. Open it on the page (its Apply button), then press Continue.`);
}

/** Newer scans win, except that a field ApplyFlow or the user answered stays recorded as answered (a rescan sees it as "already filled"). */
export function mergeProposals(prev: FieldProposal[], next: FieldProposal[]): FieldProposal[] {
  const answered = (p: FieldProposal | undefined) => Boolean(p && (p.status === 'filled' || p.status === 'user-completed'));
  const merged = next.map((p) => {
    const old = prev.find((x) => x.fieldId === p.fieldId);
    return p.action === 'skip' && answered(old) ? old! : p;
  });
  return [...prev.filter((x) => !next.some((p) => p.fieldId === x.fieldId)), ...merged];
}

/** Attach documents, fill what's safe, and decide what this step needs next. 'moved' = Dice went to another step. */
export async function processStep(io: RunnerIO): Promise<'ready' | 'next' | 'moved' | 'stopped'> {
  const s0 = io.session();
  if (!s0) return attention(io, 'Open the Dice job first.');
  patch(io, { status: 'working', label: 'Reading this step…', need: null });
  let scan: ScanResponse | null = await safe(io.send({ type: 'AF_SCAN_FIELDS' }));
  if (!scan) return attention(io, 'ApplyFlow can’t reach this page. Reload it and press Continue.');
  const site = scan.siteName || 'the site';
  if (scan.blocker) {
    stopFor(io, scan.blocker);
    return 'stopped';
  }
  if (scan.captchaDetected) return attention(io, `${site} is showing a CAPTCHA. Complete it on the page, then press Continue.`, 'Complete the CAPTCHA');
  if (scan.loginRequired) return attention(io, `${site} wants you to sign in. Sign in on the page, then press Continue.`, `Sign in to ${site}`);
  if (!scan.formFound) return attention(io, scan.error ?? 'No application form is visible.');
  if (!scan.ok) return attention(io, scan.error ?? 'Dice changed this page layout, so I could not safely identify the application fields.');
  const here = stepKey(scan.pageUrl, scan.step);
  if (io.state().lastStepKey !== here) {
    // New page: earlier failed attempts may succeed here.
    const a = io.state().attachments;
    patch(io, { attachments: { resume: { ...a.resume, tries: 0 }, coverLetter: { ...a.coverLetter, tries: 0 } } });
  }
  patch(io, { step: scan.step, lastStepKey: here });

  // ---- documents ----
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
    // Remember what Dice showed before ApplyFlow changed anything (the profile resume).
    if (shown && shown !== name && !st.originalFiles[key] && st.attachments[key].state === 'pending') {
      patch(io, { originalFiles: { ...st.originalFiles, [key]: shown } });
    }
    if (shown && shown === name) {
      if (io.state().attachments[key].state !== 'done') setSlot({ state: 'done', fileName: name });
      continue;
    }
    // The user replaced it on Dice themselves (e.g. with the copy in Downloads).
    if (kind === 'resume' && io.state().allowOriginalResume) continue;
    const prev = io.state().attachments[key];
    if ((prev.tries ?? 0) >= 3 && prev.state === 'failed') continue; // retry a few times across DOM variants
    stage(io, 'attach', 'active');
    patch(io, { label: kind === 'resume' ? 'Replacing your resume with the tailored one…' : 'Attaching your cover letter…' });
    const payload = await io.payload(kind);
    if (!payload) continue;
    attempted = true;
    let res = await safe(io.send({ type: 'AF_UPLOAD_DOCUMENT', kind, file: payload }));
    // One immediate retry when the first attempt fails without navigating (dynamic upload widgets).
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
      // Lever (and many other employer forms) read the resume and fill fields themselves: let them finish first.
      patch(io, { label: `Waiting for ${site} to read your resume…` });
      await io.sleep(Math.min(3500, (io.pollMs ?? 400) * 9));
    }
    scan = (await safe(io.send({ type: 'AF_SCAN_FIELDS' }))) ?? scan;
    if (stepKey(scan.pageUrl, scan.step) !== here) return 'moved';
  } else if (io.state().stages.attach === 'active') {
    stage(io, 'attach', 'done');
  }

  // ---- fields ----
  patch(io, { label: 'Filling in your details…' });
  const ctx = {
    profile: io.profile,
    resume: s0.resume,
    coverLetter: s0.coverLetter,
    includeCoverLetter: s0.includeCoverLetter,
    resumeFileName: io.fileName('resume'),
    coverLetterFileName: io.fileName('cover_letter'),
    useSavedAnswers: io.settings.autoFillSavedAnswers,
    // Sites that read the resume may have filled these wrongly: your profile wins.
    // Only right after attaching on this pass — later passes must never undo your own edits.
    overwrite: scan.parsesResume && attempted ? (['first_name', 'last_name', 'full_name', 'email', 'phone'] as FieldSemantic[]) : undefined,
  };
  let proposals = proposeFieldValues(scan.fields, ctx).map((p) => ({ ...p, stepUrl: scan!.pageUrl }));
  const fills: FillInstruction[] = [];
  for (const p of proposals) {
    const f = scan.fields.find((x) => x.fieldId === p.fieldId);
    const correcting = Boolean(f?.currentValue && ctx.overwrite?.includes(p.semantic));
    if (p.action === 'fill' && p.proposedValue && (!f?.currentValue || correcting)) {
      fills.push({ fieldId: p.fieldId, kind: 'value', value: p.proposedValue, suggest: p.semantic === 'location' || p.semantic === 'city' ? true : undefined });
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
  if (fills.length || proposals.some((p) => p.action === 'answer')) scan = (await safe(io.send({ type: 'AF_SCAN_FIELDS' }))) ?? scan;

  const s1 = io.session() ?? s0;
  await io.saveSession({ ...s1, fieldProposals: mergeProposals(s1.fieldProposals, proposals), lastScanUrl: scan.pageUrl });
  return decide(io, scan, proposals, false);
}

/** What the step still needs after ApplyFlow did its part. */
function decide(io: RunnerIO, scan: ScanResponse, proposals: FieldProposal[], includeOptional: boolean): 'ready' | 'next' | 'stopped' {
  const empty = scan.fields.filter((f) => !f.currentValue.trim() && f.control !== 'file');
  const byId = (id: string) => proposals.find((p) => p.fieldId === id);
  const asQuestion = (f: ScanResponse['fields'][number]): FieldProposal =>
    ({ ...(byId(f.fieldId) ?? { fieldId: f.fieldId, label: f.label, control: f.control, semantic: 'unknown', action: 'manual', proposedValue: '', source: 'You', confidence: 'low', required: f.required, sensitive: f.sensitive, reason: '', approvedSuggestion: null, status: 'pending' }), options: f.options.length ? f.options : undefined, required: f.required || includeOptional });
  const questions = empty.filter((f) => f.required || includeOptional).map(asQuestion);
  // Optional questions left blank on earlier steps stay listed for the review.
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
  // Never move on (or submit) while Dice still holds the old resume on this step.
  const r = io.state();
  if (scan.uploads.resume.method && r.attachments.resume.state === 'failed' && !r.allowOriginalResume) {
    stage(io, 'attach', 'error');
    return attention(io, r.attachments.resume.message ?? `ApplyFlow couldn’t attach your resume on ${scan.siteName || 'the page'} automatically.`, 'Attach your tailored resume', 'resume');
  }
  if (scan.submitControlFound && scan.canSubmit === false) {
    // Best-effort sites: ApplyFlow filled what it could; the person reviews and submits there.
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
    // Dice offered no upload slot on any step: say so in the review rather than claim it was attached.
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

/** Wait until the tab shows an application form again (after a full page load). */
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

/** Run the wizard from the current step until it needs the user or reaches Submit. */
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
      // The tab reloaded while moving on (full navigation): wait for the next step to appear.
      if (!(await waitForForm(io))) return attention(io, 'The next step is loading. Press Continue when it’s on screen.');
      continue;
    }
    if (!nx.ok) return attention(io, nx.message);
    if (!nx.advanced) {
      // Dice refused to move on: show every empty question on the step, with Dice's own message.
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
