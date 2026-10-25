// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "NeoConsole",
  platforms: [.macOS(.v13)],
  targets: [
    // everything that can be tested without a window: protocol types, the neo command runner, reconcile, the live model
    .target(name: "NeoConsoleKit"),
    .executableTarget(name: "NeoConsole", dependencies: ["NeoConsoleKit"]),
    .testTarget(name: "NeoConsoleKitTests", dependencies: ["NeoConsoleKit"]),
  ]
)
