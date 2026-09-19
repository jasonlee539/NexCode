#!/usr/bin/env bun

import { createHash, createPublicKey, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const output = resolve(process.argv[2] ?? resolve(root, "dist"));
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { version?: unknown };
const expectedVersion = process.argv[3] ?? packageJson.version;
if (typeof expectedVersion !== "string" || !expectedVersion) {
  throw new Error("An expected OTA version is required.");
}

const installerPath = resolve(output, "Windows-Ota-Updata.exe");
const checksumPath = resolve(output, "Windows-Ota-Updata.exe.sha256");
const manifestPath = resolve(output, "Windows-Ota-Updata.json");
const signaturePath = resolve(output, "Windows-Ota-Updata.sig");
const publicKeyPath = resolve(root, "desktop", "windows", "NexCode", "UpdateSigningPublicKey.xml");

const [checksum, manifestBytes, signatureText, publicKeyXml, installerInfo] = await Promise.all([
  readFile(checksumPath, "utf8"),
  readFile(manifestPath),
  readFile(signaturePath, "utf8"),
  readFile(publicKeyPath, "utf8"),
  stat(installerPath),
]);

const installerHash = await new Promise<string>((resolveHash, rejectHash) => {
  const hash = createHash("sha256");
  const stream = createReadStream(installerPath);
  stream.on("data", chunk => hash.update(chunk));
  stream.on("error", rejectHash);
  stream.on("end", () => resolveHash(hash.digest("hex")));
});
const checksumMatch = /^([0-9a-fA-F]{64})\s+\*?Windows-Ota-Updata\.exe\s*$/.exec(checksum);
if (!checksumMatch || checksumMatch[1]?.toLowerCase() !== installerHash) {
  throw new Error("The OTA checksum does not match the installer.");
}

const manifest = JSON.parse(manifestBytes.toString("utf8")) as Record<string, unknown>;
const expectedFields = ["file", "sha256", "size", "version"];
if (Object.keys(manifest).sort().join(",") !== expectedFields.join(",")) {
  throw new Error("The signed OTA manifest contains unexpected fields.");
}
if (manifest.version !== expectedVersion) throw new Error("The signed OTA version does not match package.json.");
if (manifest.file !== "Windows-Ota-Updata.exe") throw new Error("The signed OTA filename is invalid.");
if (manifest.size !== installerInfo.size) throw new Error("The signed OTA size does not match the installer.");
if (manifest.sha256 !== installerHash) throw new Error("The signed OTA hash does not match the installer.");

const xmlPart = (name: string): string => {
  const match = new RegExp(`<${name}>([^<]+)</${name}>`).exec(publicKeyXml);
  if (!match?.[1]) throw new Error(`The OTA public key is missing ${name}.`);
  return match[1];
};
const base64Url = (value: string): string => value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const publicKey = createPublicKey({
  format: "jwk",
  key: {
    kty: "RSA",
    n: base64Url(xmlPart("Modulus")),
    e: base64Url(xmlPart("Exponent")),
  },
});

const encodedSignature = signatureText.trim();
if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedSignature)) {
  throw new Error("The OTA signature is not valid base64.");
}
const signature = Buffer.from(encodedSignature, "base64");
if (!verify("RSA-SHA256", manifestBytes, publicKey, signature)) {
  throw new Error("The OTA manifest signature is invalid.");
}

const publicKeyFingerprint = createHash("sha256")
  .update(publicKey.export({ format: "der", type: "spki" }))
  .digest("hex");
console.log("Windows OTA signature verified.");
console.log(`  version: ${expectedVersion}`);
console.log(`  installer SHA-256: ${installerHash}`);
console.log(`  public key SHA-256: ${publicKeyFingerprint}`);
