import type { BrowserWindow, WebContentsView } from 'electron';
import type { PageController } from './pageController';

export interface PaneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserSurface {
  webContents: PageController;
  mount(): void;
  setBounds(bounds: PaneBounds): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

export function electronSurface(window: () => BrowserWindow | null, view: WebContentsView): BrowserSurface {
  return {
    webContents: view.webContents as unknown as PageController,
    mount() {
      window()?.contentView.addChildView(view);
    },
    setBounds(bounds) {
      view.setBounds(bounds);
    },
    setVisible(visible) {
      view.setVisible(visible);
    },
    destroy() {
      window()?.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close();
    },
  };
}
