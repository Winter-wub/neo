# Neo Console (dev build)

Pure controller for Neo: every action is a `neo … --json` call; live state comes from one `neo events --json --history`.

- `swift test` — decodes every golden fixture in `cli/test/fixtures/`, reconcile rules, the live model against a fake runner, and a real `cli/dist/neo` daemon (temp home, random port, fake `claude`).
- `./build.sh` — `build/Neo Console Dev.app`: bundles `cli/dist/neo`, signs with the Apple Development identity. Uses its own label (`com.mochi.neo.dev`), home (`~/Library/Application Support/NeoDev`), bin dir and phone port 8100, so it never touches the real Neo.

## Settings and onboarding (ticket 18)
- ⌘, opens the seven Settings tabs (ทั่วไป · สมอง · ชื่อเรียก · หน้าตา · ตั้งเวลา · ความจำ · มือถือ). Each control is one `neo …` call through `SettingsModel`; shown values are what `neo` reports and refresh on `settings`/`face`/`wake`/`provider`/`devices`/… events, so Terminal changes appear without a click.
- Until `neo settings` says `onboarded: true` (or the daemon isn't installed) the Console window shows the six-step onboarding. "ตรวจเครื่อง" = `neo daemon install` + PATH hint + `neo doctor --json` rows (Full Disk Access opens System Settings; Speech runs `neo doctor --fix stt`).
- Live tests start a real `cli/dist/neo` with `NEO_LOGIN_SHELL=/usr/bin/true NEO_DISCOVER=0`: otherwise the daemon puts the login-shell PATH first and the *real* `claude` shadows the fake one.

## Memory & jobs window (ticket 19)
- ⌘M / toolbar button opens "ความจำ & งาน": ความจำ (list/add/edit/forget, dream-marked items), ความฝัน (dream now/on/off/list/rm), บันทึกสนทนา (per day, forget), งานตั้งเวลา (speech preview → add, detailed add, edit, toggle, test, delete, jobs.md problems). Same panes sit in Settings ตั้งเวลา / ความจำ.
- Each pane re-reads when the daemon reports its file changed (`ConsoleModel.fileStamps`), and has an "open file in editor" button.
- Memory item edits save through `neo memory edit` (see ticket 19 notes); `jobs parse` needs `cli-jobs-parse.patch` (else adds directly).
- `NEO_TEST_BINARY=<neo>` makes the live tests use another build of neo.
