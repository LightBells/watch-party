import type {WatchPartyContent} from '../watchPartyContent';

import {MEMBER_HEARTBEAT_INTERVAL, VIDEO_SELECTORS} from '../constants';
import type {PlaybackStatus, VideoState} from '../types';

export type VideoFeature = {
  isPlaybackControlTarget(this: WatchPartyContent, target: EventTarget | null): boolean;
  isViableVideoElement(this: WatchPartyContent, element: HTMLVideoElement): boolean;
  findVideoElementCandidate(
    this: WatchPartyContent,
    root: Document | ShadowRoot,
    visited?: Set<Document | ShadowRoot>,
  ): HTMLVideoElement | null;
  updateHostHeartbeat(this: WatchPartyContent): void;
  startHostUrlHeartbeat(this: WatchPartyContent): void;
  stopHostUrlHeartbeat(this: WatchPartyContent): void;
  startMemberHeartbeat(this: WatchPartyContent): void;
  stopMemberHeartbeat(this: WatchPartyContent): void;
  detectVideoElement(this: WatchPartyContent): Promise<void>;
  handleVideoElementDetected(this: WatchPartyContent, videoElement: HTMLVideoElement): void;
  monitorVideoElementChanges(this: WatchPartyContent): Promise<void>;
  teardownVideoListeners(this: WatchPartyContent): void;
  enforcePauseWhileAwaiting(this: WatchPartyContent): void;
  syncLocalPlaybackStatus(this: WatchPartyContent, status: PlaybackStatus): void;
  setupVideoListeners(this: WatchPartyContent, video: HTMLVideoElement): void;
  getCurrentPlaybackTime(this: WatchPartyContent): number | null;
  flushPendingVideoState(this: WatchPartyContent): void;
  broadcastHostVideoState(this: WatchPartyContent, reason: string): void;
  applyRoomVideoState(this: WatchPartyContent, videoState?: VideoState | null): void;
  syncVideo(this: WatchPartyContent, isPlaying: boolean, currentTime: number, lastUpdateTime?: number): void;
};

