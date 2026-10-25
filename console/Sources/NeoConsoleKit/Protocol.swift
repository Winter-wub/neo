// Hand-written mirror of the parts of cli/src/protocol.ts that Neo Console reads.
// Decoding is lenient (missing optional fields are fine, unknown event types become .unknown);
// every golden fixture in cli/test/fixtures/ must decode (see FixtureTests).
import Foundation

public struct Pet: Codable, Equatable {
  public var hunger: Double
  public var affection: Double
  public var at: Double
}

/// `neo status --json` and the `status` event.
public struct Status: Codable, Equatable {
  public var phone: Bool
  public var consoles: Int
  public var provider: String
  public var model: String?
  public var thinking: Bool
  /// An alarm is ringing / a job is running (`busy`). Absent from older daemons.
  public var ringing: Bool?
  public var busy: Bool?
  public var requireName: Bool
  public var bypass: Bool
  public var pet: Pet?
  public var uptime: Int
  public var pid: Int

  /// Nothing in progress: safe to restart the daemon onto a newer version.
  public var idle: Bool { !thinking && ringing != true && busy != true }
}

/// `neo settings --json` and the `settings` event. Lenient: fields a daemon doesn't send stay at their defaults.
public struct Settings: Codable, Equatable {
  public struct Idle: Codable, Equatable {
    public var sleepAfter: Int
    public var clock: Bool
    public init(sleepAfter: Int = 150, clock: Bool = true) { self.sleepAfter = sleepAfter; self.clock = clock }
  }
  public struct Home: Codable, Equatable {
    public var city: String
    public var lat: Double
    public var lon: Double
  }
  public var requireName: Bool
  public var followUp: Bool
  public var bypass: Bool
  public var tailscale: Bool
  public var lan: Bool
  public var idle: Idle
  public var dream: Bool
  public var onboarded: Bool
  public var claudeConfigDir: String?
  public var home: Home?
  public var mcpServers: [String]?

  enum CodingKeys: String, CodingKey { case requireName, followUp, bypass, tailscale, lan, idle, dream, onboarded, claudeConfigDir, home, mcpServers }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    requireName = try c.decodeIfPresent(Bool.self, forKey: .requireName) ?? true
    followUp = try c.decodeIfPresent(Bool.self, forKey: .followUp) ?? true
    bypass = try c.decodeIfPresent(Bool.self, forKey: .bypass) ?? true
    tailscale = try c.decodeIfPresent(Bool.self, forKey: .tailscale) ?? true
    lan = try c.decodeIfPresent(Bool.self, forKey: .lan) ?? false
    idle = try c.decodeIfPresent(Idle.self, forKey: .idle) ?? Idle()
    dream = try c.decodeIfPresent(Bool.self, forKey: .dream) ?? true
    onboarded = try c.decodeIfPresent(Bool.self, forKey: .onboarded) ?? false
    claudeConfigDir = try c.decodeIfPresent(String.self, forKey: .claudeConfigDir)
    home = try c.decodeIfPresent(Home.self, forKey: .home)
    mcpServers = try c.decodeIfPresent([String].self, forKey: .mcpServers)
  }
  public init(requireName: Bool = true, followUp: Bool = true, bypass: Bool = true, tailscale: Bool = true, lan: Bool = false, idle: Idle = Idle(), dream: Bool = true, onboarded: Bool = false) {
    self.requireName = requireName; self.followUp = followUp; self.bypass = bypass; self.tailscale = tailscale; self.lan = lan
    self.idle = idle; self.dream = dream; self.onboarded = onboarded
  }
}

public struct Card: Codable, Equatable {
  public struct Item: Codable, Equatable {
    public var t: String
    public var v: String
  }
  public var kind: String
  public var layout: String
  public var icon: String
  public var title: String
  public var big: String?
  public var lines: [String]
  public var items: [Item]
  public var emotion: String
  public var sounds: [String]
  public var seconds: Int
  public var dream: Bool?
  public var w: Int?
  public var h: Int?
  public var palette: [String: String]?
  public var frames: [[String]]?
  public var fps: Int?

