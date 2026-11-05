import type {
  AtsPlan, AtsReport, CareerProfile, CoverLetter, CoverLetterAction, CoverLetterTone, JobAnalysis, JobPosting, JobSession, MasterResume,
  MatchScore, ParseCheck, ProgressPhase, RiskWarning, Settings, SkillEvidence, TailoredResume,
} from '@/types';
import { buildAtsPlan, docFromMaster, docFromTailored, extractJobKeywords, forbiddenTerms, scanResume } from '@/services/ats';
import { optimizeForAts, promptPlan, refineFindings } from '@/services/tailoring/atsTailor';
import { ClaudeProvider, type UsageReporter } from '@/services/claude/provider';
import { ClaudeChatProvider, type ChatCompleteRequest } from '@/services/claude/chatResume';
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
import { alignResearchToEmployers, applyCompanyResearch, assembleCv, draftCorpus } from './cvEngine';
import { loadCompanyResearch, persistCompanyResearch } from './companyResearchStore';
import type { CompanyResearchReply } from '@/prompts/companyResearch';

export interface EngineDeps {
  settings: Settings;
  apiKey: string | null;
  providerFactory?: (apiKey: string, settings: Settings) => ClaudeProvider;
  signal?: AbortSignal;
  onUsage?: UsageReporter;
  chatComplete?: (req: ChatCompleteRequest) => Promise<{ text: string; model: string }>;
  saveCompanyResearch?: (jobKey: string, research: CompanyResearchReply) => void | Promise<void>;
  loadCompanyResearch?: (jobKey: string) => CompanyResearchReply | null | Promise<CompanyResearchReply | null>;
}

interface ResumeModel {
  analyzeJob: ClaudeProvider['analyzeJob'];
  writeApplication: ClaudeProvider['writeApplication'];
  refineApplication: ClaudeProvider['refineApplication'];
  writeLetter: ClaudeProvider['writeLetter'];
  researchCompanies: ClaudeProvider['researchCompanies'];
  generateCv: ClaudeProvider['generateCv'];
}

export type PhaseCallback = (p: ProgressPhase) => void;

function useClaude(deps: EngineDeps): boolean {
  return deps.settings.engine === 'claude' && Boolean(deps.apiKey);
}

function useResumeModel(deps: EngineDeps): boolean {
  return deps.settings.engine === 'claude' && (deps.settings.resumeGenerationMethod === 'chat' || Boolean(deps.apiKey));
}

function resumeModelError(deps: EngineDeps): string {
  if (deps.settings.resumeGenerationMethod === 'chat') return 'Turn on “Write documents with Claude” and sign in to Claude.ai from the sidebar indicator. Resume generation will not use the local rewrite engine.';
  return 'Add a Claude API key and select the Claude engine in Settings. AI generation cannot use the local rewrite engine.';
}

function provider(deps: EngineDeps): ResumeModel {
  if (deps.settings.resumeGenerationMethod === 'chat') return new ClaudeChatProvider(deps);
  return deps.providerFactory ? deps.providerFactory(deps.apiKey!, deps.settings) : new ClaudeProvider(deps.apiKey, deps.settings, { onUsage: deps.onUsage });
}

