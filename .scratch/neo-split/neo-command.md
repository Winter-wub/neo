# neo command — surface (draft from ticket "What is the neo command's surface?")

Grammar: `neo <noun> <verb> [args] [flags]`. Human-readable (markdown) output by default; `--json` gives a stable JSON shape for Neo Console. Neo Console always passes `--json`.

Transport: Unix socket `NEO_HOME/neo.sock` (see the transport ticket). Global flags: `--json`, `--home <dir>` (NEO_HOME), `-q/--quiet`.

Exit codes: `0` ok · `1` couldn't do it (bad time, ambiguous match, conflict) · `2` usage error · `3` Neo daemon not running. Thai message on stderr; with `--json` also `{"error": "...", "code": n}` on stdout.

## Talking to Neo

| Command | Does | Replaces |
|---|---|---|
| `neo say "<text>" [--no-wait]` | Same path as speech (wake word, confirm, pet commands apply). Waits for the resulting card / error / cancel and prints it; a confirm card prints the question and exits 0. `--no-wait` returns at once (Neo Console uses it; it already watches events). | `POST /api/say` |
| `neo cancel` | Cancel the work in progress | `POST /api/cancel` (socket only; not on port 8000) |
| `neo events [--history] [--json]` | Long-running stream. `--history` first replays the backlog (≤400). Includes a `status` event whenever phone/consoles/provider/thinking change, so nothing polls. | `GET /api/events`, `/api/history`, `/api/status` polling |
| `neo status` | One-shot snapshot (phone connected, brain, model, thinking, pet) | `GET /api/status` |

## Scheduled jobs (`jobs.md`)

| Command | Does |
|---|---|
| `neo jobs list` | Jobs with next run |
| `neo jobs parse "<speech>"` | Parse a sentence into a draft job without adding it (Neo Console's preview) |
| `neo jobs add "<speech>"` | Natural language ("ปลุกพรุ่งนี้ตีห้าครึ่ง"); prints the parsed job, `--yes` to add without the preview |
| `neo jobs add --kind alarm\|task --title … [--prompt …] (--at "YYYY-MM-DD HH:mm" \| --cron "m h dom mon dow")` | Detailed add |
| `neo jobs edit <id\|name> [--title] [--prompt] [--at\|--cron]` | Edit one job; no flags → open `jobs.md` in `$EDITOR` |
| `neo jobs on\|off <id\|name>` | Enable / disable |
| `neo jobs rm <id\|name>` · `neo jobs clear [--kind]` | Remove |
| `neo jobs test <id\|name>` | Fire now |
| `neo alarm stop` · `neo alarm snooze <min>` | Stop / snooze the ringing alarm |

## Memory, dreams, journal (markdown files)

| Command | Does |
|---|---|
| `neo memory show` | Print `memory.md` (each item marked if it came from a dream) |
| `neo memory edit` | Open `memory.md` in `$EDITOR`; save is refused if the file changed meanwhile |
| `neo memory add "<text>" [--section …]` | Append one item |
| `neo memory forget "<text>" [--all]` | One match → removed; several → list them, exit 1, unless `--all` |
| `neo memory clear` | Empty it |
| `neo dream now` · `neo dream on\|off` | Dream now / allow dreaming when away |
| `neo dream list` · `neo dream show <id>` · `neo dream rm <id>` · `neo dream clear` | Dream files (`dreams/<YYYY-MM-DD-HHmm>.md`) |
| `neo dream status` | Last dream, why/why not now, quiet hours, 24-h activity |
| `neo journal list` · `neo journal show [<day>]` · `neo journal edit <day>` | Day files (`journal/<YYYY-MM-DD>.md`) |
| `neo journal forget "<text>" [--all]` · `neo journal clear` | Remove entries |

## Pet

| Command | Does |
|---|---|
| `neo pet` | Hunger / affection |
| `neo pet feed [fish\|cookie\|milk]` | Feed |
| `neo pet sleep` | Deep sleep (mic off, tap to wake, dream after 15 min) |
| `neo name` · `neo name set <name> [--variants a,b]` · `neo name train <name>` · `neo name train --cancel` | Pet name and wake word |
| `neo face` · `neo face set [--fg] [--accent] [--cheek] [--bg]` | Face colours |

## Brain

| Command | Does |
|---|---|
| `neo provider list` · `neo provider use <name>` · `neo provider discover` | Choose / rediscover brains |
| `neo provider config [<name>]` · `neo provider config set <name> --file cfg.json [--api-key-stdin]` · `neo provider config rm <name>` | Custom providers |
| `neo model list [--provider]` · `neo model use <model>` | Models |

## Phone and devices

| Command | Does |
|---|---|
| `neo devices list` · `neo devices pair` · `neo devices revoke <id>` | Pairing (`pair` prints the code, addresses, expiry; `list` shows last seen) |
| `neo phone audio <file.wav\|->` | Act as a phone: stream audio as if spoken into the phone |
| `neo phone tap` · `neo phone wake` · `neo phone pet <hunger> <affection>` · `neo phone dream-seen` · `neo phone alarm-stop [--snooze <min>]` | Act as a phone for the other phone-only calls |

## Setup and the daemon

| Command | Does |
|---|---|
| `neo settings` · `neo settings set <key> <value>` | requireName, followUp, bypass, tailscale, lan, idle.sleepAfter, idle.clock, dream, onboarded |
| `neo doctor [--fix stt]` | Health checks (claude, stt: helper + Speech permission + th-TH on-device model, network, agents, phone, bad `jobs.md` lines) |
| `neo daemon run\|install\|start\|stop\|restart\|status\|logs [-f]\|uninstall` | Lifecycle — see [the lifecycle ticket](issues/06-daemon-lifecycle.md) |
| `neo mcp` | Internal: agents MCP server over stdio (used by the brain) |
