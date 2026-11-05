import { afterEach, describe, expect, it } from 'vitest';
import { loginStep, verifyNotice } from '@/services/forms/siteLogin';
import { deleteSiteCredential, ensureSiteCredential, getDefaultLogin, listSiteCredentials, saveDefaultLogin, saveSiteCredential } from '@/storage/repositories';

// jsdom can't navigate; stop pressed submit buttons from trying.
document.addEventListener('submit', (e) => e.preventDefault(), true);
const page = (html: string) => {
  document.body.innerHTML = html;
  return document;
};
const input = { email: 'me@example.com', password: 'Strong#Pass2026', firstName: 'Grant', lastName: 'Howard' };

describe('one sign-in step on a career portal', () => {
  it('email-first screen: enters the email and presses Continue', () => {
    let pressed = 0;
    const doc = page('<form><label for="e">Email</label><input id="e" type="email"><button type="submit" id="go">Continue</button></form>');
    doc.getElementById('go')!.addEventListener('click', () => pressed++);
    expect(loginStep(doc, 'Acme', input)).toMatchObject({ ok: true, action: 'email-step' });
    expect((doc.getElementById('e') as HTMLInputElement).value).toBe(input.email);
    expect(pressed).toBe(1);
  });

  it('a sign-in form with a Create account link beside it is a sign-in form', () => {
    const doc = page('<form><input type="email" id="e"><input type="password" id="p"><button type="submit">Sign In</button></form><button type="button">Create Account</button>');
    expect(loginStep(doc, 'Acme', input).action).toBe('signed-in');
    expect((doc.getElementById('p') as HTMLInputElement).value).toBe(input.password);
  });

  it('a sign-up form gets the email, both passwords and the names', () => {
    const doc = page('<form><label for="f">First name</label><input id="f"><label for="l">Last name</label><input id="l"><input type="email" id="e"><input type="password" id="p1"><input type="password" id="p2"><button type="submit">Create Account</button></form>');
    expect(loginStep(doc, 'Acme', input).action).toBe('created');
    const v = (id: string) => (doc.getElementById(id) as HTMLInputElement).value;
    expect([v('f'), v('l'), v('e'), v('p1'), v('p2')]).toEqual(['Grant', 'Howard', input.email, input.password, input.password]);
  });

  it('does not create an account after a wrong password when there is no Create account control', () => {
    const doc = page('<p role="alert">Incorrect email or password.</p><form><input type="email"><input type="password"><button type="submit">Sign in</button></form>');
    expect(loginStep(doc, 'Acme', { ...input, after: 'signed-in' })).toMatchObject({ ok: false, action: 'rejected' });
  });

  it('reports a verification screen without touching anything', () => {
    const doc = page('<h2>Check your email</h2><p>We sent a verification link to me@example.com.</p><input type="email" id="e">');
    expect(verifyNotice(doc, 'Acme', input.email)).toMatchObject({ action: 'verify-email' });
    expect((doc.getElementById('e') as HTMLInputElement).value).toBe('');
  });
});

describe('which login a job site gets', () => {
  afterEach(async () => {
    await saveDefaultLogin('', '');
    for (const c of await listSiteCredentials()) await deleteSiteCredential(c.host);
  });

  it('uses the default login on any site, and saves nothing per site', async () => {
    await saveDefaultLogin('jobs@example.com', 'Strong#Pass2026');
    expect(await ensureSiteCredential('https://acme.wd5.myworkdayjobs.com/x', 'contact@example.com')).toMatchObject({ host: 'acme.wd5.myworkdayjobs.com', email: 'jobs@example.com', password: 'Strong#Pass2026' });
    expect(await listSiteCredentials()).toEqual([]);
  });

  it('a site’s own login wins over the default', async () => {
    await saveDefaultLogin('jobs@example.com', 'Strong#Pass2026');
    await saveSiteCredential({ host: 'acme.icims.com', url: 'https://acme.icims.com', email: 'old@example.com', password: 'Old-Pass-1', updatedAt: '' });
    expect(await ensureSiteCredential('https://acme.icims.com/jobs/1', 'contact@example.com')).toMatchObject({ email: 'old@example.com', password: 'Old-Pass-1' });
  });

  it('no default password means no login (no built-in password)', async () => {
    expect(await getDefaultLogin()).toBeNull();
    expect(await ensureSiteCredential('https://acme.wd5.myworkdayjobs.com/x', 'contact@example.com')).toBeNull();
  });

  it('the default login is not listed as a site', async () => {
    await saveDefaultLogin('jobs@example.com', 'Strong#Pass2026');
    expect((await listSiteCredentials()).map((c) => c.host)).not.toContain('*');
    expect(await getDefaultLogin()).toMatchObject({ email: 'jobs@example.com' });
  });
});
