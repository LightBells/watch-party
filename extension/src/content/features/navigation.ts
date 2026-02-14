import type {WatchPartyContent} from '../watchPartyContent';

import {ROOM_HASH_KEY} from '../constants';

export type NavigationFeature = {
  monitorUrlChanges(this: WatchPartyContent): void;
  onUrlChanged(this: WatchPartyContent, newUrl: string): Promise<void>;
  handleDeepLink(this: WatchPartyContent): Promise<void>;
  navigateToUrl(this: WatchPartyContent, targetUrl: string): void;
  syncRoomUrl(this: WatchPartyContent, targetUrl: string): void;
  applyRoomParamToUrl(this: WatchPartyContent, targetUrl: string, roomId: string | null): string;
  normalizeUrlForComparison(this: WatchPartyContent, targetUrl: string): string;
  urlsMatchForSync(this: WatchPartyContent, targetUrl: string, candidateUrl: string): boolean;
  urlsEquivalentForSync(
    this: WatchPartyContent,
    urlA: string | null | undefined,
    urlB: string | null | undefined,
  ): boolean;
  ensureShareLink(this: WatchPartyContent, roomId: string | null): string;
  clearShareLink(this: WatchPartyContent): void;
  getRoomIdFromUrl(this: WatchPartyContent, targetUrl: string): string | null;
  copyShareLink(this: WatchPartyContent): Promise<void>;
  getShareUrl(this: WatchPartyContent): string | null;
  broadcastCurrentUrl(this: WatchPartyContent, explicitUrl?: string): void;
  requestMemberNavigation(this: WatchPartyContent, targetUrl: string): void;
  updateShareControls(this: WatchPartyContent, forceVisible?: boolean): void;
  showShareFeedback(this: WatchPartyContent, message: string, isError?: boolean): void;
  hideShareFeedback(this: WatchPartyContent): void;
};

