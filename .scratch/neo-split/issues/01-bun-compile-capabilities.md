# Can a compiled Bun binary do everything the Neo daemon needs on macOS?

Type: research
Status: resolved
Blocked by:

## Question

Can a single `bun build --compile` binary (macOS arm64), shipped inside a signed .app and run by launchd, do everything the Neo daemon needs today? Check against primary sources (Bun docs, Apple docs) and the current backend in `app/` for what is actually used:

- a long-lived HTTP server that reads a **streaming chunked request body** (phone audio upload, `/api/audio`) and writes **long-lived NDJSON streaming responses** (`/api/events`);
- spawning child processes with streaming stdin/stdout (the `claude` CLI with stream-json, ACP agents over stdio JSON-RPC, the Swift STT helper) and killing them on cancel;
- whatever `app/discover.js` and `app/pairing.js` rely on (mDNS/Bonjour? LAN address discovery?);
- running an MCP server over stdio (what `app/neo-agents-mcp.js` does) from the same binary (e.g. `neo mcp`);
- code signing / notarization of a compiled Bun binary nested in an .app, and how macOS TCC (Full Disk Access, Speech Recognition) attributes permissions when the binary is started by a LaunchAgent rather than by the .app.

Output: a capability table (works / works with caveat / doesn't) with sources, and any blockers that would force a different packaging choice.

## Answer

Yes, with build-time care. On Bun 1.4.2, a compiled binary handled streamed chunked uploads, long NDJSON streams, disconnect detection, piped spawn plus kill (including the whole process group), stdio JSON-RPC (ACP and `neo mcp` via `process.execPath`), `os.networkInterfaces`, and the crypto that pairing uses. Nothing uses mDNS.
- Bun.serve has a **10 s default idle timeout** that cut the event stream. Use `server.timeout(req, 0)` or keep `requestTimeout = 0` with node:http.
- Compile with `--no-compile-autoload-dotenv --no-compile-autoload-bunfig`, or `neo` picks up the `.env` of whatever directory it runs in.
- Hardened-runtime signing passes strict verification nested in an .app. **Without `allow-jit`, JIT is silently disabled and code runs about 8x slower.** Notarization is unverified (no Developer ID on this machine).
- **Doesn't:** SFSpeechRecognizer can't run in the Bun binary. STT stays in Swift (ticket 08).
- **Unverified risk:** TCC attribution when launchd starts the daemon. Apple says the algorithm is undocumented. The fallback is a minimal nested `.app` wrapper (its own Info.plist, same team) as the SMAppService `BundleProgram`. Sign with a real team identity so grants survive rebuilds.

Full table and sources: [../research/01-bun-compile-capabilities.md](../research/01-bun-compile-capabilities.md)
