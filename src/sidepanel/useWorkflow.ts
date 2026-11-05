import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApplicationRecord, ApplicationStage, ApprovedAnswer, CareerProfile, CoverLetterAction, CoverLetterTone, FieldProposal,
  JobPosting, JobSession, MasterResume, PageState, ProgressPhase, SavedFile, Settings, TailoredResume,
} from '@/types';
import { PROGRESS_LABELS } from '@/types';
import type { Messenger } from '@/services/messaging';
import { TabUnreachableError } from '@/services/messaging';
import { getApiKey } from '@/storage/settingsStore';
import { onDataChange } from '@/storage/events';
import { formKeyFor } from '@/services/platforms/registry';
import { ensureSiteCredential, saveSiteCredential, getApplication, getSession, latestSession, listApplications, saveApplication, saveProfile, saveSession } from '@/storage/repositories';
import { planAts, runAnalysis, runCoverLetter, runDocuments, revalidateEdited, revalidateLetter, scanTailored, scoreMaster, scoreTailored, type EngineDeps } from '@/services/workflow/engine';
import { saveResume } from '@/storage/repositories';
import { parseCheckPdf } from '@/services/ats/parseCheck';
import { classifySkills, supportedKeywords } from '@/services/matching/evidence';
import { missingQualifications } from '@/services/analysis/localAnalyzer';
import { applyAutoFixes } from '@/services/tailoring/autofix';
import { masterStamp } from '@/services/resume/facts';
import { validateTailoredResume } from '@/services/tailoring/validator';
import { findDuplicates, hasApplied, recordFromSession, type DuplicateCheck } from '@/services/history/history';
import { buildAllDocs, uploadFileName, uploadPayload } from '@/services/export/bundle';
import { folderFor, planApplicationFiles } from '@/services/downloads/planner';
import { downloadFiles, showInFolder, type DownloadsApi } from '@/services/downloads/downloader';
import { ensureApplicationOpen, INITIAL_RUN, leftThisJob, processStep, returnUrl, runSteps, stepKey, type ApplyRunState, type RunnerIO } from '@/services/workflow/applyRunner';
import { rememberAnswer, toScreeningControl } from '@/services/forms/mapper';
import { ClaudeError } from '@/services/claude/errors';
import { newId, newToken } from '@/utils/id';
import { addDays, nowIso, todayLocal } from '@/utils/dates';
import { bridge, DICE_TAB_ID } from '@/platform/bridge';
import { toResumeDocument, renderResumePdf } from '@/resume-renderer';

async function storeDocuments(s: JobSession, applicationId: string | null, paths: { resume?: string | null; cover_letter?: string | null } = {}): Promise<void> {
  const b = bridge();
  if (!b || !s.resume) return;
  const meta = { jobTitle: s.job.title, company: s.job.company, jobUrl: s.job.url };
  const letter = s.includeCoverLetter ? s.coverLetter : null;
  await b.invoke('documents.upsert', { applicationId, jobKey: s.jobKey, kind: 'resume', version: s.resume.version, json: JSON.stringify(toResumeDocument(s.resume, letter, meta)), engine: s.resume.engine, model: s.resume.model, filePath: paths.resume ?? null, format: paths.resume ? paths.resume.split('.').pop() ?? null : null });
  if (letter) {
    await b.invoke('documents.upsert', { applicationId, jobKey: s.jobKey, kind: 'cover_letter', version: letter.version, json: JSON.stringify(toResumeDocument(s.resume, letter, meta)), engine: letter.engine, model: letter.model, filePath: paths.cover_letter ?? null, format: paths.cover_letter ? paths.cover_letter.split('.').pop() ?? null : null });
  }
}

export type PanelView = 'home' | 'match' | 'documents' | 'history' | 'settings';

export interface Notice {
  id: string;
  tone: 'critical' | 'warning' | 'info' | 'success';
  text: string;
}

export interface WorkflowDeps {
  messenger: Messenger;
  downloads?: DownloadsApi | null;
  engine?: Partial<EngineDeps>;
  pinnedTabId?: number | null;
  pollMs?: number;
}

export interface WorkflowInputs {
  settings: Settings;
  resumes: MasterResume[];
  profile: CareerProfile;
}

