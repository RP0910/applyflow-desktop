# Known limitations (v2.0.0 — desktop)

## Desktop app
- **Built for Windows 10/11 (x64).** The source also builds on macOS/Linux (`npm run dist:dir`), but only Windows is packaged and supported.
- **Sign in to Dice inside ApplyFlow** (the built-in browser has its own sign-in, separate from Chrome/Edge). Use Dice's email + password sign-in: Google and some other single-sign-on pages refuse to work inside embedded browsers.
- The installer isn't code-signed, so Windows SmartScreen shows "Windows protected your PC" the first time. Click **More info → Run anyway**, or sign the build with your own certificate (`CSC_LINK` / `CSC_KEY_PASSWORD` for electron-builder).
- Updates are manual: install the new version over the old one. Your database is kept (`%APPDATA%\ApplyFlow\applyflow.sqlite`).
- **Your 1.x extension data does not move automatically.** In the extension: History → Export JSON; in the desktop app: Applications → Table view → Import. Re-add your master resume under Work history (or upload the same file). Earlier tailored PDFs stay in your Downloads folder.
- The global shortcut **Ctrl+Alt+Shift+F** is ignored if another app already uses it.
- The Claude 2.0 request (one call, cached system prompt) was tested with recorded replies, not live API calls. Prompt caching needs a minimum prompt length (about 1,000 tokens on Sonnet/Opus, more on Haiku); a very short work history may not be cached — it still works, just without the discount.

## Dice page structure
- **Selectors were built against mock pages, not verified against live Dice.** Extraction prefers the standard JSON-LD `JobPosting` data that job boards publish for search engines, then the selectors in `src/services/platforms/dice/selectors.ts`, then heuristics. Before relying on it, open a few live Dice jobs and check the **Job** tab. If fields show "Check this" or "Not found", update `selectors.ts` and add a fixture.
- The wizard support follows Dice's Easy Apply as seen in user screenshots (Oct 2026) and in open-source Dice tools: "You're Applying for", "@ Company in City", a progress bar with "Step N of M", the Resume card with its "…" menu (Download / Replace), the Cover Letter drop area, and a "Review your application" page with a card and edit button per item. This is reproduced in `tests/fixtures/dice/mock-dice-wizard.cjs`, but it is still **not verified against a live Dice application** — no test submits real applications. Matching is by visible text and structure, not Dice's class names.
- Since 2.1.1 the resume is replaced with real clicks in the built-in browser, and Dice's own file chooser is answered with the tailored file (`electron/diceInput.ts`), checked in real Chromium against the card shapes in `tests/fixtures/dice/wizard-realistic.html` (`scripts/e2e-replace.mjs`). It is still not verified against a live, signed-in Dice application.
- If Dice's menu uses wording other than Replace / Change / Update / Upload new, ApplyFlow stops on that step and asks you to replace the resume yourself (it never continues with the old one). Use **Copy page details** in the panel and send the outline to the developer; adding the wording is a one-line change in `src/services/forms/upload.ts`.
- ApplyFlow never clicks Submit unless exactly one enabled, unambiguous Submit button is on the page, and only after you press **Submit application**.
- Jobs that apply on the employer's site are detected; ApplyFlow tailors and saves your documents and opens that site, but can't fill external forms.

## Multi-step applications
- ApplyFlow presses Dice's Next itself (Settings → Applying lets you turn this off) and stops for required questions it must not guess. Optional questions are left blank and listed in the review.
- If Dice refuses to move on, ApplyFlow shows Dice's own message and every empty question on that step.
- If you go Back or click Next on Dice yourself, ApplyFlow picks up the new step but doesn't press Next again until you press Continue.
- Submission success is detected from confirmation text on the page. If Dice shows something unrecognized, ApplyFlow says it clicked Submit but couldn't confirm, and asks you to check.

## Saved answers
- A saved answer is reused for a question in the same category (for example, work authorization) whose wording matches the saved question closely, and only if it matches one of the question's options. Saved answers without a question pattern (added on the Profile page) apply to every question in their category. Legal attestations ("I certify…", terms and conditions) are never remembered or reused — you confirm them on every application. Check the review before submitting; edit or delete answers under Profile.

