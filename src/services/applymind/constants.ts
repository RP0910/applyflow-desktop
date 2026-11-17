/** Salary, availability, and notice-period answers are reviewed again after this many days. */
export const FRESHNESS_DAYS = 90;

/**
 * Tier A stays limited to profile facts and exact pattern matches until a
 * held-out check of this size shows no wrong top-ranked answer.
 */
export const COLD_START = {
  minRecords: 80,
  minPatterns: 25,
  minHeldOutPatterns: 20,
} as const;

export function coldStartUnlocked(s: { records: number; patterns: number; heldOutPatterns: number; heldOutWrong: number; heldOutRanked: number }): boolean {
  return s.records >= COLD_START.minRecords
    && s.patterns >= COLD_START.minPatterns
    && s.heldOutPatterns >= COLD_START.minHeldOutPatterns
    && s.heldOutRanked > 0
    && s.heldOutWrong === 0;
}
