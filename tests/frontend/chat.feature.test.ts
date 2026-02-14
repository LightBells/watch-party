import { chatFeature } from '../../extension/src/content/features/chat';

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
});
