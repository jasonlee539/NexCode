import CryptoKit
import Foundation

@main
enum UpdateValidationTests {
    static func reject(_ label: String, _ action: () throws -> Void) {
        do { try action(); fatalError("Accepted invalid input: \(label)") } catch {}
    }

    static func main() throws {
        let key = Curve25519.Signing.PrivateKey()
        let manifest = MacUpdateManifest(version: "1.0.2", file: MacUpdateValidation.asset, size: 9,
            sha256: String(repeating: "a", count: 64), platform: "macos", arch: MacUpdateValidation.arch,
            sourceCommit: String(repeating: "b", count: 40))
        let data = try JSONEncoder().encode(manifest)
        let signature = try key.signature(for: data).base64EncodedData()
        let raw = key.publicKey.rawRepresentation
        let verified = try MacUpdateValidation.manifest(data, signature: signature, publicKey: raw,
            expectedVersion: "1.0.2", expectedSize: 9)
        precondition(verified.version == "1.0.2")
        reject("tampered payload") {
            _ = try MacUpdateValidation.manifest(data + Data([32]), signature: signature, publicKey: raw, expectedVersion: "1.0.2", expectedSize: 9)
        }
        reject("wrong signing key") {
            _ = try MacUpdateValidation.manifest(data, signature: signature, publicKey: Curve25519.Signing.PrivateKey().publicKey.rawRepresentation,
                expectedVersion: "1.0.2", expectedSize: 9)
        }
        reject("release version mismatch") {
            _ = try MacUpdateValidation.manifest(data, signature: signature, publicKey: raw, expectedVersion: "1.0.3", expectedSize: 9)
        }
        reject("release size mismatch") {
            _ = try MacUpdateValidation.manifest(data, signature: signature, publicKey: raw, expectedVersion: "1.0.2", expectedSize: 8)
        }
        for (field, value) in [("platform", "windows"), ("arch", "other"), ("file", "../other.zip"),
                               ("sha256", "invalid"), ("sourceCommit", "invalid")] {
            var object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
            object[field] = value
            let invalid = try JSONSerialization.data(withJSONObject: object)
            let signed = try key.signature(for: invalid).base64EncodedData()
            reject("signed invalid \(field)") {
                _ = try MacUpdateValidation.manifest(invalid, signature: signed, publicKey: raw, expectedVersion: "1.0.2", expectedSize: 9)
            }
        }
        let upgrade = try MacUpdateValidation.newer("1.0.10", than: "1.0.9")
        let equal = try MacUpdateValidation.newer("1.0.1", than: "1.0.1")
        let downgrade = try MacUpdateValidation.newer("1.0.0", than: "1.0.1")
        precondition(upgrade && !equal && !downgrade)
        reject("prerelease") { _ = try MacUpdateValidation.version("1.0.2-beta.1") }
        reject("noncanonical version") { _ = try MacUpdateValidation.version("01.0.2") }
        for value in ["https://evil.example/jasonlee539/NexCode/releases/download/v1.0.2/a.zip",
                      "http://github.com/jasonlee539/NexCode/releases/download/v1.0.2/a.zip",
                      "https://github.com/other/NexCode/releases/download/v1.0.2/a.zip",
                      "https://github.com/jasonlee539/NexCode/releases/download/v1.0.1/a.zip",
                      "https://github.com/jasonlee539/NexCode/releases/download/v1.0.2/a.zip?redirect=1"] {
            reject("asset destination") { _ = try MacUpdateValidation.assetURL(value, tag: "v1.0.2", name: "a.zip") }
        }
        _ = try MacUpdateValidation.assetURL("https://github.com/jasonlee539/NexCode/releases/download/v1.0.2/a.zip", tag: "v1.0.2", name: "a.zip")
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        try Data("abc".utf8).write(to: file)
        let hash = try MacUpdateValidation.sha256(file)
        precondition(hash == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")

        // Optional release-artifact check uses the exact verifier compiled into the app.
        if CommandLine.arguments.count == 3 {
            let archive = URL(fileURLWithPath: CommandLine.arguments[1])
            let base = archive.deletingPathExtension()
            let artifactData = try Data(contentsOf: base.appendingPathExtension("json"))
            let artifact = try JSONDecoder().decode(MacUpdateManifest.self, from: artifactData)
            let publicText = try String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8)
            let publicData = Data(base64Encoded: publicText.trimmingCharacters(in: .whitespacesAndNewlines))!
            _ = try MacUpdateValidation.manifest(artifactData,
                signature: Data(contentsOf: base.appendingPathExtension("sig")), publicKey: publicData,
                expectedVersion: artifact.version, expectedSize: artifact.size)
            let artifactHash = try MacUpdateValidation.sha256(archive)
            precondition(artifactHash == artifact.sha256)
            print("Release archive signature and SHA-256 verified by the native client.")
        }
        print("macOS OTA validation tests passed.")
    }
}
