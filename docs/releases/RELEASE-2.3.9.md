# ApplyFlow Desktop 2.3.9 — ApplyMind travels with your data file

## What changed

**1. Export and import**
- A `.applyflow` file that includes ApplyMind is format version 2. ApplyFlow 2.3.8 and earlier refuse that file. A format version 1 file still imports.
- The ApplyMind section carries knowledge records, revision history, confirmed profile facts, deletions, open reviews, the freshness and cold-start settings, and a description of the trained model. It does not carry model weights, the encryption key, an API key, a password, or a browser session.
- The password box on Data management starts ticked. Without a password, checksums detect a damaged file. They do not stop someone who has the file from changing it.

**2. Merge**
- The same record is kept once. A longer history is kept. The same answer in the same context becomes one record. Different contexts are both kept. Two verified answers for the same question are listed and are not filled until you choose. A verified answer takes precedence over an accepted one. A deletion stays deleted.
- An imported change to a saved answer does not overwrite or delete a verified answer. That difference is a conflict. Only an edit you make on this computer counts as a correction.

**3. Review**
- The eleven answers the filler wrote, and the two uncertain ones, are changed from verified to accepted before an export. The store is backed up first. They appear on Data management with the question and the answer. Confirm or correct makes one verified. Delete removes it.
- Saving Screening Q&A does not turn those thirteen back into verified.
- While a conflict or a review item is open, that question is not filled from saved answers or from ApplyMind.

**4. After import**
- This computer trains its own model from the verified answers it now holds. Weights are never copied.
- Data management can restore the ApplyMind tables from the newest backup. The existing full-database restore is unchanged.

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.3.9.exe` (or `ApplyFlow-2.3.9-portable.exe`).
