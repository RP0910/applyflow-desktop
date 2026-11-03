# Resume JSON — `applyflow.resume/1`

Claude returns **content only**, as JSON. ApplyFlow fills in your employers, titles, dates, education and contact details from your work history, checks every line against your facts, and stores the result as an `applyflow.resume/1` document. **ApplyFlow's own renderer (no AI) draws the PDF and Word files from it.**

That JSON is kept:

- in the database (Applications → any application → Resume vN), one row per version, marked **Sent** for the one you submitted;
- next to the PDF as `resume.json` in the application's folder.

Re-render it any time — another template, font or size, or after a hand edit — in **PDF Studio**. No tokens are used.

## Format

```jsonc
{
  "$schema": "applyflow.resume/1",
  "basics": {
    "name": "Alex Rivera",
    "headline": "Senior Software Engineer | TypeScript, React, AWS",
    "email": "alex@example.com",
    "phone": "(555) 010-2030",
    "location": "Denver, CO",
    "links": ["linkedin.com/in/alexrivera"]
  },
  "summary": "Senior Software Engineer with 8+ years of experience …",
  "skills": [
    { "group": "Languages", "items": ["TypeScript", "Python", "SQL"] },
    { "group": "Cloud & DevOps", "items": ["AWS", "Docker", "Terraform"] }
  ],
  "experience": [
    {
      "title": "Senior Software Engineer",
      "company": "Example Health",
      "location": "Denver, CO",
      "start": "03/2021",          // "03/2021", "Mar 2021" or "2021"
      "end": "Present",
      "bullets": ["Built a React and TypeScript scheduling app used by 40 clinics …"],
      "technologies": ["React", "TypeScript", "AWS"]
    }
  ],
  "projects": [{ "name": "…", "description": "…", "bullets": ["…"] }],
  "education": [{ "degree": "B.S. in Computer Science", "institution": "University of Colorado", "location": "Boulder, CO", "date": "2017", "details": [] }],
  "certifications": ["AWS Certified Developer – Associate"],
  "additional": ["Languages: English, Spanish"],
  "coverLetter": { "paragraphs": ["Dear Hiring Team,", "…", "Sincerely,\nAlex Rivera"] },
  "meta": { "company": "…", "jobTitle": "…", "jobUrl": "…", "model": "claude-sonnet-5-5", "version": 1 }
}
```

Only `basics.name` is required. Reading is lenient: a list may be a newline-separated string, `skills` may be a flat list of names, and missing fields are empty. **JSON Resume** files (jsonresume.org: `basics`, `work`, `education`, `skills`, `projects`, `certificates`) are read too.

PDF Studio → **Save JSON schema…** writes the JSON Schema for editors.

## Templates

All templates are one column, real selectable text, standard section headings and embedded fonts — ATS-safe.

| Template | Look |
|---|---|
| Classic (ATS) | Black headings with a thin grey rule. The default. |
| Modern accent | Name, headings and rules in an accent color you choose. |
| Compact | Tighter spacing and narrow margins — fits more on a page. |

Fonts: Arial, Calibri, Helvetica, Cambria, Times New Roman (the PDF embeds metric-compatible open fonts; the Word file uses the real names). Sizes 10–12 pt.

## What Claude actually returns

The request asks for this compact shape (job ids are shortened to `j1`, `j2`… and mapped back locally):

```json
{
  "headline": "…", "summary": "…",
  "skills": [{ "group": "…", "items": ["…"] }],
  "jobs": [{ "id": "j1", "bullets": ["…"], "tech": ["…"] }],
  "projects": [{ "name": "…", "bullets": ["…"] }],
  "certs": [0],
  "gaps": ["requirements your facts don't show"],
  "letter": ["Dear Hiring Team,", "…", "Sincerely,\nName"]
}
```

## Command line

For developers, the same renderer runs from Node.js:

```bash
npm run build
node dist-cli/applyflow-render.mjs resume.json -o out.pdf --template modern --font calibri --size 11 --docx
```
