# Which dead or half-working parts does the rewrite drop or fix?

Type: grilling
Status: resolved
Assignee: Winter-wub
Blocked by:

## Question

The inventory ([contract.md](../contract.md) §8) found surface that nobody uses or that only half works. For each, decide: drop, fix, or keep as is in NeoCli — `/api/cancel` (no client calls it), `/api/ask` (debug-only, 401 under a token, skips events and card clean-up), `job.notify` (never saved), `devices.json` `lastSeen` (rarely saved), the legacy `apiKeyFile: ~/.config/neo/openrouter.key` path vs the key in NEO_HOME, `CLAUDE_CONFIG_DIR` defaulting to a personal path, and the NeoApp ping filter that drops any line containing `"ping"`. Any fix that changes what NeoApp sees must respect "keep the current protocol unless it truly blocks the split".

Context from "Where does Apple speech-to-text live?": the stale `apple-stt` comment is moot (the whole STT path is rewritten around the `neo-stt` helper; whisper and ffmpeg are dropped), so it was removed from this list.

## Answer

Resolved 2026-10-25 (grilling with the user). NeoApp is untouched; each item below is what NeoCli does.

- **`/api/cancel`**: kept only as a **socket route** for `neo cancel`; removed from phone port 8000. NeoApp never calls it, and "ยกเลิก" by voice already cancels through the speech path.
- **`/api/ask`**: **dropped**. Testing a card without speaking is `neo say "…"`, which runs the real path (events, journal, humanized card). NeoApp's debug `ask` intent now gets 404 and shows its existing `askerr`; removing that intent belongs to a later NeoApp effort.
- **`job.notify`**: **dropped**. Task jobs already deliver a result card; "do it, then ring me" would be a new feature, not parity.
- **`devices.json` `lastSeen`**: **fixed**. Devices persists it, throttled to at most once a minute per device, and `neo devices list` shows it (helps decide what to revoke).
- **API key location**: the one-time cutover conversion copies `~/.config/neo/openrouter.key` into `NEO_HOME/openrouter.key` (0600) and rewrites `apiKeyFile` in `providers.json`; `~/.config/neo` is left in place, not deleted. NeoCli reads only the `apiKeyFile` (or `apiKeyEnv`) the provider names — no built-in fallback paths.
- **`CLAUDE_CONFIG_DIR`**: no personal path in code. New setting `claudeConfigDir`; when unset (and no env var), NeoCli passes nothing and `claude` uses its own default. Cutover writes `claudeConfigDir: ~/.ccs/instances/personal` into this Mac's settings so the account doesn't change; `neo doctor` warns if the configured path doesn't exist.
- **NeoApp `"ping"` filter**: **worked around in NeoCli**. The Phone adapter's event serializer (one place) writes any `"ping"` string token inside a payload as `"\u0070ing"`, which parses to the same value but no longer matches `Link.kt:119`; the real ping stays exactly `{"type":"ping"}`. A contract test covers a card whose text is `ping`. Neo Console (on `neo events --json`) is unaffected.

