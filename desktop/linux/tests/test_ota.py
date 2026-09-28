import base64
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ota_update import (ReleaseRedirects, asset_name, prepare_update, select_release,
                        validate_asset_url, verify_manifest, verify_package, version_tuple)
from native_export import parse_export_message, save_markdown


class UpdateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.private = cls.root / "private.pem"
        cls.public = cls.root / "public.pem"
        subprocess.run(["openssl", "genpkey", "-algorithm", "ED25519", "-out", str(cls.private)], check=True)
        subprocess.run(["openssl", "pkey", "-in", str(cls.private), "-pubout", "-out", str(cls.public)], check=True)
        cls.manifest = {"version": "1.0.1", "platform": "ubuntu", "arch": "amd64",
                        "file": asset_name("amd64"), "size": 3, "sha256": hashlib.sha256(b"deb").hexdigest(),
                        "sourceCommit": "a" * 40}

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def signed(self, manifest):
        raw = json.dumps(manifest).encode()
        path = self.root / "manifest.json"
        path.write_bytes(raw)
        signature = subprocess.check_output(["openssl", "pkeyutl", "-sign", "-inkey", str(self.private), "-rawin", "-in", str(path)])
        return raw, base64.b64encode(signature)

    def release(self, version="1.0.1", arch="amd64"):
        name = asset_name(arch)
        names = [name, name + ".sha256", name[:-4] + ".json", name[:-4] + ".sig"]
        tag = "ubuntu-v" + version
        return {"tag_name": tag, "assets": [{"name": n, "size": 3,
            "browser_download_url": f"https://github.com/jasonlee539/NexCode/releases/download/{tag}/{n}"} for n in names]}

    def test_platform_releases_are_independent_and_sorted(self):
        releases = [{"tag_name": "v9.0.0", "assets": []}, self.release(), self.release("1.0.3"),
                    {**self.release("2.0.0"), "prerelease": True}, {**self.release("3.0.0"), "draft": True}]
        self.assertEqual(select_release(releases, "1.0.0", "amd64")["version"], "1.0.3")
        self.assertIsNone(select_release(releases, "1.0.3", "amd64"))
        self.assertIsNone(select_release(releases, "1.0.0", "arm64"))

    def test_reject_unsafe_urls_sizes_and_duplicate_assets(self):
        for url in ["http://github.com/file", "https://github.com/attacker/NexCode/releases/download/ubuntu-v1.0.1/a.deb",
                    "https://github.com@evil.example/a.deb"]:
            with self.assertRaises(ValueError):
                validate_asset_url(url, "ubuntu-v1.0.1", "a.deb")
        release = self.release()
        release["assets"][0]["size"] = True
        with self.assertRaises(ValueError):
            select_release([release], "1.0.0", "amd64")
        release = self.release()
        release["assets"].append(release["assets"][0])
        with self.assertRaises(ValueError):
            select_release([release], "1.0.0", "amd64")

    def test_redirects_reject_non_https_and_foreign_hosts(self):
        for url in ["http://github.com/a", "https://evil.example/a", "https://github.com:8080/a"]:
            with self.assertRaises(ValueError):
                ReleaseRedirects().redirect_request(None, None, 302, "", {}, url)

    def test_versions_are_numeric_and_stable(self):
        self.assertGreater(version_tuple("1.10.0"), version_tuple("1.9.9"))
        for value in ["1.0.1-beta", "01.0.1", "1.2", "../1.0.1"]:
            with self.assertRaises(ValueError):
                version_tuple(value)

    def test_valid_signature_and_tampered_manifest(self):
        raw, signature = self.signed(self.manifest)
        self.assertEqual(verify_manifest(raw, signature, self.manifest, self.public), self.manifest)
        with self.assertRaises(ValueError):
            verify_manifest(raw.replace(b"1.0.1", b"1.0.2"), signature, self.manifest, self.public)
        with self.assertRaises(ValueError):
            verify_manifest(raw, base64.b64encode(b"x" * 64), self.manifest, self.public)

    def test_signed_manifest_is_bound_to_platform_version_arch_and_size(self):
        for field, value in [("platform", "macos"), ("arch", "arm64"), ("version", "1.0.2"),
                             ("file", "../package.deb"), ("size", True), ("sourceCommit", "main"), ("sha256", "invalid")]:
            raw, signature = self.signed({**self.manifest, field: value})
            with self.assertRaises(ValueError, msg=field):
                verify_manifest(raw, signature, self.manifest, self.public)

    def test_payload_hash_is_verified_before_dpkg(self):
        package = self.root / "payload.deb"
        package.write_bytes(b"bad")
        with patch("ota_update.subprocess.check_output") as dpkg:
            with self.assertRaises(ValueError):
                verify_package(package, self.manifest)
            dpkg.assert_not_called()
        package.write_bytes(b"deb")
        with patch("ota_update.subprocess.check_output", side_effect=["nexcode-ubuntu", "1.0.1", "amd64"]):
            verify_package(package, self.manifest)
        with patch("ota_update.subprocess.check_output", return_value="other-package"):
            with self.assertRaises(ValueError):
                verify_package(package, self.manifest)

    def test_bad_signature_prevents_package_download(self):
        release = select_release([self.release()], "1.0.0", "amd64")
        with patch("ota_update.download", side_effect=[b"{}", b"invalid"]) as fetch:
            with self.assertRaises(ValueError):
                prepare_update(release, self.root)
            self.assertEqual(fetch.call_count, 2)


class ExportTests(unittest.TestCase):
    def test_safe_filename_unicode_and_atomic_replacement(self):
        message = parse_export_message(json.dumps({"type": "nexcode:save-markdown", "requestId": "1",
                                                  "fileName": "../../对话", "content": "# 对话\n\nHello\n"}))
        self.assertNotIn("/", message["fileName"])
        self.assertTrue(message["fileName"].endswith(".md"))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "thread.md"
            path.write_text("old")
            save_markdown(path, message["content"])
            self.assertEqual(path.read_text(), message["content"])
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_reject_invalid_or_oversized_export(self):
        base = {"type": "nexcode:save-markdown", "requestId": "1", "content": "hello"}
        for change in [{"type": "execute"}, {"requestId": ""}, {"content": None}, {"requestId": "x" * 129}]:
            with self.assertRaises(ValueError):
                parse_export_message(json.dumps({**base, **change}))
        with patch("native_export.MAX_EXPORT_BYTES", 10):
            with self.assertRaises(ValueError):
                parse_export_message(json.dumps({**base, "content": "x" * 11}))

    def test_failed_replace_preserves_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "thread.md"
            path.write_text("original")
            with patch("native_export.os.replace", side_effect=OSError("disk error")):
                with self.assertRaises(OSError):
                    save_markdown(path, "replacement")
            self.assertEqual(path.read_text(), "original")
            self.assertEqual(list(Path(directory).iterdir()), [path])
