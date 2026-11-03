import type { HistoryController } from '@/hooks/useHistory';
import type { SettingsController } from '@/hooks/useSettings';
import { HistoryList } from '@/components/HistoryTable';
import { SettingsForm } from '@/components/SettingsForm';
import { Icon } from '@/components/Icon';

/** Desktop: switch the main window to that section. */
export const navigateListeners = new Set<(section: string) => void>();

export function openWorkspace(section: 'library' | 'profile' | 'history' | 'settings' | 'privacy'): void {
  if (navigateListeners.size) {
    navigateListeners.forEach((l) => l(section));
    return;
  }
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime?.getURL) void chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#${section}`) });
  else window.open(`options.html#${section}`, '_blank', 'noopener');
}

export function HistoryTab({ h }: { h: HistoryController }) {
  return <HistoryList h={h} onOpenDashboard={() => openWorkspace('history')} />;
}

export function SettingsTab({ ctl }: { ctl: SettingsController }) {
  return (
    <div className="stack">
      <div className="row">
        <button type="button" className="btn btn-sm" onClick={() => openWorkspace('library')}>
          <Icon name="doc" size={14} /> Work history and verified facts
        </button>
        <button type="button" className="btn btn-sm" onClick={() => openWorkspace('profile')}>
          <Icon name="user" size={14} /> Profile and saved answers
        </button>
      </div>
      <SettingsForm ctl={ctl} compact />
    </div>
  );
}
