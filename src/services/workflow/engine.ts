/**
 * Workflow engine: analysis, tailoring and cover letters, using Claude when configured
 * and the local engine otherwise (or as a fallback when Claude fails).
 * Every output passes through the truthfulness validator.
 */
import type {
  AtsPlan, AtsReport, CareerProfile, CoverLetter, CoverLetterAction, CoverLetterTone, JobAnalysis, JobPosting, JobSession, MasterResume,
  MatchScore, ParseCheck, ProgressPhase, RiskWarning, Settings, SkillEvidence, TailoredResume,
} from '@/types';
import { buildAtsPlan, docFromMaster, docFromTailored, extractJobKeywords, forbiddenTerms, scanResume } from '@/services/ats';
import { optimizeForAts, promptPlan, refineFindings } from '@/services/tailoring/atsTailor';
import { ClaudeProvider, type UsageReporter } from '@/services/claude/provider';
import { compactFacts, compactJob, compactPlan, draftFromTailored, letterText, toTailorReply } from '@/prompts/application';
import { ClaudeError } from '@/services/claude/errors';
import type { AnalyzeJobReply } from '@/prompts/analyzeJob';
import { analyzeJobLocally, missingQualifications } from '@/services/analysis/localAnalyzer';
import { classifySkills, mergeClaudeEvidence, supportedKeywords, unsupportedKeywords } from '@/services/matching/evidence';
import { computeMatchScore } from '@/services/matching/score';
import { allowedCorpus, candidateFactsForPrompt } from '@/services/resume/facts';
import { canonicalSkill } from '@/services/skills/extract';
import { tailorLocally } from '@/services/tailoring/localTailor';
import { assembleFromClaude } from '@/services/tailoring/assemble';
import { hasCritical, validateCoverLetter, validateTailoredResume } from '@/services/tailoring/validator';
import { applyAutoFixes } from '@/services/tailoring/autofix';
import { generateLocalCoverLetter } from '@/services/coverLetter/local';
import { parsedToView, tailoredToView } from '@/services/export/render';
import { uniqCaseInsensitive, wordCount } from '@/utils/text';
import { newId } from '@/utils/id';
import { nowIso } from '@/utils/dates';
import { applyCompanyResearch, assembleCv, draftCorpus } from './cvEngine';
import type { CompanyResearchReply } from '@/prompts/companyResearch';

export interface EngineDeps {
  settings: Settings;
  apiKey: string | null;
  /** Injected in tests. */
  providerFactory?: (apiKey: string, settings: Settings) => ClaudeProvider;
  signal?: AbortSignal;
  /** Receives the tokens each Claude request used. */
  onUsage?: UsageReporter;
}

export type PhaseCallback = (p: ProgressPhase) => void;

function useClaude(deps: EngineDeps): boolean {
  return deps.settings.engine === 'claude' && Boolean(deps.apiKey);
}

function provider(deps: EngineDeps): ClaudeProvider {
  return deps.providerFactory ? deps.providerFactory(deps.apiKey!, deps.settings) : new ClaudeProvider(deps.apiKey, deps.settings, { onUsage: deps.onUsage });
}

function fallbackNotice(e: unknown, what: string): string {
  const msg = e instanceof ClaudeError ? e.userMessage : 'Claude could not be reached.';
  return `${msg} ${what} used the local engine instead.`;
}

/** What Claude sees of the job — the full text only if the user allows it. */
export function jobForPrompt(job: JobPosting, sendFull: boolean) {
  const base = { title: job.title, company: job.company, location: job.location, remoteStatus: job.remoteStatus, employmentType: job.employmentType, salary: job.salary };
  if (sendFull) return { ...base, description: job.description };
  return {
    ...base,
    requiredSkills: job.requiredSkills,
    preferredSkills: job.preferredSkills,
    responsibilities: job.responsibilities,
    qualifications: job.qualifications,
    educationRequirements: job.educationRequirements,
    clearanceRequirements: job.clearanceRequirements,
    workAuthorizationRequirements: job.workAuthorizationRequirements,
    sponsorshipLanguage: job.sponsorshipLanguage,
  };
}

