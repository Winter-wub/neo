# 05: Speak to the phone, get a card

**What to build:** Audio from NeoApp turns into answers. Adds `POST /api/audio` (endless chunked PCM, muted all-zero frames, only the latest pending segment kept while busy), Ears (segmenting, `rec`/`short`/`loud`/`listen_end` events), the `neo-stt` Swift helper owned by the daemon as a long-lived stdio child (restarted if it dies), wake word / follow-up / armed window / confirm windows in Conversation, `/api/arm`, `neo phone audio <file>`, `stterr` on failure, and `neo doctor --fix stt` asking for Speech permission. Source: spec §5, §7, STT ticket.

**Blocked by:** 03 Pair a phone and stream events to it; 04 Type a question, get a card

**Status:** done (code complete; only the A7 check, criterion 1, is open)

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [ ] Saying the pet name and a question on the A7 (dev daemon, port 8100) produces `heard` then a card
- [x] `neo phone audio sample.wav` produces the same events without a phone; tests use a fake STT
- [x] Killing `neo-stt` mid-session: the next segment still transcribes after the daemon restarts it; a failure yields `stterr`
- [x] Without the pet name (requireName on) nothing is asked; within 45 s follow-up and the 15 s armed window it is
- [x] Audio contract-suite tests pass against NeoCli

## Notes (agent, 2026-10-26)

- Criterion 1 (A7, dev daemon on 8100) not done: no phone was used. Run it by hand; `neo doctor --fix stt` first.
- Criterion 5: the `contract/` NeoCli driver still lists the audio tests as pending `05` and has no STT wiring. In a scratch copy with the 05 rule removed and `NEO_STT` pointed at a bridge to `FakeStt`, all audio, arm and voice tests pass on NeoCli (66 pass, 21 todo, 1 fail: `bodies > malformed JSON` posts to `/api/pet`, which is ticket 10). Needs the driver edit in `contract/` (see the report).

Carried over (from ticket 22): give the daemon a way to point Ears at a fake STT (env var or flag) so the contract suite's fake STT can be wired in; then delete the `05` rules from the PENDING list in the contract suite's NeoCli driver and make those tests pass (`cd contract && bun run test:neocli`).

- Update: the `05` PENDING rule is gone from `contract/src/drivers/neocli.ts` and the driver now points `NEO_STT` at `cli/test/fake-bin/neo-stt-bridge` (FakeStt). `cd contract && bun run test:neocli`: 65 pass, 23 todo, 0 fail. The two `bodies` tests that post to `/api/pet` are now pending under `10 pet-name-face`.
