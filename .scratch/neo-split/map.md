# Map: Neo split into Neo Console, NeoCli, NeoApp

Label: wayfinder:map

## Destination

A spec (`.scratch/neo-split/spec.md`) ready for `/to-tickets`: the backend rewritten from scratch as **NeoCli** (Bun + TypeScript; the Neo daemon plus the neo command), **Neo Console** reduced to a pure controller that drives everything through the neo command, and **NeoApp** unchanged in behaviour. Every decision needed to build it is made; no code is written in this map.

## Notes

- Vocabulary: `GLOSSARY.md` at the repo root (Neo Console, NeoCli, Neo daemon, neo command, NeoApp, Pet name).
- Skills to consult: `domain-modeling` and `grilling` on grilling tickets, `codebase-design` for module shape, `typescript` for NeoCli code style, `research` for research tickets.
- Settled while charting (2026-10-25):
  - Destination is a spec, not code.
  - NeoCli is a **from-scratch rewrite** in Bun + TypeScript (not an incremental port of `app/*.js`).
  - Neo Console controls the Neo daemon **only through the neo command** (including a live event stream).
  - Neo Console **installs** NeoCli during onboarding; the Neo daemon then **runs on its own** (LaunchAgent) — quitting Neo Console does not stop Neo.
  - NeoCli ships **compiled into Neo Console's .app** (`bun build --compile`), with `neo` linked onto PATH; users never install Bun.
  - The agents MCP server and provider/ACP wrappers **belong to NeoCli**. (Apple speech-to-text was reopened as its own ticket and settled there: a Swift helper inside the .app, owned by NeoCli.)
  - NeoApp's protocol **may** change in principle, but this effort **keeps the current `/api/*` + NDJSON contract**; change it only where it truly blocks the split.
  - Repo layout: `console/` (Neo Console, Swift), `cli/` (NeoCli, Bun TS), `android/` (NeoApp); `app/` is deleted after cutover.
- Standing preferences: reply in Thai, short; report honestly what was verified vs not. Tests must not spend Claude quota (use the fake `claude` binary). Never run adb on the user's phone without asking, except installing/relaunching the Neo APK on the A7. No sending messages, posting, buying, or sending audio off the Mac.

## Result

All tickets resolved; [spec.md](spec.md) written 2026-10-26 (§14 lists defaults chosen while writing, not grilled).

## Decisions so far

<!-- one line per closed ticket: [title](issues/NN-slug.md): gist -->

