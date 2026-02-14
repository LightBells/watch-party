import { ChildProcess, spawn } from 'child_process';
import { io, Socket } from 'socket.io-client';

jest.setTimeout(120000);

interface JoinRoomResponse {
  token: string;
  userId: string;
  roomId: string;
  username: string;
  isHost: boolean;
}

interface MemberStatusPayload {
  members: Array<{ id: string; status: 'online' | 'offline' }>;
  changedUserId: string | null;
  timestamp: number;
}

const TEST_HOST_REASSIGN_DELAY_MS = 3000;
const TEST_HEARTBEAT_INTERVAL_MS = 1500;
const TEST_HEARTBEAT_TIMEOUT_MS = TEST_HEARTBEAT_INTERVAL_MS * 2;

const makePort = (): number => 4000 + Math.floor(Math.random() * 20000);

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const waitForHealth = async (baseUrl: string, timeoutMs = 10000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore until timeout.
    }

    await wait(200);
  }

  throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
};

const joinRoom = async (
  baseUrl: string,
  roomId: string,
  username: string,
): Promise<JoinRoomResponse> => {
  const response = await fetch(`${baseUrl}/api/join-room`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ roomId, username, pageUrl: 'https://example.com/watch' }),
  });

  if (!response.ok) {
    throw new Error(`join-room failed with status ${response.status}`);
  }

  return (await response.json()) as JoinRoomResponse;
};

const waitForEvent = <T>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> =>
  new Promise((resolve, reject) => {
    const onEvent = (payload: T): void => {
      clearTimeout(timeoutId);
      resolve(payload);
    };

    const timeoutId = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for event \"${event}\"`));
    }, timeoutMs);

    socket.once(event, onEvent);
  });

const waitForEventMatching = <T>(
  socket: Socket,
  event: string,
  predicate: (payload: T) => boolean,
  timeoutMs = 5000,
): Promise<T> =>
  new Promise((resolve, reject) => {
    const onEvent = (payload: T): void => {
      if (!predicate(payload)) {
        return;
      }
      clearTimeout(timeoutId);
      socket.off(event, onEvent);
      resolve(payload);
    };

    const timeoutId = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for matching event \"${event}\"`));
    }, timeoutMs);

    socket.on(event, onEvent);
  });

const expectNoEvent = (socket: Socket, event: string, timeoutMs = 600): Promise<void> =>
  new Promise((resolve, reject) => {
    const onEvent = () => {
      clearTimeout(timeoutId);
      socket.off(event, onEvent);
      reject(new Error(`Unexpected event \"${event}\" received`));
    };

    const timeoutId = setTimeout(() => {
      socket.off(event, onEvent);
      resolve();
    }, timeoutMs);

    socket.on(event, onEvent);
  });

const connectSocket = (baseUrl: string, token: string): Socket =>
  io(baseUrl, {
    auth: { token },
    transports: ['polling'],
    forceNew: true,
  });

