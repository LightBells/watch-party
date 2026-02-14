import type {WatchPartyContent} from '../watchPartyContent';

export type CoreFeature = {
  init(this: WatchPartyContent): Promise<void>;
  loadDebugMode(this: WatchPartyContent): Promise<void>;
  delay(this: WatchPartyContent, ms: number): Promise<void>;
  recordUserInteraction(this: WatchPartyContent): void;
  hasRecentUserInteraction(this: WatchPartyContent, windowMs?: number): boolean;
  setupInteractionHandlers(this: WatchPartyContent): void;
  setupMessageListener(this: WatchPartyContent): void;
  isConnectedToRoom(this: WatchPartyContent): boolean;
  shouldEmitPlaybackEvents(this: WatchPartyContent): boolean;
  log(this: WatchPartyContent, ...args: unknown[]): void;
  debugNavigation(this: WatchPartyContent, event: string, context?: Record<string, unknown>): void;
  resolveTabId(this: WatchPartyContent): Promise<number>;
  getInput(this: WatchPartyContent, id: string): HTMLInputElement | null;
};

export const coreFeature: CoreFeature = {
  async init(this: WatchPartyContent): Promise<void> {
    await this.loadDebugMode();
    await this.detectVideoElement();
    this.createWatchPartyUI();
    this.setupInteractionHandlers();
    this.setupMessageListener();
    this.monitorUrlChanges();
    await this.restoreRoomState();
    await this.handleDeepLink();
    this.awaitingInitialState = Boolean(this.currentRoom && !this.isHost && !this.initialVideoStateApplied);
  },

  async loadDebugMode(this: WatchPartyContent): Promise<void> {
    try {
      const result = (await chrome.storage.local.get(['debugMode'])) as {debugMode?: boolean};
      this.debugMode = Boolean(result.debugMode);
    } catch (error) {
      this.debugMode = false;
    }
  },

  delay(this: WatchPartyContent, ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  },

  recordUserInteraction(this: WatchPartyContent): void {
    this.lastUserInteractionAt = Date.now();
  },

  hasRecentUserInteraction(this: WatchPartyContent, windowMs = 2000): boolean {
    if (!this.lastUserInteractionAt) {
      return false;
    }

    return Date.now() - this.lastUserInteractionAt <= windowMs;
  },

  setupInteractionHandlers(this: WatchPartyContent): void {
    const attemptFlush = (): void => {
      if (!this.pendingVideoState || this.syncInProgress) {
        return;
      }
      this.log('🖱️ User interaction detected; retrying pending video sync');
      this.flushPendingVideoState();
    };

    document.addEventListener('click', attemptFlush, true);
    document.addEventListener('keydown', attemptFlush, true);
  },

  setupMessageListener(this: WatchPartyContent): void {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request.action === 'getConnectionStatus') {
        sendResponse({
          connected: Boolean(this.socket?.connected),
          roomId: this.currentRoom,
          userId: this.currentUser,
          isHost: this.isHost,
        });
      }
      return true;
    });
  },

  isConnectedToRoom(this: WatchPartyContent): boolean {
    return Boolean(this.currentRoom && this.socket?.connected);
  },

  shouldEmitPlaybackEvents(this: WatchPartyContent): boolean {
    if (!this.currentRoom || !this.socket?.connected) {
      this.log('🚫 Suppressing playback event (not connected to room)');
      return false;
    }

    if (this.isHost) {
      return true;
    }

    if (this.awaitingInitialState) {
      this.log('🚫 Suppressing playback event (awaiting host state)');
      return false;
    }

    if (!this.initialVideoStateApplied) {
      this.log('🚫 Suppressing playback event (initial state not applied)');
      return false;
    }

    return true;
  },

  log(this: WatchPartyContent, ...args: unknown[]): void {
    if (this.debugMode) {
      // eslint-disable-next-line no-console
      console.log(...args);
    }
  },

  debugNavigation(
    this: WatchPartyContent,
    event: string,
    context: Record<string, unknown> = {},
  ): void {
    const payload = {
      ...context,
      timestamp: new Date().toISOString(),
    };

    // eslint-disable-next-line no-console
    console.info(`[WatchParty][Nav] ${event}`, payload);
    this.log(`[Nav] ${event}`, payload);
  },

  async resolveTabId(this: WatchPartyContent): Promise<number> {
    if (this.tabId) {
      return this.tabId;
    }

    try {
      const response = (await chrome.runtime.sendMessage({action: 'getTabId'})) as
        | {tabId?: number | null}
        | undefined;

      if (response && typeof response.tabId === 'number') {
        this.tabId = response.tabId;
        return this.tabId;
      }
    } catch (error) {
      this.log('Failed to resolve tab id via background:', error);
    }

    this.tabId = Date.now();
    return this.tabId;
  },

  getInput(this: WatchPartyContent, id: string): HTMLInputElement | null {
    const element = document.getElementById(id);
    if (!element || !(element instanceof HTMLInputElement)) {
      return null;
    }

    return element;
  },
};
