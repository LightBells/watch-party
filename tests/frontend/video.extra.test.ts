import { videoFeature } from '../../extension/src/content/features/video';

describe('videoFeature additional behavior', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: {
        setInterval,
        clearInterval,
      },
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it('returns playback time from video first then pending state', () => {
    const contextWithVideo = {
      videoElement: { currentTime: 13.2 },
      pendingVideoState: { currentTime: 99 },
    };
    expect(videoFeature.getCurrentPlaybackTime.call(contextWithVideo as never)).toBe(13.2);

    const contextWithPending = {
      videoElement: null,
      pendingVideoState: { currentTime: 7.4 },
    };
    expect(videoFeature.getCurrentPlaybackTime.call(contextWithPending as never)).toBe(7.4);
  });

  it('starts and stops member heartbeat interval', () => {
    const emit = jest.fn();
    const context = {
      socket: { connected: true, emit },
      memberHeartbeatIntervalId: null,
    };

    videoFeature.startMemberHeartbeat.call(context as never);
    expect(emit).toHaveBeenCalledWith('heartbeat');

    jest.advanceTimersByTime(4100);
    expect(emit).toHaveBeenCalledTimes(2);

    videoFeature.stopMemberHeartbeat.call(context as never);
    expect(context.memberHeartbeatIntervalId).toBeNull();
  });

  it('applies room video state for member and skips host', () => {
    const memberContext = {
      isHost: false,
      pendingVideoState: null,
      awaitingInitialState: false,
      initialVideoStateApplied: false,
      enforcePauseWhileAwaiting: jest.fn(),
      flushPendingVideoState: jest.fn(),
    };

    videoFeature.applyRoomVideoState.call(memberContext as never, {
      isPlaying: true,
      currentTime: 44,
      lastUpdateTime: 1,
    });

    expect(memberContext.pendingVideoState).toEqual({
      isPlaying: true,
      currentTime: 44,
      lastUpdateTime: 1,
    });
    expect(memberContext.enforcePauseWhileAwaiting).toHaveBeenCalledTimes(1);
    expect(memberContext.flushPendingVideoState).toHaveBeenCalledTimes(1);

    const hostContext = {
      isHost: true,
      log: jest.fn(),
    };

    videoFeature.applyRoomVideoState.call(hostContext as never, {
      isPlaying: false,
      currentTime: 0,
      lastUpdateTime: 1,
    });

    expect(hostContext.log).toHaveBeenCalled();
  });

  it('broadcasts host video state only when host, socket connected, and video exists', () => {
    const emit = jest.fn();
    const context = {
      isHost: true,
      socket: { connected: true, emit },
      videoElement: { paused: false, currentTime: 12.5 },
      currentUser: 'USER1',
      log: jest.fn(),
    };

    videoFeature.broadcastHostVideoState.call(context as never, 'test');

    expect(emit).toHaveBeenCalledWith('sync', {
      isPlaying: true,
      currentTime: 12.5,
      userId: 'USER1',
    });
  });
});
