# 16: Generated Kotlin protocol and NeoApp refactor

**What to build:** NeoApp reads and writes the phone protocol through types generated from the single TypeScript protocol definition (lenient org.json parsers, no new APK dependency, committed, with a NeoCli test that fails when the generated file is stale). Brain, Link and the other readers move onto it with identical behaviour; the one intended fix is that only events whose `type` is `ping` are dropped. Source: spec §11, §12, sync ticket.

**Blocked by:** 21 Prepare NeoApp for the generated protocol, and fix the ping filter; 01 Contract test suite passes against the old backend; 05 Speak to the phone, get a card; 09 Schedule alarms and tasks; 10 Pet, name and face; 12 Dreams

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] Regenerating with no protocol change produces no diff; changing an event shape without regenerating fails the NeoCli test
- [x] Existing NeoApp logic tests pass unchanged; the contract suite and a quick A7 run show the same behaviour
- [x] A card whose text is `ping` now shows on the A7 even against an old-style stream

Notes (2026-10-26): generator is `cli/tools/gen-kotlin.ts` (`bun run gen:kotlin`), reading protocol.ts with the TypeScript 5.9.3 compiler API (devDependency alias `typescript-js`, because the installed typescript 7 has no JS API; not ts-json-schema-generator). Hand-written `Card.kt` builds NeoApp's `Card` from the generated `WireCard`. Phone-route types (PairRequest/Response, PetRequest, AskRequest) and `CardItem` were added to protocol.ts; `HelloEvent.idle` is now `IdleSettings`. `dream_fail` carries no card in protocol.ts, so `DreamFail` is payload-free. Third criterion: the ping fix itself landed and was unit-tested in ticket 21; on the A7 only face and live event connections were checked here.

Verified on the A7 by the coordinator (2026-10-26, against the old Neo on :8000): heard text "ping" now shows as a subtitle (dropped by the old filter); typed weather card for tomorrow; an alarm rang and a screen tap stopped it (alarm_off why แตะปิด).
