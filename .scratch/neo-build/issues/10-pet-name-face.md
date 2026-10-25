# 10: Pet, name and face

**What to build:** The pet side works from both ends: NeoApp's pet reports, feeding (`neo pet feed`, fast phrases), sleep and deep sleep (mic off, tap to wake via `/api/wakeup`, dream request after 15 min handed to Memory when it exists), `neo pet`, the pet name and wake-word variants (`neo name set|train`, training from the next three transcripts), and face colours (`neo face set`, `face` event, included in hello). Source: neo-command.md, modules.

**Blocked by:** 03 Pair a phone and stream events to it; 05 Speak to the phone, get a card

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] `neo pet feed milk` makes the A7 eat; `/api/pet` reports are saved and shown by `neo pet`
- [x] `neo pet sleep` emits `sleep`; tapping the phone sends wakeup and cancels the pending dream timer
- [x] `neo name train จอห์น` then speaking it three times saves the variants used by the wake word
- [x] `neo face set --fg #ffffff` recolours the A7 face live

Parity (from ticket 22): when done, delete the `10` rules from the PENDING list in the contract suite's NeoCli driver and make those tests pass (`cd contract && bun run test:neocli`).
