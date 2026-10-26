# 30: Rename the pet by voice

**What to build:** The user can rename Neo's pet by talking to it, e.g. "John เปลี่ยนชื่อเป็นมิว" / "John ต่อไปนี้ชื่อมิวนะ" / "ตั้งชื่อใหม่ว่ามิว". It is a fast phrase (handled before the Brain, owned by Pet):
1. Neo shows a confirm card "เปลี่ยนชื่อเป็น "มิว" ใช่ไหม" (the existing 30 s confirm window; "ตกลง/ใช่" confirms, "ไม่/ยกเลิก" cancels).
2. On confirm it starts wake-word training for the new name (the same training as `neo name train`): the card asks the user to say "มิว" 3 times, with the progress shown (train events); the old name keeps waking Neo until training finishes.
3. After the third take the new name and its heard variants are saved, a happy card introduces itself with the new name, and every later prompt/card uses it. Saying "ยกเลิก" during training cancels and keeps the old name.
If the phrase has no name ("เปลี่ยนชื่อหน่อย") Neo asks "อยากให้ชื่ออะไร" and the next utterance (within the follow-up window) is taken as the name. Speech-to-text may mangle the name: show what was heard in the confirm card so the user can say no.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The phrases above (and close variants) trigger the flow without asking the Brain; a normal sentence that merely contains "ชื่อ" (e.g. "คุณชื่ออะไร") does NOT
- [x] Confirm → training → saved; cancel at either step keeps the old name; the old name works until saved
- [x] Events/cards are the existing types (confirm card, train, wake, card) so NeoApp needs no change; Neo Console's name tab reflects it live
- [x] Unit tests with a fake clock and fake STT; `neo phone audio`/`neo say` end-to-end test; full `bun test`, `tsc`, contract suite green
