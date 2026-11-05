import { controlLabel, deepQueryAll, isVisible, visibleText } from '@/services/platforms/dom';
import { setNativeValue } from './domFields';

/**
 * One step of getting past a career portal's sign-in wall. The panel calls this repeatedly
 * (re-reading the page in between) because portals split it over several screens:
 * email first then password, sign-in failing because there is no account yet, a separate
 * "Create account" form, then often an email verification.
 */
export type LoginAction =
  | 'signed-in' // filled email + password and pressed Sign in
  | 'email-step' // filled the email on an email-first screen and pressed Continue
  | 'opened-signin' // pressed a "Sign in" choice so the form shows
  | 'opened-signup' // sign-in failed with "no account"; pressed Create account
  | 'created' // filled and sent the Create account form
  | 'verify-email' // the site wants the email address verified first
  | 'account-exists' // Create account says the email is taken: the saved password is wrong for this site
  | 'rejected' // the site refused the password (rules) or the sign-in, nothing else to try
  | 'not-found'; // no sign-in or sign-up form here

export interface LoginStep {
  ok: boolean;
  submitted: boolean;
  action: LoginAction;
  message: string;
}

export interface LoginInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  /** What the previous step did on this site, so a repeat of the same screen means it failed. */
  after?: LoginAction | null;
  allowCreate?: boolean;
}

