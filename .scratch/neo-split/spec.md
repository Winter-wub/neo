# Spec: split Neo into Neo Console, NeoCli and NeoApp

Status: ready for `/to-tickets` · Written 2026-10-26 from [the map](map.md) (12 resolved decisions).
Vocabulary: [GLOSSARY.md](../../GLOSSARY.md). Each decision is held in its ticket; this spec puts them together into one buildable whole and links back. When this file and a ticket disagree, the ticket wins and this file gets fixed.

## 1. Goal

Rebuild Neo's backend from scratch as **NeoCli** (Bun + TypeScript), made up of the **Neo daemon** and the **neo command**. Reduce **Neo Console** to a pure controller that does everything through the neo command. Keep **NeoApp** behaving the same.

Done means:
- The Neo daemon runs on its own under launchd. Quitting Neo Console doesn't stop Neo.
- Everything Neo Console does, a person can do in Terminal with `neo …`, using the same interface.
- NeoApp on the A7 passes the parity bar (§13) with no user-visible change, apart from the one intended ping fix (§11).
- `app/` is deleted.

Non-goals are in §16.

## 2. Repo layout

| Path | What | Language |
|---|---|---|
| `cli/` | NeoCli: `src/protocol.ts`, `src/core/<module>/`, `src/adapters/phone/`, `src/adapters/command/`, `src/main.ts`, `stt/` (the `neo-stt` Swift helper source), `test/`, `tools/gen-kotlin.ts` | Bun TS (+ one Swift helper) |
| `console/` | Neo Console | Swift / SwiftUI |
| `android/` | NeoApp | Kotlin |
| `app/` | old backend + old Neo Console. Deleted after cutover (§13) | Node / Swift |

## 3. Architecture

Source: [How is NeoCli split into modules?](issues/04-neocli-module-design.md). Full table: [neocli-modules.md](neocli-modules.md).

- A **core** that never sees HTTP or argv, wrapped by two thin adapters:
  - the **Phone adapter**: `/api/*` + NDJSON on port 8000, for NeoApp;
  - the **Command adapter**: typed routes on `NEO_HOME/neo.sock`, for the neo command.
- Core modules: Ears, Conversation, Brain, Weather, Cards, Jobs, Memory, Pet, Settings, Devices, Events.
- Brain returns a typed `Answer` (card | schedule intent | weather intent | skill intent | error). Conversation builds the context for each ask and decides what happens next.
- **Fast phrases** come from each owner's `understand(text)`. Conversation asks them in a fixed order before it asks the Brain: ringing alarm (Jobs) → pending confirm/cancel (Conversation) → Pet → Jobs → Memory → Weather → provider switch → Brain.
- Test seams: Clock, Brain, STT, process spawning. Files use real temp dirs.
- Implicit timers and state machines to rebuild are listed in [contract.md §8.3](contract.md) (scheduler tick, ringing auto-off, task retry, dream check, deep-sleep dream, activity counting, conversation session rules, confirm windows, network rebind, history caps). Rebuild them all unless §5 changes one.

## 4. Interfaces

### 4.1 Phone protocol (NeoApp ↔ Neo daemon, port 8000)

Baseline: [contract.md](contract.md) §1–§3 and §7, kept as it is. The only changes:

| Change | Source |
|---|---|
| Port 8000 serves **only NeoApp's routes**. Every request needs a device token except `/api/hello`, `/api/pair`, `/neo.apk`. Localhost has no special rights (closes the open `POST /api/face` and the token-less `/api/events`). A phone on adb reverse must be paired. | [transport](issues/05-command-to-daemon-transport.md) |
| `/api/cancel` and `/api/ask` are not on port 8000. `/api/ask` → 404, so the debug intent shows `askerr`. | [drops](issues/10-what-the-rewrite-drops.md) |
| Inside any event payload, a `"ping"` string token is written as `"ping"`. The real ping stays exactly `{"type":"ping"}`. | [drops](issues/10-what-the-rewrite-drops.md) |
| STT failures use the existing `stterr` event. No new event types. | [STT](issues/08-where-stt-lives.md) |

