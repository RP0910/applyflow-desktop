import type {
  AtsCategory, AtsCheck, AtsPlan, AtsReport, CareerProfile, EducationEntry, KeywordResult, MasterResume, ParseCheck, ResumeFormat, SupportedKeyword, TailoredResume,
} from '@/types';
import { allowedResume } from '@/services/resume/facts';
import { yearsOfExperience } from '@/services/matching/experience';
import { parseResumeDate } from '@/utils/dates';
import { nowIso } from '@/utils/dates';
import { wordCount } from '@/utils/text';
import { countForm, hasStem } from './terms';
import { SOFT_SKILLS } from '@/services/skills/taxonomy';

export const ATS_DISCLAIMER =
  'ApplyFlow’s simulation of a keyword-based ATS filter. Real systems differ by employer, and no score guarantees an interview.';

export interface ScanJob {
  sourceId?: string;
  title: string;
  company: string;
  location: string;
  startDate: string;
  endDate: string;
  bullets: string[];
  technologies?: string[];
}

export interface ScanDoc {
  name: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  summary: string;
  skills: string[];
  experience: ScanJob[];
  education: EducationEntry[];
  certifications: string[];
  headings: string[];
}

export function docFromTailored(t: TailoredResume): ScanDoc {
  return {
    name: t.contact.fullName,
    email: t.contact.email,
    phone: t.contact.phone,
    location: t.contact.location,
    headline: t.headline,
    summary: t.summary,
    skills: t.skillGroups?.length ? t.skillGroups.flatMap((g) => g.skills) : t.skills,
    experience: t.experience,
    education: t.education,
    certifications: t.certifications,
    headings: ['Professional Summary', 'Skills', 'Professional Experience', 'Education', ...(t.certifications.length ? ['Certifications'] : [])],
  };
}

export function docFromMaster(m: MasterResume, profile?: CareerProfile): ScanDoc {
  const a = allowedResume(m, profile);
  const head = m.rawText.split('\n').map((l) => l.trim()).filter((l) => /^[A-Za-z &]{4,40}$/.test(l) && l.length < 40);
  return {
    name: a.contact.fullName,
    email: a.contact.email,
    phone: a.contact.phone,
    location: a.contact.location,
    headline: a.headline,
    summary: a.summary,
    skills: a.skills,
    experience: a.experience,
    education: a.education,
    certifications: a.certifications,
    headings: head,
  };
}

const ACTION_VERBS = new Set(
  (
    'accelerated achieved administered advanced advised analyzed architected assembled authored automated balanced built captured championed coached collaborated ' +
    'combined completed composed conceived conducted configured consolidated constructed consulted contributed converted coordinated created cut debugged decreased ' +
    'defined delivered deployed designed detected developed devised diagnosed directed doubled drove eliminated embedded enabled engineered enhanced established evaluated ' +
    'executed expanded expedited extended facilitated fixed formalized formulated founded generated grew guided halved headed identified implemented improved increased ' +
    'initiated innovated inspected installed instituted integrated introduced invented launched led leveraged lowered maintained managed maximized mentored migrated ' +
    'minimized modeled modernized monitored negotiated operated optimized orchestrated organized overhauled owned partnered performed piloted pioneered planned produced ' +
    'profiled programmed promoted prototyped provisioned published raised rebuilt redesigned reduced refactored reengineered remediated replaced resolved restructured ' +
    'revamped reviewed rewrote saved scaled secured shipped simplified spearheaded standardized steered streamlined strengthened structured supervised supported ' +
    'tested trained transformed translated troubleshot tuned unified upgraded validated wrote ' +
    'lead build design develop architect implement own drive manage deliver create optimize integrate maintain mentor partner scale ship improve run oversee ' +
    'oversaw ran set started worked participated served handled'
  ).split(/\s+/),
);
const WEAK_STARTS = /^(?:responsible for|duties included|worked on|helped|assisted|participated in|involved in|tasked with)\b/i;
const PRONOUNS = /(?:^|[\s(])(?:I|me|my|mine|we|our|us)(?=[\s,.;)]|$)/;
const RESUME_CLICHES = /\b(results[- ]driven|team player|go-getter|hard[- ]working|detail[- ]oriented|self[- ]starter|think outside the box|synerg\w*|dynamic professional|passionate about|proven track record|seasoned professional|rockstar|ninja|guru)\b/i;
const METRIC = /\$\s?\d|(?<![\w.\-/])\d+(?:[.,]\d+)*\s*(?:%|percent|x\b|k\b|m\b|ms\b|million|billion|thousand|\+)|(?<![\w.\-/])(?!(?:19|20)\d{2}\b)\d{2,}(?:,\d{3})*(?![\w\-/.])/i;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function sectionText(doc: ScanDoc) {
  return {
    headline: doc.headline,
    summary: doc.summary,
    skills: doc.skills.join(', '),
    experience: doc.experience.flatMap((e) => [...e.bullets, (e.technologies ?? []).join(', ')]).join('\n'),
    titles: doc.experience.map((e) => e.title).join('\n'),
    education: doc.education.map((e) => [e.degree, e.institution, ...e.details].join(' ')).join('\n'),
    certifications: doc.certifications.join('\n'),
  };
}

