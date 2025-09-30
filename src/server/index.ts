import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { Server as SocketIOServer, Socket } from 'socket.io';

dotenv.config();

const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

const debugLog = (...args: unknown[]): void => {
  if (DEBUG_MODE) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
};

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be defined in the environment');
}

const JWT_SECRET = process.env.JWT_SECRET;

const USE_FIRESTORE = process.env.NODE_ENV === 'production';

const HOST_REASSIGN_DELAY_MS = 7000;

interface VideoState {
  isPlaying: boolean;
  currentTime: number;
  lastUpdateTime: number;
}

type PlaybackStatus = 'playing' | 'paused';

interface RoomMember {
  id: string;
  username: string;
  joinedAt: number;
}

interface Room {
  id: string;
  host: string;
  members: Map<string, RoomMember>;
  videoState: VideoState;
  playbackStatus: PlaybackStatus;
  currentUrl: string | null;
  previousHostId: string | null;
  hostReassignTimer?: NodeJS.Timeout | null;
}

interface CommentPayload {
  message: string;
}

interface PlaybackPayload {
  currentTime: number;
  userId?: string;
}

interface SyncPayload extends PlaybackPayload {
  isPlaying: boolean;
}

interface ServerToClientEvents {
  'room-state': (data: {
    members: RoomMember[];
    videoState: VideoState;
    playbackStatus: PlaybackStatus;
    isHost: boolean;
    currentUrl: string | null;
  }) => void;
  play: (data: {
    currentTime: number;
    userId: string;
    timestamp: number;
  }) => void;
  pause: (data: {
    currentTime: number;
    userId: string;
    timestamp: number;
  }) => void;
  sync: (data: {
    isPlaying: boolean;
    currentTime: number;
    userId: string;
    timestamp: number;
  }) => void;
  comment: (data: {
    userId: string;
    username?: string;
    message: string;
    timestamp: number;
  }) => void;
  'user-joined': (data: { userId: string; members: RoomMember[]; timestamp: number }) => void;
  'user-left': (data: { userId: string; members: RoomMember[]; timestamp: number }) => void;
  'host-changed': (data: { newHost: string; timestamp: number }) => void;
  navigate: (data: { url: string; userId: string; timestamp: number }) => void;
}

interface ClientToServerEvents {
  comment: (data: CommentPayload) => void;
  play: (data: PlaybackPayload) => void;
  pause: (data: PlaybackPayload) => void;
  sync: (data: SyncPayload) => void;
  navigate: (data: NavigatePayload) => void;
  'member-navigate': (data: NavigatePayload) => void;
}

interface InterServerEvents {}

interface SocketData {
  userId: string;
  roomId: string;
}

interface TokenPayload extends JwtPayload {
  userId: string;
  roomId: string;
}

interface NavigatePayload {
  url: string;
}

const rooms: Map<string, Room> = new Map();
const userSessions: Map<string, Set<string>> = new Map();

const generateToken = (userId: string, roomId: string): string =>
  jwt.sign({ userId, roomId }, JWT_SECRET, { expiresIn: '24h' });

const verifyToken = (token: string): TokenPayload | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (error) {
    return null;
  }
};

const app = express();
const server = http.createServer(app);

const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
  server,
  {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['polling'],
    allowEIO3: true,
  },
);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));

interface JoinRoomRequest {
  roomId: string;
  username: string;
  pageUrl?: string;
}

