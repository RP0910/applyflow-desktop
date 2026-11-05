import { describe, expect, it } from 'vitest';
import { ladderRoleTitles, roleTitlesForCv } from '@/services/workflow/cvRoleTitles';

describe('cv role titles', () => {
  it('steps seniority down the career ladder from the posting title', () => {
    expect(ladderRoleTitles('Staff Backend Engineer', 3)).toEqual(['Staff Backend Engineer', 'Lead Backend Engineer', 'Senior Backend Engineer']);
  });

  it('prefers research roleTitle per period with ladder fallback', () => {
    const titles = roleTitlesForCv('Senior Platform Engineer', 2, {
      companies: [
        { periodIndex: 0, name: 'A', activeYears: 'x', techFit: 'y', hq: '', roleTitle: 'Lead Platform Engineer' },
        { periodIndex: 1, name: 'B', activeYears: 'x', techFit: 'y', hq: '', roleTitle: '' },
      ],
    });
    expect(titles[0]).toBe('Lead Platform Engineer');
    expect(titles[1]).toMatch(/Platform Engineer/i);
  });
});
