# 14: Install and supervise the daemon with launchd

**What to build:** The Neo daemon runs on its own: `neo daemon install|start|stop|restart|status|logs [-f]|uninstall`, the plain LaunchAgent plist (RunAtLoad, KeepAlive on crash only), the `~/.local/bin/neo` symlink, the neo command kickstarting launchd when the daemon is down (≤5 s) before giving exit 3, the rotating daemon log plus crash log, and the version/build/protocol handshake. Source: spec §9, lifecycle ticket.

**Blocked by:** 02 Tracer: `neo status` and `neo events` from a signed compiled binary

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] After `neo daemon install`, killing the daemon brings it back via launchd; `neo daemon stop` keeps it down until `start` or a neo command wakes it
- [x] `neo status` with the daemon stopped but installed starts it and succeeds
- [x] `neo daemon status --json` reports installed, plist/symlink targets, pid, version, build, protocol
- [x] `uninstall` removes plist and symlink and keeps NEO_HOME; log rotates at 5 MB keeping 3
