class WatchPartyContent {
    constructor() {
        this.socket = null;
        this.videoElement = null;
        this.isHost = false;
        this.currentRoom = null;
        this.currentUser = null;
        this.syncInProgress = false;
        this.lastSyncTime = 0;
        this.debugMode = false; // デバッグモード設定
        
        this.init();
    }
    
    async init() {
        await this.loadDebugMode();
        await this.detectVideoElement();
        this.setupVideoListeners();
        this.createWatchPartyUI();
        this.setupMessageListener();
        
        // 初期化時はストレージからの自動接続は行わない
        // ポップアップからの明示的な指示でのみ接続
    }
    
    
    async detectVideoElement() {
        this.log('🔍 Detecting video element...');
        const selectors = [
            'video[data-testid="video-player"]',
            'video.dmp-video-player',
            'video#video-player',
            'video#test-video',
            'video',
            '.video-player video'
        ];
        
        this.log('📍 Available video elements on page:', document.querySelectorAll('video').length);
        document.querySelectorAll('video').forEach((video, index) => {
            this.log(`   Video ${index}:`, video.id || video.className || 'no-id-or-class', video);
        });
        
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                this.videoElement = element;
                this.log('✅ Video element found with selector:', selector, element);
                this.log('📹 Video properties:', {
                    duration: element.duration,
                    currentTime: element.currentTime,
                    paused: element.paused,
                    readyState: element.readyState
                });
                return;
            } else {
                this.log('❌ No video found with selector:', selector);
            }
        }
        
        this.log('⏳ No video element found, retrying in 1 second...');
        setTimeout(() => this.detectVideoElement(), 1000);
    }
    
    async loadDebugMode() {
        try {
            const result = await chrome.storage.local.get(['debugMode']);
            this.debugMode = result.debugMode || false;
        } catch (error) {
            this.debugMode = false;
        }
    }
    
    log(...args) {
        if (this.debugMode) {
            console.log(...args);
        }
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
            this.log('🔗 Connected to room:', this.currentRoom);
            this.log('👤 User ID:', this.currentUser);
            this.updateStatus('接続中');
        });
        
        this.socket.on('disconnect', () => {
            this.log('Disconnected from room');
            this.updateStatus('切断');
        });
        
        this.socket.on('room-state', (data) => {
            this.log('🏠 Room state received:', data);
            this.isHost = data.isHost;
            this.log('👑 Host status updated:', this.isHost ? 'HOST' : 'MEMBER');
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
            this.log('📥 Received play event:', data, 'fromUserId:', data.userId, 'myUserId:', this.currentUser);
            if (data.userId !== this.currentUser) {
                this.syncVideo(true, data.currentTime);
            } else {
                this.log('🚫 Ignoring play event (from self)');
            }
        });
        
        this.socket.on('pause', (data) => {
            this.log('📥 Received pause event:', data, 'fromUserId:', data.userId, 'myUserId:', this.currentUser);
            if (data.userId !== this.currentUser) {
                this.syncVideo(false, data.currentTime);
            } else {
                this.log('🚫 Ignoring pause event (from self)');
            }
        });
        
        this.socket.on('sync', (data) => {
            this.log('📥 Received sync event:', data, 'fromUserId:', data.userId, 'myUserId:', this.currentUser);
            if (data.userId !== this.currentUser) {
                this.syncVideo(data.isPlaying, data.currentTime);
            } else {
                this.log('🚫 Ignoring sync event (from self)');
            }
        });
        
        this.socket.on('comment', (data) => {
            this.log('Received comment:', data);
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
        if (!this.videoElement) {
            this.log('❌ Cannot setup video listeners: no video element found');
            return;
        }
        
        this.log('🎧 Setting up video event listeners...');
        
        this.videoElement.addEventListener('play', () => {
            this.log('🎬 Play event detected!', {
                socketConnected: this.socket && this.socket.connected,
                syncInProgress: this.syncInProgress,
                currentTime: this.videoElement.currentTime
            });
            
            if (this.socket && this.socket.connected && !this.syncInProgress) {
                this.socket.emit('play', {
                    currentTime: this.videoElement.currentTime,
                    userId: this.currentUser
                });
                this.log('📤 Sent play event to server');
            } else {
                this.log('🚫 Play event not sent:', {
                    reason: !this.socket ? 'no socket' :
                           !this.socket.connected ? 'not connected' :
                           this.syncInProgress ? 'sync in progress' : 'unknown'
                });
            }
        });
        
        this.videoElement.addEventListener('pause', () => {
            this.log('⏸️ Pause event detected!', {
                socketConnected: this.socket && this.socket.connected,
                syncInProgress: this.syncInProgress,
                currentTime: this.videoElement.currentTime
            });
            
            if (this.socket && this.socket.connected && !this.syncInProgress) {
                this.socket.emit('pause', {
                    currentTime: this.videoElement.currentTime,
                    userId: this.currentUser
                });
                this.log('📤 Sent pause event to server');
            } else {
                this.log('🚫 Pause event not sent:', {
                    reason: !this.socket ? 'no socket' :
                           !this.socket.connected ? 'not connected' :
                           this.syncInProgress ? 'sync in progress' : 'unknown'
                });
            }
        });
        
        this.videoElement.addEventListener('seeked', () => {
            this.log('⏭️ Seeked event detected!', {
                socketConnected: this.socket && this.socket.connected,
                syncInProgress: this.syncInProgress,
                currentTime: this.videoElement.currentTime,
                paused: this.videoElement.paused
            });
            
            if (this.socket && this.socket.connected && !this.syncInProgress) {
                this.socket.emit('sync', {
                    isPlaying: !this.videoElement.paused,
                    currentTime: this.videoElement.currentTime,
                    userId: this.currentUser
                });
                this.log('📤 Sent sync event to server');
            } else {
                this.log('🚫 Sync event not sent:', {
                    reason: !this.socket ? 'no socket' :
                           !this.socket.connected ? 'not connected' :
                           this.syncInProgress ? 'sync in progress' : 'unknown'
                });
            }
        });
        
        this.log('✅ Video event listeners set up successfully');
    }
    
    syncVideo(isPlaying, currentTime) {
        this.log('🔄 Attempting to sync video:', { isPlaying, currentTime });
        
        if (!this.videoElement) {
            this.log('❌ Cannot sync: no video element');
            return;
        }
        
        if (this.syncInProgress) {
            this.log('⏳ Sync already in progress, skipping');
            return;
        }
        
        this.syncInProgress = true;
        this.log('🔒 Sync started');
        
        const currentVideoTime = this.videoElement.currentTime;
        const timeDiff = Math.abs(currentVideoTime - currentTime);
        
        this.log('⏱️ Time comparison:', {
            videoTime: currentVideoTime,
            targetTime: currentTime,
            difference: timeDiff,
            willSeek: timeDiff > 1
        });
        
        if (timeDiff > 1) {
            this.log('⏭️ Seeking video to:', currentTime);
            this.videoElement.currentTime = currentTime;
        }
        
        this.log('🎮 Playback state:', {
            shouldPlay: isPlaying,
            currentlyPaused: this.videoElement.paused,
            willPlay: isPlaying && this.videoElement.paused,
            willPause: !isPlaying && !this.videoElement.paused
        });
        
        if (isPlaying && this.videoElement.paused) {
            this.log('▶️ Playing video');
            this.videoElement.play().catch(error => {
                this.log('❌ Play failed:', error);
            });
        } else if (!isPlaying && !this.videoElement.paused) {
            this.log('⏸️ Pausing video');
            this.videoElement.pause();
        }
        
        setTimeout(() => {
            this.syncInProgress = false;
            this.log('🔓 Sync completed');
        }, 1000);
        
        this.log('✅ Video sync completed:', { isPlaying, currentTime });
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