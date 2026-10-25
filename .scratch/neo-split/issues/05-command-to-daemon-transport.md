# How does the neo command reach the Neo daemon?

Type: grilling
Status: resolved
Blocked by: 01, 03

## Question

What transport and auth does the neo command use to talk to a running Neo daemon (local HTTP with a token file, a Unix domain socket, or something else), how does `neo events` stream, and what does the neo command do when the daemon isn't running (fail, auto-start, or run in-process)?

## Answer

Settled with the user (2026-10-25).

- **Transport:** a Unix domain socket `NEO_HOME/neo.sock`, mode 0600. Filesystem permission is the auth (no token); unreachable from browsers and from the LAN. `Bun.serve` supports `unix:` per Bun docs, not yet tested here.
- **Requests:** the neo command parses argv itself and calls **typed routes** defined in `cli/src/protocol.ts` (HTTP over the socket), then renders human or `--json` output itself. The daemon never sees argv. `neo events` is a long-lived NDJSON response on the same socket.
- **Daemon not running:** if the LaunchAgent is installed, ask launchd to start it, wait briefly, then continue; otherwise exit 3 with how to start it. (Exact mechanics belong to "How does Neo Console install, upgrade and supervise the Neo daemon?".)
- **Local only:** no control from other machines (ssh + neo covers it).
- **Phone port (8000) loses all localhost privileges:** it serves only NeoApp's routes, and every request needs a device token except `/api/hello`, `/api/pair`, `/neo.apk`. Closes the open `POST /api/face` and token-less `/api/events` holes. Phones on adb reverse must be paired (the A7 already is).
