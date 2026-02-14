import { chatFeature } from '../../extension/src/content/features/chat';

class FakeClassList {
  private classes = new Set<string>();

  add(...names: string[]): void {
    names.forEach((name) => this.classes.add(name));
  }

  remove(...names: string[]): void {
    names.forEach((name) => this.classes.delete(name));
  }

  contains(name: string): boolean {
    return this.classes.has(name);
  }
}

type FakeDomElement = {
  className: string;
  classList: FakeClassList;
  textContent: string;
  dataset: Record<string, string>;
  title: string;
  tabIndex: number;
  children: FakeDomElement[];
  appendChild: (child: FakeDomElement) => FakeDomElement;
  setAttribute: (name: string, value: string) => void;
};

const createFakeDomElement = (): FakeDomElement => ({
  className: '',
  classList: new FakeClassList(),
  textContent: '',
  dataset: {},
  title: '',
  tabIndex: 0,
  children: [],
  appendChild(child) {
    this.children.push(child);
    return child;
  },
  setAttribute(name: string, value: string) {
    (this as unknown as Record<string, string>)[name] = value;
  },
});

describe('chatFeature', () => {
  const originalWindow = global.window;
  const originalDocument = global.document;

  afterEach(() => {
    Object.defineProperty(global, 'window', { configurable: true, value: originalWindow });
    Object.defineProperty(global, 'document', { configurable: true, value: originalDocument });
  });

  it('parses command string into style options', () => {
    const context = {
      normalizeHexColor: chatFeature.normalizeHexColor,
    };

    const result = chatFeature.parseCommentCommands.call(
      context as never,
      'red big ue opacity:0.4 full invisible #00ffcc',
    );

    expect(result.position).toBe('ue');
    expect(result.fontSize).toBe('3em');
    expect(result.color).toBe('#00ffcc');
    expect(result.opacity).toBe(0.4);
    expect(result.fullWidth).toBe(true);
    expect(result.invisible).toBe(true);
  });

  it('formats playback labels for minute and hour scales', () => {
    const context = {};

    expect(chatFeature.formatPlaybackTimeLabel.call(context as never, 62)).toBe('@1:02');
    expect(chatFeature.formatPlaybackTimeLabel.call(context as never, 3661)).toBe('@1:01:01');
    expect(chatFeature.formatPlaybackTimeLabel.call(context as never, null)).toBeNull();
  });

  it('emits comment payload and clears input when connected', () => {
    const commentInput = { value: ' hello ' };
    const commandInput = { value: ' red   big ' };
    const emit = jest.fn();

    Object.defineProperty(global, 'window', {
      configurable: true,
      value: {
        alert: jest.fn(),
      },
    });

    const context = {
      getInput: (id: string) => {
        if (id === 'wp-comment-text') {
          return commentInput;
        }
        if (id === 'wp-command-text') {
          return commandInput;
        }
        return null;
      },
      socket: { connected: true, emit },
      getCurrentPlaybackTime: jest.fn(() => 12.3),
      collectCurrentMediaInfo: jest.fn(() => 'episode title'),
    };

    chatFeature.sendComment.call(context as never);

    expect(emit).toHaveBeenCalledWith('comment', {
      message: 'hello',
      commands: 'red big',
      playbackTime: 12.3,
      mediaInfo: 'episode title',
    });
    expect(commentInput.value).toBe('');
  });

  it('alerts when trying to send comment while disconnected', () => {
    const alert = jest.fn();
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: { alert },
    });

    const context = {
      getInput: (id: string) => ({ value: id === 'wp-comment-text' ? 'hi' : '' }),
      socket: { connected: false },
    };

    chatFeature.sendComment.call(context as never);
    expect(alert).toHaveBeenCalledWith('ルームに接続していません');
  });

  it('collects and deduplicates d-anime media info text', () => {
    Object.defineProperty(global, 'document', {
      configurable: true,
      value: {
        querySelectorAll: () => [
          { textContent: ' Episode 3 ' },
          { textContent: 'Episode 3' },
          { textContent: 'Season 1' },
        ],
      },
    });

    const context = {
      log: jest.fn(),
    };

    const value = chatFeature.collectDanimeMediaInfo.call(context as never);
    expect(value).toBe('Episode 3 / Season 1');
  });

  it('asks for confirmation before seeking from chat history click', () => {
    const confirm = jest.fn(() => false);
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: {
        confirm,
        location: { href: 'https://example.com/watch' },
      },
    });

    const entry = {
      dataset: { playback: '12.5' },
    };
    const target = {
      closest: jest.fn((selector: string) => {
        if (selector === '.wp-chat-history-toggle') {
          return null;
        }
        if (selector === '.wp-chat-entry') {
          return entry;
        }
        return null;
      }),
    };

    const preventDefault = jest.fn();
    const stopPropagation = jest.fn();

    const context = {
      currentRoom: 'ROOM1',
      isHost: false,
      seekToPlaybackTime: jest.fn(),
      applyRoomParamToUrl: jest.fn((url: string) => url),
      urlsMatchForSync: jest.fn(() => true),
      navigateToUrl: jest.fn(),
      requestMemberNavigation: jest.fn(),
    };

    chatFeature.handleChatHistoryClick.call(context as never, {
      target,
      preventDefault,
      stopPropagation,
    } as unknown as MouseEvent);

    expect(confirm).toHaveBeenCalledWith('このコメントの位置にジャンプしますか？');
    expect(context.seekToPlaybackTime).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('seeks when jump confirmation is accepted', () => {
    const confirm = jest.fn(() => true);
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: {
        confirm,
        location: { href: 'https://example.com/watch' },
      },
    });

    const entry = {
      dataset: { playback: '9' },
    };
    const target = {
      closest: jest.fn((selector: string) => {
        if (selector === '.wp-chat-history-toggle') {
          return null;
        }
        if (selector === '.wp-chat-entry') {
          return entry;
        }
        return null;
      }),
    };

    const preventDefault = jest.fn();
    const stopPropagation = jest.fn();

    const context = {
      currentRoom: 'ROOM1',
      isHost: false,
      seekToPlaybackTime: jest.fn(),
      applyRoomParamToUrl: jest.fn((url: string) => url),
      urlsMatchForSync: jest.fn(() => true),
      navigateToUrl: jest.fn(),
      requestMemberNavigation: jest.fn(),
    };

    chatFeature.handleChatHistoryClick.call(context as never, {
      target,
      preventDefault,
      stopPropagation,
    } as unknown as MouseEvent);

    expect(confirm).toHaveBeenCalledWith('このコメントの位置にジャンプしますか？');
    expect(context.seekToPlaybackTime).toHaveBeenCalledWith(9);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('auto scrolls to latest when chat history is already at bottom', () => {
    Object.defineProperty(global, 'document', {
      configurable: true,
      value: {
        createElement: () => createFakeDomElement(),
      },
    });

    const context = {
      ensureChatHistoryRefs: jest.fn(),
      chatHistoryList: createFakeDomElement(),
      isChatHistoryNearBottom: jest.fn(() => true),
      trimChatHistory: jest.fn(),
      updateChatHistoryEmptyState: jest.fn(),
      scrollChatHistoryToLatest: jest.fn(),
      showChatHistoryNewIndicator: jest.fn(),
      formatPlaybackTimeLabel: jest.fn(() => null),
      formatTimestampLabel: jest.fn(() => '12:00:00'),
      chatHistoryExpanded: true,
      chatDisplayMode: 'overlay',
      currentUser: 'self',
      chatHistoryNeedsScroll: false,
    };

    chatFeature.appendChatHistoryEntry.call(context as never, {
      userId: 'other',
      username: 'Alice',
      message: 'new message',
      timestamp: Date.now(),
    });

    expect(context.scrollChatHistoryToLatest).toHaveBeenCalledTimes(1);
    expect(context.showChatHistoryNewIndicator).not.toHaveBeenCalled();
  });

  it('shows new message indicator when not at bottom', () => {
    const openPanel = {
      classList: {
        contains: jest.fn(() => false),
      },
    };
    Object.defineProperty(global, 'document', {
      configurable: true,
      value: {
        createElement: () => createFakeDomElement(),
        getElementById: (id: string) => (id === 'wp-comment-panel' ? openPanel : null),
      },
    });

    const context = {
      ensureChatHistoryRefs: jest.fn(),
      chatHistoryList: createFakeDomElement(),
      isChatHistoryNearBottom: jest.fn(() => false),
      trimChatHistory: jest.fn(),
      updateChatHistoryEmptyState: jest.fn(),
      scrollChatHistoryToLatest: jest.fn(),
      showChatHistoryNewIndicator: jest.fn(),
      formatPlaybackTimeLabel: jest.fn(() => null),
      formatTimestampLabel: jest.fn(() => '12:00:00'),
      chatHistoryExpanded: true,
      chatDisplayMode: 'overlay',
      currentUser: 'self',
      chatHistoryNeedsScroll: false,
    };

    chatFeature.appendChatHistoryEntry.call(context as never, {
      userId: 'other',
      username: 'Alice',
      message: 'new message',
      timestamp: Date.now(),
    });

    expect(context.scrollChatHistoryToLatest).not.toHaveBeenCalled();
    expect(context.showChatHistoryNewIndicator).toHaveBeenCalledTimes(1);
  });

  it('scrollChatHistoryToLatest scrolls body and hides new indicator', () => {
    const requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: {
        requestAnimationFrame,
      },
    });

    const chatHistoryBody = {
      scrollTop: 0,
      scrollHeight: 480,
    };
    const context = {
      ensureChatHistoryRefs: jest.fn(),
      chatHistoryBody,
      chatHistoryNeedsScroll: true,
      chatHistoryExpanded: true,
      chatHistoryAtBottom: false,
      hideChatHistoryNewIndicator: jest.fn(),
    };

    chatFeature.scrollChatHistoryToLatest.call(context as never);

    expect(chatHistoryBody.scrollTop).toBe(480);
    expect(context.chatHistoryNeedsScroll).toBe(false);
    expect(context.chatHistoryAtBottom).toBe(true);
    expect(context.hideChatHistoryNewIndicator).toHaveBeenCalledTimes(1);
  });

  it('hides new indicator when user scrolls back to bottom', () => {
    const context = {
      isChatHistoryNearBottom: jest.fn(() => true),
      hideChatHistoryNewIndicator: jest.fn(),
      chatHistoryAtBottom: false,
    };

    chatFeature.updateChatHistoryBottomState.call(context as never);

    expect(context.chatHistoryAtBottom).toBe(true);
    expect(context.hideChatHistoryNewIndicator).toHaveBeenCalledTimes(1);
  });

  it('binds new indicator click to scroll latest', () => {
    const listeners: Record<string, () => void> = {};
    const indicator = {
      addEventListener: (event: string, handler: () => void) => {
        listeners[event] = handler;
      },
    };

    const context = {
      ensureChatHistoryRefs: jest.fn(),
      chatHistoryEventsBound: false,
      chatHistoryToggle: null,
      chatHistoryList: null,
      chatHistoryBody: null,
      chatHistoryNewIndicator: indicator,
      chatHistoryNeedsScroll: false,
      scrollChatHistoryToLatest: jest.fn(),
    };

    chatFeature.bindChatHistoryEvents.call(context as never);
    listeners.click?.();

    expect(context.chatHistoryNeedsScroll).toBe(true);
    expect(context.scrollChatHistoryToLatest).toHaveBeenCalledTimes(1);
  });
});
