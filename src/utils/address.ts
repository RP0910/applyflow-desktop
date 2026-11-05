import type { CareerProfile } from '@/types';

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

export function withSyncedLocation<T extends Pick<CareerProfile, 'city' | 'state' | 'postalCode' | 'country' | 'location'>>(p: T): T {
  const line = formatLocationLine(p);
  return line && line !== p.location ? { ...p, location: line } : p;
}

export function formatFullAddress(p: Pick<CareerProfile, 'streetAddress' | 'addressLine2' | 'city' | 'state' | 'postalCode' | 'country' | 'location'>): string {
  const line1 = [p.streetAddress.trim(), p.addressLine2.trim()].filter(Boolean).join(', ');
  const rest = formatLocationLine(p);
  return [line1, rest].filter(Boolean).join(', ');
}
