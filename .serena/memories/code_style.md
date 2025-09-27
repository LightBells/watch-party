# Code Style & Conventions
- JavaScript (CommonJS) across backend and extension; Node 18+ targeted.
- Prefer semicolons and 4-space indentation; single quotes common for strings except where JSON/Chrome manifest requires double quotes.
- Organize backend logic into small helper functions (e.g., `debugLog`, `generateToken`); keep objects in Maps/Sets for room/session state.
- Chrome extension uses class-based modules and async/await; interact with `chrome.storage` APIs and Socket.IO client.
- Inline comments sparingly describe non-obvious behavior (e.g., multi-tab handling); maintain existing Japanese documentation/comments.
- Environment variables managed through `dotenv`; avoid hardcoding secrets in source.