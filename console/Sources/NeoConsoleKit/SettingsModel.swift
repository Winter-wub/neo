import Foundation

/// What the seven Settings tabs and onboarding show and change. Holds no Neo logic: every value is read with a
/// `neo … --json` call and every control is one `neo …` call. `refresh()` re-reads it all; the views call it when
/// `ConsoleModel.revision` moves, which is how a change made in Terminal shows up.
@MainActor
public final class SettingsModel: ObservableObject {
  @Published public private(set) var settings: Settings?
  @Published public private(set) var face: Face?
  @Published public private(set) var wake: NameInfo?
  @Published public private(set) var providers: ProviderList?
  @Published public private(set) var providerConfig: ProviderConfigView?
  @Published public private(set) var models: ModelList?
  @Published public private(set) var devices: [DeviceInfo] = []
  @Published public private(set) var pet: PetInfo?
  @Published public private(set) var doctor: [DoctorRow]?
  @Published public private(set) var pair: PairStart?
  /// The device that paired after the current code was made.
  @Published public private(set) var pairedDevice: DeviceInfo?
  @Published public private(set) var busy = false
  /// Last action error (Thai); shown inline in the pane, never as an alert.
  @Published public var notice: String?

  private let runner: NeoRunner
  private var devicesAtPair: Set<String> = []

  public init(runner: NeoRunner) { self.runner = runner }

  // MARK: reading

  public func refresh() async {
    async let s = runner.run(["settings"])
    async let f = runner.run(["face"])
    async let n = runner.run(["name"])
    async let p = runner.run(["provider", "list"])
    async let c = runner.run(["provider", "config"])
    async let d = runner.run(["devices", "list"])
    async let t = runner.run(["pet"])
    let (rs, rf, rn, rp, rc, rd, rt) = await (s, f, n, p, c, d, t)
    if let v = rs.decode(Settings.self) { settings = v }
    if let v = rf.decode(Face.self) { face = v }
    if let v = rn.decode(NameInfo.self) { wake = v }
    if let v = rp.decode(ProviderList.self) { providers = v }
    if let v = rc.decode(ProviderConfigView.self) { providerConfig = v }
    if let v = rd.decode([DeviceInfo].self) { devices = v; notePairing() }
    if let v = rt.decode(PetInfo.self) { pet = v }
    if let current = providers?.current, models?.name != current { await loadModels(current) }
  }

  /// Just the pet name (the memory & jobs window shows it in its title).
  public func refreshName() async {
    if let v = await runner.run(["name"]).decode(NameInfo.self) { wake = v }
  }

  public func loadModels(_ provider: String) async {
    let result = await runner.run(["model", "list", "--provider", provider])
    if let v = result.decode(ModelList.self) { models = v }
    else if !result.ok { models = nil; notice = result.failureMessage }
  }

  // MARK: settings

  public func set(_ key: String, _ value: Bool) async { await setSetting(key, value ? "true" : "false") }

  public func setSetting(_ key: String, _ value: String) async {
    apply(key, value) // optimistic: the control must not snap back while neo runs
    guard await act(["settings", "set", key, value]) else { await refresh(); return }
    if let s = await runner.run(["settings"]).decode(Settings.self) { settings = s }
  }

  private func apply(_ key: String, _ value: String) {
    guard var s = settings else { return }
    let on = value == "true"
    switch key {
    case "requireName": s.requireName = on
    case "followUp": s.followUp = on
    case "bypass": s.bypass = on
    case "tailscale": s.tailscale = on
    case "lan": s.lan = on
    case "dream": s.dream = on
    case "onboarded": s.onboarded = on
    case "idle.clock": s.idle.clock = on
    case "idle.sleepAfter": if let n = Int(value) { s.idle.sleepAfter = n }
    default: return
    }
    settings = s
  }

  public func finishOnboarding() async { await setSetting("onboarded", "true") }
  public func restartOnboarding() async { await setSetting("onboarded", "false") }

  // MARK: brain

  public func useProvider(_ name: String) async {
    guard await act(["provider", "use", name]) else { return }
    if let v = await runner.run(["provider", "list"]).decode(ProviderList.self) { providers = v }
    await loadModels(name)
  }

  public func useModel(_ model: String, provider: String) async {
    guard await act(["model", "use", model, "--provider", provider]) else { return }
    await loadModels(provider)
    if let v = await runner.run(["provider", "list"]).decode(ProviderList.self) { providers = v }
  }

  public func discover() async {
    guard await act(["provider", "discover"]) else { return }
    if let v = await runner.run(["provider", "config"]).decode(ProviderConfigView.self) { providerConfig = v }
    if let v = await runner.run(["provider", "list"]).decode(ProviderList.self) { providers = v }
  }

