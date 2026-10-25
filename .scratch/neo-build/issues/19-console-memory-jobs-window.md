# 19: Neo Console memory and jobs window

**What to build:** The "ความจำ & งาน" window and the schedule/memory tabs keep their list/edit/delete features through `neo memory|dreams|journal|jobs …`, add an "open file in editor" button per pane, and refresh when the daemon reports a file changed. Source: spec §10.

**Blocked by:** 09 Schedule alarms and tasks; 11 Memory and journal; 12 Dreams; 17 Tracer: new Neo Console showing live Neo

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] Editing a memory item in the window and in an editor at once: the second save is refused with a clear message
- [x] Adding a job by speech text previews then adds; toggling and deleting work
- [x] Editing `jobs.md` in an editor updates the window without reopening it

## Done notes
Built in `console/`: `MemoryModel` (Kit, tested), `MemoryWindow.swift` (window "ความจำ & งาน": ความจำ · ความฝัน · บันทึกสนทนา · งานตั้งเวลา; menu item ⌘M and a toolbar button in the Console window). The Settings tabs ตั้งเวลา and ความจำ reuse the same panes (`JobsPane`, `FactsContent`, `DreamControls`). Every pane has an "open file in editor" button (`NSWorkspace.open` on memory.md / jobs.md / the open dream / the open journal day). `ConsoleModel.fileStamps` counts `changed` (memory|journal|dream), `jobs`/`jobs_warning`, alarm and dream events per kind; panes re-read only what moved.
`swift test`: 53 tests (new: fixtures for journal/dream/memory-with-dream/jobs-add, 15 fake-runner tests, 3 live tests + 1 preview test against the real neo).
Verified: live against real `neo` (temp home, random port, fake claude): item edit refused when memory.md changed meanwhile (file not clobbered, newest text loaded, message "…ถูกแก้จากที่อื่น… ไม่ได้บันทึก"), then accepted from the newest text; memory.md and jobs.md written by "an editor" show up in the model without reopening (also a bad jobs.md line shows in `problems` and keeps the old jobs); add/edit/toggle/delete a job; dream now, toggle, rm; journal forget. Looked at the dev app by hand: window opens, jobs tab lists a job added to jobs.md while it was open, sidebar badge updates by itself.
Gaps in `neo` (nothing outside console/ was touched):
- **No `neo jobs parse "<speech>"`** (the route `POST /jobs/parse` exists). Without it the window cannot preview; it falls back to `jobs add "<speech>" --yes` and says "เพิ่มให้เลย". `console/cli-jobs-parse.patch` adds the verb (apply: `cd cli/src && patch -p1 < ../../console/cli-jobs-parse.patch`; usage text and neo-command.md not updated). Preview-then-add was only verified with a scratch build that has the patch (`NEO_TEST_BINARY=<that binary> swift test`); on the stock `cli/dist/neo` that test skips.
- memory saves go through `neo memory edit` with a one-shot `$EDITOR` script (compares the file neo hands it with what the window loaded, else exit 42), because there is no non-interactive `neo memory save --since`. Works today; a proper verb would be cleaner.
Not verified: clicking add/edit/delete in the GUI beyond opening the window and the jobs tab (covered by model tests, not clicks); "open in editor" opens whatever app owns .md (not clicked); journal text editing in the window (view/delete/open only).