describe('server e2e', () => {
  const port = makePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let serverProcess: ChildProcess | null = null;

  beforeAll(async () => {
    serverProcess = spawn('node', ['dist/server/index.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'test',
        JWT_SECRET: 'watch-party-test-secret',
        DEBUG_MODE: 'false',
        HOST_REASSIGN_DELAY_MS: String(TEST_HOST_REASSIGN_DELAY_MS),
        HEARTBEAT_INTERVAL_MS: String(TEST_HEARTBEAT_INTERVAL_MS),
        HEARTBEAT_TIMEOUT_MS: String(TEST_HEARTBEAT_TIMEOUT_MS),
      },
      stdio: 'pipe',
    });

    serverProcess.on('error', (error) => {
      // eslint-disable-next-line no-console
      console.error('Failed to start server process', error);
    });

    await waitForHealth(baseUrl);
  });

  afterAll(async () => {
    if (!serverProcess || serverProcess.killed) {
      return;
    }

    serverProcess.kill('SIGTERM');
    await wait(300);

    if (!serverProcess.killed) {
      serverProcess.kill('SIGKILL');
    }
  });

  it('returns 400 when join-room request misses required fields', async () => {
    const response = await fetch(`${baseUrl}/api/join-room`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roomId: '', username: '' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'roomId and username are required' });
  });

  it('broadcasts play, pause, and sync events between room members', async () => {
    const roomId = `room-playback-${Date.now()}`;
    const hostJoin = await joinRoom(baseUrl, roomId, 'host-user');
    const memberJoin = await joinRoom(baseUrl, roomId, 'member-user');

    const hostSocket = connectSocket(baseUrl, hostJoin.token);
    const memberSocket = connectSocket(baseUrl, memberJoin.token);

    try {
      await Promise.all([
        waitForEvent(hostSocket, 'room-state'),
        waitForEvent(memberSocket, 'room-state'),
      ]);

      const playPromise = waitForEvent<{ currentTime: number; userId: string }>(memberSocket, 'play');
      hostSocket.emit('play', { currentTime: 42.5 });
      await expect(playPromise).resolves.toEqual(
        expect.objectContaining({ currentTime: 42.5, userId: hostJoin.userId }),
      );

      const pausePromise = waitForEvent<{ currentTime: number; userId: string }>(memberSocket, 'pause');
      hostSocket.emit('pause', { currentTime: 41.0 });
      await expect(pausePromise).resolves.toEqual(
        expect.objectContaining({ currentTime: 41, userId: hostJoin.userId }),
      );

      const syncPromise = waitForEvent<{ isPlaying: boolean; currentTime: number; userId: string }>(
        memberSocket,
        'sync',
      );
      hostSocket.emit('sync', { isPlaying: true, currentTime: 88.8 });
      await expect(syncPromise).resolves.toEqual(
        expect.objectContaining({ isPlaying: true, currentTime: 88.8, userId: hostJoin.userId }),
      );
    } finally {
      hostSocket.disconnect();
      memberSocket.disconnect();
    }
  });

  it('broadcasts comment events and serves comment-history to new members', async () => {
    const roomId = `room-comment-${Date.now()}`;
    const hostJoin = await joinRoom(baseUrl, roomId, 'host-user');
    const memberJoin = await joinRoom(baseUrl, roomId, 'member-user');

    const hostSocket = connectSocket(baseUrl, hostJoin.token);
    const memberSocket = connectSocket(baseUrl, memberJoin.token);

    try {
      await Promise.all([
        waitForEvent(hostSocket, 'room-state'),
        waitForEvent(memberSocket, 'room-state'),
      ]);

      const commentPromise = waitForEvent<{
        message: string;
        userId: string;
        playbackTime: number | null;
        mediaInfo: string | null;
      }>(memberSocket, 'comment');

      hostSocket.emit('comment', {
        message: 'hello everyone',
        playbackTime: 11.2,
        mediaInfo: 'Episode 3',
      });

      await expect(commentPromise).resolves.toEqual(
        expect.objectContaining({
          message: 'hello everyone',
          userId: hostJoin.userId,
          playbackTime: 11.2,
          mediaInfo: 'Episode 3',
        }),
      );

      const thirdJoin = await joinRoom(baseUrl, roomId, 'third-user');
      const thirdSocket = connectSocket(baseUrl, thirdJoin.token);

      try {
        const [history] = await Promise.all([
          waitForEvent<Array<{ message: string; userId: string }>>(thirdSocket, 'comment-history'),
          waitForEvent(thirdSocket, 'room-state'),
        ]);

        expect(history).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ message: 'hello everyone', userId: hostJoin.userId }),
          ]),
        );
      } finally {
        thirdSocket.disconnect();
      }
    } finally {
      hostSocket.disconnect();
      memberSocket.disconnect();
    }
  });

  it('allows host navigate and ignores member navigate event on host channel', async () => {
    const roomId = `room-nav-${Date.now()}`;
    const hostJoin = await joinRoom(baseUrl, roomId, 'host-user');
    const memberJoin = await joinRoom(baseUrl, roomId, 'member-user');

    const hostSocket = connectSocket(baseUrl, hostJoin.token);
    const memberSocket = connectSocket(baseUrl, memberJoin.token);

    try {
      await Promise.all([
        waitForEvent(hostSocket, 'room-state'),
        waitForEvent(memberSocket, 'room-state'),
      ]);

      memberSocket.emit('navigate', { url: 'https://example.com/member-attempt' });
      await expect(expectNoEvent(hostSocket, 'navigate')).resolves.toBeUndefined();

      const navigatePromise = waitForEvent<{ url: string; userId: string }>(memberSocket, 'navigate');
      hostSocket.emit('navigate', { url: 'https://example.com/host-navigation' });
      await expect(navigatePromise).resolves.toEqual(
        expect.objectContaining({
          url: 'https://example.com/host-navigation',
          userId: hostJoin.userId,
        }),
      );
    } finally {
      hostSocket.disconnect();
      memberSocket.disconnect();
    }
  });

  it('promotes member to host on member-navigate and notifies room', async () => {
    const roomId = `room-member-nav-${Date.now()}`;
    const hostJoin = await joinRoom(baseUrl, roomId, 'host-user');
    const memberJoin = await joinRoom(baseUrl, roomId, 'member-user');

    const hostSocket = connectSocket(baseUrl, hostJoin.token);
    const memberSocket = connectSocket(baseUrl, memberJoin.token);

    try {
      await Promise.all([
        waitForEvent(hostSocket, 'room-state'),
        waitForEvent(memberSocket, 'room-state'),
      ]);

      const hostChangedPromise = waitForEvent<{ newHost: string }>(hostSocket, 'host-changed');
      const navigatePromise = waitForEvent<{ url: string; userId: string }>(hostSocket, 'navigate');

      memberSocket.emit('member-navigate', { url: 'https://example.com/member-driven-nav' });

      await expect(hostChangedPromise).resolves.toEqual(
        expect.objectContaining({ newHost: memberJoin.userId }),
      );

      await expect(navigatePromise).resolves.toEqual(
        expect.objectContaining({
          url: 'https://example.com/member-driven-nav',
          userId: memberJoin.userId,
        }),
      );
    } finally {
      hostSocket.disconnect();
      memberSocket.disconnect();
    }
  });

  it('reassigns host after current host disconnects', async () => {
    const roomId = `room-reassign-${Date.now()}`;
    const hostJoin = await joinRoom(baseUrl, roomId, 'host-user');
    const memberJoin = await joinRoom(baseUrl, roomId, 'member-user');

    const hostSocket = connectSocket(baseUrl, hostJoin.token);
    const memberSocket = connectSocket(baseUrl, memberJoin.token);

    try {
      await Promise.all([
        waitForEvent(hostSocket, 'room-state'),
        waitForEvent(memberSocket, 'room-state'),
      ]);

      const hostChangedPromise = waitForEvent<{ newHost: string }>(
        memberSocket,
        'host-changed',
        TEST_HOST_REASSIGN_DELAY_MS + 9000,
      );

      hostSocket.disconnect();

      await expect(hostChangedPromise).resolves.toEqual(
        expect.objectContaining({ newHost: memberJoin.userId }),
      );
    } finally {
      memberSocket.disconnect();
    }
  });

  it('marks members offline when heartbeat is missing', async () => {
    const roomId = `room-heartbeat-${Date.now()}`;
    const hostJoin = await joinRoom(baseUrl, roomId, 'host-user');
    const memberJoin = await joinRoom(baseUrl, roomId, 'member-user');

    const hostSocket = connectSocket(baseUrl, hostJoin.token);
    const memberSocket = connectSocket(baseUrl, memberJoin.token);

    try {
      await Promise.all([
        waitForEvent(hostSocket, 'room-state'),
        waitForEvent(memberSocket, 'room-state'),
      ]);

      const offlineStatus = await waitForEventMatching<MemberStatusPayload>(
        memberSocket,
        'member-status',
        (payload) => payload.members.some((member) => member.status === 'offline'),
        TEST_HEARTBEAT_TIMEOUT_MS + TEST_HEARTBEAT_INTERVAL_MS + 9000,
      );

      expect(offlineStatus.members.some((member) => member.status === 'offline')).toBe(true);
    } finally {
      hostSocket.disconnect();
      memberSocket.disconnect();
    }
  });

  it('keeps host identity when host reconnects before reassignment timer fires', async () => {
    const roomId = `room-host-return-${Date.now()}`;
    const hostJoin = await joinRoom(baseUrl, roomId, 'host-user');
    const memberJoin = await joinRoom(baseUrl, roomId, 'member-user');

    const hostSocket = connectSocket(baseUrl, hostJoin.token);
    const memberSocket = connectSocket(baseUrl, memberJoin.token);

    try {
      await Promise.all([
        waitForEvent(hostSocket, 'room-state'),
        waitForEvent(memberSocket, 'room-state'),
      ]);

      hostSocket.disconnect();
      await wait(150);

      const reconnectSocket = connectSocket(baseUrl, hostJoin.token);

      try {
        const roomState = await waitForEvent<{ isHost: boolean }>(reconnectSocket, 'room-state', 5000);
        expect(roomState.isHost).toBe(true);

        await expect(
          expectNoEvent(memberSocket, 'host-changed', TEST_HOST_REASSIGN_DELAY_MS + 1000),
        ).resolves.toBeUndefined();
      } finally {
        reconnectSocket.disconnect();
      }
    } finally {
      memberSocket.disconnect();
    }
  });
});
