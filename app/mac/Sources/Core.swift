// แกนของ Neo.app: เปิด server (node ในแอป), ตัวถอดเสียงของ Apple (127.0.0.1:8001), เรียก API, รับ event สด
import AppKit
import AVFoundation
import Foundation
import Network
import Speech

enum Paths {
  static let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Neo")
  static let tasks = support.appendingPathComponent("tasks")
  static let logs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Neo")
  static let serverLog = logs.appendingPathComponent("server.log")
  static let resources = Bundle.main.resourceURL!
  static let node = resources.appendingPathComponent("node")
  static let server = resources.appendingPathComponent("server")
  static let apk = resources.appendingPathComponent("neo.apk")

  /// ครั้งแรก: สร้างโฟลเดอร์ + ย้ายค่าตั้งจากเวอร์ชันก่อน (~/.config/neo, providers.json ใน repo) + providers.json เริ่มต้น
  static func prepare() {
    let fm = FileManager.default
    for d in [support, tasks, logs] { try? fm.createDirectory(at: d, withIntermediateDirectories: true) }
    try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: support.path)
    let old = fm.homeDirectoryForCurrentUser.appendingPathComponent(".config/neo")
    if let files = try? fm.contentsOfDirectory(atPath: old.path) {
      for f in files where !fm.fileExists(atPath: support.appendingPathComponent(f).path) { try? fm.copyItem(at: old.appendingPathComponent(f), to: support.appendingPathComponent(f)) }
    }
    let providers = support.appendingPathComponent("providers.json")
    if !fm.fileExists(atPath: providers.path) {
      if let repo = Bundle.main.object(forInfoDictionaryKey: "NeoRepo") as? String, fm.fileExists(atPath: repo + "/app/providers.json") {
        try? fm.copyItem(atPath: repo + "/app/providers.json", toPath: providers.path) // ค่าที่ผู้ใช้ตั้งไว้ตอนพัฒนา
      } else { try? fm.copyItem(at: server.appendingPathComponent("providers.default.json"), to: providers) }
    }
    if !fm.fileExists(atPath: serverLog.path) { fm.createFile(atPath: serverLog.path, contents: nil) }
  }
}

func appLog(_ s: String) {
  let line = ISO8601DateFormatter().string(from: Date()) + " [app] " + s + "\n"
  if let h = try? FileHandle(forWritingTo: Paths.serverLog) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
}

/// แอปที่เปิดจาก Finder ไม่ได้ PATH ของ shell (ต้องใช้หา claude / agent อื่น) → ถาม login shell ครั้งเดียว
let userPath: String = {
  let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/zsh"); p.arguments = ["-lic", "echo __NEO__$PATH"]
  let out = Pipe(); p.standardOutput = out; p.standardError = FileHandle.nullDevice
  try? p.run(); p.waitUntilExit()
  let s = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  let path = s.components(separatedBy: "__NEO__").last?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  let home = FileManager.default.homeDirectoryForCurrentUser.path
  return (path.isEmpty ? "/usr/bin:/bin" : path) + ":\(home)/.local/bin:/opt/homebrew/bin:/usr/local/bin"
}()

// ---------- server.js ----------
final class ServerSupervisor {
  static let port = 8000
  let token = (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined() // เฉพาะรอบนี้ — เว็บในเบราว์เซอร์ไม่รู้
  private var proc: Process?
  private var wanted = true
  var onExit: (() -> Void)?

  /// ปิด server ตัวอื่นที่ยึดพอร์ต (เวอร์ชันเก่าที่เปิดจาก terminal) แล้วเปิดของแอปเอง
  func start() {
    wanted = true
    killPortOwner()
    let p = Process()
    p.executableURL = Paths.node
    p.arguments = [Paths.server.appendingPathComponent("server.js").path]
    p.currentDirectoryURL = Paths.server
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = userPath
    env["NEO_HOME"] = Paths.support.path
    env["NEO_PROVIDERS"] = Paths.support.appendingPathComponent("providers.json").path
    env["NEO_TASKS"] = Paths.tasks.path
    env["NEO_APK"] = Paths.apk.path
    env["NEO_APP_TOKEN"] = token
    for k in ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"] { env.removeValue(forKey: k) }
    p.environment = env
    let h = try? FileHandle(forWritingTo: Paths.serverLog); h?.seekToEndOfFile()
    p.standardOutput = h; p.standardError = h
    p.terminationHandler = { [weak self] t in
      appLog("server ปิดตัว (\(t.terminationStatus))")
      DispatchQueue.main.asyncAfter(deadline: .now() + 3) { if self?.wanted == true { self?.start() } } // ล่มแล้วเปิดใหม่
    }
    do { try p.run(); proc = p; appLog("เปิด server pid \(p.processIdentifier)") } catch { appLog("เปิด server ไม่ได้: \(error)") }
  }

  func restart() { proc?.terminationHandler = nil; proc?.terminate(); proc = nil; DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.start() } }
  func stop() { wanted = false; proc?.terminate() }

  private func killPortOwner() {
    let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof"); p.arguments = ["-tiTCP:\(Self.port)", "-sTCP:LISTEN"]
    let o = Pipe(); p.standardOutput = o; try? p.run(); p.waitUntilExit()
    for pid in (String(data: o.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "").split(separator: "\n").compactMap({ Int32($0) }) where pid != proc?.processIdentifier {
      kill(pid, SIGTERM); appLog("ปิด server เดิม pid \(pid)")
    }
    usleep(400_000)
  }
}

// ---------- ตัวถอดเสียงของ Apple (on-device เท่านั้น) — server.js เรียกที่ 127.0.0.1:8001 ----------
final class SpeechService {
  private var listener: NWListener?
  private(set) var authorized = false

