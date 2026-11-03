/**
 * Every Dice-specific selector lives here so a Dice redesign is a one-file fix.
 * Ordered most-specific first. Structured data (JSON-LD JobPosting) is tried
 * before any of these, and generic heuristics run after them.
 */
export const DICE_SELECTORS = {
  title: [
    'h1[data-cy="jobTitle"]',
    '[data-testid="job-detail-header-title"]',
    '[data-testid="jobTitle"]',
    '[data-cy="jobTitle"]',
    'main h1',
    'h1',
  ],
  company: [
    '[data-cy="companyNameLink"]',
    '[data-cy="companyName"]',
    '[data-testid="companyName"]',
    '[data-testid="job-detail-header-company"]',
    'a[href*="/company-profile/"]',
  ],
  location: [
    '[data-cy="location"]',
    '[data-testid="job-location"]',
    '[data-testid="location"]',
    '[data-testid="job-detail-header-location"]',
  ],
  description: [
    '[data-testid="jobDescriptionHtml"]',
    '[data-cy="jobDescription"]',
    '#jobDescription',
    '[data-testid="jobDescription"]',
    '.job-description',
    '[class*="jobDescription"]',
  ],
  skills: [
    '[data-cy="skillsList"] span',
    '[data-cy="skillsList"] li',
    '[data-testid="skillsList"] li',
    '[data-testid="skill-chip"]',
    '[data-testid="skills"] li',
  ],
  detailChips: [
    '[data-cy="employmentDetailsSection"] span',
    '[data-testid="employment-details"] span',
    '[data-testid="job-detail-chips"] span',
    '[data-testid="job-detail-header"] [class*="chip" i]',
    '[data-testid="job-detail-header"] [class*="badge" i]',
  ],
  posted: ['[data-cy="postedDate"]', '[data-testid="posted-date"]', '[data-testid="job-detail-header-posted"]'],
  salary: ['[data-cy="payDetails"]', '[data-testid="pay-details"]', '[data-testid="salary"]'],
  applyButton: [
    'a[data-testid="apply-button"]',
    'button[data-testid="apply-button"]',
    '[data-testid="apply-button"]',
    '[data-cy="apply-button"]',
    '#applyButton',
    'apply-button-wc',
    '[data-cy="applyButton"]',
    'button[aria-label*="apply" i]',
    'a[aria-label*="apply" i]',
  ],
  /** Explicit wizard containers, tried before the button-anchored search. */
  applicationRoot: [
    '[data-testid="application-wizard"]',
    '[data-testid*="wizard" i]',
    '[data-cy="applicationWizard"]',
    'form[data-testid*="apply" i]',
    'form[action*="apply" i]',
  ],
} as const;

/** URL shapes Dice has used for job detail pages and the application flow. */
export const DICE_URLS = {
  jobDetail: [/\/job-detail\/[^/]+/i, /\/jobs\/detail\//i],
  application: [/\/job-applications\//i, /\/apply(?:\/|$|\?)/i, /\/wizard(?:\/|$|\?)/i],
  search: [/^\/jobs\/?(?:\?|$)/i, /^\/jobs\/q-/i],
};

export const SUBMIT_LABEL = /^(submit(?: (?:my |your )?application)?|send application|finish(?: and submit)?|complete application)$/i;
export const NEXT_LABEL = /^(next|next step|continue|save (?:and|&) continue|continue to review|review(?: (?:your )?application)?)$/i;
/** Text that only appears on Dice's application wizard. */
export const WIZARD_MARKERS = /you['’]?re applying for|step \d+ of \d+|resume (?:&|and) cover letter|review (?:your )?application|employer questions|screening questions/i;
/** Page furniture that must never be mistaken for the application (site search, nav, footer). */
export const PAGE_CHROME = 'header, nav, footer, [role="banner"], [role="navigation"], [role="search"], [role="contentinfo"], form[role="search"]';
export const STEP_RE = /step\s+(\d+)\s+of\s+(\d+)/i;
export const APPLY_LABEL = /^(apply|apply now|easy apply|quick apply)$/i;
export const EXTERNAL_APPLY_LABEL = /(apply on company site|apply externally|company website|apply on employer)/i;

export const SUCCESS_PATTERNS = [
  /application (?:has been |was )?(?:successfully )?(?:submitted|sent|received)/i,
  /you(?:['’]ve| have) (?:successfully )?applied/i,
  /thank(?:s| you) for (?:applying|your application)/i,
  /\bapplied\b.*\bsuccessfully\b/i,
  /successfully applied/i,
  // Dice's confirmation page (/job-applications/<id>/wizard/success): "Fantastic! Your application is on its way."
  /your application is on its way/i,
];

export const CAPTCHA_SELECTORS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="challenges.cloudflare.com"]',
  '.g-recaptcha',
  '.h-captcha',
  '[data-sitekey]',
  '#captcha',
];

export const LOGIN_HINTS = [/\b(sign in|log in) to apply\b/i, /\bplease (?:sign|log) in\b/i];
