/**
 * Local cover-letter draft. Every sentence about the candidate is built from their
 * own resume bullets — the generator adds connective phrasing only.
 */
import type { CareerProfile, CoverLetterAction, CoverLetterTone, JobPosting, MasterResume, SkillEvidence, TailoredResume } from '@/types';
import { relevance } from '@/services/tailoring/localTailor';
import { rankByJobEmphasis } from '@/services/matching/evidence';
import { findSkills, isKnownSkill } from '@/services/skills/extract';
import { yearsOfExperience } from '@/services/matching/experience';
import { wordCount } from '@/utils/text';

export interface LocalLetterInput {
  job: JobPosting;
  master: MasterResume;
  resume: TailoredResume;
  profile?: CareerProfile;
  evidence: SkillEvidence[];
  tone: CoverLetterTone;
  action?: CoverLetterAction;
  /** Rotates which examples are used when regenerating. */
  variant?: number;
}

function asFirstPerson(bullet: string): string {
  const b = bullet.trim().replace(/[.;]\s*$/, '');
  if (/^(i|my)\b/i.test(b)) return b;
  return `I ${b.charAt(0).toLowerCase()}${b.slice(1)}`;
}

/** Lowercase a leading common word ("Open-source …"), but never a technology or proper noun ("Python …"). */
function softLower(s: string): string {
  const first = s.split(/\s+/)[0] ?? '';
  if (!first || findSkills(first).length || /^[A-Z]{2,}/.test(first)) return s;
  return `${s.charAt(0).toLowerCase()}${s.slice(1)}`;
}

