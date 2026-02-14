import { navigationFeature } from '../../extension/src/content/features/navigation';

describe('navigationFeature', () => {
  const originalWindow = global.window;
  const originalDocument = global.document;
  const originalNavigator = global.navigator;

  afterEach(() => {
    Object.defineProperty(global, 'window', { configurable: true, value: originalWindow });
    Object.defineProperty(global, 'document', { configurable: true, value: originalDocument });
    Object.defineProperty(global, 'navigator', { configurable: true, value: originalNavigator });
  });

  it('adds and removes room hash parameter for URL operations', () => {
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: {
        location: {
          href: 'https://example.com/watch?x=1#foo=bar',
          origin: 'https://example.com',
        },
        history: {
          replaceState: jest.fn(),
          state: null,
        },
      },
    });

    const context = { log: jest.fn() };

    const withRoom = navigationFeature.applyRoomParamToUrl.call(
      context as never,
      'https://example.com/watch?x=1#foo=bar',
      'ROOM1',
    );

    expect(withRoom).toContain('#foo=bar&watchparty-room=ROOM1');

    const normalized = navigationFeature.normalizeUrlForComparison.call(
      context as never,
      'https://example.com/watch?x=1&watchparty-room=ROOM1#foo=bar&watchparty-room=ROOM1',
    );

    expect(normalized).toBe('https://example.com/watch?x=1#foo=bar');
  });

  it('compares URLs for sync with subset semantics', () => {
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: {
        location: {
          origin: 'https://example.com',
        },
      },
    });

    const context = { log: jest.fn(), debugNavigation: jest.fn() };

    expect(
      navigationFeature.urlsMatchForSync.call(
        context as never,
        'https://example.com/watch?episode=1',
        'https://example.com/watch?episode=1&lang=ja',
      ),
    ).toBe(true);

    expect(
      navigationFeature.urlsEquivalentForSync.call(
        {
          ...context,
          urlsMatchForSync: navigationFeature.urlsMatchForSync,
        } as never,
        'https://example.com/watch?episode=1',
        'https://example.com/watch?episode=1&lang=ja',
      ),
    ).toBe(false);
  });

  it('broadcasts current URL only for host and suppresses duplicates', () => {
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: {
        location: {
          href: 'https://example.com/watch',
          origin: 'https://example.com',
        },
        history: { replaceState: jest.fn(), state: null },
      },
    });

    const emit = jest.fn();
    const context = {
      debugNavigation: jest.fn(),
      log: jest.fn(),
      socket: { connected: true, emit },
      isHost: true,
      currentRoom: 'ROOM1',
      lastBroadcastUrl: null,
      currentRoomUrl: null,
      ensureShareLink: jest.fn(() => 'https://example.com/watch#watchparty-room=ROOM1'),
      urlsEquivalentForSync: navigationFeature.urlsEquivalentForSync,
      urlsMatchForSync: navigationFeature.urlsMatchForSync,
      applyRoomParamToUrl: navigationFeature.applyRoomParamToUrl,
    };

    navigationFeature.broadcastCurrentUrl.call(context as never);
    navigationFeature.broadcastCurrentUrl.call(context as never);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('navigate', {
      url: 'https://example.com/watch#watchparty-room=ROOM1',
    });
  });

  it('copies share link with Clipboard API and shows feedback', async () => {
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: {
        setTimeout,
        clearTimeout,
      },
    });

    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          writeText: jest.fn(async () => undefined),
        },
      },
    });

    const context = {
      getShareUrl: jest.fn(() => 'https://example.com/watch#watchparty-room=ROOMX'),
      showShareFeedback: jest.fn(),
      log: jest.fn(),
    };

    await navigationFeature.copyShareLink.call(context as never);

    expect(global.navigator.clipboard?.writeText).toHaveBeenCalledWith(
      'https://example.com/watch#watchparty-room=ROOMX',
    );
    expect(context.showShareFeedback).toHaveBeenCalledWith('共有リンクをコピーしました');
  });
});
