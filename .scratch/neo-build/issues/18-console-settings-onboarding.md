# 18: Neo Console settings and onboarding

**What to build:** The seven Settings tabs and the six-step onboarding work as today but through the neo command. Onboarding's check step installs the daemon, shows the PATH hint, and lists `neo doctor --json` rows with fix buttons (Full Disk Access opens System Settings, Speech runs the stt fix). The login item becomes "open Neo Console at login". Any action without a subcommand gets one added. Source: spec §10.

**Blocked by:** 06 Switch between brains and models; 13 All settings and the full doctor; 17 Tracer: new Neo Console showing live Neo

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] Every control in the seven tabs changes the matching `neo settings`/provider/model/name/face/devices value and reflects changes made from Terminal
- [x] Fresh NEO_HOME: onboarding ends with the daemon installed, permissions checked and a phone paired
- [x] No direct HTTP calls or files read by Neo Console except through `neo`

Carried over (from ticket 17): pixel cards show only a one-line placeholder and the Console log ignores the face theme (default mint); not-installed currently shows an "ติดตั้ง Neo" bar that onboarding should replace. Once `status` exposes `ringing`/`busy` (ticket 09), make the idle-wait before a version restart check them too.

## Done notes
Built in `console/`: `SettingsModel` (Kit, tested), `SettingsView.swift` (7 tabs), `OnboardingView.swift` (6 steps), `FaceViews.swift`. `swift test`: 34 tests (fixtures for every new shape, a fake-runner suite, and a live suite against real `cli/dist/neo`).
Verified by hand on the dev app (fresh temp home, label com.mochi.neo.dev, port 8137): onboarding shown → install (LaunchAgent + PATH hint) → doctor rows → pairing code → fake phone paired over localhost → "เริ่มใช้ Neo" set `onboarded true`; Settings reflects Terminal `settings set`/`face set`; a checkbox click changed `requireName` in `neo settings`. LaunchAgent booted out and removed, app quit.
Carried over done: pixel cards render, log follows the face theme, version restart waits for `thinking`/`ringing`/`busy`.
Not done / unverified:
- ตั้งเวลา and ความจำ tabs are lean (list/switch/test/delete jobs, alarm stop, dream toggle, memory read-only); add/edit/open-in-editor are ticket 19. `neo dream now|status|list` were not in the built `cli/dist/neo` yet, so nothing calls them.
- Speech "ขอสิทธิ์" button and the real FDA grant were NOT clicked (no permission prompts triggered). Login-item toggle (SMAppService) not toggled. Brain add/edit/remove of a custom provider, name training and face save are covered by fake-runner tests and (face/name set) the live test, not by clicking.
- No new neo subcommand needed. Provider config goes to `neo` via a temp JSON file (`--file`), the key via stdin.
- `build.sh` now bundles `cli/dist/neo-stt` and adds the Speech/folder usage strings.
- Gotcha: the daemon puts the login-shell PATH first, so live tests must set `NEO_LOGIN_SHELL=/usr/bin/true NEO_DISCOVER=0` or the real `claude` runs (this happened in 3-4 of my early test runs and cost a little real quota before I found it).
