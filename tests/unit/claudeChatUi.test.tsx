import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsForm } from '@/components/SettingsForm';
import { ClaudeChatStatus } from '@/desktop/ClaudeChatStatus';
import type { SettingsController } from '@/hooks/useSettings';
import { DEFAULT_SETTINGS } from '@/types';

function controller(patch: Partial<SettingsController> = {}): { ctl: SettingsController; update: ReturnType<typeof vi.fn> } {
  const update = vi.fn(async () => undefined);
  const ctl = {
    settings: DEFAULT_SETTINGS,
    loaded: true,
    update,
    hasKey: false,
    masked: '',
    keyStatus: null,
    setKeyStatus: vi.fn(),
    busy: null,
    saveKey: vi.fn(async () => true),
    removeKey: vi.fn(async () => undefined),
    testKey: vi.fn(async () => undefined),
    refreshModels: vi.fn(async () => undefined),
    addManualModel: vi.fn(async () => undefined),
    resetModels: vi.fn(async () => undefined),
    ...patch,
  } as unknown as SettingsController;
  return { ctl, update };
}

describe('Claude.ai chat controls', () => {
  it('offers Claude API and Claude.ai Chat on the settings page', async () => {
    const { ctl, update } = controller();
    render(<SettingsForm ctl={ctl} />);
    expect(screen.getByRole('radio', { name: /Claude API/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /Claude\.ai Chat/ }));
    expect(update).toHaveBeenCalledWith({ resumeGenerationMethod: 'chat', engine: 'claude' });
  });

  it('shows a signed-out indicator outside the desktop app', () => {
    render(<ClaudeChatStatus />);
    expect(screen.getByRole('button', { name: /Claude\.ai Chat, Sign in/ })).toBeInTheDocument();
  });
});
