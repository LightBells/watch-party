class WatchPartyContent {
    constructor() {
        this.socket = null;
        this.videoElement = null;
        this.isHost = false;
        this.currentRoom = null;
        this.currentUser = null;
        this.syncInProgress = false;
        this.lastSyncTime = 0;
        
        this.init();
    }
    
    async init() {
        await this.detectVideoElement();
        this.setupVideoListeners();
        this.createWatchPartyUI();
        this.setupMessageListener();
        
        // 初期化時はストレージからの自動接続は行わない
        // ポップアップからの明示的な指示でのみ接続
    }
    
    
    async detectVideoElement() {
        const selectors = [
            'video[data-testid="video-player"]',
            'video.dmp-video-player',
            'video#video-player',
            'video#test-video',
            'video',
            '.video-player video'
        ];
        
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                this.videoElement = element;
                console.log('Video element found:', selector);
                return;
            }
        }
        
        setTimeout(() => this.detectVideoElement(), 1000);
    }
    
    async loadStoredData() {
        // タブIDを取得してタブ固有のデータを読み込み
        const tabId = window.location.href.includes('localhost:3000') ? 
            Math.floor(Math.random() * 1000000) : // テスト用の一意ID
            Date.now(); // 実際のサイトでは現在時刻を使用
        
        this.tabId = tabId;
        const storageKey = `tab_${tabId}`;
        
        const result = await chrome.storage.local.get([
            `${storageKey}_roomId`,
            `${storageKey}_token`,
            `${storageKey}_userId`
        ]);
        
        if (result[`${storageKey}_roomId`] && result[`${storageKey}_token`] && result[`${storageKey}_userId`]) {
            this.currentRoom = result[`${storageKey}_roomId`];
            this.currentUser = result[`${storageKey}_userId`];
            return result[`${storageKey}_token`];
        }
        return null;
    }
    
    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            switch (request.action) {
                case 'getConnectionStatus':
                    sendResponse({
                        connected: this.socket && this.socket.connected,
                        roomId: this.currentRoom,
                        userId: this.currentUser,
                        isHost: this.isHost
                    });
                    break;
                    
                case 'sendComment':
                    if (this.socket && this.socket.connected) {
                        this.socket.emit('comment', { message: request.message });
                        sendResponse({ success: true });
                    } else {
                        sendResponse({ success: false, error: 'Not connected' });
                    }
                    break;
                    
                case 'connect':
                    this.currentRoom = request.roomId;
                    this.currentUser = request.userId;
                    this.connectToRoom(request.token);
                    sendResponse({ success: true });
                    break;
                    
                case 'disconnect':
                    if (this.socket) {
                        this.socket.disconnect();
                    }
                    this.currentRoom = null;
                    this.currentUser = null;
                    this.isHost = false;
                    this.updateStatus('切断');
                    sendResponse({ success: true });
                    break;
            }
            return true; // 非同期レスポンスを有効化
        });
    }
    
    async connectToRoom(token) {
        if (!token) {
            token = await this.loadStoredData();
            if (!token) return;
        }
        
        if (this.socket) {
            this.socket.disconnect();
        }
        
        this.socket = io('http://localhost:3000', {
            auth: { token }
        });
        
        this.socket.on('connect', () => {
            console.log('Connected to room:', this.currentRoom);
            this.updateStatus('接続中');
        });
        
        this.socket.on('disconnect', () => {
            console.log('Disconnected from room');
            this.updateStatus('切断');
        });
        
        this.socket.on('room-state', (data) => {
            this.isHost = data.isHost;
            this.updateStatus(this.isHost ? 'ホスト' : 'メンバー');
            
            // ポップアップに部屋の状態を送信
            chrome.runtime.sendMessage({
                action: 'roomStateUpdate',
                data: {
                    members: data.members,
                    isHost: data.isHost
                }
            }).catch(() => {});
        });
        
        this.socket.on('play', (data) => {
            if (!this.isHost) {
                this.syncVideo(true, data.currentTime);
            }
        });
        
        this.socket.on('pause', (data) => {
            if (!this.isHost) {
                this.syncVideo(false, data.currentTime);
            }
        });
        
        this.socket.on('sync', (data) => {
            if (!this.isHost) {
                this.syncVideo(data.isPlaying, data.currentTime);
            }
        });
        
        this.socket.on('comment', (data) => {
            console.log('Received comment:', data);
            this.showComment(data.message, data.userId);
            
            // ポップアップにチャットメッセージを送信
            chrome.runtime.sendMessage({
                action: 'chatMessage',
                data: {
                    userId: data.userId,
                    message: data.message,
                    timestamp: data.timestamp
                }
            }).catch(() => {
                // ポップアップが開いていない場合は無視
            });
        });
        
        this.socket.on('user-joined', (data) => {
            chrome.runtime.sendMessage({
                action: 'chatMessage',
                data: {
                    userId: 'システム',
                    message: 'ユーザーが参加しました',
                    timestamp: data.timestamp
                }
            }).catch(() => {});
        });
        
        this.socket.on('user-left', (data) => {
            chrome.runtime.sendMessage({
                action: 'chatMessage',
                data: {
                    userId: 'システム',
                    message: 'ユーザーが退出しました',
                    timestamp: data.timestamp
                }
            }).catch(() => {});
        });
        
        this.socket.on('host-changed', (data) => {
            this.isHost = data.newHost === this.currentUser;
            this.updateStatus(this.isHost ? 'ホスト' : 'メンバー');
            
            chrome.runtime.sendMessage({
                action: 'chatMessage',
                data: {
                    userId: 'システム',
                    message: 'ホストが変更されました',
                    timestamp: data.timestamp
                }
            }).catch(() => {});
        });
    }
    
    setupVideoListeners() {
        if (!this.videoElement) return;
        
        this.videoElement.addEventListener('play', () => {
            if (this.isHost && this.socket && !this.syncInProgress) {
                this.socket.emit('play', {
                    currentTime: this.videoElement.currentTime
                });
                console.log('Sent play event');
            }
        });
        
        this.videoElement.addEventListener('pause', () => {
            if (this.isHost && this.socket && !this.syncInProgress) {
                this.socket.emit('pause', {
                    currentTime: this.videoElement.currentTime
                });
                console.log('Sent pause event');
            }
        });
        
        this.videoElement.addEventListener('seeked', () => {
            if (this.isHost && this.socket && !this.syncInProgress) {
                this.socket.emit('sync', {
                    isPlaying: !this.videoElement.paused,
                    currentTime: this.videoElement.currentTime
                });
                console.log('Sent sync event');
            }
        });
    }
    
    syncVideo(isPlaying, currentTime) {
        if (!this.videoElement || this.syncInProgress) return;
        
        this.syncInProgress = true;
        
        const timeDiff = Math.abs(this.videoElement.currentTime - currentTime);
        
        if (timeDiff > 1) {
            this.videoElement.currentTime = currentTime;
        }
        
        if (isPlaying && this.videoElement.paused) {
            this.videoElement.play().catch(console.error);
        } else if (!isPlaying && !this.videoElement.paused) {
            this.videoElement.pause();
        }
        
        setTimeout(() => {
            this.syncInProgress = false;
        }, 1000);
        
        console.log('Video synced:', { isPlaying, currentTime });
    }
    
    showComment(message, userId) {
        const commentElement = document.createElement('div');
        commentElement.className = 'watch-party-comment';
        commentElement.innerHTML = `
            <span class="user">ユーザー${userId.substring(0, 8)}</span>: ${message}
        `;
        
        document.body.appendChild(commentElement);
        
        setTimeout(() => {
            commentElement.remove();
        }, 5000);
    }
    
    createWatchPartyUI() {
        const ui = document.createElement('div');
        ui.id = 'watch-party-ui';
        ui.innerHTML = `
            <div class="watch-party-status">
                <span id="wp-status">未接続</span>
                <span id="wp-room">${this.currentRoom || ''}</span>
            </div>
        `;
        
        document.body.appendChild(ui);
    }
    
    updateStatus(status) {
        const statusElement = document.getElementById('wp-status');
        if (statusElement) {
            statusElement.textContent = status;
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new WatchPartyContent();
    });
} else {
    new WatchPartyContent();
}