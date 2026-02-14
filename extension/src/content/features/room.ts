import {io} from 'socket.io-client';

import type {WatchPartyContent} from '../watchPartyContent';
import type {
  CommentPayload,
  NavigateEventPayload,
  PlaybackStatus,
  RoomMember,
  RoomStatePayload,
  VideoState,
} from '../types';

export type RoomFeature = {
  joinRoom(this: WatchPartyContent): Promise<void>;
  createRoom(this: WatchPartyContent): Promise<void>;
  joinRoomById(this: WatchPartyContent, roomId: string, options?: {silent?: boolean}): Promise<void>;
  leaveRoom(this: WatchPartyContent): Promise<void>;
  connectToRoom(this: WatchPartyContent, token: string): Promise<void>;
};

export const roomFeature: RoomFeature = {
  async joinRoom(this: WatchPartyContent): Promise<void> {
    const roomIdInput = this.getInput('wp-room-id');
    const roomId = roomIdInput?.value.trim();

    if (!roomId) {
      window.alert('ルームIDを入力してください');
      return;
    }

    await this.joinRoomById(roomId);
  },

  async createRoom(this: WatchPartyContent): Promise<void> {
    const roomId = this.generateRoomId();
    const roomInput = this.getInput('wp-room-id');
    if (roomInput) {
      roomInput.value = roomId;
    }
    await this.joinRoomById(roomId);
  },

  async joinRoomById(
    this: WatchPartyContent,
    roomId: string,
    options: {silent?: boolean} = {},
  ): Promise<void> {
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
        playbackStatus?: PlaybackStatus;
        videoState?: VideoState;
        currentUrl?: string | null;
      };

      this.authToken = data.token;
      const playbackStatus = data.playbackStatus ?? 'paused';
      this.roomPlaybackStatus = playbackStatus;

      await this.saveRoomData(data.roomId, data.token, data.userId, username, data.isHost);

      this.currentRoom = data.roomId;
      this.currentUser = data.userId;
      this.username = username;
      this.isHost = data.isHost;
      this.awaitingInitialState = !this.isHost;
      this.initialVideoStateApplied = this.isHost;
      this.updateHostHeartbeat();

      if (!this.isHost) {
        this.enforcePauseWhileAwaiting();
        if (playbackStatus === 'paused') {
          this.syncLocalPlaybackStatus('paused');
        }

        if (data.videoState) {
          this.pendingVideoState = {...data.videoState};
          this.flushPendingVideoState();
        }
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
  },

  async leaveRoom(this: WatchPartyContent): Promise<void> {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.stopMemberHeartbeat();

    await this.removeRoomData();

    this.currentRoom = null;
    this.currentUser = null;
    this.username = null;
    this.isHost = false;
    this.stopHostUrlHeartbeat();
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
  },

  async connectToRoom(this: WatchPartyContent, token: string): Promise<void> {
    if (this.socket) {
      this.stopMemberHeartbeat();
      this.socket.disconnect();
    }

    this.authToken = token;

    this.socket = io(this.serverUrl, {
      auth: {token},
      transports: ['polling'],
    });

    this.socket.on('connect', () => {
      this.debugNavigation('socket:connect', {
        roomId: this.currentRoom,
        userId: this.currentUser,
        isHost: this.isHost,
      });
      this.log('🔗 Connected to room:', this.currentRoom);
      this.log('👤 User ID:', this.currentUser);
      this.updateStatus('接続中');
      this.showRoomInfo();
      this.startMemberHeartbeat();
      if (this.isHost) {
        this.broadcastCurrentUrl();
        this.broadcastHostVideoState('socket-connect');
      } else {
        this.flushPendingVideoState();
      }
    });

    this.socket.on('disconnect', () => {
      this.debugNavigation('socket:disconnect', {
        roomId: this.currentRoom,
        userId: this.currentUser,
      });
      this.stopMemberHeartbeat();
      this.stopHostUrlHeartbeat();
      this.log('Disconnected from room');
      this.updateStatus('切断');
    });

    this.socket.on('room-state', (data: RoomStatePayload) => {
      this.debugNavigation('socket:room-state', {
        isHost: data.isHost,
        currentUrl: data.currentUrl ?? null,
        memberCount: data.members.length,
      });
      this.log('🏠 Room state received:', data);
      this.isHost = data.isHost;
      this.roomPlaybackStatus = data.playbackStatus;
      this.updateHostHeartbeat();
      this.log('👑 Host status updated:', this.isHost ? 'HOST' : 'MEMBER');
      this.updateStatus(this.isHost ? 'ホスト' : 'メンバー');
      this.updateMembers(data.members);
      if (!this.isHost) {
        this.syncLocalPlaybackStatus(data.playbackStatus);
      }
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
      this.roomPlaybackStatus = 'playing';
      if (data.userId !== this.currentUser) {
        this.syncVideo(true, data.currentTime, data.timestamp);
      }
    });

    this.socket.on('pause', (data: {currentTime: number; userId: string; timestamp: number}) => {
      this.log('📥 Received pause event:', data, 'fromUserId:', data.userId, 'myUserId:', this.currentUser);
      this.roomPlaybackStatus = 'paused';
      if (data.userId !== this.currentUser) {
        this.syncVideo(false, data.currentTime, data.timestamp);
      }
    });

    this.socket.on('sync', (data: {isPlaying: boolean; currentTime: number; userId: string; timestamp: number}) => {
      this.log('📥 Received sync event:', data, 'fromUserId:', data.userId, 'myUserId:', this.currentUser);
      this.roomPlaybackStatus = data.isPlaying ? 'playing' : 'paused';
      if (data.userId !== this.currentUser) {
        this.syncVideo(data.isPlaying, data.currentTime, data.timestamp);
      }
    });

    this.socket.on('comment', (data: CommentPayload) => {
      this.log('Received comment:', data);
      const isOwnComment = data.userId === this.currentUser;
      this.appendChatHistoryEntry(data);
      this.showComment(
        data.message,
        data.username || data.userId,
        isOwnComment,
        data.commands ?? undefined,
        data.mediaInfo ?? null,
      );

      void chrome.runtime.sendMessage({
        action: 'chatMessage',
        data,
      });
    });

    this.socket.on('comment-history', (items: CommentPayload[]) => {
      if (!Array.isArray(items) || items.length === 0) {
        return;
      }

      this.log('Received comment history batch:', items.length);
      this.setChatHistory(items);
      items.forEach((comment) => {
        void chrome.runtime.sendMessage({
          action: 'chatMessage',
          data: comment,
        });
      });
    });

    this.socket.on('user-joined', (data: {userId: string; members: RoomMember[]; timestamp: number}) => {
      const joinedMember = data.members.find((member) => member.id === data.userId);
      const previousStatusMap = new Map(
        this.members.map((member) => [member.id, member.status ?? 'offline']),
      );

      this.updateMembers(data.members);

      void chrome.runtime.sendMessage({
        action: 'roomStateUpdate',
        data: {
          members: this.members,
          isHost: this.isHost,
          currentUrl: this.currentRoomUrl,
        },
      });

      void chrome.runtime.sendMessage({
        action: 'chatMessage',
        data: {
          userId: 'システム',
          message: 'ユーザーが参加しました',
          timestamp: data.timestamp,
        },
      });

      if (joinedMember && data.userId !== this.currentUser) {
        const displayName = joinedMember.username || joinedMember.id;
        const previousStatus = previousStatusMap.get(data.userId);
        const isReturning = previousStatus === 'offline';
        if (isReturning) {
          this.showToast(`${displayName} がオンラインに復帰しました`, 'join');
        } else {
          this.showToast(`${displayName} が参加しました`, 'join');
        }
      }

    });

    this.socket.on('user-left', (data: {userId: string; members: RoomMember[]; timestamp: number}) => {
      const previousMembers = [...this.members];

      this.updateMembers(data.members);

      void chrome.runtime.sendMessage({
        action: 'roomStateUpdate',
        data: {
          members: this.members,
          isHost: this.isHost,
          currentUrl: this.currentRoomUrl,
        },
      });

      void chrome.runtime.sendMessage({
        action: 'chatMessage',
        data: {
          userId: 'システム',
          message: 'ユーザーが退出しました',
          timestamp: data.timestamp,
        },
      });

      const leavingMember = previousMembers.find((member) => member.id === data.userId);
      if (leavingMember) {
        const displayName = leavingMember.username || leavingMember.id;
        this.showToast(`${displayName} が退出しました`, 'leave');
      } else {
        this.showToast('メンバーが退出しました', 'leave');
      }
    });

    this.socket.on('host-changed', (data: {newHost: string; timestamp: number}) => {
      const becameHost = data.newHost === this.currentUser;
      this.debugNavigation('socket:host-changed', {
        newHost: data.newHost,
        currentUser: this.currentUser,
        becameHost,
      });
      this.isHost = becameHost;
      this.updateHostHeartbeat();
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
      this.debugNavigation('socket:navigate', {
        dataUrl: data.url,
        dataUserId: data.userId,
        currentUser: this.currentUser,
      });
      this.log('📥 Received navigate event:', data);
      if (data.userId === this.currentUser) {
        return;
      }
      this.currentRoomUrl = data.url;
      this.syncRoomUrl(data.url);
    });

    this.socket.on('member-status', (data: {members: RoomMember[]; changedUserId: string | null; timestamp?: number}) => {
      const previousMembers = this.members.map((member) => ({...member}));

      this.updateMembers(data.members);

      this.notifyStatusTransitions(previousMembers, this.members, data.changedUserId);

      void chrome.runtime.sendMessage({
        action: 'roomStateUpdate',
        data: {
          members: this.members,
          isHost: this.isHost,
          currentUrl: this.currentRoomUrl ?? null,
        },
      });
    });
  },
};
