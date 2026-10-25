# 03: Pair a phone and stream events to it

**What to build:** NeoApp (unchanged) can pair with a dev Neo daemon and receive its event stream. Adds the Devices module (pairing codes, device tokens, the single home of access rules, `lastSeen` saved at most once a minute), the Phone adapter on the phone port with listeners on localhost plus tailscale/LAN interfaces per settings, `neo devices pair|list|revoke`, `/api/hello`, `/api/pair`, `/neo.apk`, `GET /api/events` with hello-on-connect and the 15 s ping, and the `"ping"` escape in payloads. Source: spec §4.1, transport ticket, drops ticket.

**Blocked by:** 02 Tracer: `neo status` and `neo events` from a signed compiled binary

**Status:** done (code complete; two criteria left open: on-device A7 pairing, and the contract suite, whose NeoCli driver is still a stub)

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [ ] `neo devices pair` prints code, addresses and expiry; the A7 pairs against port 8100 and shows the face
- [x] Every phone route except hello/pair/apk returns 401 without a valid device token, including from localhost
- [x] `neo devices list` shows last seen; `neo devices revoke` makes that phone's next request 401 (NeoApp shows unpaired)
- [x] An event payload containing the string `ping` reaches NeoApp intact; the real ping is exactly `{"type":"ping"}`
- [ ] Matching contract-suite tests pass against NeoCli

Notes (agent, ticket 03):
- First criterion not ticked: `neo devices pair` prints code, addresses and expiry (tested), but the A7 was not re-paired on purpose (it is paired to the real Neo). Pairing was checked with HTTP calls that copy SetupActivity (`/api/hello`, `/api/pair`, then the `/api/events` loop).
- Last criterion not ticked: `contract/src/drivers/neocli.ts` is still a stub.
- Left for later tickets: `dream_done` re-sent on connect (Memory), real pet name / face / idle / ringing in `hello` (Settings, Pet, Jobs; defaults for now), `phone` in status (audio ticket), the other device routes (`/api/audio`, `/api/arm`, `/api/pet`, ...) answer 404 for a paired phone until their tickets land.