const SENIORITIES: JobAnalysis['seniority'][] = ['entry', 'mid', 'senior', 'staff', 'principal', 'lead', 'manager', 'director', 'executive', 'unknown'];
const RISK_CATEGORIES: RiskWarning['category'][] = ['clearance', 'work_authorization', 'sponsorship', 'education', 'experience', 'location', 'skills', 'other'];

export function mergeAnalysis(local: JobAnalysis, reply: AnalyzeJobReply, model: string): JobAnalysis {
  const canon = (xs: string[]) => uniqCaseInsensitive(xs.map(canonicalSkill));
  const required = canon([...local.requiredSkills, ...reply.requiredSkills]).slice(0, 30);
  const preferred = canon([...local.preferredSkills, ...reply.preferredSkills]).filter((p) => !required.some((r) => r.toLowerCase() === p.toLowerCase())).slice(0, 20);
  const risks = [...local.risks];
  for (const r of reply.risks) {
    const category = (RISK_CATEGORIES as string[]).includes(r.category) ? (r.category as RiskWarning['category']) : 'other';
    if (risks.some((x) => x.category === category && category !== 'other')) continue;
    risks.push({ id: newId('risk'), severity: r.severity, category, message: r.message });
  }
  return {
    ...local,
    category: reply.category || local.category,
    seniority: SENIORITIES.includes(reply.seniority as JobAnalysis['seniority']) ? (reply.seniority as JobAnalysis['seniority']) : local.seniority,
    requiredSkills: required,
    preferredSkills: preferred,
    tools: uniqCaseInsensitive([...local.tools, ...reply.tools]).slice(0, 20),
    industryTerms: uniqCaseInsensitive([...reply.industryTerms, ...local.industryTerms]).slice(0, 12),
    softSkills: uniqCaseInsensitive([...reply.softSkills, ...local.softSkills]).slice(0, 10),
    expectedOutcomes: reply.expectedOutcomes.length ? reply.expectedOutcomes.slice(0, 6) : local.expectedOutcomes,
    screeningQuestions: uniqCaseInsensitive([...local.screeningQuestions, ...reply.screeningQuestions]).slice(0, 12),
    resumeKeywords: uniqCaseInsensitive([...reply.resumeKeywords, ...local.resumeKeywords]).slice(0, 25),
    requiredYears: local.requiredYears ?? reply.requiredYears,
    risks,
    suggestedResumeTitle: reply.suggestedResumeTitle || local.suggestedResumeTitle,
    summaryDirection: reply.summaryDirection || local.summaryDirection,
    engine: 'claude',
    model,
    analyzedAt: nowIso(),
  };
}

export function scoreMaster(job: JobPosting, analysis: JobAnalysis, evidence: SkillEvidence[], resume: MasterResume, profile?: CareerProfile): MatchScore {
  return computeMatchScore({
    resume: parsedToView(resume.parsed),
    job,
    analysis,
    evidence,
    profile,
    unconfirmedFacts: resume.facts.filter((f) => f.status === 'needs_review').length,
    totalFacts: resume.facts.length,
    computedFor: 'master',
  });
}

export function scoreTailored(job: JobPosting, analysis: JobAnalysis, evidence: SkillEvidence[], resume: MasterResume, tailored: TailoredResume, profile?: CareerProfile): MatchScore {
  if (tailored.contentSource === 'cv-generate') {
    const corpus = draftCorpus(tailored, resume);
    evidence = classifySkills(analysis.requiredSkills, analysis.preferredSkills, corpus, profile);
    resume = corpus;
  }
  return computeMatchScore({
    resume: tailoredToView(tailored),
    job,
    analysis,
    evidence,
    profile,
    unconfirmedFacts: resume.facts.filter((f) => f.status === 'needs_review').length,
    totalFacts: resume.facts.length,
    issues: tailored.issues,
    computedFor: 'tailored',
  });
}