app.post('/api/join-room', (req: Request<unknown, unknown, JoinRoomRequest>, res: Response) => {
  const { roomId, username, pageUrl } = req.body;
  const userId = uuidv4();

  if (!roomId || !username) {
    return res.status(400).json({ error: 'roomId and username are required' });
  }

  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      host: userId,
      members: new Map(),
      videoState: {
        isPlaying: false,
        currentTime: 0,
        lastUpdateTime: Date.now(),
      },
      playbackStatus: 'paused',
      currentUrl: pageUrl ?? null,
      previousHostId: userId,
      hostReassignTimer: null,
    });
  }

  const room = rooms.get(roomId);

  if (!room) {
    return res.status(500).json({ error: 'Failed to create or retrieve room' });
  }

  room.members.set(userId, {
    id: userId,
    username,
    joinedAt: Date.now(),
  });

  if (!room.previousHostId) {
    room.previousHostId = room.host;
  }

  const isHost = room.host === userId;
  if (isHost && pageUrl) {
    room.currentUrl = pageUrl;
  }

  const token = generateToken(userId, roomId);
  const playbackStatus: PlaybackStatus = room.videoState.isPlaying ? 'playing' : 'paused';
  room.playbackStatus = playbackStatus;

  res.json({
    token,
    userId,
    roomId,
    username,
    isHost,
    playbackStatus,
    videoState: room.videoState,
    currentUrl: room.currentUrl,
  });
});

io.use((socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  const decoded = token ? verifyToken(token) : null;

  if (!decoded) {
    return next(new Error('Authentication error'));
  }

  socket.data.userId = decoded.userId;
  socket.data.roomId = decoded.roomId;
  return next();
});

