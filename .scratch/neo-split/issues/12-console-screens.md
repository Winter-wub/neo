# Which Neo Console screens stay once everything goes through the neo command?

Type: grilling
Status: resolved
Assignee: Winter-wub
Blocked by:

## Question

Neo Console becomes a pure controller over the neo command ([command surface](../neo-command.md), [lifecycle](06-daemon-lifecycle.md)). For each current Neo Console screen in `app/mac/Sources` — the Settings window, onboarding (now also installing the daemon, `neo doctor --fix stt`, Full Disk Access), pairing, providers/models, jobs/memory/dreams views, event chips — decide: keep as a screen (backed by which `neo` subcommands), shrink, or drop in favour of the terminal / editing the markdown files directly. Also settle what Neo Console shows when the daemon is down (exit 3) or a version mismatch is being repaired.

## Answer

Resolved 2026-10-26 (grilling with the user).

- **Every current screen stays, same features**: Console window (events, cards, model picker, face), "ความจำ & งาน" window (facts, dreams, journal), the seven Settings tabs, the menu bar, and the six-step onboarding. Each button is rewritten to call a `neo` subcommand ([command surface](../neo-command.md)); any action without one gets a subcommand added there while writing the spec. No new screens and none removed, except where the split forces a change (below).
- **Memory, dreams, journal and jobs** keep their current list/edit/delete UI, now through `neo memory|dreams|journal|jobs …` with conflict-checked saves, plus a new "open file in editor" button per pane. Panes refresh from events when the daemon reports a file changed.
- **Menu bar separates Neo Console from Neo**: "ออกจาก Neo Console" quits only the app (Neo keeps running); a "Neo" submenu shows daemon status and offers start / stop / restart (`neo daemon start|stop|restart`) and "open log" (the daemon's own log). "รีสตาร์ท server" goes away into that submenu.
- **Daemon down or being repaired**: the menu bar icon dims; the Console window and menu show a "Neo ไม่ทำงาน" bar with "เริ่ม Neo" (runs the same reconcile/repair path as launch, see [lifecycle](06-daemon-lifecycle.md)) and "open log"; during a version repair it shows "กำลังอัปเดต Neo…". Other actions are disabled; Neo Console reconnects `neo events --json` on its own when the daemon is back. No modal alerts.
- **Onboarding** keeps six steps; the first, "ตรวจเครื่อง", runs `neo daemon install`, then lists checks from `neo doctor --json` with a fix button per row (Full Disk Access opens System Settings; Speech runs `neo doctor --fix stt`).
- **Login item** becomes "เปิด Neo Console เมื่อเข้าสู่ระบบ" (menu bar app only); the daemon always starts through its LaunchAgent, independent of this toggle.
- **adb reverse auto-toggle is dropped** (Neo Console no longer runs adb); the phone reaches the Mac by Wi-Fi and pairing. Manual `adb reverse` still works for development.