- [Can a compiled Bun binary do everything the Neo daemon needs on macOS?](issues/01-bun-compile-capabilities.md): yes, with build rules (disable idle timeout on the two streams, no dotenv/bunfig autoload, allow-jit entitlement, stable signing identity, `neo mcp` subcommand, own PATH); Apple Speech can't run in Bun — must stay Swift; permissions under launchd unverified ([research](research/01-bun-compile-capabilities.md)).
- [Inventory the current backend's contract](issues/02-backend-contract-inventory.md): 31 endpoints, 38 event types, 10 NEO_HOME files, 17 env rows, 15 spawned processes catalogued in [contract.md](contract.md); key traps: never-closing streams (Bun idleTimeout), exact-URL routing, implicit audio rules, hello/dream re-send on connect, STT actually lives inside Neo Console.
- [What is the neo command's surface?](issues/03-neo-command-surface.md): noun-verb tree in [neo-command.md](neo-command.md); markdown output + `--json`; Neo Console lives on one `neo events --json`; `neo phone …` acts as a phone; exit codes 0/1/2/3; memory, dreams, journal and jobs become watched markdown files (edit whole, forget by text, conflict-checked saves).
- [How is NeoCli split into modules?](issues/04-neocli-module-design.md): core + Phone/Command adapters; modules Ears, Conversation, Brain (typed Answer), Weather, Cards, Jobs (owns ringing), Memory (one module), Pet (owns sleep), Settings, Devices (access rules), Events; fast phrases via per-module `understand()`; seams Clock/Brain/STT/spawn; one `protocol.ts` ([modules](neocli-modules.md)).
- [How does the neo command reach the Neo daemon?](issues/05-command-to-daemon-transport.md): Unix socket `NEO_HOME/neo.sock` (0600, no token), typed routes from `protocol.ts`, client renders output; launchd wake-up then exit 3; local only; phone port 8000 now device-token only (except hello/pair/apk).
- [How do we prove the rewrite matches and switch over?](issues/07-cutover-and-parity.md): black-box NeoApp contract tests (pass on old backend first) + A7 checklist; one-time JSONL→markdown conversion with originals in `legacy/`; dev NeoCli on a NEO_HOME copy, port 8100, fake claude; single cutover with old Neo.app as rollback, delete `app/` after checklist + ~7 days.
- [Which app do macOS permissions attach to when launchd starts neo?](issues/09-permissions-under-launchd.md): tested on this Mac — both a plain LaunchAgent plist and SMAppService attribute folder prompts and Full Disk Access to the enclosing app (name + usage text); grants survive rebuilds only with a stable team signature (ad hoc loses FDA); no separate helper app needed for permissions.
- [How does Neo Console install, upgrade and supervise the Neo daemon?](issues/06-daemon-lifecycle.md): binary stays in the .app, `~/.local/bin/neo` symlink; plain plist written by `neo daemon install` (KeepAlive on crash only); Neo Console reconciles on launch (repair path, restart on version change when idle); `neo` kickstarts launchd then exit 3; own rotating log; daemon takes PATH from login shell; FDA checked by `neo doctor`; uninstall keeps NEO_HOME; signed with the Apple Development cert.
- [Where does Apple speech-to-text live?](issues/08-where-stt-lives.md): Swift helper `neo-stt` inside Neo Console.app, owned by the Neo daemon as a long-lived stdio child (no port 8001); SFSpeechRecognizer unchanged; whisper, ffmpeg and `thaiOnly` dropped; failures → existing `stterr`; Speech permission asked during onboarding via `neo doctor --fix stt`; Speech attribution under launchd and quiet-audio accuracy accepted as untested risks.
- [Which dead or half-working parts does the rewrite drop or fix?](issues/10-what-the-rewrite-drops.md): `/api/cancel` socket-only for `neo cancel`; `/api/ask` and `job.notify` dropped (`neo say` replaces ask); `lastSeen` persisted (throttled) and shown in `neo devices`; API key copied into NEO_HOME at cutover; `CLAUDE_CONFIG_DIR` becomes setting `claudeConfigDir` (unset → claude default); NeoCli escapes `"ping"` inside payloads so NeoApp stops dropping cards.
- [How do Neo Console and NeoApp stay in sync with protocol.ts?](issues/11-protocol-mirrors.md): `protocol.ts` plain TS types, no version field; NeoApp refactored (same behaviour) onto a committed, generated `Protocol.kt` (org.json, no deps; a test catches staleness), and its ping filter becomes a `type` check; Neo Console uses hand-written Codable checked against golden fixtures from NeoCli tests.
- [Which Neo Console screens stay once everything goes through the neo command?](issues/12-console-screens.md): all screens kept with the same features, each action calling a `neo` subcommand; memory/jobs panes gain "open file"; menu bar separates "quit Neo Console" from a Neo start/stop/restart/log submenu; daemon-down bar with repair; onboarding check step installs the daemon and runs `neo doctor` fixes; login item opens Neo Console only; adb reverse toggle dropped.

## Not yet specified

<!-- empty: docs update folded into spec.md §13 as cutover work -->

## Out of scope

- Redesigning the NeoApp protocol (e.g. one WebSocket for audio + events) — ruled out while charting; a future effort.
- Any NeoApp behaviour change — except the ping-filter fix; NeoApp is refactored onto a generated `Protocol.kt` with identical behaviour ([How do Neo Console and NeoApp stay in sync with protocol.ts?](issues/11-protocol-mirrors.md)).
- Running NeoCli on Linux or Windows.
- Distributing Neo to other Macs (Developer ID signing, notarization, a downloadable Neo.zip) — ruled out in [How does Neo Console install, upgrade and supervise the Neo daemon?](issues/06-daemon-lifecycle.md): this effort targets the developer's own Mac.
