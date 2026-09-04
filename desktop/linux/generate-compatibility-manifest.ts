import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

type ManifestRow = { path: string; sha256: string };

const REQUIRED_ROOT_FILES = ["package.json", "bun.lock", "scripts/model-metadata.source.json"] as const;
const OUTPUT_PATH = "src/generated/compatibility-version.json";

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function manifestPath(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  if (!value || value.startsWith("../") || value.includes("/../") || value === OUTPUT_PATH) {
    throw new Error(`invalid Ubuntu compatibility manifest path: ${JSON.stringify(value)}`);
  }
  return value;
}

function collectRuntimeFiles(root: string, directory: string, rows: ManifestRow[]): void {
  const entries = readdirSync(directory).sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
  for (const entry of entries) {
    const path = join(directory, entry);
    const relativePath = relative(root, path).split(sep).join("/");
    if (relativePath === OUTPUT_PATH || relativePath.startsWith(`${OUTPUT_PATH}.tmp-`)) continue;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`runtime source may not contain symlinks: ${manifestPath(root, path)}`);
    if (stat.isDirectory()) {
      collectRuntimeFiles(root, path, rows);
      continue;
    }
    if (!stat.isFile()) throw new Error(`runtime source is not a regular file: ${manifestPath(root, path)}`);
    const validatedPath = manifestPath(root, path);
    rows.push({ path: validatedPath, sha256: digest(path) });
  }
}

export function generateUbuntuCompatibilityManifest(sourceRoot: string): string {
  const root = resolve(sourceRoot);
  const rows: ManifestRow[] = [];
  collectRuntimeFiles(root, join(root, "src"), rows);
  for (const relativePath of REQUIRED_ROOT_FILES) {
    const path = join(root, ...relativePath.split("/"));
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`required compatibility manifest path is not a regular file: ${relativePath}`);
    }
    rows.push({ path: relativePath, sha256: digest(path) });
  }
  rows.sort((left, right) => Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8")));

  const output = join(root, ...OUTPUT_PATH.split("/"));
  const temporary = `${output}.tmp-${process.pid}`;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify({
    schemaVersion: 1,
    assertionDslVersion: "1.0.0",
    evidenceSchemaVersion: "1.0.0",
    bunRuntimeVersion: Bun.version,
    files: rows,
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  renameSync(temporary, output);
  return output;
}

if (import.meta.main) {
  const root = process.argv[2];
  if (!root) throw new Error("source root argument is required");
  console.log(`generated ${generateUbuntuCompatibilityManifest(root)}`);
}