## ATS resume engine
- **The ATS score is ApplyFlow's own simulation** of keyword-based filtering (literal keywords, job title, structure, dates, file format). Each employer configures its ATS differently, and many use recruiters' searches and AI ranking on top; no score guarantees an interview.
- **The Claude prompt and refine pass were tested with recorded model replies, not live API calls** — this development environment has no API key. The engine's verification doesn't depend on the model: whatever Claude writes, every job is kept, unsupported or moved skills are reverted, and years are capped. Please report any odd wording.
- Keywords come from the posting's own text. Very unusual technologies are found when the posting writes them as product names or acronyms (ExoPlayer, QoE) or lists them in a requirement sentence; plain lowercase phrases are only picked up when the job repeats them.
- A skill counts as backed when your master resume, a job's Technologies list or your confirmed skills name it (or a true synonym: K8s = Kubernetes). A category ("Observability") is backed by its members (Prometheus, Grafana) — never the other way round.
- ApplyFlow can't add numbers to bullets. The ATS check tells you when few bullets show results; add real figures to your master resume and they'll be used.
- **Fonts**: the PDF embeds open fonts metric-compatible with Arial, Calibri, Cambria and Times New Roman (the real ones can't be redistributed). With Calibri the whole font is embedded, because subsetting broke its glyphs, so the PDF is about 1 MB instead of about 50 KB. The DOCX uses the real Office font names.

## Work-history form
- The lines under "What you did there" are the only material ApplyFlow has for each job. Short notes give short bullets; tools, scale and real numbers make the strongest resume. Without a Claude key, those lines are used as written.

## Resume import
- PDF import works for text-based PDFs. Builder layouts with right-aligned dates (FlowCV and similar) are handled since v1.2; two-column FlowCV layouts with a "Technologies" list under every job since v1.3. If the panel says a job may be missing, re-import the resume — the DOCX version reads most reliably. Scanned (image-only) PDFs are rejected with a message; OCR is not included.
- Other multi-column PDF layouts may read columns out of order. DOCX or pasted text is more reliable for complex designs.
- Resumes imported before v1.3 are re-read from the text saved at import. New imports also keep the original file locally, so later reader improvements re-read the file itself.
- Old `.doc` files aren't supported.
- The parser is heuristic. Lines it can't place are shown under "Lines ApplyFlow couldn't place", never dropped silently.

## Local engine vs. Claude
- Without a Claude key, tailoring only reorders and selects your own wording; it doesn't rephrase. The local cover letter is built from your resume lines and may run under the 250-word target.
- Claude output is validated and automatically reverted toward your original wording when it adds unsupported metrics, skills or roles. The validator is conservative and may occasionally flag legitimate phrasing; edit and re-check.
- The skill taxonomy covers ~250 technologies (including video streaming, players and devices, ad tech and mobile). Skills outside it are matched literally; Claude analysis can add them, but only verified quotes from your resume count as evidence.

## Match score
- The score is ApplyFlow's own estimate from fixed factors. It is **not** an employer's ATS score and does not predict interviews.

## Saved files
- Documents go to `<save location>/ApplyFlow/<Company>/<date>_<Title>/` (save location: Documents, or the folder chosen in Settings).
- If you move or delete those files, ApplyFlow still has every version's JSON in the database and re-renders it on demand (Applications → Preview / PDF Studio). The re-rendered PDF uses your current template settings, so it can differ slightly in look from the file that was sent.
- Phone numbers are recognized in North-American formats. Other formats can still be found by searching the digits once you add them as a contact.

## Claude API
- `temperature` is removed in API version `2026-10-21`; it's only sent on the legacy version when you enable it.
- The fallback model list is a suggestion. Use **Refresh available models** to load what your key can actually use.
- Each task has a minimum output budget and one automatic retry with twice the room, so "Claude’s answer was cut off" should be rare. If it still happens with a very long resume, raise **Maximum output tokens** (More settings → Advanced) or set Speed to Fast.

## Not included
- Other job boards (the adapter interface is ready: LinkedIn, Indeed, ZipRecruiter, Wellfound).
- Sync across computers (copy the data folder, or export/import JSON).
- Automatic updates.

## Dependencies
- `npm audit --omit=dev` reports **0 vulnerabilities** for everything shipped in the extension (pdf.js is 6.4.299, which fixes GHSA-hq66-cqwq-w95j).
- `npm audit` still lists advisories in the **test runner only** (vitest 3 / tinypool / @vitest/mocker). These never ship in `dist/` and only run on a developer machine. Upgrading to vitest 4 is planned; it was deferred because npm crashed resolving it during release verification.

## Jobright and employer sites (2.2.0)

- Jobright, Greenhouse, Lever and Ashby support was built against test copies of those sites' pages (tests/fixtures/jobright), modelled on their published structure. It is **not verified against the live sites**, which change without notice. ApplyFlow stops and asks rather than guessing when a page doesn't match.
- Jobright's page data is read when it belongs to the job on screen. Jobright's live pages don't include the employer's address, so ApplyFlow reaches the employer through Jobright's own Apply button (2.2.1).
- Jobright's "Customize Your Resume" offer is always answered with "Apply Without Customizing": ApplyFlow writes the tailored resume itself. Other Jobright dialogs ApplyFlow doesn't recognise stop the run after two tries, with instructions.
- The 2.2.1 Jobright fixes were made from the live public pages and your screenshots. A signed-in run on jobright.ai itself has not been done by ApplyFlow's developers: no account was used.
- Workday, iCIMS, Taleo and other account-based portals: best effort. ApplyFlow prefers “Autofill with Resume”, signs in with stored job-site credentials (Profile settings), fills recognised fields including address, and never presses Submit there. MFA and CAPTCHAs still need you.
- LinkedIn, Indeed, Glassdoor and ZipRecruiter applications are never filled.
- Education fields on employer forms (school / degree pickers) are left for you: they are optional on most forms and use search lists that differ per employer.
- One job at a time. There is no queue of applications.
