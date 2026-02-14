import type {WatchPartyContent} from '../watchPartyContent';

import type {RoomMember} from '../types';

const VIDEO_SIDEBAR_SHIFT_TARGET_SELECTOR =
  '.atvwebplayersdk-player-container, .atvwebplayersdk-player, .atvwebplayersdk-video-surface, [data-testid="video-player"], .video-player, #dv-web-player';

type SidebarLayoutState = {
  chatSidebarContainer: HTMLDivElement | null;
  chatPanelOriginalParent: HTMLElement | null;
  chatToggleOriginalParent: HTMLElement | null;
  sidebarShiftTarget: HTMLElement | null;
  videoElement: HTMLVideoElement | null;
  chatDisplayMode: 'overlay' | 'sidebar';
};

const ensureCommentSidebarContainer = (context: WatchPartyContent): HTMLDivElement | null => {
  const state = context as unknown as SidebarLayoutState;
  if (state.chatSidebarContainer && document.body.contains(state.chatSidebarContainer)) {
    return state.chatSidebarContainer;
  }

  if (!document.body) {
    return null;
  }

  const existing = document.getElementById('wp-comment-sidebar');
  if (existing) {
    state.chatSidebarContainer = existing as HTMLDivElement;
    return state.chatSidebarContainer;
  }

  const sidebar = document.createElement('div');
  sidebar.id = 'wp-comment-sidebar';
  sidebar.className = 'wp-comment-sidebar hidden';
  document.body.appendChild(sidebar);
  state.chatSidebarContainer = sidebar;
  return sidebar;
};

const resolveSidebarShiftTarget = (context: WatchPartyContent): HTMLElement | null => {
  const state = context as unknown as SidebarLayoutState;
  if (!state.videoElement) {
    return null;
  }

  const container = state.videoElement.closest(VIDEO_SIDEBAR_SHIFT_TARGET_SELECTOR);
  if (container) {
    return container as HTMLElement;
  }

  if (state.videoElement.parentElement) {
    return state.videoElement.parentElement as HTMLElement;
  }

  return state.videoElement as unknown as HTMLElement;
};

const applyVideoOnlySidebarShift = (context: WatchPartyContent, isOpen: boolean): void => {
  const state = context as unknown as SidebarLayoutState;
  const nextTarget = resolveSidebarShiftTarget(context);

  if (state.sidebarShiftTarget && state.sidebarShiftTarget !== nextTarget) {
    state.sidebarShiftTarget.classList.remove('wp-video-sidebar-shifted');
  }

  state.sidebarShiftTarget = nextTarget;

  if (!state.sidebarShiftTarget) {
    return;
  }

  state.sidebarShiftTarget.classList.toggle(
    'wp-video-sidebar-shifted',
    state.chatDisplayMode === 'sidebar' && isOpen,
  );
};

const showCommentPanelInSidebar = (context: WatchPartyContent): void => {
  const state = context as unknown as SidebarLayoutState;
  const panel = document.getElementById('wp-comment-panel');
  const toggleButton = document.getElementById('wp-toggle-comment');
  const toggleWrap = toggleButton?.parentElement as HTMLDivElement | null;
  const commentInputRoot = document.getElementById('wp-comment-input');
  const sidebar = ensureCommentSidebarContainer(context);
  if (!panel || !toggleWrap || !commentInputRoot || !sidebar) {
    return;
  }

  if (!state.chatPanelOriginalParent) {
    state.chatPanelOriginalParent = commentInputRoot;
  }
  if (!state.chatToggleOriginalParent) {
    state.chatToggleOriginalParent = toggleWrap.parentElement;
  }

  sidebar.appendChild(toggleWrap);
  sidebar.appendChild(panel);
  sidebar.classList.remove('hidden');
  panel.classList.remove('hidden');
  commentInputRoot.classList.remove('expanded');
  applyVideoOnlySidebarShift(context, true);
};

const hideCommentPanelFromSidebar = (context: WatchPartyContent): void => {
  const state = context as unknown as SidebarLayoutState;
  const panel = document.getElementById('wp-comment-panel');
  const toggleButton = document.getElementById('wp-toggle-comment');
  const toggleWrap = toggleButton?.parentElement as HTMLDivElement | null;
  const commentInputRoot = document.getElementById('wp-comment-input');
  const sidebar = ensureCommentSidebarContainer(context);
  if (!panel || !toggleWrap || !commentInputRoot || !sidebar) {
    return;
  }

  panel.classList.add('hidden');
  const fallbackParent = document.getElementById('wp-comment-input');
  const restoreParent = state.chatPanelOriginalParent ?? fallbackParent;
  if (restoreParent) {
    restoreParent.appendChild(panel);
  }
  const toggleRestoreParent = state.chatToggleOriginalParent ?? fallbackParent;
  if (toggleRestoreParent) {
    toggleRestoreParent.appendChild(toggleWrap);
  }

  sidebar.classList.add('hidden');
  commentInputRoot.classList.remove('expanded');
  applyVideoOnlySidebarShift(context, false);
};

