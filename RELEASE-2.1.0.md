# ApplyFlow Desktop 2.1.0

## Installation and use

1. Close ApplyFlow 2.0. Install ApplyFlow-Setup-2.1.0.exe. The app ID and local database location are unchanged. Existing application records are retained.
2. Open Settings and enter your own Claude API key. Enable Claude writing and test the connection.
3. In Profile & answers, save your contact details. In Resume generation setup, enter each employer and its start/end dates; mark current employment. Job titles are optional. No accomplishment bullets or uploaded master resume are required.
4. Open a Dice job and select Tailor & Apply. Claude writes resume and cover-letter JSON using the supplied CV Generate prompt. ApplyFlow renders it locally with PDF Studio's renderer and automatically replaces the resume on the application.
5. Review generated claims and the final application before selecting Submit application.

## Changes

- Integrated the original CV Generate.txt prompt, included at src/prompts/cv-generate.txt. The supplied file contains a duplicate prompt; one complete copy is sent to Claude.
- The integration contract overrides the prompt's fixed four-employer synthetic baseline: your supplied employers, dates and titles take precedence. Claude drafts missing titles and all work descriptions; employer locations aren't guessed from headquarters.
- Removed the Work history navigation tab, master-resume upload onboarding and the panel History tab. Employer setup is in Profile & answers. The separate Applications tracker and its database remain for saved documents, submission tracking and duplicate prevention.
- Claude errors are visible. Resume generation no longer silently falls back to rewriting the form contents.
- Resume and cover-letter JSON pass through PDF Studio's shared renderer. PDF Studio's layout controls now persist to the settings used during applications. Original Claude JSON is stored in document metadata and can be exported from PDF Studio.
- PDF Studio accepts the core prompt's raw JSON with saved candidate details, as well as existing ApplyFlow JSON/JSON Resume formats.
- Up to two improvement requests run if ATS or draft-match score is 95 or lower. Only non-regressing revisions are kept. Scores are measured locally, never forced to 96 or above, and do not represent an employer's ATS or verified qualifications.
- Job/version/generation-specific attachment filenames prevent an older PDF from being mistaken for the newly generated one. The Dice upload flow opens the replacement menu, attaches the new file and verifies its displayed filename. It stops for assistance if the site rejects the upload.
- Older unsubmitted 2.0 drafts regenerate with the new engine when applying.

## Scope and validation

Generated work descriptions, tools and achievements are illustrative, as specified in the supplied prompt. Check them against your real experience before submission. Candidate identity, employer names, supplied titles/dates, education and certifications are assembled from your saved data.

Automated checks cover Claude JSON validation, failed requests, bounded optimization, employer/date preservation, PDF rendering and selectable-text parsing, form setup, and simulated Dice attachment/replacement/submission flows. The full test suite also covers the existing app functions.

No live Claude account or authenticated Dice session was supplied. Real API generation, live-site compatibility and interactive Windows installation must be verified on your machine. The Windows build is unsigned because no code-signing certificate was supplied.

## Build from source

Node.js 22.12+ is required. Run `npm ci`, `npm run typecheck`, `npm test`, then `npm run dist:win`. Output is in release/. On Linux, scripts/package-win.mjs uses Electron Builder's own NSIS UninstallerReader to extract the uninstaller without running Windows code. Windows builds use the standard packaging path.
