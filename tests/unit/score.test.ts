import { describe, expect, it } from 'vitest';
import { computeMatchScore, bandFor, SCORE_DISCLAIMER, scoreMissing, scoreUnsupported, seniorityOf } from '@/services/matching/score';
import { classifySkills } from '@/services/matching/evidence';
import { analyzeJobLocally } from '@/services/analysis/localAnalyzer';
import { parsedToView } from '@/services/export/render';
import type { SkillEvidence, ValidationIssue } from '@/types';
import { exampleResume, mockJob } from '../helpers';

const NOW = new Date('2026-10-30T12:00:00');

function score(evidence?: SkillEvidence[]) {
  const resume = exampleResume();
  const job = mockJob();
  const analysis = analyzeJobLocally(job, resume);
  const ev = evidence ?? classifySkills(analysis.requiredSkills, analysis.preferredSkills, resume);
  return computeMatchScore({ resume: parsedToView(resume.parsed), job, analysis, evidence: ev, unconfirmedFacts: 0, totalFacts: resume.facts.length, computedFor: 'master', now: NOW });
}

describe('match score', () => {
  it('uses fixed, transparent weights that add up to 100', () => {
    const s = score();
    const positives = s.components.filter((c) => !c.isPenalty);
    expect(positives.map((c) => c.max)).toEqual([40, 30, 15, 10, 5]);
    expect(positives.reduce((a, c) => a + c.max, 0)).toBe(100);
    for (const c of s.components) {
      expect(c.explanation.length).toBeGreaterThan(20);
      if (!c.isPenalty) expect(c.score).toBeLessThanOrEqual(c.max);
      else expect(c.score).toBeLessThanOrEqual(0);
    }
  });

  it('is always labeled as an estimate', () => {
    const s = score();
    expect(s.disclaimer).toBe(SCORE_DISCLAIMER);
    expect(s.disclaimer).toMatch(/not an employer’s ATS score/);
  });

  it('is deterministic and scores the example resume as a strong match', () => {
    const a = score();
    const b = score();
    expect(a.total).toBe(b.total);
    expect(a.total).toBeGreaterThanOrEqual(80);
    expect(a.band).toBe('strong');
  });

  it('drops when required skills have no evidence and caps the penalty', () => {
    const ev: SkillEvidence[] = ['A', 'B', 'C', 'D', 'E', 'F'].map((s) => ({ skill: s, importance: 'required', status: 'none', evidence: [], note: '' }));
    const s = score(ev);
    const req = s.components.find((c) => c.key === 'required_skills')!;
    expect(req.score).toBe(0);
    const pen = scoreMissing(ev, { risks: [] });
    expect(pen.score).toBe(-9);
    const withRisks = scoreMissing(ev, { risks: [1, 2, 3].map((i) => ({ id: String(i), severity: 'critical', category: 'clearance', message: 'x' })) });
    expect(withRisks.score).toBe(-15);
    expect(s.total).toBeLessThan(score().total);
  });

  it('penalizes unsupported claims in a tailored resume', () => {
    const issues: ValidationIssue[] = [
      { id: '1', severity: 'critical', code: 'invented_metric', message: 'x', autoFixable: true },
      { id: '2', severity: 'warning', code: 'unsupported_skill', message: 'x', autoFixable: false },
    ];
    expect(scoreUnsupported(issues).score).toBe(-3);
    expect(scoreUnsupported([]).score).toBe(0);
  });

  it('maps totals to bands and titles to seniority', () => {
    expect([bandFor(85), bandFor(70), bandFor(55), bandFor(20)]).toEqual(['strong', 'good', 'fair', 'weak']);
    expect(seniorityOf('Senior Architect AI Engineering')).toBe('senior');
    expect(seniorityOf('Principal Software Engineer')).toBe('principal');
    expect(seniorityOf('VP of Engineering')).toBe('executive');
  });
});
