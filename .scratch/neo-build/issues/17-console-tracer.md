# 17: Tracer: new Neo Console showing live Neo

**What to build:** A new Neo Console app that holds no Neo logic: on launch it reconciles the daemon through `neo daemon status --json` (repair or restart on version change when idle), shows status in the menu bar, and shows the Console window's live event log and cards from one `neo events --json --history`. The menu separates "ออกจาก Neo Console" from a Neo submenu (start/stop/restart/log); a daemon-down bar offers "เริ่ม Neo". Hand-written Swift types are checked by decoding every golden fixture. Source: spec §10, screens ticket.

**Blocked by:** 04 Type a question, get a card; 14 Install and supervise the daemon with launchd

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] Quitting Neo Console leaves the daemon running; reopening reconnects and replays history
- [x] Stopping the daemon dims the icon and shows the down bar; "เริ่ม Neo" brings it back and the Console reconnects on its own
- [x] Typing in the Console window sends `neo say --no-wait` and the card appears from events
- [x] A Swift test decodes every NeoCli golden fixture

Carried over (from ticket 14): "restart on version change only when idle" isn't built; the daemon must expose whether a job is running or an alarm ringing (e.g. in `neo daemon status --json`) so Neo Console can wait for idle before `neo daemon restart`.

## Done notes
Built in `console/` (SwiftPM: `NeoConsoleKit` library + `NeoConsole` app + XCTest). Dev build only: `./build.sh` → `console/build/Neo Console Dev.app` (bundle id com.mochi.neo.console.dev, label com.mochi.neo.dev, port 8100, home ~/Library/Application Support/NeoDev). `swift test`: 19 tests.
Not done / left over:
- "restart on version change only when idle": Console waits for `status.thinking == false` from the event stream, then `neo daemon restart`. A ringing alarm is NOT checked, because neither `status` nor `daemon status --json` exposes it. Needs a field (e.g. `busy`/`ringing` in `Status`) from NeoCli.
- Not-installed shows an "ติดตั้ง Neo" bar (onboarding is ticket 18).
- Pixel cards show a one-line placeholder; the log has no face theme (default mint) yet.