  /// Add or edit a custom provider. The config goes to `neo` through a temp file (its `--file`), the API key through
  /// stdin so it never lands in argv or on disk outside NEO_HOME.
  public func saveProvider(name: String, config: [String: JSONValue], apiKey: String?) async -> Bool {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("neo-provider-\(UUID().uuidString).json")
    defer { try? FileManager.default.removeItem(at: file) }
    do {
      let data = try JSONEncoder().encode(JSONValue.object(config))
      try data.write(to: file, options: .atomic)
    } catch {
      notice = "เขียนไฟล์ตั้งค่าชั่วคราวไม่ได้"
      return false
    }
    let key = apiKey?.trimmingCharacters(in: .whitespacesAndNewlines)
    let withKey = key?.isEmpty == false
    let ok = await act(["provider", "config", "set", name, "--file", file.path] + (withKey ? ["--api-key-stdin"] : []), stdin: withKey ? key : nil)
    if ok { await refresh() }
    return ok
  }

  public func removeProvider(_ name: String) async -> Bool {
    let ok = await act(["provider", "config", "rm", name])
    if ok { await refresh() }
    return ok
  }

  // MARK: name and face

  public func setName(_ name: String) async {
    if await act(["name", "set", name]), let v = await runner.run(["name"]).decode(NameInfo.self) { wake = v }
  }
  public func train(_ name: String) async {
    if await act(["name", "train", name]), let v = await runner.run(["name"]).decode(NameInfo.self) { wake = v }
  }
  public func cancelTraining() async {
    if await act(["name", "train", "--cancel"]), let v = await runner.run(["name"]).decode(NameInfo.self) { wake = v }
  }

  public func saveFace(_ face: Face) async {
    guard await act(["face", "set", "--fg", face.fg, "--accent", face.accent, "--cheek", face.cheek, "--bg", face.bg]) else { return }
    if let v = await runner.run(["face"]).decode(Face.self) { self.face = v }
  }

  // MARK: phone

  public func startPair() async {
    pairedDevice = nil
    devicesAtPair = Set(devices.map(\.id))
    let result = await runner.run(["devices", "pair"])
    guard let v = result.decode(PairStart.self) else { notice = result.failureMessage; return }
    notice = nil
    pair = v
  }

  public func revoke(_ id: String) async {
    guard await act(["devices", "revoke", id]) else { return }
    if let v = await runner.run(["devices", "list"]).decode([DeviceInfo].self) { devices = v }
  }

  private func notePairing() {
    guard pair != nil, pairedDevice == nil else { return }
    pairedDevice = devices.first { !devicesAtPair.contains($0.id) }
  }

  /// Where the phone downloads the Android app: the first Tailscale / LAN address (USB and custom URLs can't serve it).
  public var apkURL: String? {
    guard let a = pair?.addresses.first(where: { $0.method == "Tailscale" || $0.method.hasPrefix("Wi-Fi") }) else { return nil }
    return a.url + "/neo.apk"
  }

  // MARK: onboarding "ตรวจเครื่อง"

  public func runDoctor() async {
    let result = await runner.run(["doctor"])
    if let rows = result.decode([DoctorRow].self) { doctor = rows; notice = nil }
    else { notice = result.failureMessage }
  }

  /// A row's fix button: Speech runs `neo doctor --fix stt` (this is what makes macOS ask for the permission).
  public func fixSpeech() async {
    busy = true; defer { busy = false }
    await act(["doctor", "--fix", "stt"])
    await runDoctor()
  }

  /// Required rows are green: the user can move on from the check step.
  public var checksPassed: Bool { doctor.map { !$0.contains(where: \.blocking) } ?? false }

  // MARK: plumbing

  @discardableResult
  private func act(_ args: [String], stdin: String? = nil) async -> Bool {
    let result = await runner.run(args, stdin: stdin)
    notice = result.ok ? nil : result.failureMessage
    return result.ok
  }
}

/// Which doctor rows get which fix button in the check step.
public enum DoctorFix: Equatable {
  /// Opens System Settings › Privacy & Security › Full Disk Access.
  case openFullDiskAccess
  /// `neo doctor --fix stt`
  case speech
  /// Nothing to click: the row's `fix` text is a command or a hint to read.
  case none

  public static func forRow(_ row: DoctorRow) -> DoctorFix {
    guard !row.ok else { return .none }
    switch row.id {
    case "fda": return .openFullDiskAccess
    case "stt": return row.fix?.contains("--fix stt") == true ? .speech : .none
    default: return .none
    }
  }
}

public let fullDiskAccessURL = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
