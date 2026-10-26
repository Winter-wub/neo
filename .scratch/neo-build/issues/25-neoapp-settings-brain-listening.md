# 25: NeoApp settings screen — brain, model, listening, face, name

**What to build:** Long-press 3 s (the existing setup screen) shows, once paired, a "Neo" section at the top that controls the Mac's Neo: choose brain (provider) and model (with the free models findable), add/edit a custom provider with an API key, requireName, followUp (45 s), bypass (with a clear warning), sleep-after and the clock face, dream on/off, pet name and wake-word training, face colours. Values come from the Neo daemon and update live from events (a change in Neo Console shows on the phone). The existing pairing / Mac-address part stays below. Thai UI, same look as the current setup screen.

**Blocked by:** 24 Paired phones can read and change Neo's settings

**Status:** done (name/wake training, face-colour edits and the custom-provider dialog were not exercised on the A7)

- [x] Switching brain and model from the A7 changes `neo status` on the Mac, and switching from Neo Console updates the phone screen without reopening it
- [x] Toggles/pickers for every listed setting round-trip; bypass asks for confirmation before turning on
- [x] Unit tests for the screen's model (`NeoSettingsModelTest`, 20 tests); debug APK builds
- [x] checked on the A7 against the rebuilt real daemon (see report)
