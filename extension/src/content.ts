import {io, Socket} from 'socket.io-client';

type VideoState = {
  isPlaying: boolean;
  currentTime: number;
  lastUpdateTime: number;
};

type RoomMember = {
  id: string;
  username?: string;
  joinedAt?: number;
};

type RoomStatePayload = {
  members: RoomMember[];
  videoState: VideoState;
  isHost: boolean;
  currentUrl?: string | null;
};

type CommentPayload = {
  userId: string;
  username?: string;
  message: string;
  timestamp: number;
};

type NavigateEventPayload = {
  url: string;
  userId: string;
  timestamp: number;
};

class WatchPartyContent {
  private static readonly ROOM_HASH_KEY = 'watchparty-room';

  private static historyPatched = false;
  private socket: Socket | null = null;

  private videoElement: HTMLVideoElement | null = null;

  private isHost = false;

  private currentRoom: string | null = null;

  private currentUser: string | null = null;

  private username: string | null = null;

  private syncInProgress = false;

  private lastSyncTime = 0;

  private pendingVideoState: VideoState | null = null;

  private debugMode = false;

  private tabId: number | null = null;

  private navigationInProgress = false;

  private initialVideoStateApplied = false;

  private awaitingInitialState = false;

  private lastKnownUrl = window.location.href;

  private urlObserverId: number | null = null;

  private authToken: string | null = null;

  private shareFeedbackTimeout: number | null = null;

  private commentOverlay: HTMLDivElement | null = null;

  private overlayResizeObserver: ResizeObserver | null = null;

  private readonly handleViewportChange = () => {
    window.requestAnimationFrame(() => this.updateCommentOverlayBounds());
  };

  private readonly interceptCommentInputKeyEvent = (event: KeyboardEvent): void => {
    const commentInput = this.getInput('wp-comment-text');
    if (!commentInput) {
      return;
    }

    const activeElement = document.activeElement;
    if (activeElement !== commentInput) {
      return;
    }

    if (
      event.type === 'keydown' &&
      (event.key === 'Enter' || event.key === 'NumpadEnter') &&
      !event.repeat
    ) {
      event.preventDefault();
      this.sendComment();
    }

    event.stopImmediatePropagation();
    event.stopPropagation();
  };

  private commentInputProtectionInitialized = false;

  private lastBroadcastUrl: string | null = null;

  private currentRoomUrl: string | null = null;

  private readonly serverUrl: string;

  private readonly selectors: string[] = [
    'video[data-testid="video-player"]',
    'video.dmp-video-player',
    'video#video-player',
    'video#test-video',
    'video',
    '.video-player video',
  ];

  constructor() {
    this.serverUrl = window.location.href.includes('localhost')
      ? 'http://localhost:3000'
      : 'https://lightbells-watch-party.an.r.appspot.com';

    this.lastKnownUrl = window.location.href;

    void this.init();
  }

  private async init(): Promise<void> {
    await this.loadDebugMode();
    await this.detectVideoElement();
    this.setupVideoListeners();
    this.createWatchPartyUI();
    this.setupInteractionHandlers();
    this.setupMessageListener();
    this.monitorUrlChanges();
    await this.restoreRoomState();
    await this.handleDeepLink();
    this.awaitingInitialState = !this.isHost;
  }

  private async loadDebugMode(): Promise<void> {
    try {
      const result = (await chrome.storage.local.get(['debugMode'])) as {debugMode?: boolean};
      this.debugMode = Boolean(result.debugMode);
    } catch (error) {
      this.debugMode = false;
    }
  }

  private log(...args: unknown[]): void {
    if (this.debugMode) {
      // eslint-disable-next-line no-console
      console.log(...args);
    }
  }

  private async detectVideoElement(): Promise<void> {
    this.log('🔍 Detecting video element...');

    const videos = document.querySelectorAll<HTMLVideoElement>('video');
    this.log('📍 Available video elements on page:', videos.length);
    videos.forEach((video, index) => {
      this.log(`   Video ${index}:`, video.id || video.className || 'no-id-or-class', video);
    });

    for (const selector of this.selectors) {
      const element = document.querySelector(selector);
      if (element instanceof HTMLVideoElement) {
        this.videoElement = element;
        this.log('✅ Video element found with selector:', selector, element);
        this.log('📹 Video properties:', {
          duration: element.duration,
          currentTime: element.currentTime,
          paused: element.paused,
          readyState: element.readyState,
        });
        this.setupCommentOverlay();
        this.flushPendingVideoState();
        this.broadcastHostVideoState('video-ready');
        return;
      }

      this.log('❌ No video found with selector:', selector);
    }

    this.log('⏳ No video element found, retrying in 1 second...');
    window.setTimeout(() => {
      void this.detectVideoElement();
    }, 1000);
  }

  private enforcePauseWhileAwaiting(): void {
    if (!this.videoElement) {
      return;
    }

    if (!this.videoElement.paused) {
      this.log('🛑 Pausing local playback until room state arrives');
      this.videoElement.pause();
    }

    window.setTimeout(() => {
      if (this.awaitingInitialState && !this.videoElement?.paused) {
        this.log('🛑 Secondary pause enforcement');
        this.videoElement?.pause();
      }
    }, 250);
  }