io.on('connection', (socket) => {
  const { userId, roomId } = socket.data;

  if (!userId || !roomId) {
    debugLog('Socket missing authentication data, disconnecting');
    socket.disconnect(true);
    return;
  }

  socket.join(roomId);

  if (!userSessions.has(userId)) {
    userSessions.set(userId, new Set());
  }
  userSessions.get(userId)?.add(socket.id);

  const room = rooms.get(roomId);
  if (room) {
    const reclaimingHost = room.host !== userId && room.previousHostId === userId;

    if (reclaimingHost) {
      room.host = userId;
      room.previousHostId = userId;
      if (room.hostReassignTimer) {
        clearTimeout(room.hostReassignTimer);
        room.hostReassignTimer = null;
      }
      io.to(roomId).emit('host-changed', {
        newHost: userId,
        timestamp: Date.now(),
      });
    }

    if (room.host === userId && room.hostReassignTimer) {
      clearTimeout(room.hostReassignTimer);
      room.hostReassignTimer = null;
    }
    const playbackStatus: PlaybackStatus = room.videoState.isPlaying ? 'playing' : 'paused';
    room.playbackStatus = playbackStatus;
    socket.emit('room-state', {
      members: Array.from(room.members.values()),
      videoState: room.videoState,
      playbackStatus,
      isHost: room.host === userId,
      currentUrl: room.currentUrl,
    });

    socket.to(roomId).emit('user-joined', {
      userId,
      members: Array.from(room.members.values()),
      timestamp: Date.now(),
    });
  }

  socket.on('comment', (data) => {
    const activeRoom = rooms.get(roomId);
    if (!activeRoom || !activeRoom.members.has(userId) || !data?.message) {
      return;
    }

    const member = activeRoom.members.get(userId);
    const payload = {
      userId,
      username: member?.username,
      message: data.message,
      timestamp: Date.now(),
    };

    io.to(roomId).emit('comment', payload);
  });

  socket.on('play', (data) => {
    const activeRoom = rooms.get(roomId);
    if (!activeRoom || !activeRoom.members.has(userId)) {
      return;
    }

    activeRoom.videoState = {
      isPlaying: true,
      currentTime: data?.currentTime ?? activeRoom.videoState.currentTime,
      lastUpdateTime: Date.now(),
    };
    activeRoom.playbackStatus = 'playing';

    socket.to(roomId).emit('play', {
      currentTime: activeRoom.videoState.currentTime,
      userId,
      timestamp: Date.now(),
    });
  });

  socket.on('pause', (data) => {
    const activeRoom = rooms.get(roomId);
    if (!activeRoom || !activeRoom.members.has(userId)) {
      return;
    }

    activeRoom.videoState = {
      isPlaying: false,
      currentTime: data?.currentTime ?? activeRoom.videoState.currentTime,
      lastUpdateTime: Date.now(),
    };
    activeRoom.playbackStatus = 'paused';

    socket.to(roomId).emit('pause', {
      currentTime: activeRoom.videoState.currentTime,
      userId,
      timestamp: Date.now(),
    });
  });

  socket.on('sync', (data) => {
    const activeRoom = rooms.get(roomId);
    if (!activeRoom || !activeRoom.members.has(userId)) {
      return;
    }

    if (!data) {
      return;
    }

    activeRoom.videoState = {
      isPlaying: data.isPlaying,
      currentTime: data.currentTime,
      lastUpdateTime: Date.now(),
    };
    activeRoom.playbackStatus = data.isPlaying ? 'playing' : 'paused';

    socket.to(roomId).emit('sync', {
      isPlaying: data.isPlaying,
      currentTime: data.currentTime,
      userId,
      timestamp: Date.now(),
    });
  });

  socket.on('navigate', (data) => {
    const activeRoom = rooms.get(roomId);
    if (!activeRoom || activeRoom.host !== userId) {
      return;
    }

    if (!data?.url) {
      return;
    }

    activeRoom.currentUrl = data.url;

    socket.to(roomId).emit('navigate', {
      url: data.url,
      userId,
      timestamp: Date.now(),
    });
  });

  socket.on('member-navigate', (data) => {
    const activeRoom = rooms.get(roomId);
    if (!activeRoom || !activeRoom.members.has(userId)) {
      return;
    }

    if (!data?.url) {
      return;
    }

    activeRoom.currentUrl = data.url;

    const previousHost = activeRoom.host;
    if (activeRoom.hostReassignTimer) {
      clearTimeout(activeRoom.hostReassignTimer);
      activeRoom.hostReassignTimer = null;
    }

    if (previousHost !== userId) {
      activeRoom.previousHostId = previousHost;
      activeRoom.host = userId;
      io.to(roomId).emit('host-changed', {
        newHost: userId,
        timestamp: Date.now(),
      });
    }

    io.to(roomId).emit('navigate', {
      url: data.url,
      userId,
      timestamp: Date.now(),
    });
  });

  socket.on('disconnect', () => {
    const sessions = userSessions.get(userId);
    sessions?.delete(socket.id);

    if (sessions && sessions.size === 0) {
      userSessions.delete(userId);

      const activeRoom = rooms.get(roomId);
      if (!activeRoom) {
        return;
      }

      activeRoom.members.delete(userId);

      if (activeRoom.members.size === 0) {
        if (activeRoom.hostReassignTimer) {
          clearTimeout(activeRoom.hostReassignTimer);
          activeRoom.hostReassignTimer = null;
        }
        rooms.delete(roomId);
        return;
      }

      if (activeRoom.host === userId) {
        if (activeRoom.hostReassignTimer) {
          clearTimeout(activeRoom.hostReassignTimer);
        }

        activeRoom.previousHostId = userId;

        if (activeRoom.members.size > 0) {
          activeRoom.hostReassignTimer = setTimeout(() => {
            const currentRoom = rooms.get(roomId);
            if (!currentRoom || currentRoom.host !== userId || currentRoom.members.size === 0) {
              return;
            }

            const [newHost] = currentRoom.members.keys();
            if (!newHost) {
              return;
            }

            currentRoom.host = newHost;
            currentRoom.previousHostId ??= userId;
            currentRoom.hostReassignTimer = null;
            io.to(roomId).emit('host-changed', {
              newHost,
              timestamp: Date.now(),
            });
          }, HOST_REASSIGN_DELAY_MS);
        } else {
          activeRoom.hostReassignTimer = null;
        }
      }

      socket.to(roomId).emit('user-left', {
        userId,
        members: Array.from(activeRoom.members.values()),
        timestamp: Date.now(),
      });
    }
  });
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? 'development',
    useFirestore: USE_FIRESTORE,
  });
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  debugLog(`Server running on port ${PORT}`);
});
