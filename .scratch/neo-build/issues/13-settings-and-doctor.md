# 13: All settings and the full doctor

**What to build:** Every setting is reachable through `neo settings` / `neo settings set` (requireName, followUp, bypass, tailscale, lan, idle.sleepAfter, idle.clock, dream, onboarded, claudeConfigDir, home, mcpServers) with validation, the daemon takes PATH from the login shell at every start, and `neo doctor [--json]` runs all checks (claude, stt, network, agents, phone, fda, jobs) with fix hints. Source: spec §4.3, §5, §7, §14.

**Blocked by:** 03 Pair a phone and stream events to it; 05 Speak to the phone, get a card

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] Changing tailscale/lan rebinds listeners without restarting the daemon
- [x] `neo doctor --json` shows where each tool was found, warns if `claudeConfigDir` doesn't exist, and reports Full Disk Access by really reading a protected path
- [x] Invalid values are rejected with exit 1 and a Thai message

Carried over (from tickets 04 and 14):
- [x] `claudeConfigDir` becomes a real settings key (Brain currently reads the `CLAUDE_CONFIG_DIR` env var only)
- [x] The daemon takes PATH from the login shell (`zsh -lic`) at every start
- [x] `status.provider` shows the current provider label (left empty in 04 to keep fixtures stable; update the fixtures)
- [x] A `NEO_APK` (or flag) override for the `/neo.apk` file, so the contract suite can assert 200 on NeoCli (from ticket 22)

Built (ticket 13): `core/settings` (all 12 names, validation, `POST /settings/set`, `idle` event), `core/doctor` (claude, network, agents, phone, fda rows with `found`), `lifecycle/login-path.ts` (`zsh -lic` PATH at daemon start, `NEO_LOGIN_SHELL` for tests), `NEO_APK` override. Not done: the contract neocli driver does not plant an APK / set `NEO_APK` yet (edit outside the allowed PENDING list). `dream` and `onboarded` are stored and shown, but Memory does not read `dream` yet.
