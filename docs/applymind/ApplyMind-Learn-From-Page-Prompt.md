# ApplyMind: Learn From the Answers I Give on the Application Page

## 0. The problem

On a real Workday application, ApplyMind left these fields for me and learned nothing from what I then entered:

- "Will you now or in the future require visa sponsorship to maintain work authorization?" — not filled, because the wording is not the exact saved question
- Gender, Ethnicity, Veteran Status, Pronouns — not filled
- "Explain why you believe you are the ideal candidate for this position" — text was written into the box, but the page reported the field as empty

Your status report says ApplyMind trains only on answers saved through Screening Q&A or answered with Remember ticked. Answers I select or type directly on the job site are not learned. That is the gap to close.

**What I want:** when I answer a question myself on the application page, ApplyMind learns it with no extra step from me, and next time fills it, including when the wording or the option list is different.

## 1. Rules

- **Check first (section 2), report, and wait for my approval.** Then implement sections 3 to 9.
- Mark every claim **Verified** (observed at runtime; say development or installed build), **Tested** (name the test), **Implemented**, or **Unverified**.
- The safety rules stay: only answers I typed, selected, approved, or corrected are verified. A value the filler wrote is never verified unless I approve or change it. Nothing is invented.
- Keep all existing functionality working, including Screening Q&A and the Remember option.
- Do not submit real applications to test this. Use saved copies of the pages as fixtures.

## 2. Check first (read-only)

1. Confirm whether an answer I enter directly on the job page is captured anywhere today. Name the code that would do it, or state that none exists.
2. How does the app read Workday's dropdowns: the question text, the full option list, and the selected option?
3. How can the app tell a value I entered from a value the filler wrote, and from a value the site pre-filled itself?
4. Why did the essay text not register with the page? Identify how the filler writes into that field and what the page needs in order to accept the value.
5. Which profile facts exist today, and how is a question linked to a fact?

## 3. Capturing my answers on the page

**What counts as my answer.** A value in a screening-question field is mine when I typed or selected it through real interaction with the page during this session. Classify every field value at the moment the step is completed:

| Situation | Stored as |
|---|---|
| I entered the value myself | **Verified** |
| The filler wrote it and I changed it | **Verified**, recorded as a correction of the filled value |
| The filler wrote it and I explicitly approved it | **Verified** |
| The filler wrote it and I left it unchanged | **Accepted**, not used for training |
| The site pre-filled it and I did not touch it | **Not verified**, not used for training |

**When to capture.** Read the final value when the step is completed and the page has accepted it: I click the page's own continue button, the form is submitted, or the page moves to the next step. Capture must work when I advance the page myself, including when ApplyFlow could not find the Next or Submit button. Do not capture a value the page has rejected with a validation error.

**What to store** for each captured answer: the question text, the control type, the full list of options offered, the option or text I chose, the platform, the job title, the job's country, and the date.

**No extra clicks.** Capture is automatic. I do not have to tick Remember. After each step, show one compact line in the side panel, for example "Learned 4 answers on this step", with an Undo.

**Never capture:** passwords, security answers, payment details, government identification numbers, or uploaded files.

**No duplicates.** The same answer to the same question in the same context updates the existing record's last-confirmed date. A different answer from me in the same context is a correction and is added to the record's history. A different answer in a different context, such as another country, is kept as a separate context-specific answer.

**Review list.** If I answer on the page a question that has an item waiting on the Data management review list (Veteran Status is one), my answer resolves that item.

## 4. Standard personal questions as profile facts

Some questions are asked on almost every application with varying wording and varying options. Treat each as one profile fact:

- Legal authorization to work, per country
- Need for visa sponsorship, now or in the future, per country
- Gender
- Ethnicity or race
- Veteran status
- Disability status
- Pronouns

Propose any others you find in my existing answers.

**Creating a fact.** The first time I answer one of these on a page, ask once in the side panel whether to save it as my standard answer for that kind of question. One click. After that, do not ask again for that fact. "Decline to self-identify" and similar choices are valid answers and are saved like any other.

**Recognizing the question.** Link a question to a fact using strict, explicit rules for each question family. Do not use loose word overlap. The rule must also determine the direction of the question. "Will you require sponsorship?" and "Are you able to work without sponsorship?" need opposite yes/no answers from the same fact. If the direction cannot be determined with certainty, do not fill; ask me.

**Mapping to options.** Employers offer different option lists for the same question. Map my fact to the offered options as follows:

1. If I have chosen from this exact option list before, use that choice.
2. Otherwise, match on normalized option text. Fill only if exactly one option matches.
3. If no option or more than one option matches, do not fill. Ask me, and store my choice so this option list is known next time.

Never choose the nearest option.

**New wording of a known fact.** The first time a new wording is matched to a fact, fill the answer and flag it for my review. Provide a single "Approve all on this step" action. Once I approve, that wording is linked to the fact and fills without a flag from then on.

**Privacy.** Store these facts encrypted, like other profile facts. Add one setting, on by default, to turn off learning and filling of demographic answers.

## 5. Long-form, job-specific answers

For questions such as "Explain why you believe you are the ideal candidate":

- A long-form answer becomes verified only if I typed it, edited it, or explicitly approved it. Generated text I left unchanged is accepted, not verified.
- Store it with the job title, company, and job description reference, because it is specific to that job.
- In later applications, use stored long-form answers only as a draft that is flagged for my review. Never fill one silently.

## 6. Fix: the page must register what the filler writes

The essay text was visible in the box, but the page treated the field as empty. Fix the filler so the page accepts the value as real input. After every fill, check the field: if the page shows a validation error or still treats it as empty, mark that fill as failed and show it under "Needs your attention". Do not report it as filled. Apply the same check to dropdowns, radio buttons, and checkboxes.

## 7. Training

- Every verified answer captured from a page counts toward the Tier A requirements and is used in the next automatic retraining.
- Accepted and pre-filled values are never used for training.
- Retraining starts automatically. No command, restart, or rebuild.
- A newly learned answer is available for exact reuse immediately, in the same session, without waiting for retraining.

## 8. Tests

Save copies of the two Workday screens (Application Questions and Voluntary Disclosures) as fixtures, and write automated tests for:

- Each row of the table in section 3
- Capture when I advance the page myself
- No capture of a value the page rejected
- No capture of excluded field types
- No duplicate records; a changed answer recorded as a correction
- Fact creation after one confirmation, and no second prompt
- The sponsorship question in at least three wordings, including one with the opposite direction
- Option mapping: known option list, single text match, no match, and more than one match
- New wording filled and flagged, then silent after approval
- Long-form answers: verified only when typed, edited, or approved; reused only as a flagged draft
- A fill the page does not register is reported as failed
- The demographic setting turned off
- A page answer resolving a review-list item
- Retraining triggered by captured answers

## 9. Verification in the installed build

Build and install the application. Using the saved fixture pages and a copy of my data:

1. Answer every question on both screens by hand. Show what was stored and with which status.
2. Open the same screens again. Show which fields are filled, which are flagged, and which are left for me.
3. Open a variant with different wording and different option lists. Show the result for each field.
4. Confirm the essay field is accepted by the page.
5. Restart the application and repeat step 2.
6. Report the verified record count and pattern count before and after, and whether retraining ran.

Mark each step Verified or not.

## 10. Final report

1. What was implemented, with file paths.
2. Test results.
3. The section 9 results, step by step.
4. The question families and facts now supported.
5. Anything incomplete or unverified.
