import type {WatchPartyContent} from '../watchPartyContent';

import {
  COMMENT_COLOR_MAP,
  COMMENT_FONT_FAMILIES,
  COMMENT_SIZE_MAP,
  MAX_CHAT_HISTORY_ENTRIES,
} from '../constants';
import type {CommentCommandOptions, CommentPayload} from '../types';

const DANIME_HOST_FRAGMENT = 'animestore.docomo.ne.jp';
const DANIME_MEDIA_INFO_SELECTOR = '#backInfo > div > div[class="backInfoTxt1"], #backInfo > div > div[class="backInfoTxt2"]';
const MEDIA_INFO_MAX_LENGTH = 300;

export type ChatFeature = {
  sendComment(this: WatchPartyContent): void;
  ensureChatHistoryRefs(this: WatchPartyContent): void;
  bindChatHistoryEvents(this: WatchPartyContent): void;
  updateChatHistoryEmptyState(this: WatchPartyContent): void;
  trimChatHistory(this: WatchPartyContent): void;
  toggleChatHistory(this: WatchPartyContent, force?: boolean): void;
  applyChatHistoryExpansion(this: WatchPartyContent): void;
  handleChatHistoryClick(this: WatchPartyContent, event: MouseEvent): void;
  seekToPlaybackTime(this: WatchPartyContent, seconds: number): void;
  appendChatHistoryEntry(
    this: WatchPartyContent,
    comment: CommentPayload,
    options?: {skipTrim?: boolean; scroll?: boolean},
  ): void;
  setChatHistory(this: WatchPartyContent, comments: CommentPayload[]): void;
  scrollChatHistoryToLatest(this: WatchPartyContent): void;
  formatTimestampLabel(this: WatchPartyContent, timestamp: number): string;
  formatPlaybackTimeLabel(this: WatchPartyContent, playbackTime: number | null): string | null;
  showComment(
    this: WatchPartyContent,
    message: string,
    displayName: string,
    isOwnComment?: boolean,
    commandString?: string | null,
    mediaInfo?: string | null,
  ): void;
  parseCommentCommands(
    this: WatchPartyContent,
    commandString?: string | null,
  ): CommentCommandOptions;
  collectCurrentMediaInfo(this: WatchPartyContent): string | null;
  collectDanimeMediaInfo(this: WatchPartyContent): string | null;
  normalizeHexColor(this: WatchPartyContent, token: string): string;
  setupCommentOverlay(this: WatchPartyContent): void;
  ensureCommentOverlay(this: WatchPartyContent): HTMLDivElement | null;
  updateCommentOverlayBounds(this: WatchPartyContent): void;
};

