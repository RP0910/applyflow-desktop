# ApplyFlow Desktop 2.2.19 — JD-aligned titles before CV generation

## What changed

**1. Job titles**
- After company research, ApplyFlow asks Claude for one title per employment period from the job posting only (no employer names).
- The most recent title must align with the posting, and older titles must not jump up in seniority.
- A verified title from your profile is kept when a suggestion does not fit that role.
- If the title step fails, ApplyFlow uses a seniority ladder from the posting title and says so in the notice.
- Chosen titles are saved with the company research for that job, so the next run does not ask again.

**2. CV generation**
- Those titles, employer names, and locations are fixed inputs. Claude writes the summary, skills, role description, and bullets for those roles.
- Master-resume bullets are no longer sent in the CV prompt.
- A draft that repeats a master-resume line word for word is kept and called out in the notice.

**3. Version**
- Application version **2.2.19** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.2.19.exe` (or `ApplyFlow-2.2.19-portable.exe`).
