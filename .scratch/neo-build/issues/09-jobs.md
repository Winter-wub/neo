# 09: Schedule alarms and tasks

**What to build:** Jobs live in a human-editable `jobs.md` (grammar settled here, round-trips, readable in Obsidian) that the daemon watches. The scheduler fires one-offs and cron jobs (15 s tick, late >30 min dropped), owns the ringing alarm (auto-off 2 min, stop/snooze by voice, tap via `/api/alarm/stop`, or `neo alarm stop|snooze`), and runs task jobs through Conversation with retry while busy. Exposed as `neo jobs …`, plus schedule fast phrases and the Brain's schedule intent. `job.notify` does not exist. Source: spec §5, §6, neo-command.md.

**Blocked by:** 04 Type a question, get a card

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] `neo jobs add "ปลุกพรุ่งนี้ตีห้าครึ่ง"` previews then adds; `neo jobs list` shows next run
- [x] Editing `jobs.md` by hand reloads it; a bad line keeps the previous jobs, emits a warning event and shows in `neo doctor`
- [x] With a fake Clock: an alarm rings, "ขออีก 5 นาที" snoozes, it auto-stops after 2 min; a task job busy-retries every 60 s up to 10 times
- [x] A save racing with an external edit is refused (exit 1)

Carried over (from ticket 04): Conversation exposes intent hooks (`deps.intents`); plug the schedule intent in there. Cards published by Jobs (alarms) must be humanized by the publisher.

Parity (from ticket 22): when done, delete the `09` rules from the PENDING list in the contract suite's NeoCli driver and make those tests pass (`cd contract && bun run test:neocli`).

Carried over (from ticket 17): expose whether an alarm is ringing or a job is running in `status` (e.g. `ringing` / `busy` fields, with golden fixtures) so Neo Console can wait for idle before restarting the daemon on a version change.
