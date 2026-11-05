import type { Settings, ModelOption, CoverLetterAction } from '@/types';
import { TRUTHFULNESS_RULES } from '@/prompts/system';
import { ANALYZE_JOB_SCHEMA, buildAnalyzeJobPrompt, type AnalyzeJobReply } from '@/prompts/analyzeJob';
import { TAILOR_RESUME_SCHEMA, buildRefineResumePrompt, buildTailorResumePrompt, type RefinePromptInput, type TailorPromptInput, type TailorResumeReply } from '@/prompts/tailorResume';
import {
  COVER_LETTER_SCHEMA,
  buildCoverLetterPrompt,
  buildReviseCoverLetterPrompt,
  type CoverLetterPromptInput,
  type CoverLetterReply,
} from '@/prompts/coverLetter';
import {
  EXPLAIN_SCORE_SCHEMA,
  IMPROVE_BULLET_SCHEMA,
  buildExplainScorePrompt,
  buildImproveBulletPrompt,
  type ExplainScoreReply,
  type ImproveBulletReply,
} from '@/prompts/misc';
import {
  LETTER_SCHEMA,
  applicationSchema,
  buildApplicationPrompt,
  buildLetterPrompt,
  buildRefinePrompt,
  systemBlocks,
  type ApplicationPromptInput,
  type ApplicationReply,
  type CompactFacts,
} from '@/prompts/application';
import { AnthropicClient, parseJsonReply, type ClientConfig, type SystemBlock, type Usage } from './client';
import { ClaudeError } from './errors';
import { cvSystem, cvUser, CV_SCHEMA, validateCv, type CvReply } from '@/prompts/cvGenerate';
import {
  COMPANY_RESEARCH_SCHEMA,
  COMPANY_RESEARCH_SYSTEM,
  companyResearchUser,
  validateCompanyResearch,
  type CompanyResearchReply,
} from '@/prompts/companyResearch';
import {
  ROLE_TITLES_SCHEMA,
  ROLE_TITLES_SYSTEM,
  roleTitlesUser,
  validateRoleTitlesReply,
  type RoleTitlesReply,
} from '@/prompts/roleTitles';

export interface ProviderResult<T> {
  data: T;
  model: string;
  usage?: Usage;
}

export type UsageReporter = (task: string, model: string, usage: Usage) => void;

export class ClaudeProvider {
  private readonly client: AnthropicClient;
  private readonly settings: Pick<Settings, 'model' | 'maxOutputTokens' | 'sendTemperature' | 'temperature' | 'apiVersion'> & { effort?: Settings['effort']; promptCache?: Settings['promptCache'] };
  private readonly onUsage?: UsageReporter;

  constructor(
    apiKey: string | null,
    settings: Pick<Settings, 'model' | 'maxOutputTokens' | 'sendTemperature' | 'temperature' | 'apiVersion' | 'requestTimeoutSeconds'> & { effort?: Settings['effort']; promptCache?: Settings['promptCache'] },
    overrides: Partial<Pick<ClientConfig, 'fetchImpl' | 'sleep' | 'isOnline' | 'maxRetries'>> & { onUsage?: UsageReporter } = {},
  ) {
    if (!apiKey) throw new ClaudeError('no_key');
    if (!settings.model.trim()) throw new ClaudeError('model_not_found', { detail: 'No model selected' });
    this.settings = settings;
    const { onUsage, ...clientOverrides } = overrides;
    this.onUsage = onUsage;
    this.client = new AnthropicClient({
      apiKey,
      apiVersion: settings.apiVersion,
      timeoutMs: Math.max(10, settings.requestTimeoutSeconds) * 1000,
      ...clientOverrides,
    });
  }

  private temperature(): number | undefined {
    return this.settings.sendTemperature ? this.settings.temperature : undefined;
  }

  private effort(): 'low' | 'medium' | 'high' | undefined {
    const e = this.settings.effort ?? 'low';
    return e === 'model_default' ? undefined : e;
  }

  private async json<T>(user: string, schema: Record<string, unknown>, floor = 8000, signal?: AbortSignal, system: string | SystemBlock[] = TRUTHFULNESS_RULES, task = 'other'): Promise<ProviderResult<T>> {
    const res = await this.client.createMessage({
      model: this.settings.model,
      system,
      cacheTtl: this.settings.promptCache ?? '5m',
      user,
      maxTokens: Math.max(floor, this.settings.maxOutputTokens),
      jsonSchema: schema,
      temperature: this.temperature(),
      effort: this.effort(),
      signal,
    });
    this.onUsage?.(task, res.model, res.usage);
    return { data: parseJsonReply<T>(res.text), model: res.model, usage: res.usage };
  }

  writeApplication(facts: CompactFacts, input: ApplicationPromptInput, signal?: AbortSignal): Promise<ProviderResult<ApplicationReply>> {
    return this.json<ApplicationReply>(buildApplicationPrompt(input), applicationSchema(Boolean(input.letter)), 12000, signal, systemBlocks(facts), 'application');
  }

