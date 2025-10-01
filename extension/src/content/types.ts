type PlaybackStatus = 'playing' | 'paused';

type VideoState = {
  isPlaying: boolean;
  currentTime: number;
  lastUpdateTime: number;
};

type RoomMember = {
  id: string;
  username?: string;
  joinedAt?: number;
  status?: 'online' | 'offline';
  lastHeartbeatAt?: number;
};

type RoomStatePayload = {
  members: RoomMember[];
  videoState: VideoState;
  playbackStatus: PlaybackStatus;
  isHost: boolean;
  currentUrl?: string | null;
};

type CommentPayload = {
  userId: string;
  username?: string;
  message: string;
  timestamp: number;
  commands?: string | null;
  url?: string | null;
  playbackTime?: number | null;
};

type CommentCommandOptions = {
  color?: string;
  fontSize?: string;
  position: 'ue' | 'shita' | 'naka';
  opacity?: number;
  fontFamily?: string;
  fullWidth: boolean;
  invisible: boolean;
};

type NavigateEventPayload = {
  url: string;
  userId: string;
  timestamp: number;
};

export type {
  CommentCommandOptions,
  CommentPayload,
  NavigateEventPayload,
  PlaybackStatus,
  RoomMember,
  RoomStatePayload,
  VideoState,
};
