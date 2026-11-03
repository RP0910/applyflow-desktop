import { useEffect, useState } from 'react';
import type { CareerProfile, SiteCredential } from '@/types';
import { DEFAULT_SITE_PASSWORD } from '@/types';
import { deleteSiteCredential, listSiteCredentials, saveSiteCredential } from '@/storage/repositories';
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

function SiteLoginsSection({ defaultEmail }: { defaultEmail: string }) {
  const [rows, setRows] = useState<SiteCredential[]>([]);
  const [draft, setDraft] = useState({ url: '', email: '', password: DEFAULT_SITE_PASSWORD });
  const reload = () => void listSiteCredentials().then(setRows);
  useEffect(() => {
    reload();
  }, []);
  useEffect(() => {
    setDraft((d) => (d.email ? d : { ...d, email: defaultEmail }));
  }, [defaultEmail]);

  return (
    <section className="card stack" aria-labelledby="pf-logins">
      <h2 className="section-title" id="pf-logins">
        Job site logins
      </h2>
      <WarningBanner tone="info">
        When a career portal asks you to sign in (Workday and similar), ApplyFlow uses the email from Contact details and the password stored here. New sites default to password <code>{DEFAULT_SITE_PASSWORD}</code> until you change it. Passwords are encrypted on this computer.
      </WarningBanner>
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
      ) : (
        <p className="small muted">No job-site logins stored yet. They are created automatically the first time a site asks you to sign in.</p>
      )}
      <div className="grid-2">
        <div className="field">
          <label htmlFor="pf-login-url">Site URL or host</label>
          <input id="pf-login-url" className="input" value={draft.url} onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))} placeholder="https://company.wd5.myworkdayjobs.com" />
        </div>
        <div className="field">
          <label htmlFor="pf-login-email">Login email</label>
          <input id="pf-login-email" className="input" type="email" value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="pf-login-pass">Password</label>
          <input id="pf-login-pass" className="input" type="password" value={draft.password} onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))} />
        </div>
      </div>
      <div>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!draft.url.trim() || !draft.email.trim() || !draft.password}
          onClick={() => {
            let host = draft.url.trim();
            try {
              host = new URL(host.includes('://') ? host : `https://${host}`).hostname;
            } catch {
              /* keep as typed */
            }
            void saveSiteCredential({
              host,
              url: draft.url.trim().includes('://') ? draft.url.trim() : `https://${host}`,
              email: draft.email.trim(),
              password: draft.password,
              updatedAt: '',
            }).then(() => {
              setDraft({ url: '', email: defaultEmail, password: DEFAULT_SITE_PASSWORD });
              reload();
            });
          }}
        >
          Add job site login
        </button>
      </div>
    </section>
  );
}
