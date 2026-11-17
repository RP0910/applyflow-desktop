# ApplyFlow Desktop 2.3.14 — Collapse Apply Now tiles while scrolling

## What changed

**1. Full tile removal**
- Hiding a Jobright **Apply Now** (or other non-Autofill) card removes the entire list tile, including the match-score column, so Autofill jobs move up with no blank white gap.

**2. Scroll / infinite load**
- The same filter re-runs on scroll, DOM updates, and while you stay on Jobright recommend/search, so Apply Now jobs that appear after loading more results are hidden as well.

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.3.14.exe` (or `ApplyFlow-2.3.14-portable.exe`).
