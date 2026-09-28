"""Exercise the GTK callbacks without opening a window or touching user data."""

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
spec = importlib.util.spec_from_file_location("nexcode_shell", Path(__file__).resolve().parents[1] / "nexcode-ubuntu.py")
shell = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shell)


class NativeSaveTests(unittest.TestCase):
    def export(self, filename, content="Hello 世界", trusted=True):
        webview = Mock()
        webview.get_uri.return_value = "http://127.0.0.1:10100/"
        app = SimpleNamespace(webview=webview, _is_dashboard_uri=lambda uri: trusted,
                              _save_dialog=Mock(return_value=filename), export_busy=False)
        result = Mock()
        result.get_js_value.return_value.to_string.return_value = json.dumps({
            "type": "nexcode:save-markdown", "requestId": "request-1", "fileName": "thread.md", "content": content,
        })
        shell.NexCodeApplication._export_message(app, None, result)
        return app

    def test_saved_is_reported_only_after_file_is_written(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "thread.md"
            app = self.export(str(path))
            self.assertEqual(path.read_text(), "Hello 世界")
            self.assertIn('"status": "saved"', app.webview.run_javascript.call_args.args[0])

    def test_cancel_does_not_report_success(self):
        app = self.export(None)
        self.assertIn('"status": "cancelled"', app.webview.run_javascript.call_args.args[0])

    def test_write_failure_reports_error(self):
        with patch.object(shell, "save_markdown", side_effect=OSError("full")):
            app = self.export("/not-used.md")
        self.assertIn('"status": "error"', app.webview.run_javascript.call_args.args[0])

    def test_untrusted_page_cannot_open_dialog_or_write(self):
        app = self.export("/not-used.md", trusted=False)
        app._save_dialog.assert_not_called()
        app.webview.run_javascript.assert_not_called()


class InstallerTests(unittest.TestCase):
    def app(self):
        return SimpleNamespace(cancel=threading.Event(), _stop_runtime=Mock(),
                               _update_installed=Mock(), _update_install_failed=Mock(), release=Mock())

    def test_invalid_package_never_stops_runtime_or_requests_privileges(self):
        app = self.app()
        with patch.object(shell, "__file__", "/usr/lib/nexcode-ubuntu/nexcode-ubuntu.py"), \
                patch.object(shell, "prepare_update", side_effect=ValueError("signature invalid")), \
                patch.object(shell.subprocess, "run") as install, \
                patch.object(shell.GLib, "idle_add", side_effect=lambda callback, *args: callback(*args)):
            shell.NexCodeApplication._install_update(app, {})
        app._stop_runtime.assert_not_called()
        install.assert_not_called()
        app._update_install_failed.assert_called_once_with("signature invalid", False)
        app.release.assert_called_once()

    def test_cancelled_authorization_requests_runtime_recovery(self):
        app = self.app()
        with patch.object(shell, "__file__", "/usr/lib/nexcode-ubuntu/nexcode-ubuntu.py"), \
                patch.object(shell, "prepare_update", return_value=Path("/tmp/verified-package.deb")), \
                patch.object(shell.subprocess, "run", return_value=SimpleNamespace(returncode=126)) as install, \
                patch.object(shell.GLib, "idle_add", side_effect=lambda callback, *args: callback(*args)):
            shell.NexCodeApplication._install_update(app, {})
        app._stop_runtime.assert_called_once()
        self.assertEqual(install.call_args.args[0], ["/usr/bin/pkexec", "/usr/bin/apt-get", "install",
                                                    "--yes", "--no-remove", "/tmp/verified-package.deb"])
        self.assertTrue(app._update_install_failed.call_args.args[1])
        app._update_installed.assert_not_called()
        app.release.assert_called_once()

    def test_success_follows_verification_and_shutdown(self):
        app = self.app()
        events = []
        app._stop_runtime.side_effect = lambda: events.append("stop")
        app._update_installed.side_effect = lambda: events.append("done")
        def prepare(*_args):
            events.append("verify")
            return Path("/tmp/verified-package.deb")
        def install(*_args, **_kwargs):
            events.append("install")
            return SimpleNamespace(returncode=0)
        with patch.object(shell, "__file__", "/usr/lib/nexcode-ubuntu/nexcode-ubuntu.py"), \
                patch.object(shell, "prepare_update", side_effect=prepare), \
                patch.object(shell.subprocess, "run", side_effect=install), \
                patch.object(shell.GLib, "idle_add", side_effect=lambda callback, *args: callback(*args)):
            shell.NexCodeApplication._install_update(app, {})
        self.assertEqual(events, ["verify", "stop", "install", "done"])
        app._update_install_failed.assert_not_called()
        app.release.assert_called_once()