export interface AnalysisResult {
  analysis: JobAnalysis;
  evidence: SkillEvidence[];
  masterScore: MatchScore | null;
  notice: string | null;
  atsPlan: AtsPlan | null;
  atsMaster: AtsReport | null;
}

/** ATS keywords, plan and a scan of the master resume, for the job. */
export function planAts(job: JobPosting, analysis: JobAnalysis, master: MasterResume, profile: CareerProfile | undefined, length: Settings['defaultResumeLength']): { plan: AtsPlan; master: AtsReport } {
  const keywords = extractJobKeywords(job, analysis);
  const plan = buildAtsPlan(job, master, profile, keywords, length, analysis.requiredYears);
  const report = scanResume(docFromMaster(master, profile), { plan, masterJobs: master.parsed.experience.length, computedFor: 'master' });
  return { plan, master: report };
}

export function scanTailored(t: TailoredResume, plan: AtsPlan, master: MasterResume, settings: Pick<Settings, 'resumeFormat'>, parse: ParseCheck | null = null): AtsReport {
  return scanResume(docFromTailored(t), { plan, masterJobs: master.parsed.experience.length, computedFor: 'tailored', format: settings.resumeFormat, parse });
}

export async function runAnalysis(
  job: JobPosting,
  extractionUncertain: boolean,
  resume: MasterResume | null,
  profile: CareerProfile | undefined,
  deps: EngineDeps,
  onPhase: PhaseCallback = () => undefined,
): Promise<AnalysisResult> {
  onPhase('analyzing');
  let analysis = analyzeJobLocally(job, resume, profile, extractionUncertain);
  let notice: string | null = null;
  let claudeEvidence: AnalyzeJobReply['skillEvidence'] = [];
  // The local analysis is instant and drives the score; Claude analysis is opt-in (slower, costs tokens).
  if (useClaude(deps) && resume && deps.settings.deepAnalysisWithClaude) {
    try {
      const r = await provider(deps).analyzeJob(jobForPrompt(job, deps.settings.sendFullJobDescription), candidateFactsForPrompt(resume, profile), deps.signal);
      analysis = mergeAnalysis(analysis, r.data, r.model);
      claudeEvidence = r.data.skillEvidence ?? [];
    } catch (e: unknown) {
      if (e instanceof ClaudeError && e.code === 'aborted') throw e;
      notice = fallbackNotice(e, 'The analysis');
    }
  }
  onPhase('comparing');
  let evidence: SkillEvidence[] = [];
  let masterScore: MatchScore | null = null;
  let atsPlan: AtsPlan | null = null;
  let atsMaster: AtsReport | null = null;
  if (resume) {
    evidence = classifySkills(analysis.requiredSkills, analysis.preferredSkills, resume, profile);
    if (claudeEvidence.length) evidence = mergeClaudeEvidence(evidence, claudeEvidence, allowedCorpus(resume, profile));
    analysis = { ...analysis, missingQualifications: missingQualifications(evidence, analysis.risks) };
    masterScore = scoreMaster(job, analysis, evidence, resume, profile);
    const ats = planAts(job, analysis, resume, profile, deps.settings.defaultResumeLength);
    atsPlan = ats.plan;
    atsMaster = ats.master;
  }
  return { analysis, evidence, masterScore, notice, atsPlan, atsMaster };
}

export interface TailorResult {
  resume: TailoredResume;
  tailoredScore: MatchScore;
  notice: string | null;
  atsPlan: AtsPlan;
  atsMaster: AtsReport;
  atsTailored: AtsReport;
  /** The cover letter Claude wrote in the same request, when one was asked for. */
  letter: { text: string; model: string } | null;
}

/** Validate, auto-fix model mistakes back toward the master's facts, and record what changed. */
function checkTruthfulness(t: TailoredResume, master: MasterResume, profile: CareerProfile | undefined, ctx: Parameters<typeof validateTailoredResume>[1], supported: string[]): TailoredResume {
  let issues = validateTailoredResume(t, ctx);
  let out = t;
  if (hasCritical(issues)) {
    const before = issues.filter((i) => i.severity === 'critical' && i.autoFixable);
    const fixed = applyAutoFixes(out, master, profile, before, supported, ctx.plan ?? null);
    fixed.changes = [
      ...fixed.changes,
      ...before.map((i) => ({ section: 'Truthfulness check', before: i.excerpt ?? '', after: '(reverted to your original wording)', reason: i.message })),
    ];
    out = fixed;
    issues = validateTailoredResume(out, ctx);
  }
  return { ...out, issues };
}