export const chatFeature: ChatFeature = {
  sendComment(this: WatchPartyContent): void {
    const commentInput = this.getInput('wp-comment-text');
    const message = commentInput?.value.trim();
    const commandInput = this.getInput('wp-command-text');
    const commandValue = commandInput?.value.trim() ?? '';

    const normalizedCommands = commandValue.replace(/\s+/g, ' ').trim();

    if (!message) {
      return;
    }

    if (this.socket?.connected) {
      const playbackTime = this.getCurrentPlaybackTime();
      const mediaInfo = this.collectCurrentMediaInfo();
      this.socket.emit('comment', {
        message,
        commands: normalizedCommands || undefined,
        playbackTime: playbackTime ?? null,
        mediaInfo: mediaInfo ?? undefined,
      });
      if (commentInput) {
        commentInput.value = '';
      }
    } else {
      window.alert('ルームに接続していません');
    }
  },

  ensureChatHistoryRefs(this: WatchPartyContent): void {
    if (!this.chatHistoryContainer) {
      this.chatHistoryContainer = document.getElementById('wp-chat-history') as HTMLDivElement | null;
    }
    if (!this.chatHistoryBody) {
      this.chatHistoryBody = document.getElementById('wp-chat-history-body') as HTMLDivElement | null;
    }
    if (!this.chatHistoryList) {
      this.chatHistoryList = document.getElementById('wp-chat-history-list') as HTMLUListElement | null;
    }
    if (!this.chatHistoryEmptyState) {
      this.chatHistoryEmptyState = document.getElementById('wp-chat-history-empty') as HTMLDivElement | null;
    }
    if (!this.chatHistoryToggle) {
      this.chatHistoryToggle = document.getElementById('wp-chat-history-toggle') as HTMLButtonElement | null;
    }
    if (!this.chatHistoryToggleIcon) {
      this.chatHistoryToggleIcon = document.getElementById('wp-chat-history-toggle-icon') as HTMLSpanElement | null;
    }
  },

  bindChatHistoryEvents(this: WatchPartyContent): void {
    this.ensureChatHistoryRefs();
    if (this.chatHistoryEventsBound) {
      return;
    }

    if (this.chatHistoryToggle) {
      this.chatHistoryToggle.addEventListener('click', () => this.toggleChatHistory());
    }

    if (this.chatHistoryList) {
      this.chatHistoryList.addEventListener('click', (event) => this.handleChatHistoryClick(event));
    }

    this.chatHistoryEventsBound = true;
  },

  updateChatHistoryEmptyState(this: WatchPartyContent): void {
    this.ensureChatHistoryRefs();
    if (!this.chatHistoryEmptyState || !this.chatHistoryList) {
      return;
    }

    const hasEntries = this.chatHistoryList.children.length > 0;
    if (hasEntries) {
      this.chatHistoryEmptyState.classList.add('hidden');
    } else {
      this.chatHistoryEmptyState.classList.remove('hidden');
    }
  },

  trimChatHistory(this: WatchPartyContent): void {
    if (!this.chatHistoryList) {
      return;
    }

    while (this.chatHistoryList.children.length > MAX_CHAT_HISTORY_ENTRIES) {
      const firstChild = this.chatHistoryList.firstChild;
      if (!firstChild) {
        break;
      }
      this.chatHistoryList.removeChild(firstChild);
    }
  },

  toggleChatHistory(this: WatchPartyContent, force?: boolean): void {
    if (this.chatDisplayMode === 'sidebar') {
      this.chatHistoryExpanded = true;
      this.chatHistoryNeedsScroll = true;
      this.applyChatHistoryExpansion();
      return;
    }

    const nextState = typeof force === 'boolean' ? force : !this.chatHistoryExpanded;
    if (nextState === this.chatHistoryExpanded) {
      if (nextState) {
        this.chatHistoryNeedsScroll = true;
        this.scrollChatHistoryToLatest();
      }
      return;
    }

    this.chatHistoryExpanded = nextState;
    this.chatHistoryNeedsScroll = this.chatHistoryExpanded;
    if (this.chatHistoryExpanded) {
      this.chatHistoryNeedsScroll = true;
    }
    this.applyChatHistoryExpansion();
  },

  applyChatHistoryExpansion(this: WatchPartyContent): void {
    this.ensureChatHistoryRefs();
    const panel = document.getElementById('wp-comment-panel');
    const isPanelOpen = Boolean(panel && !panel.classList.contains('hidden'));
    const shouldExpand =
      this.chatDisplayMode === 'sidebar' ? isPanelOpen : this.chatHistoryExpanded && isPanelOpen;
    const ariaExpanded = this.chatDisplayMode === 'sidebar' ? true : this.chatHistoryExpanded;

    if (this.chatHistoryContainer) {
      this.chatHistoryContainer.classList.toggle('expanded', shouldExpand);
    }
    if (this.chatHistoryBody) {
      this.chatHistoryBody.classList.toggle('expanded', shouldExpand);
    }
    if (this.chatHistoryToggle) {
      this.chatHistoryToggle.setAttribute('aria-expanded', String(ariaExpanded));
    }
    if (this.chatHistoryToggleIcon) {
      this.chatHistoryToggleIcon.textContent = ariaExpanded ? '▾' : '▸';
    }

    if (shouldExpand) {
      this.chatHistoryNeedsScroll = true;
      this.scrollChatHistoryToLatest();
    }
  },

  handleChatHistoryClick(this: WatchPartyContent, event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    if (target.closest('.wp-chat-history-toggle')) {
      return;
    }

    const entry = target.closest('.wp-chat-entry') as HTMLLIElement | null;
    if (!entry) {
      return;
    }

    const url = entry.dataset.url ?? '';
    const playbackRaw = entry.dataset.playback ?? '';
    const playbackTime = Number.parseFloat(playbackRaw);
    const canSeek = Number.isFinite(playbackTime);
    const jumpConfirmed = (): boolean => window.confirm('このコメントの位置にジャンプしますか？');

    let navigationTriggered = false;
    if (url) {
      const resolvedUrl = this.currentRoom ? this.applyRoomParamToUrl(url, this.currentRoom) : url;
      if (!this.urlsMatchForSync(resolvedUrl, window.location.href)) {
        if (!jumpConfirmed()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        this.navigateToUrl(resolvedUrl);
        if (!this.isHost) {
          this.requestMemberNavigation(resolvedUrl);
        }
        navigationTriggered = true;
      }
    }

    if (!navigationTriggered && canSeek) {
      if (!jumpConfirmed()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      this.seekToPlaybackTime(playbackTime);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (navigationTriggered) {
      event.preventDefault();
      event.stopPropagation();
    }
  },

  seekToPlaybackTime(this: WatchPartyContent, seconds: number): void {
    const targetTime = Math.max(0, seconds);

    if (this.videoElement) {
      this.videoElement.currentTime = targetTime;
      if (this.roomPlaybackStatus === 'playing') {
        void this.videoElement.play().catch(() => undefined);
      }
      this.pendingVideoState = {
        isPlaying: !this.videoElement.paused,
        currentTime: this.videoElement.currentTime,
        lastUpdateTime: Date.now(),
      };
    } else {
      this.pendingVideoState = {
        isPlaying: this.roomPlaybackStatus === 'playing',
        currentTime: targetTime,
        lastUpdateTime: Date.now(),
      };
    }

    if (this.isHost) {
      this.broadcastHostVideoState('chat-history-seek');
    }
  },

  appendChatHistoryEntry(
    this: WatchPartyContent,
    comment: CommentPayload,
    options: {skipTrim?: boolean; scroll?: boolean} = {},
  ): void {
    this.ensureChatHistoryRefs();
    if (!this.chatHistoryList) {
      return;
    }

    const item = document.createElement('li');
    item.className = 'wp-chat-entry';

    // Enable keyboard focus so hover media info can also appear via focus.
    item.tabIndex = 0;

    if (comment.userId === this.currentUser) {
      item.classList.add('wp-chat-entry--self');
    }

    const meta = document.createElement('div');
    meta.className = 'wp-chat-entry__meta';

    const userSpan = document.createElement('span');
    userSpan.className = 'wp-chat-entry__user';
    userSpan.textContent = comment.username || comment.userId;
    meta.appendChild(userSpan);

    const playbackLabel = this.formatPlaybackTimeLabel(comment.playbackTime ?? null);
    if (playbackLabel) {
      const playbackSpan = document.createElement('span');
      playbackSpan.className = 'wp-chat-entry__timecode';
      playbackSpan.textContent = playbackLabel;
      meta.appendChild(playbackSpan);
    }

    const timestampLabel = this.formatTimestampLabel(comment.timestamp);
    if (timestampLabel) {
      const timestampSpan = document.createElement('span');
      timestampSpan.className = 'wp-chat-entry__timestamp';
      timestampSpan.textContent = timestampLabel;
      meta.appendChild(timestampSpan);
    }

    item.appendChild(meta);

    const messageDiv = document.createElement('div');
    messageDiv.className = 'wp-chat-entry__message';
    messageDiv.textContent = comment.message;
    item.appendChild(messageDiv);

    const mediaInfoText = typeof comment.mediaInfo === 'string' ? comment.mediaInfo.trim() : '';
    if (mediaInfoText) {
      item.classList.add('wp-chat-entry--has-media');
      item.dataset.mediaInfo = mediaInfoText;
      item.title = mediaInfoText;
      messageDiv.setAttribute('title', mediaInfoText);
    }

    if (typeof comment.playbackTime === 'number' && Number.isFinite(comment.playbackTime)) {
      item.dataset.playback = String(comment.playbackTime);
    } else {
      delete item.dataset.playback;
    }

    if (comment.url) {
      item.dataset.url = comment.url;
    } else {
      delete item.dataset.url;
    }

    this.chatHistoryList.appendChild(item);

    if (!options.skipTrim) {
      this.trimChatHistory();
    }

    this.chatHistoryNeedsScroll = true;

    this.updateChatHistoryEmptyState();

    if (options.scroll !== false && this.chatHistoryExpanded) {
      this.scrollChatHistoryToLatest();
    }
  },

  setChatHistory(this: WatchPartyContent, comments: CommentPayload[]): void {
    this.ensureChatHistoryRefs();
    if (!this.chatHistoryList) {
      return;
    }

    this.chatHistoryList.innerHTML = '';

    comments.forEach((comment) => {
      this.appendChatHistoryEntry(comment, {skipTrim: true, scroll: false});
    });

    this.trimChatHistory();
    this.updateChatHistoryEmptyState();
    this.chatHistoryNeedsScroll = true;
    this.applyChatHistoryExpansion();
    if (this.chatHistoryExpanded) {
      this.scrollChatHistoryToLatest();
    }
  },

  scrollChatHistoryToLatest(this: WatchPartyContent): void {
    this.ensureChatHistoryRefs();
    if (!this.chatHistoryContainer) {
      return;
    }

    if (!this.chatHistoryNeedsScroll) {
      return;
    }

    if (!this.chatHistoryExpanded) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (!this.chatHistoryContainer) {
        return;
      }
      this.chatHistoryContainer.scrollTop = this.chatHistoryContainer.scrollHeight;
      this.chatHistoryNeedsScroll = false;
    });
  },

  formatTimestampLabel(this: WatchPartyContent, timestamp: number): string {
    if (!Number.isFinite(timestamp)) {
      return '';
    }

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
  },

  formatPlaybackTimeLabel(this: WatchPartyContent, playbackTime: number | null): string | null {
    if (playbackTime === null || !Number.isFinite(playbackTime)) {
      return null;
    }

    const totalSeconds = Math.max(0, Math.floor(playbackTime));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const minuteString = minutes.toString().padStart(hours > 0 ? 2 : 1, '0');
    const secondString = seconds.toString().padStart(2, '0');

    if (hours > 0) {
      return `@${hours}:${minuteString}:${secondString}`;
    }

    return `@${minutes}:${secondString}`;
  },

  showComment(
    this: WatchPartyContent,
    message: string,
    displayName: string,
    isOwnComment = false,
    commandString?: string | null,
    mediaInfo?: string | null,
  ): void {
    const overlay = this.ensureCommentOverlay();
    if (!overlay) {
      return;
    }

    this.updateCommentOverlayBounds();

    const commandOptions = this.parseCommentCommands(commandString);
    if (commandOptions.invisible) {
      return;
    }

    const commentElement = document.createElement('div');
    commentElement.classList.add('watch-party-comment');
    if (isOwnComment) {
      commentElement.classList.add('watch-party-comment--self');
    }

    const tooltip = typeof mediaInfo === 'string' ? mediaInfo.trim() : '';
    if (tooltip) {
      commentElement.dataset.mediaInfo = tooltip;
      commentElement.title = tooltip;
    }

    commentElement.innerHTML = `
      <span class="user">${displayName}</span><span class="separator">:</span> <span class="message">${message}</span>
    `;

    if (commandOptions.color) {
      const messageSpan = commentElement.querySelector('.message');
      if (messageSpan instanceof HTMLElement) {
        messageSpan.style.color = commandOptions.color;
      } else {
        commentElement.style.color = commandOptions.color;
      }
    }

    if (commandOptions.fontFamily) {
      commentElement.style.fontFamily = commandOptions.fontFamily;
    }

    if (commandOptions.fontSize) {
      commentElement.style.fontSize = commandOptions.fontSize;
    }

    if (commandOptions.fullWidth) {
      commentElement.classList.add('watch-party-comment--full');
    }

    if (commandOptions.opacity !== undefined) {
      commentElement.style.setProperty('--comment-active-opacity', `${commandOptions.opacity}`);
    }

    const isStaticPosition = commandOptions.position === 'ue' || commandOptions.position === 'shita';

    overlay.appendChild(commentElement);

    if (isStaticPosition) {
      commentElement.classList.add('watch-party-comment--static');
      if (commandOptions.position === 'ue') {
        commentElement.classList.add('watch-party-comment--top');
      } else {
        commentElement.classList.add('watch-party-comment--bottom');
      }

      if (commandOptions.opacity !== undefined) {
        commentElement.style.opacity = `${commandOptions.opacity}`;
      }

      const lifetime = Math.max(4000, Math.min(9000, 6000 + message.length * 120));
      window.setTimeout(() => {
        commentElement.remove();
      }, lifetime);
      return;
    }

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
    let travelDistance = Math.max(overlayWidth, window.innerWidth) + commentWidth;
    if (commandOptions.fullWidth) {
      travelDistance = Math.max(overlayWidth, window.innerWidth) * 2;
    }
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
  },

  parseCommentCommands(this: WatchPartyContent, commandString?: string | null): CommentCommandOptions {
    const defaults: CommentCommandOptions = {
      position: 'naka',
      fullWidth: false,
      invisible: false,
    };

    if (!commandString) {
      return defaults;
    }

    const tokens = commandString
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    if (!tokens.length) {
      return defaults;
    }

    const options: CommentCommandOptions = {...defaults};

    tokens.forEach((token) => {
      const lowerToken = token.toLowerCase();

      if (COMMENT_COLOR_MAP[lowerToken]) {
        options.color = COMMENT_COLOR_MAP[lowerToken];
        return;
      }

      if (COMMENT_SIZE_MAP[lowerToken]) {
        options.fontSize = COMMENT_SIZE_MAP[lowerToken];
        return;
      }

      if (COMMENT_FONT_FAMILIES[lowerToken]) {
        options.fontFamily = COMMENT_FONT_FAMILIES[lowerToken];
        return;
      }

      if (lowerToken === 'ue' || lowerToken === 'shita' || lowerToken === 'naka') {
        options.position = lowerToken;
        return;
      }

      if (lowerToken === 'full') {
        options.fullWidth = true;
        return;
      }

      if (lowerToken === 'invisible') {
        options.invisible = true;
        return;
      }

      const hexColor = this.normalizeHexColor(token);
      if (hexColor) {
        options.color = hexColor;
        return;
      }

      const opacityMatch = lowerToken.match(/^opacity:(\d?\.\d+|\d+)$/);
      if (opacityMatch) {
        const value = Number.parseFloat(opacityMatch[1]);
        if (Number.isFinite(value)) {
          options.opacity = Math.min(Math.max(value, 0), 1);
        }
        return;
      }
    });

    return options;
  },

  collectCurrentMediaInfo(this: WatchPartyContent): string | null {
    try {
      if (window.location.hostname.includes(DANIME_HOST_FRAGMENT)) {
        return this.collectDanimeMediaInfo();
      }
    } catch (error) {
      this.log('Failed to resolve media info host check', error);
    }
    return null;
  },

  collectDanimeMediaInfo(this: WatchPartyContent): string | null {
    try {
      const nodes = document.querySelectorAll<HTMLElement>(DANIME_MEDIA_INFO_SELECTOR);
      if (!nodes.length) {
        return null;
      }

      const parts: string[] = [];
      nodes.forEach((node) => {
        const text = node.textContent?.replace(/\s+/g, ' ').trim();
        if (text && !parts.includes(text)) {
          parts.push(text);
        }
      });

      if (!parts.length) {
        return null;
      }

      const combined = parts.join(' / ');
      if (!combined) {
        return null;
      }

      if (combined.length > MEDIA_INFO_MAX_LENGTH) {
        return `${combined.slice(0, MEDIA_INFO_MAX_LENGTH).trimEnd()}...`;
      }

      return combined;
    } catch (error) {
      this.log('Failed to collect d-anime media info', error);
      return null;
    }
  },

  normalizeHexColor(this: WatchPartyContent, token: string): string {
    const normalized = token.replace(/[^0-9a-f]/gi, '');
    if (normalized.length === 6 || normalized.length === 3) {
      return `#${normalized}`;
    }
    return '';
  },

  setupCommentOverlay(this: WatchPartyContent): void {
    const overlay = this.ensureCommentOverlay();
    if (!overlay) {
      return;
    }

    if (!this.overlayResizeObserver) {
      this.overlayResizeObserver = new ResizeObserver(() => {
        this.updateCommentOverlayBounds();
      });
    }

    if (this.videoElement) {
      this.overlayResizeObserver.observe(this.videoElement);
    }

    this.updateCommentOverlayBounds();
  },

  ensureCommentOverlay(this: WatchPartyContent): HTMLDivElement | null {
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
  },

  updateCommentOverlayBounds(this: WatchPartyContent): void {
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
  },
};
