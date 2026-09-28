import AppKit
import Darwin
import Foundation

/// Detached helper: stage on the destination volume, then rename with rollback.
#if !UPDATE_INSTALLER_TEST
@main
#endif
enum UpdateInstaller {
    static func main() {
        do { try install() } catch {
            let app = NSApplication.shared
            app.setActivationPolicy(.accessory)
            let alert = NSAlert()
            alert.messageText = "NexCode 更新未完成"
            alert.informativeText = error.localizedDescription
            alert.runModal()
            exit(1)
        }
    }

    static func install(_ args: [String] = CommandLine.arguments) throws {
        guard args.count == 4, let pid = Int32(args[1]), pid > 1 else {
            throw NSError(domain: "NexCodeUpdate", code: 1, userInfo: [NSLocalizedDescriptionKey: "更新参数无效。"])
        }
        let fm = FileManager.default
        let target = URL(fileURLWithPath: args[2]).standardizedFileURL
        let stage = URL(fileURLWithPath: args[3]).standardizedFileURL
        guard target.pathExtension == "app", target.lastPathComponent == "NexCode.app",
              stage.lastPathComponent.hasPrefix("nexcode-update-"),
              Bundle(url: target)?.bundleIdentifier == "com.nexcode.desktop" else {
            throw NSError(domain: "NexCodeUpdate", code: 2, userInfo: [NSLocalizedDescriptionKey: "更新路径无效。"])
        }
        let parent = target.deletingLastPathComponent()
        let next = parent.appendingPathComponent(".NexCode-update-\(UUID().uuidString).app")
        let backup = parent.appendingPathComponent("NexCode.previous-\(UUID().uuidString).app")
        let failed = parent.appendingPathComponent("NexCode.failed-\(UUID().uuidString).app")
        do { try fm.copyItem(at: stage.appendingPathComponent("unpack/NexCode.app"), to: next) }
        catch {
            // The GUI may already have exited while the destination-volume copy failed.
            if kill(pid, 0) != 0 { NSWorkspace.shared.open(target) }
            throw error
        }
        defer { try? fm.removeItem(at: next) }
        let deadline = Date().addingTimeInterval(60)
        while kill(pid, 0) == 0 && Date() < deadline { Thread.sleep(forTimeInterval: 0.2) }
        guard kill(pid, 0) != 0 else {
            throw NSError(domain: "NexCodeUpdate", code: 3, userInfo: [NSLocalizedDescriptionKey: "NexCode 尚未退出，已取消替换应用。"])
        }
        try fm.moveItem(at: target, to: backup)
        let receipt = stage.appendingPathComponent("ready")
        let child = Process()
        do {
            try fm.moveItem(at: next, to: target)
            child.executableURL = target.appendingPathComponent("Contents/MacOS/NexCode")
            var environment = ProcessInfo.processInfo.environment
            environment["NEXCODE_UPDATE_RECEIPT"] = receipt.path
            child.environment = environment
            child.standardOutput = FileHandle.nullDevice
            child.standardError = FileHandle.nullDevice
            try child.run()
            let readyDeadline = Date().addingTimeInterval(90)
            while child.isRunning && !fm.fileExists(atPath: receipt.path) && Date() < readyDeadline {
                Thread.sleep(forTimeInterval: 0.25)
            }
            guard child.isRunning, fm.fileExists(atPath: receipt.path) else {
                throw NSError(domain: "NexCodeUpdate", code: 4, userInfo: [NSLocalizedDescriptionKey: "新版未能启动，正在恢复旧版。"])
            }
            // Retain the old bundle for manual recovery. Runtime/user data is untouched.
            try? fm.removeItem(at: stage)
        } catch {
            if child.isRunning {
                child.terminate()
                let stopDeadline = Date().addingTimeInterval(5)
                while child.isRunning && Date() < stopDeadline { Thread.sleep(forTimeInterval: 0.1) }
                if child.isRunning { kill(child.processIdentifier, SIGKILL) }
                child.waitUntilExit()
            }
            if fm.fileExists(atPath: target.path) { try fm.moveItem(at: target, to: failed) }
            try fm.moveItem(at: backup, to: target)
            NSWorkspace.shared.open(target)
            throw error
        }
    }
}