Quirks to keep, per contract §8.1:
- streams that never close: turn off the Bun idle timeout on `/api/events` and `/api/audio`;
- 15 s ping;
- all-zero PCM frames mean "muted";
- only the latest pending segment is kept while busy;
- `hello` and the pending `dream_done` are re-sent on connect;
- events go to every listener the same way.

Exact-URL matching and "any non-GET is a write" don't need to be copied: NeoApp never sends a query string and always sends the right method. The contract tests (§13) are the judge.

### 4.2 neo command ↔ Neo daemon

Source: [How does the neo command reach the Neo daemon?](issues/05-command-to-daemon-transport.md)
- HTTP over the Unix socket `NEO_HOME/neo.sock`, mode 0600, no token. Local only.
- Routes and shapes are typed in `cli/src/protocol.ts`. The client parses argv and renders the output itself.
- `neo events` is a long-lived NDJSON response on the same socket.
- If the daemon is down and the plist is installed, the client runs `launchctl kickstart`, waits up to ~5 s for the socket, then carries on. Otherwise it exits 3.
- The daemon reports version, build and protocol version in `neo daemon status` and at connect. If the client is incompatible, it warns on stderr and exits 1 ([lifecycle](issues/06-daemon-lifecycle.md)). There is no version field in `--json` payloads or events ([sync](issues/11-protocol-mirrors.md)).

### 4.3 neo command surface