  enum CodingKeys: String, CodingKey { case kind, layout, icon, title, big, lines, items, emotion, sounds, seconds, dream, w, h, palette, frames, fps }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "text"
    layout = try c.decodeIfPresent(String.self, forKey: .layout) ?? "text"
    icon = try c.decodeIfPresent(String.self, forKey: .icon) ?? ""
    title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
    big = try c.decodeIfPresent(String.self, forKey: .big)
    lines = try c.decodeIfPresent([String].self, forKey: .lines) ?? []
    items = try c.decodeIfPresent([Item].self, forKey: .items) ?? []
    emotion = try c.decodeIfPresent(String.self, forKey: .emotion) ?? "neutral"
    sounds = try c.decodeIfPresent([String].self, forKey: .sounds) ?? []
    seconds = try c.decodeIfPresent(Int.self, forKey: .seconds) ?? 20
    dream = try c.decodeIfPresent(Bool.self, forKey: .dream)
    w = try c.decodeIfPresent(Int.self, forKey: .w)
    h = try c.decodeIfPresent(Int.self, forKey: .h)
    palette = try c.decodeIfPresent([String: String].self, forKey: .palette)
    frames = try c.decodeIfPresent([[String]].self, forKey: .frames)
    fps = try c.decodeIfPresent(Int.self, forKey: .fps)
  }
}

public struct Face: Codable, Equatable {
  public var fg: String
  public var accent: String
  public var cheek: String
  public var bg: String
  public static let mint = Face(fg: "#7fffd4", accent: "#ff7aa8", cheek: "#ff9a9a", bg: "#000000")

  /// The themes offered in Settings › หน้าตา (same as the old Neo Console).
  public static let presets: [(name: String, face: Face)] = [
    ("มิ้นต์", mint),
    ("อำพัน", Face(fg: "#ffb347", accent: "#ff5e5e", cheek: "#ff9a76", bg: "#000000")),
    ("ฟ้าน้ำแข็ง", Face(fg: "#7fd4ff", accent: "#ff8ac2", cheek: "#ffaacc", bg: "#000814")),
    ("ซากุระ", Face(fg: "#ffb7d5", accent: "#ff4f8b", cheek: "#ff9ab8", bg: "#120008")),
    ("คลาสสิก", Face(fg: "#f2f2f2", accent: "#ff6b81", cheek: "#ff9aa8", bg: "#000000")),
    ("จอเขียวยุค 80", Face(fg: "#39ff14", accent: "#ffd400", cheek: "#ff8c42", bg: "#001100")),
    ("ลาเวนเดอร์", Face(fg: "#c3a6ff", accent: "#ff7ab8", cheek: "#ffa3c9", bg: "#0b0614")),
    ("มะนาว", Face(fg: "#d4ff4f", accent: "#ff6f91", cheek: "#ffb199", bg: "#0a0f00")),
  ]
}

public struct Hello: Codable, Equatable {
  public struct Idle: Codable, Equatable {
    public var sleepAfter: Int
    public var clock: Bool
  }
  public var thinking: Bool
  public var provider: String
  public var name: String
  public var face: Face
  public var idle: Idle
  public var ringing: String?
}

public struct PairAddress: Codable, Equatable {
  public var method: String
  public var url: String
  public var note: String
}

public struct PairStart: Codable, Equatable {
  public var code: String
  public var expiresAt: Double
  public var addresses: [PairAddress]
}

public struct DeviceInfo: Codable, Equatable, Identifiable {
  public var id: String
  public var name: String
  public var paired: String
  public var lastSeen: String?
}

public struct ErrorBody: Codable, Equatable {
  public var error: String
  public var code: Int
}

public enum SayResult: Equatable, Decodable {
  case card(Card)
  case error(String)
  case cancelled
  case heard(armed: Bool)
  case accepted

  enum CodingKeys: String, CodingKey { case outcome, card, error, armed }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(String.self, forKey: .outcome) {
    case "card": self = .card(try c.decode(Card.self, forKey: .card))
    case "error": self = .error(try c.decode(String.self, forKey: .error))
    case "cancelled": self = .cancelled
    case "heard": self = .heard(armed: try c.decodeIfPresent(Bool.self, forKey: .armed) ?? false)
    case "accepted": self = .accepted
    case let other: throw DecodingError.dataCorruptedError(forKey: .outcome, in: c, debugDescription: "unknown outcome \(other)")
    }
  }
}

/// `neo daemon status --json`
public struct DaemonStatus: Codable, Equatable {
  public struct Plist: Codable, Equatable {
    public var path: String
    public var binary: String?
    public var current: Bool
  }
  public struct Symlink: Codable, Equatable {
    public var path: String
    public var target: String?
    public var current: Bool
  }
  public struct Logs: Codable, Equatable {
    public var daemon: String
    public var crash: String
  }
  public var label: String
  public var installed: Bool
  public var loaded: Bool
  public var running: Bool
  public var pid: Int?
  public var version: String?
  public var build: String?
  public var protocolVersion: Int?
  public var binary: String
  public var plist: Plist
  public var symlink: Symlink
  public var home: String
  public var logs: Logs

