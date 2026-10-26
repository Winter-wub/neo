# 27: Neo draws and remembers an animation for each tool it uses

**What to build:** While the Brain uses a tool (an MCP tool, a skill, Bash, WebSearch…), the phone shows a small pixel animation for that exact tool instead of only the text label. Decided with the user 2026-10-26:
- One animation per **exact tool name** (e.g. `mcp__MCP_DOCKER__jira_search`, `Skill:mappedin-cms`, `Bash`, `WebSearch`; for `Skill` key on the skill name).
- The first time a tool is seen, the phone gets today's text label and Neo asks **the Brain in use** (provider + model at that moment) to draw one **in the background** — never slowing the answer. One generation at a time, queued; failures are logged and retried at most once later.
- Animations are kept in NEO_HOME (one small file per tool, human-readable, e.g. `animations/<safe-tool-key>.json` with name, label, w/h, palette, frames, fps, createdBy, at) and reused **until the user asks to change it**.
- Changing: `neo animation list | show <tool> | redo <tool> | rm <tool>`; by voice, a fast phrase like "วาดท่าใหม่"/"เปลี่ยนท่า" redoes the animation of the most recent tool used; the matching phone routes are added alongside ticket 24's.
- The `tool` event carries the stored animation (or none yet) so NeoApp can play it; keep the event backward compatible (old NeoApp ignores the new field).
- Drawing prompt: reuse the pixel-card rules (palette ≤12, 24×24 up to 48×32, 2–8 frames looping), plus "a tiny loop that shows <what this tool does> — no text"; validate the result like pixel cards and reject unreadable ones.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] First use of a tool: answer unaffected, an animation file appears afterwards (fake Brain in tests); second use: the `tool` event carries it
- [x] `neo animation list/show/redo/rm` work; "วาดท่าใหม่" after a tool run redoes that tool's animation and publishes an event
- [x] Generation is single-flight and never runs while the user's own ask is waiting on the same agent session (no interference with conversations)
- [x] Protocol + Protocol.kt regenerated; golden fixtures; full `bun test`, `tsc`, contract suite green

Notes: drawing only runs when Claude Code is the Brain in use (ACP / OpenAI-compatible / HTTP keep one conversation session that a drawing ask would replace); other providers queue until Claude Code is chosen. Needs a per-provider side session in acp.ts/plain.ts to lift this.
