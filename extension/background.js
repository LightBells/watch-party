class WatchPartyBackground {
    constructor() {
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        chrome.runtime.onInstalled.addListener(() => {
            console.log('Watch Party extension installed');
        });
        
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && this.isSupportedSite(tab.url)) {
                chrome.tabs.sendMessage(tabId, {
                    action: 'pageLoaded',
                    url: tab.url
                }).catch(() => {
                    // Content script not ready yet, ignore
                });
            }
        });
        
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true;
        });
        
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local') {
                this.handleStorageChange(changes);
            }
        });
    }
    
    isSupportedSite(url) {
        if (!url) return false;
        
        const supportedSites = [
            'amazon.co.jp/gp/video',
            'animestore.docomo.ne.jp',
            'localhost:3000'
        ];
        
        return supportedSites.some(site => url.includes(site));
    }
    
    handleMessage(request, sender, sendResponse) {
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
                this.notifyContentScript(request.data, sender);
                break;
                
            default:
                sendResponse({ error: 'Unknown action' });
        }
    }
    
    async getRoomData(sendResponse) {
        try {
            const result = await chrome.storage.local.get(['roomId', 'token', 'userId']);
            sendResponse({ success: true, data: result });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    }
    
    async setRoomData(data, sendResponse) {
        try {
            await chrome.storage.local.set(data);
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    }
    
    async clearRoomData(sendResponse) {
        try {
            await chrome.storage.local.remove(['roomId', 'token', 'userId']);
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    }
    
    async notifyContentScript(data, sender) {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            
            for (const tab of tabs) {
                if (this.isSupportedSite(tab.url)) {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'roomDataChanged',
                        data: data
                    }).catch(() => {
                        // Content script not ready, ignore
                    });
                }
            }
        } catch (error) {
            console.error('Failed to notify content script:', error);
        }
    }
    
    handleStorageChange(changes) {
        if (changes.roomId || changes.token || changes.userId) {
            this.notifyAllContentScripts({
                roomId: changes.roomId?.newValue,
                token: changes.token?.newValue,
                userId: changes.userId?.newValue
            });
        }
    }
    
    async notifyAllContentScripts(data) {
        try {
            const tabs = await chrome.tabs.query({});
            
            for (const tab of tabs) {
                if (this.isSupportedSite(tab.url)) {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'roomDataChanged',
                        data: data
                    }).catch(() => {
                        // Content script not ready, ignore
                    });
                }
            }
        } catch (error) {
            console.error('Failed to notify all content scripts:', error);
        }
    }
}

new WatchPartyBackground();