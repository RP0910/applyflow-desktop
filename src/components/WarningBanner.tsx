import type { ReactNode } from 'react';
import { Icon } from './Icon';

export type BannerTone = 'critical' | 'warning' | 'info' | 'success';

const LABEL: Record<BannerTone, string> = { critical: 'Blocking issue', warning: 'Warning', info: 'Note', success: 'Done' };
const ICON = { critical: 'stop', warning: 'alert', info: 'info', success: 'check' } as const;

/** Status is conveyed by an icon and a visually hidden label as well as color. */
export function WarningBanner({ tone, title, children, actions, live = false }: { tone: BannerTone; title?: string; children?: ReactNode; actions?: ReactNode; live?: boolean }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'critical' && live ? 'alert' : live ? 'status' : undefined}>
      <Icon name={ICON[tone]} />
      <div>
        <span className="sr-only">{LABEL[tone]}: </span>
        {title ? <div className="banner-title">{title}</div> : null}
        {children ? <div>{children}</div> : null}
        {actions ? <div className="banner-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
