# ApplyFlow Desktop 2.3.10 — ApplyMind learns what you type on the page

## What changed

**1. Learning from the page**
- When you type or choose an answer and then click Continue, Next, or Submit, ApplyMind records that step.
- An answer you entered is verified. An answer you change after a fill is a correction. An answer the filler wrote and you left is accepted. A value that was already on the page, and that you did not change, is left as it was.
- Legal agreements, certifications, passwords, and file uploads are not learned. Remember starts ticked, and it turns off when nothing on the step can be learned.
- The side panel says how many answers were learned on the step, and Undo puts that step back.

**2. Filling**
- A confirmed fact is used only when the question has the same meaning. A work-authorization or sponsorship fact for one country is never used for another. When the country cannot be told, the question is left for you.
- A new wording of a confirmed fact is filled and marked for you to approve on that step.
- The proposed facts stay on Data management until you confirm or reject them. They are not used to fill before that.
- Gender, ethnicity, and pronouns can be learned from the first answer you type, and you are asked once. Settings can turn that off. Veteran status and disability stay their own facts.
- A long answer, such as why you are the ideal candidate, is kept as a draft and shown for review. It is not filled silently.
- A filled value is written so the page keeps it, including an essay the page’s own framework controls.

**3. Page snapshot**
- Save page snapshot, next to Copy page details, writes the form to `%APPDATA%\ApplyFlow\page-snapshots`. It includes each question and any dropdown list it can open, and it names any list it could not open.
- Snapshot in 5 seconds lets you open a list yourself and have it captured while it is open.
- The snapshot leaves out password fields, replaces the host with `*.myworkdayjobs.com`, does not click Continue, Next, or Submit, and does not change a value.

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.3.10.exe` (or `ApplyFlow-2.3.10-portable.exe`).
