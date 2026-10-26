# 26: NeoApp screens for jobs, memory and dreams

**What to build:** From the same settings screen, the phone can list/add (by sentence, with a preview)/toggle/delete/test scheduled jobs, read and edit memory (conflict-checked: a save refused because the Mac changed it says so clearly), forget an item, list/read/delete dreams and ask for a dream now, and browse/delete journal days. Same data as Neo Console's "ความจำ & งาน" window, refreshed from events.

**Blocked by:** 24 Paired phones can read and change Neo's settings; 25 NeoApp settings screen — brain, model, listening, face, name

**Status:** done (not exercised on the A7: dream now, deleting a dream or a journal entry, forgetting a memory item; the job was not left to ring at its real time; deleting a whole journal day is not possible from a phone, see notes)

- [x] Adding "ปลุกพรุ่งนี้ 7 โมง" on the A7 previews then adds; it appears in `neo jobs list` and rings on time (preview, add, off/on, delete checked on the A7; "ทดสอบ" made it ring on the Mac; the real 07:00 was not waited for)
- [x] Editing memory on the phone while it's edited on the Mac gives a clear conflict message, nothing lost
- [x] Unit tests for the screens' models; debug APK builds and is checked on the A7 (`NeoDataModelTest`, 22 tests)

## Notes (ticket 26)

- `NeoDataModel` (tests: `NeoDataModelTest`) + `NeoDataActivity`, opened from four buttons at the bottom of the "Neo" section (`NeoSection.dataSection`). Tabs: งาน / ความจำ / ฝัน / บันทึก. Live refresh from the `jobs`, `jobs_warning`, `changed`, `dreaming`, `dream_done`, `dream_fail` events.
- Memory is edited as the whole file; the save sends the version it started from. A 409 (or a `changed` event while editing) shows the Mac's text beside the phone's draft with "ทับด้วยของฉัน" / "ใช้ของ Mac"; the draft is never dropped silently. Checked on the A7: typed on the phone, `memory add` on the Mac, phone save refused, Mac text shown, nothing lost.
- Small shared edits: `Call` got `timeoutMs` (dream now waits up to 10 min), `NeoRemote.send` uses it, `NeoSection` got the four buttons, `AndroidManifest.xml` got the `NeoDataActivity` entry (not exported).
- `NeoDataActivity` accepts `--es speech "..."` to prefill the add-job sentence (adb cannot type Thai); it is harmless in the release path.
- Gap: the phone routes (`PHONE_SETTINGS_ROUTES`) do not include `POST /journal/save`, so a journal day can only be pruned entry by entry (`/journal/forget` by question; ambiguous matches are refused with the daemon's list). To delete a whole day from the phone, add `POST /journal/save` (empty text deletes the day) to `PHONE_SETTINGS_ROUTES` in `cli/src/protocol.ts`.