function keywordResult(k: SupportedKeyword, doc: ScanDoc): KeywordResult {
  const s = sectionText(doc);
  const all = Object.values(s).join('\n');
  let forms = k.forms;
  if (k.kind === 'soft') forms = [k.term, ...(SOFT_SKILLS.find((x) => x.name === k.term)?.aliases ?? [])];
  const exactForms = k.kind === 'title' ? [k.forms[0]!] : [k.term];
  const count = (text: string, f: string) => (k.kind === 'soft' ? (hasStem(text, f) ? 1 : 0) : countForm(text, f));
  const exact = exactForms.reduce((n, f) => n + count(all, f), 0);
  const any = forms.reduce((n, f) => Math.max(n, count(all, f)), 0);
  const inSection = (text: string) => forms.some((f) => count(text, f) > 0);
  return {
    term: k.term,
    kind: k.kind,
    importance: k.importance,
    weight: k.weight,
    support: k.support,
    found: exact > 0 ? 'exact' : any > 0 ? 'synonym' : 'missing',
    count: Math.max(exact, any),
    inExperience: inSection(s.experience) || (k.kind === 'title' && inSection(s.titles)),
    inSkills: inSection(s.skills),
    inSummary: inSection(`${s.headline}\n${s.summary}`),
  };
}

function credit(r: KeywordResult): number {
  if (r.found === 'missing') return 0;
  let c = r.found === 'exact' ? 1 : 0.8;
  if (!r.inExperience && !r.inSummary && r.kind !== 'education' && r.kind !== 'certification') c *= 0.85;
  return c;
}

function datesConsistent(jobs: ScanJob[]): boolean {
  const styles = new Set(
    jobs.flatMap((e) => [e.startDate, e.endDate]).filter((d) => d && !/present|current/i.test(d)).map((d) => (/^\d{1,2}\/\d{4}$/.test(d) ? 'mm' : /^[A-Za-z]{3,9}\.? \d{4}$/.test(d) ? 'mon' : /^\d{4}$/.test(d) ? 'yyyy' : 'other')),
  );
  return styles.size <= 1 && !styles.has('other');
}

function reverseChronological(jobs: ScanJob[], now: Date): boolean {
  const starts = jobs.map((e) => parseResumeDate(e.startDate, now)).filter((x): x is number => x !== null);
  return starts.every((s, i) => i === 0 || s <= starts[i - 1]!);
}

export interface ScanContext {
  plan: AtsPlan;
  masterJobs: number;
  computedFor: 'master' | 'tailored';
  format?: ResumeFormat | null;
  parse?: ParseCheck | null;
  pageTarget?: AtsPlan['pageTarget'];
  now?: Date;
}

