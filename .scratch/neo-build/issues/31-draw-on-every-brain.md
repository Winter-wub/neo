# 31: Tool animations are drawn whichever brain is in use

**What to build:** Ticket 27 only draws tool animations when the Brain is Claude Code: for ACP (OpenCode, Claude Code ACP), OpenAI-compatible and HTTP providers, drawing asks for a fresh session, which would replace the user's one conversation session, so the queue just waits. The user runs OpenCode + a free deepseek model, so today nothing is ever drawn. Give the drawer its own side session (a separate ACP session on the same agent process, or a second short-lived process; a separate message history for OpenAI-compatible/HTTP) so drawing never touches the user's conversation, and drop the Claude-Code-only gate.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] With the Brain set to an ACP agent (fake agent in tests), a first-time tool gets drawn in the background and the user's next follow-up still resumes their own conversation session (assert session ids)
- [x] Same for OpenAI-compatible and HTTP providers (separate history)
- [x] The ACP permission test in test/brain.test.ts and every other existing test stay green; full `bun test`, `tsc`, contract suite green

Notes: `AskRequest.side` (brain.ts): ACP opens a separate session on the same agent process (per-session turn state, so concurrent conversation/side asks never mix text or tools); OpenAI-compatible uses a one-message history; HTTP sends fresh with no session id. Animations passes `side: true`; `canDraw` and its core.ts gate removed. Claude Code already ran each ask in its own process. Not verified against a real opencode/deepseek agent.
