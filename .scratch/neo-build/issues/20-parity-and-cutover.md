# 20: Parity, cutover and docs

**What to build:** Prove parity and switch over: the contract suite runs unchanged and green against NeoCli, the A7 checklist passes (wake word, ask, draw, alarm set/ring/snooze, sleep/wake and deep sleep, feed, shake, dream card, pairing, STT on quiet audio and non-Thai noise), the new Neo Console + NeoCli replace the old Neo.app in one switch with the old app and `legacy/` kept as rollback, and README/INSTALL/PLAN/HANDOFF are updated to the new names and layout (including manual LaunchAgent removal). After ~7 days of real use, delete the old backend directory. Source: spec §13.

**Blocked by:** 01 Contract test suite passes against the old backend; 03 Pair a phone and stream events to it; 05 Speak to the phone, get a card; 06 Switch between brains and models; 07 Agents MCP server, bypass modes and skill runs; 08 Ask about the weather; 09 Schedule alarms and tasks; 10 Pet, name and face; 11 Memory and journal; 12 Dreams; 13 All settings and the full doctor; 14 Install and supervise the daemon with launchd; 15 Migrate the old NEO_HOME; 16 Generated Kotlin protocol and NeoApp refactor; 17 Tracer: new Neo Console showing live Neo; 18 Neo Console settings and onboarding; 19 Neo Console memory and jobs window

**Status:** ready-for-agent

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [ ] Contract suite green against NeoCli on the real NEO_HOME after migration
- [ ] A7 checklist recorded with pass/fail per item
- [ ] Docs updated; the old backend directory removed in its own commit after the soak period

Carried over: speech on the A7 against a NeoCli daemon (ticket 05 criterion 1) and pairing the A7 to NeoCli (ticket 03 criterion 1) were never run — they need the A7 re-paired to the new daemon, which only happens at cutover. Real Apple transcription and the Speech permission prompt under launchd are also first exercised here.

Risk to check (from ticket 12): a single ~1 KB `--allowedTools a,b,c…` argument got the spawned fake `claude` SIGKILLed under the contract suite; dreams now pass tools as separate arguments, but the read-only ask (bypass off) still sends one long argument. With bypass off, check a real ask works before cutover. (Possibly the same unexplained SIGKILL seen when launching agents back-to-back.)
