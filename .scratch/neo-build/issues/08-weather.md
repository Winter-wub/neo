# 08: Ask about the weather

**What to build:** Weather answers without the Brain: the Weather module's fast phrase and the Brain's weather intent both produce a weather card from open-meteo (geocoding cached), using setting `home {city, lat, lon}` (default กรุงเทพฯ) for "here". Source: spec §3, §14.

**Blocked by:** 04 Type a question, get a card

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] "อากาศพรุ่งนี้เป็นไง" via `neo say` returns a weather card without spawning `claude`
- [x] A Brain answer with a weather intent is turned into the same card
- [x] The answer is kept as a note for the next conversation turn