export interface LetterRequest {
  tone: CoverLetterTone;
  minWords: number;
  maxWords: number;
}

/**
 * The ATS resume engine:
 *   1. plan — job keywords, which ones the master resume backs, headline title, years, bullets per job (local)
 *   2. write — ONE Claude request returns the resume content (and the cover letter) as compact JSON;
 *      without a key the local engine writes from the same plan
 *   3. assemble — employers, titles, dates, education and contact details come from the master resume (local)
 *   4. optimize + verify — supported keywords guaranteed, anything not backed by the facts reverted (local)
 *   5. scan — ATS score; an optional refine request (off by default) fixes what the scan found
 * The PDF is drawn later from the resulting JSON by ApplyFlow's own renderer — no AI.
 */
export async function runTailoring(
  session: JobSession,
  master: MasterResume,
  profile: CareerProfile | undefined,
  deps: EngineDeps,
  onPhase: PhaseCallback = () => undefined,
  letter: LetterRequest | null = null,
): Promise<TailorResult> {
  if (!session.analysis) throw new Error('Analyze the job first.');
  const version = (session.resume?.version ?? 0) + 1;
  const length = deps.settings.defaultResumeLength;
  const { plan, master: atsMaster } = planAts(session.job, session.analysis, master, profile, length);
  const forbidden = Array.from(new Set([...unsupportedKeywords(session.evidence), ...forbiddenTerms(plan)]));
  const supported = Array.from(new Set([...supportedKeywords(session.evidence), ...plan.keywords.filter((k) => k.support === 'supported').map((k) => k.term)]));
  const ctx = { master, profile, job: session.job, evidence: session.evidence, length, plan };
  const finish = (t: TailoredResume) => checkTruthfulness(optimizeForAts(t, { plan, master, profile }), master, profile, ctx, supported);
  onPhase('generating_resume');
  let tailored: TailoredResume | null = null;
  let notice: string | null = null;
  let letterOut: TailorResult['letter'] = null;
  const facts = compactFacts(master, profile);
  const cPlan = compactPlan(promptPlan(plan, master), facts.jobIds);
  const cJob = compactJob(session.job, deps.settings.sendFullJobDescription);
  if (useClaude(deps)) {
    try {
      const r = await provider(deps).writeApplication(
        facts,
        { job: cJob, plan: cPlan, forbidden, length, summaryHint: session.analysis.summaryDirection, letter },
        deps.signal,
      );
      tailored = assembleFromClaude(toTailorReply(r.data, facts.jobIds), master, profile, version, r.model, plan);
      const text = letterText(r.data.letter);
      if (text) letterOut = { text, model: r.model };
    } catch (e: unknown) {
      if (e instanceof ClaudeError && e.code === 'aborted') throw e;
      notice = fallbackNotice(e, 'The resume');
    }
  }
  if (!tailored) tailored = tailorLocally({ master, profile, job: session.job, analysis: session.analysis, evidence: session.evidence, length, version, plan });

  onPhase('validating');
  tailored = finish(tailored);
  let atsTailored = scanTailored(tailored, plan, master, deps.settings);

  // Optional ATS refine pass (a second request): keep the result only if it scores higher and stays truthful.
  const findings = refineFindings(tailored, atsTailored, plan);
  if (tailored.engine === 'claude' && deps.settings.atsRefinePass && findings.length && atsTailored.score < 98) {
    try {
      onPhase('generating_resume');
      const toShort = Object.fromEntries(Object.entries(facts.jobIds).map(([s, l]) => [l, s]));
      const shortFindings = findings.map((f) => f.replace(/exp:([\w-]+)/g, (m, id: string) => toShort[id] ?? m));
      const r = await provider(deps).refineApplication(facts, { draft: draftFromTailored(tailored, facts.jobIds), findings: shortFindings, plan: cPlan, forbidden, job: cJob }, deps.signal);
      const assembled = assembleFromClaude(toTailorReply(r.data, facts.jobIds), master, profile, version, r.model, plan);
      // The refine pass only fixes findings; the first draft's project selection stays.
      const refined = finish({ ...assembled, projects: r.data.projects?.length ? assembled.projects : tailored.projects, certifications: tailored.certifications, changes: [...tailored.changes] });
      const refinedScan = scanTailored(refined, plan, master, deps.settings);
      const criticalBefore = tailored.issues.filter((i) => i.severity === 'critical').length;
      const criticalAfter = refined.issues.filter((i) => i.severity === 'critical').length;
      if (refinedScan.score >= atsTailored.score && criticalAfter <= criticalBefore) {
        refined.changes.push({ section: 'ATS check', before: `ATS score ${atsTailored.score}`, after: `ATS score ${refinedScan.score}`, reason: `A second pass fixed: ${findings.length} finding(s) from the ATS scan.` });
        tailored = refined;
        atsTailored = refinedScan;
      }
    } catch (e: unknown) {
      if (e instanceof ClaudeError && e.code === 'aborted') throw e;
      // The first draft is complete and verified; the refine pass is a bonus.
    }
  }
  onPhase('validating');
  const tailoredScore = scoreTailored(session.job, session.analysis, session.evidence, master, tailored, profile);
  return { resume: tailored, tailoredScore, notice, atsPlan: plan, atsMaster, atsTailored, letter: letterOut };
}

