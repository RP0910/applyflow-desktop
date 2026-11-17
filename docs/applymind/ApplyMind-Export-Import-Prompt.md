# ApplyMind in Data Management: Export, Import, and Merge

## 0. The problem

I exported from **Data management → Export all data** in the installed app (version 2.3.8). The resulting `.applyflow` file contains no ApplyMind data: no knowledge-store records, no accepted fills, no history, no model information. It carries only the 34 Screening Q&A answers inside my profile, and the importing computer rebuilds an ApplyMind copy from those.

That is not what I asked for. ApplyMind's learned knowledge must travel between my computers through this same Data management feature, in the same single `.applyflow` file.

## 1. Rules

- **Check before building (section 2), then report and wait for my approval.** After approval, implement sections 3 to 8.
- Mark every claim with an evidence level: **Verified** (observed at runtime; say development or installed build), **Tested** (name the test), **Implemented** (code exists, not seen running), or **Unverified**.
- The feature is not done until it is **Verified in the installed Windows build** (section 9). Working in development mode does not count.
- Keep everything the existing export and import already do. Do not change how applications, documents, contacts, and the other existing data are exported or merged.
- Do not weaken any ApplyMind safety rule: only answers I typed, approved, or corrected are verified; a verified answer is never overwritten silently.

## 2. Check first (read-only)

1. Does any ApplyMind export, import, or merge code exist in the project? If it does, why is it not reached from Data management?
2. Is the installed 2.3.8 build made from the current code, or is it older than the ApplyMind work?
3. How does the current `.applyflow` format work: structure, format version, how password protection is applied, and how an older app version treats content it does not recognize?
4. How does the current import merge saved answers ("newer changes win"), and how do those answers then reach ApplyMind through `planMigration`?
5. How is the ApplyMind store encrypted on this computer, and where is that key kept?
6. Have the earlier fixes been made: filled answers no longer stored as verified, and the audit of the 34 existing records? If not, say so, because exporting wrongly verified records would spread them to my other computers.

Report the findings and your implementation plan, then stop.

## 3. What the export must contain

Add an ApplyMind section to the `.applyflow` file with:

- Every knowledge record: original and normalized question, pattern, category, type, answer options, answer, status (verified or accepted), provenance, context, source platform, dates, stable record ID, and the ID of the computer that created it
- The full revision history of each record, including corrections and feedback
- Profile facts
- Records of deleted items, so a deletion carries over
- Learning history
- ApplyMind settings: confidence thresholds and autofill mode
- Model information: the `am-lr-1` version, a fingerprint of the data it was trained on, and the embedding model's name, version, and dimension if one is installed
- A manifest for the section: schema version, app version, source computer ID, creation time, record counts, and a checksum for each part

**Do not export:** the trained model's weights as a source of truth, this computer's encryption key, or anything already excluded today (API key, sign-in, job-site passwords, browser sessions).

**Encryption.** The ApplyMind store is encrypted with a key that belongs to this computer. The export must decrypt the data and write it into the file under the file's own protection. Data still locked with this computer's key would be unreadable on another computer.

**Password protection.** Use the existing "Protect the file with a password" option. When the export includes ApplyMind data, the box is ticked by default. If I untick it, show a one-line warning that my answers and profile facts will be readable by anyone who has the file. The checksums are written either way. State plainly in the documentation that without a password the file is protected against corruption, not against deliberate tampering.

## 4. What the import must do

For the ApplyMind section, in this order:

1. Validate the section's format and schema version.
2. Verify every checksum before reading any record into the application.
3. Migrate an older schema forward.
4. Create a local backup of the current ApplyMind store.
5. Merge using the rules in section 5.
6. Rebuild embeddings if an embedding model is installed, and retrain `am-lr-1` automatically from the merged verified data. No manual step.
7. Report the result (section 7).

Failure handling:

- If the ApplyMind section is corrupted, fails a checksum, or comes from a newer schema than this version understands, cancel the whole import, change nothing, and state the reason clearly.
- The import is all-or-nothing. If it is interrupted, my data is exactly as it was before.
- A file from 2.3.8 or earlier, with no ApplyMind section, must still import as it does today.

## 5. Merge rules for ApplyMind data

The existing rule for other data, "newer changes win", must **not** be applied to verified answers. Computer clocks differ, and a verified answer must never be replaced silently.

1. Same record, same history → skip.
2. Same record, one history continues the other → keep the longer history.
3. Same question pattern, compatible context, same answer → one record, histories combined.
4. Same pattern, different contexts → keep both. Not a conflict.
5. Same pattern, compatible context, different verified answers → **conflict**. Keep both, list them for me to resolve, and do not fill that question automatically until I do.
6. A verified answer always takes precedence over an accepted or predicted one.
7. A deleted record stays deleted after the merge.

Required properties:

- Importing the same file twice changes nothing the second time.
- Exporting from A and importing to B, then exporting from B and importing to A, leaves both computers with identical knowledge.
- No verified record and no history entry is lost.

**Two paths, one result.** The file will carry my answers twice: once in the profile's saved answers, as today, and once in the ApplyMind section. Importing must not create duplicate records, and an answer arriving through the profile path must not overwrite a verified ApplyMind answer. Explain in your plan how you prevent both, and add a test for each.

## 6. Conflict resolution

Provide a simple screen that lists each conflict with both answers, their context, history, and where each came from. For each one I can keep the first, keep the second, keep both for different contexts, or enter a new answer. Show the number of unresolved conflicts in the ApplyMind section of the app.

## 7. Interface changes in Data management

Keep the existing layout and wording style.

- Add ApplyMind knowledge to the "Includes…" description text.
- After export, add the ApplyMind counts to the result line, for example: verified answers and patterns.
- After import, show: records added, merged, skipped as duplicates, conflicts waiting for me, and whether retraining finished.
- Add **Restore last backup** for the ApplyMind store.

No new screens other than conflict resolution.

## 8. Tests

Write automated tests for:

- Export contains every ApplyMind part listed in section 3
- Export then import on an empty store reproduces the same records and histories
- Each merge rule in section 5, including a real conflict
- Importing the same file twice
- Merging in both directions gives identical results
- A corrupted file, a tampered file, a wrong password, and an interrupted import each leave my data unchanged
- A file with no ApplyMind section (2.3.8 format) still imports
- A file from a newer schema is refused with a clear message
- No duplicate records from the profile path and the ApplyMind path
- No encryption key, API key, password, or session data in the file
- Retraining runs automatically after import
- The backup is created and can be restored

## 9. Verification in the installed build

Build the installer and install it. Using two separate data folders to act as two computers, each with different verified answers, some overlapping, and at least one real conflict:

1. Export from computer A through Data management.
2. Open the exported file and list the ApplyMind content it contains, with counts.
3. Import it on computer B through Data management. Show the import report.
4. Resolve the conflict on B.
5. Export from B and import on A.
6. Confirm both now hold the same records and histories, that `am-lr-1` was retrained on each, and that an answer learned only on A is now filled on B.

Use copies of my data, not the originals.

## 10. Final report

1. What was implemented, with file paths.
2. Test results.
3. The section 9 results, step by step, each marked Verified or not.
4. Anything incomplete or unverified.
5. A short description of the ApplyMind section of the `.applyflow` format.

## 11. Note on the trained model

The trained `am-lr-1` weights are not copied between computers. Each computer retrains automatically from the merged verified answers after an import. Models trained on different data must not be merged or averaged. The verified answers and their history are what must travel, completely and without loss.
