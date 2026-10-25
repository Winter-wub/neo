# How do we prove the rewrite matches and switch over?

Type: grilling
Status: resolved
Blocked by: 02

## Question

Because NeoCli is a from-scratch rewrite, how do we know it does everything the old backend did before deleting `app/`? Decide: the parity bar (contract tests derived from the inventory, replaying a recorded NeoApp session, manual checks on the A7); whether NEO_HOME data is reused as-is or migrated; whether old and new can run side by side (ports, data dir) during the switch; and the order of cutover for Neo Console.

Context from "What is the neo command's surface?": storage moves from JSON/JSONL to markdown for memory, dreams, journal and jobs, so cutover includes converting the existing NEO_HOME data (journal.jsonl, dreams.jsonl, schedule.json) — or deciding not to.

## Answer

Settled with the user (2026-10-25).

- **Parity bar** (both required before deleting `app/`):
  1. A black-box contract test suite for NeoApp's side, written from [contract.md](../contract.md), driven over HTTP with a device token. It is made to pass against the **old** Node backend first, then run unchanged against NeoCli. Fake `claude` only, no quota. (The suite targets the post-transport contract: phone port is device-token only.)
  2. A manual checklist on the real A7 (wake word, ask, draw, set/ring/snooze an alarm, sleep/wake and deep sleep, feed, shake, dream card delivery, pairing).
  Recorded-audio replay was not chosen.
- **Data:** on first start the Neo daemon converts the old files once into the markdown layout (`journal.jsonl` → `journal/*.md`, `dreams.jsonl` → `dreams/*.md`, `schedule.json` → `jobs.md`) and moves the originals to `NEO_HOME/legacy/`. `memory.md`, `state.json`, `devices.json`, `providers.json`, keys carry over as-is, so the A7 stays paired.
- **Side by side during development:** the old Neo keeps running on port 8000 with the real NEO_HOME; NeoCli under development uses a copy of NEO_HOME, port 8100 and the fake `claude`.
- **Cutover:** one switch — the new Neo Console (driving the neo command) and NeoCli ship together. The old Neo.app and `legacy/` are kept as the way back. `app/` is deleted after the A7 checklist passes and ~7 days of real use.
