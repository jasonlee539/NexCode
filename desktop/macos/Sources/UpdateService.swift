import CryptoKit
import Foundation

enum MacUpdateError: LocalizedError {
    case invalid(String)
    var errorDescription: String? {
        switch self { case .invalid(let message): return message }
    }
}

struct MacUpdateManifest: Codable {
    let version: String
    let file: String
    let size: Int
    let sha256: String
    let platform: String
    let arch: String
    let sourceCommit: String
}

enum MacUpdateValidation {
    #if arch(arm64)
    static let arch = "arm64"
    #else
    static let arch = "x86_64"
    #endif
    static let asset = "Mac-Ota-Updata-\(arch).zip"
    static let metadata = "Mac-Ota-Updata-\(arch)"
    static let maximumBytes = 1024 * 1024 * 1024

    static func version(_ value: String) throws -> [Int] {
        guard value.range(of: #"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$"#, options: .regularExpression) != nil else {
            throw MacUpdateError.invalid("更新版本号无效。")
        }
        let parts = value.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 3 else { throw MacUpdateError.invalid("更新版本号无效。") }
        return parts
    }

    static func newer(_ candidate: String, than current: String) throws -> Bool {
        try version(current).lexicographicallyPrecedes(version(candidate))
    }

    static func assetURL(_ value: String, tag: String, name: String) throws -> URL {
        guard let url = URL(string: value), url.scheme == "https", url.host == "github.com",
              url.user == nil, url.password == nil, url.port == nil, url.query == nil, url.fragment == nil,
              url.path == "/jasonlee539/NexCode/releases/download/\(tag)/\(name)" else {
            throw MacUpdateError.invalid("OTA 下载地址无效。")
        }
        return url
    }

    static func manifest(_ data: Data, signature: Data, publicKey: Data,
                         expectedVersion: String, expectedSize: Int) throws -> MacUpdateManifest {
        let key = try Curve25519.Signing.PublicKey(rawRepresentation: publicKey)
        guard let encoded = String(data: signature, encoding: .utf8),
              let bytes = Data(base64Encoded: encoded.trimmingCharacters(in: .whitespacesAndNewlines)),
              key.isValidSignature(bytes, for: data) else {
            throw MacUpdateError.invalid("OTA 数字签名验证失败。")
        }
        let value = try JSONDecoder().decode(MacUpdateManifest.self, from: data)
        guard value.version == expectedVersion, value.file == asset,
              value.platform == "macos", value.arch == arch,
              value.size == expectedSize, value.size > 0, value.size <= maximumBytes,
              value.sha256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
              value.sourceCommit.range(of: "^[0-9a-f]{40}$", options: .regularExpression) != nil else {
            throw MacUpdateError.invalid("OTA 签名清单与版本、架构或下载大小不一致。")
        }
        return value
    }

