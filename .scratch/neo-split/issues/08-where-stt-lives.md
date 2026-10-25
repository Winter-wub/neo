# Where does Apple speech-to-text live?

Type: grilling
Status: resolved
Assignee: Winter-wub
Blocked by: 01, 09

## Question

Apple speech-to-text is not a NeoCli helper today: it is an HTTP server on port 8001 inside Neo Console (`app/mac/Sources/Core.swift:101-163`), holding Neo Console's Speech Recognition permission (see [contract.md](../contract.md) §6). With the Neo daemon now running on its own after Neo Console quits, where should speech-to-text live: stay in Neo Console (Neo goes deaf when Neo Console is closed), move to a small Swift helper app that NeoCli owns and launches (and which holds the permission), or something else? Depends on what the Bun research finds about TCC attribution for processes launched by a LaunchAgent.

## Answer

Settled with the user (2026-10-25).

- **Where:** a small Swift helper `neo-stt` bundled at `Neo Console.app/Contents/MacOS/neo-stt`, next to `neo`. It is part of NeoCli: the Neo daemon starts it and owns it. Transcription works the same whether Neo Console is open or not. `SpeechService` and port 8001 leave Neo Console.
- **Shape:** a long-lived child of the Neo daemon over stdio, one JSON line each way (`{wav path, hints}` → `{text}` / `{error}`). The daemon starts it at launch and restarts it if it dies. It opens no port.
- **Engine:** unchanged: `SFSpeechRecognizer` th-TH, on-device only, `taskHint .dictation`, contextual hints (wake-word variants plus Jira/Confluence/ยกเลิก/สภาพอากาศ). Errors 1110/203 mean empty text. `SpeechAnalyzer` is not used in this effort.
- **Dropped:** the whisper fallback, the ffmpeg normalize step, the `thaiOnly` filter, `MOCHI_STT` and `MOCHI_WHISPER_MODEL`. Whatever Apple transcribes goes straight on. ffmpeg and whisper-cli are no longer dependencies.
- **When transcription fails:** the existing `stterr` event, so NeoApp sees no protocol change. `neo doctor` checks that the helper runs, that Speech Recognition is authorised, and that the on-device th-TH model is present. The ffmpeg check goes.
- **Permission:** asked for during onboarding. Neo Console runs `neo doctor --fix stt`, which makes the helper call `requestAuthorization` while the user is at the Mac. If the user declines, a button opens the Speech Recognition pane in System Settings and the check runs again (same pattern as Full Disk Access). Neo Console's Info.plist carries `NSSpeechRecognitionUsageDescription`.
- **Accepted risks (not tested in advance):**
  1. The launchd permissions test only covered folders and Full Disk Access. We assume the Speech prompt for a helper spawned by the daemon also attaches to Neo Console. If it doesn't, the fallback is a nested helper .app holding its own permission.
  2. Removing ffmpeg normalisation and `thaiOnly` may lower accuracy on quiet A7 audio, or let non-Thai noise through to the Brain. Both are checked on the A7 checklist at cutover.