export function scanResume(doc: ScanDoc, ctx: ScanContext): AtsReport {
  const now = ctx.now ?? new Date();
  const checks: AtsCheck[] = [];
  const results = ctx.plan.keywords.map((k) => keywordResult(k, doc));
  const byTerm = new Map(results.map((r) => [r.term, r]));

  const hard = results.filter((r) => r.kind === 'hard' || r.kind === 'domain' || r.kind === 'certification');
  const totalW = hard.reduce((n, r) => n + r.weight, 0) || 1;
  const gotW = hard.reduce((n, r) => n + r.weight * credit(r), 0);
  const supportedW = hard.filter((r) => r.support === 'supported').reduce((n, r) => n + r.weight, 0);
  const kwScore = 45 * (gotW / totalW);
  const foundHard = hard.filter((r) => r.found !== 'missing');
  const usableMissing = hard.filter((r) => r.found === 'missing' && r.support === 'supported');
  const notYours = hard.filter((r) => r.found === 'missing' && r.support !== 'supported');
  checks.push({
    id: 'keywords',
    status: usableMissing.length ? (usableMissing.length > 3 ? 'fail' : 'warn') : 'pass',
    label: `${foundHard.length} of ${hard.length} job keywords found`,
    detail: usableMissing.length
      ? `Missing but backed by your resume: ${usableMissing.slice(0, 8).map((r) => r.term).join(', ')}.`
      : notYours.length
        ? `Every keyword your experience supports is used. Not on your resume: ${notYours.slice(0, 6).map((r) => r.term).join(', ')}.`
        : 'Every job keyword is on the resume.',
  });
  const synonymOnly = hard.filter((r) => r.found === 'synonym' && r.support === 'supported');
  if (synonymOnly.length) {
    checks.push({ id: 'exact_terms', status: 'warn', label: 'Use the job’s exact wording', detail: `Some ATS only match exact words. The job says ${synonymOnly.slice(0, 4).map((r) => `“${r.term}”`).join(', ')}.` });
  }
  const planned = new Map(ctx.plan.keywords.map((k) => [k.term, k]));
  const skillsOnly = hard.filter((r) => r.found !== 'missing' && !r.inExperience && !r.inSummary && r.support === 'supported' && r.weight >= 2.5);
  const canShow = skillsOnly.filter((r) => planned.get(r.term)?.evidence.some((e) => e.sourceId));
  const noProof = skillsOnly.filter((r) => !planned.get(r.term)?.evidence.some((e) => e.sourceId));
  if (canShow.length) {
    checks.push({ id: 'keyword_context', status: 'warn', label: 'Key skills only in the Skills list', detail: `Show ${canShow.slice(0, 4).map((r) => r.term).join(', ')} in a job bullet too — ATS and recruiters weigh skills used in a job higher.` });
  }
  if (noProof.length) {
    checks.push({ id: 'skills_without_proof', status: 'warn', label: `${noProof.length} job skill${noProof.length > 1 ? 's are' : ' is'} listed but not shown in any job`, detail: `${noProof.slice(0, 5).map((r) => r.term).join(', ')}: if you used ${noProof.length > 1 ? 'them' : 'it'} at a job, add a line to your master resume so ApplyFlow can show it there.` });
  }

  const titleKw = ctx.plan.keywords.find((k) => k.kind === 'title');
  const titleRes = titleKw ? byTerm.get(titleKw.term) : undefined;
  let titleScore = 10;
  if (titleKw && titleRes) {
    const full = countForm(`${doc.headline}\n${doc.summary}\n${doc.experience.map((e) => e.title).join('\n')}`, titleKw.forms[0]!);
    const core = titleKw.forms[1] ? countForm(`${doc.headline}\n${doc.summary}\n${doc.experience.map((e) => e.title).join('\n')}`, titleKw.forms[1]) : 0;
    titleScore = full ? 10 : core ? 8 : titleKw.support === 'related' ? 4 : titleKw.support === 'supported' ? 3 : 2;
    checks.push({
      id: 'title',
      status: full || core ? 'pass' : titleKw.support === 'supported' ? 'fail' : 'warn',
      label: full ? `Job title “${titleKw.term}” appears on the resume` : core ? `Core job title “${titleKw.forms[1]}” appears on the resume` : `Job title “${titleKw.term}” is not on the resume`,
      detail: full || core ? undefined : titleKw.support === 'supported' ? 'Your experience matches this title — put it in the headline.' : 'Your past titles differ, so ApplyFlow uses your real title.',
    });
  }

  const jobs = doc.experience;
  const allJobs = ctx.masterJobs ? Math.min(1, jobs.length / ctx.masterJobs) : jobs.length ? 1 : 0;
  const complete = jobs.length ? jobs.filter((e) => e.title && e.company && e.startDate).length / jobs.length : 0;
  const located = jobs.length ? jobs.filter((e) => e.location).length / jobs.length : 0;
  const consistent = datesConsistent(jobs);
  const ordered = reverseChronological(jobs, now);
  const years = Math.floor(yearsOfExperience(jobs, now));
  const req = ctx.plan.requiredYears;
  const yearsOk = !req || years >= req;
  const expScore = 5 * allJobs + 4 * complete + 2 * located + (consistent ? 1 : 0) + (ordered ? 1 : 0) + (yearsOk ? 2 : req ? 2 * Math.min(1, years / req) : 2);
  checks.push({
    id: 'all_jobs',
    status: jobs.length >= ctx.masterJobs ? 'pass' : 'fail',
    label: jobs.length >= ctx.masterJobs ? `All ${jobs.length} jobs included` : `Only ${jobs.length} of ${ctx.masterJobs} jobs included`,
    detail: jobs.length >= ctx.masterJobs ? undefined : 'Every job must stay on the resume — missing jobs look like gaps and lose years of experience.',
  });
  checks.push({
    id: 'job_details',
    status: complete === 1 && located === 1 ? 'pass' : complete === 1 ? 'warn' : 'fail',
    label: complete === 1 && located === 1 ? 'Each job has title, company, city and dates' : complete === 1 ? 'Some jobs have no city' : 'Some jobs are missing a title, company or dates',
  });
  checks.push({ id: 'dates', status: consistent && ordered ? 'pass' : 'warn', label: consistent && ordered ? 'Dates in one format, newest job first' : !consistent ? 'Dates use mixed formats' : 'Jobs are not newest-first' });
  const noState = jobs.filter((e) => /^[^,]+,\s*(?:United States|USA|US)$/i.test(e.location.trim()));
  if (noState.length) {
    checks.push({ id: 'city_state', status: 'warn', label: `${noState.length} job${noState.length > 1 ? 's' : ''} list the country instead of the state`, detail: `“${noState[0]!.location}”: write it as “City, ST” (for example “Boston, MA”) in your master resume.` });
  }
  if (req) checks.push({ id: 'years', status: yearsOk ? 'pass' : 'warn', label: `${years}+ years shown; the job asks for ${req}+` });

  const hasLoc = /[A-Za-z]+,\s*[A-Za-z]{2,}/.test(doc.location) || /remote/i.test(doc.location);
  const sectionsPresent = [doc.summary, doc.skills.length, jobs.length, doc.education.length].filter(Boolean).length;
  const secScore = (doc.name ? 1 : 0) + (doc.email ? 2 : 0) + (doc.phone ? 2 : 0) + (hasLoc ? 2 : 0) + 0.75 * sectionsPresent;
  checks.push({
    id: 'contact',
    status: doc.name && doc.email && doc.phone && hasLoc ? 'pass' : 'warn',
    label: doc.name && doc.email && doc.phone && hasLoc ? 'Name, email, phone and city in the body text' : `Missing contact details: ${[!doc.email && 'email', !doc.phone && 'phone', !hasLoc && 'city/state'].filter(Boolean).join(', ')}`,
  });
  checks.push({ id: 'sections', status: sectionsPresent === 4 ? 'pass' : 'warn', label: sectionsPresent === 4 ? 'Summary, Skills, Experience and Education sections' : 'A standard section is missing' });

  const bullets = jobs.flatMap((e) => e.bullets);
  const firstWord = (b: string) => b.trim().split(/\s+/)[0]!.toLowerCase().replace(/[^a-z]/g, '');
  const verbShare = bullets.length ? bullets.filter((b) => ACTION_VERBS.has(firstWord(b)) && !WEAK_STARTS.test(b)).length / bullets.length : 0;
  const metricShare = bullets.length ? bullets.filter((b) => METRIC.test(b)).length / bullets.length : 0;
  const goodLength = bullets.length ? bullets.filter((b) => {
    const w = wordCount(b);
    return w >= 8 && w <= 40;
  }).length / bullets.length : 0;
  const body = [doc.summary, ...bullets].join('\n');
  const pronouns = PRONOUNS.test(body);
  const cliche = body.match(RESUME_CLICHES)?.[0];
  const words = wordCount([doc.headline, doc.summary, doc.skills.join(' '), ...bullets, ...jobs.map((e) => `${e.title} ${e.company} ${e.location} ${(e.technologies ?? []).join(' ')}`)].join(' '));
  const page = ctx.pageTarget ?? ctx.plan.pageTarget;
  const lengthOk = page === 'one_page' ? words >= 280 && words <= 720 : page === 'two_pages' ? words >= 380 && words <= 1200 : words >= 280;
  const writeScore = 3 * Math.min(1, verbShare / 0.8) + 2 * Math.min(1, metricShare / 0.3) + 2 * Math.min(1, goodLength / 0.85) + (pronouns ? 0 : 1) + (cliche ? 0 : 1) + (lengthOk ? 1 : 0);
  checks.push({ id: 'verbs', status: verbShare >= 0.8 ? 'pass' : 'warn', label: `${Math.round(verbShare * 100)}% of bullets start with an action verb` });
  checks.push({
    id: 'metrics',
    status: metricShare >= 0.3 ? 'pass' : 'warn',
    label: `${bullets.filter((b) => METRIC.test(b)).length} of ${bullets.length} bullets show a number or result`,
    detail: metricShare >= 0.3 ? undefined : 'Add real numbers (users, latency, %, $) to your master resume where you have them — ApplyFlow never invents them.',
  });
  if (pronouns) checks.push({ id: 'pronouns', status: 'warn', label: 'Uses “I/my/we” — resumes read better without pronouns' });
  if (cliche) checks.push({ id: 'cliches', status: 'warn', label: `Generic phrase “${cliche}”` });
  checks.push({ id: 'length', status: lengthOk ? 'pass' : 'warn', label: `About ${words} words${page === 'two_pages' ? ' (target 2 pages)' : page === 'one_page' ? ' (target 1 page)' : ''}` });

  const soft = results.filter((r) => r.kind === 'soft');
  const softShare = soft.length ? soft.filter((r) => r.found !== 'missing').length / soft.length : 1;
  const edu = results.filter((r) => r.kind === 'education');
  const eduOk = edu.length ? edu.filter((r) => r.found !== 'missing').length / edu.length : 1;
  const seScore = 2 * softShare + 3 * eduOk;
  if (edu.length) checks.push({ id: 'education', status: eduOk === 1 ? 'pass' : 'warn', label: eduOk === 1 ? 'Degree requirement shown' : `Degree keywords missing: ${edu.filter((r) => r.found === 'missing').map((r) => r.term).join(', ')}` });

  const fmt = ctx.format;
  let fmtScore = 0;
  if (fmt) {
    fmtScore = 3 + (fmt.bodySize >= 10 && fmt.bodySize <= 12 ? 1 : 0) + (ctx.parse ? (ctx.parse.ok ? 1 : 0) : 1);
    checks.push({ id: 'format', status: 'pass', label: `ATS-safe layout: ${FONT_NAMES[fmt.font]} ${fmt.bodySize} pt, one column, no tables or images` });
    if (ctx.parse) {
      checks.push({
        id: 'parse',
        status: ctx.parse.ok ? 'pass' : 'fail',
        label: ctx.parse.ok
          ? `Parse test: an ATS-style reader found your name, email, phone, ${ctx.parse.jobsFound}/${ctx.parse.jobsExpected} jobs and every word intact`
          : 'Parse test found problems',
        detail: ctx.parse.ok ? undefined : ctx.parse.problems.join(' '),
      });
    }
  }

  const categories: AtsCategory[] = [
    { key: 'keywords', label: 'Job keywords', score: round1(kwScore), max: 45, applicable: true, detail: `${foundHard.length} of ${hard.length} found` },
    { key: 'title', label: 'Job title match', score: round1(titleScore), max: 10, applicable: Boolean(titleKw), detail: titleKw ? titleKw.term : '' },
    { key: 'experience', label: 'Experience & dates', score: round1(expScore), max: 15, applicable: true, detail: `${jobs.length} jobs, ${years}+ years` },
    { key: 'sections', label: 'Sections & contact', score: round1(Math.min(10, secScore)), max: 10, applicable: true, detail: '' },
    { key: 'writing', label: 'Writing', score: round1(writeScore), max: 10, applicable: true, detail: `${Math.round(verbShare * 100)}% action verbs` },
    { key: 'soft_education', label: 'Soft skills & education', score: round1(seScore), max: 5, applicable: true, detail: '' },
    { key: 'format', label: 'File format', score: round1(fmtScore), max: 5, applicable: Boolean(fmt), detail: fmt ? FONT_NAMES[fmt.font] : 'Not checked for your original file' },
  ];
  const app = categories.filter((c) => c.applicable);
  const maxTotal = app.reduce((n, c) => n + c.max, 0);
  const score = Math.round((app.reduce((n, c) => n + c.score, 0) / maxTotal) * 100);

  const reachKw = 45 * (supportedW / totalW);
  const reachTitle = !titleKw ? 0 : titleKw.support === 'supported' ? 10 : titleKw.support === 'related' ? 4 : 2;
  const reachExp = 5 + 4 + 2 * located + 2 + (yearsOk ? 2 : req ? 2 * Math.min(1, years / req) : 2);
  const reachSec = (doc.name ? 1 : 0) + (doc.email ? 2 : 0) + (doc.phone ? 2 : 0) + (hasLoc ? 2 : 0) + 3;
  const softSupported = soft.length ? soft.filter((r) => r.support === 'supported').length / soft.length : 1;
  const eduSupported = edu.length ? edu.filter((r) => r.support === 'supported').length / edu.length : 1;
  const reachSE = 2 * softSupported + 3 * eduSupported;
  const reachParts = [reachKw, titleKw ? reachTitle : 0, reachExp, reachSec, 10 - 2 * (1 - Math.min(1, metricShare / 0.3)), reachSE, fmt ? 5 : 0];
  const reachable = Math.max(score, Math.round((reachParts.reduce((a, b) => a + b, 0) / maxTotal) * 100));

  return {
    score,
    reachable,
    band: score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 55 ? 'fair' : 'low',
    categories,
    keywords: results,
    checks,
    computedFor: ctx.computedFor,
    disclaimer: ATS_DISCLAIMER,
    computedAt: nowIso(),
  };
}

export const FONT_NAMES: Record<ResumeFormat['font'], string> = {
  calibri: 'Calibri',
  arial: 'Arial',
  helvetica: 'Helvetica',
  times: 'Times New Roman',
  cambria: 'Cambria',
};
