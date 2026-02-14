import { videoFeature } from '../../extension/src/content/features/video';

type VideoHandler = () => void;

const createMockVideo = () => {
  const handlers = new Map<string, VideoHandler>();

  const video = {
    paused: true,
    currentTime: 0,
    duration: 300,
    muted: false,
    addEventListener: jest.fn((event: string, handler: VideoHandler) => {
      handlers.set(event, handler);
    }),
    removeEventListener: jest.fn(),
    play: jest.fn(() => Promise.resolve()),
    pause: jest.fn(function pauseImpl(this: { paused: boolean }) {
      this.paused = true;
    }),
  };

  return { video, handlers };
};

describe('videoFeature manipulation behavior', () => {
  const originalDocument = global.document;
  const originalWindow = global.window;

  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: {
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
      },
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    Object.defineProperty(global, 'document', {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it('queues pending state when syncVideo is called without a detected video element', () => {
    const context = {
      videoElement: null,
      pendingVideoState: null,
      awaitingInitialState: false,
      log: jest.fn(),
    };

    videoFeature.syncVideo.call(context as never, true, 12, 1000);

    expect(context.pendingVideoState).toEqual({
      isPlaying: true,
      currentTime: 12,
      lastUpdateTime: 1000,
    });
    expect(context.awaitingInitialState).toBe(true);
  });

  it('applies paused sync state by seeking and pausing video', () => {
    const { video } = createMockVideo();
    video.paused = false;
    video.currentTime = 1;

    const context = {
      videoElement: video,
      pendingVideoState: null,
      awaitingInitialState: true,
      initialVideoStateApplied: false,
      syncInProgress: false,
      log: jest.fn(),
      flushPendingVideoState: jest.fn(),
    };

    videoFeature.syncVideo.call(context as never, false, 25, Date.now());

    expect(video.currentTime).toBe(25);
    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(context.initialVideoStateApplied).toBe(true);
    expect(context.awaitingInitialState).toBe(false);

    jest.advanceTimersByTime(300);
    expect(context.syncInProgress).toBe(false);
    expect(context.flushPendingVideoState).toHaveBeenCalledTimes(1);
  });

  it('emits play, pause, and sync events from video listeners', () => {
    const { video, handlers } = createMockVideo();
    video.currentTime = 42.5;

    Object.defineProperty(global, 'document', {
      configurable: true,
      value: {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
    });

    const emit = jest.fn();

    const context = {
      videoElement: video,
      videoEventListenersBoundElement: null,
      videoEventListenerCleanups: [] as Array<() => void>,
      socket: { connected: true, emit },
      currentUser: 'user-1',
      isHost: true,
      syncInProgress: false,
      roomPlaybackStatus: 'paused',
      lastUserInteractionAt: 0,
      log: jest.fn(),
      teardownVideoListeners: jest.fn(),
      isPlaybackControlTarget: jest.fn(() => true),
      recordUserInteraction: jest.fn(),
      hasRecentUserInteraction: jest.fn(() => true),
      isConnectedToRoom: jest.fn(() => true),
      shouldEmitPlaybackEvents: jest.fn(() => true),
      syncLocalPlaybackStatus: jest.fn(),
    };

    videoFeature.setupVideoListeners.call(context as never, video as never);

    handlers.get('play')?.();
    handlers.get('pause')?.();
    video.paused = false;
    handlers.get('seeked')?.();

    expect(emit).toHaveBeenCalledWith('play', { currentTime: 42.5, userId: 'user-1' });
    expect(emit).toHaveBeenCalledWith('pause', { currentTime: 42.5, userId: 'user-1' });
    expect(emit).toHaveBeenCalledWith('sync', {
      isPlaying: true,
      currentTime: 42.5,
      userId: 'user-1',
    });
  });
});