export type UiFeature = {
  createWatchPartyUI(this: WatchPartyContent): void;
  bindUIEvents(this: WatchPartyContent): void;
  setupCommentInputProtection(this: WatchPartyContent): void;
  toggleRoomPopup(this: WatchPartyContent): void;
  hideRoomPopup(this: WatchPartyContent): void;
  toggleCommentPanel(this: WatchPartyContent): void;
  showRoomInfo(this: WatchPartyContent): void;
  showRoomSetup(this: WatchPartyContent): void;
  updateStatus(this: WatchPartyContent, status: string): void;
  updateMembers(this: WatchPartyContent, members: RoomMember[]): void;
  ensureToastContainer(this: WatchPartyContent): HTMLDivElement | null;
  showToast(this: WatchPartyContent, message: string, type?: 'join' | 'leave' | 'info'): void;
  notifyStatusTransitions(
    this: WatchPartyContent,
    previous: RoomMember[],
    current: RoomMember[],
    changedUserId: string | null,
  ): void;
};

export const uiFeature: UiFeature = {
  createWatchPartyUI(this: WatchPartyContent): void {
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
          <span class="wp-toggle-icon">‹</span>
        </button>
      </div>
      <div class="wp-comment-panel hidden" id="wp-comment-panel">
        <div class="wp-chat-history" id="wp-chat-history">
          <div class="wp-chat-history-header">
            <button id="wp-chat-history-toggle" class="wp-chat-history-toggle" aria-expanded="false" type="button">
              <span class="wp-chat-history-toggle-label">コメント履歴</span>
              <span class="wp-chat-history-toggle-icon" id="wp-chat-history-toggle-icon">▸</span>
            </button>
          </div>
          <div class="wp-chat-history-body" id="wp-chat-history-body">
            <button
              id="wp-chat-history-new-indicator"
              class="wp-chat-history-new-indicator hidden"
              type="button"
            >
              新着メッセージがあります
            </button>
            <div class="wp-chat-history-empty" id="wp-chat-history-empty">コメントはまだありません</div>
            <ul class="wp-chat-history-list" id="wp-chat-history-list"></ul>
          </div>
        </div>
        <div class="wp-comment-form">
          <input type="text" id="wp-command-text" placeholder="コマンド (例: red big)" autocomplete="off">
          <input type="text" id="wp-comment-text" placeholder="コメントを入力...">
          <button id="wp-send-comment" class="wp-btn wp-btn-primary">送信</button>
        </div>
      </div>
    `;

    document.body.appendChild(floatingButton);
    document.body.appendChild(roomPopup);
    document.body.appendChild(commentInput);
    this.chatPanelOriginalParent = commentInput;
    this.chatToggleOriginalParent = commentInput;

    this.chatHistoryContainer = commentInput.querySelector('#wp-chat-history') as HTMLDivElement | null;
    this.chatHistoryBody = commentInput.querySelector('#wp-chat-history-body') as HTMLDivElement | null;
    this.chatHistoryList = commentInput.querySelector('#wp-chat-history-list') as HTMLUListElement | null;
    this.chatHistoryEmptyState = commentInput.querySelector('#wp-chat-history-empty') as HTMLDivElement | null;
    this.chatHistoryToggle = commentInput.querySelector('#wp-chat-history-toggle') as HTMLButtonElement | null;
    this.chatHistoryToggleIcon = commentInput.querySelector('#wp-chat-history-toggle-icon') as HTMLSpanElement | null;
    this.updateChatHistoryEmptyState();
    this.bindChatHistoryEvents();
    this.applyChatHistoryExpansion();

    this.bindUIEvents();
  },

  bindUIEvents(this: WatchPartyContent): void {
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
  },

  setupCommentInputProtection(this: WatchPartyContent): void {
    if (this.commentInputProtectionInitialized) {
      return;
    }

    const commentInput = this.getInput('wp-comment-text');
    const commandInput = this.getInput('wp-command-text');
    if (!commentInput && !commandInput) {
      return;
    }

    const eventTypes: Array<'keydown'> = ['keydown'];

    eventTypes.forEach((eventType) => {
      window.addEventListener(eventType, this.interceptCommentInputKeyEvent, true);
      document.addEventListener(eventType, this.interceptCommentInputKeyEvent, true);
    });

    this.commentInputProtectionInitialized = true;
  },

  toggleRoomPopup(this: WatchPartyContent): void {
    const popup = document.getElementById('wp-room-popup');
    popup?.classList.toggle('hidden');
  },

  hideRoomPopup(this: WatchPartyContent): void {
    const popup = document.getElementById('wp-room-popup');
    popup?.classList.add('hidden');
  },

  toggleCommentPanel(this: WatchPartyContent): void {
    const panel = document.getElementById('wp-comment-panel');
    const toggleBtn = document.getElementById('wp-toggle-comment');
    const commentInputRoot = document.getElementById('wp-comment-input');

    if (!panel || !toggleBtn || !commentInputRoot) {
      return;
    }

    if (this.chatDisplayMode === 'sidebar') {
      const isOpen = toggleBtn.classList.contains('open');

      if (isOpen) {
        hideCommentPanelFromSidebar(this);
        toggleBtn.classList.remove('open');
      } else {
        this.chatHistoryExpanded = true;
        showCommentPanelInSidebar(this);
        toggleBtn.classList.add('open');
        this.getInput('wp-comment-text')?.focus();
      }

      const icon = toggleBtn.querySelector('.wp-toggle-icon');
      if (icon) {
        icon.textContent = toggleBtn.classList.contains('open') ? '›' : '‹';
      }

      this.applyChatHistoryExpansion();
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

    commentInputRoot.classList.toggle('expanded', isOpen);

    this.applyChatHistoryExpansion();
  },

  showRoomInfo(this: WatchPartyContent): void {
    const setupSection = document.getElementById('wp-room-setup');
    const infoSection = document.getElementById('wp-room-info');
    setupSection?.classList.add('hidden');
    infoSection?.classList.remove('hidden');
    this.updateShareControls();
  },

  showRoomSetup(this: WatchPartyContent): void {
    const setupSection = document.getElementById('wp-room-setup');
    const infoSection = document.getElementById('wp-room-info');
    setupSection?.classList.remove('hidden');
    infoSection?.classList.add('hidden');

    const roomIdInput = this.getInput('wp-room-id');
    if (roomIdInput) {
      roomIdInput.value = '';
    }
    this.updateShareControls(false);
  },

  updateStatus(this: WatchPartyContent, status: string): void {
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
  },

  updateMembers(this: WatchPartyContent, members: RoomMember[]): void {
    const normalizedMembers = members.map((member) => ({
      ...member,
      status: member.status ?? 'offline',
    }));

    this.members = normalizedMembers;

    const membersList = document.getElementById('wp-members-list');
    if (!membersList) {
      return;
    }

    membersList.innerHTML = '';

    normalizedMembers.forEach((member) => {
      const memberDiv = document.createElement('div');
      memberDiv.className = `wp-member wp-member--${member.status}`;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'wp-member__name';
      nameSpan.textContent = member.username || member.id;
      memberDiv.appendChild(nameSpan);

      const statusSpan = document.createElement('span');
      statusSpan.className = 'wp-member__status';
      statusSpan.textContent = member.status === 'online' ? 'オンライン' : 'オフライン';
      memberDiv.appendChild(statusSpan);

      membersList.appendChild(memberDiv);
    });
  },

  ensureToastContainer(this: WatchPartyContent): HTMLDivElement | null {
    if (this.toastContainer && document.body.contains(this.toastContainer)) {
      return this.toastContainer;
    }

    if (!document.body) {
      return null;
    }

    this.toastContainer = document.createElement('div');
    this.toastContainer.id = 'wp-toast-container';
    this.toastContainer.className = 'wp-toast-container';
    document.body.appendChild(this.toastContainer);
    return this.toastContainer;
  },

  showToast(this: WatchPartyContent, message: string, type: 'join' | 'leave' | 'info' = 'info'): void {
    const container = this.ensureToastContainer();
    if (!container) {
      return;
    }

    const toast = document.createElement('div');
    toast.className = `wp-toast wp-toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    window.requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    const scheduleHide = (): number =>
      window.setTimeout(() => {
        toast.classList.remove('show');
        const removeTimeout = window.setTimeout(() => {
          toast.remove();
          window.clearTimeout(removeTimeout);
        }, 300);
      }, 3000);

    let hideTimeout = scheduleHide();

    toast.addEventListener('mouseenter', () => {
      if (hideTimeout) {
        window.clearTimeout(hideTimeout);
        hideTimeout = 0;
      }
    });

    toast.addEventListener('mouseleave', () => {
      if (!hideTimeout) {
        hideTimeout = scheduleHide();
      }
    });
  },

  notifyStatusTransitions(
    this: WatchPartyContent,
    previous: RoomMember[],
    current: RoomMember[],
    _changedUserId: string | null,
  ): void {
    if (current.length === 0) {
      return;
    }

    const previousMap = new Map(previous.map((member) => [member.id, member.status ?? 'offline']));

    current.forEach((member) => {
      const prevStatus = previousMap.get(member.id);
      const nextStatus = member.status ?? 'offline';

      if (!prevStatus || prevStatus === nextStatus) {
        return;
      }

      if (member.id === this.currentUser) {
        return;
      }

      const displayName = member.username || member.id;
      if (nextStatus === 'online') {
        this.showToast(`${displayName} がオンラインになりました`, 'join');
      } else if (nextStatus === 'offline') {
        this.showToast(`${displayName} がオフラインになりました`, 'leave');
      }
    });
  },
};
