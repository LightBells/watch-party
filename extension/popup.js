class WatchPartyPopup {
    constructor() {
        this.currentRoom = null;
        this.currentUser = null;
        this.username = null;
        this.isHost = false;
        
        this.initializeElements();
        this.bindEvents();
        this.setupMessageListener();
        this.loadStoredData();
        this.updateConnectionStatus();
    }
    
    initializeElements() {
        this.roomSetup = document.getElementById('room-setup');
        this.roomInfo = document.getElementById('room-info');
        this.chatSection = document.getElementById('chat-section');
        this.usernameInput = document.getElementById('username');
        this.roomIdInput = document.getElementById('room-id');
        this.joinRoomBtn = document.getElementById('join-room');
        this.createRoomBtn = document.getElementById('create-room');
        this.leaveRoomBtn = document.getElementById('leave-room');
        this.connectionStatus = document.getElementById('connection-status');
        this.membersList = document.getElementById('members-list');
        this.chatMessages = document.getElementById('chat-messages');
        this.chatInput = document.getElementById('chat-input');
        this.sendMessageBtn = document.getElementById('send-message');
    }
    
    bindEvents() {
        this.joinRoomBtn.addEventListener('click', () => this.joinRoom());
        this.createRoomBtn.addEventListener('click', () => this.createRoom());
        this.leaveRoomBtn.addEventListener('click', () => this.leaveRoom());
        this.sendMessageBtn.addEventListener('click', () => this.sendMessage());
        this.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });
    }
    
    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            switch (request.action) {
                case 'chatMessage':
                    let displayName = request.data.username || request.data.userId;
                    if (request.data.userId === this.currentUser) {
                        displayName = 'あなた';
                    } else if (request.data.userId === 'システム') {
                        displayName = 'システム';
                    } else if (!request.data.username && request.data.userId.length > 8) {
                        displayName = `ユーザー${request.data.userId.substring(0, 8)}`;
                    }
                    
                    this.addChatMessage(
                        displayName,
                        request.data.message,
                        request.data.timestamp || Date.now()
                    );
                    break;
                    
                case 'roomStateUpdate':
                    this.updateMembers(request.data.members);
                    this.isHost = request.data.isHost;
                    break;
            }
        });
    }
    
    async loadStoredData() {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tabId = tabs[0].id;
            const storageKey = `tab_${tabId}`;
            
            const result = await chrome.storage.local.get([
                `${storageKey}_roomId`,
                `${storageKey}_token`, 
                `${storageKey}_userId`,
                `${storageKey}_username`,
                'globalUsername'
            ]);
            
            // グローバルユーザーネームを読み込み
            if (result.globalUsername) {
                this.username = result.globalUsername;
                this.usernameInput.value = this.username;
            }
            
            if (result[`${storageKey}_roomId`] && result[`${storageKey}_token`] && result[`${storageKey}_userId`]) {
                this.currentRoom = result[`${storageKey}_roomId`];
                this.currentUser = result[`${storageKey}_userId`];
                this.username = result[`${storageKey}_username`] || this.username;
                this.showRoomInterface();
            }
        } catch (error) {
            console.log('Failed to load stored data:', error);
        }
    }
    
    async updateConnectionStatus() {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs[0]) {
                const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'getConnectionStatus' });
                if (response && response.connected) {
                    this.connectionStatus.textContent = `ルーム ${response.roomId} に接続中`;
                    this.connectionStatus.className = 'status connected';
                    this.currentRoom = response.roomId;
                    this.currentUser = response.userId;
                    this.isHost = response.isHost;
                } else {
                    this.connectionStatus.textContent = '接続していません';
                    this.connectionStatus.className = 'status disconnected';
                }
            }
        } catch (error) {
            console.log('Content script not ready or not connected');
            this.connectionStatus.textContent = '接続していません';
            this.connectionStatus.className = 'status disconnected';
        }
    }
    
    async createRoom() {
        const roomId = this.generateRoomId();
        this.roomIdInput.value = roomId;
        await this.joinRoom();
    }
    
    async joinRoom() {
        const roomId = this.roomIdInput.value.trim();
        const username = this.usernameInput.value.trim();
        
        if (!roomId) {
            alert('ルームIDを入力してください');
            return;
        }
        
        if (!username) {
            alert('ユーザーネームを入力してください');
            return;
        }
        
        // ユーザーネームをグローバルに保存
        await chrome.storage.local.set({ globalUsername: username });
        this.username = username;
        
        try {
            const response = await fetch('http://localhost:3000/api/join-room', {
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
            
            // タブ固有のストレージキーを使用
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tabId = tabs[0].id;
            const storageKey = `tab_${tabId}`;
            
            await chrome.storage.local.set({
                [`${storageKey}_roomId`]: data.roomId,
                [`${storageKey}_token`]: data.token,
                [`${storageKey}_userId`]: data.userId,
                [`${storageKey}_username`]: username
            });
            
            this.currentRoom = data.roomId;
            this.currentUser = data.userId;
            this.isHost = data.isHost;
            
            this.showRoomInterface();
            
            // content scriptに接続を指示（タブIDと共に）
            try {
                await chrome.tabs.sendMessage(tabId, { 
                    action: 'connect',
                    roomId: data.roomId,
                    token: data.token,
                    userId: data.userId,
                    username: username
                });
            } catch (error) {
                console.log('Content script not ready');
            }
            
        } catch (error) {
            console.error('Join room error:', error);
            alert('ルームへの参加に失敗しました: ' + error.message);
        }
    }
    
    
    async leaveRoom() {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tabId = tabs[0].id;
            const storageKey = `tab_${tabId}`;
            
            await chrome.storage.local.remove([
                `${storageKey}_roomId`,
                `${storageKey}_token`, 
                `${storageKey}_userId`,
                `${storageKey}_username`
            ]);
            
            // content scriptに切断を指示
            await chrome.tabs.sendMessage(tabId, { action: 'disconnect' });
        } catch (error) {
            console.log('Content script not ready');
        }
        
        this.currentRoom = null;
        this.currentUser = null;
        this.isHost = false;
        
        this.showRoomSetup();
        this.clearChat();
        this.roomIdInput.value = '';
    }
    
    async sendMessage() {
        const message = this.chatInput.value.trim();
        if (!message) return;
        
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs[0]) {
                const response = await chrome.tabs.sendMessage(tabs[0].id, { 
                    action: 'sendComment', 
                    message: message 
                });
                if (response && response.success) {
                    this.addChatMessage('あなた', message, Date.now());
                    this.chatInput.value = '';
                } else {
                    alert('メッセージの送信に失敗しました');
                }
            }
        } catch (error) {
            console.log('Content script not ready');
            alert('接続していません');
        }
    }
    
    showRoomInterface() {
        this.roomSetup.classList.add('hidden');
        this.roomInfo.classList.remove('hidden');
        this.chatSection.classList.remove('hidden');
    }
    
    showRoomSetup() {
        this.roomSetup.classList.remove('hidden');
        this.roomInfo.classList.add('hidden');
        this.chatSection.classList.add('hidden');
    }
    
    
    updateMembers(members) {
        this.membersList.innerHTML = '';
        members.forEach(member => {
            const memberElement = document.createElement('div');
            memberElement.className = 'member';
            const displayName = member.username || `ユーザー${member.id.substring(0, 8)}`;
            if (member.id === this.currentUser) {
                memberElement.classList.add('host');
                memberElement.textContent = `${displayName} (あなた)`;
            } else {
                memberElement.textContent = displayName;
            }
            this.membersList.appendChild(memberElement);
        });
    }
    
    addChatMessage(user, message, timestamp) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message';
        
        const time = new Date(timestamp).toLocaleTimeString();
        messageElement.innerHTML = `
            <span class="user">${user}</span>: ${message}
            <span class="time">${time}</span>
        `;
        
        this.chatMessages.appendChild(messageElement);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
    
    clearChat() {
        this.chatMessages.innerHTML = '';
    }
    
    generateRoomId() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new WatchPartyPopup();
});