# What is the neo command's surface?

Type: grilling
Status: resolved
Blocked by: 02

## Question

Which subcommands does the neo command expose, and in what shape, so that a person in a terminal and Neo Console use the exact same interface? Settle: the subcommand tree (e.g. `neo ask`, `neo say`, `neo events`, `neo jobs …`, `neo memory …`, `neo dream …`, `neo pet …`, `neo devices …`, `neo settings …`, `neo provider …`, `neo daemon …`); human output vs `--json`; how the live event stream is exposed for Neo Console; exit codes and error shape; which current Neo Console actions map to which subcommand.

## Answer

Settled with the user (2026-10-25). Full command tree: [neo-command.md](../neo-command.md).

- Grammar `neo <noun> <verb>` (gh/docker style). Human-readable markdown output by default; `--json` for Neo Console, which always passes it.
- Neo Console gets everything live from one long-running `neo events --json` (`--history` replays the backlog; a `status` event replaces 3-second polling).
- `neo say` waits and prints the resulting card (a confirm card prints the question and exits); `--no-wait` for Neo Console.
- Phone-only calls are included, grouped under `neo phone …` (audio from a file, tap, wake, pet report, dream-seen, alarm-stop); everyday `neo alarm stop|snooze` also exists.
- Exit codes: 0 ok, 1 couldn't do it, 2 usage, 3 daemon not running; Thai message on stderr, plus `{error, code}` on stdout with `--json`.
- **Storage becomes human-editable markdown** for memory (`memory.md`), dreams (one file each, `dreams/YYYY-MM-DD-HHmm.md`, id = file name), journal (one file per day, `journal/YYYY-MM-DD.md`) and scheduled jobs (`jobs.md`: one heading per job with a short `{#id}`; refer by id or unique name). Settings, devices, pet state stay JSON.
- Memory is edited as a whole (`neo memory edit` in `$EDITOR`), plus `add` / `forget "<text>"` (several matches → list them and exit 1 unless `--all`). A save is refused if the file changed meanwhile; dreams check the same way before writing.
- The Neo daemon watches the markdown files and reloads on direct edits (Obsidian, VS Code); a bad `jobs.md` keeps the previous jobs, emits a warning event, and `neo doctor` shows the bad line.
- Where a memory item came from lives in the dream file's "memory changes" (+/−) section; `memory.md` stays clean.
