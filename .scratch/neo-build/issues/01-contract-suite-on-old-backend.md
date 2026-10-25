# 01: Contract test suite passes against the old backend

**What to build:** A black-box test suite for NeoApp's side of the Neo daemon, written from the backend contract inventory as amended by spec §4.1 (device token on every phone route except hello/pair/apk; no `/api/ask` or `/api/cancel` on the phone port). It drives the old Node backend over HTTP with a paired device token and a fake `claude`, and goes green there first, so it can later judge NeoCli unchanged. Source: spec §13, cutover ticket.

**Blocked by:** None (can start immediately)

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] Runs against any base URL + NEO_HOME given to it; never spends Claude quota (fake `claude` only)
- [x] Covers pairing (hello, pair, 401 when unpaired), `/api/events` stream (hello on connect, 15 s ping, pending dream re-sent until seen), `/api/audio` streamed PCM incl. all-zero muted frames, and every phone-only POST (arm, alarm stop/snooze, pet, wakeup, dream seen)
- [x] Includes a card whose text is `ping` (expected to fail on the old backend; marked as a known divergence)
- [x] Tests that encode the amended contract (token-only phone port) are marked as expected-divergent on the old backend; everything else is green against it
