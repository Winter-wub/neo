# 15: Migrate the old NEO_HOME

**What to build:** On first start against an old NEO_HOME the daemon converts it once: journal, dreams and schedule from JSON/JSONL into the markdown layout, originals moved to `legacy/`, the legacy OpenRouter key copied into NEO_HOME (0600) with `apiKeyFile` rewritten, and `claudeConfigDir` set to this Mac's path. Everything else carries over so paired phones stay paired. Source: spec §13, cutover and drops tickets.

**Blocked by:** 09 Schedule alarms and tasks; 11 Memory and journal; 12 Dreams

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] Run on a copy of the real NEO_HOME: every journal entry, dream and job appears in the new files; counts match
- [x] A second start does nothing; the old key file outside NEO_HOME is left in place
- [x] The A7's existing device token still works afterwards

Built: `cli/src/migrate/migrate.ts` (`migrateHome`, `summarize`), hooked in `cli/src/daemon.ts` before `createCore`. Tests: `cli/src/migrate/migrate.test.ts`, `cli/test/migrate-e2e.test.ts`. Real copy: 31/31 journal, 3/3 dreams; the real schedule.json is `[]`, so job conversion was only tested on synthetic data.
