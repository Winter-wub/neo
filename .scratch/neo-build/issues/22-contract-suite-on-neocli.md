# 22: Contract suite runs against NeoCli

**What to build:** The contract suite from ticket 01 can be pointed at NeoCli as well as the old backend: a real NeoCli driver starts a dev Neo daemon (temp NEO_HOME, random port, fake `claude` and fake STT), pairs through `neo devices pair --json`, and the suite reports per test whether NeoCli passes. Features whose NeoCli tickets haven't landed are reported as pending (not silently skipped), so the suite becomes the live parity scoreboard for the rewrite. Source: spec §13; tickets 01 and 03.

**Blocked by:** 01 Contract test suite passes against the old backend; 03 Pair a phone and stream events

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] One command runs the suite against the old backend and another against NeoCli (built or `bun run` from the cli/ sources)
- [x] The NeoCli driver uses `neo devices pair --json` for the code and needs no localhost privileges or `x-forwarded-for`
- [x] Tests for routes/features not yet in NeoCli are marked pending with the ticket that will deliver them; everything ticket 03 delivered passes
- [x] The divergent tests (token-only phone port, ping escape, 404 for `/api/ask`/`/api/cancel`) pass as plain tests on NeoCli
- [x] Old-backend run still 88 pass / 0 fail

Notes (agent, ticket 22):
- `cd contract && bun run test:old` / `bun run test:neocli` (`CONTRACT_NEO_BIN=<built neo>` to use a binary). NeoCli: 41 pass, 47 pending, 0 fail. Old: 88 pass, 0 fail.
- Pending rules live in `PENDING` in `contract/src/drivers/neocli.ts`, each with its ticket (05, 06, 07, 09, 10, 12). Delete a rule when its ticket lands.
- Phone-posts/audio/conversation/alarm/dream tests are all pending; only pairing, events (hello, ping, multi-connect), the 404/401 amended-contract tests and the `ping` escape (via `neo say`) run for real.
- Fake STT is created but not wired to anything (the `neo-stt` helper is ticket 05); `ringAlarm`/`makeDream` throw until tickets 09/12.
