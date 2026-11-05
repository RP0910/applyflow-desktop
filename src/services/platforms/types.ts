import type { ExtractionResult, PageBlocker, PageType, SiteId } from '@/types';
import type { UploadTarget } from '@/types/messages';

export interface ControlMatch {
  element: HTMLElement;
  label: string;
}

export interface DocumentLocator {
  findCard: (root: Element, kind: 'resume' | 'cover_letter') => Element | null;
  findInput: (root: Element, kind: 'resume' | 'cover_letter') => HTMLInputElement | null;
}

export interface FormSupport {
  findNextControl: (root: Element) => { el: HTMLElement | null; reason: string | null };
  uploadTargets: (root: Element) => { resume: UploadTarget; coverLetter: UploadTarget };
  documents: DocumentLocator;
  step: (doc: Document) => { current: number; total: number } | null;
  pageErrors: (root: Element) => string[];
}

export interface JobSiteAdapter {
  id: SiteId;
  displayName: string;
  kind: 'board' | 'ats';
  hosts: RegExp;
  classifyPage(doc: Document, url: string): PageType;
  extractJob(doc: Document, url: string): ExtractionResult;
  extractJobAsync?: (doc: Document, url: string) => Promise<ExtractionResult>;
  jobKeyForUrl(url: string): string | null;
  findApplyControl(doc: Document): (ControlMatch & { external: boolean; href?: string | null }) | null;
  findApplicationRoot(doc: Document): Element | null;
  findSubmitControl(root: Element): { match: ControlMatch | null; reason: string | null };
  successPatterns: RegExp[];
  forms?: Partial<FormSupport>;
  blocker?: (doc: Document, url: string) => PageBlocker | null;
  applicationUrl?: (doc: Document, url: string) => string | null;
  parsesResume?: boolean;
  canSubmit: boolean;
  captchaVisible?: (doc: Document) => boolean;
  pendingChoice?: (doc: Document) => string | null;
  loginRequired?: (doc: Document) => boolean;
}
