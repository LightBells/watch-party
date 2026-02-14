import type {WatchPartyContent} from '../watchPartyContent';
import type {ChatDisplayMode} from '../types';

export type StorageFeature = {
  getStoredUsername(this: WatchPartyContent): Promise<string | null>;
  loadChatDisplayMode(this: WatchPartyContent): Promise<ChatDisplayMode>;
  saveRoomData(
    this: WatchPartyContent,
    roomId: string,
    token: string,
    userId: string,
    username: string,
    isHost: boolean,
  ): Promise<void>;
  removeRoomData(this: WatchPartyContent): Promise<void>;
  persistRoomState(this: WatchPartyContent): Promise<void>;
  generateRoomId(this: WatchPartyContent): string;
  restoreRoomState(this: WatchPartyContent): Promise<void>;
  loadStoredData(this: WatchPartyContent): Promise<string | null>;
};

export const storageFeature: StorageFeature = {
  async getStoredUsername(this: WatchPartyContent): Promise<string | null> {
    try {
      const result = (await chrome.storage.local.get(['globalUsername'])) as {globalUsername?: string};
      return result.globalUsername ?? null;
    } catch (error) {
      this.log('Failed to load username', error);
      return null;
    }
  },

  async loadChatDisplayMode(this: WatchPartyContent): Promise<ChatDisplayMode> {
    try {
      const result = (await chrome.storage.local.get(['chatDisplayMode'])) as {
        chatDisplayMode?: string;
      };
      if (result.chatDisplayMode === 'sidebar' || result.chatDisplayMode === 'overlay') {
        return result.chatDisplayMode;
      }
    } catch (error) {
      this.log('Failed to load chat display mode', error);
    }

    return 'overlay';
  },

  async saveRoomData(
    this: WatchPartyContent,
    roomId: string,
    token: string,
    userId: string,
    username: string,
    isHost: boolean,
  ): Promise<void> {
    const tabId = await this.resolveTabId();
    const storageKey = `tab_${tabId}`;

    await chrome.storage.local.set({
      [`${storageKey}_roomId`]: roomId,
      [`${storageKey}_token`]: token,
      [`${storageKey}_userId`]: userId,
      [`${storageKey}_username`]: username,
      [`${storageKey}_isHost`]: isHost,
    });
  },

  async removeRoomData(this: WatchPartyContent): Promise<void> {
    const tabId = await this.resolveTabId();
    const storageKey = `tab_${tabId}`;

    await chrome.storage.local.remove([
      `${storageKey}_roomId`,
      `${storageKey}_token`,
      `${storageKey}_userId`,
      `${storageKey}_username`,
      `${storageKey}_isHost`,
    ]);
  },

  async persistRoomState(this: WatchPartyContent): Promise<void> {
    if (!this.currentRoom || !this.authToken || !this.currentUser) {
      return;
    }

    const username = this.username ?? '';
    await this.saveRoomData(this.currentRoom, this.authToken, this.currentUser, username, this.isHost);
  },

  generateRoomId(this: WatchPartyContent): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  },

  async restoreRoomState(this: WatchPartyContent): Promise<void> {
    const token = await this.loadStoredData();
    if (!token || !this.currentRoom || !this.currentUser) {
      this.updateStatus('未接続');
      this.showRoomSetup();
      return;
    }

    const roomIdInput = this.getInput('wp-room-id');
    if (roomIdInput) {
      roomIdInput.value = this.currentRoom;
    }

    if (this.isHost) {
      const shareUrl = this.ensureShareLink(this.currentRoom);
      this.currentRoomUrl = shareUrl;
      this.lastBroadcastUrl = null;
    }

    this.updateHostHeartbeat();

    await this.connectToRoom(token);
    this.updateShareControls(true);
  },

  async loadStoredData(this: WatchPartyContent): Promise<string | null> {
    const tabId = await this.resolveTabId();
    const storageKey = `tab_${tabId}`;

    const result = (await chrome.storage.local.get([
      `${storageKey}_roomId`,
      `${storageKey}_token`,
      `${storageKey}_userId`,
      `${storageKey}_username`,
      `${storageKey}_isHost`,
    ])) as Record<string, unknown>;

    const roomId = result[`${storageKey}_roomId`] as string | undefined;
    const token = result[`${storageKey}_token`] as string | undefined;
    const userId = result[`${storageKey}_userId`] as string | undefined;
    const username = result[`${storageKey}_username`] as string | undefined;
    const isHostRaw = result[`${storageKey}_isHost`] as boolean | undefined;

    if (roomId && token && userId) {
      this.currentRoom = roomId;
      this.currentUser = userId;
      this.username = username ?? null;
      this.isHost = isHostRaw ?? this.isHost;
      this.awaitingInitialState = !this.isHost;
      this.initialVideoStateApplied = this.isHost;
      if (!this.isHost) {
        this.enforcePauseWhileAwaiting();
      }
      this.authToken = token;
      return token;
    }

    return null;
  },
};
