# ApplyMind — Review of Continuous Learning, Training, and Autofill (read-only)

## 0. Rules for this task

This is a review and diagnosis. Follow these rules throughout.

- **No changes.** Do not modify source code, configuration, database schema, my stored data, or the ApplyMind knowledge store. You may read any file, run the existing tests, and run the application. If running something would write to my real data, use a copy.
- **No redesign.** Do not rewrite ApplyMind or replace its architecture. You propose fixes at the end (section 12) and wait for my approval.
- **State your evidence level for every claim**, using exactly one of these:
  - **Verified** — you observed it happen at runtime. Say whether in development mode or in the packaged build.
  - **Tested** — an automated test exercises it and passes. Name the test.
  - **Implemented** — the code exists, but you have not seen it run.
  - **Missing**, **Disconnected**, or **Disabled** — say which.
  - **Unverified** — it cannot be determined without something you cannot do here. Say what would be needed.
- Code that exists is not proof that a feature works. A training run that completes is not proof that the learning and autofill workflow works.
- Do not report a problem without evidence. Every problem must cite a file path and function name.
- Do not weaken or remove any safety check in order to make automation work. The rules from the original ApplyMind brief still apply: truthful answers only, sensitive questions answered only from verified information, no learning from unverified predictions.

## 1. What ApplyMind is supposed to do

This workflow is the primary purpose of ApplyMind:

1. I build and launch the desktop application.
2. I open a job application on a supported website.
3. The application detects the screening questions.
4. If ApplyMind has a verified answer that fits, it fills it in.
5. If it does not, I answer manually.
6. ApplyMind stores my answer as verified and learns from it.
7. When the same or a similarly worded question appears later, ApplyMind recognizes it and fills the appropriate answer.
8. The more applications I complete, the fewer answers I have to type or correct.

Requirements that go with it:

- I never have to run a command, restart, or rebuild the application to make it learn.
- It learns only from answers I typed, approved, or corrected.
- It never learns from its own predictions. An answer that ApplyMind wrote into a form is not verified merely because it was written there.

## 2. Terms

Use these meanings in your report.

| Term | Meaning |
|---|---|
| **Verified answer** | An answer I typed, explicitly approved, or corrected. |
| **Prediction** | Any answer ApplyMind produced that I have not verified. |
| **Exact verified reuse** | The detected question matches a stored verified question by normalized text (a lookup, not a similarity score), in a compatible context, and the stored answer maps unambiguously onto the form control. No trained model is involved. |
| **Model-predicted answer** | An answer chosen through embedding similarity, the classifier, or the re-ranker for a question that is not an exact match. |
| **Knowledge update** | A new verified answer is stored, embedded, and available for retrieval. |
| **Retraining** | The classifier, re-ranker, and calibrator (`am-lr-1`) are fitted again on the verified data. |

Knowledge update and retraining are different events. Report them separately everywhere.

## 3. Confirm the previous report

The last implementation report made the statements below. For each one, check the actual code and data and mark it confirmed, incorrect (with the correct fact), or unverified.

1. 34 verified question-and-answer records exist.
2. 30 question patterns exist.
3. The classifier, re-ranker, and calibrator are trained as `am-lr-1`.
4. Tier A automatic answering is locked.
5. Tier A requires 80 verified records.
6. Tier A requires 25 question patterns.
7. Tier A requires 20 held-out patterns to pass validation with no incorrect top answer.
8. The existing Screening Q&A functionality is unchanged.
9. ApplyMind is not fully enabled in the sidebar. State exactly what is missing or switched off.
10. The ApplyMind tests pass.
11. Four resume-processing tests fail and are unrelated to ApplyMind. Show evidence that these failures existed before the ApplyMind changes (for example from version history), without altering my working tree.

Also state which Tier A conditions are met today, which are not, and how many more verified answers and patterns are needed.

## 4. Trace the runtime path

Trace this path through the real code:

**Job website → question detection → ApplyMind → answer retrieval or prediction → confidence evaluation → autofill → my correction or approval → verified storage → knowledge update → retraining**

Report one row per stage:

| Stage | Implemented? | File and function | Connected to next stage? | Development mode | Packaged build | Errors silently ignored? |
|---|---|---|---|---|---|---|

For the last column, list every place on this path where an error is caught and discarded, or where a fallback hides a failure, and say what I would see in the UI when it happens.

## 5. Continuous learning

Answer each question with evidence.

**A. Capture.** When I type an answer to a new screening question, which event captures it (field change, leaving the field, form submission, an approve button), and does it reach the ApplyMind knowledge store? Is a correction to an answer ApplyMind filled also captured?

**B. No false verification.** Can an answer that ApplyMind filled, and that I did not approve or edit, end up stored as verified? Show the code that prevents this, or show that nothing prevents it.

**C. Knowledge update.** After a verified answer is stored, is it embedded and retrievable immediately, in the same session, with no retraining?

**D. Retraining.** What triggers retraining of `am-lr-1`: every new answer, a count threshold, application startup, or only a manual command? Does it run in the background? Is the new model adopted only if it performs no worse than the current one? Where is the trained model saved?

**E. Persistence.** After closing and reopening the application, are the verified answers, embeddings, and trained model all still present and loaded?

**F. Use in autofill.** Is ApplyMind's output connected to the existing form-filling code, or does autofill still read only from the old Screening Q&A data?

**G. Similar questions.** Can ApplyMind match a question worded differently from the stored one? Show a test or a runtime observation, not just the code.

