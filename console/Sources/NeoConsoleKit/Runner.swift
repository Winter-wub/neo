import Foundation

public struct RunResult: Equatable {
  public var code: Int32
  public var stdout: String
  public var stderr: String
  public init(code: Int32, stdout: String = "", stderr: String = "") { self.code = code; self.stdout = stdout; self.stderr = stderr }
  public var ok: Bool { code == 0 }

  /// The Thai message of a failed `--json` call (`{error, code}` on stdout), else stderr, else the exit code.
  public var failureMessage: String {
    if let data = stdout.data(using: .utf8), let body = try? JSONDecoder().decode(ErrorBody.self, from: data) { return body.error }
    let err = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
    return err.isEmpty ? "neo ออกด้วยรหัส \(code)" : err
  }

  public func decode<T: Decodable>(_ type: T.Type) -> T? {
    stdout.data(using: .utf8).flatMap { try? JSONDecoder().decode(T.self, from: $0) }
  }
}

/// How Neo Console reaches NeoCli. The only implementation that matters is the neo command (ProcessRunner);
/// tests use a fake.
public protocol NeoRunner: AnyObject {
  /// `neo <args> --json --home <home>`, with `stdin` piped in (an API key) when given and `env` added to the child's environment.
  func run(_ args: [String], stdin: String?, env: [String: String]) async -> RunResult
  /// `neo events --json --history`: one StreamLine per line; finishes when the process ends (daemon stopped).
  func events() -> AsyncStream<StreamLine>
  /// Kill children (the events stream). Called on quit; never touches the daemon.
  func shutdown()
}

extension NeoRunner {
  public func run(_ args: [String]) async -> RunResult { await run(args, stdin: nil, env: [:]) }
  public func run(_ args: [String], stdin: String?) async -> RunResult { await run(args, stdin: stdin, env: [:]) }
}

public final class ProcessRunner: NeoRunner, @unchecked Sendable {
  let config: NeoConfig
  private let lock = NSLock()
  private var live: [Process] = []

  public init(config: NeoConfig) { self.config = config }

  private func makeProcess(_ args: [String], stdin: Pipe? = nil, env: [String: String] = [:]) -> Process {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: config.binary)
    p.arguments = args + ["--json", "--home", config.home]
    p.environment = config.childEnvironment.merging(env) { _, new in new }
    p.standardInput = stdin ?? FileHandle.nullDevice
    return p
  }

  public func run(_ args: [String], stdin: String?, env: [String: String]) async -> RunResult {
    let input = stdin.map { _ in Pipe() }
    let p = makeProcess(args, stdin: input, env: env)
    let out = Pipe(), err = Pipe()
    p.standardOutput = out
    p.standardError = err
    // drain both pipes while the child runs, or a chatty child fills the pipe and never exits
    let outTask = Task.detached { out.fileHandleForReading.readDataToEndOfFile() }
    let errTask = Task.detached { err.fileHandleForReading.readDataToEndOfFile() }
    // waitUntilExit can hang on a cooperative thread after the child is gone; use the termination handler
    let exited: Int32? = await withCheckedContinuation { cont in
      p.terminationHandler = { cont.resume(returning: $0.terminationStatus) }
      do { try p.run() } catch { cont.resume(returning: nil) }
      if let input, let stdin {
        input.fileHandleForWriting.write(Data(stdin.utf8))
        try? input.fileHandleForWriting.close()
      }
    }
    guard let code = exited else {
      try? out.fileHandleForWriting.close(); try? err.fileHandleForWriting.close() // let the readers finish
      return RunResult(code: 127, stderr: "เปิด neo ไม่ได้")
    }
    let (od, ed) = await (outTask.value, errTask.value)
    return RunResult(code: code, stdout: String(decoding: od, as: UTF8.self), stderr: String(decoding: ed, as: UTF8.self))
  }

  public func events() -> AsyncStream<StreamLine> {
    AsyncStream { continuation in
      let p = makeProcess(["events", "--history"])
      let out = Pipe()
      p.standardOutput = out
      p.standardError = FileHandle.nullDevice
      do { try p.run() } catch { continuation.finish(); return }
      lock.lock(); live.append(p); lock.unlock()
      let reader = Task.detached {
        var buffer = Data()
        let handle = out.fileHandleForReading
        while true {
          let chunk = handle.availableData
          if chunk.isEmpty { break }
          buffer.append(chunk)
          while let nl = buffer.firstIndex(of: 0x0A) {
            let line = buffer[buffer.startIndex..<nl]
            buffer.removeSubrange(buffer.startIndex...nl)
            if !line.isEmpty, let parsed = try? StreamLine.decode(Data(line)) { continuation.yield(parsed) }
          }
        }
        continuation.finish()
      }
      continuation.onTermination = { [weak self] _ in
        reader.cancel()
        if p.isRunning { p.terminate() }
        self?.lock.lock(); self?.live.removeAll { $0 === p }; self?.lock.unlock()
      }
    }
  }

  public func shutdown() {
    lock.lock(); let procs = live; live = []; lock.unlock()
    for p in procs where p.isRunning { p.terminate() }
  }
}
