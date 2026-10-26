# 29: Small daemon fixes found along the way

**What to build:** Three leftovers reported by earlier tickets.

**Blocked by:** 27 Neo draws and remembers an animation for each tool it uses (same files; run after it)

**Status:** done

- [x] Revoking a device also ends that phone's open `/api/audio` upload right away (from ticket 24: today only its next request gets 401)
- [x] SIGTERM while the daemon is still starting up is honoured promptly instead of after a ~5 s timeout (from ticket 15)
- [x] The read-only ask (bypass off) passes `--allowedTools` as separate arguments like dreams do, so a long single argument can't get the child killed (from ticket 12)
