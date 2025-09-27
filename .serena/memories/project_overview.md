# Watch Party Overview
- Real-time watch party platform: Express/Socket.IO backend paired with a Chrome extension to synchronize video playback and chat across Prime Video, dアニメストア, and local test pages.
- Backend (Node.js 18+): `server/index.js` exposes REST endpoints, serves static assets, and manages Socket.IO rooms; Firestore integration (`server/firestore.js`) is planned/enabled for production persistence.
- Frontend: Manifest V3 Chrome extension (`extension/`) with background service worker, content script injecting Socket.IO client, popup UI for room/user controls; communicates with backend over WebSockets and REST.
- Static assets and demo page live under `public/`; documentation resides in `docs/` (feature specs, architecture/deployment placeholders).
- Runtime configuration via `.env` (e.g., `JWT_SECRET`, `DEBUG_MODE`, `NODE_ENV`, Firestore project id).