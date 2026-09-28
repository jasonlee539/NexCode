import Foundation

@main
enum UpdateInstallerTests {
    static func makeApp(_ app: URL, script: String) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: app.appendingPathComponent("Contents/MacOS"), withIntermediateDirectories: true)
        let info: [String: String] = ["CFBundleIdentifier": "com.nexcode.desktop", "CFBundleExecutable": "NexCode", "CFBundlePackageType": "APPL"]
        try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
            .write(to: app.appendingPathComponent("Contents/Info.plist"))
        let executable = app.appendingPathComponent("Contents/MacOS/NexCode")
        try Data(script.utf8).write(to: executable)
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
    }

    static func main() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("nexcode-install-test-\(UUID().uuidString)")
        try fm.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? fm.removeItem(at: root) }
        for successful in [true, false] {
            let parent = root.appendingPathComponent(successful ? "success" : "failure")
            let target = parent.appendingPathComponent("NexCode.app")
            let stage = parent.appendingPathComponent("nexcode-update-fixture")
            try makeApp(target, script: "#!/bin/sh\nexit 0\n")
            try Data("old".utf8).write(to: target.appendingPathComponent("old-marker"))
            try makeApp(stage.appendingPathComponent("unpack/NexCode.app"), script: successful
                ? "#!/bin/sh\nprintf ready > \"$NEXCODE_UPDATE_RECEIPT\"\n/bin/sleep 2\n"
                : "#!/bin/sh\nexit 1\n")
            var failed = false
            do { try UpdateInstaller.install(["test", "2147483647", target.path, stage.path]) }
            catch { failed = true }
            precondition(failed != successful)
            if successful {
                precondition(!fm.fileExists(atPath: target.appendingPathComponent("old-marker").path))
                let backups = try fm.contentsOfDirectory(atPath: parent.path).filter { $0.hasPrefix("NexCode.previous-") }
                precondition(backups.count == 1)
                precondition(fm.fileExists(atPath: parent.appendingPathComponent(backups[0] + "/old-marker").path))
            } else {
                precondition(fm.fileExists(atPath: target.appendingPathComponent("old-marker").path))
            }
        }
        print("macOS installer replacement and rollback tests passed.")
    }
}