  private setupInteractionHandlers(): void {
    const attemptFlush = (): void => {
      if (!this.pendingVideoState || this.syncInProgress) {
        return;
      }
      this.log('🖱️ User interaction detected; retrying pending video sync');
      this.flushPendingVideoState();
    };

    document.addEventListener('click', attemptFlush, true);
    document.addEventListener('keydown', attemptFlush, true);
  }

  private setupMessageListener(): void {
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
  }

  private shouldEmitPlaybackEvents(): boolean {
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
  }

  private setupVideoListeners(): void {
    if (!this.videoElement) {
      this.log('❌ Cannot setup video listeners: no video element found');
      return;
    }

    this.log('🎧 Setting up video event listeners...');

    this.videoElement.addEventListener('play', () => {
      this.log('🎬 Play event detected!', {
        socketConnected: Boolean(this.socket?.connected),
        syncInProgress: this.syncInProgress,
        currentTime: this.videoElement?.currentTime,
      });

      if (this.socket && this.socket.connected && !this.syncInProgress && this.shouldEmitPlaybackEvents()) {
        this.socket.emit('play', {
          currentTime: this.videoElement.currentTime,
          userId: this.currentUser ?? undefined,
        });
        this.log('📤 Sent play event to server');
      }
    });

    this.videoElement.addEventListener('pause', () => {
      this.log('⏸️ Pause event detected!', {
        socketConnected: Boolean(this.socket?.connected),
        syncInProgress: this.syncInProgress,
        currentTime: this.videoElement?.currentTime,
      });

      if (this.socket && this.socket.connected && !this.syncInProgress && this.shouldEmitPlaybackEvents()) {
        this.socket.emit('pause', {
          currentTime: this.videoElement.currentTime,
          userId: this.currentUser ?? undefined,
        });
        this.log('📤 Sent pause event to server');
      }
    });

    this.videoElement.addEventListener('seeked', () => {
      this.log('⏭️ Seeked event detected!', {
        socketConnected: Boolean(this.socket?.connected),
        syncInProgress: this.syncInProgress,
        currentTime: this.videoElement?.currentTime,
        paused: this.videoElement?.paused,
      });

      if (this.socket && this.socket.connected && !this.syncInProgress && this.shouldEmitPlaybackEvents()) {
        this.socket.emit('sync', {
          isPlaying: !this.videoElement.paused,
          currentTime: this.videoElement.currentTime,
          userId: this.currentUser ?? undefined,
        });
        this.log('📤 Sent sync event to server');
      }
    });

    this.log('✅ Video event listeners set up successfully');
  }