export const COVER_LETTER_WORDS = { min: 250, max: 400 };

export async function runCoverLetter(
  session: JobSession,
  master: MasterResume,
  profile: CareerProfile | undefined,
  deps: EngineDeps,
  tone: CoverLetterTone,
  action: CoverLetterAction | null = null,
  onPhase: PhaseCallback = () => undefined,
): Promise<{ coverLetter: CoverLetter; notice: string | null }> {
  if (session.resume?.contentSource === 'cv-generate') {
    if (!useClaude(deps)) throw new Error('Configure Claude in Settings to write the cover letter.');
    onPhase('generating_cover_letter');
    const r = await provider(deps).generateCv(compactFacts(master, profile), compactJob(session.job, deps.settings.sendFullJobDescription, 40000), deps.signal,
      JSON.stringify({resume:session.resume, task:'Keep the resume content unchanged. Write a cover letter consistent with this exact draft.',tone,action,current:session.coverLetter?.text}));
    const text = r.data.cover_letter;
    return { coverLetter:{version:(session.coverLetter?.version??0)+1,tone,text,wordCount:wordCount(text),issues:[],engine:'claude',model:r.model,generatedAt:nowIso(),editedByUser:false},notice:null };
  }
  if (!session.resume && !useClaude(deps)) throw new Error('Generate the tailored resume first.');
  onPhase('generating_cover_letter');
  const version = (session.coverLetter?.version ?? 0) + 1;
  let text: string | null = null;
  let model: string | null = null;
  let notice: string | null = null;
  if (useClaude(deps)) {
    try {
      const r = await provider(deps).writeLetter(
        compactFacts(master, profile),
        {
          job: compactJob(session.job, deps.settings.sendFullJobDescription),
          forbidden: unsupportedKeywords(session.evidence),
          tone,
          minWords: action === 'shorter' ? 180 : COVER_LETTER_WORDS.min,
          maxWords: action === 'shorter' ? 280 : COVER_LETTER_WORDS.max,
          current: action && session.coverLetter ? session.coverLetter.text : null,
          action: action && session.coverLetter ? action : null,
        },
        deps.signal,
      );
      text = letterText(r.data.letter);
      model = r.model;
    } catch (e: unknown) {
      if (e instanceof ClaudeError && e.code === 'aborted') throw e;
      notice = fallbackNotice(e, 'The cover letter');
    }
  }
  if (!text) {
    if (!session.resume) throw new Error('Generate the tailored resume first.');
    text = generateLocalCoverLetter({ job: session.job, master, resume: session.resume, profile, evidence: session.evidence, tone, action: action ?? undefined, variant: action === 'regenerate' ? version : 0 });
  }
  onPhase('validating');
  const min = action === 'shorter' ? 150 : model ? COVER_LETTER_WORDS.min : 150;
  const issues = validateCoverLetter(text, { master, profile, job: session.job, evidence: session.evidence, minWords: min, maxWords: COVER_LETTER_WORDS.max });
  return {
    coverLetter: { version, tone, text, wordCount: wordCount(text), issues, engine: model ? 'claude' : 'local', model, generatedAt: nowIso(), editedByUser: false },
    notice,
  };
}

