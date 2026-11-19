# ApplyFlow Desktop 2.3.15 — Greenhouse forms and street address

## What changed

**1. Greenhouse forms are filled**
- A Greenhouse application that includes the phone-country search was treated as a site search box, so nothing was filled. The form is recognized again.
- The tailored resume and cover letter are attached, then name, email, phone, and the other profile fields are filled.
- The phone country is set before the phone number. A Greenhouse dropdown that ignores a click is confirmed with Enter.
- Dice, Lever, and Ashby still use the same fill path as before.

**2. Street address**
- Address, Street address, residential address, “your address”, and inputs marked `street-address` are filled from **Profile → Street address**.
- When the field is an address search, ApplyFlow types the street and chooses the suggestion that matches it (for example the full “street, city, state” line).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.3.15.exe` (or `ApplyFlow-2.3.15-portable.exe`).