export const navigationFeature: NavigationFeature = {
  monitorUrlChanges(this: WatchPartyContent): void {
    const watchPartyContentCtor = this.constructor as {historyPatched?: boolean};

    this.debugNavigation('monitorUrlChanges:init', {
      locationHref: window.location.href,
      historyPatched: Boolean(watchPartyContentCtor.historyPatched),
    });

    this.lastKnownUrl = window.location.href;

    const handleChange = (source: string) => {
      const href = window.location.href;
      this.debugNavigation('monitorUrlChanges:detected', {
        source,
        href,
        lastKnownUrl: this.lastKnownUrl,
        navigationInProgress: this.navigationInProgress,
      });
      void this.onUrlChanged(href);
    };

    if (!watchPartyContentCtor.historyPatched) {
      const wrapHistoryMethod = (method: 'pushState' | 'replaceState') => {
        const original = history[method] as typeof history.pushState;
        history[method] = function (...args: Parameters<typeof history.pushState>) {
          const result = original.apply(this, args);
          const event = new Event(`watchparty:${method}`);
          window.dispatchEvent(event);
          return result;
        } as typeof history.pushState;
        window.addEventListener(`watchparty:${method}`, () => handleChange(`history:${method}`));
      };

      wrapHistoryMethod('pushState');
      wrapHistoryMethod('replaceState');
      watchPartyContentCtor.historyPatched = true;
      this.debugNavigation('monitorUrlChanges:history-patched', {});
    }

    window.addEventListener('popstate', () => handleChange('popstate'));

    if (this.urlObserverId !== null) {
      window.clearInterval(this.urlObserverId);
    }

    this.urlObserverId = window.setInterval(() => {
      if (window.location.href !== this.lastKnownUrl) {
        handleChange('interval');
      }
    }, 1000);
  },

  async onUrlChanged(this: WatchPartyContent, newUrl: string): Promise<void> {
    this.debugNavigation('onUrlChanged:trigger', {
      newUrl,
      lastKnownUrl: this.lastKnownUrl,
      navigationInProgress: this.navigationInProgress,
      isHost: this.isHost,
      socketConnected: Boolean(this.socket?.connected),
      currentRoomUrl: this.currentRoomUrl,
      currentRoom: this.currentRoom,
    });

    if (this.navigationInProgress && newUrl === this.lastKnownUrl) {
      this.navigationInProgress = false;
      this.debugNavigation('onUrlChanged:skip-sync-same', {newUrl});
      this.log('🔁 Navigation completed from sync; skipping broadcast');
      return;
    }

    if (newUrl === this.lastKnownUrl) {
      this.debugNavigation('onUrlChanged:skip-nochange', {newUrl});
      return;
    }

    const previousUrl = this.lastKnownUrl;
    const normalizedNewUrl = this.normalizeUrlForComparison(newUrl);

    if (this.navigationInProgress) {
      this.navigationInProgress = false;
      this.lastKnownUrl = newUrl;
      this.currentRoomUrl = this.currentRoom
        ? this.applyRoomParamToUrl(newUrl, this.currentRoom)
        : newUrl;
      this.debugNavigation('onUrlChanged:sync-complete', {
        newUrl,
        currentRoomUrl: this.currentRoomUrl,
      });
      this.log('🔁 Navigation completed from sync; skipping broadcast');
      return;
    }

    if (!this.currentRoom) {
      this.lastKnownUrl = newUrl;
      this.currentRoomUrl = null;
      this.debugNavigation('onUrlChanged:skip-no-room', {newUrl});
      await this.handleDeepLink();
      return;
    }

    if (!this.socket?.connected) {
      if (!this.isHost) {
        const expectedUrl = this.currentRoomUrl ?? previousUrl;
        if (expectedUrl) {
          const normalizedExpected = this.normalizeUrlForComparison(expectedUrl);
          const urlsEquivalent = this.urlsMatchForSync(expectedUrl, newUrl);
          if (!urlsEquivalent) {
            this.debugNavigation('onUrlChanged:restore-while-disconnected', {
              expectedUrl,
              normalizedExpected,
              normalizedNewUrl,
              urlsEquivalent,
            });
            this.log('🔄 Restoring host URL while disconnected');
            this.syncRoomUrl(expectedUrl);
            return;
          }
        }

        this.debugNavigation('onUrlChanged:handle-deeplink-disconnected', {newUrl});
        await this.handleDeepLink();
      }

      this.lastKnownUrl = newUrl;
      return;
    }

    if (!this.isHost) {
      const expectedUrl = this.currentRoomUrl ?? previousUrl;
      if (expectedUrl) {
        const normalizedExpected = this.normalizeUrlForComparison(expectedUrl);
        const urlsEquivalent = this.urlsMatchForSync(expectedUrl, newUrl);
        if (!urlsEquivalent) {
          if (this.socket?.connected && this.currentRoom) {
            this.debugNavigation('onUrlChanged:member-initiate-navigation', {
              expectedUrl,
              normalizedExpected,
              normalizedNewUrl,
              urlsEquivalent,
            });
            this.requestMemberNavigation(newUrl);
            return;
          }

          this.debugNavigation('onUrlChanged:member-resync', {
            expectedUrl,
            normalizedExpected,
            normalizedNewUrl,
            urlsEquivalent,
          });
          this.log('🔄 URL mismatch detected; restoring host URL');
          this.syncRoomUrl(expectedUrl);
          return;
        }

        this.lastKnownUrl = expectedUrl;
      } else {
        this.lastKnownUrl = newUrl;
      }

      this.debugNavigation('onUrlChanged:member-handle-deeplink', {newUrl});
      await this.handleDeepLink();
      return;
    }

    if (this.currentRoom) {
      const ensuredUrl = this.ensureShareLink(this.currentRoom);
      this.debugNavigation('onUrlChanged:host-ensure-share-link', {
        ensuredUrl,
        currentRoom: this.currentRoom,
      });
      newUrl = ensuredUrl;
    }

    this.lastKnownUrl = newUrl;
    this.lastBroadcastUrl = null;
    this.debugNavigation('onUrlChanged:host-broadcast', {
      broadcastUrl: newUrl,
    });
    this.broadcastCurrentUrl(newUrl);
  },

  async handleDeepLink(this: WatchPartyContent): Promise<void> {
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
  },

  navigateToUrl(this: WatchPartyContent, targetUrl: string): void {
    this.debugNavigation('navigateToUrl:attempt', {
      targetUrl,
      currentRoomUrl: this.currentRoomUrl,
      currentRoom: this.currentRoom,
      locationHref: window.location.href,
    });

    if (!targetUrl) {
      this.debugNavigation('navigateToUrl:skip-empty', {});
      return;
    }

    const effectiveUrl = this.currentRoom
      ? this.applyRoomParamToUrl(targetUrl, this.currentRoom)
      : targetUrl;

    if (this.urlsMatchForSync(effectiveUrl, window.location.href)) {
      this.debugNavigation('navigateToUrl:already-current', {effectiveUrl});
      this.lastKnownUrl = window.location.href;
      this.currentRoomUrl = effectiveUrl;
      return;
    }

    this.log('🌐 Syncing page location to:', effectiveUrl);
    this.debugNavigation('navigateToUrl:perform', {effectiveUrl});
    this.navigationInProgress = true;
    this.lastKnownUrl = effectiveUrl;
    this.currentRoomUrl = effectiveUrl;
    window.location.href = effectiveUrl;
  },

  syncRoomUrl(this: WatchPartyContent, targetUrl: string): void {
    this.debugNavigation('syncRoomUrl:attempt', {
      targetUrl,
      currentRoom: this.currentRoom,
      isHost: this.isHost,
      locationHref: window.location.href,
    });

    if (!targetUrl) {
      this.debugNavigation('syncRoomUrl:skip-empty', {});
      return;
    }

    const resolvedUrl = this.currentRoom
      ? this.applyRoomParamToUrl(targetUrl, this.currentRoom)
      : targetUrl;

    if (this.urlsMatchForSync(resolvedUrl, window.location.href)) {
      this.debugNavigation('syncRoomUrl:already-current', {
        resolvedUrl,
        locationHref: window.location.href,
      });
      this.currentRoomUrl = resolvedUrl;
      this.lastKnownUrl = window.location.href;

      if (this.currentRoom) {
        const detectedRoom = this.getRoomIdFromUrl(window.location.href);
        if (detectedRoom !== this.currentRoom) {
          this.debugNavigation('syncRoomUrl:missing-room-param', {
            expectedRoom: this.currentRoom,
            detectedRoom,
          });
          if (this.isHost) {
            this.ensureShareLink(this.currentRoom);
          } else {
            this.navigateToUrl(resolvedUrl);
          }
          return;
        }
      }
      return;
    }

    if (this.isHost && this.currentRoom) {
      this.debugNavigation('syncRoomUrl:host-update', {
        resolvedUrl,
        currentRoom: this.currentRoom,
      });
      this.ensureShareLink(this.currentRoom);
      this.currentRoomUrl = resolvedUrl;
      return;
    }

    this.debugNavigation('syncRoomUrl:navigate-member', {resolvedUrl});
    this.currentRoomUrl = resolvedUrl;
    this.navigateToUrl(resolvedUrl);
  },

  applyRoomParamToUrl(this: WatchPartyContent, targetUrl: string, roomId: string | null): string {
    if (!roomId) {
      return targetUrl;
    }

    try {
      const parsed = new URL(targetUrl, window.location.origin);
      const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      hashParams.set(ROOM_HASH_KEY, roomId);
      const newHash = hashParams.toString();
      parsed.hash = newHash ? `#${newHash}` : '';
      return parsed.toString();
    } catch (error) {
      this.log('Failed to apply room param to url:', error);
      return targetUrl;
    }
  },

  normalizeUrlForComparison(this: WatchPartyContent, targetUrl: string): string {
    try {
      const parsed = new URL(targetUrl, window.location.origin);
      parsed.searchParams.delete(ROOM_HASH_KEY);

      const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      hashParams.delete(ROOM_HASH_KEY);
      const newHash = hashParams.toString();
      parsed.hash = newHash ? `#${newHash}` : '';

      return parsed.toString();
    } catch (error) {
      this.log('Failed to normalize url for comparison:', error);
      return targetUrl;
    }
  },

  urlsMatchForSync(this: WatchPartyContent, targetUrl: string, candidateUrl: string): boolean {
    try {
      const normalizePath = (path: string): string => {
        if (!path || path === '/') {
          return '/';
        }
        return path.replace(/\/+$/, '') || '/';
      };

      const decodeSegment = (segment: string): string => {
        try {
          return decodeURIComponent(segment);
        } catch (decodeError) {
          this.debugNavigation('urlsMatchForSync:decode-failed', {
            segment,
            error: decodeError instanceof Error ? decodeError.message : String(decodeError),
          });
          return segment;
        }
      };

      const toMultiMap = (params: URLSearchParams): Map<string, string[]> => {
        const map = new Map<string, string[]>();
        params.forEach((value, key) => {
          const normalizedKey = decodeSegment(key);
          if (normalizedKey === ROOM_HASH_KEY) {
            return;
          }

          const normalizedValue = decodeSegment(value);
          const existing = map.get(normalizedKey);
          if (existing) {
            existing.push(normalizedValue);
          } else {
            map.set(normalizedKey, [normalizedValue]);
          }
        });
        return map;
      };

      const parseUrl = (value: string) => {
        const parsed = new URL(value, window.location.origin);
        return {
          url: parsed,
          search: toMultiMap(parsed.searchParams),
          hash: toMultiMap(new URLSearchParams(parsed.hash.replace(/^#/, ''))),
        };
      };

      const expected = parseUrl(targetUrl);
      const candidate = parseUrl(candidateUrl);

      if (
        expected.url.origin !== candidate.url.origin ||
        normalizePath(expected.url.pathname) !== normalizePath(candidate.url.pathname)
      ) {
        return false;
      }

      const isSubset = (required: Map<string, string[]>, actual: Map<string, string[]>): boolean => {
        for (const [key, values] of required.entries()) {
          const actualValues = actual.get(key);
          if (!actualValues) {
            return false;
          }
          for (const value of values) {
            if (!actualValues.includes(value)) {
              return false;
            }
          }
        }
        return true;
      };

      if (!isSubset(expected.search, candidate.search)) {
        return false;
      }

      if (!isSubset(expected.hash, candidate.hash)) {
        return false;
      }

      return true;
    } catch (error) {
      this.log('Failed to compare urls for sync:', error);
      return targetUrl === candidateUrl;
    }
  },

  urlsEquivalentForSync(
    this: WatchPartyContent,
    urlA: string | null | undefined,
    urlB: string | null | undefined,
  ): boolean {
    if (!urlA || !urlB) {
      return urlA === urlB;
    }

    return this.urlsMatchForSync(urlA, urlB) && this.urlsMatchForSync(urlB, urlA);
  },

  ensureShareLink(this: WatchPartyContent, roomId: string | null): string {
    this.debugNavigation('ensureShareLink:attempt', {
      roomId,
      locationHref: window.location.href,
    });

    if (!roomId) {
      this.debugNavigation('ensureShareLink:no-room', {});
      return window.location.href;
    }

    const targetUrl = this.applyRoomParamToUrl(window.location.href, roomId);

    if (targetUrl !== window.location.href) {
      this.debugNavigation('ensureShareLink:update-history', {
        targetUrl,
        previousUrl: window.location.href,
      });
      try {
        window.history.replaceState(window.history.state, '', targetUrl);
      } catch (error) {
        this.log('Failed to update history for share link:', error);
        this.debugNavigation('ensureShareLink:history-error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (this.isHost) {
        this.lastBroadcastUrl = null;
      }
    }

    this.lastKnownUrl = targetUrl;
    this.currentRoomUrl = targetUrl;
    this.debugNavigation('ensureShareLink:result', {targetUrl});
    return targetUrl;
  },

  clearShareLink(this: WatchPartyContent): void {
    try {
      const parsed = new URL(window.location.href);
      const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      if (!hashParams.has(ROOM_HASH_KEY)) {
        return;
      }
      hashParams.delete(ROOM_HASH_KEY);
      const newHash = hashParams.toString();
      parsed.hash = newHash ? `#${newHash}` : '';
      const newUrl = parsed.toString();
      window.history.replaceState(window.history.state, '', newUrl);
      this.lastKnownUrl = newUrl;
      this.currentRoomUrl = null;
    } catch (error) {
      this.log('Failed to clear share link:', error);
    }
  },

  getRoomIdFromUrl(this: WatchPartyContent, targetUrl: string): string | null {
    try {
      const parsed = new URL(targetUrl, window.location.origin);
      const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      const hashRoom = hashParams.get(ROOM_HASH_KEY);
      if (hashRoom) {
        return hashRoom;
      }
      const queryRoom = parsed.searchParams.get(ROOM_HASH_KEY);
      return queryRoom ?? null;
    } catch (error) {
      this.log('Failed to read room id from url:', error);
      return null;
    }
  },

  async copyShareLink(this: WatchPartyContent): Promise<void> {
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
  },

  getShareUrl(this: WatchPartyContent): string | null {
    if (!this.currentRoom) {
      return null;
    }

    if (this.isHost) {
      return this.ensureShareLink(this.currentRoom);
    }

    return this.applyRoomParamToUrl(window.location.href, this.currentRoom);
  },

  broadcastCurrentUrl(this: WatchPartyContent, explicitUrl?: string): void {
    this.debugNavigation('broadcastCurrentUrl:attempt', {
      explicitUrl,
      isHost: this.isHost,
      socketConnected: Boolean(this.socket?.connected),
      currentRoom: this.currentRoom,
      lastBroadcastUrl: this.lastBroadcastUrl,
    });

    if (!this.socket?.connected) {
      this.debugNavigation('broadcastCurrentUrl:skip-no-socket', {});
      return;
    }

    if (!this.isHost) {
      this.debugNavigation('broadcastCurrentUrl:skip-not-host', {});
      return;
    }

    if (!this.currentRoom) {
      this.debugNavigation('broadcastCurrentUrl:skip-no-room', {});
      return;
    }

    const urlToSend = explicitUrl ?? this.ensureShareLink(this.currentRoom);
    if (!urlToSend) {
      this.debugNavigation('broadcastCurrentUrl:skip-empty-url', {});
      return;
    }

    if (this.lastBroadcastUrl && this.urlsEquivalentForSync(this.lastBroadcastUrl, urlToSend)) {
      this.debugNavigation('broadcastCurrentUrl:skip-duplicate', {urlToSend});
      return;
    }

    this.lastBroadcastUrl = urlToSend;
    this.currentRoomUrl = urlToSend;
    this.log('🌐 Broadcasting current URL:', urlToSend);
    this.debugNavigation('broadcastCurrentUrl:emit', {urlToSend});
    this.socket.emit('navigate', {url: urlToSend});
  },

  requestMemberNavigation(this: WatchPartyContent, targetUrl: string): void {
    this.debugNavigation('memberNavigate:attempt', {
      targetUrl,
      socketConnected: Boolean(this.socket?.connected),
      currentRoom: this.currentRoom,
      isHost: this.isHost,
    });

    if (!this.socket?.connected || !this.currentRoom) {
      this.debugNavigation('memberNavigate:skip-unavailable', {});
      return;
    }

    const resolvedUrl = this.applyRoomParamToUrl(targetUrl, this.currentRoom);

    this.ensureShareLink(this.currentRoom);

    this.lastKnownUrl = window.location.href;
    this.currentRoomUrl = resolvedUrl;
    this.lastBroadcastUrl = null;

    this.debugNavigation('memberNavigate:emit', {
      resolvedUrl,
    });
    this.socket.emit('member-navigate', {url: resolvedUrl});
  },

  updateShareControls(this: WatchPartyContent, forceVisible?: boolean): void {
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
  },

  showShareFeedback(this: WatchPartyContent, message: string, isError = false): void {
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
  },

  hideShareFeedback(this: WatchPartyContent): void {
    const feedback = document.getElementById('wp-share-feedback');
    if (!feedback) {
      return;
    }

    feedback.classList.remove('show', 'error');
    if (this.shareFeedbackTimeout) {
      window.clearTimeout(this.shareFeedbackTimeout);
      this.shareFeedbackTimeout = null;
    }
  },
};
