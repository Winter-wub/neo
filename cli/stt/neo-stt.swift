// neo-stt: the Neo daemon's speech-to-text helper. Long-lived stdio child: one JSON line in, one JSON line out.
//   {"wav": "/path/seg.wav", "hints": ["นีโอ", …]}  →  {"text": "…"}  |  {"error": "…"}
//   {"op": "check"}                                 →  {"status": "authorized|denied|restricted|notDetermined", "onDevice": true}
//   {"op": "authorize"}                             →  same, after showing the Speech permission prompt if it was not answered yet
// SFSpeechRecognizer th-TH, on-device only (audio never leaves the Mac), `.dictation`, with contextual hints.
// Ported from the SpeechService in app/mac/Sources/Core.swift.
import Foundation
import Speech

let alwaysHints = ["Jira", "Confluence", "ยกเลิก", "สภาพอากาศ"]

func statusName(_ s: SFSpeechRecognizerAuthorizationStatus) -> String {
  switch s {
  case .authorized: return "authorized"
  case .denied: return "denied"
  case .restricted: return "restricted"
  case .notDetermined: return "notDetermined"
  @unknown default: return "unknown"
  }
}

func thai() -> SFSpeechRecognizer? { SFSpeechRecognizer(locale: Locale(identifier: "th-TH")) }

func permission(_ status: SFSpeechRecognizerAuthorizationStatus) -> [String: Any] {
  ["status": statusName(status), "onDevice": thai()?.supportsOnDeviceRecognition ?? false]
}

func authorize() -> SFSpeechRecognizerAuthorizationStatus {
  let done = DispatchSemaphore(value: 0)
  var result = SFSpeechRecognizer.authorizationStatus()
  SFSpeechRecognizer.requestAuthorization { status in result = status; done.signal() }
  done.wait()
  return result
}

func transcribe(wav: String, hints: [String]) -> [String: Any] {
  let status = SFSpeechRecognizer.authorizationStatus()
  guard status == .authorized else { return ["error": "ยังไม่ได้อนุญาต Speech Recognition (\(statusName(status))) — รัน neo doctor --fix stt"] }
  guard let rec = thai(), rec.supportsOnDeviceRecognition else { return ["error": "ไม่มีตัวถอดเสียงไทยบนเครื่อง"] }
  let req = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: wav))
  req.requiresOnDeviceRecognition = true
  req.shouldReportPartialResults = false
  req.taskHint = .dictation
  req.contextualStrings = hints + alwaysHints
  let done = DispatchSemaphore(value: 0)
  var reply: [String: Any] = ["text": ""]
  var finished = false
  let task = rec.recognitionTask(with: req) { result, error in
    if finished { return }
    if let r = result, r.isFinal { finished = true; reply = ["text": r.bestTranscription.formattedString]; done.signal(); return }
    if let e = error as NSError? {
      finished = true
      // 1110 / 203: no speech found
      if e.domain == "kAFAssistantErrorDomain" && (e.code == 1110 || e.code == 203) { reply = ["text": ""] }
      else { reply = ["error": "\(e.localizedDescription)"] }
      done.signal()
    }
  }
  if done.wait(timeout: .now() + 25) == .timedOut { task.cancel(); return ["error": "ถอดเสียงนานเกินไป"] }
  return reply
}

func send(_ object: [String: Any]) {
  let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{\"error\":\"encode\"}".utf8)
  FileHandle.standardOutput.write(data + Data("\n".utf8))
}

// The recogniser delivers its callbacks on the main queue, so main must stay free: requests are read on a background thread.
Thread.detachNewThread {
  while let line = readLine() {
    guard let data = line.data(using: .utf8), let req = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      send(["error": "คำขอไม่ใช่ JSON"]); continue
    }
    switch req["op"] as? String {
    case "check": send(permission(SFSpeechRecognizer.authorizationStatus()))
    case "authorize": send(permission(authorize()))
    default:
      guard let wav = req["wav"] as? String else { send(["error": "ไม่มี wav"]); continue }
      send(transcribe(wav: wav, hints: req["hints"] as? [String] ?? []))
    }
  }
  exit(0) // stdin closed: the daemon is gone
}
RunLoop.main.run()
