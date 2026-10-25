# NeoCli modules — settled (ticket "How is NeoCli split into modules?")

Shape: a **core** that knows nothing about HTTP or the command line, wrapped by thin **adapters** (phone HTTP, neo command transport). Every module below sits in the core unless marked adapter.

```
            NeoApp (phone)                 neo command / Neo Console
                 │ HTTP /api/* + NDJSON           │ (transport: separate ticket)
        ┌────────▼────────┐              ┌────────▼────────┐
        │  Phone adapter  │              │ Command adapter │
        └───┬─────────┬───┘              └────────┬────────┘
   audio    │         │ taps, pet, seen           │ say, jobs, memory, …
      ┌─────▼───┐     │                           │
      │  Ears   │──transcripts──┐                 │
      └─────────┘               ▼                 ▼
                         ┌──────────────────────────────┐
                         │         Conversation         │──► Brain ──► (Claude CLI / ACP / OpenAI-compatible)
                         │ wake word, confirm, ringing, │
                         │ pet & schedule phrases       │──► Cards (pure)
                         └──┬──────┬──────┬──────┬──────┘
                            ▼      ▼      ▼      ▼
                         Jobs   Memory   Pet   Settings      Devices (pairing)
                            └──────┴──────┴──────┴──── all publish to ──► Events (history + fan-out)
```

| Module | Interface (gist) | Owns (NEO_HOME) | Seam for tests |
|---|---|---|---|
| **Ears** | `push(frame)`, `arm()` → emits transcripts (`heard`, `rec`, `nothing`) | — (temp audio) | STT adapter (`neo-stt` Swift helper over stdio ↔ fake STT) |
| **Conversation** | `hear(text, at)`, `tap()`, `cancel()`, `confirm/deny` → events | — (in-memory turn state) | uses fake Brain + fake Clock |
| **Brain** | `ask(question, context) → Answer` where `Answer = card \| schedule intent \| weather intent \| skill intent \| error`; `listProviders/useProvider/models` | `providers.json`, provider keys | Brain adapters per provider ↔ fake Brain |
| **Weather** | `understand(text)`, `forecast(place, day) → card` (open-meteo + place lookup); also serves the Brain's weather intent | — | fake Clock; network not faked |
| **Cards** | `humanize(card)`, `pixelArt(card)` (pure) | — | none needed (pure) |
| **Jobs** | `add/edit/remove/list`, `understand(text)`, fires `alarm`/`task` on the clock, **owns the ringing alarm** (ring, snooze, stop, the words heard while ringing); reloads on file change | `jobs.md` | fake Clock |
| **Memory** | `record(q, a)`, `doc()/save(doc, since)`, `forget(text)`, `dream(reason)`, `status()`; learns away-hours; dreams when due | `memory.md`, `dreams/*.md`, `journal/*.md`, `activity.json` | fake Clock + fake Brain |
| **Pet** | `understand(text)`, `feed`, `report(h, a)`, **owns sleep** incl. deep sleep (mic off, asks Memory to dream after 15 min), `wake` | `pet` in state | fake Clock |
| **Settings** | `get/set`, pet name + wake variants, face | `state.json` | — (temp dir) |
| **Devices** | `startPairing()`, `pair(code, name)`, `check(request) → access` (the single home of access rules for the Phone adapter), `revoke(id)` | `devices.json` | fake Clock |
| **Events** | `publish(ev)`, `subscribe(fromHistory)` | — (in-memory, ≤400) | — |
| **Phone adapter** | HTTP `/api/*` + NDJSON exactly as [contract.md](contract.md) | — | real HTTP on a random port |
| **Command adapter** | the [neo command](neo-command.md) surface over the chosen transport | — | real transport |

Seams that really vary (two adapters each): **Clock**, **Brain**, **STT**, **process spawning** (real `claude`/agents ↔ fake binary). Files use real temp directories, not a fake filesystem.

## Rules settled with the user

- **Core + adapters.** The core never sees HTTP or argv; the Phone adapter and Command adapter translate.
- **Brain returns a typed `Answer`** (card | schedule intent | weather intent | skill intent | error). Brain only thinks; Conversation decides what happens next (confirm, fetch weather, add a job). Prompts live only in Brain.
- **Conversation builds the context** for each ask (pet name, memory, last 6 turns, now); Brain doesn't read Memory or Settings.
- **Fast phrases live with their owner.** Each module offers `understand(text) → action | null`; Conversation asks them in order, and only if none answers does it ask the Brain:
  ringing alarm (Jobs) → pending confirm/cancel (Conversation) → Pet → Jobs → Memory → Weather → Brain's provider switch → ask Brain.
- **Memory is one module**: memory, journal, dreams and away-hours learning share files and conflict checks.
- **Test seams**: Clock, Brain, STT, process spawning. Real temp directories for files; adapters tested against a real server on a random port; never spend Claude quota.
- **One protocol file** `cli/src/protocol.ts` defines every event and every request/response shape for both NeoApp and the neo command's `--json`.
- **Layout**: `cli/src/protocol.ts`, `cli/src/core/<module>/`, `cli/src/adapters/phone/`, `cli/src/adapters/command/`, `cli/src/main.ts` (`neo daemon run` and the other commands).
