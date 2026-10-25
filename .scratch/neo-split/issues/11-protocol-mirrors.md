# How do Neo Console and NeoApp stay in sync with protocol.ts?

Type: grilling
Status: resolved
Assignee: Winter-wub
Blocked by:

## Question

`cli/src/protocol.ts` is the single TypeScript source of truth for socket routes and events ([modules](../neocli-modules.md), [transport](05-command-to-daemon-transport.md)). Neo Console (Swift) reads `neo … --json` and `neo events --json`; NeoApp (Kotlin) reads `/api/*` + NDJSON on port 8000, whose shape is frozen by this effort. Decide how each client is kept from drifting: hand-written mirrors, types generated from `protocol.ts` (JSON Schema → Swift/Kotlin), or contract tests only — and whether the answer differs for Neo Console (changing freely) versus NeoApp (frozen, already covered by the black-box contract tests from [cutover](07-cutover-and-parity.md)).

## Answer

Resolved 2026-10-25 (grilling with the user).

- **`protocol.ts` stays plain TypeScript types**, no runtime schema library. Only the Phone adapter validates input, by hand (bodies from the phone); input on the socket comes from the same binary and is trusted.
- **No protocol version field** in `--json` or events: `neo` and Neo Console always ship in the same .app, and the [lifecycle](06-daemon-lifecycle.md) version check already restarts a stale daemon.
- **NeoApp gets generated Kotlin types, in this effort.** `bun run gen:kotlin` (in `cli/`) reads `protocol.ts` with ts-json-schema-generator (dev dependency only) and a small script of ours writes `android/app/src/main/java/com/mochi/companion/Protocol.kt`: a sealed class per event plus request/response types for every port-8000 route NeoApp calls (hello, pair, audio, events, pet, alarm stop, wakeup, dream seen, …), each with a lenient `fromJson(JSONObject)` / `toJson()` over org.json (missing fields default like `optString` does today). No new APK dependency. Socket-only routes are not generated. The file is committed; a `cli` test fails if regenerating changes it, so Gradle never needs Bun.
- **NeoApp is refactored onto `Protocol.kt` with identical behaviour** (Brain, Link and the other readers stop calling `optString` on raw events). Proof: existing `LogicTest.kt`, the black-box contract tests from [cutover](07-cutover-and-parity.md), and the A7 checklist.
- **One intended NeoApp fix:** Link drops a line only when its `type` is `ping`, replacing the substring check at `Link.kt:119`. NeoCli keeps the `"ping"` escape from [Which dead or half-working parts does the rewrite drop or fix?](10-what-the-rewrite-drops.md) so older APKs behave the same.
- **Neo Console uses hand-written Swift Codable types** for only the parts of `neo … --json` and `neo events --json` it reads. NeoCli tests write golden fixtures (sample `--json` output and events built from `protocol.ts` types) to `cli/test/fixtures/`; a Swift test in `console/` decodes every fixture, so drift breaks a test. No Swift codegen.

