
export interface NavigationHistory {
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  goToIndex(index: number): void;
  getAllEntries(): { url: string }[];
  getActiveIndex(): number;
}

export interface WindowOpenDetails {
  url: string;
  disposition: string;
  features?: string;
}

export interface PageController {
  readonly id: number;
  navigationHistory: NavigationHistory;
  loadURL(url: string): Promise<void>;
  reload(): void;
  stop(): void;
  getURL(): string;
  getTitle(): string;
  isLoading(): boolean;
  isDestroyed(): boolean;
  send(channel: string, payload?: unknown): void;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  setWindowOpenHandler(handler: (details: WindowOpenDetails) => { action: 'allow' | 'deny' }): void;
  openDevTools(opts?: unknown): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
}
