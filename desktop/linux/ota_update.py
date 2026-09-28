"""Signed Ubuntu release discovery and verification (no GTK dependency)."""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
import platform
import re
import subprocess
import tempfile
import time
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

REPOSITORY = "jasonlee539/NexCode"
RELEASES_URL = f"https://api.github.com/repos/{REPOSITORY}/releases?per_page=100"
MAX_PACKAGE_BYTES = 1024 ** 3
MAX_METADATA_BYTES = 64 * 1024
PUBLIC_KEY = Path(__file__).with_name("UpdateSigningPublicKey.pem")


def version_tuple(value: str) -> tuple[int, int, int]:
    if not isinstance(value, str) or not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", value):
        raise ValueError("Invalid stable release version.")
    return tuple(int(part) for part in value.split("."))


def architecture() -> str:
    arch = {"x86_64": "amd64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine())
    if not arch:
        raise ValueError("This Ubuntu architecture is not supported.")
    return arch


def asset_name(arch: str) -> str:
    if arch not in {"amd64", "arm64"}:
        raise ValueError("Invalid Ubuntu architecture.")
    return f"Ubuntu-Ota-Updata-{arch}.deb"


def validate_asset_url(url: str, tag: str, name: str) -> str:
    expected = f"https://github.com/{REPOSITORY}/releases/download/{tag}/{name}"
    if url != expected:
        raise ValueError("The release asset URL does not match the trusted repository.")
    return url


class ReleaseRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        target = urlparse(newurl)
        if (target.scheme != "https" or target.username or target.password
                or target.port not in {None, 443}
                or target.hostname not in {"github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}):
            raise ValueError("Untrusted release download redirect.")
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def download(url: str, limit: int, destination: Path | None = None) -> bytes:
    request = Request(url, headers={"User-Agent": "NexCode-Ubuntu-OTA", "Accept": "application/vnd.github+json"})
    deadline = time.monotonic() + 600
    chunks = []
    total = 0
    with build_opener(ReleaseRedirects()).open(request, timeout=30) as response:
        if int(response.headers.get("Content-Length", "0")) > limit:
            raise ValueError("Release download exceeds the size limit.")
        output = destination.open("xb") if destination else None
        try:
            while True:
                chunk = response.read(128 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > limit or time.monotonic() > deadline:
                    raise ValueError("Release download exceeded its size or time limit.")
                if output:
                    output.write(chunk)
                else:
                    chunks.append(chunk)
        finally:
            if output:
                output.close()
    return b"".join(chunks)


def select_release(releases: list, current: str, arch: str) -> dict | None:
    current_version = version_tuple(current)
    package = asset_name(arch)
    stem = package[:-4]
    required = [package, package + ".sha256", stem + ".json", stem + ".sig"]
    candidates = []
    for release in releases:
        if not isinstance(release, dict) or release.get("draft") or release.get("prerelease"):
            continue
        tag = release.get("tag_name", "")
        match = re.fullmatch(r"(?:ubuntu-v|v)((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))", tag)
        if not match or version_tuple(match[1]) <= current_version:
            continue
        assets = release.get("assets", [])
        by_name = {asset.get("name"): asset for asset in assets if isinstance(asset, dict)}
        if not all(name in by_name for name in required):
            continue  # Other platforms have independent releases in this repository.
        if any(sum(asset.get("name") == name for asset in assets if isinstance(asset, dict)) != 1 for name in required):
            raise ValueError("Duplicate OTA release assets.")
        urls = {name: validate_asset_url(by_name[name].get("browser_download_url"), tag, name) for name in required}
        size = by_name[package].get("size")
        if type(size) is not int or not 0 < size <= MAX_PACKAGE_BYTES:
            raise ValueError("Invalid release package size.")
        candidates.append({"version": match[1], "tag": tag, "arch": arch, "size": size, "urls": urls})
    return max(candidates, key=lambda release: version_tuple(release["version"]), default=None)


def check_for_update(current: str) -> dict | None:
    releases = json.loads(download(RELEASES_URL, 4 * 1024 * 1024))
    if not isinstance(releases, list):
        raise ValueError("GitHub returned invalid release metadata.")
    return select_release(releases, current, architecture())


def verify_manifest(raw: bytes, signature: bytes, release: dict, public_key: Path = PUBLIC_KEY) -> dict:
    if len(raw) > MAX_METADATA_BYTES or len(signature) > MAX_METADATA_BYTES:
        raise ValueError("Oversized release manifest or signature.")
    decoded = base64.b64decode(signature.strip(), validate=True)
    if len(decoded) != 64:
        raise ValueError("Invalid OTA signature length.")
    with tempfile.TemporaryDirectory(prefix="nexcode-signature-") as temporary:
        root = Path(temporary)
        (root / "manifest").write_bytes(raw)
        (root / "signature").write_bytes(decoded)
        result = subprocess.run([
            "/usr/bin/openssl", "pkeyutl", "-verify", "-pubin", "-inkey", str(public_key),
            "-rawin", "-in", str(root / "manifest"), "-sigfile", str(root / "signature"),
        ], capture_output=True, timeout=15, check=False)
        if result.returncode:
            raise ValueError("The Ubuntu OTA signature could not be verified.")
    manifest = json.loads(raw)
    if (not isinstance(manifest, dict)
            or manifest.get("version") != release["version"]
            or manifest.get("platform") != "ubuntu"
            or manifest.get("arch") != release["arch"]
            or manifest.get("file") != asset_name(release["arch"])
            or type(manifest.get("size")) is not int
            or manifest["size"] != release["size"]
            or not 0 < manifest["size"] <= MAX_PACKAGE_BYTES
            or not re.fullmatch(r"[0-9a-f]{64}", str(manifest.get("sha256", "")))
            or not re.fullmatch(r"[0-9a-f]{40}", str(manifest.get("sourceCommit", "")))):
        raise ValueError("The signed manifest does not match this Ubuntu release.")
    version_tuple(manifest["version"])
    return manifest


def verify_package(package: Path, manifest: dict) -> None:
    if package.stat().st_size != manifest["size"]:
        raise ValueError("The downloaded package size does not match its manifest.")
    digest = hashlib.sha256()
    with package.open("rb") as source:
        for chunk in iter(lambda: source.read(128 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != manifest["sha256"]:
        raise ValueError("The Ubuntu package checksum is invalid.")
    for field, expected in [("Package", "nexcode-ubuntu"), ("Version", manifest["version"]), ("Architecture", manifest["arch"])]:
        actual = subprocess.check_output(["/usr/bin/dpkg-deb", "--field", str(package), field], timeout=20, text=True).strip()
        if actual != expected:
            raise ValueError("The Debian package identity does not match the signed manifest.")


def prepare_update(release: dict, directory: Path) -> Path:
    name = asset_name(release["arch"])
    stem = name[:-4]
    raw = download(release["urls"][stem + ".json"], MAX_METADATA_BYTES)
    signature = download(release["urls"][stem + ".sig"], MAX_METADATA_BYTES)
    manifest = verify_manifest(raw, signature, release)
    checksum = download(release["urls"][name + ".sha256"], MAX_METADATA_BYTES).decode("ascii").strip()
    if checksum != f"{manifest['sha256']}  {name}":
        raise ValueError("The checksum file does not match the signed manifest.")
    package = directory / name
    download(release["urls"][name], manifest["size"], package)
    verify_package(package, manifest)
    return package
