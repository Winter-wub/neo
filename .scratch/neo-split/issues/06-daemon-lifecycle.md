# How does Neo Console install, upgrade and supervise the Neo daemon?

Type: grilling
Status: resolved
Blocked by: 01, 09

## Question

Given Neo Console installs NeoCli and the Neo daemon then runs on its own: where does the binary live and how does `neo` get onto PATH; how the LaunchAgent is installed, restarted and removed; what happens when Neo Console is upgraded and the running daemon is an older version (version handshake, auto-restart); where logs go; and how macOS permissions (Full Disk Access, Speech Recognition) are requested and checked when the process holding them is the daemon, not the .app.

Context from "How does the neo command reach the Neo daemon?": the neo command talks over `NEO_HOME/neo.sock` and, when the daemon is down but the LaunchAgent is installed, asks launchd to start it before giving up with exit 3 — this ticket decides how.

## Answer

Settled with the user (2026-10-25).

- **Binary:** always `Neo Console.app/Contents/MacOS/neo` (permissions attach to the enclosing app — see "Which app do macOS permissions attach to when launchd starts neo?"). Never copied elsewhere.
- **On PATH:** symlink `~/.local/bin/neo` → the bundled binary, made during onboarding, no admin prompt. If `~/.local/bin` isn't on the login PATH, Neo Console shows the line to add to `~/.zprofile` (it doesn't edit the file). The symlink follows app upgrades.
- **LaunchAgent:** a plain plist `~/Library/LaunchAgents/com.mochi.neo.plist` written by `neo daemon install` (Neo Console calls it, per "everything through the neo command"; works from Terminal too). Not SMAppService. `RunAtLoad` + `KeepAlive {SuccessfulExit: false}`: launchd restarts it after a crash (throttled ~10 s); a clean exit stays down.
- **`neo daemon` verbs:** `run` (foreground, what launchd execs) · `install` (write/repair plist + symlink, bootstrap) · `start` (`launchctl kickstart gui/$UID/com.mochi.neo`) · `stop` (clean exit → stays stopped until `start`, a neo wake-up, or next login) · `restart` · `status` (installed?, plist/symlink point at this binary?, running pid, version + build) · `logs [-f]` · `uninstall`.
- **Daemon down:** the neo command, if the plist is installed, runs `launchctl kickstart`, waits for `neo.sock` up to ~5 s, then carries on; otherwise exit 3 with how to start it.
- **Neo Console on every launch reconciles** via `neo daemon status --json`: not installed → onboarding; plist or symlink pointing at another binary (app moved/replaced) → `neo daemon install` repairs it; daemon version/build ≠ bundled `neo` → `neo daemon restart` immediately if idle, otherwise once no job is running and no alarm is ringing. Neo Console only shows status, a restart button, and recent log lines when the daemon keeps crashing; launchd does the supervising.
- **Protocol mismatch:** the daemon reports version, build and a protocol version; a neo command talking to an incompatible daemon warns on stderr and exits 1 ("restart the Neo daemon").
- **Logs:** the daemon writes `~/Library/Logs/Neo/daemon.log` itself, rotating at 5 MB, keeping 3. launchd's stdout/stderr go to `~/Library/Logs/Neo/daemon.crash.log` (catches crashes before the logger is up). Read with `neo daemon logs [-f]`; Neo Console shows them through that command.
- **Daemon PATH:** at every start the daemon asks the login shell (`zsh -lic 'echo $PATH'`, as Core.swift does today) and uses that; `neo doctor` shows where each tool (claude, opencode, ffmpeg, …) was found.
- **Permissions:** folder prompts (Desktop/Documents/Downloads) are left to macOS when the daemon first touches them — they appear under Neo Console's name. Full Disk Access is checked by `neo doctor --json` (really reading an FDA-protected path); Neo Console shows the result in onboarding and settings with a button that opens the matching System Settings pane, then re-checks. Speech Recognition belongs to "Where does Apple speech-to-text live?".
- **Uninstall:** `neo daemon uninstall` (and a button in Neo Console) stops the daemon and removes the plist and symlink; NEO_HOME (memory, jobs, …) is kept. If the app is just trashed, the stale plist makes launchd retry harmlessly (throttled); reopening Neo Console repairs it; README documents manual removal.
- **Signing:** `build.sh` signs with the Apple Development certificate on this Mac (hardened runtime, allow-jit, fixed identifier), chosen by a variable so a Developer ID can be swapped in later without other changes. Ad hoc signing is gone. Distributing Neo to other Macs (Developer ID + notarization) is out of scope.