const VERIFY = /\b(verify your (e-?mail|account|address)|verification (e-?mail|link|code)|check your (e-?mail|inbox)|activate your account|confirm your (e-?mail|account)|we(['’]ve| have)? (just )?sent (you )?(an? )?(e-?mail|link|code|verification))/i;
const EXISTS = /\b(already (exists|registered|in use|taken|associated)|(account|user) (with|for) this e-?mail (already )?exists|e-?mail (address )?is already|already have an account)/i;
const NO_ACCOUNT = /\b(no account|not registered|could(n['’]t| not) find (an |your |that )?account|account (does not|doesn['’]t) exist|user (not found|does not exist)|(invalid|incorrect|wrong|unrecognized) (e-?mail|username|user name|password|credentials|login|sign[- ]?in)|(e-?mail|username)( address)? (or|and(\/or)?) password (is |are |you entered )?(incorrect|invalid|not (valid|recognized|correct))|sign[- ]?in (failed|unsuccessful)|login failed)/i;
const PASSWORD_RULES = /\b(password (must|should|needs to|requirements?|does not meet|doesn['’]t meet|is too (short|weak))|at least \d+ characters|must (contain|include) (at least )?(one|a|1) (upper|lower|number|digit|special|symbol))/i;

const CREATE_CTL = /^(create (an |my |your |new )?account|sign ?up|register( now)?|new user|join( now)?|create one|don['’]t have an account\?? ?(sign ?up|create (one|account)|register)?)$/i;
const SIGNIN_CHOICE = /^(sign ?in|log ?in)( with (e-?mail|password))?$/i;
const SIGNIN_SUBMIT = /^(sign ?in|log ?in|continue|next|submit)$/i;
const SIGNUP_SUBMIT = /^(create (an |my |your )?account|sign ?up|register|join|continue|next|submit)$/i;
const CONSENT = /\b(agree|consent|terms|privacy|accept|acknowledge)\b/i;
const OPTIONAL_CONSENT = /\b(marketing|newsletter|offers|promotions?|text messages?|sms|job alerts?|updates about)\b/i;

const words = (s: string) => s.replace(/\s+/g, ' ').trim();
const hint = (el: HTMLElement) =>
  `${el.getAttribute('name') ?? ''} ${el.id} ${el.getAttribute('autocomplete') ?? ''} ${el.getAttribute('data-automation-id') ?? ''} ${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${labelFor(el)}`;

function labelFor(el: HTMLElement): string {
  const doc = el.ownerDocument;
  const id = el.id;
  const byFor = id ? doc.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
  return words((byFor ?? el.closest('label'))?.textContent ?? '');
}

function fields(scope: ParentNode): HTMLInputElement[] {
  return deepQueryAll<HTMLInputElement>(scope, 'input', 120).filter((el) => isVisible(el) && !el.disabled && !el.readOnly && el.type !== 'hidden');
}

function emailField(inputs: HTMLInputElement[]): HTMLInputElement | null {
  return (
    inputs.find((el) => el.type === 'email') ||
    inputs.find((el) => el.type !== 'password' && /e-?mail|username|user\s*name|user\s*id|login/i.test(hint(el))) ||
    null
  );
}

function controls(scope: ParentNode): HTMLElement[] {
  return deepQueryAll<HTMLElement>(scope, 'button, [role="button"], input[type="submit"], a[href], a[role="button"]', 200).filter(isVisible);
}

function pick(scope: ParentNode, re: RegExp): HTMLElement | null {
  return controls(scope).find((el) => re.test(words(controlLabel(el)))) ?? null;
}

function submitIn(scope: ParentNode, re: RegExp): HTMLElement | null {
  const form = scope instanceof HTMLFormElement ? scope : null;
  const typed = form ? deepQueryAll<HTMLElement>(form, 'button[type="submit"], input[type="submit"]', 10).find(isVisible) : null;
  return pick(scope, re) ?? typed ?? null;
}

function press(el: HTMLElement | null, form: HTMLFormElement | null): boolean {
  if (el) {
    el.click();
    return true;
  }
  if (!form) return false;
  if (typeof form.requestSubmit === 'function') form.requestSubmit();
  else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return true;
}

/** Scope a login form: its <form>, else the dialog or page section around the password field. */
function scopeOf(el: HTMLElement, doc: Document): ParentNode {
  return el.closest('form') ?? el.closest('[role="dialog"], [aria-modal="true"], main, section') ?? doc;
}

/** Read-only: the page asks to verify the email address (shown after creating an account). */
export function verifyNotice(doc: Document, site: string, email: string): LoginStep | null {
  const hasPassword = fields(doc).some((el) => el.type === 'password');
  if (hasPassword || !VERIFY.test(visibleText(doc.body, 20000))) return null;
  return { ok: false, submitted: false, action: 'verify-email', message: `${site} sent a verification email to ${email}. Open the link in it, then press Continue.` };
}

export function loginStep(doc: Document, site: string, input: LoginInput): LoginStep {
  const text = visibleText(doc.body, 20000);
  const inputs = fields(doc);
  const passwords = inputs.filter((el) => el.type === 'password');
  const step = (action: LoginAction, message: string, submitted = true, ok = true): LoginStep => ({ ok, submitted, action, message });

  if (!passwords.length && VERIFY.test(text)) {
    return step('verify-email', `${site} sent a verification email to ${input.email}. Open the link in it, then press Continue.`, false, false);
  }

  const scope = passwords[0] ? scopeOf(passwords[0], doc) : doc;
  const form = passwords[0]?.closest('form') ?? null;
  // Only a button inside the form that says create/sign up makes it a sign-up form (a "Create Account" link beside a sign-in form does not).
  const signupSubmit = passwords.length && scope !== doc ? pick(scope, /^(create (an |my |your )?account|sign ?up|register|join)$/i) : null;
  const signup = passwords.length >= 2 || Boolean(signupSubmit);

  if (signup) {
    if (input.after === 'created') {
      if (EXISTS.test(text)) {
        return step('account-exists', `${site} already has an account for ${input.email}, and the saved password didn’t work. Enter this site’s password under Profile settings → Job site logins (or reset it on ${site}), then press Continue.`, false, false);
      }
      if (PASSWORD_RULES.test(text)) {
        return step('rejected', `${site} didn’t accept the saved password (it has its own password rules). Set a stronger default password under Profile settings → Job site logins, or create the account on the page, then press Continue.`, false, false);
      }
      if (VERIFY.test(text)) return step('verify-email', `${site} sent a verification email to ${input.email}. Open the link in it, then press Continue.`, false, false);
      return step('rejected', `${site} didn’t create the account. Check the page for what it needs, finish signing up there, then press Continue.`, false, false);
    }
    if (input.allowCreate === false) return step('rejected', `${site} asks you to create an account. Create it on the page, then press Continue.`, false, false);
    const local = fields(scope);
    const email = emailField(local);
    if (email) setNativeValue(email, input.email);
    for (const pw of local.filter((el) => el.type === 'password')) setNativeValue(pw, input.password);
    for (const el of local) {
      if (el.type === 'password' || el === email || el.value) continue;
      const h = hint(el);
      if (input.firstName && /first|given/i.test(h)) setNativeValue(el, input.firstName);
      else if (input.lastName && /last|family|surname/i.test(h)) setNativeValue(el, input.lastName);
    }
    // Tick the terms/privacy consent the form needs to continue; never marketing or alerts.
    for (const box of deepQueryAll<HTMLInputElement>(scope, 'input[type="checkbox"]', 20).filter((b) => !b.checked && !b.disabled)) {
      const label = `${labelFor(box)} ${box.getAttribute('aria-label') ?? ''} ${words(box.parentElement?.textContent ?? '')}`;
      if (CONSENT.test(label) && !OPTIONAL_CONSENT.test(label)) box.click();
    }
    const sent = press(signupSubmit ?? submitIn(scope, SIGNUP_SUBMIT), form);
    if (!sent) return step('rejected', `ApplyFlow filled ${site}’s Create account form but couldn’t find its button. Press it yourself, then press Continue.`, false, false);
    return step('created', `Creating a ${site} account for ${input.email}…`);
  }

  if (passwords.length === 1) {
    if (input.after === 'signed-in' && NO_ACCOUNT.test(text)) {
      const create = input.allowCreate === false ? null : pick(doc, CREATE_CTL);
      if (create) {
        create.click();
        return step('opened-signup', `No ${site} account for ${input.email} yet — opening Create account…`);
      }
      return step('rejected', `${site} didn’t accept the saved email and password. Enter this site’s password under Profile settings → Job site logins, or sign in on the page, then press Continue.`, false, false);
    }
    const local = fields(scope);
    const email = emailField(local) ?? local.find((el) => el !== passwords[0] && (el.type === 'text' || !el.type)) ?? null;
    if (email) setNativeValue(email, input.email);
    setNativeValue(passwords[0]!, input.password);
    if (!press(submitIn(scope, SIGNIN_SUBMIT), form)) {
      return step('rejected', `ApplyFlow filled ${site}’s sign-in but couldn’t find its Sign in button. Press it yourself, then press Continue.`, false, false);
    }
    return step('signed-in', `Signing in to ${site} as ${input.email}…`);
  }

  const email = emailField(inputs);
  if (email) {
    if (input.after === 'email-step' && NO_ACCOUNT.test(text)) {
      const create = input.allowCreate === false ? null : pick(doc, CREATE_CTL);
      if (create) {
        create.click();
        return step('opened-signup', `No ${site} account for ${input.email} yet — opening Create account…`);
      }
    }
    setNativeValue(email, input.email);
    const scopeE = scopeOf(email, doc);
    if (!press(submitIn(scopeE, SIGNIN_SUBMIT), email.closest('form'))) {
      return step('rejected', `ApplyFlow entered your email on ${site} but couldn’t find Continue. Press it yourself, then press Continue.`, false, false);
    }
    return step('email-step', `Entered ${input.email} on ${site}…`);
  }

  const choice = input.after === 'opened-signin' ? null : pick(doc, SIGNIN_CHOICE);
  if (choice) {
    choice.click();
    return step('opened-signin', `Opening ${site}’s sign-in…`);
  }
  return step('not-found', `ApplyFlow couldn’t find ${site}’s sign-in form. Sign in on the page, then press Continue.`, false, false);
}
