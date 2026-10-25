# Neo contract suite

Black-box tests of **the phone port** (NeoApp ↔ Neo daemon, port 8000), written from
`.scratch/neo-split/contract.md` as amended by spec §4.1. It drives a backend over HTTP with a
paired device token, a fake `claude` and a fake STT, and never touches the real Neo.

```
bun run test:old                # old Node backend (default), ~1 min
bun run test:neocli             # NeoCli from source (bun run ../cli/src/main.ts); pending tests show as todo
CONTRACT_NEO_BIN=../cli/dist/neo bun run test:neocli   # ... or a built neo
bun run test:neocli --todo      # also run the pending tests (bun then reports each one as failed either way: read the errors)
CONTRACT_STRICT=1 bun test      # run the "divergent" tests as plain tests, to see how each fails
CONTRACT_VERBOSE=1 bun test     # print the old backend's log when it stops
```

Needs `bun` and `node` (the old backend runs on node). Nothing is installed; no network is used.

## How it is put together

- **Driver** (`src/drivers/`): starts a backend on a random port with a temp `NEO_HOME`, hands the tests
  a `Backend` (`src/types.ts`): `baseUrl`, `home`, `getPairingCode()`, `ringAlarm()`, `makeDream()`,
  `stt` (fake speech-to-text), `claudeLog()`, `stop()`. The tests know nothing else about the backend.
  - `old-backend.ts`: `node app/server.js` with `PORT`, `NEO_HOME`, `NEO_PROVIDERS` (default `claude`), `TMPDIR`,
    `HOME` and `CLAUDE_CONFIG_DIR` in a temp dir, `NEO_APP_TOKEN`, and a PATH that holds only the fake `claude` and `node`.
    The old backend hard-codes STT at `127.0.0.1:8001` (where the real Neo Console listens), so `src/old-preload.cjs`
    redirects that one port to the fake STT.
  - `neocli.ts`: `neo daemon run --home <temp> --port <random>` (from source, or `CONTRACT_NEO_BIN`) with the same fake `claude`
    first on PATH, a temp HOME / NEO_LOG_DIR / launchd dirs / label so the real Neo is never reached, no forwarded-for header, and
    pairing codes from `neo devices pair --json`. `ringAlarm` / `makeDream` / the fake STT wiring throw until tickets 09 / 12 / 05 land.
    The `PENDING` list in this file maps test names to the ticket that delivers them: those tests are registered as `[pending:NN]`
    todos (visible in the output, never silently skipped). Delete a rule when its ticket is done; the test then has to pass.
- **Fake claude** (`bin/claude`): self-contained, plain Node. Emits Claude Code `stream-json`
  (`system` / `assistant` / `tool_use` / `result`). The final `result` is a one-line card JSON chosen by directives in the
  prompt text: `@card:ping|long|list|big|pixel|echo`, `@intent:schedule|skill`, `@tool:Name`, `@slow`, `@fail`.
  A dream prompt gets a dream JSON. `FAKE_CLAUDE_LOG=<file>` records every call (argv, stdin, session) and SIGTERMs.
- **Fake STT** (`src/fake-stt.ts`): `reply(text)`, `fail(msg)`, `hold()`; records the WAV and hints it was sent.
- **Divergences**: a test of the amended contract that the old backend does not meet is written with
  `divergent(tag, …)`. On a driver that lists the tag it runs as `test.failing` (green while it fails, red the day it starts to
  pass, so the tag gets removed). The NeoCli driver lists none, so there they are ordinary tests.

| tag | meaning |
|---|---|
| `localhost-needs-token` | old: localhost needs no token on phone routes (incl. open `POST /api/face`) |
| `phone-port-only-neoapp-routes` | old: `/api/ask`, `/api/cancel` exist; unknown paths answer 401/403, not 404 |
| `ping-token-escaped` | old: a card text `ping` is written as the bare `"ping"` token, which NeoApp's `Link.kt` line filter drops |
| `stt-failure-is-stterr` | old bug: a failed STT falls back to whisper, whose call throws on Node 24 and kills the process |

## Not covered

- Weather (needs open-meteo; no network in tests).
- Anything on the Mac-only routes (settings, devices, providers, schedule, dream…): they are not on the phone port.
- Timers that need minutes (5-minute pairing-code expiry, 2-minute ring auto-off, 15-minute deep-sleep dream, 45 s follow-up expiry).
- Non-Thai transcripts being dropped (`thaiOnly`): the spec removes it.
