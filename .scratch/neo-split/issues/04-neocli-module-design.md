# How is NeoCli split into modules?

Type: grilling
Status: resolved
Blocked by: 02

## Question

What are NeoCli's deep modules and their interfaces, designed fresh rather than mirroring `app/*.js`? Candidates seen today: the voice dialog (wake word, confirm), the brain (providers, Claude/ACP runners, prompts), cards (humanize, pixel art), scheduler, dreamer/memory, pet state, pairing/devices, phone link (audio in, events out), settings/state store. Decide the boundaries, which module owns which NEO_HOME file, and where the seams for testing (fake brain, fake clock, fake phone) sit.

Context from "What is the neo command's surface?": memory, dreams, journal and jobs are stored as markdown files (`memory.md`, `dreams/*.md`, `journal/*.md`, `jobs.md`) that the daemon watches and reloads, with conflict-checked saves; settings, devices and pet state stay JSON. Module design must own parsing/writing these.

## Answer

Settled with the user (2026-10-25). Asset: [neocli-modules.md](../neocli-modules.md).

- Core + thin adapters (Phone adapter for `/api/*` + NDJSON, Command adapter for the neo command). Core modules: Ears, Conversation, Brain, Weather, Cards, Jobs, Memory, Pet, Settings, Devices, Events.
- Brain returns a typed Answer; Conversation builds the context and decides the follow-up.
- Each module owns its Thai fast phrases via `understand(text)`, asked in a fixed order before the Brain.
- Jobs owns the ringing alarm; Pet owns sleep and deep sleep; Memory (memory + journal + dreams + away-hours) is one module; Devices is the single home of access rules.
- File ownership: Jobs → `jobs.md`; Memory → `memory.md`, `dreams/`, `journal/`, `activity.json`; Brain → `providers.json` + keys; Settings → `state.json` (pet state inside it, written via Pet); Devices → `devices.json`.
- Test seams: Clock, Brain, STT, process spawning; real temp dirs; adapters tested on a real random-port server.
- `cli/src/protocol.ts` is the single definition of events and request/response shapes.
