import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const authorityFiles = [
  "src/lab/conformance/fixtures/protocol-v1-cases.json",
  "src/lab/conformance/fixtures/live-v1-cases.json",
  "devlog/_fin/260807_compatibility_lab/022_protocol_v1_cases.json",
  "devlog/_fin/260807_compatibility_lab/024_live_v1_cases.json",
];

function fixtureDigest(bytesUtf8: string): string {
  return createHash("sha256")
    .update(new TextEncoder().encode("nxc-lab:fixture:v1\0"))
    .update(new TextEncoder().encode(bytesUtf8))
    .digest("hex");
}

for (const relativePath of authorityFiles) {
  const path = resolve(import.meta.dir, "..", relativePath);
  const source = readFileSync(path, "utf8");
  let fixtureCount = 0;
  const resealed = source.replace(
    /("bytesUtf8"\s*:\s*)("(?:\\.|[^"\\])*")(\s*,\s*"digest"\s*:\s*")([a-f0-9]{64})(")/g,
    (_match, prefix: string, encodedBytes: string, middle: string, _digest: string, suffix: string) => {
      fixtureCount += 1;
      const bytesUtf8 = JSON.parse(encodedBytes) as string;
      return `${prefix}${encodedBytes}${middle}${fixtureDigest(bytesUtf8)}${suffix}`;
    },
  );
  if (fixtureCount === 0) throw new Error(`No fixtures found in ${relativePath}`);
  writeFileSync(path, resealed, "utf8");
  console.log(`${relativePath}: resealed ${fixtureCount} fixtures`);
}