  writeLetter(facts: CompactFacts, input: Parameters<typeof buildLetterPrompt>[0], signal?: AbortSignal): Promise<ProviderResult<{ letter: string[] }>> {
    return this.json<{ letter: string[] }>(buildLetterPrompt(input), LETTER_SCHEMA as unknown as Record<string, unknown>, 6000, signal, systemBlocks(facts), 'cover_letter');
  }

  refineApplication(facts: CompactFacts, input: Parameters<typeof buildRefinePrompt>[0], signal?: AbortSignal): Promise<ProviderResult<ApplicationReply>> {
    return this.json<ApplicationReply>(buildRefinePrompt(input), applicationSchema(false), 12000, signal, systemBlocks(facts), 'refine');
  }

  async researchCompanies(_facts: CompactFacts, job: Record<string, unknown>, tech: string[], signal?: AbortSignal): Promise<ProviderResult<CompanyResearchReply>> {
    const r = await this.json<CompanyResearchReply>(
      companyResearchUser(job, tech),
      COMPANY_RESEARCH_SCHEMA,
      4000,
      signal,
      COMPANY_RESEARCH_SYSTEM,
      'company_research',
    );
    validateCompanyResearch(r.data);
    return r;
  }

  async suggestRoleTitles(
    job: Record<string, unknown>,
    periodCount: number,
    signal?: AbortSignal,
  ): Promise<ProviderResult<RoleTitlesReply>> {
    const r = await this.json<RoleTitlesReply>(
      roleTitlesUser(job, periodCount),
      ROLE_TITLES_SCHEMA,
      4000,
      signal,
      ROLE_TITLES_SYSTEM,
      'role_titles',
    );
    validateRoleTitlesReply(r.data, periodCount);
    return r;
  }

  async generateCv(
    facts: CompactFacts,
    job: Record<string, unknown>,
    signal?: AbortSignal,
    revision?: string,
  ): Promise<ProviderResult<CvReply>> {
    const r = await this.json<CvReply>(cvUser(job, revision, facts), CV_SCHEMA, 14000, signal, cvSystem(facts), 'cv_generate');
    validateCv(r.data, Object.keys(facts.jobIds).length);
    return r;
  }

  async testConnection(): Promise<{ model: string; latencyMs: number }> {
    const started = Date.now();
    const res = await this.client.createMessage({
      model: this.settings.model,
      system: 'Reply with the single word OK.',
      user: 'Connection test.',
      maxTokens: 1024,
      temperature: this.temperature(),
      effort: 'low',
    });
    return { model: res.model, latencyMs: Date.now() - started };
  }

  listModels(): Promise<ModelOption[]> {
    return this.client.listModels();
  }

  analyzeJob(job: unknown, candidateFacts: unknown, signal?: AbortSignal): Promise<ProviderResult<AnalyzeJobReply>> {
    return this.json<AnalyzeJobReply>(buildAnalyzeJobPrompt(job, candidateFacts), ANALYZE_JOB_SCHEMA as unknown as Record<string, unknown>, 12000, signal);
  }

  tailorResume(input: TailorPromptInput, signal?: AbortSignal): Promise<ProviderResult<TailorResumeReply>> {
    return this.json<TailorResumeReply>(buildTailorResumePrompt(input), TAILOR_RESUME_SCHEMA as unknown as Record<string, unknown>, 16000, signal);
  }

  refineResume(input: RefinePromptInput, signal?: AbortSignal): Promise<ProviderResult<TailorResumeReply>> {
    return this.json<TailorResumeReply>(buildRefineResumePrompt(input), TAILOR_RESUME_SCHEMA as unknown as Record<string, unknown>, 16000, signal);
  }

  async generateCoverLetter(input: CoverLetterPromptInput, signal?: AbortSignal): Promise<ProviderResult<string>> {
    const r = await this.json<CoverLetterReply>(buildCoverLetterPrompt(input), COVER_LETTER_SCHEMA as unknown as Record<string, unknown>, 8000, signal);
    return { data: r.data.text, model: r.model };
  }

  async reviseCoverLetter(current: string, action: CoverLetterAction, input: CoverLetterPromptInput, signal?: AbortSignal): Promise<ProviderResult<string>> {
    const r = await this.json<CoverLetterReply>(
      buildReviseCoverLetterPrompt(current, action, input),
      COVER_LETTER_SCHEMA as unknown as Record<string, unknown>,
      8000,
      signal,
    );
    return { data: r.data.text, model: r.model };
  }

  explainMatchScore(score: unknown, evidence: unknown, job: unknown): Promise<ProviderResult<ExplainScoreReply>> {
    return this.json<ExplainScoreReply>(buildExplainScorePrompt(score, evidence, job), EXPLAIN_SCORE_SCHEMA as unknown as Record<string, unknown>, 4000);
  }

  improveResumeBullet(bullet: string, jobContext: unknown, allowedKeywords: string[]): Promise<ProviderResult<ImproveBulletReply>> {
    return this.json<ImproveBulletReply>(
      buildImproveBulletPrompt(bullet, jobContext, allowedKeywords),
      IMPROVE_BULLET_SCHEMA as unknown as Record<string, unknown>,
      4000,
    );
  }
}
