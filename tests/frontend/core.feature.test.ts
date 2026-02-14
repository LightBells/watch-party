import { coreFeature } from '../../extension/src/content/features/core';

describe('coreFeature', () => {
  const originalWindow = global.window;
  const originalDocument = global.document;
  const originalChrome = (global as unknown as { chrome?: unknown }).chrome;

  afterEach(() => {
    Object.defineProperty(global, 'window', { configurable: true, value: originalWindow });
    Object.defineProperty(global, 'document', { configurable: true, value: originalDocument });
    (global as unknown as { chrome?: unknown }).chrome = originalChrome;
  });

  it('returns expected playback emit permission by host/initial-state flags', () => {
    const base = {
      isHost: false,
      awaitingInitialState: false,
      initialVideoStateApplied: true,
      log: jest.fn(),
    };

    expect(coreFeature.shouldEmitPlaybackEvents.call({ ...base, isHost: true } as never)).toBe(true);
    expect(coreFeature.shouldEmitPlaybackEvents.call({ ...base, awaitingInitialState: true } as never)).toBe(false);
    expect(coreFeature.shouldEmitPlaybackEvents.call({ ...base, initialVideoStateApplied: false } as never)).toBe(false);
    expect(coreFeature.shouldEmitPlaybackEvents.call(base as never)).toBe(true);
  });

  it('does not mark as awaiting initial state when no room is active after init', async () => {
    const context = {
      loadDebugMode: jest.fn(async () => undefined),
      detectVideoElement: jest.fn(async () => undefined),
      createWatchPartyUI: jest.fn(),
      setupInteractionHandlers: jest.fn(),
      setupMessageListener: jest.fn(),
      monitorUrlChanges: jest.fn(),
      restoreRoomState: jest.fn(async () => undefined),
      handleDeepLink: jest.fn(async () => undefined),
      currentRoom: null,
      isHost: false,
      initialVideoStateApplied: false,
      awaitingInitialState: true,
    };

    await coreFeature.init.call(context as never);

    expect(context.awaitingInitialState).toBe(false);
  });

  it('resolves tab id from chrome runtime message and falls back to timestamp when unavailable', async () => {
    const sendMessage = jest.fn(async () => ({ tabId: 777 }));
    (global as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage },
    };

    const context = { tabId: null, log: jest.fn() };
    await expect(coreFeature.resolveTabId.call(context as never)).resolves.toBe(777);
    expect(sendMessage).toHaveBeenCalledWith({ action: 'getTabId' });

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(99999);
    (global as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: jest.fn(async () => ({})) },
    };

    const fallbackContext = { tabId: null, log: jest.fn() };
    await expect(coreFeature.resolveTabId.call(fallbackContext as never)).resolves.toBe(99999);
    nowSpy.mockRestore();
  });

  it('wires interaction handlers and flushes pending state only when needed', () => {
    let clickHandler: (() => void) | null = null;
    let keydownHandler: (() => void) | null = null;

    Object.defineProperty(global, 'document', {
      configurable: true,
      value: {
        addEventListener: (event: string, handler: () => void) => {
          if (event === 'click') {
            clickHandler = handler;
          }
          if (event === 'keydown') {
            keydownHandler = handler;
          }
        },
      },
    });

    const context = {
      pendingVideoState: { isPlaying: true, currentTime: 1, lastUpdateTime: 1 },
      syncInProgress: false,
      log: jest.fn(),
      flushPendingVideoState: jest.fn(),
    };

    coreFeature.setupInteractionHandlers.call(context as never);
    clickHandler?.();
    keydownHandler?.();

    expect(context.flushPendingVideoState).toHaveBeenCalledTimes(2);

    context.syncInProgress = true;
    clickHandler?.();
    expect(context.flushPendingVideoState).toHaveBeenCalledTimes(2);
  });

  it('responds to getConnectionStatus message through runtime listener', () => {
    let onMessageHandler:
      | ((request: { action?: string }, sender: unknown, sendResponse: (value: unknown) => void) => boolean)
      | null = null;

    (global as unknown as { chrome: unknown }).chrome = {
      runtime: {
        onMessage: {
          addListener: (
            cb: (request: { action?: string }, sender: unknown, sendResponse: (value: unknown) => void) => boolean,
          ) => {
            onMessageHandler = cb;
          },
        },
      },
    };

    const context = {
      socket: { connected: true },
      currentRoom: 'ROOM01',
      currentUser: 'USER01',
      isHost: true,
    };

    coreFeature.setupMessageListener.call(context as never);

    const sendResponse = jest.fn();
    const shouldKeepChannel = onMessageHandler?.({ action: 'getConnectionStatus' }, {}, sendResponse);

    expect(shouldKeepChannel).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      connected: true,
      roomId: 'ROOM01',
      userId: 'USER01',
      isHost: true,
    });
  });
});