**H. Two stores.** Which is the source of truth: the Screening Q&A database or the ApplyMind knowledge store? Was the migration one-time, or do they stay synchronized? If I add or edit an answer through the old Screening Q&A screen, does ApplyMind receive it? Can the same answer be recorded twice?

## 6. The `bge-small-en-v1.5` embedding model

Find every reference to `bge-small-en-v1.5` in the project, then answer:

1. Where are the model files stored?
2. Are they bundled with the application or downloaded? If downloaded, when, from where, and what happens offline?
3. Which component loads the model, and when (startup or first use)?
4. Does it load successfully? Give the evidence level.
5. Is it used to create embeddings for screening questions?
6. Are embeddings saved to disk, and where?
7. Are embeddings created the same way when a question is stored and when a new question is looked up?
8. If the model or its version changes, are stored embeddings rebuilt?
9. Are embeddings used to find similarly worded questions?
10. Do the classifier or re-ranker take embeddings as input?
11. Is the embedding model called during a real autofill on a job site, not only in tests or training?
12. Does it load and run in the packaged Windows build, including the WebAssembly runtime files?
13. What happens if the model files are missing or corrupted? Does exact verified reuse still work?
14. Does it run fully locally, with no external API?

Then give one clear verdict: is `bge-small-en-v1.5` part of the live prediction path, or is it installed but not used there?

## 7. What `am-lr-1` is and what it adds

I understand that `bge-small-en-v1.5` turns text into embeddings and does not produce answers. Explain:

1. What `am-lr-1` consists of, what each part takes as input, and what each part outputs.
2. How a final answer is chosen, step by step, from exact lookup, embedding similarity, the classifier, the re-ranker, and the calibrator.
3. What it was trained on: how many examples, and how many patterns have more than one wording. With 34 records across 30 patterns, most patterns have a single example, so state plainly how much the trained parts can have learned.
4. Its measured results on held-out data.
5. What `am-lr-1` contributes today beyond exact lookup plus embedding similarity.

## 8. The Tier A lock

1. Why do the requirements of 80 verified records, 25 patterns, and 20 held-out patterns exist? Is each number derived from a test or measurement, or is it a fixed default in the code? Show where each is defined.
2. While Tier A is locked, what can ApplyMind still do: retrieve, suggest, fill and flag for review?
3. Does the lock block all automatic filling, or only filling of model-predicted answers?
4. **Does the lock also block exact verified reuse?** The original brief said that during the early period, exact matches in a compatible context and direct profile-fact lookups may still fill automatically. Report whether the code follows that, with the function that decides it.

The behaviour I want, without removing any safety check:

- **Exact verified reuse** fills automatically now, with the 34 existing records, and needs no training.
- **Model-predicted answers** stay under the lock until the validation requirements are met.
- **Unfamiliar or uncertain questions** ask for my confirmation.
- **Sensitive questions** keep their existing restrictions in every case.

Report whether the current code already separates these cases. If it does not, describe the smallest change that would, under section 12.

## 9. Persistence and the packaged build

Confirm where each of these lives on disk, and whether it survives an application restart, a computer restart, an application update, a rebuild of the Electron application, and a database migration:

- The knowledge store
- The stored embeddings
- The trained `am-lr-1` model
- The embedding model files
- The encryption key for the stored answers

Check specifically:

1. Is any of this stored inside the application's install or build folder, where an update or rebuild would erase it?
2. Where is the encryption key kept? Does it survive an update and a reinstall? What happens to my stored answers if the key is lost?
3. Does every part of the learning path work in the packaged production build, or only in development mode? Name anything that depends on development-only paths, files, or settings.

## 10. Report format

Keep the report concise. Give this table first:

| Feature | Status | Evidence level | Evidence (file path, function) | Problem | Required fix |
|---|---|---|---|---|---|
| Capture of my verified answers | Working / Partial / Missing | | | | |
| Automatic learning (knowledge update) | | | | | |
| Automatic retraining | | | | | |
| `bge-small-en-v1.5` integration | | | | | |
| Semantic question matching | | | | | |
| Verified answer retrieval | | | | | |
| Exact verified reuse while Tier A is locked | | | | | |
| Automatic autofill | | | | | |
| Tier A restrictions | | | | | |
| Screening Q&A and ApplyMind store in sync | | | | | |
| Training persistence | | | | | |
| Production Electron build | | | | | |
| Error visibility | | | | | |

Then the stage table from section 4, the list from section 3, and short answers to sections 5 to 9.

## 11. Five questions to answer in plain English

Start each answer with Yes, No, or Partly, then explain in two or three sentences.

1. If I build and run my desktop application today, will ApplyMind automatically learn from my newly verified screening answers?
2. Will ApplyMind automatically use its existing knowledge to fill screening questions?
3. Does the model improve as I complete more job applications, without my rebuilding or retraining it manually?
4. Where and how is `bge-small-en-v1.5` actually being used?
5. What specific problems must be fixed to achieve the workflow in section 1?

## 12. Proposed fixes

Finish with a numbered list of fixes, most important first. For each one give the problem it solves, the files it touches, the size of the change, and any risk to existing functionality. Prefer the simplest fix that works. If the current architecture cannot support the workflow in section 1, say exactly why and propose the smallest change that would.

Then stop. Do not modify any code until I approve the list.

I am not building a large general-purpose AI model. I want a lightweight, customized, self-improving question-answering system that becomes more useful every time I complete a job application.
