import { useEffect, useState } from 'react';
import { bridge } from '@/platform/bridge';
import type { OutputFormat } from '@/types';
import type { SettingsController } from '@/hooks/useSettings';
import { WarningBanner } from './WarningBanner';
import { Icon } from './Icon';
import { buildApplicationFolder } from '@/utils/filename';
import { todayLocal } from '@/utils/dates';

const FORMATS: { id: OutputFormat; label: string }[] = [
  { id: 'pdf', label: 'PDF' },
  { id: 'docx', label: 'Word (DOCX)' },
  { id: 'txt', label: 'Plain text' },
  { id: 'md', label: 'Markdown' },
];

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint ? <span className="hint" style={{ display: 'block' }}>{hint}</span> : null}
      </span>
    </label>
  );
}

export function SettingsForm({ ctl, compact = false }: { ctl: SettingsController; compact?: boolean }) {
  const { settings: s, update } = ctl;
  const [keyInput, setKeyInput] = useState('');
  const [manualModel, setManualModel] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [baseDir, setBaseDir] = useState('Documents');
  useEffect(() => {
    void bridge()?.invoke('files.baseDir').then(setBaseDir);
  }, [s.saveLocation]);
  const examplePath = buildApplicationFolder({
    root: s.downloadRootFolder,
    company: 'Meridian Credit Analytics LLC',
    title: 'Senior Architect',
    date: todayLocal(),
    fileNameFormat: s.fileNameFormat,
    createFolderPerApplication: s.createFolderPerApplication,
    includeCompany: s.includeCompanyInPath,
    includeTitle: s.includeJobTitleInPath,
  });

  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="set-ai">
        <h2 className="section-title" id="set-ai">
          <Icon name="key" /> Claude resume generation
        </h2>
        <label className="switch" htmlFor="set-engine">
          <input id="set-engine" type="checkbox" checked={s.engine === 'claude'} onChange={(e) => void update({ engine: e.target.checked ? 'claude' : 'local' })} />
          Write documents with Claude
        </label>
        <span className="hint">Claude is required for resume generation. PDF rendering and scoring run on this device. API errors are shown without silently substituting employer-only content.</span>
        <div className="field">
          <span id="set-method-label">Resume generation method</span>
          <div className="stack-sm" role="radiogroup" aria-labelledby="set-method-label">
            <label className="check">
              <input type="radio" name="resume-method" checked={s.resumeGenerationMethod !== 'chat'} onChange={() => void update({ resumeGenerationMethod: 'api' })} />
              <span>
                Claude API
                <span className="hint" style={{ display: 'block' }}>Send resume requests to api.anthropic.com with your API key. This is the existing workflow.</span>
              </span>
            </label>
            <label className="check">
              <input type="radio" name="resume-method" checked={s.resumeGenerationMethod === 'chat'} onChange={() => void update({ resumeGenerationMethod: 'chat', engine: 'claude' })} />
              <span>
                Claude.ai Chat
                <span className="hint" style={{ display: 'block' }}>Use the Claude.ai session you sign in to from the sidebar. Each job gets its own chat, titled with the company and the role. The PDF is still built here.</span>
              </span>
            </label>
          </div>
        </div>
        {s.resumeGenerationMethod === 'chat' ? (
          <WarningBanner tone="info" title="Claude.ai Chat">
            Sign in once with the indicator at the bottom of the sidebar. ApplyFlow reuses that session until it expires, and it will not solve a CAPTCHA or other sign-in check. If Google blocks the sign-in window, use Claude’s email sign-in. Company research and the resume both use that session. The API key below stays available when you switch back to Claude API.
          </WarningBanner>
        ) : null}
        <WarningBanner tone="info" title="Your API key stays on this device">
          It’s encrypted with your operating system’s own protection (Windows DPAPI) inside ApplyFlow’s database, sent only to api.anthropic.com, never logged and never put in the Dice page. Use a key with a spend limit and delete it here when you’re done.
        </WarningBanner>
        <div className="field">
          <label htmlFor="set-key">{ctl.hasKey ? 'Replace API key' : 'API key'}</label>
          {ctl.hasKey ? <p className="small">Saved key: <span className="strong" aria-label="masked API key">{ctl.masked}</span></p> : null}
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await ctl.saveKey(keyInput)) setKeyInput('');
            }}
          >
            <input
              id="set-key"
              className="input"
              style={{ flex: 1, minWidth: 180 }}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={ctl.hasKey ? 'Paste a new key to replace it' : 'sk-ant-…'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button type="submit" className="btn" disabled={!keyInput.trim() || ctl.busy === 'save'}>
              Save key
            </button>
          </form>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => void ctl.testKey()} disabled={!ctl.hasKey || ctl.busy !== null}>
            {ctl.busy === 'test' ? <span className="spinner" aria-hidden="true" /> : null}
            Test API key
          </button>
          {confirmDelete ? (
            <>
              <button type="button" className="btn btn-danger" onClick={() => void ctl.removeKey().then(() => setConfirmDelete(false))}>
                Yes, delete the key
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)} disabled={!ctl.hasKey}>
              Delete API key
            </button>
          )}
        </div>
        {ctl.keyStatus ? <WarningBanner tone={ctl.keyStatus.tone} live>{ctl.keyStatus.text}</WarningBanner> : null}

        <div className="field">
          <label htmlFor="set-model">Claude model</label>
          <div className="row">
            <select id="set-model" className="select" style={{ flex: 1, minWidth: 180 }} value={s.model} onChange={(e) => void update({ model: e.target.value })}>
              {s.availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName === m.id ? m.id : `${m.displayName} (${m.id})`}
                  {m.lifecycle === 'deprecated' ? ' — deprecated' : ''}
                </option>
              ))}
            </select>
            <button type="button" className="btn" onClick={() => void ctl.refreshModels()} disabled={!ctl.hasKey || ctl.busy !== null}>
              {ctl.busy === 'models' ? <span className="spinner" aria-hidden="true" /> : <Icon name="refresh" size={14} />}
              Refresh available models
            </button>
          </div>
          <span className="hint">
            {s.modelsRefreshedAt
              ? `List loaded from the Anthropic Models API on ${new Date(s.modelsRefreshedAt).toLocaleDateString()}.`
              : 'Showing suggested defaults. Refresh to load the exact models your key can use.'}
          </span>
        </div>
        <div className="field">
          <label htmlFor="set-effort">Speed</label>
          <select id="set-effort" className="select" value={s.effort} onChange={(e) => void update({ effort: e.target.value as typeof s.effort })}>
            <option value="low">Fast (recommended)</option>
            <option value="medium">Balanced</option>
            <option value="high">Thorough (slower)</option>
            <option value="model_default">Model default</option>
          </select>
          <span className="hint">How much Claude thinks before writing. Fast keeps applying quick; ApplyFlow’s checks catch anything unsupported either way.</span>
        </div>
      </section>

      <section className="card stack" aria-labelledby="set-apply">
        <h2 className="section-title" id="set-apply">
          <Icon name="target" /> Applying
        </h2>
        <Toggle id="set-advance" label="Move through Dice’s steps automatically" hint="ApplyFlow presses Next when a step is complete and stops at the final review. It never presses Submit for you." checked={s.autoAdvanceSteps} onChange={(v) => void update({ autoAdvanceSteps: v })} />
        <Toggle id="set-saved" label="Fill questions with answers I saved" hint="Only answers you gave ApplyFlow earlier. Each one is listed in the review before you submit." checked={s.autoFillSavedAnswers} onChange={(v) => void update({ autoFillSavedAnswers: v })} />
        <Toggle id="set-cl-default" label="Include a cover letter" checked={s.includeCoverLetterByDefault} onChange={(v) => void update({ includeCoverLetterByDefault: v })} />
        <Toggle id="set-early" label="Save tailored documents to your ApplyFlow folder as soon as they’re written" hint="So the files are on your computer before ApplyFlow attaches them — handy if you ever need to attach one yourself." checked={s.saveDocumentsWhenReady} onChange={(v) => void update({ saveDocumentsWhenReady: v })} />
        <Toggle id="set-auto" label="Save the application record files after submitting" checked={s.autoDownloadOnSubmit} onChange={(v) => void update({ autoDownloadOnSubmit: v })} />
        <Toggle id="set-launch" label="Show the Tailor & Apply button on Dice job pages" checked={s.showPageLauncher} onChange={(v) => void update({ showPageLauncher: v })} />
      </section>

      <details className="card">
        <summary className="strong" style={{ cursor: 'pointer' }}>More settings</summary>
        <div className="stack" style={{ marginTop: 12 }}>
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            void ctl.addManualModel(manualModel).then(() => setManualModel(''));
          }}
        >
          <label htmlFor="set-model-manual">Or enter a model ID</label>
          <div className="row">
            <input id="set-model-manual" className="input" style={{ flex: 1, minWidth: 160 }} placeholder="claude-…" value={manualModel} onChange={(e) => setManualModel(e.target.value)} />
            <button type="submit" className="btn" disabled={!manualModel.trim()}>
              Use this model
            </button>
          </div>
        </form>
        <details>
          <summary className="small strong" style={{ cursor: 'pointer' }}>Advanced API options</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            <Toggle id="set-deep" label="Also ask Claude to analyze each job" hint="Slower. The local analysis runs either way and is what the score uses." checked={s.deepAnalysisWithClaude} onChange={(v) => void update({ deepAnalysisWithClaude: v })} />
            <p className="hint">CV Generate automatically makes up to two improvement requests when the measured ATS or draft match score is 95 or lower. This uses additional tokens. Scores are never forced to 95+.</p>
            <div className="field" style={{ maxWidth: 420 }}>
              <label htmlFor="set-cache">Prompt caching</label>
              <select id="set-cache" className="select" value={s.promptCache} onChange={(e) => void update({ promptCache: e.target.value as typeof s.promptCache })}>
                <option value="5m">On — 5 minutes (recommended when applying to several jobs in a row)</option>
                <option value="1h">On — 1 hour (for slower sessions)</option>
                <option value="off">Off</option>
              </select>
              <span className="hint">The rules and your work history are the same for every job, so Claude caches them; a cached read costs about a tenth of normal input. Each job then only pays full price for the job posting.</span>
            </div>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="set-maxtok">Maximum output tokens</label>
                <input id="set-maxtok" className="input" type="number" min={1000} max={64000} step={500} value={s.maxOutputTokens} onChange={(e) => void update({ maxOutputTokens: Math.max(1000, Number(e.target.value) || 8000) })} />
              </div>
              <div className="field">
                <label htmlFor="set-timeout">Request timeout (seconds)</label>
                <input id="set-timeout" className="input" type="number" min={30} max={600} value={s.requestTimeoutSeconds} onChange={(e) => void update({ requestTimeoutSeconds: Math.max(30, Number(e.target.value) || 120) })} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="set-version">API version</label>
              <select id="set-version" className="select" value={s.apiVersion} onChange={(e) => void update({ apiVersion: e.target.value as typeof s.apiVersion })}>
                <option value="2026-10-21">2026-10-21 (current)</option>
                <option value="2023-06-01">2023-06-01 (legacy)</option>
              </select>
            </div>
            <Toggle
              id="set-temp-on"
              label="Send a temperature value"
              hint="API version 2026-10-21 removed temperature, and current Claude models use fixed sampling. It is only sent with the legacy API version and an older model."
              checked={s.sendTemperature}
              onChange={(v) => void update({ sendTemperature: v })}
            />
            {s.sendTemperature ? (
              <div className="field">
                <label htmlFor="set-temp">Temperature ({s.temperature.toFixed(1)})</label>
                <input id="set-temp" type="range" min={0} max={1} step={0.1} value={s.temperature} onChange={(e) => void update({ temperature: Number(e.target.value) })} disabled={s.apiVersion !== '2023-06-01'} />
                {s.apiVersion !== '2023-06-01' ? <span className="hint">Switch the API version to 2023-06-01 to use this.</span> : null}
              </div>
            ) : null}
          </div>
        </details>

      <section className="stack" aria-labelledby="set-docs">
        <h2 className="section-title" id="set-docs">
          <Icon name="doc" /> Documents
        </h2>
        <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">Resume formats to save</legend>
          <div className="row">
            {FORMATS.map((f) => (
              <label key={f.id} className="check" htmlFor={`fmt-${f.id}`}>
                <input
                  id={`fmt-${f.id}`}
                  type="checkbox"
                  checked={s.resumeOutputFormats.includes(f.id)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...s.resumeOutputFormats, f.id] : s.resumeOutputFormats.filter((x) => x !== f.id);
                    void update({ resumeOutputFormats: next.length ? next : ['pdf'] });
                  }}
                />
                {f.label}
              </label>
            ))}
          </div>
          <span className="hint">The file uploaded to Dice is the PDF (or DOCX if PDF is off).</span>
        </fieldset>
        <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">Resume layout (ATS-safe: one column, real text, standard headings)</legend>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="set-template">Template</label>
              <select id="set-template" className="select" value={s.resumeFormat.template ?? 'classic'} onChange={(e) => void update({ resumeFormat: { ...s.resumeFormat, template: e.target.value as NonNullable<typeof s.resumeFormat.template> } })}>
                <option value="classic">Classic (ATS)</option>
                <option value="modern">Modern accent</option>
                <option value="compact">Compact</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="set-font">Font</label>
              <select id="set-font" className="select" value={s.resumeFormat.font} onChange={(e) => void update({ resumeFormat: { ...s.resumeFormat, font: e.target.value as typeof s.resumeFormat.font } })}>
                <option value="arial">Arial</option>
                <option value="calibri">Calibri (larger PDF)</option>
                <option value="helvetica">Helvetica</option>
                <option value="cambria">Cambria</option>
                <option value="times">Times New Roman</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="set-size">Body text size</label>
              <select id="set-size" className="select" value={String(s.resumeFormat.bodySize)} onChange={(e) => void update({ resumeFormat: { ...s.resumeFormat, bodySize: Number(e.target.value) } })}>
                {[10, 10.5, 11, 11.5, 12].map((n) => (
                  <option key={n} value={String(n)}>
                    {n} pt{n === 10.5 ? ' (recommended)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="set-dates">Dates</label>
              <select id="set-dates" className="select" value={s.resumeFormat.dateStyle} onChange={(e) => void update({ resumeFormat: { ...s.resumeFormat, dateStyle: e.target.value as typeof s.resumeFormat.dateStyle } })}>
                <option value="mon_yyyy">Feb 2023 – May 2026</option>
                <option value="mm_yyyy">02/2023 – 05/2026</option>
                <option value="as_written">As entered in candidate setup</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="set-margins">Margins</label>
              <select id="set-margins" className="select" value={s.resumeFormat.margins} onChange={(e) => void update({ resumeFormat: { ...s.resumeFormat, margins: e.target.value as typeof s.resumeFormat.margins } })}>
                <option value="normal">Normal (0.7 in)</option>
                <option value="narrow">Narrow (0.55 in)</option>
              </select>
            </div>
          </div>
          <Toggle id="set-tech" label="“Technologies:” line under each job" hint="Lists that job’s own tools, most relevant first — keywords in the context of a job count more with ATS filters." checked={s.resumeFormat.showJobTechnologies} onChange={(v) => void update({ resumeFormat: { ...s.resumeFormat, showJobTechnologies: v } })} />
          <span className="hint">The PDF embeds open fonts with the same letter widths as Arial, Calibri, Cambria and Times New Roman (Liberation Sans, Carlito, Caladea, Liberation Serif); the Word file uses the real font names.</span>
        </fieldset>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="set-length">Default resume length</label>
            <select id="set-length" className="select" value={s.defaultResumeLength} onChange={(e) => void update({ defaultResumeLength: e.target.value as typeof s.defaultResumeLength })}>
              <option value="one_page">One page</option>
              <option value="two_pages">Up to two pages</option>
              <option value="flexible">Keep everything relevant</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="set-tone">Default cover letter tone</label>
            <select id="set-tone" className="select" value={s.defaultCoverLetterTone} onChange={(e) => void update({ defaultCoverLetterTone: e.target.value as typeof s.defaultCoverLetterTone })}>
              <option value="professional">Professional</option>
              <option value="warm">Warm</option>
              <option value="direct">Direct</option>
              <option value="technical">Technical</option>
              <option value="startup">Startup-oriented</option>
            </select>
          </div>
        </div>
      </section>

      <section className="stack" aria-labelledby="set-privacy">
        <h2 className="section-title" id="set-privacy">
          <Icon name="shield" /> Privacy
        </h2>
        <Toggle id="set-fulljd" label="Send the full job description to Claude" hint="When off, only the extracted requirements and responsibilities are sent." checked={s.sendFullJobDescription} onChange={(v) => void update({ sendFullJobDescription: v })} />
        <Toggle id="set-savejd" label="Save job descriptions in application history" hint="When off, history keeps the title, company and URL but not the description text." checked={s.saveJobDescriptionsLocally} onChange={(v) => void update({ saveJobDescriptionsLocally: v })} />
        {!compact ? <p className="small muted">Your email, phone number, links, work authorization and salary preferences are never sent to Claude. Contact details are added to documents locally.</p> : null}
      </section>

      <section className="stack" aria-labelledby="set-dl">
        <h2 className="section-title" id="set-dl">
          <Icon name="folder" /> Saved documents
        </h2>
        <p className="small muted">
          Every tailored resume and cover letter is also kept in ApplyFlow’s database with the JSON it was rendered from, so you can find and re-render it even if the files are moved.
        </p>
        <div className="field">
          <label htmlFor="set-base">Save location</label>
          <div className="row">
            <input id="set-base" className="input" style={{ flex: 1 }} value={s.saveLocation || baseDir} readOnly />
            <button type="button" className="btn btn-sm" onClick={() => void bridge()?.invoke('files.pickFolder').then((p) => p && void update({ saveLocation: p }))}>
              Choose…
            </button>
            {s.saveLocation ? (
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => void update({ saveLocation: '' })}>
                Use Documents
              </button>
            ) : null}
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="set-root">Folder name</label>
            <input id="set-root" className="input" value={s.downloadRootFolder} onChange={(e) => void update({ downloadRootFolder: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="set-fmt">Application folder name</label>
            <input id="set-fmt" className="input" value={s.fileNameFormat} onChange={(e) => void update({ fileNameFormat: e.target.value })} />
            <span className="hint">Use {'{date}'}, {'{title}'} and {'{company}'}.</span>
          </div>
        </div>
        <Toggle id="set-perapp" label="Create a folder for each application" checked={s.createFolderPerApplication} onChange={(v) => void update({ createFolderPerApplication: v })} />
        <Toggle id="set-company" label="Group folders by company" checked={s.includeCompanyInPath} onChange={(v) => void update({ includeCompanyInPath: v })} />
        <Toggle id="set-title" label="Include the job title in the folder name" checked={s.includeJobTitleInPath} onChange={(v) => void update({ includeJobTitleInPath: v })} />
        <Toggle id="set-jdfile" label="Save the job description as a text file" checked={s.saveJobDescriptionFile} onChange={(v) => void update({ saveJobDescriptionFile: v })} />
        <Toggle id="set-meta" label="Save a JSON metadata file" checked={s.saveMetadataFile} onChange={(v) => void update({ saveMetadataFile: v })} />
        <p className="small">
          Example: <span className="wrap-anywhere strong">{bridge() ? `${s.saveLocation || baseDir}/` : 'Downloads/'}{examplePath}/resume_tailored.pdf</span>
        </p>
      </section>

      <section className="stack" aria-labelledby="set-misc">
        <h2 className="section-title" id="set-misc">
          <Icon name="bell" /> Follow-ups
        </h2>
        <div className="field" style={{ maxWidth: 240 }}>
          <label htmlFor="set-follow">Default follow-up after applying (days)</label>
          <input id="set-follow" className="input" type="number" min={1} max={60} value={s.followUpDays} onChange={(e) => void update({ followUpDays: Math.max(1, Number(e.target.value) || 7) })} />
        </div>
      </section>
        </div>
      </details>
      <p className="small muted">ApplyFlow is an independent tool. It isn’t made by, affiliated with or endorsed by Dice.</p>
    </div>
  );
}
