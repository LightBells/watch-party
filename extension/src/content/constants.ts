const COMMENT_COLOR_MAP: Record<string, string> = {
  white: '#ffffff',
  red: '#ff0000',
  pink: '#ff8080',
  yellow: '#ffff00',
  orange: '#ffcc00',
  green: '#00ff00',
  cyan: '#00ffff',
  blue: '#0000ff',
  purple: '#c000ff',
  black: '#000000',
  white2: '#cccc99',
  red2: '#cc0000',
  pink2: '#ff33cc',
  yellow2: '#999900',
  orange2: '#ff6600',
  green2: '#00cc00',
  cyan2: '#0099ff',
  blue2: '#000099',
  purple2: '#9900ff',
  black2: '#666666',
};

const COMMENT_SIZE_MAP: Record<string, string> = {
  big: '3em',
  small: '1.6em',
  medium: '2em',
};

const COMMENT_FONT_FAMILIES: Record<string, string> = {
  mincho: '"Yu Mincho", "Hiragino Mincho ProN", "HiraMinProN-W3", "MS PMincho", serif',
  gothic: '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif',
};

const VIDEO_SELECTORS: readonly string[] = [
  '#dv-web-player video',
  '.atvwebplayersdk-video-surface video',
  'video[data-testid="video-player"]',
  'video.dmp-video-player',
  '.video-player video',
  'video#video-player',
  'video#test-video',
  'video',
];

const SUPPORTED_SITE_PATTERNS: readonly RegExp[] = [
  /https?:\/\/www\.amazon\.co\.jp\/gp\/video\//,
  /https?:\/\/www\.amazon\.co\.jp\/\-\/[^/]+\/gp\/video\//,
  /animestore\.docomo\.ne\.jp\/animestore\/sc_d_pc/,
  /localhost:3000/,
];

const DEVELOPMENT_SERVER_URL = 'http://localhost:3000';
const PRODUCTION_SERVER_URL = 'https://lightbells-watch-party.an.r.appspot.com';

const ROOM_HASH_KEY = 'watchparty-room';
const MEMBER_HEARTBEAT_INTERVAL = 4000;
const MAX_CHAT_HISTORY_ENTRIES = 200;

export {
  COMMENT_COLOR_MAP,
  COMMENT_FONT_FAMILIES,
  COMMENT_SIZE_MAP,
  DEVELOPMENT_SERVER_URL,
  MAX_CHAT_HISTORY_ENTRIES,
  MEMBER_HEARTBEAT_INTERVAL,
  PRODUCTION_SERVER_URL,
  ROOM_HASH_KEY,
  SUPPORTED_SITE_PATTERNS,
  VIDEO_SELECTORS,
};