function newSession(job: JobPosting, extraction: JobSession['extraction'], resumeId: string | null, includeCoverLetter: boolean): JobSession {
  const now = nowIso();
  return {
    jobKey: job.jobKey,
    job,
    extraction,
    jobConfirmed: !extraction.uncertain,
    resumeId,
    analysis: null,
    evidence: [],
    masterScore: null,
    tailoredScore: null,
    resume: null,
    coverLetter: null,
    resumeReviewed: false,
    coverLetterReviewed: false,
    includeCoverLetter,
    fieldProposals: [],
    lastScanUrl: null,
    duplicateAcknowledged: false,
    applicationId: null,
    submittedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

const errText = (e: unknown, fallback: string) => (e instanceof ClaudeError || e instanceof TabUnreachableError ? e.message : e instanceof Error && e.message ? e.message : fallback);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const docsStamp = (s: JobSession) => `${s.resume?.version ?? 0}|${s.includeCoverLetter ? (s.coverLetter?.version ?? 0) : 'none'}`;
const uploadExt = (settings: Settings): 'pdf' | 'docx' => (!settings.resumeOutputFormats.includes('pdf') && settings.resumeOutputFormats.includes('docx') ? 'docx' : 'pdf');

function syncOpeningOverlay(run: ApplyRunState): void {
  if (typeof document === 'undefined') return;
  const show = run.status === 'working' && run.stages.open === 'active';
  const label = 'Opening your application…';
  if (show) document.documentElement.dataset.afOpening = label;
  else delete document.documentElement.dataset.afOpening;
  window.dispatchEvent(new CustomEvent('af:opening', { detail: { show, label } }));
}

export function useWorkflow(inputs: WorkflowInputs, deps: WorkflowDeps) {
  const { settings, resumes, profile } = inputs;
  const [tabId, setTabId] = useState<number | null>(deps.pinnedTabId ?? null);
  const [page, setPage] = useState<PageState | null>(null);
  const [session, setSessionState] = useState<JobSession | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ProgressPhase>('idle');
  const [statusLine, setStatusLine] = useState('');
  const [lastResult, setLastResult] = useState<string>('');
  const [notices, setNotices] = useState<Notice[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateCheck | null>(null);
  const [application, setApplication] = useState<ApplicationRecord | null>(null);
  const [view, setView] = useState<PanelView>('home');
  const [tone, setTone] = useState<CoverLetterTone>(settings.defaultCoverLetterTone);
  const [run, setRun] = useState<ApplyRunState>(INITIAL_RUN);

  const abortRef = useRef<AbortController | null>(null);
  const saveFilesRef = useRef<(rec: ApplicationRecord, s: JobSession, kinds?: SavedFile['kind'][]) => Promise<ApplicationRecord>>(async (r) => r);
  const sessionRef = useRef<JobSession | null>(null);
  const runRef = useRef<ApplyRunState>(INITIAL_RUN);
  const runningRef = useRef(false);
  const stepRef = useRef('');
  const quickApplyRef = useRef<() => Promise<void>>(async () => undefined);
  const profileRef = useRef(profile);
  sessionRef.current = session;
  profileRef.current = profile;

  const master = useMemo(() => resumes.find((r) => r.id === session?.resumeId) ?? resumes.find((r) => r.isDefault) ?? resumes[0] ?? null, [resumes, session?.resumeId]);
  const masterFromProps = master;

  const notify = useCallback((t: Notice['tone'], text: string) => setNotices((n) => [...n.filter((x) => x.text !== text), { id: newId('n'), tone: t, text }].slice(-3)), []);
  const dismiss = useCallback((id: string) => setNotices((n) => n.filter((x) => x.id !== id)), []);

  const report = useCallback((next: ApplyRunState) => {
    runRef.current = next;
    setRun(next);
    syncOpeningOverlay(next);
  }, []);

  const setSession = useCallback(async (s: JobSession | null) => {
    sessionRef.current = s;
    setSessionState(s);
    if (s) await saveSession(s);
  }, []);

  const setStep = useCallback((line: string) => {
    stepRef.current = line;
    setStatusLine(line);
    if (runningRef.current && (runRef.current.status === 'working' || runRef.current.status === 'submitting')) {
      report({ ...runRef.current, label: line });
    }
  }, [report]);

  const engineDeps = useCallback(async (): Promise<EngineDeps> => {
    if (!runningRef.current || !abortRef.current || abortRef.current.signal.aborted) abortRef.current = new AbortController();
    const b = bridge();
    const onUsage: EngineDeps['onUsage'] = b
      ? (task, model, u) => {
          const cur = sessionRef.current;
          void b.invoke('usage.add', { jobKey: cur?.jobKey ?? null, applicationId: cur?.applicationId ?? null, task, model, inputTokens: u.inputTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens, outputTokens: u.outputTokens }).catch(() => undefined);
        }
      : undefined;
    return { settings, apiKey: await getApiKey(), signal: abortRef.current.signal, onUsage, onStatus: setStep, ...deps.engine };
  }, [settings, deps.engine, setStep]);

  const upsertRecord = useCallback(async (s: JobSession, stage: ApplicationStage, extra: Partial<ApplicationRecord> = {}) => {
    const existing = s.applicationId ? await getApplication(s.applicationId) : undefined;
    const order: ApplicationStage[] = ['Saved', 'Analyzed', 'Resume Ready', 'Ready to Apply', 'Applied'];
    let stageToSet = stage;
    if (existing) {
      const ei = order.indexOf(existing.stage);
      if (ei === -1 || ei > order.indexOf(stage)) stageToSet = existing.stage;
    }
    const rec = { ...recordFromSession(s, stageToSet, existing), ...extra };
    const saved = await saveApplication(rec);
    setApplication(saved);
    const cur = sessionRef.current ?? s;
    if (cur.applicationId !== saved.id) await setSession({ ...cur, applicationId: saved.id });
    return saved;
  }, [setSession]);

  const analyzeSession = useCallback(async (s: JobSession, m: MasterResume | null): Promise<JobSession> => {
    if (s.job.description.trim().length < 100) return s;
    const d = await engineDeps();
    const r = await runAnalysis(s.job, s.extraction.uncertain, m, profileRef.current, d, setPhase);
    if (r.notice) notify('warning', r.notice);
    return { ...s, resumeId: m?.id ?? null, analysis: r.analysis, evidence: r.evidence, masterScore: r.masterScore, atsPlan: r.atsPlan, atsMaster: r.atsMaster };
  }, [engineDeps, notify]);

  const detect = useCallback(async () => {
    if (tabId === null) return;
    if (runningRef.current) return;
    setPhase('detecting');
    setExtractionError(null);
    try {
      const state = await deps.messenger.send(tabId, { type: 'AF_GET_PAGE_STATE' });
      setPage(state);
      if (state.pageType === 'unsupported' || state.pageType === 'other' || state.pageType === 'search') {
        if (!['questions', 'attention', 'ready', 'submitted', 'external'].includes(runRef.current.status)) {
          setSessionState(null);
          sessionRef.current = null;
        }
        return;
      }
      let existing = state.jobKey ? await getSession(state.jobKey) : undefined;
      if (!existing && state.pageType === 'application') {
        if (state.site === 'dice' || !state.site) existing = sessionRef.current ?? (await latestSession());
        else {
          const recent = sessionRef.current ?? (await latestSession(20 * 60 * 1000));
          existing = recent && recent.job.platform === 'jobright' && !recent.submittedAt ? recent : undefined;
        }
      }
      if (existing) {
        if (existing.jobKey !== sessionRef.current?.jobKey) report(INITIAL_RUN);
        let s = existing;
        if (!s.analysis && master) s = await analyzeSession(s, master);
        await setSession(s);
        setApplication(s.applicationId ? (await getApplication(s.applicationId)) ?? null : null);
        setDuplicates(findDuplicates(await listApplications(), s.jobKey, s.job.url, s.job.company, s.job.title));
        return;
      }
      if (state.pageType === 'application') {
        setSessionState(null);
        setExtractionError(state.site === 'dice' || !state.site ? 'Open the job’s Dice page first, so ApplyFlow can read the job and tailor your documents.' : `This is ${state.siteName ?? 'an employer'}’s application form. Open the job on Jobright (or Dice) first, so ApplyFlow can read it and tailor your documents.`);
        return;
      }
      setPhase('extracting');
      const result = await deps.messenger.send(tabId, { type: 'AF_EXTRACT_JOB' });
      if (!result.ok || !result.job) {
        setExtractionError(result.failureReason ?? `${state.siteName ?? 'The site'} changed this page layout, so I could not safely read the job details.`);
        if (result.job) setSessionState(newSession(result.job, { confidence: result.confidence, sources: result.sources, uncertain: true, warnings: result.warnings }, master?.id ?? null, settings.includeCoverLetterByDefault));
        return;
      }
      let s = newSession(result.job, { confidence: result.confidence, sources: result.sources, uncertain: result.uncertain, warnings: result.warnings }, master?.id ?? null, settings.includeCoverLetterByDefault);
      report(INITIAL_RUN);
      setLastResult('');
      setNotices([]);
      setApplication(null);
      setDuplicates(findDuplicates(await listApplications(), s.jobKey, s.job.url, s.job.company, s.job.title));
      if (master) {
        setPhase('analyzing');
        s = await analyzeSession(s, master);
      }
      await setSession(s);
      setView('home');
    } catch (e: unknown) {
      setExtractionError(errText(e, 'ApplyFlow can’t reach this page. Reload it and try again.'));
    } finally {
      setPhase('idle');
    }
  }, [tabId, deps.messenger, master, settings.includeCoverLetterByDefault, analyzeSession, setSession, report]);

  useEffect(() => {
    if (deps.pinnedTabId == null && bridge()) {
      setTabId(DICE_TAB_ID);
      return;
    }
    if (deps.pinnedTabId != null || typeof chrome === 'undefined' || !chrome.tabs) return;
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t?.id !== undefined && setTabId(t.id));
    const onAct = (info: { tabId: number }) => {
      if (!runningRef.current) setTabId(info.tabId);
    };
    chrome.tabs.onActivated.addListener(onAct);
    return () => chrome.tabs.onActivated.removeListener(onAct);
  }, [deps.pinnedTabId]);

  useEffect(() => {
    void detect();
  }, [tabId]); // eslint-disable-line react-hooks/exhaustive-deps

  const analyzingRef = useRef<string | null>(null);
  useEffect(() => {
    const s = sessionRef.current;
    if (!s || !master || runningRef.current || s.resume) return;
    if (s.analysis && s.resumeId === master.id) return;
    const key = `${s.jobKey}|${master.id}`;
    if (analyzingRef.current === key) return;
    analyzingRef.current = key;
    void analyzeSession(s, master)
      .then((n) => (sessionRef.current?.jobKey === n.jobKey && !sessionRef.current.resume ? setSession({ ...sessionRef.current, analysis: n.analysis, evidence: n.evidence, masterScore: n.masterScore, resumeId: n.resumeId, atsPlan: n.atsPlan, atsMaster: n.atsMaster }) : undefined))
      .finally(() => {
        analyzingRef.current = null;
        setPhase('idle');
      });
  }, [master?.id, session?.jobKey, Boolean(session?.analysis)]); // eslint-disable-line react-hooks/exhaustive-deps

  const masterKey = master ? masterStamp(master) : '';
  useEffect(() => {
    const s = sessionRef.current;
    if (!s?.analysis || !master || s.resumeId !== master.id || runningRef.current) return;
    const ats = planAts(s.job, s.analysis, master, profileRef.current, settings.defaultResumeLength);
    void setSession({ ...s, atsPlan: ats.plan, atsMaster: ats.master });
  }, [masterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tabId === null) return;
    void deps.messenger.send(tabId, { type: 'AF_SET_LAUNCHER', visible: settings.showPageLauncher }).catch(() => undefined);
  }, [tabId, settings.showPageLauncher, deps.messenger]);

  useEffect(
    () =>
      onDataChange((t) => {
        const id = sessionRef.current?.applicationId;
        if (t === 'applications' && id) void getApplication(id).then((r) => r && setApplication(r));
      }),
    [],
  );

  const fileName = useCallback((kind: 'resume' | 'cover_letter') => {
    const s = sessionRef.current;
    if (!s?.resume || (kind === 'cover_letter' && !s.coverLetter)) return null;
    return uploadFileName(s, kind, uploadExt(settings));
  }, [settings]);

  useEffect(() => {
    const b = bridge();
    if (!b) return;
    return b.on('claudeChat:status', (st) => {
      if (!runningRef.current || st.state !== 'ready') return;
      const d = st.detail.trim();
      if (!d || d === 'Connected' || d.startsWith('Checking') || d.startsWith('Opening Claude.ai…')) return;
      setStep(d.endsWith('…') ? d : `${d}…`);
    });
  }, [setStep]);

  const makeDocuments = useCallback(async (masterOverride?: MasterResume): Promise<boolean> => {
    let s = sessionRef.current;
    const master = masterOverride ?? masterFromProps;
    if (!s || !master) return false;
    setStep('Preparing tailored resume and cover letter…');
    const d = await engineDeps();
    if (!s.analysis || s.resumeId !== master.id || masterOverride) s = await analyzeSession(s, master);
    const r = await runDocuments(s, master, profileRef.current, d, tone, setPhase);
    let resume = r.resume;
    if (resume.issues.some((i) => i.severity === 'critical')) {
      const fixed = applyAutoFixes(resume, master, profileRef.current, resume.issues, supportedKeywords(s.evidence), r.atsPlan);
      resume = { ...fixed, issues: validateTailoredResume(fixed, { master, profile: profileRef.current, job: s.job, evidence: s.evidence, length: settings.defaultResumeLength, plan: r.atsPlan }) };
    }
    let atsParse = null;
    try {
      atsParse = await parseCheckPdf(await renderResumePdf(toResumeDocument(resume, r.coverLetter), settings.resumeFormat), resume);
    } catch {
      atsParse = null;
    }
    const next: JobSession = {
      ...s,
      resume,
      tailoredScore: s.analysis ? scoreTailored(s.job, s.analysis, s.evidence, master, resume, profileRef.current) : r.tailoredScore,
      atsPlan: r.atsPlan,
      atsMaster: r.atsMaster,
      atsTailored: scanTailored(resume, r.atsPlan, master, settings, atsParse),
      atsParse,
      coverLetter: r.coverLetter,
      documentsFrom: masterStamp(master),
      resumeReviewed: false,
      coverLetterReviewed: false,
      fieldProposals: [],
    };
    await setSession(next);
    const rec = await upsertRecord(next, 'Resume Ready');
    await storeDocuments(sessionRef.current ?? next, rec.id).catch(() => undefined);
    r.notices.forEach((n) => notify('warning', n));
    if (settings.saveDocumentsWhenReady) {
      try {
        await saveFilesRef.current(rec, sessionRef.current ?? next, ['resume', 'cover_letter', 'resume_json', 'job_description']);
      } catch {
        notify('warning', 'The tailored documents couldn’t be saved. Use Documents → Download.');
      }
    }
    const unsupported = next.evidence.filter((e) => e.importance === 'required' && (e.status === 'none' || e.status === 'conflict')).length;
    if (unsupported) notify('info', `${unsupported} required qualification${unsupported > 1 ? 's' : ''} from the job aren’t in your resume, so ${unsupported > 1 ? 'they were' : 'it was'} left out rather than claimed.`);
    return !resume.issues.some((i) => i.severity === 'critical') && !(next.coverLetter?.issues ?? []).some((i) => i.severity === 'critical');
  }, [masterFromProps, engineDeps, analyzeSession, tone, settings, setSession, upsertRecord, notify, setStep]);

  const runnerIO = useCallback((): RunnerIO => ({
    send: (msg) => deps.messenger.send(tabId as number, msg),
    session: () => sessionRef.current,
    saveSession: (s) => setSession(s),
    settings,
    profile: profileRef.current,
    saveProfile: async (p) => {
      const saved = await saveProfile(p);
      profileRef.current = saved;
      return saved;
    },
    ensureSiteCredential: (url, email) => ensureSiteCredential(url, email),
    rememberSiteLogin: (c) => saveSiteCredential(c),
    payload: (kind) => (sessionRef.current ? uploadPayload(sessionRef.current, settings, kind) : Promise.resolve(null)),
    fileName,
    sleep,
    aborted: () => Boolean(abortRef.current?.signal.aborted),
    state: () => runRef.current,
    report,
    pollMs: deps.pollMs,
    navigate: (url) => openInJobTab(tabId, url),
  }), [deps.messenger, deps.pollMs, tabId, settings, fileName, setSession, report]);

  const afterRun = useCallback(async (result: string) => {
    const s = sessionRef.current;
    if (result === 'ready' && s) {
      await upsertRecord(s, 'Ready to Apply');
      setLastResult('Review the summary, then submit.');
    }
  }, [upsertRecord]);

  const quickApply = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || !master || tabId === null || runningRef.current) return;
    runningRef.current = true;
    abortRef.current = new AbortController();
    try {
      if (!s.duplicateAcknowledged && duplicates?.exact && hasApplied(duplicates.exact)) await setSession({ ...s, duplicateAcknowledged: true });
      setStep('Starting Tailor & Apply…');
      report({ ...INITIAL_RUN, status: 'working', label: 'Starting Tailor & Apply…' });
      const cur = sessionRef.current!;
      const outdated = Boolean(cur.resume && !cur.submittedAt && (cur.documentsFrom !== masterStamp(master) || cur.resume.contentSource !== 'cv-generate'));
      if (outdated) notify('info', 'Your candidate details or generation engine changed, so ApplyFlow is writing these documents again.');
      const needDocs = !cur.resume || outdated || (cur.includeCoverLetter && !cur.coverLetter);
      if (needDocs) {
        setStep('Tailoring your resume and cover letter…');
        report({ ...runRef.current, label: 'Tailoring your resume and cover letter…', stages: { ...runRef.current.stages, documents: 'active' } });
        const clean = await makeDocuments();
        if (abortRef.current.signal.aborted) return;
        if (!clean) {
          report({ ...runRef.current, status: 'attention', label: 'Check your resume', message: 'A few tailored lines couldn’t be verified against your master resume. Open Documents to fix them, then press Continue.', stages: { ...runRef.current.stages, documents: 'error' } });
          return;
        }
      }
      report({ ...runRef.current, stages: { ...runRef.current.stages, documents: 'done' } });
      const io = runnerIO();
      if (sessionRef.current?.job.externalApply && sessionRef.current.job.platform !== 'jobright') {
        const opened = await ensureApplicationOpen(io);
        if (opened === 'external') await saveDocsNow('Resume Ready');
        return;
      }
      const opened = await ensureApplicationOpen(io);
      if (opened !== 'open') {
        if (opened === 'external') await saveDocsNow('Resume Ready');
        return;
      }
      await afterRun(await runSteps(io));
    } catch (e: unknown) {
      if (e instanceof ClaudeError && e.code === 'aborted') report({ ...INITIAL_RUN, label: 'Cancelled.' });
      else {
        const step = stepRef.current || 'Tailor & Apply stopped';
        setStep(step);
        report({ ...runRef.current, status: 'attention', label: step, message: errText(e, 'Press Continue to try again.') });
      }
    } finally {
      runningRef.current = false;
      setStatusLine('');
      setPhase('idle');
    }
  }, [master, tabId, duplicates, setSession, report, makeDocuments, runnerIO, afterRun, setStep]); // eslint-disable-line react-hooks/exhaustive-deps
  quickApplyRef.current = quickApply;

  const continueRun = useCallback(async (opts: { autoAdvance?: boolean } = {}) => {
    if (runningRef.current || tabId === null || !sessionRef.current) return;
    if (!sessionRef.current.resume) return void quickApply();
    runningRef.current = true;
    abortRef.current = new AbortController();
    const a = runRef.current.attachments;
    report({ ...runRef.current, attachments: { resume: { ...a.resume, tries: 0 }, coverLetter: { ...a.coverLetter, tries: 0 } } });
    try {
      const io = runnerIO();
      const opened = await ensureApplicationOpen(io);
      if (opened !== 'open') return;
      if (opts.autoAdvance === false) {
        let r = await processStep(io);
        if (r === 'moved') r = await processStep(io);
        if (r === 'next') report({ ...runRef.current, status: 'attention', label: 'Step ready', message: 'This step is filled in. Press Continue and ApplyFlow moves on.' });
        await afterRun(r);
      } else {
        await afterRun(await runSteps(io));
      }
    } catch (e: unknown) {
      const step = stepRef.current || 'Apply step stopped';
      setStep(step);
      report({ ...runRef.current, status: 'attention', label: step, message: errText(e, 'Press Continue to try again.') });
    } finally {
      runningRef.current = false;
      setStatusLine('');
    }
  }, [tabId, runnerIO, report, afterRun, quickApply, setStep]);

  const answerQuestion = useCallback(async (q: FieldProposal, value: string, remember: boolean) => {
    const s = sessionRef.current;
    if (!s || tabId === null || !value.trim()) return;
    const res = await deps.messenger.send(tabId, { type: 'AF_ANSWER_FIELD', fieldId: q.fieldId, value }).catch(() => null);
    if (!res?.ok) {
      notify('warning', res?.error ? `Couldn’t set “${q.label}”: ${res.error}` : `Couldn’t set “${q.label}”. Answer it on the page.`);
      return;
    }
    if (remember && q.sensitive !== 'legal_consent') {
      const p = profileRef.current;
      const category: ApprovedAnswer['category'] = q.sensitive ?? 'general';
      const pattern = q.label.trim().slice(0, 160);
      const saved = await saveProfile({
        ...p,
        approvedAnswers: rememberAnswer(
          p.approvedAnswers,
          {
            category,
            questionPattern: pattern,
            answer: value.trim(),
            control: toScreeningControl(q.control),
            options: q.options?.length ? q.options : undefined,
          },
          () => newId('ans'),
          nowIso(),
        ),
      });
      profileRef.current = saved;
    }
    const done: FieldProposal = { ...q, action: 'answer', proposedValue: res.finalValue ?? value, source: remember && q.sensitive !== 'legal_consent' ? 'Your answer (saved)' : 'Your answer', status: 'user-completed' };
    await setSession({ ...s, fieldProposals: [...s.fieldProposals.filter((p) => p.fieldId !== q.fieldId), done] });
    const remaining = runRef.current.questions.filter((x) => x.fieldId !== q.fieldId);
    report({ ...runRef.current, questions: remaining, optional: runRef.current.optional.filter((x) => x.fieldId !== q.fieldId), label: remaining.length ? `${remaining.length} question${remaining.length > 1 ? 's' : ''} left` : 'Continuing…' });
    if (!remaining.length && runRef.current.status === 'questions') void continueRun();
  }, [tabId, deps.messenger, setSession, report, notify, continueRun]);

  const pageRef = useRef<PageState | null>(null);
  pageRef.current = page;
  const continueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleEventRef = useRef<(msg: { type?: string; state?: PageState; url?: string }) => void>(() => undefined);
  handleEventRef.current = (msg: { type?: string; state?: PageState; url?: string }) => {
      if (msg?.type === 'AF_LAUNCHER_CLICKED') {
        if (sessionRef.current && !runningRef.current && !sessionRef.current.submittedAt) void quickApplyRef.current();
        return;
      }
      if (msg?.type === 'AF_APPLICATION_SUBMITTED') {
        const s = sessionRef.current;
        const run = runRef.current;
        const sameForm = !run.formKey || (msg.url ? formKeyFor(msg.url) === run.formKey : false);
        if (s && !s.submittedAt && ['questions', 'attention', 'ready'].includes(run.status) && sameForm) void recordSubmittedRef.current(true, 'manual');
        return;
      }
      if (msg?.type !== 'AF_PAGE_CHANGED' || !msg.state) return;
      const st = msg.state;
      const first = pageRef.current === null;
      const prevKey = pageRef.current?.jobKey ?? null;
      pageRef.current = st;
      setPage(st);
      const status = runRef.current.status;
      const active = ['questions', 'attention', 'ready'].includes(status);
      if (active && st.step && (st.step.current !== runRef.current.step?.current || st.step.total !== runRef.current.step?.total)) report({ ...runRef.current, step: st.step });
      if (st.hasApplicationForm && active && !runningRef.current && stepKey(st.url, st.step) !== runRef.current.lastStepKey) {
        if (continueTimer.current) clearTimeout(continueTimer.current);
        continueTimer.current = setTimeout(() => void continueRun({ autoAdvance: false }), 700);
        return;
      }
      if (runningRef.current) return;
      const otherJob = st.pageType === 'job-detail' && Boolean(st.jobKey) && st.jobKey !== sessionRef.current?.jobKey && (st.site === 'dice' || st.site === 'jobright');
      if (active && !otherJob) return;
      if (first || otherJob || (st.jobKey !== prevKey && st.pageType !== 'application')) void detect();
      else if (st.pageType === 'application' && !sessionRef.current) void detect();
  };
  useEffect(() => {
    const handle = (msg: { type?: string; state?: PageState; url?: string }) => handleEventRef.current(msg);
    const clear = () => {
      if (continueTimer.current) clearTimeout(continueTimer.current);
    };
    const b = bridge();
    if (b) {
      const off = b.on('dice:event', (e) => handle(e as { type?: string; state?: PageState }));
      return () => {
        clear();
        off();
      };
    }
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    const onMsg = (msg: { type?: string; state?: PageState; url?: string }, sender: chrome.runtime.MessageSender) => {
      if (sender.tab?.id !== tabId) return;
      handle(msg);
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => {
      clear();
      chrome.runtime.onMessage.removeListener(onMsg);
    };
  }, [tabId]);

  const saveFiles = useCallback(async (rec: ApplicationRecord, s: JobSession, kinds?: SavedFile['kind'][]): Promise<ApplicationRecord> => {
    setPhase('downloading');
    try {
      const docs = await buildAllDocs(s, settings);
      const folder = s.savedDocs?.folder ?? folderFor(s, settings, (rec.dateApplied ?? rec.datePrepared).slice(0, 10) || todayLocal());
      const all = planApplicationFiles(rec, s, settings, docs, folder);
      const resumeFile = all.find((f) => f.kind === 'resume' && f.format === 'pdf') ?? all.find((f) => f.kind === 'resume');
      const clFile = all.find((f) => f.kind === 'cover_letter' && f.format === 'pdf') ?? all.find((f) => f.kind === 'cover_letter');
      const withNames = { ...rec, folderPath: folder, resumeFileName: resumeFile?.relativePath.split('/').pop() ?? null, coverLetterFileName: clFile?.relativePath.split('/').pop() ?? null };
      const files = planApplicationFiles(withNames, s, settings, docs, folder).filter((f) => !kinds || kinds.includes(f.kind));
      const conflict = s.savedDocs?.folder === folder ? 'overwrite' : 'uniquify';
      const saved: SavedFile[] = await downloadFiles(files, deps.downloads === undefined ? undefined : deps.downloads, conflict);
      const latest = (await getApplication(rec.id)) ?? rec;
      const merged = [...latest.files.filter((f) => !saved.some((n) => n.relativePath === f.relativePath)), ...saved];
      const pathOf = (kind: SavedFile['kind']) => (saved.find((f) => f.kind === kind && f.format === 'pdf' && f.absolutePath) ?? saved.find((f) => f.kind === kind && f.absolutePath))?.absolutePath ?? null;
      if (saved.some((f) => f.kind === 'resume' && f.absolutePath)) await storeDocuments(s, rec.id, { resume: pathOf('resume'), cover_letter: pathOf('cover_letter') }).catch(() => undefined);
      const out = await saveApplication({ ...latest, ...withNames, stage: latest.stage, stageHistory: latest.stageHistory, notes: latest.notes, files: merged });
      setApplication(out);
      if (saved.some((f) => f.kind === 'resume' && f.state !== 'failed')) {
        const cur = sessionRef.current;
        if (cur && cur.jobKey === s.jobKey) await setSession({ ...cur, savedDocs: { stamp: docsStamp(s), folder } });
      }
      const failed = saved.filter((f) => f.state === 'failed');
      if (failed.length) notify('warning', `${failed.length} file(s) could not be saved: ${failed[0]!.error ?? 'download failed'}.`);
      return out;
    } finally {
      setPhase('idle');
    }
  }, [settings, deps.downloads, notify, setSession]);
  saveFilesRef.current = saveFiles;

  const saveDocsNow = useCallback(async (stage: ApplicationStage) => {
    const s = sessionRef.current;
    if (!s?.resume) return;
    try {
      const rec = await upsertRecord(s, stage);
      const out = await saveFiles(rec, sessionRef.current ?? s);
      setLastResult(`Saved ${out.files.filter((f) => f.state === 'complete').length} files to ${bridge() ? '' : 'Downloads/'}${out.folderPath}.`);
    } finally {
      setPhase('idle');
    }
  }, [upsertRecord, saveFiles]);

  const downloadNow = useCallback(async () => {
    try {
      await saveDocsNow(sessionRef.current?.submittedAt ? 'Applied' : 'Resume Ready');
    } catch (e: unknown) {
      notify('critical', errText(e, 'Download failed.'));
    }
  }, [saveDocsNow, notify]);

  const openFolder = useCallback(async () => {
    if (!application) return;
    const r = await showInFolder(application.files, deps.downloads === undefined ? undefined : deps.downloads);
    if (!r.ok) notify('info', r.message);
  }, [application, deps.downloads, notify]);

  const confirmJobrightApplied = useCallback(async (jobUrl: string) => {
    if (tabId === null || !jobUrl) return;
    const b = bridge();
    if (b) await b.invoke('dice.navigate', jobUrl).catch(() => undefined);
    for (let i = 0; i < 24; i++) {
      if (abortRef.current?.signal.aborted) return;
      await sleep(500);
      const res = await deps.messenger.send(tabId, { type: 'AF_CONFIRM_JOBRIGHT_APPLIED' }).catch(() => null);
      if (res?.clicked) {
        notify('success', 'Marked as applied on Jobright.');
        return;
      }
    }
    notify('info', 'ApplyFlow recorded the application. If Jobright still asks “Did you apply?”, press “Yes, I applied!” there.');
  }, [tabId, deps.messenger, notify]);

  const recordSubmitted = useCallback(async (confirmedByDice: boolean, how: 'applyflow' | 'manual') => {
    const s = sessionRef.current;
    if (!s || s.submittedAt) return;
    if (!confirmedByDice && how === 'applyflow') {
      report({ ...runRef.current, status: 'attention', label: 'Check the page', message: `Submit was pressed, but ${pageRef.current?.siteName || 'the site'} hasn’t confirmed it yet. ApplyFlow will record it when the confirmation appears (or press “Record it as applied”).` });
      return;
    }
    setPhase('saving');
    try {
      const submittedAt = nowIso();
      const next = { ...s, submittedAt };
      await setSession(next);
      const st = runRef.current;
      report({ ...st, status: 'submitted', label: 'Applied', submittedConfirmed: confirmedByDice, questions: [], stages: { ...st.stages, review: 'done' } });
      const followUpDate = addDays(todayLocal(), settings.followUpDays);
      let rec = await upsertRecord(next, 'Applied', { followUpDate });
      rec = await saveApplication({
        ...rec,
        notes: [...rec.notes, { id: newId('note'), text: how === 'applyflow' ? (confirmedByDice ? `Submitted with ApplyFlow; ${pageRef.current?.siteName || 'the site'} showed a confirmation.` : `Submit clicked by ApplyFlow; confirmation not detected — check ${pageRef.current?.siteName || 'the site'}.`) : confirmedByDice ? `Submitted on ${pageRef.current?.siteName || 'the site'}; ApplyFlow saw the confirmation and recorded it.` : `Recorded as applied from ApplyFlow (confirmation not auto-detected).`, createdAt: submittedAt }],
      });
      setApplication(rec);
      const b = bridge();
      if (b) {
        void b.invoke('reminders.set', { applicationId: rec.id, whenIso: new Date(`${followUpDate}T09:00:00`).toISOString(), label: `Follow up on ${rec.title} at ${rec.company}` }).catch(() => undefined);
        try {
          await storeDocuments(next, rec.id);
          await b.invoke('documents.markSent', rec.id, next.jobKey, { resume: next.resume?.version ?? null, cover_letter: next.includeCoverLetter ? next.coverLetter?.version ?? null : null });
        } catch {
        }
      } else if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        void chrome.runtime.sendMessage({ type: 'AF_BG_SET_REMINDER', applicationId: rec.id, whenIso: `${followUpDate}T09:00:00`, label: `Follow up on ${rec.title} at ${rec.company}` }).catch(() => undefined);
      }
      if (settings.autoDownloadOnSubmit && s.resume) {
        const docsSaved = next.savedDocs?.stamp === docsStamp(next);
        rec = await saveFiles(rec, sessionRef.current ?? next, docsSaved ? ['metadata', 'job_url'] : undefined);
      }
      if (!settings.saveJobDescriptionsLocally) await setSession({ ...next, job: { ...next.job, description: '' } });
      setLastResult(`Applied. ${rec.files.length ? `${rec.files.filter((f) => f.state === 'complete').length} files saved to ${bridge() ? '' : 'Downloads/'}${rec.folderPath}. ` : ''}Follow-up reminder on ${followUpDate}.`);
      if (next.job.platform === 'jobright' && next.job.url) {
        void confirmJobrightApplied(next.job.url);
      }
    } finally {
      setPhase('idle');
    }
  }, [settings.followUpDays, settings.autoDownloadOnSubmit, settings.saveJobDescriptionsLocally, setSession, upsertRecord, saveFiles, report, confirmJobrightApplied]);
  const recordSubmittedRef = useRef(recordSubmitted);
  recordSubmittedRef.current = recordSubmitted;

  const submit = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || tabId === null || runRef.current.status !== 'ready') return;
    report({ ...runRef.current, status: 'submitting', label: `Submitting on ${pageRef.current?.siteName || 'the site'}…` });
    setPhase('submitting');
    try {
      const token = newToken();
      await deps.messenger.send(tabId, { type: 'AF_ARM_SUBMIT', token });
      const res = await deps.messenger.send(tabId, { type: 'AF_SUBMIT', token, expectKey: runRef.current.formKey });
      if (!res.ok) {
        report({ ...runRef.current, status: 'attention', label: 'Not submitted', message: `${res.message} Nothing was sent.` });
        return;
      }
      if (res.needsUser || !res.successDetected) {
        report({
          ...runRef.current,
          status: 'attention',
          label: res.needsUser ? 'Complete the CAPTCHA' : 'Check the page',
          message: res.message + (res.successDetected ? '' : ' If it shows that you applied, press “Record it as applied” below.'),
        });
        return;
      }
      await recordSubmitted(true, 'applyflow');
    } catch (e: unknown) {
      if (e instanceof TabUnreachableError && bridge()) {
        for (let i = 0; i < 20; i++) {
          await sleep(750);
          const r = await deps.messenger.send(tabId, { type: 'AF_CHECK_SUCCESS' }).catch(() => null);
          if (r?.success) {
            await recordSubmitted(true, 'applyflow');
            return;
          }
          if (r) break;
        }
      }
      report({ ...runRef.current, status: 'attention', label: 'Check the page', message: errText(e, 'Submission could not be confirmed. Check the page.') + ' If it shows that you applied, press “Record it as applied” below.' });
    } finally {
      setPhase('idle');
    }
  }, [tabId, deps.messenger, recordSubmitted, report]);

  const recordManualSubmit = useCallback(() => recordSubmitted(false, 'manual'), [recordSubmitted]);

  const diagnose = useCallback(async (): Promise<string> => {
    if (tabId === null) return '';
    const r = await deps.messenger.send(tabId, { type: 'AF_DIAGNOSE' }).catch(() => null);
    return r?.text ?? '';
  }, [tabId, deps.messenger]);

  const keepDiceResume = useCallback(() => {
    report({ ...runRef.current, allowOriginalResume: true, need: null, attachments: { ...runRef.current.attachments, resume: { ...runRef.current.attachments.resume, state: 'skipped', message: 'You kept the resume already on Dice.' } } });
    void continueRun();
  }, [report, continueRun]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setPhase('idle');
    report({ ...runRef.current, status: runRef.current.status === 'working' ? 'attention' : runRef.current.status, label: 'Paused', message: 'Paused. Press Continue to pick up where ApplyFlow stopped.' });
  }, [report]);

  const selectResume = useCallback(async (id: string) => {
    const s = sessionRef.current;
    const r = resumes.find((x) => x.id === id);
    if (!s || !r) return;
    let next: JobSession = { ...s, resumeId: id };
    if (s.analysis) {
      const evidence = classifySkills(s.analysis.requiredSkills, s.analysis.preferredSkills, r, profile);
      const analysis = { ...s.analysis, missingQualifications: missingQualifications(evidence, s.analysis.risks) };
      next = { ...next, analysis, evidence, masterScore: scoreMaster(s.job, analysis, evidence, r, profile), resume: null, coverLetter: null, tailoredScore: null, resumeReviewed: false, coverLetterReviewed: false };
      if (s.resume) notify('info', 'You switched master resumes, so the tailored documents will be written again.');
    }
    await setSession(next);
  }, [resumes, profile, setSession, notify]);

  const regenerate = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      await makeDocuments();
      setLastResult('Documents rewritten.');
    } catch (e: unknown) {
      notify('critical', errText(e, 'Tailoring failed. Try again.'));
    } finally {
      runningRef.current = false;
      setPhase('idle');
    }
  }, [makeDocuments, notify]);

  const updateResume = useCallback(async (t: TailoredResume) => {
    const s = sessionRef.current;
    if (!s || !master || !s.analysis) return;
    const checked = revalidateEdited(t, s, master, profile, settings.defaultResumeLength);
    await setSession({
      ...s,
      resume: checked,
      tailoredScore: scoreTailored(s.job, s.analysis, s.evidence, master, checked, profile),
      ...(s.atsPlan ? { atsTailored: scanTailored(checked, s.atsPlan, master, settings, s.atsParse ?? null) } : {}),
    });
    if (sessionRef.current && !sessionRef.current.submittedAt) await storeDocuments(sessionRef.current, sessionRef.current.applicationId).catch(() => undefined);
    setLastResult(checked.issues.some((i) => i.severity === 'critical') ? 'Edits saved. Some changes need attention.' : 'Edits saved and re-checked.');
  }, [master, profile, settings, setSession]);

  const autoFixResume = useCallback(async () => {
    const s = sessionRef.current;
    if (!s?.resume || !master || !s.analysis) return;
    const fixed = applyAutoFixes(s.resume, master, profile, s.resume.issues, supportedKeywords(s.evidence), s.atsPlan ?? null);
    const issues = validateTailoredResume(fixed, { master, profile, job: s.job, evidence: s.evidence, length: settings.defaultResumeLength, plan: s.atsPlan ?? null });
    const t = { ...fixed, issues };
    await setSession({
      ...s,
      resume: t,
      tailoredScore: scoreTailored(s.job, s.analysis, s.evidence, master, t, profile),
      ...(s.atsPlan ? { atsTailored: scanTailored(t, s.atsPlan, master, settings, s.atsParse ?? null) } : {}),
    });
    setLastResult(issues.some((i) => i.severity === 'critical') ? 'Some issues need a manual edit.' : 'Fixed: unsupported items were reverted to your original wording.');
  }, [master, profile, settings, setSession]);

  const confirmSkills = useCallback(async (terms: string[], rewrite = false) => {
    if (!master || !terms.length || runningRef.current) return;
    const have = new Set(master.facts.filter((f) => f.kind === 'skill').map((f) => f.text.toLowerCase()));
    const added = terms.filter((t) => !have.has(t.toLowerCase()));
    const facts = [
      ...master.facts.map((f) => (f.kind === 'skill' && terms.some((t) => t.toLowerCase() === f.text.toLowerCase()) ? { ...f, status: 'confirmed' as const } : f)),
      ...added.map((t) => ({ id: newId('fact'), kind: 'skill' as const, text: t, status: 'confirmed' as const, source: 'user' as const })),
    ];
    const updated = await saveResume({ ...master, facts, updatedAt: nowIso() });
    if (!rewrite) {
      const s = sessionRef.current;
      if (s?.analysis) {
        const ats = planAts(s.job, s.analysis, updated, profileRef.current, settings.defaultResumeLength);
        await setSession({ ...s, atsPlan: ats.plan, atsMaster: ats.master });
      }
      setLastResult(`Added to your verified skills: ${terms.join(', ')}.`);
      return;
    }
    runningRef.current = true;
    try {
      await makeDocuments(updated);
      setLastResult(`Added ${terms.join(', ')} to your skills and rewrote the resume.`);
    } catch (e: unknown) {
      notify('critical', errText(e, 'Tailoring failed. Try again.'));
    } finally {
      runningRef.current = false;
      setPhase('idle');
    }
  }, [master, settings.defaultResumeLength, setSession, makeDocuments, notify]);

  const coverLetterAction = useCallback(async (action: CoverLetterAction | null, nextTone?: CoverLetterTone) => {
    const s = sessionRef.current;
    if (!master || !s) return;
    const t = nextTone ?? tone;
    if (nextTone) setTone(nextTone);
    try {
      const d = await engineDeps();
      const r = await runCoverLetter(s, master, profile, d, t, action, setPhase);
      await setSession({ ...s, coverLetter: r.coverLetter });
      if (sessionRef.current) await storeDocuments(sessionRef.current, sessionRef.current.applicationId).catch(() => undefined);
      if (r.notice) notify('warning', r.notice);
      setLastResult(`Cover letter v${r.coverLetter.version} ready (${r.coverLetter.wordCount} words).`);
    } catch (e: unknown) {
      notify('critical', errText(e, 'The cover letter could not be generated.'));
    } finally {
      setPhase('idle');
    }
  }, [master, profile, tone, engineDeps, setSession, notify]);

  const saveLetterText = useCallback(async (text: string) => {
    const s = sessionRef.current;
    if (!s?.coverLetter || !master) return;
    await setSession({ ...s, resume: s.resume ? { ...s.resume, version: s.resume.version + 1, generatedAt: nowIso() } : null, coverLetter: revalidateLetter(text, s.coverLetter, s, master, profile) });
    if (sessionRef.current && !sessionRef.current.submittedAt) await storeDocuments(sessionRef.current, sessionRef.current.applicationId).catch(() => undefined);
    setLastResult('Cover letter saved and re-checked.');
  }, [master, profile, setSession]);

  const patchSession = useCallback(async (p: Partial<JobSession>) => {
    const s = sessionRef.current;
    if (s) await setSession({ ...s, ...p });
  }, [setSession]);

  const editJob = useCallback(async (job: JobPosting) => {
    const s = sessionRef.current;
    if (!s) {
      let fresh: JobSession = { ...newSession(job, { confidence: {}, sources: ['user-edited'], uncertain: false, warnings: [] }, master?.id ?? null, settings.includeCoverLetterByDefault), jobConfirmed: true };
      if (master) fresh = await analyzeSession(fresh, master);
      await setSession(fresh);
      setExtractionError(null);
      setPhase('idle');
      setLastResult('Job details saved.');
      return;
    }
    const changed = job.description !== s.job.description || job.title !== s.job.title;
    let next: JobSession = {
      ...s,
      job,
      jobConfirmed: true,
      extraction: { ...s.extraction, uncertain: false, sources: Array.from(new Set([...s.extraction.sources, 'user-edited' as const])) },
      ...(changed ? { analysis: null, evidence: [], masterScore: null, tailoredScore: null, resume: null, coverLetter: null } : {}),
    };
    if (changed && master) next = await analyzeSession(next, master);
    await setSession(next);
    setExtractionError(null);
    setPhase('idle');
    setLastResult(changed ? 'Job details saved and re-scored.' : 'Job details saved.');
  }, [setSession, master, settings.includeCoverLetterByDefault, analyzeSession]);

  const duplicateApplied = Boolean(duplicates?.exact && hasApplied(duplicates.exact) && !session?.submittedAt);
  const busy = phase !== 'idle' || run.status === 'working' || run.status === 'submitting';
  const live = run.status === 'working' || run.status === 'submitting';
  // The step line ("Waiting for CV JSON…") only describes work in progress; never show it once the run stopped.
  const progressText = (live || phase !== 'idle' ? statusLine : '') || (live ? run.label : phase !== 'idle' ? `${PROGRESS_LABELS[phase]}…` : lastResult);
  /** The job tab shows a job list or another job while this application is still open in the panel. */
  const leftApplication = Boolean(
    session && !session.submittedAt && !runningRef.current && ['questions', 'attention', 'ready'].includes(run.status) && leftThisJob(page, session),
  );
  const returnToApplication = useCallback(async () => {
    const url = returnUrl(runRef.current, sessionRef.current);
    if (url) await openInJobTab(tabId, url);
  }, [tabId]);
  /** Drop this job from the panel so the page in the job tab can be read instead. */
  const leaveApplication = useCallback(async () => {
    abortRef.current?.abort();
    report(INITIAL_RUN);
    sessionRef.current = null;
    setSessionState(null);
    setStatusLine('');
    setLastResult('');
    await detect();
  }, [report, detect]);

  return {
    tabId, page, session, master, extractionError, phase, busy, progressText, notices, dismiss, notify, duplicates, duplicateApplied, application,
    view, setView, tone, setTone, run, fileName,
    leftApplication, returnToApplication, leaveApplication,
    detect, quickApply, continueRun, answerQuestion, submit, recordManualSubmit, keepDiceResume, cancel, diagnose,
    selectResume, regenerate, updateResume, autoFixResume, confirmSkills, coverLetterAction, saveLetterText, patchSession, editJob, downloadNow, openFolder,
  };
}

export type Workflow = ReturnType<typeof useWorkflow>;

/** Load a URL in the tab ApplyFlow works in (the desktop Jobs tab, or the pinned browser tab). */
async function openInJobTab(tabId: number | null, url: string): Promise<void> {
  const b = bridge();
  if (b) {
    await b.invoke('dice.navigate', url).catch(() => undefined);
    return;
  }
  if (tabId !== null && typeof chrome !== 'undefined' && chrome.tabs?.update) await chrome.tabs.update(tabId, { url }).catch(() => undefined);
}
export type { FieldProposal };