export const videoFeature: VideoFeature = {
  isPlaybackControlTarget(this: WatchPartyContent, target: EventTarget | null): boolean {
    if (!this.videoElement || !(target instanceof Element)) {
      return false;
    }

    if (target === this.videoElement) {
      return true;
    }

    const candidates: Element[] = [];
    const directParent = this.videoElement.parentElement;
    if (directParent) {
      candidates.push(directParent);
    }

    const labeledAncestor = this.videoElement.closest(
      '.atvwebplayersdk-player-container, .atvwebplayersdk-player, .atvwebplayersdk-video-surface, [data-testid="video-player"], .video-player',
    );
    if (labeledAncestor instanceof Element) {
      candidates.push(labeledAncestor);
    }

    return candidates.some((candidate) => candidate.contains(target));
  },

  isViableVideoElement(this: WatchPartyContent, element: HTMLVideoElement): boolean {
    const rect = element.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 60) {
      return false;
    }

    if (!Number.isFinite(element.duration) && element.readyState === 0 && rect.width === 0) {
      return false;
    }

    const hiddenContainer = element.closest('[aria-hidden="true"], [role="presentation"], [hidden]');
    if (hiddenContainer) {
      return false;
    }

    return true;
  },

  findVideoElementCandidate(
    this: WatchPartyContent,
    root: Document | ShadowRoot,
    visited = new Set<Document | ShadowRoot>(),
  ): HTMLVideoElement | null {
    if (visited.has(root)) {
      return null;
    }

    visited.add(root);

    for (const selector of VIDEO_SELECTORS) {
      const elements = Array.from(root.querySelectorAll(selector));
      for (const element of elements) {
        if (element instanceof HTMLVideoElement && this.isViableVideoElement(element)) {
          return element;
        }
      }
    }

    const fallbackVideos = Array.from(root.querySelectorAll('video')) as HTMLVideoElement[];
    const viableFallback = fallbackVideos.find((video) => this.isViableVideoElement(video));
    if (viableFallback) {
      return viableFallback;
    }

    const elementsWithShadow = Array.from(root.querySelectorAll<HTMLElement>('*')).filter(
      (element) => Boolean(element.shadowRoot),
    );

    for (const element of elementsWithShadow) {
      const shadowRoot = element.shadowRoot;
      if (!shadowRoot) {
        continue;
      }
      const shadowVideo = this.findVideoElementCandidate(shadowRoot, visited);
      if (shadowVideo) {
        return shadowVideo;
      }
    }

    const iframeElements = Array.from(root.querySelectorAll<HTMLIFrameElement>('iframe'));
    for (const iframe of iframeElements) {
      try {
        const frameDocument = iframe.contentDocument ?? iframe.contentWindow?.document ?? null;
        if (!frameDocument) {
          continue;
        }
        const frameVideo = this.findVideoElementCandidate(frameDocument, visited);
        if (frameVideo) {
          return frameVideo;
        }
      } catch (error) {
        this.log('Skipping iframe during video detection (likely cross-origin)', error);
      }
    }

    return null;
  },

  updateHostHeartbeat(this: WatchPartyContent): void {
    if (this.isHost) {
      this.startHostUrlHeartbeat();
    } else {
      this.stopHostUrlHeartbeat();
    }
  },

  startHostUrlHeartbeat(this: WatchPartyContent): void {
    if (this.hostUrlHeartbeatId !== null) {
      return;
    }

    this.debugNavigation('hostHeartbeat:start');
    this.hostUrlHeartbeatId = window.setInterval(() => {
      if (!this.isHost || !this.socket?.connected || !this.currentRoom) {
        return;
      }

      if (this.navigationInProgress) {
        return;
      }

      const shareCandidate = this.applyRoomParamToUrl(window.location.href, this.currentRoom);
      const lastBroadcastUrl = this.lastBroadcastUrl;
      const urlsEquivalent = lastBroadcastUrl
        ? this.urlsEquivalentForSync(shareCandidate, lastBroadcastUrl)
        : false;

      this.debugNavigation('hostHeartbeat:tick', {
        shareCandidate,
        lastBroadcastUrl,
        urlsEquivalent,
      });

      if (urlsEquivalent) {
        return;
      }

      this.debugNavigation('hostHeartbeat:rebroadcast', {
        shareCandidate,
        lastBroadcastUrl,
      });
      this.broadcastCurrentUrl(shareCandidate);
    }, 2000);
  },

  stopHostUrlHeartbeat(this: WatchPartyContent): void {
    if (this.hostUrlHeartbeatId === null) {
      return;
    }

    this.debugNavigation('hostHeartbeat:stop');
    window.clearInterval(this.hostUrlHeartbeatId);
    this.hostUrlHeartbeatId = null;
  },

  startMemberHeartbeat(this: WatchPartyContent): void {
    if (this.memberHeartbeatIntervalId !== null) {
      return;
    }

    const sendHeartbeat = (): void => {
      if (!this.socket?.connected) {
        return;
      }

      this.socket.emit('heartbeat');
    };

    sendHeartbeat();
    this.memberHeartbeatIntervalId = window.setInterval(sendHeartbeat, MEMBER_HEARTBEAT_INTERVAL);
  },

  stopMemberHeartbeat(this: WatchPartyContent): void {
    if (this.memberHeartbeatIntervalId === null) {
      return;
    }

    window.clearInterval(this.memberHeartbeatIntervalId);
    this.memberHeartbeatIntervalId = null;
  },

  async detectVideoElement(this: WatchPartyContent): Promise<void> {
    this.log('🔍 Detecting video element...');

    while (true) {
      const candidate = this.findVideoElementCandidate(document);
      if (candidate) {
        this.handleVideoElementDetected(candidate);
        break;
      }

      this.log('⏳ No video element found, retrying in 1 second...');
      await this.delay(1000);
    }

    void this.monitorVideoElementChanges();
  },

  handleVideoElementDetected(this: WatchPartyContent, videoElement: HTMLVideoElement): void {
    if (this.videoElement === videoElement) {
      return;
    }

    this.teardownVideoListeners();

    this.videoElement = videoElement;

    this.log('✅ Video element bound:', videoElement);
    this.log('📹 Video properties:', {
      duration: videoElement.duration,
      currentTime: videoElement.currentTime,
      paused: videoElement.paused,
      readyState: videoElement.readyState,
    });

    this.setupCommentOverlay();
    this.flushPendingVideoState();
    if (!this.isHost && this.currentRoom) {
      this.syncLocalPlaybackStatus(this.roomPlaybackStatus);
    }
    this.broadcastHostVideoState('video-ready');
    this.setupVideoListeners(videoElement);
  },

  async monitorVideoElementChanges(this: WatchPartyContent): Promise<void> {
    while (true) {
      await this.delay(1000);

      const candidate = this.findVideoElementCandidate(document);

      if (!candidate) {
        if (this.videoElement) {
          this.log('⚠️ Video element missing; awaiting replacement');
          this.teardownVideoListeners();
          this.videoElement = null;
        }
        continue;
      }

      if (candidate !== this.videoElement) {
        this.handleVideoElementDetected(candidate);
      }
    }
  },

  teardownVideoListeners(this: WatchPartyContent): void {
    if (this.videoEventListenerCleanups.length === 0) {
      this.videoEventListenersBoundElement = null;
      return;
    }

    this.videoEventListenerCleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch (error) {
        this.log('Failed to remove video event listener', error);
      }
    });
    this.videoEventListenerCleanups = [];
    this.videoEventListenersBoundElement = null;
  },

  enforcePauseWhileAwaiting(this: WatchPartyContent): void {
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
  },

  syncLocalPlaybackStatus(this: WatchPartyContent, status: PlaybackStatus): void {
    if (!this.videoElement) {
      return;
    }

    if (status === 'paused' && !this.videoElement.paused) {
      this.log('⏸️ Pausing local playback to match room status');
      this.videoElement.pause();
    }
  },

  setupVideoListeners(this: WatchPartyContent, video: HTMLVideoElement): void {
    if (this.videoEventListenersBoundElement === video) {
      return;
    }

    this.teardownVideoListeners();

    this.log('🎧 Setting up video event listeners...');

    const playbackKeys = new Set([' ', 'Spacebar', 'Enter', 'MediaPlayPause', 'k', 'K']);

    const handlePointerDown = (event: PointerEvent): void => {
      if (this.isPlaybackControlTarget(event.target) || event.composedPath().includes(this.videoElement as EventTarget)) {
        this.recordUserInteraction();
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!playbackKeys.has(event.key)) {
        return;
      }

      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) {
          return;
        }
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.closest('#wp-room-popup, #wp-comment-input')) {
          return;
        }
      }

      this.recordUserInteraction();
    };

    const handlePlay = () => {
      if (this.videoElement !== video) {
        return;
      }

      this.log('🎬 Play event detected!', {
        socketConnected: Boolean(this.socket?.connected),
        syncInProgress: this.syncInProgress,
        currentTime: this.videoElement?.currentTime,
      });

      const userInitiatedPlay = this.hasRecentUserInteraction();

      if (
        !this.isHost &&
        this.isConnectedToRoom() &&
        this.roomPlaybackStatus === 'paused' &&
        !userInitiatedPlay
      ) {
        this.log('🚫 Blocking play emit because room is paused and no recent user interaction was detected');
        this.syncLocalPlaybackStatus('paused');
        return;
      }

      if (userInitiatedPlay) {
        this.lastUserInteractionAt = 0;
      }

      if (this.socket && this.socket.connected && !this.syncInProgress && this.shouldEmitPlaybackEvents()) {
        this.roomPlaybackStatus = 'playing';
        this.socket.emit('play', {
          currentTime: video.currentTime,
          userId: this.currentUser ?? undefined,
        });
        this.log('📤 Sent play event to server');
      }
    };

    const handlePause = () => {
      if (this.videoElement !== video) {
        return;
      }

      this.log('⏸️ Pause event detected!', {
        socketConnected: Boolean(this.socket?.connected),
        syncInProgress: this.syncInProgress,
        currentTime: this.videoElement?.currentTime,
      });

      if (this.socket && this.socket.connected && !this.syncInProgress && this.shouldEmitPlaybackEvents()) {
        this.roomPlaybackStatus = 'paused';
        this.socket.emit('pause', {
          currentTime: video.currentTime,
          userId: this.currentUser ?? undefined,
        });
        this.log('📤 Sent pause event to server');
      }
    };

    const handleSeeked = () => {
      if (this.videoElement !== video) {
        return;
      }

      this.log('⏭️ Seeked event detected!', {
        socketConnected: Boolean(this.socket?.connected),
        syncInProgress: this.syncInProgress,
        currentTime: this.videoElement?.currentTime,
        paused: this.videoElement?.paused,
      });

      if (this.socket && this.socket.connected && !this.syncInProgress && this.shouldEmitPlaybackEvents()) {
        this.socket.emit('sync', {
          isPlaying: !video.paused,
          currentTime: video.currentTime,
          userId: this.currentUser ?? undefined,
        });
        this.log('📤 Sent sync event to server');
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);

    video.addEventListener('play', handlePlay, true);
    video.addEventListener('pause', handlePause, true);
    video.addEventListener('seeked', handleSeeked, true);

    this.videoEventListenerCleanups = [
      () => document.removeEventListener('pointerdown', handlePointerDown, true),
      () => document.removeEventListener('keydown', handleKeyDown, true),
      () => video.removeEventListener('play', handlePlay, true),
      () => video.removeEventListener('pause', handlePause, true),
      () => video.removeEventListener('seeked', handleSeeked, true),
    ];

    this.videoEventListenersBoundElement = video;
  },

  getCurrentPlaybackTime(this: WatchPartyContent): number | null {
    if (this.videoElement) {
      const currentTime = this.videoElement.currentTime;
      if (Number.isFinite(currentTime)) {
        return Math.max(0, currentTime);
      }
    }

    if (this.pendingVideoState && Number.isFinite(this.pendingVideoState.currentTime)) {
      return Math.max(0, this.pendingVideoState.currentTime);
    }

    return null;
  },

  flushPendingVideoState(this: WatchPartyContent): void {
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
  },

  broadcastHostVideoState(this: WatchPartyContent, reason: string): void {
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
  },

  applyRoomVideoState(this: WatchPartyContent, videoState?: VideoState | null): void {
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
  },

  syncVideo(this: WatchPartyContent, isPlaying: boolean, currentTime: number, lastUpdateTime = Date.now()): void {
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
  },
};
