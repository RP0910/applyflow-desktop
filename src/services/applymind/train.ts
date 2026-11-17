import { questionSimilarity, questionWords } from '@/services/forms/questionMatch';
import { coldStartUnlocked } from './constants';
import type { LearnedBundle, TrainingRecord } from './types';

const DIM = 32;
const EPOCHS = 40;
const LR = 0.35;
const L2 = 0.04;

function fnv(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function questionFeatures(text: string): number[] {
  const x = new Array<number>(DIM).fill(0);
  x[0] = 1;
  const words = questionWords(text);
  if (!words.length) return x;
  for (const w of words) {
    const i = 1 + (fnv(w) % (DIM - 1));
    x[i] = (x[i] ?? 0) + 1;
  }
  let norm = 0;
  for (let i = 1; i < DIM; i++) norm += x[i]! * x[i]!;
  norm = Math.sqrt(norm) || 1;
  for (let i = 1; i < DIM; i++) x[i] = x[i]! / norm;
  return x;
}

function sigmoid(z: number): number {
  const c = Math.max(-20, Math.min(20, z));
  return 1 / (1 + Math.exp(-c));
}

function fitBinary(rows: { x: number[]; y: 0 | 1 }[], dim: number): number[] {
  const w = new Array<number>(dim).fill(0);
  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    for (const row of rows) {
      let z = 0;
      for (let i = 0; i < dim; i++) z += w[i]! * row.x[i]!;
      const err = sigmoid(z) - row.y;
      for (let i = 0; i < dim; i++) w[i] = w[i]! - LR * (err * row.x[i]! + L2 * w[i]!);
    }
  }
  return w;
}

function dot(w: number[], x: number[]): number {
  let z = 0;
  for (let i = 0; i < w.length; i++) z += w[i]! * x[i]!;
  return z;
}

export function splitPatterns(patternIds: string[]): { train: Set<string>; held: Set<string> } {
  const ids = [...new Set(patternIds)].sort();
  const held = new Set<string>();
  if (ids.length >= 5) ids.forEach((id, i) => { if (i % 5 === 4) held.add(id); });
  return { train: new Set(ids.filter((id) => !held.has(id))), held };
}

export function pairFeatures(query: TrainingRecord, candidate: TrainingRecord): number[] {
  const sim = questionSimilarity(query.original, candidate.original);
  const qWords = questionWords(query.normalized);
  const cWords = new Set(questionWords(candidate.normalized));
  let inter = 0;
  for (const w of qWords) if (cWords.has(w)) inter++;
  const overlap = qWords.length ? inter / qWords.length : 0;
  return [
    1,
    sim,
    overlap,
    query.category === candidate.category ? 1 : 0,
    query.questionType === candidate.questionType ? 1 : 0,
  ];
}

export function predictCategory(bundle: LearnedBundle, question: string): { category: string; probability: number } {
  const x = questionFeatures(question);
  let best = { category: 'general', probability: 0 };
  bundle.classifier.categories.forEach((category, i) => {
    const probability = sigmoid(dot(bundle.classifier.weights[i] ?? [], x));
    if (probability > best.probability) best = { category, probability };
  });
  return best;
}

export function rankScore(weights: number[], query: TrainingRecord, candidate: TrainingRecord): number {
  return sigmoid(dot(weights, pairFeatures(query, candidate)));
}

export function shouldActivate(current: LearnedBundle | null, next: LearnedBundle): boolean {
  if (!current) return true;
  if (current.reranker.heldOutTop1 != null && next.reranker.heldOutTop1 == null) return false;
  const score = (b: LearnedBundle) => b.reranker.heldOutTop1 ?? b.reranker.trainTop1;
  return score(next) + 1e-9 >= score(current);
}

function accuracy(rows: TrainingRecord[], weights: number[][], categories: string[]): number {
  if (!rows.length) return 0;
  let ok = 0;
  for (const row of rows) {
    const guess = predictCategory({ classifier: { categories, weights, dim: DIM, trainAccuracy: 0, heldOutAccuracy: null } } as LearnedBundle, row.original);
    if (guess.category === row.category) ok++;
  }
  return ok / rows.length;
}

