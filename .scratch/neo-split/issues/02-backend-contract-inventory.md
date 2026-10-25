# Inventory the current backend's contract

Type: task
Status: resolved
Blocked by:

## Question

Write down everything the current backend (`app/*.js`) promises to the outside world, so the rewrite has a checklist to meet. Agent-driven (AFK). Cover:

- every HTTP endpoint: method, who calls it (NeoApp / Neo Console / both), access rule (device token, local, app token), request and response shape;
- every event type on the NDJSON stream, its fields, and which client reacts to it;
- files under `~/Library/Application Support/Neo` (NEO_HOME) and their formats (state.json, devices.json, schedule.json, journal/dreams/memory, activity, providers, keys);
- environment variables and launch arguments Neo Console passes today;
- external processes spawned (claude, ACP agents, STT helper, MCP) and how.

Resolved when the inventory exists as an asset linked from this ticket (e.g. `.scratch/neo-split/contract.md`), with row counts per section recorded in the answer.

## Answer

Inventoried `app/*.js` against the code that calls it: NeoApp Kotlin (Link, Net, Brain.onServer, Speech, SetupActivity, MainActivity) and Neo Console Swift (Core, Store, views, build.sh). Also checked the real file shapes in `~/Library/Application Support/Neo` (no secrets copied).
Row counts: 31 endpoint paths (39 method/path rows, plus the 404 fallback), 38 event types, 10 NEO_HOME entries (plus 2 temp files the backend owns), 17 env-var rows, 15 external-process rows.
Most important gotchas:
- NeoApp drops any event line containing the JSON string `"ping"`.
- `/api/events` (15 s ping) and `/api/audio` (endless chunked PCM) are long-lived requests. Bun's default 10 s `idleTimeout` would cut them.
- 13 routes match `req.url` exactly, so a query string breaks them, and any non-GET counts as a write.
- All-zero PCM frames mean "muted" and reset the segmenter. While busy, only the latest pending speech segment is kept.
- The pending dream card is replayed on every event-stream connect until `/api/dream/seen`.
- Apple STT is Neo Console's in-process server on :8001, not a helper the backend spawns. The MCP server is launched via `process.execPath`. `CLAUDE_CONFIG_DIR` defaults to a personal path.
- Dead or unused: `/api/cancel`, and `/api/ask` (debug only; it gets 401 under the app token and skips events and humanize). `job.notify` is never persisted, and `lastSeen` is only saved by accident.
Asset: [contract.md](../contract.md)