Source: [What is the neo command's surface?](issues/03-neo-command-surface.md). Full tree: [neo-command.md](neo-command.md).
- Grammar `neo <noun> <verb>`. Markdown output by default; `--json` for Neo Console, which always passes it.
- Global flags: `--home`, `-q`.
- Exit codes: 0 ok · 1 couldn't do it · 2 usage · 3 daemon down. A Thai message goes to stderr; `{error, code}` goes to stdout with `--json`.
- Changes after that ticket:
  - `neo cancel` is socket-only;
  - `neo devices list` shows last seen;
  - `neo settings` gains `claudeConfigDir`.
- While building Neo Console, any button with no matching subcommand gets one added to neo-command.md ([screens](issues/12-console-screens.md)). Known mappings: onboarding done = `neo settings set onboarded true|false`; feed and sleep from the menu = `neo pet feed` / `neo pet sleep`; wake training = `neo name train`.

## 5. Behaviour changes in the rewrite (all else = parity)

| Item | Decision | Source |
|---|---|---|
| `/api/ask` | dropped; use `neo say` | [drops](issues/10-what-the-rewrite-drops.md) |
| `/api/cancel` | socket-only (`neo cancel`) | same |
| `job.notify` | dropped | same |
| `devices.json` `lastSeen` | saved, at most once a minute per device | same |
| API key paths | read only the `apiKeyFile` / `apiKeyEnv` the provider names | same |
| `CLAUDE_CONFIG_DIR` | setting `claudeConfigDir`. Unset (and no env var) → passed to nobody, so `claude` uses its own default. `neo doctor` warns if the path is missing | same |
| STT | `neo-stt` helper only. Whisper, ffmpeg normalize, `thaiOnly`, `MOCHI_STT`, `MOCHI_WHISPER_MODEL` are gone | [STT](issues/08-where-stt-lives.md) |
| Storage | memory / dreams / journal / jobs become markdown (§6) | [surface](issues/03-neo-command-surface.md) |
| Neo Console's adb reverse toggle | dropped | [screens](issues/12-console-screens.md) |
| MCP server | `neo mcp` subcommand (same binary) replaces `node neo-agents-mcp.js` | [Bun research](issues/01-bun-compile-capabilities.md) |
| Supervision | launchd replaces Neo Console's "kill whatever is on :8000 and restart after 3 s" | [lifecycle](issues/06-daemon-lifecycle.md) |

## 6. Storage (NEO_HOME = `~/Library/Application Support/Neo`)

| File | Owner module | Format |
|---|---|---|
| `memory.md` | Memory | `## Section` + `- item` lines (as today). Edited as a whole; saves are conflict-checked |
| `dreams/YYYY-MM-DD-HHmm.md` | Memory | one dream per file; id = file name; includes a "memory changes" (+/−) section; undelivered state kept in the file |
| `journal/YYYY-MM-DD.md` | Memory | one file per day, one entry per turn (time, question, answer) |
| `jobs.md` | Jobs | one heading per job with `{#id}`; kind, enabled, when (`at` or `cron`), prompt, last fired |
| `activity.json` | Memory | as today |
| `state.json` | Settings (pet via Pet) | as today, plus `claudeConfigDir` |
| `devices.json` | Devices | as today (`lastSeen` saved for real) |
| `providers.json`, `<name>.key` | Brain | as today; keys 0600 |
| `tasks/` | Brain | cwd for agent runs |
| `legacy/` | migration | original `journal.jsonl`, `dreams.jsonl`, `schedule.json` |
| `neo.sock` | Command adapter | 0600 |

- The daemon watches the markdown files and reloads them when they are edited directly.
- If `jobs.md` has a bad line, the daemon keeps the previous jobs, emits a warning event, and `neo doctor` shows the line.
- Every save that could race with an external edit is conflict-checked.
- The exact markdown grammar of each file is the first piece of the Memory and Jobs build tickets. It must round-trip through the parser and stay readable in Obsidian.

## 7. External processes and integrations

Baseline: [contract.md §6–§7](contract.md). Kept:
- `claude` stream-json, in its bypass and read-only flag sets, for asks, skill runs and dreams;
- ACP agents over stdio JSON-RPC, plus ACP probes;
- acpx registry discovery;
- OpenAI-compatible and HTTP providers;
- `tailscale status`;
- open-meteo.

Changed:
- **MCP**: the config written to `NEO_HOME/neo-mcp.json` (0600; not `$TMPDIR`, which the old Neo still writes) points at `<neo binary> mcp`. The orca and ego-browser tools move into `neo mcp`.
- **STT**: the daemon starts `Contents/MacOS/neo-stt` at launch and restarts it if it dies. Messages are one JSON line each way: `{wav, hints}` → `{text}` | `{error}`. It uses SFSpeechRecognizer th-TH, on-device, `.dictation`, with contextual hints.
- **PATH**: the daemon asks the login shell (`zsh -lic 'echo $PATH'`) at every start when launchd runs it (`NEO_LAUNCHD=1`, or when `NEO_LOGIN_SHELL` is set); run by hand or by a test it keeps the caller's PATH, so a test's fake `claude` can't be overtaken by the real one. `neo doctor` shows where each tool was found.
- `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` are removed from the env of `claude` and of ACP children, as today.

## 8. Build, packaging, signing

Sources: [Bun research](issues/01-bun-compile-capabilities.md), [permissions](issues/09-permissions-under-launchd.md), [lifecycle](issues/06-daemon-lifecycle.md).
- `bun build --compile` for macOS arm64, with `--no-compile-autoload-dotenv --no-compile-autoload-bunfig`. Output goes to `Neo Console.app/Contents/MacOS/neo`.
- `neo-stt` is built from `cli/stt/` into `Contents/MacOS/neo-stt`.
- Signing:
  - Apple Development certificate, chosen by a build variable (Developer ID can be swapped in later);
  - hardened runtime;
  - **allow-jit** (without it, code runs about 8× slower);
  - fixed identifiers.
- No ad hoc signing: it loses Full Disk Access.
- Info.plist carries the folder usage strings and `NSSpeechRecognitionUsageDescription`. Permissions attach to Neo Console, the enclosing app.
- `neo.apk` ships in `Contents/Resources/`. The daemon finds it relative to its own binary.

## 9. Daemon lifecycle

Source: [How does Neo Console install, upgrade and supervise the Neo daemon?](issues/06-daemon-lifecycle.md). Summary:
- `~/.local/bin/neo` is a symlink to the bundled binary.
- `neo daemon install` writes `~/Library/LaunchAgents/com.mochi.neo.plist` with `RunAtLoad` and `KeepAlive {SuccessfulExit: false}`.
- Verbs: `run | install | start | stop | restart | status | logs [-f] | uninstall`.
- Neo Console reconciles on every launch:
  - not installed → onboarding;
  - wrong binary path → `install` repairs it;
  - version mismatch → `restart` when idle (no job running, no alarm ringing).
- Logs:
  - `~/Library/Logs/Neo/daemon.log` rotates at 5 MB, keeping 3;
  - `daemon.crash.log` gets launchd's stdout and stderr.
- `uninstall` keeps NEO_HOME.

## 10. Neo Console

Source: [Which Neo Console screens stay once everything goes through the neo command?](issues/12-console-screens.md)
- **Same screens, same features**: Console window, "ความจำ & งาน" window, the seven Settings tabs, the menu bar, and six-step onboarding. Every action calls `neo … --json`. Live state comes from one long-running `neo events --json --history`, which replaces the 3-second status polling.
- Memory, dreams, journal and jobs panes gain an "open file in editor" button. They refresh when the daemon reports a file changed.
- Menu bar:
  - "ออกจาก Neo Console" quits only the app;
  - a "Neo" submenu shows status, start / stop / restart, and the daemon log.
- When the daemon is down, the icon dims and a "Neo ไม่ทำงาน" bar appears with "เริ่ม Neo" (runs the reconcile path) and the log. During an upgrade it shows "กำลังอัปเดต Neo…". Other actions are disabled, and the Console reconnects on its own. No modal alerts.
- Onboarding step "ตรวจเครื่อง":
  - `neo daemon install`, plus the PATH hint when `~/.local/bin` isn't on PATH;
  - the `neo doctor --json` rows, with a fix button per row. Full Disk Access opens System Settings; Speech runs `neo doctor --fix stt`.
- The login item becomes "เปิด Neo Console เมื่อเข้าสู่ระบบ".
- Neo Console holds no Neo logic. Port 8001, `SpeechService`, the backend launcher and `adbReverse()` leave it.
- Types: hand-written Swift `Codable` for the parts it reads, checked against golden fixtures (§12).

## 11. NeoApp

Source: [How do Neo Console and NeoApp stay in sync with protocol.ts?](issues/11-protocol-mirrors.md)
- Refactor Brain, Link and the other readers onto a generated `Protocol.kt` with identical behaviour.
- **One intended fix**: `Link.kt:119` drops a line only when its `type` is `ping`. NeoCli keeps the escape from §4.1, so older APKs behave the same.
- No other behaviour change. The debug `ask` intent stays for now (it gets 404 → `askerr`).

## 12. Keeping clients in sync with `protocol.ts`

Source: [How do Neo Console and NeoApp stay in sync with protocol.ts?](issues/11-protocol-mirrors.md)
- `protocol.ts` holds plain TS types: no runtime schema library and no version field. Only the Phone adapter validates input, by hand.
- `bun run gen:kotlin`:
  - reads `protocol.ts` with ts-json-schema-generator (a dev dependency);
  - our script writes `android/app/src/main/java/com/mochi/companion/Protocol.kt`, covering every event and every port-8000 request/response NeoApp uses;
  - each type gets lenient `fromJson` / `toJson` over org.json, with no new APK dependency.
- `Protocol.kt` is committed. A `cli` test fails if regenerating it would change it.
- NeoCli tests write golden fixtures (`--json` outputs and events) to `cli/test/fixtures/`. A Swift test in `console/` decodes every one of them.

## 13. Testing, parity and cutover

Sources: [cutover](issues/07-cutover-and-parity.md), [modules](issues/04-neocli-module-design.md).
- **Unit tests** per core module use fake Clock, Brain, STT and spawn, with real temp dirs. Adapter tests use a real server on a random port and a real socket. Never spend Claude quota: use the fake `claude` binary.
- **Contract test suite** (black box, over HTTP with a device token, written from contract.md as amended by §4.1):
  - written first and made to pass against the **old** Node backend;
  - then run unchanged against NeoCli;
  - it includes a card whose text is `ping`.
- **A7 checklist**:
  - wake word, ask, draw;
  - set, ring and snooze an alarm;
  - sleep/wake and deep sleep;
  - feed, shake;
  - dream card delivery, pairing;
  - plus STT accuracy on quiet audio and non-Thai noise (the accepted risk in §15).
- **Data migration**, once, on the daemon's first start:
  - `journal.jsonl` → `journal/*.md`, `dreams.jsonl` → `dreams/*.md`, `schedule.json` → `jobs.md`;
  - originals move to `NEO_HOME/legacy/`;
  - copy `~/.config/neo/openrouter.key` to `NEO_HOME/openrouter.key` (0600) and rewrite `apiKeyFile` (`~/.config/neo` stays);
  - write `claudeConfigDir: ~/.ccs/instances/personal` into this Mac's settings.
  - Everything else carries over as-is, so the A7 stays paired.
- **During development**: the old Neo stays on :8000 with the real NEO_HOME. The dev NeoCli runs `neo daemon run --home <copy> --port 8100` with the fake `claude`.
- **Cutover** is one switch: the new Neo Console and NeoCli ship together. The old Neo.app and `legacy/` are the way back. Delete `app/` after the A7 checklist passes and about 7 days of real use.
- **Docs** at cutover: update README, INSTALL, PLAN and HANDOFF to the new names (GLOSSARY) and layout (§2). Add manual-uninstall steps for the LaunchAgent.

## 14. Spec-level defaults (chosen while writing this spec, not grilled; veto here)

1. **Environment variables.** Most old variables become fixed paths or settings:
   - `NEO_PROVIDERS` → `NEO_HOME/providers.json`;
   - `NEO_TASKS` → `NEO_HOME/tasks`;
   - `NEO_APK` → the bundled `Resources/neo.apk`;
   - `NEO_APP_TOKEN` is gone (the socket has no token);
   - `PORT` → `--port`, default 8000;
   - `NEO_HOME` → `--home` / `NEO_HOME`.

   Kept as env-or-setting: `NEO_PROVIDER` (startup override), `NEO_MCP` (which Claude Code MCP servers to copy; also setting `mcpServers`), `ORCA_BIN`, `EGO_BIN`. `MOCHI_CITY/LAT/LON` become setting `home {city, lat, lon}`, default กรุงเทพฯ 13.75, 100.52.
2. **`neo doctor` check ids**: `claude, stt, network, agents, phone, fda, jobs`. `node` and `ffmpeg` are gone.
3. **Markdown grammars** for `jobs.md`, `journal/*.md` and `dreams/*.md` are settled in their build tickets (§6), not here.

## 15. Accepted risks

- The Speech permission prompt for `neo-stt`, spawned by a launchd daemon, is assumed to attach to Neo Console. That isn't verified; the fallback is a nested helper .app ([STT](issues/08-where-stt-lives.md)).
- Dropping ffmpeg normalize and `thaiOnly` may lower accuracy on quiet A7 audio. Checked on the A7 checklist.
- `Bun.serve` on a `unix:` socket is documented but not yet tested here.
- Notarization was never tried. It's out of scope anyway.

## 16. Out of scope

- A redesign of the NeoApp protocol (e.g. a single WebSocket).
- Any other NeoApp behaviour change.
- NeoCli on Linux or Windows.
- Distributing to other Macs (Developer ID, notarization, a downloadable zip).
- `SpeechAnalyzer`.
- Removing NeoApp's debug `ask` intent.
- "Do it, then ring me" task notifications.

## 17. Suggested build order (for `/to-tickets`)

1. Contract test suite, green against the old backend.
2. `cli/` skeleton: `protocol.ts`, Events, Settings, the Command adapter on the socket, `neo daemon run`, `neo status`, `neo events`. Includes a build script with compile flags and signing (§8).
3. Phone adapter + Devices (pairing, access rules, `lastSeen`) + the audio and events streams.
4. Ears + `neo-stt` helper + `neo doctor --fix stt`.
5. Conversation + Brain (claude, ACP, OpenAI-compatible, HTTP) + Cards + Weather + `neo mcp`.
6. Jobs (`jobs.md`, ringing), Pet (sleep, deep sleep), Memory (memory, journal, dreams, away-hours) + file watching.
7. The rest of the neo command surface + golden fixtures.
8. Daemon lifecycle verbs, plist, logs, launchd wake-up.
9. Migration (§13).
10. `gen:kotlin` + `Protocol.kt` + NeoApp refactor + ping fix.
11. New Neo Console in `console/`.
12. Contract suite green against NeoCli → A7 checklist → cutover → docs → about 7 days → delete `app/`.