function top1(rows: TrainingRecord[], pool: TrainingRecord[], weights: number[]): { rate: number; wrong: number; answerable: number } {
  const answerable = rows.filter((q) => pool.some((c) => c.id !== q.id && c.patternId === q.patternId));
  if (!answerable.length) return { rate: 0, wrong: 0, answerable: 0 };
  let correct = 0;
  for (const query of answerable) {
    let best: { id: string; patternId: string; score: number } | null = null;
    for (const candidate of pool) {
      if (candidate.id === query.id) continue;
      const score = rankScore(weights, query, candidate);
      if (!best || score > best.score) best = { id: candidate.id, patternId: candidate.patternId, score };
    }
    if (best?.patternId === query.patternId) correct++;
  }
  return { rate: correct / answerable.length, wrong: answerable.length - correct, answerable: answerable.length };
}

export function trainFromRecords(records: TrainingRecord[], trainedAt: string, previousVersion: string | null): LearnedBundle {
  if (!records.length) {
    return {
      version: 'am-lr-0', trainedAt, records: 0, patterns: 0, heldOutPatterns: 0, heldOutWrong: 0,
      classifier: { categories: [], dim: DIM, weights: [], trainAccuracy: 0, heldOutAccuracy: null },
      reranker: { weights: [0, 1, 0, 0, 0], trainTop1: 0, heldOutTop1: null },
      calibrator: { a: 1, b: 0 }, tierAUnlocked: false,
    };
  }
  const categories = [...new Set(records.map((r) => r.category))].sort();
  const { train, held } = splitPatterns(records.map((r) => r.patternId));
  const trainRows = records.filter((r) => train.has(r.patternId));
  const heldRows = records.filter((r) => held.has(r.patternId));
  const usable = trainRows.length ? trainRows : records;

  const weights = categories.map((category) => fitBinary(usable.map((r) => ({
    x: questionFeatures(r.original),
    y: r.category === category ? 1 : 0,
  })), DIM));

  const pairRows: { x: number[]; y: 0 | 1 }[] = [];
  for (const query of usable) {
    for (const candidate of usable) {
      pairRows.push({ x: pairFeatures(query, candidate), y: query.patternId === candidate.patternId ? 1 : 0 });
    }
  }
  const rankWeights = pairRows.length ? fitBinary(pairRows, pairFeatures(usable[0]!, usable[0]!).length) : [0, 1, 0, 0, 0];

  const trainTop = top1(usable, usable, rankWeights);
  const heldTop = heldRows.length ? top1(heldRows, records, rankWeights) : null;
  const heldOutWrong = heldTop?.wrong ?? 0;
  const patterns = new Set(records.map((r) => r.patternId)).size;
  const n = previousVersion ? Number(/^am-lr-(\d+)$/.exec(previousVersion)?.[1] ?? 0) : 0;

  const draft: LearnedBundle = {
    version: `am-lr-${n + 1}`,
    trainedAt,
    records: records.length,
    patterns,
    heldOutPatterns: held.size,
    heldOutWrong,
    classifier: {
      categories,
      dim: DIM,
      weights,
      trainAccuracy: accuracy(usable, weights, categories),
      heldOutAccuracy: heldRows.length ? accuracy(heldRows, weights, categories) : null,
    },
    reranker: {
      weights: rankWeights,
      trainTop1: trainTop.answerable ? trainTop.rate : 1,
      heldOutTop1: heldTop && heldTop.answerable ? heldTop.rate : null,
    },
    calibrator: { a: 1, b: 0 },
    tierAUnlocked: false,
  };

  if (heldTop && heldTop.answerable >= 8) {
    const scores: { x: number[]; y: 0 | 1 }[] = [];
    for (const query of heldRows) {
      const mates = records.filter((c) => c.id !== query.id && c.patternId === query.patternId);
      if (!mates.length) continue;
      let best = -Infinity;
      let right = false;
      for (const candidate of records) {
        if (candidate.id === query.id) continue;
        const score = rankScore(rankWeights, query, candidate);
        if (score > best) {
          best = score;
          right = candidate.patternId === query.patternId;
        }
      }
      if (best > -Infinity) scores.push({ x: [1, best], y: right ? 1 : 0 });
    }
    if (scores.length >= 8) {
      const [b, a] = fitBinary(scores, 2);
      draft.calibrator = { a: a ?? 1, b: b ?? 0 };
    }
  }

  draft.tierAUnlocked = coldStartUnlocked({
    records: records.length,
    patterns,
    heldOutPatterns: held.size,
    heldOutWrong,
    heldOutRanked: heldTop?.answerable ?? 0,
  });
  return draft;
}
