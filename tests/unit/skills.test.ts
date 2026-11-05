import { describe, expect, it } from 'vitest';
import { findSkills, mentionsSkill, canonicalSkill } from '@/services/skills/extract';
import { classifySkills, mergeClaudeEvidence, rankByJobEmphasis } from '@/services/matching/evidence';
import { buildMasterResume, allowedCorpus } from '@/services/resume/facts';
import type { MasterResume } from '@/types';
import { exampleResume } from '../helpers';

describe('skill matching', () => {
  it('respects word boundaries for tricky names', () => {
    expect(mentionsSkill('Built services in JavaScript', 'Java')).toBe(false);
    expect(mentionsSkill('Built services in Java and JavaScript', 'Java')).toBe(true);
    expect(mentionsSkill('Led our go-to-market plan', 'Go')).toBe(false);
    expect(mentionsSkill('Wrote services in Go and Python', 'Go')).toBe(true);
    expect(mentionsSkill('Modern C++ and C# services', 'C++')).toBe(true);
    expect(mentionsSkill('Modern C++ and C# services', 'C#')).toBe(true);
    expect(mentionsSkill('Set up CI/CD with GitHub Actions', 'CI/CD')).toBe(true);
    expect(mentionsSkill('The rest of the team', 'REST APIs')).toBe(false);
  });

  it('maps aliases to canonical names', () => {
    expect(canonicalSkill('k8s')).toBe('Kubernetes');
    expect(canonicalSkill('amazon web services')).toBe('AWS');
    expect(findSkills('We use k8s, EKS and RAG pipelines')).toEqual(['Kubernetes', 'Amazon EKS', 'Retrieval-Augmented Generation']);
  });

  it('ranks skills by how much the job emphasizes them', () => {
    expect(rankByJobEmphasis(['Python', 'AWS'], 'AWS, more AWS, and some Python. AWS again.')).toEqual(['AWS', 'Python']);
  });
});

describe('skill evidence classification', () => {
  const base = exampleResume();

  function withFacts(mut: (r: MasterResume) => void): MasterResume {
    const r = structuredClone(base);
    mut(r);
    return r;
  }

  it('classifies strong, partial (listed only), partial (related) and none', () => {
    const ev = classifySkills(['Kubernetes', 'Prompt Engineering', 'Snowflake', 'Databricks'], [], base);
    const by = Object.fromEntries(ev.map((e) => [e.skill, e]));
    expect(by.Kubernetes!.status).toBe('strong');
    expect(by.Kubernetes!.evidence[0]).toMatch(/Kubernetes/);
    expect(by['Prompt Engineering']!.status).toBe('partial');
    expect(by['Prompt Engineering']!.note).toMatch(/Listed in your skills/);
    expect(by.Snowflake!.status).toBe('partial');
    expect(by.Snowflake!.note).toMatch(/won’t claim Snowflake/);
    expect(by.Databricks!.status).toBe('none');
  });

  it('treats skills only found in unreviewed facts as needing confirmation', () => {
    const r = withFacts((x) => {
      x.facts.push({ id: 'f1', kind: 'skill', text: 'Rust', status: 'needs_review', source: 'user' });
    });
    expect(classifySkills(['Rust'], [], r)[0]!.status).toBe('needs_confirmation');
  });

  it('reports a conflict when the resume mentions something marked "Do not use"', () => {
    const text = base.rawText.replace('Wrote integration and unit tests', 'Wrote Scala jobs and integration and unit tests');
    const r = buildMasterResume('x', text, 'text', null);
    const target = r.facts.find((f) => f.text.includes('Scala'))!;
    target.status = 'do_not_use';
    const ev = classifySkills(['Scala'], [], r)[0]!;
    expect(ev.status).toBe('conflict');
  });

  it('never uses facts marked "Do not use" as evidence', () => {
    const r = withFacts((x) => {
      for (const f of x.facts) if (f.text.includes('Kafka')) f.status = 'do_not_use';
    });
    const ev = classifySkills(['Apache Kafka'], [], r)[0]!;
    expect(ev.status).not.toBe('strong');
  });

  it('only accepts Claude evidence that appears verbatim in the resume', () => {
    const local = classifySkills(['Databricks'], [], base);
    const merged = mergeClaudeEvidence(
      local,
      [
        { skill: 'Databricks', importance: 'required', status: 'strong', evidenceQuotes: ['Led the Databricks lakehouse rollout'] },
        { skill: 'Event streaming', importance: 'preferred', status: 'strong', evidenceQuotes: ['event-driven microservices on Kafka'] },
        { skill: 'Kotlin', importance: 'preferred', status: 'partial', evidenceQuotes: ['Kotlin services at scale'] },
      ],
      allowedCorpus(base),
    );
    expect(merged.find((e) => e.skill === 'Databricks')!.status).toBe('none');
    expect(merged.find((e) => e.skill === 'Event streaming')!.status).toBe('partial');
    expect(merged.find((e) => e.skill === 'Kotlin')!.status).toBe('needs_confirmation');
  });
});
