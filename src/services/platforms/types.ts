import type { ExtractionResult, PageBlocker, PageType, SiteId } from '@/types';
import type { UploadTarget } from '@/types/messages';

export interface ControlMatch {
  element: HTMLElement;
  label: string;
}

/** Where a slot's document goes: the card that shows it, and its file input. */
export interface DocumentLocator {
  findCard: (root: Element, kind: 'resume' | 'cover_letter') => Element | null;
  findInput: (root: Element, kind: 'resume' | 'cover_letter') => HTMLInputElement | null;
}

/** How a site's application form is driven. Dice's wizard and the employers' one-page forms differ here. */
export interface FormSupport {
  findNextControl: (root: Element) => { el: HTMLElement | null; reason: string | null };
  uploadTargets: (root: Element) => { resume: UploadTarget; coverLetter: UploadTarget };
  documents: DocumentLocator;
  step: (doc: Document) => { current: number; total: number } | null;
  pageErrors: (root: Element) => string[];
}

/**
 * One adapter per site.
 *   board  a job board where jobs are found and read: Dice (applies on Dice), Jobright (hands over to the employer)
 *   ats    an employer application system: Greenhouse, Lever, Ashby, or best-effort on other sites
 */
export interface JobSiteAdapter {
  id: SiteId;
  displayName: string;
  kind: 'board' | 'ats';
  /** Hostnames this adapter handles. */
  hosts: RegExp;
  classifyPage(doc: Document, url: string): PageType;
  extractJob(doc: Document, url: string): ExtractionResult;
  /** Reading the job may need a fetch (Jobright's signed-in app). Preferred over extractJob when present. */
  extractJobAsync?: (doc: Document, url: string) => Promise<ExtractionResult>;
  jobKeyForUrl(url: string): string | null;
  /** The control that opens the application (on a board) or the form (on an employer's job page). */
  findApplyControl(doc: Document): (ControlMatch & { external: boolean; href?: string | null }) | null;
  /** The element that contains the application form, or null if none is visible. */
  findApplicationRoot(doc: Document): Element | null;
  /** Exactly one unambiguous submit control, or a reason why none can be used. */
  findSubmitControl(root: Element): { match: ControlMatch | null; reason: string | null };
  /** Text patterns that indicate a submitted application. */
  successPatterns: RegExp[];
  /** Form behaviour; omitted parts use Dice's wizard logic. */
  forms?: Partial<FormSupport>;
  /** Why this page can't be applied on (closed job, already applied, unsupported site), if so. */
  blocker?: (doc: Document, url: string) => PageBlocker | null;
  /** The form's own address when the page only links to it or embeds it in a frame. */
  applicationUrl?: (doc: Document, url: string) => string | null;
  /** The form reads the uploaded resume and fills fields itself: attach first, wait, then fill. */
  parsesResume?: boolean;
  /** ApplyFlow may press Submit here after you confirm. False on best-effort sites (you submit). */
  canSubmit: boolean;
  /** A CAPTCHA the user must solve is on screen (sites with invisible CAPTCHAs override the default). */
  captchaVisible?: (doc: Document) => boolean;
  /** A dialog on the way to the application that ApplyFlow answers by pressing this (label), if any. */
  pendingChoice?: (doc: Document) => string | null;
  /** The site wants you to sign in before you can continue. */
  loginRequired?: (doc: Document) => boolean;
}