/** Re-validate after the user edits the resume by hand. */
export function revalidateEdited(t: TailoredResume, session: JobSession, master: MasterResume, profile: CareerProfile | undefined, length: Settings['defaultResumeLength']): TailoredResume {
  if (t.contentSource === 'cv-generate') return { ...t, editedByUser: true, version: t.version + 1, generatedAt: nowIso() };
  const issues = validateTailoredResume(t, { master, profile, job: session.job, evidence: session.evidence, length, plan: session.atsPlan ?? null });
  return { ...t, issues, editedByUser: true };
}

export function revalidateLetter(text: string, cl: CoverLetter, session: JobSession, master: MasterResume, profile: CareerProfile | undefined): CoverLetter {
  if (session.resume?.contentSource === 'cv-generate') return { ...cl, text, wordCount: wordCount(text), issues: [], editedByUser: true };
  const issues = validateCoverLetter(text, { master, profile, job: session.job, evidence: session.evidence, minWords: 150, maxWords: COVER_LETTER_WORDS.max });
  return { ...cl, text, wordCount: wordCount(text), issues, editedByUser: true };
}

/** A cover letter from text Claude already wrote (in the application request). */
export function letterFromText(text: string, model: string, session: JobSession, master: MasterResume, profile: CareerProfile | undefined, tone: CoverLetterTone): CoverLetter {
  const version = (session.coverLetter?.version ?? 0) + 1;
  const issues = validateCoverLetter(text, { master, profile, job: session.job, evidence: session.evidence, minWords: COVER_LETTER_WORDS.min, maxWords: COVER_LETTER_WORDS.max });
  return { version, tone, text, wordCount: wordCount(text), issues, engine: 'claude', model, generatedAt: nowIso(), editedByUser: false };
}

/**
 * Resume and cover letter together via two separate Claude requests:
 *   1. company research only (must finish successfully first)
 *   2. CV Generate using researched employer names already written into CANDIDATE.jobs
 * CV generate never starts until research returns usable companies.
 */