  func start() {
    SFSpeechRecognizer.requestAuthorization { status in
      self.authorized = status == .authorized
      appLog("speech authorization: \(status.rawValue) (3 = อนุญาต)")
      guard self.authorized else { return }
      let params = NWParameters.tcp
      params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: 8001)
      self.listener = try? NWListener(using: params)
      self.listener?.newConnectionHandler = { c in c.start(queue: .global()); self.handle(c) }
      self.listener?.start(queue: .global())
    }
  }

  private func transcribe(_ wav: Data, hints: [String]) async throws -> String {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("neo-\(UUID().uuidString).wav")
    try wav.write(to: url); defer { try? FileManager.default.removeItem(at: url) }
    guard let rec = SFSpeechRecognizer(locale: Locale(identifier: "th-TH")), rec.supportsOnDeviceRecognition else { throw NSError(domain: "neo", code: 4, userInfo: [NSLocalizedDescriptionKey: "ไม่มีตัวถอดเสียงไทยบนเครื่อง"]) }
    let req = SFSpeechURLRecognitionRequest(url: url)
    req.requiresOnDeviceRecognition = true // เสียงไม่ออกนอกเครื่อง
    req.shouldReportPartialResults = false
    req.taskHint = .dictation
    req.contextualStrings = hints + ["Jira", "Confluence", "ยกเลิก", "สภาพอากาศ"]
    return try await withCheckedThrowingContinuation { cont in
      var done = false
      rec.recognitionTask(with: req) { result, error in
        if done { return }
        if let r = result, r.isFinal { done = true; cont.resume(returning: r.bestTranscription.formattedString); return }
        if let e = error as NSError? {
          done = true
          if e.domain == "kAFAssistantErrorDomain" && (e.code == 1110 || e.code == 203) { cont.resume(returning: "") } else { cont.resume(throwing: e) }
        }
      }
    }
  }

  private func respond(_ c: NWConnection, _ code: Int, _ obj: [String: Any]) {
    let body = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
    var head = "HTTP/1.1 \(code) OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n".data(using: .utf8)!
    head.append(body); c.send(content: head, completion: .contentProcessed { _ in c.cancel() })
  }

  private func handle(_ c: NWConnection, _ buf: Data = Data()) {
    c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { data, _, done, err in
      var b = buf; if let d = data { b.append(d) }
      guard let sep = b.range(of: Data("\r\n\r\n".utf8)) else { if done || err != nil || b.count > 8192 { c.cancel() } else { self.handle(c, b) }; return }
      let head = String(decoding: b[..<sep.lowerBound], as: UTF8.self), lines = head.components(separatedBy: "\r\n")
      let len = lines.compactMap { l -> Int? in let p = l.split(separator: ":", maxSplits: 1); return p.count == 2 && p[0].lowercased() == "content-length" ? Int(p[1].trimmingCharacters(in: .whitespaces)) : nil }.first ?? 0
      let body = b[sep.upperBound...]
      if body.count < len { if done || err != nil || len > 8_000_000 { c.cancel() } else { self.handle(c, b) }; return }
      let target = lines.first?.split(separator: " ").dropFirst().first.map(String.init) ?? ""
      guard target.hasPrefix("/stt") else { self.respond(c, 404, ["error": "not found"]); return }
      let hints = URLComponents(string: target)?.queryItems?.first(where: { $0.name == "hints" })?.value?.split(separator: ",").map(String.init) ?? []
      Task {
        do { self.respond(c, 200, ["text": try await self.transcribe(Data(body.prefix(len)), hints: hints)]) }
        catch { self.respond(c, 500, ["error": "\(error.localizedDescription)"]) }
      }
    }
  }
}

// ---------- เรียก API ของ server ----------
struct API {
  static var token = ""
  static let base = URL(string: "http://127.0.0.1:\(ServerSupervisor.port)")!

  static func call(_ path: String, _ body: Any? = nil, timeout: TimeInterval = 10) async -> Any? {
    var r = URLRequest(url: URL(string: path, relativeTo: base)!); r.timeoutInterval = timeout
    r.setValue(token, forHTTPHeaderField: "x-neo-token")
    if let b = body { r.httpMethod = "POST"; r.httpBody = try? JSONSerialization.data(withJSONObject: b) }
    guard let (d, _) = try? await URLSession.shared.data(for: r) else { return nil }
    return try? JSONSerialization.jsonObject(with: d)
  }
  static func dict(_ path: String, _ body: Any? = nil, timeout: TimeInterval = 10) async -> [String: Any]? { await call(path, body, timeout: timeout) as? [String: Any] }
  static func list(_ path: String) async -> [[String: Any]] { (await call(path) as? [[String: Any]]) ?? [] }
}

/// event สดจาก /api/events (บรรทัดละ JSON) — ต่อใหม่เองเมื่อหลุด
final class EventStream {
  var onEvent: (([String: Any]) -> Void)?
  var onState: ((Bool) -> Void)?
  func run() {
    Task.detached {
      while true {
        var r = URLRequest(url: API.base.appendingPathComponent("api/events")); r.timeoutInterval = 40
        if let (bytes, _) = try? await URLSession.shared.bytes(for: r) {
          await MainActor.run { self.onState?(true) }
          do {
            for try await line in bytes.lines {
              guard let d = line.data(using: .utf8), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any], (j["type"] as? String) != "ping" else { continue }
              await MainActor.run { self.onEvent?(j) }
            }
          } catch {}
        }
        await MainActor.run { self.onState?(false) }
        try? await Task.sleep(nanoseconds: 2_000_000_000)
      }
    }
  }
}
