type RoomData = {
  roomId?: string;
  token?: string;
  userId?: string;
};

type BackgroundRequest =
  | {action: 'getRoomData'}
  | {action: 'setRoomData'; data: RoomData}
  | {action: 'clearRoomData'}
  | {action: 'notifyContentScript'; data: RoomData}
  | {action: 'getTabId'};

type BackgroundResponse =
  | {success: true; data?: RoomData; tabId?: number | null}
  | {success: false; error: string};

class WatchPartyBackground {
  private readonly isDevelopment = !('update_url' in chrome.runtime.getManifest());
  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    chrome.runtime.onInstalled.addListener(() => {
      // eslint-disable-next-line no-console
      console.log('Watch Party extension installed');
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && this.isSupportedSite(tab.url)) {
        chrome.tabs
          .sendMessage(tabId, {
            action: 'pageLoaded',
            url: tab.url,
          })
          .catch(() => {
            // Content script not ready yet, ignore
          });
      }
    });

    chrome.runtime.onMessage.addListener((request: BackgroundRequest, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true;
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local') {
        this.handleStorageChange(changes as Record<string, chrome.storage.StorageChange>);
      }
    });
  }

  private isSupportedSite(url?: string | null): boolean {
    if (!url) return false;

    const supportedPatterns = [
      /https?:\/\/www\.amazon\.co\.jp\/gp\/video\//,
      /https?:\/\/www\.amazon\.co\.jp\/\-\/[^/]+\/gp\/video\//,
      /animestore\.docomo\.ne\.jp\/animestore\/sc_d_pc/,
      /localhost:3000/,
    ];

    return supportedPatterns.some((pattern) => pattern.test(url));
  }

  private handleMessage(request: BackgroundRequest, sender: chrome.runtime.MessageSender, sendResponse: (response: BackgroundResponse) => void): void {
    switch (request.action) {
      case 'getRoomData':
        this.getRoomData(sendResponse);
        break;

      case 'setRoomData':
        this.setRoomData(request.data, sendResponse);
        break;

      case 'clearRoomData':
        this.clearRoomData(sendResponse);
        break;

      case 'notifyContentScript':
        this.notifyContentScript(request.data);
        sendResponse({success: true});
        break;

      case 'getTabId':
        sendResponse({success: true, tabId: sender.tab?.id ?? null});
        break;

      default:
        sendResponse({success: false, error: 'Unknown action'});
    }
  }

  private async getRoomData(sendResponse: (response: BackgroundResponse) => void): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['roomId', 'token', 'userId']);
      sendResponse({success: true, data: result as RoomData});
    } catch (error) {
      sendResponse({success: false, error: error instanceof Error ? error.message : String(error)});
    }
  }

  private async setRoomData(data: RoomData, sendResponse: (response: BackgroundResponse) => void): Promise<void> {
    try {
      await chrome.storage.local.set(data);
      sendResponse({success: true});
    } catch (error) {
      sendResponse({success: false, error: error instanceof Error ? error.message : String(error)});
    }
  }

  private async clearRoomData(sendResponse: (response: BackgroundResponse) => void): Promise<void> {
    try {
      await chrome.storage.local.remove(['roomId', 'token', 'userId']);
      sendResponse({success: true});
    } catch (error) {
      sendResponse({success: false, error: error instanceof Error ? error.message : String(error)});
    }
  }

  private async notifyContentScript(data: RoomData): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({active: true, currentWindow: true});

      await Promise.all(
        tabs.map(async (tab) => {
          if (!tab.id || !this.isSupportedSite(tab.url)) {
            return;
          }

          try {
            await chrome.tabs.sendMessage(tab.id, {
              action: 'roomDataChanged',
              data,
            });
          } catch (error) {
            // Content script not ready, ignore
            if (this.isDevelopment) {
              // eslint-disable-next-line no-console
              console.warn('Content script not ready', error);
            }
          }
        }),
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to notify content script:', error);
    }
  }

  private async handleStorageChange(changes: Record<string, chrome.storage.StorageChange>): Promise<void> {
    if (changes.roomId || changes.token || changes.userId) {
      await this.notifyAllContentScripts({
        roomId: changes.roomId?.newValue,
        token: changes.token?.newValue,
        userId: changes.userId?.newValue,
      });
    }
  }

  private async notifyAllContentScripts(data: RoomData): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({});

      await Promise.all(
        tabs.map(async (tab) => {
          if (!tab.id || !this.isSupportedSite(tab.url)) {
            return;
          }

          try {
            await chrome.tabs.sendMessage(tab.id, {
              action: 'roomDataChanged',
              data,
            });
          } catch (error) {
            // Content script not ready, ignore
            if (this.isDevelopment) {
              // eslint-disable-next-line no-console
              console.warn('Content script not ready for tab', tab.id, error);
            }
          }
        }),
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to notify all content scripts:', error);
    }
  }
}

new WatchPartyBackground();
