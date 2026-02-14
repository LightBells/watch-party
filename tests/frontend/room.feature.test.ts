import { io } from 'socket.io-client';

import { roomFeature } from '../../extension/src/content/features/room';

jest.mock('socket.io-client', () => ({
  io: jest.fn(),
}));

type FakeSocket = {
  connected: boolean;
  on: jest.Mock;
  emit: jest.Mock;
  disconnect: jest.Mock;
};

const buildSocket = (): { socket: FakeSocket; handlers: Map<string, (...args: unknown[]) => void> } => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket: FakeSocket = {
    connected: true,
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    }),
    emit: jest.fn(),
    disconnect: jest.fn(),
  };

  return { socket, handlers };
};

describe('roomFeature', () => {
  const originalWindow = global.window;
  const originalChrome = (global as unknown as { chrome?: unknown }).chrome;
  const originalFetch = global.fetch;

  beforeEach(() => {
    (global as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage: jest.fn(async () => undefined),
      },
    };
  });

  afterEach(() => {
    Object.defineProperty(global, 'window', { configurable: true, value: originalWindow });
    (global as unknown as { chrome?: unknown }).chrome = originalChrome;
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('joinRoom shows alert when room id input is empty', async () => {
    const alert = jest.fn();
    Object.defineProperty(global, 'window', { configurable: true, value: { alert } });

    const context = {
      getInput: jest.fn(() => ({ value: '   ' })),
      joinRoomById: jest.fn(),
    };

    await roomFeature.joinRoom.call(context as never);

    expect(alert).toHaveBeenCalledWith('ルームIDを入力してください');
    expect(context.joinRoomById).not.toHaveBeenCalled();
  });

  it('createRoom generates id, writes it to input and joins', async () => {
    const roomInput = { value: '' };

    const context = {
      generateRoomId: jest.fn(() => 'ABC123'),
      getInput: jest.fn(() => roomInput),
      joinRoomById: jest.fn(async () => undefined),
    };

    await roomFeature.createRoom.call(context as never);

    expect(roomInput.value).toBe('ABC123');
    expect(context.joinRoomById).toHaveBeenCalledWith('ABC123');
  });

  it('joinRoomById hydrates state and connects when API succeeds', async () => {
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: {
        alert: jest.fn(),
        location: {
          href: 'https://example.com/watch',
        },
      },
    });

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        roomId: 'ROOMX',
        token: 'TOKENX',
        userId: 'USERX',
        isHost: false,
        playbackStatus: 'paused',
        videoState: { isPlaying: false, currentTime: 5, lastUpdateTime: 1 },
        currentUrl: 'https://example.com/watch#watchparty-room=ROOMX',
      }),
    })) as typeof fetch;

    const context = {
      socket: null,
      currentRoom: null,
      currentUser: null,
      username: null,
      isHost: false,
      awaitingInitialState: false,
      initialVideoStateApplied: false,
      roomPlaybackStatus: 'playing',
      authToken: null,
      pendingVideoState: null,
      lastKnownUrl: 'https://example.com/watch',
      serverUrl: 'http://localhost:3000',
      getStoredUsername: jest.fn(async () => 'alice'),
      saveRoomData: jest.fn(async () => undefined),
      updateHostHeartbeat: jest.fn(),
      enforcePauseWhileAwaiting: jest.fn(),
      syncLocalPlaybackStatus: jest.fn(),
      flushPendingVideoState: jest.fn(),
      ensureShareLink: jest.fn((roomId: string) => `https://example.com/watch#watchparty-room=${roomId}`),
      syncRoomUrl: jest.fn(),
      persistRoomState: jest.fn(async () => undefined),
      connectToRoom: jest.fn(async () => undefined),
      updateStatus: jest.fn(),
      showRoomInfo: jest.fn(),
      updateShareControls: jest.fn(),
      log: jest.fn(),
    };

    await roomFeature.joinRoomById.call(context as never, 'ROOMX');

    expect(context.currentRoom).toBe('ROOMX');
    expect(context.currentUser).toBe('USERX');
    expect(context.username).toBe('alice');
    expect(context.authToken).toBe('TOKENX');
    expect(context.awaitingInitialState).toBe(true);
    expect(context.syncLocalPlaybackStatus).toHaveBeenCalledWith('paused');
    expect(context.flushPendingVideoState).toHaveBeenCalledTimes(1);
    expect(context.connectToRoom).toHaveBeenCalledWith('TOKENX');
  });

  it('leaveRoom disconnects and clears local room state', async () => {
    const socket = { disconnect: jest.fn() };

    const context = {
      socket,
      currentRoom: 'ROOM1',
      currentUser: 'USER1',
      username: 'alice',
      isHost: true,
      navigationInProgress: true,
      awaitingInitialState: true,
      initialVideoStateApplied: true,
      authToken: 'TOKEN1',
      lastBroadcastUrl: 'x',
      currentRoomUrl: 'y',
      stopMemberHeartbeat: jest.fn(),
      removeRoomData: jest.fn(async () => undefined),
      stopHostUrlHeartbeat: jest.fn(),
      clearShareLink: jest.fn(),
      updateShareControls: jest.fn(),
      hideShareFeedback: jest.fn(),
      updateStatus: jest.fn(),
      showRoomSetup: jest.fn(),
    };

    await roomFeature.leaveRoom.call(context as never);

    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(context.socket).toBeNull();
    expect(context.currentRoom).toBeNull();
    expect(context.currentUser).toBeNull();
    expect(context.username).toBeNull();
    expect(context.isHost).toBe(false);
    expect(context.authToken).toBeNull();
    expect(context.updateStatus).toHaveBeenCalledWith('切断');
    expect(context.showRoomSetup).toHaveBeenCalledTimes(1);
  });

  it('connectToRoom registers handlers and host connect broadcasts state', async () => {
    const { socket, handlers } = buildSocket();
    (io as unknown as jest.Mock).mockReturnValue(socket);

    const context = {
      socket: null,
      serverUrl: 'http://localhost:3000',
      currentRoom: 'ROOM1',
      currentUser: 'USER1',
      isHost: true,
      members: [],
      currentRoomUrl: null,
      authToken: null,
      initialVideoStateApplied: false,
      awaitingInitialState: true,
      roomPlaybackStatus: 'paused',
      debugNavigation: jest.fn(),
      log: jest.fn(),
      updateStatus: jest.fn(),
      showRoomInfo: jest.fn(),
      startMemberHeartbeat: jest.fn(),
      broadcastCurrentUrl: jest.fn(),
      broadcastHostVideoState: jest.fn(),
      flushPendingVideoState: jest.fn(),
      stopMemberHeartbeat: jest.fn(),
      stopHostUrlHeartbeat: jest.fn(),
      updateHostHeartbeat: jest.fn(),
      updateMembers: jest.fn(),
      syncLocalPlaybackStatus: jest.fn(),
      syncRoomUrl: jest.fn(),
      applyRoomVideoState: jest.fn(),
      ensureShareLink: jest.fn(),
      persistRoomState: jest.fn(async () => undefined),
      syncVideo: jest.fn(),
      appendChatHistoryEntry: jest.fn(),
      showComment: jest.fn(),
      setChatHistory: jest.fn(),
      showToast: jest.fn(),
      notifyStatusTransitions: jest.fn(),
    };

    await roomFeature.connectToRoom.call(context as never, 'TOKEN1');

    expect(io).toHaveBeenCalledWith('http://localhost:3000', {
      auth: { token: 'TOKEN1' },
      transports: ['polling'],
    });

    const connectHandler = handlers.get('connect');
    connectHandler?.();

    expect(context.updateStatus).toHaveBeenCalledWith('接続中');
    expect(context.startMemberHeartbeat).toHaveBeenCalledTimes(1);
    expect(context.broadcastCurrentUrl).toHaveBeenCalledTimes(1);
    expect(context.broadcastHostVideoState).toHaveBeenCalledWith('socket-connect');

    const playHandler = handlers.get('play');
    playHandler?.({ currentTime: 25, userId: 'OTHER', timestamp: 1 });
    expect(context.syncVideo).toHaveBeenCalledWith(true, 25, 1);
  });

  it('does not rebroadcast host sync when a new user joins during playback', async () => {
    const { socket, handlers } = buildSocket();
    (io as unknown as jest.Mock).mockReturnValue(socket);

    const context = {
      socket: null,
      serverUrl: 'http://localhost:3000',
      currentRoom: 'ROOM1',
      currentUser: 'HOST1',
      isHost: true,
      members: [{ id: 'HOST1', username: 'host' }],
      currentRoomUrl: 'https://example.com/watch#watchparty-room=ROOM1',
      authToken: null,
      initialVideoStateApplied: true,
      awaitingInitialState: false,
      roomPlaybackStatus: 'playing',
      debugNavigation: jest.fn(),
      log: jest.fn(),
      updateStatus: jest.fn(),
      showRoomInfo: jest.fn(),
      startMemberHeartbeat: jest.fn(),
      broadcastCurrentUrl: jest.fn(),
      broadcastHostVideoState: jest.fn(),
      flushPendingVideoState: jest.fn(),
      stopMemberHeartbeat: jest.fn(),
      stopHostUrlHeartbeat: jest.fn(),
      updateHostHeartbeat: jest.fn(),
      updateMembers: jest.fn(),
      syncLocalPlaybackStatus: jest.fn(),
      syncRoomUrl: jest.fn(),
      applyRoomVideoState: jest.fn(),
      ensureShareLink: jest.fn(),
      persistRoomState: jest.fn(async () => undefined),
      syncVideo: jest.fn(),
      appendChatHistoryEntry: jest.fn(),
      showComment: jest.fn(),
      setChatHistory: jest.fn(),
      showToast: jest.fn(),
      notifyStatusTransitions: jest.fn(),
    };

    await roomFeature.connectToRoom.call(context as never, 'TOKEN1');

    const userJoinedHandler = handlers.get('user-joined');
    userJoinedHandler?.({
      userId: 'USER2',
      members: [
        { id: 'HOST1', username: 'host' },
        { id: 'USER2', username: 'member' },
      ],
      timestamp: 1234,
    });

    expect(context.broadcastHostVideoState).not.toHaveBeenCalled();
  });
});
