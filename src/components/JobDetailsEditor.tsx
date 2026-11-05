import { useState } from 'react';
import type { JobPosting } from '@/types';
import { splitDescription, detectSignals, classifyJobSkills, detectRemoteStatus } from '@/services/extraction/sections';

export function JobDetailsEditor({ job, onSave, onCancel }: { job: JobPosting; onSave: (j: JobPosting) => void; onCancel: () => void }) {
  const [d, setD] = useState({
    title: job.title,
    company: job.company,
    location: job.location,
    remoteStatus: job.remoteStatus,
    salary: job.salary ?? '',
    employmentType: job.employmentType ?? '',
    description: job.description,
  });
  const set = (k: keyof typeof d, v: string) => setD((x) => ({ ...x, [k]: v }));
  const save = () => {
    const sections = splitDescription(d.description);
    const signals = detectSignals(d.description);
    const skills = classifyJobSkills(sections, d.description, []);
    onSave({
      ...job,
      title: d.title.trim(),
      company: d.company.trim(),
      location: d.location.trim(),
      remoteStatus: d.remoteStatus === 'unknown' ? detectRemoteStatus(`${d.location} ${d.description.slice(0, 1000)}`) : d.remoteStatus,
      salary: d.salary.trim() || null,
      employmentType: d.employmentType.trim() || null,
      description: d.description.trim(),
      requiredSkills: d.description === job.description && job.requiredSkills.length ? job.requiredSkills : skills.required,
      preferredSkills: d.description === job.description && job.preferredSkills.length ? job.preferredSkills : skills.preferred,
      responsibilities: sections.responsibilities.slice(0, 25),
      qualifications: sections.requirements.slice(0, 25),
      benefits: sections.benefits.slice(0, 15),
      educationRequirements: signals.education,
      clearanceRequirements: signals.clearance,
      workAuthorizationRequirements: signals.workAuthorization,
      sponsorshipLanguage: signals.sponsorship,
      contractDuration: signals.contractDuration ?? job.contractDuration,
    });
  };
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid-2">
        <div className="field">
          <label htmlFor="jd-title">Job title</label>
          <input id="jd-title" className="input" required value={d.title} onChange={(e) => set('title', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="jd-company">Company</label>
          <input id="jd-company" className="input" required value={d.company} onChange={(e) => set('company', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="jd-loc">Location</label>
          <input id="jd-loc" className="input" value={d.location} onChange={(e) => set('location', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="jd-remote">Work arrangement</label>
          <select id="jd-remote" className="select" value={d.remoteStatus} onChange={(e) => set('remoteStatus', e.target.value)}>
            <option value="unknown">Not stated</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">On-site</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="jd-salary">Salary</label>
          <input id="jd-salary" className="input" value={d.salary} onChange={(e) => set('salary', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="jd-type">Employment type</label>
          <input id="jd-type" className="input" value={d.employmentType} onChange={(e) => set('employmentType', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="jd-desc">Job description</label>
        <textarea id="jd-desc" className="textarea" style={{ minHeight: 260 }} required value={d.description} onChange={(e) => set('description', e.target.value)} />
        <span className="hint">Paste the full description if anything is missing. Skills and requirements are re-detected when you save.</span>
      </div>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={d.description.trim().length < 100 || !d.title.trim()}>
          Save job details
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
