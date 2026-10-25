// Hand-written mirrors of the `neo … --json` outputs the Settings tabs and onboarding read.
// Each one is checked against its golden fixture in FixtureTests.
import Foundation

/// Any JSON value. Used where NeoCli passes through a user-shaped object (provider config).
public indirect enum JSONValue: Codable, Equatable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  public init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() { self = .null }
    else if let v = try? c.decode(Bool.self) { self = .bool(v) }
    else if let v = try? c.decode(Double.self) { self = .number(v) }
    else if let v = try? c.decode(String.self) { self = .string(v) }
    else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
    else { self = .object(try c.decode([String: JSONValue].self)) }
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .null: try c.encodeNil()
    case .bool(let v): try c.encode(v)
    case .number(let v): try c.encode(v)
    case .string(let v): try c.encode(v)
    case .array(let v): try c.encode(v)
    case .object(let v): try c.encode(v)
    }
  }
  public var string: String? { if case .string(let s) = self { return s } else { return nil } }
  public var object: [String: JSONValue]? { if case .object(let o) = self { return o } else { return nil } }
  public var array: [JSONValue]? { if case .array(let a) = self { return a } else { return nil } }
  public subscript(key: String) -> JSONValue? { object?[key] }
}

/// One row of `neo doctor --json`.
public struct DoctorRow: Codable, Equatable, Identifiable {
  public var id: String
  public var label: String
  public var ok: Bool
  public var optional: Bool?
  public var detail: String?
  public var fix: String?

  /// Rows the user must fix before Neo works (the optional ones only inform).
  public var blocking: Bool { !ok && optional != true }
}

/// `neo daemon install --json`
public struct InstallResult: Codable, Equatable {
  public var installed: Bool
  public var plist: String
  public var symlink: String
  public var pathHint: String?
}

public struct ProviderInfo: Codable, Equatable, Identifiable {
  public var name: String
  public var label: String
  public var type: String
  public var found: Bool
  public var model: String?
  public var id: String { name }
}

/// `neo provider list --json`
public struct ProviderList: Codable, Equatable {
  public var current: String
  public var list: [ProviderInfo]
}

public struct DiscoveredAgent: Codable, Equatable, Identifiable {
  public var name: String
  public var label: String
  public var type: String
  public var available: Bool
  public var via: String?
  public var id: String { name }
}

/// `neo provider config --json`
public struct ProviderConfigView: Codable, Equatable {
  public var `default`: String?
  public var providers: [String: JSONValue]
  public var overrides: [String: JSONValue]?
  public var discovered: [DiscoveredAgent]?
  /// provider name → an API key file exists (the key itself is never shown)
  public var keys: [String: Bool]?
}

/// `neo model list --json`
public struct ModelList: Codable, Equatable {
  public struct Alias: Codable, Equatable { public var alias: String; public var id: String }
  public struct Model: Codable, Equatable, Identifiable { public var id: String; public var name: String }
  public var name: String
  public var mapped: [Alias]
  public var list: [Model]
  public var current: String?
}

/// `neo name --json`
public struct NameInfo: Codable, Equatable {
  public struct Training: Codable, Equatable { public var name: String; public var got: [String] }
  public var name: String
  public var variants: [String]
  public var training: Training?
}

/// `neo jobs list --json`
public struct JobsList: Codable, Equatable {
  public struct Job: Codable, Equatable, Identifiable {
    public var id: String
    public var kind: String
    public var title: String
    public var prompt: String?
    public var enabled: Bool
    public var at: Double?
    public var cron: String?
    public var next: Double?
    public var when: String
  }
  public struct Ringing: Codable, Equatable { public var id: String; public var title: String }
  public struct Problem: Codable, Equatable { public var line: Int?; public var text: String?; public var error: String? }
  public var jobs: [Job]
  public var ringing: Ringing?
  public var problems: [Problem]
}

/// `neo memory show --json`
public struct MemoryDoc: Codable, Equatable {
  public struct Item: Codable, Equatable, Identifiable {
    /// Set when a dream added this item.
    public struct Source: Codable, Equatable { public var id: String; public var at: Double; public var dream: String }
    public var section: String
    public var text: String
    public var from: Source?
    public var id: String { section + "\u{1F}" + text }
  }
  public var text: String
  /// What a conflict-checked save must have been based on.
  public var version: String
  public var items: [Item]
}

/// `neo jobs parse --json`: what a sentence like "ปลุกพรุ่งนี้ตีห้าครึ่ง" would add, without adding it.
public struct JobDraft: Codable, Equatable {
  public var kind: String
  public var title: String
  public var prompt: String?
  public var at: Double?
  public var cron: String?
  public var when: String
}
struct JobParse: Codable { var draft: JobDraft }

/// One line of `neo journal list --json`.
public struct JournalDay: Codable, Equatable, Identifiable {
  public var day: String
  public var entries: Int
  public var id: String { day }
}

public struct JournalEntry: Codable, Equatable, Identifiable {
  public var day: String
  public var time: String
  public var q: String
  public var a: String
  public var ok: Bool
  public var id: String { day + " " + time + " " + q }
}

/// `neo journal show --json`
public struct JournalDoc: Codable, Equatable {
  public var day: String
  public var text: String
  public var version: String
  public var entries: [JournalEntry]
}

/// One line of `neo dream list --json`.
public struct DreamInfo: Codable, Equatable, Identifiable {
  /// File name without `.md`: `YYYY-MM-DD-HHmm`.
  public var id: String
  public var at: Double
  public var reason: String
  public var took: Double
  public var entries: Int
  public var dream: String
  public var insights: Int
  public var undelivered: Bool
}

/// `neo dream show --json`
public struct DreamDoc: Codable, Equatable, Identifiable {
  public struct Insight: Codable, Equatable { public var q: String; public var finding: String }
  public var id: String
  public var text: String
  public var version: String
  public var at: Double
  public var reason: String
  public var took: Double
  public var entries: Int
  public var dream: String
  public var insights: [Insight]
  public var patterns: [String]
  public var added: [String]
  public var removed: [String]
  public var undelivered: Bool
}

/// `neo dream status --json`
public struct DreamStatus: Codable, Equatable {
  public var enabled: Bool
  public var running: Bool
  public var last: DreamInfo?
  public var why: String?
  public var blocked: String?
  public var newEntries: Int
  public var idleMinutes: Double
  public var quietNow: Bool
  public var quietHours: [Int]
  public var activity: [Double]
}

/// `neo pet --json`
public struct PetInfo: Codable, Equatable {
  public var pet: Pet?
  public var sleeping: Bool
}
