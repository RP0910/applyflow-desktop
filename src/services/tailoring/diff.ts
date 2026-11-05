import type { ParsedResume, TailoredResume } from '@/types';
import { similarity } from '@/utils/text';

export type LineStatus = 'same' | 'moved' | 'reworded' | 'added' | 'removed';

export interface DiffLine {
  text: string;
  status: LineStatus;
  original?: string;
}

export interface SectionDiff {
  section: string;
  original: DiffLine[];
  tailored: DiffLine[];
}

const n = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.]$/, '').trim();

export function diffLists(section: string, original: string[], tailored: string[]): SectionDiff {
  const usedOrig = new Set<number>();
  const tLines: DiffLine[] = tailored.map((t, ti) => {
    const exact = original.findIndex((o, oi) => !usedOrig.has(oi) && n(o) === n(t));
    if (exact >= 0) {
      usedOrig.add(exact);
      return { text: t, status: exact === ti ? 'same' : 'moved' };
    }
    let best = -1;
    let bestSim = 0;
    original.forEach((o, oi) => {
      if (usedOrig.has(oi)) return;
      const s = similarity(o, t);
      if (s > bestSim) {
        bestSim = s;
        best = oi;
      }
    });
    if (best >= 0 && bestSim >= 0.3) {
      usedOrig.add(best);
      return { text: t, status: 'reworded', original: original[best] };
    }
    return { text: t, status: 'added' };
  });
  const oLines: DiffLine[] = original.map((o, oi) => {
    if (!usedOrig.has(oi)) return { text: o, status: 'removed' };
    const t = tLines.find((l) => (l.status === 'reworded' ? l.original === o : n(l.text) === n(o)));
    return { text: o, status: t?.status === 'reworded' ? 'reworded' : t?.status === 'moved' ? 'moved' : 'same' };
  });
  return { section, original: oLines, tailored: tLines };
}

export function compareResumes(master: ParsedResume, tailored: TailoredResume): SectionDiff[] {
  const out: SectionDiff[] = [];
  out.push(diffLists('Headline', [master.headline].filter(Boolean), [tailored.headline].filter(Boolean)));
  out.push(diffLists('Summary', [master.summary].filter(Boolean), [tailored.summary].filter(Boolean)));
  out.push(diffLists('Skills', master.skills, tailored.skills));
  for (const m of master.experience) {
    const t = tailored.experience.find((e) => e.sourceId === m.id);
    out.push(diffLists(`${m.title} — ${m.company}`, m.bullets, t?.bullets ?? []));
  }
  if (master.projects.length || tailored.projects.length) {
    out.push(diffLists('Projects', master.projects.map((p) => p.name), tailored.projects.map((p) => p.name)));
  }
  return out.filter((s) => s.original.length || s.tailored.length);
}

export function changeStats(diffs: SectionDiff[]): Record<LineStatus, number> {
  const stats: Record<LineStatus, number> = { same: 0, moved: 0, reworded: 0, added: 0, removed: 0 };
  for (const d of diffs) {
    d.tailored.forEach((l) => stats[l.status]++);
    d.original.filter((l) => l.status === 'removed').forEach(() => stats.removed++);
  }
  return stats;
}
