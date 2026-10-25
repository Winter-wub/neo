# 12: Dreams

**What to build:** Neo dreams while the user is away: activity counting learns away-hours, the 5-minute dream check applies today's rules, a dream runs through the Brain and writes its own markdown file (with the +/− memory changes section) and updates `memory.md`, deep sleep triggers a dream after 15 min, and the dream card is delivered on the next phone connect until `/api/dream/seen`. Exposed as `neo dream now|on|off|list|show|rm|clear|status`. Source: spec §3, §6, contract §8.3.

**Blocked by:** 10 Pet, name and face; 11 Memory and journal

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] `neo dream now` (fake `claude`) writes a new dream file and changes `memory.md` as the dream said
- [x] With a fake Clock: idle ≥45 min in a quiet hour with new journal entries starts a dream; ≥6 h since the last is enforced
- [x] The dream card is re-sent on every events connect until dream-seen, then never again
- [x] `neo dream status` explains why a dream would or wouldn't run now

Carried over (from ticket 11): `neo memory show` doesn't mark items that came from a dream yet; the old 2000-entry journal trim isn't rebuilt (decide whether dreams need it); `changed` events from journal writes count toward the 400-event history.

Parity (from ticket 22): when done, delete the `12` rules from the PENDING list in the contract suite's NeoCli driver and make those tests pass (`cd contract && bun run test:neocli`).

Carried over (from tickets 10 and 13): Pet already calls a Memory hook 15 min after deep sleep (currently a no-op) — implement it. The `dream` setting (on/off) is stored by Settings but nothing reads it yet. The hello-time `dream_done` replay and `/api/dream/seen` are yours.
