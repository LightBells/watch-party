# Task Completion Checklist
- Run `npm run lint` to ensure JavaScript style passes.
- Run `npm test` (Jest) if relevant logic or socket handlers changed.
- For backend changes, smoke-test with `npm start` against http://localhost:3000 (or `npm run dev` for watch mode).
- If extension code changed, reload unpacked extension in Chrome and validate popup/content script flows on the demo page.
- Update docs (`docs/`) when making significant behavioral or API adjustments; keep README/SETUP instructions current.