  private createWatchPartyUI(): void {
    const floatingButton = document.createElement('div');
    floatingButton.id = 'wp-floating-button';
    floatingButton.innerHTML = `
      <div class="wp-button-content">
        <div class="wp-icon">🎬</div>
        <div class="wp-status-text">
          <span id="wp-status">未接続</span>
          <span id="wp-room"></span>
        </div>
      </div>
    `;

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
        <div class="wp-share-controls hidden" id="wp-share-controls">
            <button id="wp-share-room" class="wp-btn wp-btn-secondary" type="button">共有リンクをコピー</button>
            <span id="wp-share-feedback" class="wp-share-feedback">コピーしました</span>
        </div>
        <button id="wp-leave-room" class="wp-btn wp-btn-danger">退出</button>
    </div>
</div>
            </div>
        `;

    const commentInput = document.createElement('div');
    commentInput.id = 'wp-comment-input';
    commentInput.innerHTML = `
      <div class="wp-comment-toggle">
        <button id="wp-toggle-comment" class="wp-toggle-btn">
          <span class="wp-toggle-icon">›</span>
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

  private bindUIEvents(): void {
    const floatingButton = document.getElementById('wp-floating-button');
    floatingButton?.addEventListener('click', () => this.toggleRoomPopup());

    const closeBtn = document.getElementById('wp-close-popup');
    closeBtn?.addEventListener('click', () => this.hideRoomPopup());

    document.getElementById('wp-join-room')?.addEventListener('click', () => void this.joinRoom());
    document.getElementById('wp-create-room')?.addEventListener('click', () => void this.createRoom());
    document.getElementById('wp-leave-room')?.addEventListener('click', () => void this.leaveRoom());
    document.getElementById('wp-share-room')?.addEventListener('click', () => void this.copyShareLink());

    document.getElementById('wp-toggle-comment')?.addEventListener('click', () => this.toggleCommentPanel());

    const sendCommentBtn = document.getElementById('wp-send-comment');
    sendCommentBtn?.addEventListener('click', () => this.sendComment());

    this.setupCommentInputProtection();

    document.addEventListener('click', (event) => {
      const popup = document.getElementById('wp-room-popup');
      const floatingBtn = document.getElementById('wp-floating-button');

      if (!popup || popup.classList.contains('hidden')) {
        return;
      }

      if (event.target instanceof Node && event.target instanceof Element) {
        if (!popup.contains(event.target) && floatingBtn && !floatingBtn.contains(event.target)) {
          this.hideRoomPopup();
        }
      }
    });
  }

  private setupCommentInputProtection(): void {
    if (this.commentInputProtectionInitialized) {
      return;
    }

    const commentInput = this.getInput('wp-comment-text');
    if (!commentInput) {
      return;
    }

    const eventTypes: Array<'keydown'> = ['keydown'];

    eventTypes.forEach((eventType) => {
      window.addEventListener(eventType, this.interceptCommentInputKeyEvent, true);
      document.addEventListener(eventType, this.interceptCommentInputKeyEvent, true);
    });

    this.commentInputProtectionInitialized = true;
  }

  private toggleRoomPopup(): void {
    const popup = document.getElementById('wp-room-popup');
    popup?.classList.toggle('hidden');
  }

  private hideRoomPopup(): void {
    const popup = document.getElementById('wp-room-popup');
    popup?.classList.add('hidden');
  }

  private toggleCommentPanel(): void {
    const panel = document.getElementById('wp-comment-panel');
    const toggleBtn = document.getElementById('wp-toggle-comment');

    if (!panel || !toggleBtn) {
      return;
    }

    panel.classList.toggle('hidden');
    const isOpen = !panel.classList.contains('hidden');

    const icon = toggleBtn.querySelector('.wp-toggle-icon');
    if (isOpen) {
      toggleBtn.classList.add('open');
      if (icon) {
        icon.textContent = '›';
      }
      this.getInput('wp-comment-text')?.focus();
    } else {
      toggleBtn.classList.remove('open');
      if (icon) {
        icon.textContent = '‹';
      }
    }
  }

  private async joinRoom(): Promise<void> {
    const roomIdInput = this.getInput('wp-room-id');
    const roomId = roomIdInput?.value.trim();

    if (!roomId) {
      window.alert('ルームIDを入力してください');
      return;
    }

    await this.joinRoomById(roomId);
  }

  private async createRoom(): Promise<void> {
    const roomId = this.generateRoomId();
    const roomInput = this.getInput('wp-room-id');
    if (roomInput) {
      roomInput.value = roomId;
    }
    await this.joinRoomById(roomId);
  }

  private async joinRoomById(roomId: string, options: {silent?: boolean} = {}): Promise<void> {
    if (!roomId) {
      return;
    }

    if (this.socket?.connected && this.currentRoom === roomId) {
      return;
    }

    const username = await this.getStoredUsername();
    if (!username) {
      if (!options.silent) {
        window.alert('ユーザーネームを設定してください。拡張機能のポップアップから設定できます。');
      } else {
        this.log('Username missing; skipping auto-join');
      }
      return;
    }

    try {
      const requestBody = {
        roomId,
        username,
        pageUrl: window.location.href,
      };

      const response = await fetch(`${this.serverUrl}/api/join-room`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error('join_room_failed');
      }

      const data = (await response.json()) as {
        roomId: string;
        token: string;
        userId: string;
        isHost: boolean;
        currentUrl?: string | null;
      };

      this.authToken = data.token;

      await this.saveRoomData(data.roomId, data.token, data.userId, username, data.isHost);

      this.currentRoom = data.roomId;
      this.currentUser = data.userId;
      this.username = username;
      this.isHost = data.isHost;
      this.awaitingInitialState = !this.isHost;
      this.initialVideoStateApplied = this.isHost;

      if (!this.isHost) {
        this.enforcePauseWhileAwaiting();
      }

      if (this.isHost) {
        const shareUrl = this.ensureShareLink(data.roomId);
        this.currentRoomUrl = shareUrl;
        this.lastBroadcastUrl = null;
      } else {
        this.lastKnownUrl = window.location.href;
      }

      if (data.currentUrl) {
        this.syncRoomUrl(data.currentUrl);
      }

      void this.persistRoomState();

      await this.connectToRoom(data.token);
      this.updateStatus(this.isHost ? 'ホスト' : 'メンバー');
      this.showRoomInfo();
      this.updateShareControls(true);
    } catch (error) {
      this.log('Join room failed:', error);
      if (!options.silent) {
        window.alert('ルームへの参加に失敗しました');
      }
    }
  }

  private async leaveRoom(): Promise<void> {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    await this.removeRoomData();

    this.currentRoom = null;
    this.currentUser = null;
    this.username = null;
    this.isHost = false;
    this.navigationInProgress = false;
    this.awaitingInitialState = false;
    this.initialVideoStateApplied = false;
    this.authToken = null;
    this.lastBroadcastUrl = null;
    this.currentRoomUrl = null;

    this.clearShareLink();
    this.updateShareControls(false);
    this.hideShareFeedback();

    this.updateStatus('切断');
    this.showRoomSetup();
  }

  private sendComment(): void {
    const commentInput = this.getInput('wp-comment-text');
    const message = commentInput?.value.trim();

    if (!message) {
      return;
    }

    if (this.socket?.connected) {
      this.socket.emit('comment', {message});
      if (commentInput) {
        commentInput.value = '';
      }
    } else {
      window.alert('ルームに接続していません');
    }
  }

  private showRoomInfo(): void {
    const setupSection = document.getElementById('wp-room-setup');
    const infoSection = document.getElementById('wp-room-info');
    setupSection?.classList.add('hidden');
    infoSection?.classList.remove('hidden');
    this.updateShareControls();
  }

  private showRoomSetup(): void {
    const setupSection = document.getElementById('wp-room-setup');
    const infoSection = document.getElementById('wp-room-info');
    setupSection?.classList.remove('hidden');
    infoSection?.classList.add('hidden');

    const roomIdInput = this.getInput('wp-room-id');
    if (roomIdInput) {
      roomIdInput.value = '';
    }
    this.updateShareControls(false);
  }

  private updateStatus(status: string): void {
    const statusElement = document.getElementById('wp-status');
    if (statusElement) {
      statusElement.textContent = status;
    }

    const roomElement = document.getElementById('wp-room');
    if (roomElement) {
      roomElement.textContent = this.currentRoom ?? '';
    }

    const indicator = document.getElementById('wp-connection-indicator');
    const connectionText = document.getElementById('wp-connection-text');

    if (!indicator || !connectionText) {
      return;
    }

    if (status === '切断' || status === '未接続') {
      indicator.className = 'wp-indicator disconnected';
      connectionText.textContent = '接続していません';
    } else {
      indicator.className = 'wp-indicator connected';
      connectionText.textContent = `ルーム ${this.currentRoom ?? ''} に接続中 (${status})`;
    }
  }

  private updateMembers(members: RoomMember[]): void {
    const membersList = document.getElementById('wp-members-list');
    if (!membersList) {
      return;
    }

    membersList.innerHTML = '';

    members.forEach((member) => {
      const item = document.createElement('div');
      item.className = 'wp-member-item';
      item.textContent = member.username || member.id;
      if (member.id === this.currentUser) {
        item.classList.add('self');
      }
      membersList.appendChild(item);
    });
  }

  private async connectToRoom(token: string): Promise<void> {
    if (this.socket) {
      this.socket.disconnect();
    }

    this.authToken = token;

    this.socket = io(this.serverUrl, {
      auth: {token},
      transports: ['polling'],
    });

    this.socket.on('connect', () => {
      this.log('🔗 Connected to room:', this.currentRoom);
      this.log('👤 User ID:', this.currentUser);
      this.updateStatus('接続中');
      this.showRoomInfo();
      if (this.isHost) {
        this.broadcastCurrentUrl();
        this.broadcastHostVideoState('socket-connect');
      } else {
        this.flushPendingVideoState();
      }
    });

    this.socket.on('disconnect', () => {
      this.log('Disconnected from room');
      this.updateStatus('切断');
    });

    this.socket.on('room-state', (data: RoomStatePayload) => {
      this.log('🏠 Room state received:', data);
      this.isHost = data.isHost;
      this.log('👑 Host status updated:', this.isHost ? 'HOST' : 'MEMBER');
      this.updateStatus(this.isHost ? 'ホスト' : 'メンバー');
      this.updateMembers(data.members);
      if (data.currentUrl) {
        this.syncRoomUrl(data.currentUrl);
      }

      this.applyRoomVideoState(data.videoState);

      if (this.isHost) {
        this.ensureShareLink(this.currentRoom);
        this.broadcastHostVideoState('room-state');
      }

      void chrome.runtime.sendMessage({
        action: 'roomStateUpdate',
        data: {
          members: data.members,
          isHost: data.isHost,
          currentUrl: data.currentUrl ?? null,
        },
      });

      void this.persistRoomState();
    });

    this.socket.on('play', (data: {currentTime: number; userId: string; timestamp: number}) => {
      this.log('📥 Received play event:', data, 'fromUserId:', data.userId, 'myUserId:', this.currentUser);
      if (data.userId !== this.currentUser) {
        this.syncVideo(true, data.currentTime, data.timestamp);
      }
    });

    this.socket.on('pause', (data: {currentTime: number; userId: string; timestamp: number}) => {
      this.log('📥 Received pause event:', data, 'fromUserId:', data.userId, 'myUserId:', this.currentUser);
      if (data.userId !== this.currentUser) {
        this.syncVideo(false, data.currentTime, data.timestamp);
      }
    });

    this.socket.on('sync', (data: {isPlaying: boolean; currentTime: number; userId: string; timestamp: number}) => {
      this.log('📥 Received sync event:', data, 'fromUserId:', data.userId, 'myUserId:', this.currentUser);
      if (data.userId !== this.currentUser) {
        this.syncVideo(data.isPlaying, data.currentTime, data.timestamp);
      }
    });

    this.socket.on('comment', (data: CommentPayload) => {
      this.log('Received comment:', data);
      this.showComment(data.message, data.username || data.userId);

      void chrome.runtime.sendMessage({
        action: 'chatMessage',
        data,
      });
    });

    this.socket.on('user-joined', (data: {userId: string; timestamp: number}) => {
      void chrome.runtime.sendMessage({
        action: 'chatMessage',
        data: {
          userId: 'システム',
          message: 'ユーザーが参加しました',
          timestamp: data.timestamp,
        },
      });

      if (this.isHost) {
        this.log('📡 Syncing state in response to new member join');
        this.broadcastHostVideoState('user-joined');
      }
    });

    this.socket.on('user-left', (data: {userId: string; timestamp: number}) => {
      void chrome.runtime.sendMessage({
        action: 'chatMessage',
        data: {
          userId: 'システム',
          message: 'ユーザーが退出しました',
          timestamp: data.timestamp,
        },
      });
    });

    this.socket.on('host-changed', (data: {newHost: string; timestamp: number}) => {
      this.isHost = data.newHost === this.currentUser;
      this.awaitingInitialState = !this.isHost && !this.initialVideoStateApplied;
      this.updateStatus(this.isHost ? 'ホスト' : 'メンバー');

      void chrome.runtime.sendMessage({
        action: 'chatMessage',
        data: {
          userId: 'システム',
          message: 'ホストが変更されました',
          timestamp: data.timestamp,
        },
      });

      void this.persistRoomState();

      if (this.isHost) {
        this.ensureShareLink(this.currentRoom);
        this.broadcastHostVideoState('host-changed');
      }
    });

    this.socket.on('navigate', (data: NavigateEventPayload) => {
      this.log('📥 Received navigate event:', data);
      if (data.userId === this.currentUser) {
        return;
      }
      this.currentRoomUrl = data.url;
      this.syncRoomUrl(data.url);
    });
  }

  private flushPendingVideoState(): void {
    if (!this.pendingVideoState) {
      return;
    }

    if (!this.videoElement) {
      this.log('⏳ Video element not ready; keeping pending state queued');
      return;
    }

    const pending = this.pendingVideoState;
    this.pendingVideoState = null;

    this.syncVideo(pending.isPlaying, pending.currentTime, pending.lastUpdateTime);
    this.awaitingInitialState = false;
    this.initialVideoStateApplied = true;
  }

  private broadcastHostVideoState(reason: string): void {
    if (!this.isHost || !this.socket?.connected || !this.videoElement) {
      return;
    }

    const payload = {
      isPlaying: !this.videoElement.paused,
      currentTime: this.videoElement.currentTime,
      userId: this.currentUser ?? undefined,
    };

    this.log(`📡 Broadcasting host video state (${reason})`, payload);
    this.socket.emit('sync', payload);
  }

  private applyRoomVideoState(videoState?: VideoState | null): void {
    if (!videoState) {
      return;
    }

    if (this.isHost) {
      this.log('⚠️ Skipping room video state apply because this tab is host');
      return;
    }

    this.pendingVideoState = {...videoState};
    this.awaitingInitialState = true;
    this.enforcePauseWhileAwaiting();

    this.flushPendingVideoState();
    if (this.initialVideoStateApplied) {
      this.awaitingInitialState = false;
    }
  }

  private syncVideo(isPlaying: boolean, currentTime: number, lastUpdateTime = Date.now()): void {
    this.log('🔄 Attempting to sync video:', {isPlaying, currentTime, lastUpdateTime});

    if (!this.videoElement) {
      this.log('❌ Cannot sync: no video element');
      this.pendingVideoState = {isPlaying, currentTime, lastUpdateTime};
      this.awaitingInitialState = true;
      return;
    }

    if (this.syncInProgress) {
      this.log('⏳ Sync already in progress, queueing latest state');
      this.pendingVideoState = {isPlaying, currentTime, lastUpdateTime};
      this.awaitingInitialState = this.awaitingInitialState || !this.initialVideoStateApplied;
      return;
    }

    this.syncInProgress = true;
    this.pendingVideoState = null;
    this.initialVideoStateApplied = true;
    this.awaitingInitialState = false;

    let targetTime = currentTime;
    if (isPlaying) {
      const elapsedSinceUpdate = (Date.now() - lastUpdateTime) / 1000;
      if (elapsedSinceUpdate > 0) {
        targetTime += elapsedSinceUpdate;
      }
    }

    if (Number.isFinite(this.videoElement.duration) && this.videoElement.duration > 0) {
      targetTime = Math.min(targetTime, this.videoElement.duration);
    }

    targetTime = Math.max(0, targetTime);

    const currentVideoTime = this.videoElement.currentTime;
    const timeDiff = Math.abs(currentVideoTime - targetTime);

    if (timeDiff > 1) {
      this.videoElement.currentTime = targetTime;
    }

    if (isPlaying) {
      const wasMuted = this.videoElement.muted;
      if (this.videoElement.paused) {
        if (!wasMuted) {
          this.videoElement.muted = true;
        }
        void this.videoElement
          .play()
          .then(() => {
            if (!wasMuted) {
              this.videoElement.muted = false;
            }
          })
          .catch((error) => {
            this.log('❌ Play failed:', error);
            if (!wasMuted) {
              this.videoElement.muted = wasMuted;
            }
            this.pendingVideoState = {
              isPlaying,
              currentTime: this.videoElement?.currentTime ?? targetTime,
              lastUpdateTime: Date.now(),
            };
          });
      }

      window.setTimeout(() => {
        if (!wasMuted && this.videoElement) {
          this.videoElement.muted = false;
        }
      }, 0);
    } else {
      if (!this.videoElement.paused) {
        this.videoElement.pause();
      }

      window.setTimeout(() => {
        if (!this.videoElement?.paused) {
          this.log('⏹️ Pause enforcement retry');
          this.videoElement?.pause();
        }
      }, 200);
    }

    window.setTimeout(() => {
      this.syncInProgress = false;
      this.flushPendingVideoState();
    }, 300);
  }

  private showComment(message: string, displayName: string): void {
    const overlay = this.ensureCommentOverlay();
    if (!overlay) {
      return;
    }

    this.updateCommentOverlayBounds();

    const commentElement = document.createElement('div');
    commentElement.className = 'watch-party-comment';
    commentElement.innerHTML = `
      <span class=\"user\">${displayName}</span>: ${message}
    `;

    overlay.appendChild(commentElement);

    const overlayHeight =
      overlay.clientHeight || this.videoElement?.clientHeight || window.innerHeight;
    const commentHeight = commentElement.offsetHeight || 24;
    const maxTop = Math.max(overlayHeight - commentHeight, 0);
    const randomTop = Math.floor(Math.random() * (maxTop + 1));
    commentElement.style.top = `${randomTop}px`;

    const commentWidth =
      commentElement.getBoundingClientRect().width || commentElement.scrollWidth || commentElement.offsetWidth || 0;
    const overlayWidth =
      overlay.clientWidth || this.videoElement?.clientWidth || Math.max(window.innerWidth, document.documentElement.clientWidth || 0);
    const travelDistance = Math.max(overlayWidth, window.innerWidth) + commentWidth;
    commentElement.style.setProperty('--comment-travel', `${travelDistance}px`);

    const textLength = (message?.length ?? 0) + (displayName?.length ?? 0);
    const baseDuration = Math.min(14, Math.max(6, 6 + textLength * 0.1));
    const duration = Math.max(3, baseDuration / 2);
    commentElement.style.setProperty('--comment-duration', `${duration}s`);

    void commentElement.offsetWidth;
    commentElement.classList.add('animate');

    commentElement.addEventListener(
      'animationend',
      () => {
        commentElement.remove();
      },
      {once: true},
    );
  }

  private setupCommentOverlay(): void {
    const overlay = this.ensureCommentOverlay();
    if (!overlay) {
      return;
    }

    this.updateCommentOverlayBounds();

    if (this.videoElement && typeof ResizeObserver !== 'undefined') {
      if (!this.overlayResizeObserver) {
        this.overlayResizeObserver = new ResizeObserver(() => {
          this.updateCommentOverlayBounds();
        });
      }
      this.overlayResizeObserver.disconnect();
      this.overlayResizeObserver.observe(this.videoElement);
    }
  }

  private ensureCommentOverlay(): HTMLDivElement | null {
    if (this.commentOverlay && document.body.contains(this.commentOverlay)) {
      return this.commentOverlay;
    }

    if (!document.body) {
      return null;
    }

    if (!this.commentOverlay) {
      this.commentOverlay = document.createElement('div');
      this.commentOverlay.id = 'wp-comment-overlay';
      this.commentOverlay.className = 'wp-comment-overlay';
      window.addEventListener('resize', this.handleViewportChange);
      window.addEventListener('scroll', this.handleViewportChange);
    }

    document.body.appendChild(this.commentOverlay);
    return this.commentOverlay;
  }

  private updateCommentOverlayBounds(): void {
    const overlay = this.commentOverlay;
    if (!overlay) {
      return;
    }

    const rect = this.videoElement?.getBoundingClientRect();
    if (rect) {
      overlay.style.top = `${rect.top + window.scrollY}px`;
      overlay.style.left = `${rect.left + window.scrollX}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
    } else {
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100vw';
      overlay.style.height = '100vh';
    }
  }

  private async getStoredUsername(): Promise<string | null> {
    try {
      const result = (await chrome.storage.local.get(['globalUsername'])) as {globalUsername?: string};
      return result.globalUsername ?? null;
    } catch (error) {
      this.log('Failed to load username', error);
      return null;
    }
  }

  private async saveRoomData(
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
  }

  private async removeRoomData(): Promise<void> {
    const tabId = await this.resolveTabId();
    const storageKey = `tab_${tabId}`;

    await chrome.storage.local.remove([
      `${storageKey}_roomId`,
      `${storageKey}_token`,
      `${storageKey}_userId`,
      `${storageKey}_username`,
      `${storageKey}_isHost`,
    ]);
  }

  private async persistRoomState(): Promise<void> {
    if (!this.currentRoom || !this.authToken || !this.currentUser) {
      return;
    }

    const username = this.username ?? '';
    await this.saveRoomData(this.currentRoom, this.authToken, this.currentUser, username, this.isHost);
  }

  private generateRoomId(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  private async restoreRoomState(): Promise<void> {
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

    await this.connectToRoom(token);
    this.updateShareControls(true);
  }

  private async loadStoredData(): Promise<string | null> {
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
  }

  private monitorUrlChanges(): void {
    this.lastKnownUrl = window.location.href;

    const handleChange = () => {
      void this.onUrlChanged(window.location.href);
    };

    if (!WatchPartyContent.historyPatched) {
      const wrapHistoryMethod = (method: 'pushState' | 'replaceState') => {
        const original = history[method] as typeof history.pushState;
        history[method] = function (...args: Parameters<typeof history.pushState>) {
          const result = original.apply(this, args);
          handleChange();
          return result;
        } as typeof history.pushState;
      };

      wrapHistoryMethod('pushState');
      wrapHistoryMethod('replaceState');
      WatchPartyContent.historyPatched = true;
    }

    window.addEventListener('popstate', handleChange);

    if (this.urlObserverId !== null) {
      window.clearInterval(this.urlObserverId);
    }

    this.urlObserverId = window.setInterval(() => {
      if (window.location.href !== this.lastKnownUrl) {
        handleChange();
      }
    }, 1000);
  }

  private async onUrlChanged(newUrl: string): Promise<void> {
    if (newUrl === this.lastKnownUrl) {
      return;
    }

    this.lastKnownUrl = newUrl;

    if (this.navigationInProgress) {
      this.navigationInProgress = false;
      this.log('🔁 Navigation completed from sync; skipping broadcast');
      return;
    }

    if (!this.socket?.connected) {
      if (!this.isHost) {
        await this.handleDeepLink();
      }
      return;
    }

    if (!this.isHost) {
      this.log('🙅‍♀️ Ignoring URL change (not host)');
      await this.handleDeepLink();
      return;
    }

    if (this.currentRoom) {
      const normalizedUrl = this.ensureShareLink(this.currentRoom);
      newUrl = normalizedUrl;
    }

    this.lastBroadcastUrl = null;
    this.broadcastCurrentUrl(newUrl);
  }

  private async handleDeepLink(): Promise<void> {
    const roomFromUrl = this.getRoomIdFromUrl(window.location.href);

    if (!roomFromUrl) {
      return;
    }

    if (this.currentRoom === roomFromUrl && this.socket) {
      return;
    }

    const roomIdInput = this.getInput('wp-room-id');
    if (roomIdInput) {
      roomIdInput.value = roomFromUrl;
    }

    if (this.authToken && this.currentRoom === roomFromUrl) {
      await this.connectToRoom(this.authToken);
      return;
    }

    await this.joinRoomById(roomFromUrl, {silent: true});
  }

  private navigateToUrl(targetUrl: string): void {
    if (!targetUrl) {
      return;
    }

    const effectiveUrl = this.currentRoom
      ? this.applyRoomParamToUrl(targetUrl, this.currentRoom)
      : targetUrl;

    if (effectiveUrl === window.location.href) {
      this.lastKnownUrl = window.location.href;
      this.currentRoomUrl = effectiveUrl;
      return;
    }

    this.log('🌐 Syncing page location to:', effectiveUrl);
    this.navigationInProgress = true;
    this.lastKnownUrl = effectiveUrl;
    this.currentRoomUrl = effectiveUrl;
    window.location.href = effectiveUrl;
  }

  private syncRoomUrl(targetUrl: string): void {
    if (!targetUrl) {
      return;
    }

    const normalizedUrl = this.currentRoom
      ? this.applyRoomParamToUrl(targetUrl, this.currentRoom)
      : targetUrl;

    if (normalizedUrl === window.location.href) {
      this.lastKnownUrl = normalizedUrl;
      this.currentRoomUrl = normalizedUrl;
      return;
    }

    if (this.isHost && this.currentRoom) {
      this.ensureShareLink(this.currentRoom);
      this.currentRoomUrl = normalizedUrl;
      return;
    }

    this.currentRoomUrl = normalizedUrl;
    this.navigateToUrl(normalizedUrl);
  }

  private applyRoomParamToUrl(targetUrl: string, roomId: string | null): string {
    if (!roomId) {
      return targetUrl;
    }

    try {
      const parsed = new URL(targetUrl, window.location.origin);
      const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      hashParams.set(WatchPartyContent.ROOM_HASH_KEY, roomId);
      const newHash = hashParams.toString();
      parsed.hash = newHash ? `#${newHash}` : '';
      return parsed.toString();
    } catch (error) {
      this.log('Failed to apply room param to url:', error);
      return targetUrl;
    }
  }

  private ensureShareLink(roomId: string | null): string {
    if (!roomId) {
      return window.location.href;
    }

    const targetUrl = this.applyRoomParamToUrl(window.location.href, roomId);

    if (targetUrl !== window.location.href) {
      try {
        window.history.replaceState(window.history.state, '', targetUrl);
      } catch (error) {
        this.log('Failed to update history for share link:', error);
      }
      if (this.isHost) {
        this.lastBroadcastUrl = null;
      }
    }

    this.lastKnownUrl = targetUrl;
    this.currentRoomUrl = targetUrl;
    return targetUrl;
  }

  private clearShareLink(): void {
    try {
      const parsed = new URL(window.location.href);
      const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      if (!hashParams.has(WatchPartyContent.ROOM_HASH_KEY)) {
        return;
      }
      hashParams.delete(WatchPartyContent.ROOM_HASH_KEY);
      const newHash = hashParams.toString();
      parsed.hash = newHash ? `#${newHash}` : '';
      const newUrl = parsed.toString();
      window.history.replaceState(window.history.state, '', newUrl);
      this.lastKnownUrl = newUrl;
      this.currentRoomUrl = null;
    } catch (error) {
      this.log('Failed to clear share link:', error);
    }
  }

  private getRoomIdFromUrl(targetUrl: string): string | null {
    try {
      const parsed = new URL(targetUrl, window.location.origin);
      const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      const hashRoom = hashParams.get(WatchPartyContent.ROOM_HASH_KEY);
      if (hashRoom) {
        return hashRoom;
      }
      const queryRoom = parsed.searchParams.get(WatchPartyContent.ROOM_HASH_KEY);
      return queryRoom ?? null;
    } catch (error) {
      this.log('Failed to read room id from url:', error);
      return null;
    }
  }

  private async copyShareLink(): Promise<void> {
    const shareUrl = this.getShareUrl();
    if (!shareUrl) {
      this.showShareFeedback('共有リンクを生成できません', true);
      return;
    }

    let copied = false;

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        copied = true;
      } catch (error) {
        this.log('Clipboard API failed:', error);
      }
    }

