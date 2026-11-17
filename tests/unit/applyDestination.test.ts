import { describe, expect, it } from 'vitest';
import {
  applyUrlScore,
  isJobBoardSyndicationUrl,
  pickEmployerApplyUrl,
  shouldAvoidDirectNavigate,
  unexpectedSyndicationDestination,
} from '@/services/platforms/applyDestination';

describe('pickEmployerApplyUrl', () => {
  it('prefers Greenhouse applyLink over a LinkedIn JobPosting.url mirror', () => {
    const gh = 'https://job-boards.greenhouse.io/embed/job_app?for=venncity&token=4755173005&jr_id=6afcbc8ce0cdcfc91142f269';
    const li = 'https://www.linkedin.com/jobs/view/4755173005';
    expect(pickEmployerApplyUrl(gh, li)).toBe(gh);
    expect(pickEmployerApplyUrl(li, gh)).toBe(gh);
    expect(applyUrlScore(gh)).toBeGreaterThan(applyUrlScore(li));
  });

  it('keeps LinkedIn when it is the only apply destination', () => {
    const li = 'https://www.linkedin.com/jobs/view/3999999999';
    expect(pickEmployerApplyUrl(li, null)).toBe(li);
    expect(isJobBoardSyndicationUrl(li)).toBe(true);
  });

  it('avoids direct-navigating to syndication when a better employer URL exists', () => {
    const gh = 'https://boards.greenhouse.io/acme/jobs/1';
    const li = 'https://www.linkedin.com/jobs/view/1';
    expect(shouldAvoidDirectNavigate(li, gh)).toBe(true);
    expect(shouldAvoidDirectNavigate(gh)).toBe(false);
    expect(shouldAvoidDirectNavigate(li)).toBe(true);
  });

  it('flags unexpected syndication landings when the expected apply URL is an ATS', () => {
    const gh = 'https://job-boards.greenhouse.io/embed/job_app?for=venncity&token=1';
    expect(unexpectedSyndicationDestination('https://www.linkedin.com/authwall?trk=bf', gh)).toBe(true);
    expect(unexpectedSyndicationDestination(gh, gh)).toBe(false);
    expect(unexpectedSyndicationDestination('https://www.linkedin.com/authwall', 'https://www.linkedin.com/jobs/view/1')).toBe(false);
  });
});
