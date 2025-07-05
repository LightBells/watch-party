const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

const debugLog = (...args) => {
  if (DEBUG_MODE) {
    console.log(...args);
  }
};

const USE_FIRESTORE = process.env.NODE_ENV === 'production';

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const rooms = new Map();
const userSessions = new Map(); // userId -> Set of socket.ids

const generateToken = (userId, roomId) => {
  return jwt.sign(
    { userId, roomId },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

app.post('/api/join-room', (req, res) => {
  const { roomId, username } = req.body;
  const userId = uuidv4();
  
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      host: userId,
      members: new Map(),
      videoState: {
        isPlaying: false,
        currentTime: 0,
        lastUpdateTime: Date.now()
      }
    });
  }
  
  const room = rooms.get(roomId);
  room.members.set(userId, {
    id: userId,
    username: username,
    joinedAt: Date.now()
  });
  
  const token = generateToken(userId, roomId);
  
  res.json({
    token,
    userId,
    roomId,
    username,
    isHost: room.host === userId
  });
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return next(new Error('Authentication error'));
  }
  
  socket.userId = decoded.userId;
  socket.roomId = decoded.roomId;
  next();
});

io.on('connection', (socket) => {
  const { userId, roomId } = socket;
  
  socket.join(roomId);
  
  // 複数タブサポート: userIdに対して複数のsocket.idを管理
  if (!userSessions.has(userId)) {
    userSessions.set(userId, new Set());
  }
  userSessions.get(userId).add(socket.id);
  
  const room = rooms.get(roomId);
  if (room) {
    socket.emit('room-state', {
      members: Array.from(room.members.values()),
      videoState: room.videoState,
      isHost: room.host === userId
    });
    
    socket.to(roomId).emit('user-joined', {
      userId,
      timestamp: Date.now()
    });
  }
  
  socket.on('comment', (data) => {
    const room = rooms.get(roomId);
    if (room && room.members.has(userId)) {
      const member = room.members.get(userId);
      socket.to(roomId).emit('comment', {
        userId,
        username: member.username,
        message: data.message,
        timestamp: Date.now()
      });
    }
  });
  
  socket.on('play', (data) => {
    const room = rooms.get(roomId);
    if (room && room.members.has(userId)) {
      room.videoState = {
        isPlaying: true,
        currentTime: data.currentTime,
        lastUpdateTime: Date.now()
      };
      
      socket.to(roomId).emit('play', {
        currentTime: data.currentTime,
        userId: userId,
        timestamp: Date.now()
      });
    }
  });
  
  socket.on('pause', (data) => {
    const room = rooms.get(roomId);
    if (room && room.members.has(userId)) {
      room.videoState = {
        isPlaying: false,
        currentTime: data.currentTime,
        lastUpdateTime: Date.now()
      };
      
      socket.to(roomId).emit('pause', {
        currentTime: data.currentTime,
        userId: userId,
        timestamp: Date.now()
      });
    }
  });
  
  socket.on('sync', (data) => {
    const room = rooms.get(roomId);
    if (room && room.members.has(userId)) {
      room.videoState = {
        isPlaying: data.isPlaying,
        currentTime: data.currentTime,
        lastUpdateTime: Date.now()
      };
      
      socket.to(roomId).emit('sync', {
        isPlaying: data.isPlaying,
        currentTime: data.currentTime,
        userId: userId,
        timestamp: Date.now()
      });
    }
  });
  
  socket.on('disconnect', () => {
    // 複数タブサポート: 特定のsocket.idのみを削除
    if (userSessions.has(userId)) {
      userSessions.get(userId).delete(socket.id);
      
      // このユーザーの全ての接続が切れた場合のみルームから削除
      if (userSessions.get(userId).size === 0) {
        userSessions.delete(userId);
        
        const room = rooms.get(roomId);
        if (room) {
          room.members.delete(userId);
          
          if (room.members.size === 0) {
            rooms.delete(roomId);
          } else if (room.host === userId) {
            const newHost = Array.from(room.members.keys())[0];
            room.host = newHost;
            
            socket.to(roomId).emit('host-changed', {
              newHost,
              timestamp: Date.now()
            });
          }
          
          socket.to(roomId).emit('user-left', {
            userId,
            timestamp: Date.now()
          });
        }
      }
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  debugLog(`Server running on port ${PORT}`);
});