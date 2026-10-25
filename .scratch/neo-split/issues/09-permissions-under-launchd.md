# Which app do macOS permissions attach to when launchd starts neo?

Type: task
Status: resolved
Blocked by:

## Question

Unverified by [the Bun research](../research/01-bun-compile-capabilities.md): when the compiled `neo` binary (nested and signed inside Neo Console's .app) is started by a LaunchAgent rather than as a child of the app, which identity do macOS permission prompts and grants (Full Disk Access, and whatever the `claude` CLI and agents it spawns touch) attach to — Neo Console, the bare binary, or nothing usable? Run the experiment on this Mac: build a signed test binary, load it as a LaunchAgent, trigger an FDA-protected read and a prompt, and record what macOS shows and where the grant lands; repeat with the fallback (the daemon wrapped in a small nested .app launched via SMAppService). HITL: the user has to click the permission prompts and look at System Settings. Record the outcome for both setups.

## Answer

Done on this Mac (macOS 27.0.1, Bun 1.4.2) on 2026-10-25, with the user clicking the prompts. Test app `NeoProbe.app` (Swift main executable + compiled Bun `neo` binary in `Contents/MacOS/`, Info.plist with folder usage strings, signed with the Apple Development team certificate, hardened runtime, allow-jit, fixed identifier). Probe source and raw results: [09-probe.ts](../research/09-probe.ts), [09-probe.log](../research/09-probe.log). Test app, agents and logs were removed afterwards.

| Setup | Folder prompts (Desktop/Documents/Downloads) | Full Disk Access | Child process (`ls`) |
|---|---|---|---|
| A — plist in `~/Library/LaunchAgents` pointing at the nested `neo` | Prompt named **NeoProbe** with the app's usage text; listed under NeoProbe in Files and Folders; works after Allow | Granted by adding **NeoProbe.app** to the FDA list → `neo` gets it | Inherits |
| A, rebuilt + re-signed with the same team cert | No new prompts; all grants kept | Kept | Inherits |
| A, re-signed **ad hoc** | Prompts again | **Lost** (EPERM) | — |
| B — `SMAppService.agent` (plist in `Contents/Library/LaunchAgents`, registered by the app) | "Background Items added" notification + prompts named **NeoProbe**; works after Allow | Needed the NeoProbe FDA switch toggled off/on after the ad hoc run had disturbed it, then granted | Inherits |

Facts for later tickets:
- Permissions attach to the **enclosing app** (its name, icon and usage strings), not to the bare binary, in both setups — so the Neo daemon nested in Neo Console's .app is covered by "allow Neo Console". No separate helper .app is needed for TCC.
- Grants survive rebuilds only with a **stable team signature**; ad hoc signing loses FDA and re-prompts, and leaves the old grant needing a toggle.
- SMAppService shows the user a Background Items notification and lists the agent under the app in Login Items; the plain plist does not go through that approval path.
- Leftover entries named "NeoProbe" may remain in System Settings (Files and Folders, Full Disk Access, Login Items); they're harmless and can be removed there.
