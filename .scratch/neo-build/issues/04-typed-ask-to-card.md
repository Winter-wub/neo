# 04: Type a question, get a card

**What to build:** `neo say "<text>"` goes through the same path speech will: Conversation builds the context, Brain (Claude Code provider, stream-json, fake `claude` in tests) returns a typed Answer, Cards humanizes it, and a `card` event reaches every listener while `neo say` prints the card (confirm cards print the question and exit 0; `--no-wait` returns at once). Includes thinking/tool events, `neo cancel` over the socket, and conversation session rules (15 min idle / 20 turns / reset phrases, notes from non-LLM answers). Source: spec §3, §4.3, §7.

**Blocked by:** 02 Tracer: `neo status` and `neo events` from a signed compiled binary

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] With the fake `claude`, `neo say` prints a humanized card and `neo events` shows thinking → tool → card
- [x] `neo cancel` during a run emits `cancelled` and kills the child process group
- [x] `CLAUDECODE*` vars are stripped from the child env; `claudeConfigDir` passed only when set
- [x] Conversation, Brain and Cards have unit tests with fake Brain and fake Clock
