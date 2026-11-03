import type { ExtractionResult } from '@/types';

/** Employer sites are where you apply, not where ApplyFlow reads the job (that's Dice or Jobright). */
export const notAJobPage = (name: string) => (): ExtractionResult => ({
  ok: false,
  job: null,
  confidence: {},
  sources: [],
  uncertain: true,
  warnings: [],
  failureReason: `This is ${name}’s application form. Open the job on Jobright or Dice first, so ApplyFlow can read it and tailor your documents.`,
});