  enum CodingKeys: String, CodingKey {
    case label, installed, loaded, running, pid, version, build, binary, plist, symlink, home, logs
    case protocolVersion = "protocol"
  }
}

// MARK: - events

public enum EventKind: Equatable {
  case status(Status)
  case settings(Settings)
  case heard(text: String)
  case ignored(text: String)
  case armed
  case thinking(text: String)
  case session(fresh: Bool, turn: Int, provider: String)
  case tool(name: String, input: String)
  case card(Card)
  case askerr(error: String)
  case cancelled
  case paired(name: String)
  case devices
  /// Heard a sound that wasn't speech / speech-to-text failed (phone audio path).
  /// A NEO_HOME file (memory, jobs, ...) was edited; panes refresh on it (screens ticket).
  case changed(file: String)
  case nothing
  case stterr(error: String)
  /// State changed by `neo` from anywhere (face, wake name, provider, model, idle, training, jobs): not log lines,
  /// but the Settings tabs re-read on them. `type` is the event type.
  case state(type: String)
  /// The face colours changed (here, in Terminal or on another Console).
  case face(Face)
  /// Event types this build doesn't know (the daemon may be newer). Kept so the log can still show something.
  case unknown(type: String)
}

public struct NeoEvent: Equatable {
  public var at: Date
  public var kind: EventKind
}

/// Event types that only say "something you may be showing changed". Never log lines.
let stateEvents: Set<String> = ["wake", "idle", "provider", "model", "train", "jobs", "jobs_warning"]

/// One line of `neo events --json`.
public enum StreamLine: Equatable {
  case ping
  case hello(Hello)
  case event(NeoEvent)

  public static func decode(_ data: Data) throws -> StreamLine {
    let decoder = JSONDecoder()
    let head = try decoder.decode(Head.self, from: data)
    func event(_ kind: EventKind) -> StreamLine { .event(NeoEvent(at: Date(timeIntervalSince1970: (head.at ?? 0) / 1000), kind: kind)) }
    switch head.type {
    case "ping": return .ping
    case "hello": return .hello(try decoder.decode(Hello.self, from: data))
    case "status": return event(.status(try decoder.decode(Status.self, from: data)))
    case "settings": return event(.settings(try decoder.decode(Settings.self, from: data)))
    case "heard": return event(.heard(text: try decoder.decode(Text.self, from: data).text))
    case "ignored": return event(.ignored(text: try decoder.decode(Text.self, from: data).text))
    case "armed": return event(.armed)
    case "thinking": return event(.thinking(text: try decoder.decode(Text.self, from: data).text))
    case "session":
      let s = try decoder.decode(Session.self, from: data)
      return event(.session(fresh: s.fresh, turn: s.turn, provider: s.provider))
    case "tool":
      let t = try decoder.decode(Tool.self, from: data)
      return event(.tool(name: t.name, input: t.input))
    case "card": return event(.card(try decoder.decode(CardBody.self, from: data).card))
    case "askerr": return event(.askerr(error: try decoder.decode(Err.self, from: data).error))
    case "cancelled": return event(.cancelled)
    case "paired": return event(.paired(name: try decoder.decode(Named.self, from: data).name))
    case "devices": return event(.devices)
    case "changed": return event(.changed(file: try decoder.decode(Changed.self, from: data).file))
    case "nothing": return event(.nothing)
    case "face": return event(.face(try decoder.decode(Face.self, from: data)))
    case "stterr": return event(.stterr(error: (try? decoder.decode(Err.self, from: data).error) ?? "ถอดเสียงไม่สำเร็จ"))
    case let type where stateEvents.contains(type): return event(.state(type: type))
    default: return event(.unknown(type: head.type))
    }
  }

  private struct Head: Decodable { var type: String; var at: Double? }
  private struct Text: Decodable { var text: String }
  private struct Session: Decodable { var fresh: Bool; var turn: Int; var provider: String }
  private struct Tool: Decodable { var name: String; var input: String }
  private struct CardBody: Decodable { var card: Card }
  private struct Err: Decodable { var error: String }
  private struct Changed: Decodable { var file: String }
  private struct Named: Decodable { var name: String }
}
