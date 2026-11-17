# ApplyFlow Desktop 2.3.3 — Move your data between computers

## What changed

**1. Settings → Data management**
- Export all data to one `.applyflow` file. You can protect it with a password (AES-256-GCM). ApplyFlow does not upload the file; you move it yourself.
- The file includes applications, contacts, tailored documents, job details, company research, master resumes, profile and saved answers, and Claude usage counts, plus saved document files. It leaves out job-site passwords, the Claude API key, the Claude.ai sign-in, browser cookies, and this computer’s save location.
- Import shows a preview, backs up the database, then merges. Duplicates are combined, the newest change to each field wins, and deletions carry over. Documents are restored into this computer’s save folder. If the import fails, the database is left unchanged.
- Import/export history and restore from backup are on the same screen.

**2. Database**
- Schema 2 adds the metadata the merge needs (device id, field change times, deleted-record markers). Existing data migrates automatically.

**3. Version**
- Application version **2.3.3** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.3.3.exe` (or `ApplyFlow-2.3.3-portable.exe`).
