# Privacy

ApplyFlow Desktop has no server, no accounts, no analytics and no tracking. Everything it knows about you stays on your computer unless you add a Claude API key, and then only the data listed below is sent — directly to Anthropic.

## What is stored, and where

Everything is in **one SQLite database** in ApplyFlow's data folder — on Windows `%APPDATA%\ApplyFlow\applyflow.sqlite` (Privacy & data → Open data folder).

| Data | Table | Notes |
|---|---|---|
| Work history (form entries or imported resumes), verified facts | `resumes` | The original imported file (PDF/DOCX) is kept with it, so a better reader can re-read it later. Never uploaded anywhere. |
| Career profile, saved answers | `profile` | |
| In-progress work per job (extracted job, analysis, tailored documents, field proposals) | `sessions` | Lets a multi-step Dice application resume where it left off. |
| Applications | `applications` | Stage, dates, notes, follow-ups, saved files. |
| Every tailored resume and cover letter version, as JSON | `documents` | With the file path once saved, the model that wrote it and when it was sent. |
| Recruiter contacts | `contacts` | Phone numbers and emails found in the job posting, plus anyone you add. |
| Claude token usage per request | `usage` | Counts only — no text. |
| Search index | `search` | Company, title, contacts, notes and posting text, for "who is calling?". |
| Settings | `kv` | Never contains the API key in plain text. |
| Claude API key | `kv`, encrypted | See "API key" below. |
| Saved documents | `<save location>/ApplyFlow/…` | Documents folder by default. Deleting an application doesn't delete files. |
| Dice sign-in cookies | The built-in browser's own profile | Separate from Chrome/Edge. Privacy & data → Sign out of Dice clears it. |

If you turn off **Save job descriptions in application history**, the description text is removed from stored data once the application is submitted (title, company and URL are kept).

## What is sent to Claude (only with a key)

Requests go from your computer straight to `https://api.anthropic.com`. There is no intermediary. One request per job writes the resume content and the cover letter.

**Sent:**
- The job posting without legal boilerplate (equal-opportunity and similar notices are dropped) — or, if you turn off **Send the full job description**, only its extracted requirements, responsibilities and skills.
- Your **confirmed** resume facts: name, location, headline, summary, titles, employers, dates, bullets, each job's technologies, skills, projects, education, certifications, languages, preferred titles and remote preference.
- The ATS plan built from those facts: the job keywords your resume backs and where to use them, the headline title, your years of experience and bullets per job. Keyword analysis, scoring, truthfulness checks, the parse test and the PDF itself are all done locally.

**Never sent:**
- Email address, phone number, LinkedIn/GitHub/portfolio links (added to documents locally).
- Work authorization notes, salary preferences, availability, saved answers.
- Contacts, call notes and application history.
- Facts you marked *Needs review* or *Do not use*.
- Anything from the Dice application form (its questions are answered locally, from your saved answers or your taps).

**Prompt caching:** the rules and your facts are marked for Anthropic's prompt cache (5 minutes by default, or 1 hour; Settings → Advanced API options). This is a billing/speed feature of the API; you can turn it off.

Anthropic's handling of API data is governed by Anthropic's commercial terms and privacy policy.

## API key

- Encrypted with Windows' own data protection (DPAPI, via Electron `safeStorage`) before it is stored; only your Windows account can decrypt it.
- Never given to the Dice page: the built-in browser runs in a separate, sandboxed process with no access to ApplyFlow's database.
- Sent only to `api.anthropic.com`, in the `Authorization` header (or `x-api-key` on the legacy API version).
- Never logged: all logging passes through a redactor that strips `sk-ant-…` keys and auth headers.
- Shown masked in the UI (`sk-ant-••••••••abcd`). **Delete API key** removes it immediately.

Use a key with a spend limit and delete it when you don't need it.

## What ApplyFlow refuses to do

- Invent employers, titles, dates, degrees, certifications, metrics or skills.
- Guess answers to sponsorship, work authorization, clearance, criminal history, disability, veteran, demographic, salary, relocation, date-of-birth, legal-attestation, experience or unrecognized questions. It fills one of these only with an answer **you** gave — tapped in the panel, or saved earlier with "Remember answers" — and lists every such answer in the review before you submit. Legal attestations are never remembered.
- Submit without your explicit confirmation (the **Submit application** button after the review), or click any control when the page doesn't match what it expects. Pressing Dice's **Next** between steps is automatic (you can turn that off); Dice's **Submit** never is.
- Interact with CAPTCHAs, bot protection, sign-in, passwords or MFA.

## The page helper in the built-in browser

The built-in browser loads ApplyFlow's page helper next to dice.com pages (an isolated script world Dice's own code can't see). It reads the job, fills Dice's form and attaches your documents — only on dice.com. To attach your tailored resume through Dice's **… → Replace** menu, a few lines of script also run in the page's own context; while — and only while — ApplyFlow is attaching a file you asked it to, they hand Dice's file input to ApplyFlow instead of opening a file chooser. They read nothing, store nothing and send nothing.

Since 2.1.1, while ApplyFlow attaches a document you asked it to, it also uses Chromium's built-in automation interface on the Dice view only: it clicks Dice's "…" menu and "Replace" like a mouse would, and answers the file chooser Dice opens with your tailored file instead of showing the Windows "Open" dialog. For that, a copy of the document is written to a temporary ApplyFlow-uploads folder (deleted when ApplyFlow closes). This works only on dice.com, only during an upload, and is switched off right after.

## "Copy page details"

Only when you click it, ApplyFlow builds an outline of the Dice page's structure — element types, roles, test IDs, ARIA labels and the short labels of buttons and headings — and copies it to your clipboard so you can send it to the developer if Dice changed its layout. Field values, file names, email addresses and phone numbers are replaced with placeholders, and nothing is sent anywhere by ApplyFlow.

## Jobright and employer sites (2.2.0)

The page helper and real input now also work on Jobright and on the employer application sites Jobright leads to (Greenhouse, Lever, Ashby and others, https only). They act only when you start Tailor & Apply or press Continue in the panel, for that one application. Nothing on those pages can call them. ApplyFlow sends nothing to Jobright or employers except what you'd type or attach yourself: your contact details, your saved answers, and your tailored resume and cover letter. It submits only when you press **Submit application**, and never on best-effort sites.