function fallbackNotice(e: unknown, what: string): string {
  const msg = e instanceof ClaudeError ? e.userMessage : 'Claude could not be reached.';
  return `${msg} ${what} used the local engine instead.`;
}

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
  letter: { text: string; model: string } | null;
}

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

  const findings = refineFindings(tailored, atsTailored, plan);
  if (tailored.engine === 'claude' && deps.settings.atsRefinePass && findings.length && atsTailored.score < 98) {
    try {
      onPhase('generating_resume');
      const toShort = Object.fromEntries(Object.entries(facts.jobIds).map(([s, l]) => [l, s]));
      const shortFindings = findings.map((f) => f.replace(/exp:([\w-]+)/g, (m, id: string) => toShort[id] ?? m));
      const r = await provider(deps).refineApplication(facts, { draft: draftFromTailored(tailored, facts.jobIds), findings: shortFindings, plan: cPlan, forbidden, job: cJob }, deps.signal);
      const assembled = assembleFromClaude(toTailorReply(r.data, facts.jobIds), master, profile, version, r.model, plan);
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
    if (!useResumeModel(deps)) throw new Error(deps.settings.resumeGenerationMethod === 'chat' ? 'Sign in to Claude.ai from the sidebar indicator to write the cover letter.' : 'Configure Claude in Settings to write the cover letter.');
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

export function letterFromText(text: string, model: string, session: JobSession, master: MasterResume, profile: CareerProfile | undefined, tone: CoverLetterTone): CoverLetter {
  const version = (session.coverLetter?.version ?? 0) + 1;
  const issues = validateCoverLetter(text, { master, profile, job: session.job, evidence: session.evidence, minWords: COVER_LETTER_WORDS.min, maxWords: COVER_LETTER_WORDS.max });
  return { version, tone, text, wordCount: wordCount(text), issues, engine: 'claude', model, generatedAt: nowIso(), editedByUser: false };
}

export async function runDocuments(
  session: JobSession,
  master: MasterResume,
  profile: CareerProfile | undefined,
  deps: EngineDeps,
  tone: CoverLetterTone,
  onPhase: PhaseCallback = () => undefined,
): Promise<{ resume: TailoredResume; tailoredScore: MatchScore; coverLetter: CoverLetter | null; notices: string[]; atsPlan: AtsPlan; atsMaster: AtsReport; atsTailored: AtsReport; companyResearch?: CompanyResearchReply | null }> {
  if (!session.analysis) throw new Error('Analyze the job first.');
  if (!useResumeModel(deps)) throw new Error(resumeModelError(deps));
  const baseFacts = compactFacts(master, profile);
  if (!Object.keys(baseFacts.jobIds).length) throw new Error('Add employer names and dates in Profile settings.');
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
    const msg = e instanceof ClaudeError ? e.userMessage : e instanceof Error ? e.message : 'Company research failed.';
    throw new Error(`Company research did not complete, so resume generation was not started. ${msg}`);
  }
  if (!research.companies.length) {
    throw new Error('Company research returned no companies. Resume generation was not started.');
  }

  const periodCount = Object.keys(baseFacts.jobIds).length;
  const aligned = alignResearchToEmployers(research, periodCount);
  await persistCompanyResearch(deps, session.jobKey, aligned);
  const stored = (await loadCompanyResearch(deps, session.jobKey)) ?? aligned;
  const { master: draftMaster, replaced } = applyCompanyResearch(master, stored);
  const facts = compactFacts(draftMaster, profile);

  onPhase('generating_resume');
  let result: Awaited<ReturnType<ResumeModel['generateCv']>>;
  try {
    result = await p.generateCv(facts, job, deps.signal);
  } catch (e) {
    if (deps.signal?.aborted) throw e;
    const msg = e instanceof ClaudeError ? e.userMessage : e instanceof Error ? e.message : 'Resume generation failed.';
    const names = stored.companies.map((c) => c.name).join(', ');
    throw new Error(`Company research was saved (${names}), but resume generation failed. ${msg}`);
  }
  let resume = assembleCv(result.data, draftMaster, profile, session, result.model);
  const measure = (t: TailoredResume) => {
    const corpus = draftCorpus(t, master);
    const { plan } = planAts(session.job, session.analysis!, corpus, profile, deps.settings.defaultResumeLength);
    return { plan, ats: scanTailored(t, plan, corpus, deps.settings), match: scoreTailored(session.job, session.analysis!, [], master, t, profile) };
  };
  let measured = measure(resume);
  const list = research.companies
    .slice()
    .sort((a, b) => a.periodIndex - b.periodIndex)
    .map((c) => `${c.periodIndex + 1}. ${c.name}${c.hq ? ` (${c.hq})` : ''}`)
    .join('; ');
  const notices: string[] = [
    `Company research completed: ${list}.`,
    'Verify generated claims before submitting. Scores describe draft coverage, not verified experience.',
  ];
  if (replaced.length) {
    notices.push(
      `Employer labels updated from saved research: ${replaced.map((r) => `${r.from} → ${r.to}`).join('; ')}.`,
    );
  }
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
      const refined = await p.generateCv(facts, job, deps.signal, revision);
      const next = assembleCv(refined.data, draftMaster, profile, session, refined.model);
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
