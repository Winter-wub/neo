# 02: Tracer: `neo status` and `neo events` from a signed compiled binary

**What to build:** The NeoCli skeleton end to end: a compiled, signed `neo` binary whose `neo daemon run --home <dir> --port <n>` starts the Neo daemon, and whose `neo status` and `neo events [--history] [--json]` talk to it over the 0600 Unix socket in NEO_HOME. Establishes the single protocol definition, the Events and minimal Settings modules, the Command adapter, the client-side rendering (markdown vs `--json`), exit codes, and the golden-fixture writer. Source: spec §3, §4.2, §4.3, §8.

**Blocked by:** None (can start immediately)

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] Build produces the binary with dotenv/bunfig autoload off, hardened runtime, allow-jit and the Apple Development identity chosen by a build variable; `codesign --verify --strict` passes
- [x] `neo status` prints a markdown snapshot; `--json` prints the protocol shape; daemon not running and no LaunchAgent → exit 3 with a Thai message on stderr and `{error, code}` on stdout with `--json`
- [x] `neo events --json` stays open past 60 s idle (idle timeout off) and receives a `status` event when state changes; `--history` replays the backlog first (≤400)
- [x] Usage errors exit 2; the daemon never sees argv
- [x] Tests write golden fixtures for every `--json` output and event added so far