function sentence(s: string): string {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

export function generateLocalCoverLetter(i: LocalLetterInput): string {
  const { job, resume } = i;
  const tone: CoverLetterTone = i.action === 'more_technical' ? 'technical' : i.action === 'more_natural' && i.tone === 'professional' ? 'warm' : i.tone;
  const shorter = i.action === 'shorter';
  const req = i.evidence.filter((e) => e.importance === 'required').map((e) => e.skill);
  const pref = i.evidence.filter((e) => e.importance === 'preferred').map((e) => e.skill);
  const strong = i.evidence.filter((e) => e.status === 'strong').map((e) => e.skill);
  const resp = [...job.responsibilities, ...job.qualifications];
  const name = resume.contact.fullName || i.profile?.fullName || '';
  const years = Math.floor(yearsOfExperience(resume.experience));
  const recent = resume.experience[0];
  const previous = resume.experience[1];

  const ranked = resume.experience.flatMap((e, ei) =>
    e.bullets.map((b) => ({ b, e, ei, r: relevance(b, req, pref, resp) })),
  ).sort((a, b) => b.r - a.r);
  const v = Math.max(0, i.variant ?? 0);
  const ex1 = ranked[v % Math.max(1, ranked.length)];
  const ex2 = ranked.find((x) => x !== ex1 && (x.ei !== ex1?.ei || ranked.length < 3) && x.r > 0) ?? ranked.find((x) => x !== ex1);
  const ex3 = ranked.find((x) => x !== ex1 && x !== ex2);
  const usedRoles = new Set([ex1?.ei, ex2?.ei, ex3?.ei]);
  const ex4 = ranked.find((x) => !usedRoles.has(x.ei) && x.r > 0);

  const companyRef = job.company || 'your team';
  // Prose names only recognized technologies — generic board tags (e.g. "Architecture") read oddly mid-sentence.
  const focus = rankByJobEmphasis(strong.filter((s) => req.includes(s) && isKnownSkill(s)), job.description).slice(0, 3);

  const opening: Record<CoverLetterTone, string> = {
    professional: `I'm applying for the ${job.title} role at ${companyRef}.`,
    warm: `I was glad to see the ${job.title} opening at ${companyRef}, and I'd like to be considered for it.`,
    direct: `I'm applying for the ${job.title} role at ${companyRef}.`,
    technical: `I'm applying for the ${job.title} role at ${companyRef}.`,
    startup: `I'd like to join ${companyRef} as ${/^[aeiou]/i.test(job.title) ? 'an' : 'a'} ${job.title}.`,
  };
  const intro = recent
    ? `I'm currently ${/^[aeiou]/i.test(recent.title) ? 'an' : 'a'} ${recent.title} at ${recent.company}${years ? `, with ${years} years of experience overall` : ''}.`
    : '';
  const fit = focus.length
    ? tone === 'direct'
      ? `The role centers on ${joinList(focus)}, which is the work I do now.`
      : `The role's focus on ${joinList(focus)} lines up closely with the work I've been doing.`
    : '';

  const p1 = [opening[tone], intro, fit].filter(Boolean).join(' ');

  const examples: string[] = [];
  if (ex1) {
    const lead = ex1.ei === 0 ? `In my current role at ${ex1.e.company}, ` : `At ${ex1.e.company}, `;
    examples.push(sentence(`${lead}${asFirstPerson(ex1.b).replace(/^I /, 'I ')}`.replace(/, I /, ', I ')));
  }
  if (ex2) {
    let lead: string;
    if (ex2.ei === ex1?.ei) lead = 'I also ';
    else if (ex2.e.company === ex1?.e.company) lead = `Earlier there, as ${/^[aeiou]/i.test(ex2.e.title) ? 'an' : 'a'} ${ex2.e.title}, I `;
    else if (ex2.ei === 1 && previous) lead = `Before that, at ${previous.company}, I `;
    else lead = `At ${ex2.e.company}, I `;
    examples.push(sentence(`${lead}${asFirstPerson(ex2.b).replace(/^I /, '')}`));
  }
  const p2 = examples.join(' ');

  let p3 = '';
  if (!shorter) {
    const tech = rankByJobEmphasis(strong.filter(isKnownSkill), job.description).slice(0, tone === 'technical' ? 6 : 4);
    const project = resume.projects[0];
    const cert = resume.certifications.find((c) => req.some((s) => c.toLowerCase().includes(s.toLowerCase().split(' ')[0]!)));
    p3 = [
      tech.length ? `Much of my work has involved ${joinList(tech)}.` : '',
      ex3 ? sentence(`${ex3.ei === 0 ? 'Recently' : 'Earlier in my career'}, ${asFirstPerson(ex3.b)}`) : '',
      ex4 ? sentence(`Earlier in my career at ${ex4.e.company}, ${asFirstPerson(ex4.b)}`) : '',
      project ? sentence(`Outside my day job, I maintain ${softLower(project.name)}${project.description ? ` (${project.description})` : ''}`) : '',
      cert ? sentence(`I also hold the ${cert.replace(/\s*\(\d{4}\)\s*$/, '')} certification`) : '',
      tone === 'startup' ? 'I tend to take ownership of problems end to end, from design through production.' : '',
    ].filter(Boolean).join(' ');
  }

  const loc = resume.contact.location;
  let p4 = '';
  if (job.remoteStatus === 'onsite' && loc && job.location && job.location.split(',')[0] && loc.toLowerCase().includes(job.location.split(',')[0]!.toLowerCase())) {
    p4 = `I'm based in ${loc}, so the on-site schedule works for me.`;
  } else if (job.remoteStatus === 'remote' && i.profile?.remotePreference === 'remote') {
    p4 = 'I work well remotely and am used to collaborating across time zones.';
  }

  const closing: Record<CoverLetterTone, string> = {
    professional: `I'd welcome the chance to discuss how I could contribute to ${companyRef}. Thank you for your time and consideration.`,
    warm: `I'd really enjoy talking with you about the role and how I could help. Thank you for considering my application.`,
    direct: `I'd like to talk about the role. Thank you for your time.`,
    technical: `I'd be glad to walk through the architecture and trade-offs behind this work in more detail. Thank you for your time.`,
    startup: `If this sounds like a fit, I'd love to talk. Thanks for reading.`,
  };

  const body = [p1, p2, p3, p4, closing[tone]].filter(Boolean).join('\n\n');
  return `Dear Hiring Team,\n\n${body}\n\nSincerely,\n${name}`.trim();
}

export function letterWordCount(text: string): number {
  return wordCount(text);
}