    static func sha256(_ file: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var hash = SHA256()
        while let chunk = try handle.read(upToCount: 1024 * 1024), !chunk.isEmpty { hash.update(data: chunk) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

struct MacUpdateRelease {
    let version: String
    let size: Int
    let archive: URL
    let manifest: URL
    let signature: URL
    let checksum: URL
}

final class MacUpdateService {
    static var currentVersion: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0" }
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 600
        return URLSession(configuration: configuration)
    }()

    private func fetch(_ url: URL, limit: Int, destination: URL? = nil) async throws -> Data {
        var request = URLRequest(url: url)
        request.setValue("NexCode-macOS-Updater/1.0", forHTTPHeaderField: "User-Agent")
        let (bytes, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200,
              let final = response.url, final.scheme == "https",
              ["api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].contains(final.host ?? ""),
              response.expectedContentLength <= Int64(limit) else {
            throw MacUpdateError.invalid("更新服务器响应无效或文件超过大小限制。")
        }
        var handle: FileHandle?
        if let destination {
            guard FileManager.default.createFile(atPath: destination.path, contents: nil,
                attributes: [.posixPermissions: 0o600]) else { throw MacUpdateError.invalid("无法创建更新下载文件。") }
            handle = try FileHandle(forWritingTo: destination)
        }
        defer { try? handle?.close() }
        var data = Data()
        var total = 0
        for try await byte in bytes {
            total += 1
            guard total <= limit else { throw MacUpdateError.invalid("更新下载超过大小限制。") }
            data.append(byte)
            if let handle, data.count >= 65_536 {
                try handle.write(contentsOf: data)
                data.removeAll(keepingCapacity: true)
            }
        }
        if let handle { try handle.write(contentsOf: data); return Data() }
        return data
    }

    func check() async throws -> MacUpdateRelease? {
        struct Asset: Decodable { let name: String; let size: Int; let browser_download_url: String }
        struct Release: Decodable { let tag_name: String; let draft: Bool; let prerelease: Bool; let assets: [Asset] }
        let url = URL(string: "https://api.github.com/repos/jasonlee539/NexCode/releases/latest")!
        let release = try JSONDecoder().decode(Release.self, from: await fetch(url, limit: 4 * 1024 * 1024))
        guard !release.draft, !release.prerelease, release.tag_name.hasPrefix("v") else { return nil }
        let version = String(release.tag_name.dropFirst())
        guard try MacUpdateValidation.newer(version, than: Self.currentVersion) else { return nil }
        let names = [MacUpdateValidation.asset, MacUpdateValidation.metadata + ".json",
                     MacUpdateValidation.metadata + ".sig", MacUpdateValidation.asset + ".sha256"]
        // A Windows-only release is not a Mac update. Wait for all four assets.
        guard names.allSatisfy({ name in release.assets.filter { $0.name == name }.count == 1 }) else { return nil }
        let assets = names.map { name in release.assets.first { $0.name == name }! }
        guard assets[0].size > 0, assets[0].size <= MacUpdateValidation.maximumBytes else {
            throw MacUpdateError.invalid("OTA 更新包大小无效。")
        }
        let urls = try assets.map { try MacUpdateValidation.assetURL($0.browser_download_url, tag: release.tag_name, name: $0.name) }
        return MacUpdateRelease(version: version, size: assets[0].size, archive: urls[0], manifest: urls[1], signature: urls[2], checksum: urls[3])
    }

    /// Prepare everything before asking the running app to shut down.
    func prepare(_ release: MacUpdateRelease) async throws -> URL {
        let fm = FileManager.default
        let target = Bundle.main.bundleURL.resolvingSymlinksInPath()
        guard !target.path.hasPrefix("/Volumes/"), target.pathExtension == "app",
              fm.isWritableFile(atPath: target.deletingLastPathComponent().path) else {
            throw MacUpdateError.invalid("请先将 NexCode 移至可写的“应用程序”目录，再检查更新。")
        }
        guard let resources = Bundle.main.resourceURL else { throw MacUpdateError.invalid("应用资源缺失。") }
        let key = try Data(contentsOf: resources.appendingPathComponent("UpdateSigningPublicKey.bin"))
        let manifestBytes = try await fetch(release.manifest, limit: 65_536)
        let signature = try await fetch(release.signature, limit: 65_536)
        let manifest = try MacUpdateValidation.manifest(manifestBytes, signature: signature, publicKey: key,
            expectedVersion: release.version, expectedSize: release.size)
        let checksum = try await fetch(release.checksum, limit: 65_536)
        guard String(data: checksum, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            == "\(manifest.sha256)  \(manifest.file)" else { throw MacUpdateError.invalid("SHA-256 文件与签名清单不一致。") }
        let stage = fm.temporaryDirectory.appendingPathComponent("nexcode-update-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: stage, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        do {
            let archive = stage.appendingPathComponent(manifest.file)
            _ = try await fetch(release.archive, limit: manifest.size, destination: archive)
            let size = try fm.attributesOfItem(atPath: archive.path)[.size] as? NSNumber
            guard size?.intValue == manifest.size, try MacUpdateValidation.sha256(archive) == manifest.sha256 else {
                throw MacUpdateError.invalid("OTA 下载不完整或 SHA-256 校验失败。")
            }
            let unpack = stage.appendingPathComponent("unpack")
            try fm.createDirectory(at: unpack, withIntermediateDirectories: false)
            try Self.run("/usr/bin/ditto", ["-x", "-k", archive.path, unpack.path])
            let app = unpack.appendingPathComponent("NexCode.app")
            guard let bundle = Bundle(url: app), bundle.bundleIdentifier == "com.nexcode.desktop",
                  bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String == manifest.version,
                  try String(contentsOf: app.appendingPathComponent("Contents/Resources/SourceCommit.txt"), encoding: .utf8)
                    .trimmingCharacters(in: .whitespacesAndNewlines) == manifest.sourceCommit,
                  try Data(contentsOf: app.appendingPathComponent("Contents/Resources/UpdateSigningPublicKey.bin")) == key else {
                throw MacUpdateError.invalid("更新应用的身份、版本或签名公钥不匹配。")
            }
            try Self.run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app.path])
            // Run the helper shipped with the currently trusted application.
            try fm.copyItem(at: Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/NexCodeUpdater"),
                            to: stage.appendingPathComponent("NexCodeUpdater"))
            return stage
        } catch {
            try? fm.removeItem(at: stage)
            throw error
        }
    }

    static func run(_ executable: String, _ arguments: [String]) throws {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: executable)
        task.arguments = arguments
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        try task.run()
        task.waitUntilExit()
        guard task.terminationStatus == 0 else { throw MacUpdateError.invalid("更新包校验或解压失败。") }
    }
}
