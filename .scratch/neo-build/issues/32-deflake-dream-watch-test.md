# 32: Deflake "a dream edited in an editor is announced as changed"

**What to build:** This cli test fails about one run in three with no other agent touching cli/ (seen 2026-10-26 03:20, ~2.2 s). Find why (fs watch timing, debounce, mtime granularity) and fix the cause in the watcher or the test's wait, not by just raising a timeout. Check the other file-watch tests (memory, journal, jobs) for the same pattern.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] 20 consecutive full `bun test` runs in cli/ with 0 failures (report the loop)
- [x] Root cause written in the ticket; `tsc` and contract suite green

## Root cause

`fs.watch` arms asynchronously (jobs.test.ts already says so in a comment). The test wrote the dream file right after `createMemory`, so under full-suite load the write landed before the watcher was armed and the event was lost for good (failed 2 of 6 baseline full runs, always at the 2 s wait; 0 of 30 in isolation). memory.test.ts only passed because it sleeps 150 ms before editing. The same gap is real in the daemon: an edit in the first moments after start is never announced.

## Fix

`memory.ts`: one catch-up scan 150 ms after the watchers are set up (memory.md, every journal day, every dream), through the normal debounced `check`, so an unchanged file stays silent. Tolerates a removed home. `jobs.ts`: the same catch-up reload after its watcher is armed. Test unchanged.

## Verification

20 consecutive `bun test` in cli/: 20 ok (668 pass, 0 fail each). `bunx tsc --noEmit` clean. contract: `bun test` 166 pass, `CONTRACT_BACKEND=neocli bun test` 166 pass.
