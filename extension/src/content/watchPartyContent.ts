import type {Socket} from 'socket.io-client';

import {
  DEVELOPMENT_SERVER_URL,
  MEMBER_HEARTBEAT_INTERVAL,
  PRODUCTION_SERVER_URL,
  ROOM_HASH_KEY,
} from './constants';
import type {ChatDisplayMode, PlaybackStatus, RoomMember, VideoState} from './types';
import {chatFeature, type ChatFeature} from './features/chat';
import {coreFeature, type CoreFeature} from './features/core';
import {navigationFeature, type NavigationFeature} from './features/navigation';
import {roomFeature, type RoomFeature} from './features/room';
import {storageFeature, type StorageFeature} from './features/storage';
import {uiFeature, type UiFeature} from './features/ui';
import {videoFeature, type VideoFeature} from './features/video';

class WatchPartyContent {
  public static readonly ROOM_HASH_KEY = ROOM_HASH_KEY;

  public static readonly MEMBER_HEARTBEAT_INTERVAL = MEMBER_HEARTBEAT_INTERVAL;

  public static historyPatched = false;

  protected socket: Socket | null = null;

  protected videoElement: HTMLVideoElement | null = null;

  protected isHost = false;

  protected currentRoom: string | null = null;

  protected currentUser: string | null = null;

  protected username: string | null = null;

  protected syncInProgress = false;

  protected lastSyncTime = 0;

  protected pendingVideoState: VideoState | null = null;

  protected roomPlaybackStatus: PlaybackStatus = 'paused';

  protected members: RoomMember[] = [];

  protected debugMode = false;

  protected tabId: number | null = null;

  protected navigationInProgress = false;

  protected initialVideoStateApplied = false;

  protected awaitingInitialState = false;

  protected lastKnownUrl = window.location.href;

  protected urlObserverId: number | null = null;

  protected authToken: string | null = null;

  protected shareFeedbackTimeout: number | null = null;

  protected commentOverlay: HTMLDivElement | null = null;

  protected chatDisplayMode: ChatDisplayMode = 'overlay';

  protected chatSidebarContainer: HTMLDivElement | null = null;

  protected chatPanelOriginalParent: HTMLElement | null = null;

  protected chatToggleOriginalParent: HTMLElement | null = null;

  protected sidebarShiftTarget: HTMLElement | null = null;

  protected chatHistoryContainer: HTMLDivElement | null = null;

  protected chatHistoryBody: HTMLDivElement | null = null;

  protected chatHistoryList: HTMLUListElement | null = null;

  protected chatHistoryEmptyState: HTMLDivElement | null = null;

  protected chatHistoryToggle: HTMLButtonElement | null = null;

  protected chatHistoryToggleIcon: HTMLSpanElement | null = null;

  protected chatHistoryExpanded = false;

  protected chatHistoryEventsBound = false;

  protected chatHistoryNeedsScroll = false;

  protected overlayResizeObserver: ResizeObserver | null = null;

  protected videoEventListenersBoundElement: HTMLVideoElement | null = null;

  protected videoEventListenerCleanups: Array<() => void> = [];

  protected lastUserInteractionAt = 0;

  protected toastContainer: HTMLDivElement | null = null;

  protected readonly handleViewportChange = () => {
    window.requestAnimationFrame(() => this.updateCommentOverlayBounds());
  };

  protected readonly interceptCommentInputKeyEvent = (event: KeyboardEvent): void => {
    const commentInput = this.getInput('wp-comment-text');
    const commandInput = this.getInput('wp-command-text');

    if (!commentInput && !commandInput) {
      return;
    }

    const activeElement = document.activeElement;
    if (activeElement !== commentInput && activeElement !== commandInput) {
      return;
    }

    if (event.isComposing || event.key === 'Process') {
      event.stopImmediatePropagation();
      event.stopPropagation();
      return;
    }

    if (
      event.type === 'keydown' &&
      (event.key === 'Enter' || event.key === 'NumpadEnter') &&
      !event.repeat
    ) {
      event.preventDefault();
      if (activeElement === commandInput) {
        commentInput?.focus();
      } else {
        this.sendComment();
      }
    }

    event.stopImmediatePropagation();
    event.stopPropagation();
  };

  protected commentInputProtectionInitialized = false;

  protected lastBroadcastUrl: string | null = null;

  protected currentRoomUrl: string | null = null;

  protected hostUrlHeartbeatId: number | null = null;

  protected memberHeartbeatIntervalId: number | null = null;

  protected readonly serverUrl: string;

  constructor() {
    this.serverUrl = window.location.href.includes('localhost')
      ? DEVELOPMENT_SERVER_URL
      : PRODUCTION_SERVER_URL;

    this.lastKnownUrl = window.location.href;

    void this.init();
  }
}

interface WatchPartyContent
  extends CoreFeature,
    VideoFeature,
    RoomFeature,
    ChatFeature,
    UiFeature,
    NavigationFeature,
    StorageFeature {}

const featureModules = [
  coreFeature,
  videoFeature,
  roomFeature,
  chatFeature,
  uiFeature,
  navigationFeature,
  storageFeature,
] as const;

featureModules.forEach((feature) => {
  Object.assign(WatchPartyContent.prototype, feature);
});

export {WatchPartyContent};
