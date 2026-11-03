/** The ATS engine: job keywords → plan → scan. */
export { extractJobKeywords, cleanJobTitle, coreTitle } from './keywords';
export { buildAtsPlan, classifyKeywords, targetTitleFor, titleAlignment, forbiddenTerms, evidenceParts, bulletBudget } from './plan';
export { scanResume, docFromMaster, docFromTailored, ATS_DISCLAIMER, FONT_NAMES, type ScanDoc } from './scan';
export { countForm, hasForm, termKey, synonymsOf, sameKeyword } from './terms';
