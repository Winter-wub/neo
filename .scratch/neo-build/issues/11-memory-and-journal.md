# 11: Memory and journal

**What to build:** What Neo keeps about the user is markdown: `memory.md` (sections + items) used as context for every ask, and a per-day `journal/` recording each question and answer. Exposed as `neo memory show|edit|add|forget|clear` and `neo journal list|show|edit|forget|clear`, with conflict-checked saves and file watching so edits in an editor take effect. Source: spec §6, surface ticket.

**Blocked by:** 04 Type a question, get a card

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] An item added with `neo memory add` shows up in the context of the next ask (visible in the fake `claude` prompt)
- [x] `neo memory forget "<text>"` with several matches lists them and exits 1 unless `--all`
- [x] `neo memory edit` refuses to save if the file changed meanwhile
- [x] Each answered `neo say` appends to today's journal file

Carried over (from ticket 04): there is no hook yet to record turns into the journal, and Conversation uses a default memory text and pet name; wire Memory into Conversation's context and add the journal hook.

Done notes: journal grammar is documented at the top of `cli/src/core/memory/journal-doc.ts`; memory.md grammar in `memory-doc.ts`. Left for the dream ticket: dream marks in `neo memory show`, `dreams/`, `activity.json`, `understand(text)` fast phrases, journal trimming.
