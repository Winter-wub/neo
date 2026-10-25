# 21: Prepare NeoApp for the generated protocol, and fix the ping filter

**What to build:** NeoApp reads every server event and phone-route response through one small protocol layer instead of scattered `optString` calls on raw `JSONObject`s, so the later generated protocol types can be swapped in behind it. Behaviour stays identical, with one intended fix: the event stream drops a line only when its `type` is `ping` (today any line containing the text `"ping"` is dropped, so a card whose text is `ping` vanishes). Source: spec §11, §12; sync ticket in `.scratch/neo-split/issues/11-protocol-mirrors.md`.

**Blocked by:** None (can start immediately)

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] All event and response parsing in NeoApp goes through one protocol layer (one type per event the app reacts to, lenient defaults exactly like today's `optString`/`optInt`); no other file reads raw event JSON
- [x] No new APK dependency; org.json only
- [x] Existing NeoApp logic tests pass unchanged, plus new tests for the protocol layer (including unknown event types and missing fields)
- [x] A line whose `type` is `ping` is dropped; a card whose title/text is `ping` is shown (unit test)
- [x] Debug APK builds; installed and relaunched on the A7 against the running Neo, and the face, a typed card and an alarm still behave as before

Verified on the A7 (2026-10-26, Wi-Fi adb 192.168.1.x:5555) against the running old Neo over Tailscale: face colours, pending dream card, feed, a typed weather card, and an alarm that rang and was stopped by a screen tap (`alarm_off` why แตะปิด).
