import { useEffect, useState } from 'react';
import type { CareerProfile, SiteCredential } from '@/types';
import { deleteSiteCredential, getDefaultLogin, listSiteCredentials, saveDefaultLogin, saveSiteCredential } from '@/storage/repositories';
import { withSyncedLocation } from '@/utils/address';
import { WarningBanner } from './WarningBanner';

const list = (s: string) => s.split(/\s*[,\n]\s*/).map((x) => x.trim()).filter(Boolean);

export function ProfileForm({ profile, onSave }: { profile: CareerProfile; onSave: (p: CareerProfile) => void }) {
  const [p, setP] = useState(profile);
  useEffect(() => setP(profile), [profile]);
  const set = <K extends keyof CareerProfile>(k: K, v: CareerProfile[K]) => setP((x) => ({ ...x, [k]: v }));
  const text = (k: keyof CareerProfile, label: string, opts: { type?: string; hint?: string; area?: boolean; required?: boolean } = {}) => (
    <div className="field">
      <label htmlFor={`pf-${String(k)}`}>
        {label}
        {opts.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {opts.area ? (
        <textarea id={`pf-${String(k)}`} className="textarea" value={String(p[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} />
      ) : (
        <input id={`pf-${String(k)}`} className="input" type={opts.type ?? 'text'} value={String(p[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} autoComplete="off" />
      )}
      {opts.hint ? <span className="hint">{opts.hint}</span> : null}
    </div>
  );
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(withSyncedLocation(p));
      }}
    >
      <section className="card stack" aria-labelledby="pf-contact">
        <h2 className="section-title" id="pf-contact">
          Contact details
        </h2>
        <p className="section-sub">Used to fill application forms and appear on your documents. Never sent to Claude.</p>
        <div className="grid-2">
          {text('fullName', 'Full name', { required: true })}
          {text('email', 'Email', { type: 'email', required: true, hint: 'Also used as the login email for job sites that require an account.' })}
          {text('phone', 'Phone', { type: 'tel' })}
          {text('linkedinUrl', 'LinkedIn URL', { type: 'url' })}
          {text('githubUrl', 'GitHub URL', { type: 'url' })}
        </div>
        <div className="field">
          <label htmlFor="pf-portfolioLinks">Portfolio links</label>
          <textarea id="pf-portfolioLinks" className="textarea" style={{ minHeight: 60 }} value={p.portfolioLinks.join(', ')} onChange={(e) => set('portfolioLinks', list(e.target.value))} />
          <span className="hint">Separate with commas.</span>
        </div>
      </section>

      <section className="card stack" aria-labelledby="pf-address">
        <h2 className="section-title" id="pf-address">
          Address
        </h2>
        <p className="section-sub">Filled automatically into street, city, state, ZIP and country fields on applications (for example Workday).</p>
        {text('streetAddress', 'Street address', { required: true, hint: 'Address Line 1, e.g. 7109 MEADOWLAWN DR N' })}
        {text('addressLine2', 'Address line 2', { hint: 'Apartment, suite or unit (optional).' })}
        <div className="grid-2">
          {text('city', 'City', { required: true })}
          {text('state', 'State / province', { required: true, hint: 'e.g. Florida or FL' })}
          {text('postalCode', 'ZIP / postal code', { required: true })}
          {text('country', 'Country', { required: true, hint: 'e.g. United States' })}
        </div>
        <p className="small muted">Resume location line: {withSyncedLocation(p).location || '— (saved from city, state and ZIP)'}</p>
      </section>

      <SiteLoginsSection defaultEmail={p.email} />

      <div>
        <button type="submit" className="btn btn-primary">
          Save profile
        </button>
      </div>
    </form>
  );
}

function DefaultLoginCard({ contactEmail }: { contactEmail: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [saved, setSaved] = useState<{ email: string; password: string } | null>(null);
  useEffect(() => {
    void getDefaultLogin().then((d) => {
      const v = { email: d?.email ?? '', password: d?.password ?? '' };
      setSaved(v);
      setEmail(v.email);
      setPassword(v.password);
    });
  }, []);
  const dirty = !saved || email.trim() !== saved.email || password !== saved.password;
  const login = email.trim() || contactEmail.trim();
  return (
    <div className="card stack-sm" style={{ padding: '12px 14px' }}>
      <strong>Default login</strong>
      <span className="small muted">Used on every job site that asks you to sign in or create an account.</span>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="pf-default-email">Email</label>
          <input id="pf-default-email" className="input" type="email" value={email} placeholder={contactEmail || 'you@example.com'} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          <span className="hint">Leave empty to use your contact email{contactEmail ? ` (${contactEmail})` : ''}.</span>
        </div>
        <div className="field">
          <label htmlFor="pf-default-pass">Password</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input id="pf-default-pass" className="input" type={shown ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <button type="button" className="btn btn-sm" onClick={() => setShown((v) => !v)} aria-pressed={shown}>
              {shown ? 'Hide' : 'Show'}
            </button>
          </div>
          <span className="hint">Use a strong password: 12+ characters with upper and lower case, a number and a symbol. Most portals require that when ApplyFlow creates the account.</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!dirty || !password}
          onClick={() => void saveDefaultLogin(email, password).then(() => setSaved({ email: email.trim(), password }))}
        >
          Save default login
        </button>
        <span className="small muted" role="status">
          {!password ? 'No default password yet: ApplyFlow will ask you to sign in yourself.' : dirty ? 'Not saved yet.' : `Saved. Signs in as ${login || 'your contact email'}.`}
        </span>
      </div>
    </div>
  );
}

function SiteLoginsSection({ defaultEmail }: { defaultEmail: string }) {
  const [rows, setRows] = useState<SiteCredential[]>([]);
  const [draft, setDraft] = useState({ url: '', email: '', password: '' });
  const reload = () => void listSiteCredentials().then(setRows);
  useEffect(() => {
    reload();
  }, []);

  return (
    <section className="card stack" aria-labelledby="pf-logins">
      <h2 className="section-title" id="pf-logins">
        Job site logins
      </h2>
      <WarningBanner tone="info">
        When a career portal (Workday and similar) asks you to sign in, ApplyFlow signs in with your default login. If the site has no account for it yet,
        ApplyFlow creates one with the same email and password. Some sites then email you a link to verify the account. Passwords are encrypted on this computer.
      </WarningBanner>
      <DefaultLoginCard contactEmail={defaultEmail} />
      <details className="stack-sm" open={rows.length > 0}>
        <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>
          Different login for a specific site (optional){rows.length ? ` · ${rows.length}` : ''}
        </summary>
        <p className="small muted">Only needed when a site already has an account with another email or password. A login here replaces the default login on that site.</p>
        {rows.length ? (
          <ul className="list-plain stack-sm">
            {rows.map((c) => (
              <li key={c.host} className="card stack-sm" style={{ padding: '10px 12px' }}>
                <div className="row-between">
                  <strong className="small wrap-anywhere">{c.host}</strong>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => void deleteSiteCredential(c.host).then(reload)}>
                    Remove
                  </button>
                </div>
                <label className="field">
                  <span>Email</span>
                  <input
                    className="input"
                    type="email"
                    value={c.email}
                    onChange={(e) => setRows((all) => all.map((x) => (x.host === c.host ? { ...x, email: e.target.value } : x)))}
                    onBlur={() => {
                      const row = rows.find((x) => x.host === c.host) ?? c;
                      void saveSiteCredential(row).then(reload);
                    }}
                  />
                </label>
                <label className="field">
                  <span>Password</span>
                  <input
                    className="input"
                    type="password"
                    value={c.password}
                    onChange={(e) => setRows((all) => all.map((x) => (x.host === c.host ? { ...x, password: e.target.value } : x)))}
                    onBlur={() => {
                      const row = rows.find((x) => x.host === c.host) ?? c;
                      void saveSiteCredential(row).then(reload);
                    }}
                  />
                </label>
                <span className="hint wrap-anywhere">{c.url}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="grid-2">
          <div className="field">
            <label htmlFor="pf-login-url">Site URL or host</label>
            <input id="pf-login-url" className="input" value={draft.url} onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))} placeholder="https://company.wd5.myworkdayjobs.com" />
          </div>
          <div className="field">
            <label htmlFor="pf-login-email">Login email</label>
            <input id="pf-login-email" className="input" type="email" value={draft.email} placeholder={defaultEmail} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="pf-login-pass">Password</label>
            <input id="pf-login-pass" className="input" type="password" value={draft.password} onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))} autoComplete="new-password" />
          </div>
        </div>
        <div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!draft.url.trim() || !draft.password}
            onClick={() => {
              let host = draft.url.trim();
              try {
                host = new URL(host.includes('://') ? host : `https://${host}`).hostname;
              } catch {
              }
              void saveSiteCredential({
                host,
                url: draft.url.trim().includes('://') ? draft.url.trim() : `https://${host}`,
                email: draft.email.trim(),
                password: draft.password,
                updatedAt: '',
              }).then(() => {
                setDraft({ url: '', email: '', password: '' });
                reload();
              });
            }}
          >
            Add site login
          </button>
        </div>
      </details>
    </section>
  );
}
