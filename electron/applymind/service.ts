import type { CareerProfile } from '../../src/types';
import { migrationLogLine, planMigration } from '../../src/services/applymind/plan';
import { shouldActivate, trainFromRecords } from '../../src/services/applymind/train';
import type { ExactLookup } from '../../src/services/applymind/exact';
import type { ApplyMindStatus, LearnedBundle, ProposalView } from '../../src/services/applymind/types';
import { mergeKnowledge, verifySection, type ApplyMindSection, type KnowledgeMerge } from '../../src/services/applymind/transfer';
import type { Store } from '../db';
import { loadOrCreateDek, type KeyWrapper } from './crypto';
import { blockedQuestions, holdCandidateCount, holdFillerRecords as holdRows, listReviews, readSection, resolveReview, writeMerged } from './exchange';
import { type ReviewAction, type ReviewItem } from '../../src/services/applymind/transfer';
import { KnowledgeRepository } from './repository';

export interface SyncReport {
  answersSeen: number;
  created: number;
  unchanged: number;
  edited: number;
  deleted: number;
  proposals: number;
  patterns: number;
  backupPath: string | null;
  modelVersion: string | null;
  tierAUnlocked: boolean;
  trained: boolean;
  logLine: string;
}

export class ApplyMindService {
  constructor(
    private current: () => Store,
    private keyFile: string,
    private wrapper: KeyWrapper,
  ) {}

  private repo(): KnowledgeRepository {
    const store = this.current();
    return new KnowledgeRepository(store.db, store.deviceId);
  }

  private dek(): Promise<Uint8Array> {
    return loadOrCreateDek(this.keyFile, this.wrapper);
  }

  /**
   * Copies saved screening answers into the knowledge store.
   * The first copy waits for a backup. Profile facts stay proposals until confirmFacts.
   */
  async syncFromProfile(profile: CareerProfile | null, opts?: { backup?: () => Promise<string | null>; alreadyBackedUp?: boolean; corrections?: boolean }): Promise<SyncReport> {
    const store = this.current();
    const answers = profile?.approvedAnswers ?? [];
    const repo = this.repo();
    const key = await this.dek();
    let backupPath: string | null = repo.meta('applymind.backupPath');
    if (!repo.meta('applymind.backupAt') && answers.length > 0 && repo.countActive() === 0) {
      if (opts?.alreadyBackedUp) {
        repo.setMeta('applymind.backupAt', new Date().toISOString());
      } else if (opts?.backup) {
        backupPath = await opts.backup();
        repo.setMeta('applymind.backupAt', new Date().toISOString());
        if (backupPath) repo.setMeta('applymind.backupPath', backupPath);
      } else {
        throw new Error('ApplyMind will not copy answers until the database has been backed up.');
      }
    }
    const now = new Date().toISOString();
    const counts = repo.apply(planMigration(answers, store.deviceId, now), key, now, opts?.corrections === false ? 'preserve' : 'correct');
    const trained = this.trainIfNeeded(repo, key, counts.changed);
    const model = trained.model;
    const report: SyncReport = {
      answersSeen: counts.answersSeen,
      created: counts.created,
      unchanged: counts.unchanged,
      edited: counts.edited,
      deleted: counts.deleted,
      proposals: counts.proposals,
      patterns: counts.patterns,
      backupPath,
      modelVersion: model?.version ?? null,
      tierAUnlocked: model?.tierAUnlocked ?? false,
      trained: trained.ran,
      logLine: '',
    };
    report.logLine = migrationLogLine(report);
    if (model) repo.setMeta('applymind.trainedVersion', model.version);
    return report;
  }

  async proposals(): Promise<ProposalView[]> {
    return this.repo().proposals(await this.dek());
  }

  confirmFacts(ids: string[]): number {
    return this.repo().confirmFacts(ids, new Date().toISOString());
  }

  async status(): Promise<ApplyMindStatus> {
    const repo = this.repo();
    const model = repo.activeModel();
    return {
      records: repo.countActive(),
      patterns: repo.patternCount(),
      verified: repo.countVerified(),
      proposedFacts: repo.proposals(await this.dek()).length,
      confirmedFacts: repo.confirmedCount(),
      modelVersion: model?.version ?? null,
      tierAUnlocked: model?.tierAUnlocked ?? false,
      trainedRecords: model?.records ?? 0,
      backupAt: repo.meta('applymind.backupAt'),
    };
  }

  /** Test and repair path: train on whatever verified records are stored. */
  async retrain(): Promise<LearnedBundle | null> {
    const repo = this.repo();
    return (await this.trainIfNeeded(repo, await this.dek(), true)).model;
  }

  async exact(query: ExactLookup): Promise<string | null> {
    return this.repo().exactVerified(await this.dek(), query);
  }

  async acceptFills(items: { question: string; answer: string; category: string; options: string[]; control: string }[]): Promise<number> {
    return this.repo().acceptFills(items, await this.dek(), new Date().toISOString());
  }

  /** Turns the filler-written records into accepted review items. Backs up first when any row will change. */
  async holdFillerRecords(backup: () => Promise<string | null>): Promise<number> {
    const store = this.current();
    const waiting = holdCandidateCount(store.db);
    if (!waiting) return 0;
    await backup();
    const n = holdRows(store.db, await this.dek(), store.deviceId, new Date().toISOString());
    return n;
  }

  async exportSection(info: { appVersion: string; autoFillSavedAnswers: boolean | null }): Promise<ApplyMindSection> {
    const store = this.current();
    return readSection(store.db, await this.dek(), { ...info, deviceId: store.deviceId, exportedAt: new Date().toISOString() });
  }

  async prepareImport(section: ApplyMindSection): Promise<{ report: { added: number; merged: number; skipped: number; conflicts: number }; write: () => void; retrain: () => void }> {
    const checked = verifySection(section);
    const store = this.current();
    const key = await this.dek();
    const local = readSection(store.db, key, { appVersion: '', deviceId: store.deviceId, exportedAt: '', autoFillSavedAnswers: null });
    const merged: KnowledgeMerge = mergeKnowledge(local, checked);
    const report = { added: merged.added, merged: merged.merged, skipped: merged.skipped, conflicts: merged.conflicts };
    return {
      report,
      write: () => writeMerged(store.db, merged, key),
      retrain: () => {
        this.trainIfNeeded(this.repo(), key, true);
      },
    };
  }

  async reviews(): Promise<ReviewItem[]> {
    return listReviews(this.current().db, await this.dek());
  }

  async resolve(id: string, action: ReviewAction, answer?: string): Promise<void> {
    const store = this.current();
    const key = await this.dek();
    resolveReview(store.db, key, store.deviceId, new Date().toISOString(), id, action, answer);
    this.trainIfNeeded(this.repo(), key, true);
  }

  async blocked(): Promise<string[]> {
    return blockedQuestions(this.current().db);
  }

  private trainIfNeeded(repo: KnowledgeRepository, key: Uint8Array, changed: boolean): { model: LearnedBundle | null; ran: boolean } {
    const current = repo.activeModel();
    if (!changed && current) return { model: current, ran: false };
    const records = repo.trainingRecords(key);
    if (!records.length) return { model: current, ran: false };
    const bundle = trainFromRecords(records, new Date().toISOString(), current?.version ?? null);
    const activate = shouldActivate(current, bundle);
    repo.saveModel(bundle, activate);
    return { model: activate ? bundle : current, ran: true };
  }
}
