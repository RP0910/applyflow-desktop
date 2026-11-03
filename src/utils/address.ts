import type { CareerProfile } from '@/types';

/** Build the short resume location line from structured address parts. */
export function formatLocationLine(p: Pick<CareerProfile, 'city' | 'state' | 'postalCode' | 'country' | 'location'>): string {
  const cityState = [p.city.trim(), p.state.trim()].filter(Boolean).join(', ');
  const withZip = [cityState, p.postalCode.trim()].filter(Boolean).join(' ').trim();
  if (withZip) {
    const country = p.country.trim();
    if (country && !/^(us|usa|united states)$/i.test(country)) return `${withZip}, ${country}`;
    return withZip;
  }
  return p.location.trim();
}

/** Keep `location` aligned with structured fields before saving the profile. */
export function withSyncedLocation<T extends Pick<CareerProfile, 'city' | 'state' | 'postalCode' | 'country' | 'location'>>(p: T): T {
  const line = formatLocationLine(p);
  return line && line !== p.location ? { ...p, location: line } : p;
}

/** Full mailing address as a single line (street through country). */
export function formatFullAddress(p: Pick<CareerProfile, 'streetAddress' | 'addressLine2' | 'city' | 'state' | 'postalCode' | 'country' | 'location'>): string {
  const line1 = [p.streetAddress.trim(), p.addressLine2.trim()].filter(Boolean).join(', ');
  const rest = formatLocationLine(p);
  return [line1, rest].filter(Boolean).join(', ');
}
