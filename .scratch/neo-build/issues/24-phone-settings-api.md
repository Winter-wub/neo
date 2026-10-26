# 24: Paired phones can read and change Neo's settings

**What to build:** A paired NeoApp can do, over the phone port with its device token, what Neo Console does through the neo command: read status, list and switch brain (provider) and model, add/edit/remove custom providers with API keys, read and change every setting (requireName, followUp, bypass, idle, dream, network, claudeConfigDir, home, …), pet name and wake-word training, face colours, devices list/revoke, jobs (list/parse/add/edit/on/off/rm/test), memory (show/save with conflict check/forget), dreams (list/show/rm/now/on/off) and journal (list/show/forget). Decided with the user 2026-10-26: everything is allowed from a paired phone, including bypass and API keys (the device token is the trust boundary); this reverses spec §4.1's "port 8000 serves only NeoApp's routes" for these routes, so record the change in the spec. Reuse the core and the socket route shapes from the single protocol definition; don't fork logic. API keys go in, never come back out (only "has key").

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Every route above works with a device token on the phone port and returns 401 without one; shapes come from the protocol definition and are generated into Protocol.kt (`bun run gen:kotlin`, staleness test green)
- [x] Changes made from the phone publish the same events Neo Console sees (provider, model, settings, face, wake, …) so Console and phone stay in sync
- [x] A phone can never read an API key back; revoking a device works from the phone (including revoking itself, which ends its own stream with 401)
- [x] Contract suite gains tests for the new phone routes (old-backend run marks them divergent/pending); NeoCli run green; full `bun test` + `tsc` green
- [x] Spec §4.1 and §16 updated: phone settings are now in scope, with the security decision
