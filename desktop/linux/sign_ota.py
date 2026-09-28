#!/usr/bin/env python3
"""Initialize an Ubuntu OTA key, or sign a package from a clean release commit."""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

from ota_update import PUBLIC_KEY, asset_name, verify_manifest, verify_package, version_tuple

ROOT = Path(__file__).resolve().parents[2]


def initialize_key(private: Path) -> None:
    private = private.resolve()
    if private.is_relative_to(ROOT) and not private.is_relative_to(ROOT / ".tmp"):
        raise ValueError("Keep the private key outside tracked source directories.")
    if private.exists() or PUBLIC_KEY.exists():
        raise ValueError("A signing key already exists; refusing to replace it.")
    private.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    key = subprocess.check_output(["/usr/bin/openssl", "genpkey", "-algorithm", "ED25519"])
    with private.open("xb") as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(key)
    public = subprocess.check_output(["/usr/bin/openssl", "pkey", "-in", str(private), "-pubout"])
    with PUBLIC_KEY.open("xb") as output:
        output.write(public)
    print("Created the Ubuntu OTA key pair. Back up the private key securely before publishing.")


def packaged_metadata(package: Path) -> dict[str, bytes]:
    wanted = {
        "./usr/lib/nexcode-ubuntu/UpdateSigningPublicKey.pem",
        "./usr/lib/nexcode-ubuntu/SourceCommit.txt",
        "./usr/lib/nexcode-ubuntu/runtime/package.json",
    }
    found = {}
    with subprocess.Popen(["/usr/bin/dpkg-deb", "--fsys-tarfile", str(package)], stdout=subprocess.PIPE) as process:
        try:
            with tarfile.open(fileobj=process.stdout, mode="r|") as archive:
                for entry in archive:
                    if entry.name in wanted:
                        if not entry.isfile() or entry.size > 1024 * 1024 or entry.name in found:
                            raise ValueError("Invalid or duplicated packaged release metadata.")
                        found[entry.name] = archive.extractfile(entry).read()
            if process.wait() != 0:
                raise ValueError("Cannot read Debian package.")
        except BaseException:
            process.kill()
            raise
    if set(found) != wanted:
        raise ValueError("Required release metadata is missing from the package.")
    return {Path(name).name: value for name, value in found.items()}


def sign_package(package: Path, private: Path, version: str, commit: str) -> None:
    version_tuple(version)
    if json.loads((ROOT / "package.json").read_text())["version"] != version:
        raise ValueError("Version must match package.json.")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    dirty = subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).strip()
    if head != commit or dirty:
        raise ValueError("Commit all release sources before signing; sourceCommit must equal the clean HEAD.")
    arch = subprocess.check_output(["/usr/bin/dpkg-deb", "--field", str(package), "Architecture"], text=True).strip()
    if package.name != asset_name(arch):
        raise ValueError("Unexpected Ubuntu OTA package name.")
    packed = packaged_metadata(package)
    if (packed["UpdateSigningPublicKey.pem"] != PUBLIC_KEY.read_bytes()
            or packed["SourceCommit.txt"].decode().strip() != commit
            or json.loads(packed["package.json"])["version"] != version):
        raise ValueError("Packaged public key, source commit or version differs from the release checkout.")
    digest = hashlib.sha256()
    with package.open("rb") as source:
        for chunk in iter(lambda: source.read(128 * 1024), b""):
            digest.update(chunk)
    manifest = {"version": version, "platform": "ubuntu", "arch": arch, "file": package.name,
                "size": package.stat().st_size, "sha256": digest.hexdigest(), "sourceCommit": commit}
    verify_package(package, manifest)
    raw = (json.dumps(manifest, separators=(",", ":")) + "\n").encode()
    # Load the signing key only after all build/package processes have finished.
    public = subprocess.check_output(["/usr/bin/openssl", "pkey", "-in", str(private), "-pubout"])
    if public != PUBLIC_KEY.read_bytes():
        raise ValueError("Private key does not match the embedded Ubuntu OTA public key.")
    with tempfile.TemporaryDirectory(prefix="nexcode-ota-sign-") as temporary:
        path = Path(temporary) / "manifest"
        path.write_bytes(raw)
        signature = subprocess.check_output([
            "/usr/bin/openssl", "pkeyutl", "-sign", "-inkey", str(private), "-rawin", "-in", str(path),
        ])
    encoded = base64.b64encode(signature) + b"\n"
    verify_manifest(raw, encoded, manifest)
    outputs = {
        package.with_suffix(".json"): raw,
        package.with_suffix(".sig"): encoded,
        Path(str(package) + ".sha256"): f"{manifest['sha256']}  {package.name}\n".encode(),
    }
    for destination, content in outputs.items():
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as output:
            output.write(content)
            temporary = Path(output.name)
        temporary.replace(destination)
    print(f"Signed Ubuntu {arch} OTA assets for {version}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--init-key", type=Path)
    parser.add_argument("--package", type=Path)
    parser.add_argument("--private-key", type=Path)
    parser.add_argument("--version")
    parser.add_argument("--source-commit")
    args = parser.parse_args()
    if args.init_key:
        initialize_key(args.init_key)
    elif all([args.package, args.private_key, args.version, args.source_commit]):
        sign_package(args.package.resolve(), args.private_key.resolve(), args.version, args.source_commit)
    else:
        parser.error("Use --init-key, or provide --package, --private-key, --version and --source-commit.")