export async function runDocuments(
  session: JobSession,
  master: MasterResume,
  profile: CareerProfile | undefined,
  deps: EngineDeps,
  tone: CoverLetterTone,
  onPhase: PhaseCallback = () => undefined,
): Promise<{ resume: TailoredResume; tailoredScore: MatchScore; coverLetter: CoverLetter | null; notices: string[]; atsPlan: AtsPlan; atsMaster: AtsReport; atsTailored: AtsReport; companyResearch?: CompanyResearchReply | null }> {
  if (!session.analysis) throw new Error('Analyze the job first.');
  if (!useClaude(deps)) throw new Error('Add a Claude API key and select the Claude engine in Settings. AI generation cannot use the local rewrite engine.');
  const baseFacts = compactFacts(master, profile);
  if (!Object.keys(baseFacts.jobIds).length) throw new Error('Add employer names and dates in Profile settings.');
  // Token savings: prefer structured lists; cap full description when the user allows it.
  const job = compactJob(session.job, deps.settings.sendFullJobDescription, 12000);
  const tech = [
    ...session.analysis.requiredSkills,
    ...session.analysis.preferredSkills,
    ...session.analysis.tools,
    ...session.analysis.resumeKeywords,
  ].slice(0, 28);

  const p = provider(deps);
  onPhase('researching_companies');
  let research: CompanyResearchReply;
  try {
    research = (await p.researchCompanies(baseFacts, job, tech, deps.signal)).data;
  } catch (e) {
    if (deps.signal?.aborted) throw e;
    const msg = e instanceof Error ? e.message : 'Company research failed.';
    throw new Error(`Company research must finish before resume generation. ${msg}`);
  }
  if (!research.companies.length) {
    throw new Error('Company research returned no employers. Resume generation was not started.');
  }

  const applied = applyCompanyResearch(master, research);
  const workingMaster = applied.master;
  const facts = compactFacts(workingMaster, profile);
  onPhase('generating_resume');
  let result = await p.generateCv(facts, job, deps.signal, undefined, research);
  let resume = assembleCv(result.data, workingMaster, profile, session, result.model);
  const measure = (t: TailoredResume) => {
    const corpus = draftCorpus(t, workingMaster);
    const { plan } = planAts(session.job, session.analysis!, corpus, profile, deps.settings.defaultResumeLength);
    return { plan, ats: scanTailored(t, plan, corpus, deps.settings), match: scoreTailored(session.job, session.analysis!, [], workingMaster, t, profile) };
  };
  let measured = measure(resume);
  const list = research.companies
    .slice()
    .sort((a, b) => a.periodIndex - b.periodIndex)
    .map((c) => `${c.periodIndex + 1}. ${c.name}${c.hq ? ` (${c.hq})` : ''}`)
    .join('; ');
  const notices: string[] = [
    `Company research completed before resume generation: ${list}. Verify employment claims before submitting.`,
  ];
  if (applied.replaced.length) {
    notices.push(
      `Employers used for CV generate: ${applied.replaced
        .map((r) => `${r.from} → ${r.to}${r.location ? ` @ ${r.location}` : ''}`)
        .join('; ')}.`,
    );
  } else {
    notices.push('Researched employer names already matched Profile; those names and HQs were kept for CV generate.');
  }
  notices.push('Verify generated claims before submitting. Scores describe draft coverage, not verified experience.');
  // Bounded improvement: one extra refine at most (saves tokens); never fabricate the measured score.
  for (let pass = 0; pass < 1 && (measured.ats.score <= 95 || measured.match.total <= 95); pass++) {
    const missing = measured.ats.keywords.filter((k) => k.found === 'missing').map((k) => k.term).slice(0, 16);
    const revision = JSON.stringify({
      target: '>95',
      ats: measured.ats.score,
      match: measured.match.total,
      missingKeywords: missing,
      checks: measured.ats.checks.filter((c) => c.status !== 'pass').map((c) => c.label).slice(0, 8),
    });
    try {
      const refined = await p.generateCv(facts, job, deps.signal, revision, research);
      const next = assembleCv(refined.data, workingMaster, profile, session, refined.model);
      const score = measure(next);
      if (score.ats.score >= measured.ats.score && score.match.total >= measured.match.total) {
        result = refined;
        resume = next;
        measured = score;
      }
    } catch (e) {
      if (deps.signal?.aborted) throw e;
      notices.push('The optimization pass failed. The completed first draft is available.');
      break;
    }
  }
  if (measured.ats.score <= 95 || measured.match.total <= 95) notices.push(`Target not reached: ATS ${measured.ats.score}/100; draft match ${measured.match.total}/100. See the remaining findings.`);
  onPhase('validating');
  const text = result.data.cover_letter;
  const coverLetter: CoverLetter | null = session.includeCoverLetter
    ? { version: (session.coverLetter?.version ?? 0) + 1, tone, text, wordCount: wordCount(text), issues: [], engine: 'claude', model: result.model, generatedAt: resume.generatedAt, editedByUser: false }
    : null;
  const original = planAts(session.job, session.analysis, master, profile, deps.settings.defaultResumeLength);
  return { resume, coverLetter, tailoredScore: measured.match, notices, atsPlan: measured.plan, atsMaster: original.master, atsTailored: measured.ats, companyResearch: research };
}
