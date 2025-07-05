class WatchPartyContent {
    constructor() {
        this.socket = null;
        this.videoElement = null;
        this.isHost = false;
        this.currentRoom = null;
        this.currentUser = null;
        this.username = null;
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
        
        // 保存されたルーム情報があれば復元（自動接続は行わない）
        await this.restoreRoomState();
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
            `${storageKey}_userId`,
            `${storageKey}_username`
        ]);
        
        if (result[`${storageKey}_roomId`] && result[`${storageKey}_token`] && result[`${storageKey}_userId`]) {
            this.currentRoom = result[`${storageKey}_roomId`];
            this.currentUser = result[`${storageKey}_userId`];
            this.username = result[`${storageKey}_username`];
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
        
        const serverUrl = window.location.href.includes('localhost') ? 
            'http://localhost:3000' : 
            'https://lightbells-watch-party.an.r.appspot.com';
        
        this.socket = io(serverUrl, {
            auth: { token },
            transports: ['polling']
        });
        
        this.socket.on('connect', () => {
            this.log('🔗 Connected to room:', this.currentRoom);
            this.log('👤 User ID:', this.currentUser);
            this.updateStatus('接続中');
            this.showRoomInfo();
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
            this.updateMembers(data.members);
            
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
            this.showComment(data.message, data.username || data.userId);
            
            // ポップアップにチャットメッセージを送信
            chrome.runtime.sendMessage({
                action: 'chatMessage',
                data: {
                    userId: data.userId,
                    username: data.username,
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
    
    showComment(message, displayName) {
        const commentElement = document.createElement('div');
        commentElement.className = 'watch-party-comment';
        commentElement.innerHTML = `
            <span class="user">${displayName}</span>: ${message}
        `;
        
        document.body.appendChild(commentElement);
        
        setTimeout(() => {
            commentElement.remove();
        }, 5000);
    }
    
    createWatchPartyUI() {
        // フローティングボタン
        const floatingButton = document.createElement('div');
        floatingButton.id = 'wp-floating-button';
        floatingButton.innerHTML = `
            <div class="wp-button-content">
                <div class="wp-icon">🎬</div>
                <div class="wp-status-text">
                    <span id="wp-status">未接続</span>
                    <span id="wp-room">${this.currentRoom || ''}</span>
                </div>
            </div>
        `;
        
        // ルーム管理ポップアップ
        const roomPopup = document.createElement('div');
        roomPopup.id = 'wp-room-popup';
        roomPopup.className = 'wp-popup hidden';
        roomPopup.innerHTML = `
            <div class="wp-popup-content">
                <div class="wp-popup-header">
                    <h3>Watch Party</h3>
                    <button class="wp-close-btn" id="wp-close-popup">×</button>
                </div>
                <div class="wp-popup-body">
                    <div id="wp-room-setup" class="wp-section">
                        <div class="wp-input-group">
                            <label>ルームID</label>
                            <input type="text" id="wp-room-id" placeholder="ルームIDを入力">
                        </div>
                        <div class="wp-button-group">
                            <button id="wp-join-room" class="wp-btn wp-btn-primary">参加</button>
                            <button id="wp-create-room" class="wp-btn wp-btn-secondary">新規作成</button>
                        </div>
                    </div>
                    <div id="wp-room-info" class="wp-section hidden">
                        <div class="wp-connection-status">
                            <div id="wp-connection-indicator" class="wp-indicator disconnected"></div>
                            <span id="wp-connection-text">接続していません</span>
                        </div>
                        <div class="wp-members">
                            <h4>参加者</h4>
                            <div id="wp-members-list"></div>
                        </div>
                        <button id="wp-leave-room" class="wp-btn wp-btn-danger">退出</button>
                    </div>
                </div>
            </div>
        `;
        
        // コメント入力エリア
        const commentInput = document.createElement('div');
        commentInput.id = 'wp-comment-input';
        commentInput.innerHTML = `
            <div class="wp-comment-toggle">
                <button id="wp-toggle-comment" class="wp-toggle-btn">
                    <span class="wp-toggle-icon">‹</span>
                </button>
            </div>
            <div class="wp-comment-panel hidden" id="wp-comment-panel">
                <div class="wp-comment-form">
                    <input type="text" id="wp-comment-text" placeholder="コメントを入力...">
                    <button id="wp-send-comment" class="wp-btn wp-btn-primary">送信</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(floatingButton);
        document.body.appendChild(roomPopup);
        document.body.appendChild(commentInput);
        
        this.bindUIEvents();
    }
    
    bindUIEvents() {
        // フローティングボタンクリック
        const floatingButton = document.getElementById('wp-floating-button');
        if (floatingButton) {
            floatingButton.addEventListener('click', () => this.toggleRoomPopup());
        }
        
        // ポップアップ閉じるボタン
        const closeBtn = document.getElementById('wp-close-popup');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hideRoomPopup());
        }
        
        // ルーム参加・作成ボタン
        const joinBtn = document.getElementById('wp-join-room');
        const createBtn = document.getElementById('wp-create-room');
        const leaveBtn = document.getElementById('wp-leave-room');
        
        if (joinBtn) joinBtn.addEventListener('click', () => this.joinRoom());
        if (createBtn) createBtn.addEventListener('click', () => this.createRoom());
        if (leaveBtn) leaveBtn.addEventListener('click', () => this.leaveRoom());
        
        // コメントトグルボタン
        const toggleCommentBtn = document.getElementById('wp-toggle-comment');
        if (toggleCommentBtn) {
            toggleCommentBtn.addEventListener('click', () => this.toggleCommentPanel());
        }
        
        // コメント送信
        const sendCommentBtn = document.getElementById('wp-send-comment');
        const commentInput = document.getElementById('wp-comment-text');
        
        if (sendCommentBtn) sendCommentBtn.addEventListener('click', () => this.sendComment());
        if (commentInput) {
            commentInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendComment();
                }
            });
        }
        
        // ポップアップ外クリックで閉じる
        document.addEventListener('click', (e) => {
            const popup = document.getElementById('wp-room-popup');
            const floatingBtn = document.getElementById('wp-floating-button');
            
            if (popup && !popup.classList.contains('hidden') && 
                !popup.contains(e.target) && !floatingBtn.contains(e.target)) {
                this.hideRoomPopup();
            }
        });
    }
    
    toggleRoomPopup() {
        const popup = document.getElementById('wp-room-popup');
        if (popup) {
            popup.classList.toggle('hidden');
        }
    }
    
    hideRoomPopup() {
        const popup = document.getElementById('wp-room-popup');
        if (popup) {
            popup.classList.add('hidden');
        }
    }
    
    toggleCommentPanel() {
        const panel = document.getElementById('wp-comment-panel');
        const toggleBtn = document.getElementById('wp-toggle-comment');
        
        if (panel && toggleBtn) {
            panel.classList.toggle('hidden');
            const isOpen = !panel.classList.contains('hidden');
            
            // ボタンの見た目を更新
            if (isOpen) {
                toggleBtn.classList.add('open');
                toggleBtn.querySelector('.wp-toggle-icon').textContent = '›';
                document.getElementById('wp-comment-text').focus();
            } else {
                toggleBtn.classList.remove('open');
                toggleBtn.querySelector('.wp-toggle-icon').textContent = '‹';
            }
        }
    }
    
    async joinRoom() {
        const roomIdInput = document.getElementById('wp-room-id');
        const roomId = roomIdInput.value.trim();
        
        if (!roomId) {
            alert('ルームIDを入力してください');
            return;
        }
        
        // ユーザーネームを取得
        const username = await this.getStoredUsername();
        if (!username) {
            alert('ユーザーネームを設定してください。拡張機能のポップアップから設定できます。');
            return;
        }
        
        try {
            const serverUrl = window.location.href.includes('localhost') ? 
                'http://localhost:3000' : 
                'https://lightbells-watch-party.an.r.appspot.com';
            
            const response = await fetch(`${serverUrl}/api/join-room`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ roomId, username })
            });
            
            if (!response.ok) {
                throw new Error('ルームへの参加に失敗しました');
            }
            
            const data = await response.json();
            
            // ストレージに保存
            await this.saveRoomData(data.roomId, data.token, data.userId, username);
            
            this.currentRoom = data.roomId;
            this.currentUser = data.userId;
            this.username = username;
            this.isHost = data.isHost;
            
            this.connectToRoom(data.token);
            this.showRoomInfo();
            
        } catch (error) {
            console.error('Join room error:', error);
            alert('ルームへの参加に失敗しました: ' + error.message);
        }
    }
    
    async createRoom() {
        const roomId = this.generateRoomId();
        document.getElementById('wp-room-id').value = roomId;
        await this.joinRoom();
    }
    
    async leaveRoom() {
        if (this.socket) {
            this.socket.disconnect();
        }
        
        // ストレージから削除
        await this.removeRoomData();
        
        this.currentRoom = null;
        this.currentUser = null;
        this.username = null;
        this.isHost = false;
        
        this.updateStatus('切断');
        this.showRoomSetup();
    }
    
    sendComment() {
        const commentInput = document.getElementById('wp-comment-text');
        const message = commentInput.value.trim();
        
        if (!message) return;
        
        if (this.socket && this.socket.connected) {
            this.socket.emit('comment', { message });
            commentInput.value = '';
        } else {
            alert('ルームに接続していません');
        }
    }
    
    showRoomInfo() {
        const setupSection = document.getElementById('wp-room-setup');
        const infoSection = document.getElementById('wp-room-info');
        
        if (setupSection && infoSection) {
            setupSection.classList.add('hidden');
            infoSection.classList.remove('hidden');
        }
    }
    
    showRoomSetup() {
        const setupSection = document.getElementById('wp-room-setup');
        const infoSection = document.getElementById('wp-room-info');
        
        if (setupSection && infoSection) {
            setupSection.classList.remove('hidden');
            infoSection.classList.add('hidden');
        }
        
        // 入力をクリア
        const roomIdInput = document.getElementById('wp-room-id');
        if (roomIdInput) roomIdInput.value = '';
    }
    
    async getStoredUsername() {
        try {
            const result = await chrome.storage.local.get(['globalUsername']);
            return result.globalUsername;
        } catch (error) {
            return null;
        }
    }
    
    async saveRoomData(roomId, token, userId, username) {
        const tabId = this.tabId || Date.now();
        const storageKey = `tab_${tabId}`;
        
        await chrome.storage.local.set({
            [`${storageKey}_roomId`]: roomId,
            [`${storageKey}_token`]: token,
            [`${storageKey}_userId`]: userId,
            [`${storageKey}_username`]: username
        });
    }
    
    async removeRoomData() {
        const tabId = this.tabId || Date.now();
        const storageKey = `tab_${tabId}`;
        
        await chrome.storage.local.remove([
            `${storageKey}_roomId`,
            `${storageKey}_token`,
            `${storageKey}_userId`,
            `${storageKey}_username`
        ]);
    }
    
    generateRoomId() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }
    
    async restoreRoomState() {
        const token = await this.loadStoredData();
        if (token && this.currentRoom && this.currentUser) {
            // 情報は復元するが自動接続はしない
            this.updateStatus('未接続');
            this.showRoomSetup();
            
            // ルームIDを入力欄に設定
            const roomIdInput = document.getElementById('wp-room-id');
            if (roomIdInput) {
                roomIdInput.value = this.currentRoom;
            }
        }
    }
    
    updateStatus(status) {
        const statusElement = document.getElementById('wp-status');
        const roomElement = document.getElementById('wp-room');
        
        if (statusElement) {
            statusElement.textContent = status;
        }
        
        if (roomElement) {
            roomElement.textContent = this.currentRoom || '';
        }
        
        // 接続状態インジケーターの更新
        const indicator = document.getElementById('wp-connection-indicator');
        const connectionText = document.getElementById('wp-connection-text');
        
        if (indicator && connectionText) {
            if (status === '切断' || status === '未接続') {
                indicator.className = 'wp-indicator disconnected';
                connectionText.textContent = '接続していません';
            } else {
                indicator.className = 'wp-indicator connected';
                connectionText.textContent = `ルーム ${this.currentRoom} に接続中 (${status})`;
            }
        }
    }
    
    updateMembers(members) {
        const membersList = document.getElementById('wp-members-list');
        if (!membersList) return;
        
        membersList.innerHTML = '';
        members.forEach(member => {
            const memberElement = document.createElement('div');
            memberElement.className = 'wp-member';
            
            const displayName = member.username || `ユーザー${member.id.substring(0, 8)}`;
            
            if (member.id === this.currentUser) {
                memberElement.classList.add('wp-member-self');
                memberElement.textContent = `${displayName} (あなた)`;
            } else {
                memberElement.textContent = displayName;
            }
            
            if (member.id === this.currentRoom?.host) {
                memberElement.classList.add('wp-member-host');
            }
            
            membersList.appendChild(memberElement);
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new WatchPartyContent();
    });
} else {
    new WatchPartyContent();
}