    if (!copied) {
      const textArea = document.createElement('textarea');
      textArea.value = shareUrl;
      textArea.style.position = 'fixed';
      textArea.style.top = '-1000px';
      textArea.style.left = '-1000px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        copied = document.execCommand('copy');
      } catch (error) {
        this.log('execCommand copy failed:', error);
        copied = false;
      }
      document.body.removeChild(textArea);
    }

    if (copied) {
      this.showShareFeedback('共有リンクをコピーしました');
    } else {
      this.showShareFeedback('コピーに失敗しました', true);
    }
  }

  private getShareUrl(): string | null {
    if (!this.currentRoom) {
      return null;
    }

    if (this.isHost) {
      return this.ensureShareLink(this.currentRoom);
    }

    return this.applyRoomParamToUrl(window.location.href, this.currentRoom);
  }

  private broadcastCurrentUrl(explicitUrl?: string): void {
    if (!this.socket?.connected || !this.isHost || !this.currentRoom) {
      return;
    }

    const urlToSend = explicitUrl ?? this.ensureShareLink(this.currentRoom);
    if (!urlToSend) {
      return;
    }

    if (this.lastBroadcastUrl === urlToSend) {
      return;
    }

    this.lastBroadcastUrl = urlToSend;
    this.currentRoomUrl = urlToSend;
    this.log('🌐 Broadcasting current URL:', urlToSend);
    this.socket.emit('navigate', {url: urlToSend});
  }

  private updateShareControls(forceVisible?: boolean): void {
    const shareContainer = document.getElementById('wp-share-controls');
    const shareButton = document.getElementById('wp-share-room') as HTMLButtonElement | null;
    if (!shareContainer || !shareButton) {
      return;
    }

    const available = typeof forceVisible === 'boolean' ? forceVisible : Boolean(this.currentRoom);
    shareContainer.classList.toggle('hidden', !available);
    shareButton.disabled = !available;
    if (!available) {
      shareButton.setAttribute('aria-disabled', 'true');
      this.hideShareFeedback();
    } else {
      shareButton.removeAttribute('aria-disabled');
    }
  }

  private showShareFeedback(message: string, isError = false): void {
    const feedback = document.getElementById('wp-share-feedback');
    if (!feedback) {
      return;
    }

    feedback.textContent = message;
    feedback.classList.toggle('error', isError);
    feedback.classList.add('show');

    if (this.shareFeedbackTimeout) {
      window.clearTimeout(this.shareFeedbackTimeout);
    }

    this.shareFeedbackTimeout = window.setTimeout(() => {
      feedback.classList.remove('show');
      this.shareFeedbackTimeout = null;
    }, 2000);
  }

  private hideShareFeedback(): void {
    const feedback = document.getElementById('wp-share-feedback');
    if (!feedback) {
      return;
    }

    feedback.classList.remove('show', 'error');
    if (this.shareFeedbackTimeout) {
      window.clearTimeout(this.shareFeedbackTimeout);
      this.shareFeedbackTimeout = null;
    }
  }

  private async resolveTabId(): Promise<number> {
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
  }

  private getInput(id: string): HTMLInputElement | null {
    const element = document.getElementById(id);
    if (!element) {
      return null;
    }
    if (element instanceof HTMLInputElement) {
      return element;
    }
    return null;
  }
}

new WatchPartyContent();
