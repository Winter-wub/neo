# 23: Claude Code over ACP keeps Neo's persona

**What to build:** With the Brain set to Claude Code (ACP) (`claude-acp`, model haiku), asking "John คุณชื่ออะไร" answers as John with a normal card, the same as the direct Claude Code provider does. Today the whole Neo prompt (persona, memory, tools, card format) is sent as the user's message on top of Claude Code's own system prompt, and haiku treats it as an injection: it answers "ฉันคือ Claude ไม่ใช่ John" in plain text (seen on the A7 after cutover, 2026-10-26). claude-agent-acp accepts `_meta.systemPrompt` on `session/new` (a string, or `{append: …}` kept on the `claude_code` preset — see its dist/acp-agent.js around "params._meta?.systemPrompt"), so the persona, memory, tool rules and card format can travel as an appended system prompt while `session/prompt` carries only what the user said. Also check that `bypass` actually reaches the ACP session (the running agent showed `--permission-mode default` with bypass on).

**Blocked by:** None (can start immediately)

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] For ACP agents, `session/new` carries the Neo persona + memory + tools + card format in `_meta.systemPrompt` (`{append}` form) and `session/prompt` carries just the user's turn; agents that ignore `_meta` still get today's behaviour (no regression for opencode)
- [x] A new conversation (fresh session) rebuilds the system prompt (memory, time, pet name may have changed); follow-ups reuse the session
- [x] With bypass on, the ACP session runs in the bypass permission mode (via `_meta`, `session/set_mode` or whatever claude-agent-acp supports); with bypass off, permission requests still go through Neo's voice confirm
- [x] Tests with the fake ACP agent assert the `_meta` shape and the shorter prompt; full `bun test`, `tsc` and `cd contract && bun run test:neocli` stay green

- [x] Small extra (found on the A7): the provider-switch card says "ต่อจากนี้ นีโอ ถาม …" because core never passes `petName` to the brain hub (hub.ts falls back to its PET constant); pass the real pet name.
- [x] Small extra (A7): the model-switch card is titled "โมเดล opencode/deepseek-v4.1-f" (cut at 16 chars) with just "OpenCode" as its line; title it with a short model name (e.g. "deepseek-v4.1-flash-free" trimmed sensibly, or just "เปลี่ยนโมเดล") and put the full id in lines.
