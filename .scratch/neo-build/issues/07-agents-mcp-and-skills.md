# 07: Agents MCP server, bypass modes and skill runs

**What to build:** The Brain's tools work from the compiled binary: `neo mcp` serves the agents MCP server (orca and ego-browser tools) over stdio; the MCP config written at startup points at the `neo` binary and copies the chosen Claude Code MCP servers; both flag sets (bypass on/off) are built as today; a confirmed skill card runs the skill job (15 min, cancellable). Source: spec §5, §7.

**Blocked by:** 04 Type a question, get a card

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] `claude` (fake) is launched with an MCP config whose agents entry is `<neo> mcp`; `neo mcp` answers MCP initialize and lists its tools
- [x] With bypass off, the read-only tool allow-list is used
- [x] Saying/typing a request that yields a skill confirm card, then "ตกลง", runs the skill and `neo cancel` stops it

Carried over (from ticket 04): the MCP config is written to NEO_HOME/neo-mcp.json (0600) rather than $TMPDIR, and its neo-agents entry already points at `<neo> mcp`, which doesn't exist yet. Keep NEO_HOME as the location (avoids clashing with the old Neo's $TMPDIR file) and record that in the spec when done.

Parity (from ticket 22): when done, delete the `07` rules from the PENDING list in the contract suite's NeoCli driver and make those tests pass (`cd contract && bun run test:neocli`).
