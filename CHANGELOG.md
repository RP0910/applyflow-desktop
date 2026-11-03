# 2.2.1

Fixed (Jobright): the run stopped at "Open the application". ApplyFlow now answers Jobright's "Customize Your Resume in 10 seconds" dialog with "Apply Without Customizing" (never "Fix My Resume Now", never "Do not remind me again"), follows the new tab Jobright opens for the employer's site into the built-in browser, recognises the "Sign Up to Apply" dialog as a sign-in, and stops with instructions instead of pressing Apply again and again. Job titles and companies are read correctly ("… Job Details | Company LLC", jobs opened inside Jobright's signed-in app: no more "Untitled job"). See RELEASE-2.2.1.md.

# 2.2.0

Added: applying from Jobright.ai. ApplyFlow reads Jobright jobs, follows Apply to the employer's site and fills the application — full support for Greenhouse (classic, redesigned, framed), Lever and Ashby; best effort elsewhere (you submit); LinkedIn/Indeed left to you. Handles Jobright sign-in, referral roles, closed and already-applied jobs, resume-reading forms, dropdown comboboxes, Yes/No buttons, invisible vs. visible CAPTCHAs, Workday sign-in. See RELEASE-2.2.0.md.

# 2.1.3

Changed: the Education section moved from Settings to Profile & answers (below Resume generation setup).

Added: "Search results" button in the built-in browser and "Back to search results" after applying; Back leaves Dice's application pages in one step; Dice's "Your application is on its way" confirmation is recognized. See RELEASE-2.1.3.md.

# 2.1.2

Added: Settings → Education — edit your university/school, degree, field of study, city, dates and details (GPA, honors). Placed on every tailored resume exactly as entered. See RELEASE-2.1.2.md.

# 2.1.1

Fixed: replacing the profile resume with the tailored one on Dice's application often stopped with the "…" menu open. Real clicks and file-chooser answers in the built-in browser, reliable "Replace" detection, one retry. See RELEASE-2.1.1.md.

# 2.1.0

Claude CV Generate engine; employer-only setup; shared PDF Studio renderer; bounded score optimization; job-specific automatic resume replacement. See RELEASE-2.1.0.md.

# Changelog

## 2.0.0 — 2026-11-02 — ApplyFlow Desktop

ApplyFlow is now a Windows desktop app instead of a Chrome extension.

### Added
- **Desktop app** (Electron) with a **built-in Dice browser** next to the ApplyFlow panel. The whole Tailor & Apply flow works as before: documents written, Dice's application opened, resume replaced, cover letter attached, safe fields filled, Next pressed, stop for questions and at the review, one click to submit. Your Dice sign-in is remembered in the app.
- **SQLite database** (Node's built-in `node:sqlite`, no native modules) for work history, profile, per-job sessions, applications, every document version, contacts, token usage and a full-text search index — one file you can back up.
- **Applications — "who is calling?"**: search by any part of a phone number (any format), recruiter name, email, company, job title, skill or any word in the posting or your notes. Phone numbers and emails in a posting become contacts automatically; add recruiters yourself. Each application shows the resume and cover letter that were **sent** (preview, open, re-render), the posting, notes and a quick call log. **Ctrl+Alt+Shift+F** brings this up from anywhere in Windows.
- **Resume JSON (`applyflow.resume/1`)** for every tailored resume, kept in the database and as `resume.json` next to the PDF. **PDF Studio** renders any resume JSON (or a JSON Resume file) with ApplyFlow's own renderer — templates **Classic**, **Modern accent** and **Compact**, any font and size — and saves PDF/DOCX. No AI, no tokens. A command-line version is included for developers (`dist-cli/applyflow-render.mjs`).
- **Claude token usage** per application and in Settings (input, cached input, output).
- Save location setting (Documents by default), follow-up reminders as Windows notifications, a Windows installer and a portable exe, and the ApplyFlow logo as the app icon.

### Changed — resume logic
- **One Claude request per job** writes the resume content and the cover letter together (1.x sent two requests in parallel, each with the job and your facts, plus an optional refine request).
- The rules and your confirmed facts are a fixed **cached system prompt** (5-minute cache by default, 1 hour or off in Settings). Facts are serialized deterministically so the cache hits from job to job.
- Everything sent is compact: no pretty-printed JSON, short job ids (`j1`, `j2`…), the ATS plan as tuples, and the posting without equal-opportunity/legal boilerplate. Claude no longer writes a change log.
- Claude returns **content only** as JSON; employers, titles, dates, education and contact details are filled in locally, every line is verified, and the PDF is drawn by ApplyFlow's renderer.
- The ATS refine pass (a second request) is now **off by default**; turn it on under Settings → Advanced API options.
- Phone numbers, emails and links in a posting are never treated as job keywords.
- The API key is encrypted with Windows' data protection (DPAPI).

### Removed
- The Chrome extension packaging (manifest, service worker, side panel/options pages). Export your 1.x history as JSON and import it under Applications → Table view.

## 1.4.0 — 2026-10-30

### Added
- **Work-history form — no resume file needed.** Workspace → Work history → **Fill in the form**. Enter each real job once:
  - company, title, city, start and end month (or "I work here now");
  - what you did there, one line each;
  - the tools you used.

  Add education, skills, certifications and languages the same way. For every Dice job, ApplyFlow writes a new, job-targeted resume and cover letter from what you entered, with the full ATS engine (keywords, job title, every job, ATS layout, parse test). It only uses what you typed: it never adds employers, jobs, dates or work.
- **Contact details at the top of the form** (name, city and state, phone, email, LinkedIn) are saved to your Profile and placed on every resume.
- The form shows your total years of experience from the dates you enter, and says exactly what's missing before saving (a job title, an end month, at least two things you did…).
- **Edit in the form** works for uploaded resumes too: their jobs, dates, bullets and technologies open as form fields.
- New users see the form first. Uploading a resume file is still one click away ("Upload a file").

### Changed
- "Resume library" is now **Work history**.

## 1.3.0 — 2026-10-30

The core of ApplyFlow is now an **ATS resume engine**: every tailored resume is planned, written, checked and scored the way keyword-based applicant tracking systems read resumes.

### Fixed
- **Only the most recent job reached the tailored resume** for FlowCV two-column resumes (dates and city in a narrow left column, a "Technologies" list under every job). The first job's "Technologies" heading was read as the start of the Skills section, so every later job was filed under Skills. ApplyFlow now:
  - recognizes per-job technology lists ("Technologies", "Tech stack:", "Environment:", …) and keeps them with their job;
  - reads the left date/city column ("Boston," + "United States" → "Boston, United States");
  - joins bullets the PDF wrapped onto the next line, including bullet glyphs drawn slightly below their text;
  - keeps grid category labels ("Cloud & DevOps") out of the skills list.
- Education is read with its full date range and city ("Bachelor's degree in Computer Science — Temple University, Tokyo, Japan, 09/2013 – 01/2017").
- Resumes are **re-read automatically** (reader version 3). New imports also keep the original file locally, so future reader improvements can re-read it.
- The resume library warns when your summary claims more years than the jobs it found ("Your summary says 8+ years, but the jobs found cover about 3"), and when the Skills list contains job history.
- "Additional Information" no longer repeats education, certifications or skills.

### Added — ATS resume engine
- **Job keywords**, taken from the posting's own words and spellings: the job title, skills and technologies, acronyms and product names (ExoPlayer, Media3, QoE), requirement lists, repeated phrases, soft skills, degree and certifications. Each is weighted by required/preferred and how often the job uses it. Fragments of longer terms ("TV" in "Fire TV") and eligibility text ("United States") are left out.
- **Which keywords you can use**: each keyword is checked against your master resume, technologies and confirmed skills. Only backed keywords may appear on the resume. A category term counts as backed when your resume shows a member of it ("Observability" via Prometheus and Grafana), never the other way round.
- **The plan**:
  - the job's title for your headline when your real titles match it (never a higher level you haven't held);
  - the years your job dates actually show;
  - bullets for every job (recent and relevant jobs get more, filling about two pages);
  - where each keyword goes: Skills, summary, and only the job whose facts show it.
- **New Claude prompt** written as an ATS specialist:
  - every job, by ID, with its bullet budget;
  - the job's exact wording, with acronym and expansion;
  - action-verb bullets with numbers copied exactly;
  - headline and summary built from the target title and true years;
  - grouped skills, and a "Technologies" line per job.
- **ATS refine pass**: the draft is scanned like an ATS; if keywords, the job title or bullet counts can still be improved truthfully, Claude fixes exactly those findings. The revision is kept only if it scores at least as well and passes every check. Setting: Settings → Advanced API options.
- **ATS check card** (Apply and Documents views):
  - a 0–100 score with before (master) → after (tailored);
  - the best score your experience allows;
  - matched keywords;
  - keywords your resume backs but doesn't use yet;
  - every structure check: all jobs, dates, contact, sections, action verbs, numbers, length, font and the parse test.
- **"I have this"**: job skills your resume doesn't show are listed. Tap the ones you really have, and they're added to your verified skills and the resume is rewritten in one step. Nothing is added without your tap.
- **ATS-formatted files**:
  - one column, standard headings, contact details in the body;
  - "Title — dates" then "Company | City", and a Technologies line per job;
  - fonts: Arial (default), Calibri, Helvetica, Cambria or Times New Roman, 10–12 pt;
  - date style and margins are settings.
  - The PDF embeds open fonts with identical letter widths, as real text with ligatures turned off, so "platforms" never reaches an ATS as "pla orms".
  - The DOCX uses the real Office font names, with right-aligned dates on a tab stop (no tables).
  - Supported keywords are written into the PDF's keyword metadata.
- **Parse test**: right after writing, the PDF is read back with a text extractor and resume parser — what an ATS does on upload — to confirm your name, email, phone, every job with its dates, every section, and that every word comes out intact.

### Changed — truthfulness
- Each technology in a job's bullets must come from **that job's own facts**: "Kubernetes" from another job, or a tool listed under a different employer, is reverted.
- Job keywords your resume doesn't back (for example "LLMs", "AI agents", "Microservices" for a resume without them) are blocked in every section. The validator catches them even when the model writes them, and replaces the bullet with that job's closest original bullet instead of duplicating one.
- "N+ years" in the headline or summary can never exceed what your job dates show.
- Team sizes and counts ("led a team of 6 engineers", "six developers", "12 clients") must be stated in your master resume.
- Spelled-out technologies ("server-side ad insertion") follow the same per-job rule as product names; an acronym explained in place ("Picture-in-Picture (PiP)") is accepted.
- The plan and the validator share one rule for what backs a term, so a keyword the plan places is never reverted afterwards. A category term is backed by its members ("Connected TV" by Roku, Fire TV, Tizen or webOS; "DRM" by Widevine/FairPlay/PlayReady), and a platform never proves its framework ("Roku" doesn't back "Roku SceneGraph").
- "Additional Information" is filled only from your own languages and publications; projects are never dropped by a rewrite.
- The ATS check suggests "City, ST" for jobs listed with only the country, and no longer counts "SCTE-35", "H.264", "24/7" or years as results.
- Partial evidence from a *related* skill no longer counts as permission to name the skill itself.

## 1.2.0 — 2026-10-30

### Fixed
- **Tailored resumes only listed the most recent job.** PDF resumes from builders such as FlowCV put the dates right-aligned on each job line; the PDF reader joined lines that merely reached the right margin, so a job's header was glued onto the bullet above it and every earlier job disappeared into the first one. Lines are now joined only when font, size, spacing and indentation all say "wrapped text", never across a line with dates, a heading or a label. A location on its own line ("Denver, CO") stays with its job, and "Title, Team, Company" splits at the right comma.
- Resumes imported by earlier versions are **re-read automatically** (your Verified-facts decisions are kept), with repairs for lines an older reader glued together. Tailored documents written from the old reading are rewritten the next time you press Tailor & Apply. If a job still looks merged, the panel says so and points to the resume library.
- **The resume wasn't replaced on Dice's application.** ApplyFlow could take an inner part of the page (the cover-letter upload area) for the whole application, so it never saw the Resume card or the Next button. It now anchors on Dice's own "You're Applying for / Step N of M" text and uses the widest part of the page that excludes the site header. Also new: the Resume card is recognized with a red required marker and screen-reader text in its heading, menus rendered outside the application (Download / Replace) are handled, the cover letter's Upload button can never receive the resume, and Next/Submit are recognized with icons in their labels.
- **ApplyFlow never moves on with your old resume.** If it can't replace the resume, it stops on that step and shows exactly what to do (… → Replace, and which file in Downloads), with **Show the file**, **Send the resume already on Dice**, and **Copy page details** (a privacy-safe outline of Dice's page to report a layout ApplyFlow doesn't understand). If you replace it yourself, ApplyFlow notices and carries on.
- Arriving on Dice's review page with the old resume, ApplyFlow uses the Resume card's edit button to go back, replaces it and returns.
- The step shown in the panel follows Dice when you click Next or Back on the page yourself.

### Changed
- **Tailored documents are saved to Downloads as soon as they're written** (resume PDF/DOCX, cover letter, job description), before anything is attached. Submitting adds only the record files, without duplicates; regenerated documents replace the earlier copies in that application's folder. Setting: Applying → "Save tailored documents to Downloads as soon as they're written".
- The panel looks more like Dice's application: "You're applying for" header with "@ Company in City", Dice's thick progress bar with "Step N of 5", review cards with round preview buttons, red required markers, bolder headings.
- The on-page **Tailor & Apply** button now shows only on job pages, so it never covers Dice's own buttons on the application.
- The extension icon stays ApplyFlow's own: the spec allows Dice's official logo only with Dice's permission, so ApplyFlow keeps its own identity in Dice's colors.


## 1.1.0 — 2026-10-30

Faster, fewer clicks, and documents now really reach Dice's application.

### Fixed
- **Tailored resume and cover letter weren't attached on Dice.** Dice shows your profile resume as a saved file with a "…" menu, and keeps its file inputs hidden. ApplyFlow now uses Dice's own **… → Replace** (and the cover-letter drop area), attaches the tailored PDFs, and checks that the new file name appears on the page. A tiny page-world helper hands the file input to ApplyFlow instead of opening your computer's file chooser — only while ApplyFlow is attaching a file.
- **"Claude's answer was cut off"** on cover letters: the output budget was 2,000 tokens, and current models also spend tokens thinking. Requests now ask for low effort, use at least 4,000–16,000 tokens depending on the task, and retry once with double the room if an answer is still cut off. Settings saved by v1.0 are upgraded automatically.
- **"This step has no Submit button yet"** and **Confirm and Submit enabled on step 1**: ApplyFlow now understands Dice's multi-step wizard ("Step 1 of 2"), presses Next itself, and only offers Submit on the step that actually has Dice's Submit button.
- The site's header **search bar was read as the application form** (garbage field labels, 0 fields filled). The application is now found from the wizard's own Next/Submit button; site header, navigation, search and footer are excluded.
- **Equal-opportunity statements** ("…without regard to citizenship, disability or protected veteran status") were shown as requirements. They're ignored now.
- Radio questions are read with their real wording (the text above the Yes/No options), and required questions marked with `*` are detected.

### Changed
- **One-click flow.** Opening a job scores it automatically. **Tailor & Apply** writes the resume and cover letter (in parallel), opens Dice's application, attaches both, fills safe profile fields, presses Next through the steps, and stops at Dice's review step. **Submit application** — after a review summary — is the final click. A typical application is 2 clicks once your answers are saved.
- **Questions as one-tap cards.** Questions ApplyFlow must not guess (sponsorship, work authorization, years of experience, …) appear in the panel with their options as buttons. Answers can be remembered and are filled automatically next time (each one listed in the review before you submit). Turn this off under Settings → Applying.
- **New panel**: 4 sections (Apply, Documents, History, Settings) instead of 7 tabs, a single sticky main button, a progress timeline, and no review checkboxes or confirmation modal. The review summary plus the explicit "Submit application" button is the final confirmation.
- **Dice-style look**: white cards on a light page, zinc text, teal actions, pill buttons; new teal icon.
- **Simpler settings**: Claude key, model and speed; an "Applying" section; everything else under "More settings".
- If you submit on Dice yourself, ApplyFlow notices the confirmation and records the application.
- Claude analysis of the job is now optional (Settings → More settings); the local analysis runs instantly and drives the score.

### Tests
- New mock of Dice's wizard (profile resume with "…" → Replace, cover-letter drop area, employer questions, review, site header with search), shared by the jsdom tests and the Chromium end-to-end run.
- New suites for the wizard, uploads, the Quick Apply runner, saved answers, effort fallback and truncation retry, and settings migration.


## 1.0.0 — 2026-10-30

First release.

### Added
- Manifest V3 extension: side panel, service worker, Dice content script, full-page workspace.
- Dice job detection and extraction (JSON-LD, selectors, heuristics) with per-field confidence, "Edit job details", and safe failure.
- Job analysis: category, seniority, required/preferred skills, tools, industry terms, soft skills, outcomes, screening questions, keywords, risks (clearance, authorization, sponsorship, education, location).
- Skill evidence classification: strong, partial, none, conflicting, needs confirmation.
- Transparent estimated match score with plain-language explanations (master and tailored).
- Resume library: DOCX/PDF/text import, multiple resumes, default, editing, Verified Facts (Confirmed / Needs review / Do not use).
- Career profile and user-approved answers (offered, never auto-applied, for sensitive questions).
- Resume tailoring via Claude or the local engine; truthfulness validator with automatic revert; side-by-side comparison with reasons; structured editor; Claude bullet improver.
- Cover letter generation with five tones and Regenerate / Make shorter / Make more natural / Make more technical / Edit manually.
- Export to PDF, DOCX, plain text and Markdown (single column, standard fonts, no tables or images).
- Application assistance: field scan, field-by-field preview with source and confidence, resume/cover letter upload, sensitive-question protection, multi-step support.
- Submit gate checklist, final confirmation modal, one-time submit token, CAPTCHA/login detection.
- Download organization (`ApplyFlow/<Company>/<date>_<Title>/`) with job description, metadata JSON and URL files.
- Application history: stages, filters, sorting, notes, follow-up reminders (notifications), duplicate detection, duplicate record, CSV/JSON export, JSON import.
- Claude API settings: masked key, test, delete, model refresh from the Models API, manual model entry, API version, optional legacy temperature.
- 134 unit and integration tests; mock Dice pages; Chromium end-to-end demo script.
