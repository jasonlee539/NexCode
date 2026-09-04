#!/usr/bin/python3
"""Ubuntu-native GTK shell for the packaged NexCode dashboard."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from typing import Optional
from urllib.parse import urlencode, urlparse
from urllib.request import ProxyHandler, build_opener

import gi

gi.require_version("Gtk", "3.0")
try:
    gi.require_version("WebKit2", "4.1")
except ValueError:
    gi.require_version("WebKit2", "4.0")

from gi.repository import Gio, GLib, Gtk, WebKit2  # noqa: E402


APP_ID = "com.nexcode.Ubuntu"
APP_NAME = "NexCode"
START_TIMEOUT_SECONDS = 30.0
HTTP = build_opener(ProxyHandler({}))


def _config_directory() -> Path:
    configured = os.environ.get("NEXCODE_HOME", "").strip()
    return Path(configured).expanduser().resolve() if configured else Path.home() / ".nexcode"


def _runtime_root() -> Path:
    override = os.environ.get("NEXCODE_UBUNTU_RUNTIME", "").strip()
    if override:
        return Path(override).expanduser().resolve()

    script = Path(__file__).resolve()
    installed = script.parent / "runtime"
    if (installed / "src" / "cli" / "index.ts").is_file():
        return installed

    source = script.parents[2]
    if (source / "src" / "cli" / "index.ts").is_file():
        return source
    return installed


def _bun_binary(runtime: Path) -> Path:
    for name in ("bun.exe", "bun"):
        candidate = runtime / "node_modules" / "bun" / "bin" / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    raise RuntimeError("The bundled Bun executable is missing. Reinstall NexCode.")


def _launcher(runtime: Path) -> Path:
    for candidate in (runtime / "bin" / "nxc.mjs", runtime / "bin-launcher" / "nxc.mjs"):
        if candidate.is_file():
            return candidate
    raise RuntimeError("The NexCode command launcher is missing. Reinstall NexCode.")


def _url_host(hostname: object) -> str:
    value = hostname if isinstance(hostname, str) else ""
    value = value.strip().lower()
    if not value or value in {"0.0.0.0", "::", "[::]"}:
        return "127.0.0.1"
    return value


def _url_authority(host: str, port: int) -> str:
    return f"[{host}]:{port}" if ":" in host and not host.startswith("[") else f"{host}:{port}"


def _read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _runtime_candidates() -> list[tuple[str, int, Optional[int]]]:
    config_dir = _config_directory()
    candidates: list[tuple[str, int, Optional[int]]] = []
    record = _read_json(config_dir / "runtime-port.json")
    port = record.get("port")
    pid = record.get("pid")
    if isinstance(port, int) and 1 <= port <= 65535:
        candidates.append((_url_host(record.get("hostname")), port, pid if isinstance(pid, int) else None))

    config = _read_json(config_dir / "config.json")
    configured_port = config.get("port", 10100)
    if not isinstance(configured_port, int) or not 1 <= configured_port <= 65535:
        configured_port = 10100
    fallback = (_url_host(config.get("hostname")), configured_port, None)
    if fallback[:2] not in [(host, candidate_port) for host, candidate_port, _ in candidates]:
        candidates.append(fallback)
    return candidates


def _healthy_dashboard() -> Optional[str]:
    for host, port, expected_pid in _runtime_candidates():
        authority = _url_authority(host, port)
        try:
            with HTTP.open(f"http://{authority}/healthz", timeout=0.65) as response:
                payload = json.loads(response.read(64 * 1024).decode("utf-8"))
            if payload.get("service") != "nexcode" or payload.get("status") != "ok":
                continue
            reported_pid = payload.get("pid")
            if expected_pid is not None and reported_pid != expected_pid:
                continue
            query = urlencode({"desktop": "1", "platform": "ubuntu"})
            return f"http://{authority}/?{query}"
        except (OSError, ValueError, TimeoutError):
            continue
    return None


class NexCodeApplication(Gtk.Application):
    def __init__(self) -> None:
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
        self.window: Optional[Gtk.ApplicationWindow] = None
        self.stack: Optional[Gtk.Stack] = None
        self.webview: Optional[WebKit2.WebView] = None
        self.spinner: Optional[Gtk.Spinner] = None
        self.status_label: Optional[Gtk.Label] = None
        self.runtime_process: Optional[subprocess.Popen[bytes]] = None
        self.runtime_url: Optional[str] = None
        self.cancel = threading.Event()
        self.pending_oauth_return = False
        self.log_handle = None

    def do_command_line(self, command_line: Gio.ApplicationCommandLine) -> int:
        for argument in command_line.get_arguments()[1:]:
            if argument.startswith("nexcode://oauth-complete"):
                self.pending_oauth_return = True
        self.activate()
        if self.pending_oauth_return:
            GLib.idle_add(self._finish_oauth_return)
        return 0

    def do_activate(self) -> None:
        if self.window is not None:
            self.window.present()
            return

        Gtk.Window.set_default_icon_name("nexcode-ubuntu")
        self.window = Gtk.ApplicationWindow(application=self)
        self.window.set_title(APP_NAME)
        self.window.set_default_size(1215, 780)
        self.window.set_size_request(900, 600)
        self.window.set_position(Gtk.WindowPosition.CENTER)
        self.window.connect("delete-event", self._quit_from_window)

        header = Gtk.HeaderBar()
        header.set_title(APP_NAME)
        header.set_subtitle("Ubuntu")
        header.set_show_close_button(True)
        self.window.set_titlebar(header)

        self.stack = Gtk.Stack()
        self.stack.set_transition_type(Gtk.StackTransitionType.NONE)
        self.stack.add_named(self._loading_view(), "loading")
        self.stack.add_named(self._error_view(), "error")

        self.webview = WebKit2.WebView()
        self.webview.connect("decide-policy", self._decide_policy)
        self.webview.connect("load-failed", self._load_failed)
        self.stack.add_named(self.webview, "dashboard")

        self.window.add(self.stack)
        self.window.show_all()
        self.stack.set_visible_child_name("loading")
        self._start_runtime()

    def _loading_view(self) -> Gtk.Widget:
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        box.set_valign(Gtk.Align.CENTER)
        box.set_halign(Gtk.Align.CENTER)
        self.spinner = Gtk.Spinner()
        self.spinner.start()
        self.status_label = Gtk.Label(label="Starting the local NexCode service…")
        box.pack_start(self.spinner, False, False, 0)
        box.pack_start(self.status_label, False, False, 0)
        return box

    def _error_view(self) -> Gtk.Widget:
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        box.set_valign(Gtk.Align.CENTER)
        box.set_halign(Gtk.Align.CENTER)
        label = Gtk.Label(name="runtime-error")
        label.set_line_wrap(True)
        label.set_max_width_chars(72)
        label.set_justify(Gtk.Justification.CENTER)
        retry = Gtk.Button.new_with_label("Retry")
        retry.connect("clicked", lambda _button: self._start_runtime())
        box.pack_start(label, False, False, 0)
        box.pack_start(retry, False, False, 0)
        return box

    def _start_runtime(self) -> None:
        if self.stack is None:
            return
        self.stack.set_visible_child_name("loading")
        if self.spinner is not None:
            self.spinner.start()
        if self.status_label is not None:
            self.status_label.set_text("Starting the local NexCode service…")
        threading.Thread(target=self._runtime_worker, name="nexcode-runtime", daemon=True).start()

    def _runtime_worker(self) -> None:
        existing = self._wait_for_runtime(1.2)
        if existing:
            GLib.idle_add(self._runtime_ready, existing)
            return

        try:
            runtime = _runtime_root()
            bun = _bun_binary(runtime)
            launcher = _launcher(runtime)
            env = os.environ.copy()
            env["NEXCODE_DESKTOP_APP"] = "1"
            env["PATH"] = os.pathsep.join(
                [str(Path.home() / ".bun" / "bin"), str(Path.home() / ".local" / "bin"), "/usr/local/bin", "/usr/bin", "/bin"]
            )
            cache_dir = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "nexcode-ubuntu"
            cache_dir.mkdir(parents=True, exist_ok=True)
            self.log_handle = (cache_dir / "desktop.log").open("ab", buffering=0)
            self.runtime_process = subprocess.Popen(
                [str(bun), "--no-env-file", str(launcher), "start"],
                cwd=runtime,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=self.log_handle,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        except (OSError, RuntimeError) as error:
            GLib.idle_add(self._runtime_failed, str(error))
            return

        ready = self._wait_for_runtime(START_TIMEOUT_SECONDS)
        if ready:
            GLib.idle_add(self._runtime_ready, ready)
            return
        code = self.runtime_process.poll() if self.runtime_process else None
        suffix = f" (exit status {code})" if code is not None else ""
        GLib.idle_add(self._runtime_failed, f"The local NexCode service did not become ready{suffix}.")

    def _wait_for_runtime(self, timeout: float) -> Optional[str]:
        deadline = time.monotonic() + timeout
        while not self.cancel.is_set() and time.monotonic() < deadline:
            ready = _healthy_dashboard()
            if ready:
                return ready
            self.cancel.wait(0.18)
        return None

    def _runtime_ready(self, url: str) -> bool:
        if self.cancel.is_set() or self.webview is None or self.stack is None:
            return GLib.SOURCE_REMOVE
        self.runtime_url = url
        self.webview.load_uri(url)
        self.stack.set_visible_child_name("dashboard")
        if self.spinner is not None:
            self.spinner.stop()
        return GLib.SOURCE_REMOVE

    def _runtime_failed(self, message: str) -> bool:
        if self.cancel.is_set() or self.stack is None:
            return GLib.SOURCE_REMOVE
        error_view = self.stack.get_child_by_name("error")
        label = error_view.get_children()[0] if error_view is not None else None
        if isinstance(label, Gtk.Label):
            label.set_text(f"NexCode could not start.\n\n{message}\n\nSee ~/.cache/nexcode-ubuntu/desktop.log for details.")
        self.stack.set_visible_child_name("error")
        if self.spinner is not None:
            self.spinner.stop()
        return GLib.SOURCE_REMOVE

    def _finish_oauth_return(self) -> bool:
        self.pending_oauth_return = False
        if self.window is not None:
            self.window.present()
        if self.webview is not None and self.runtime_url:
            self.webview.load_uri(self.runtime_url)
        return GLib.SOURCE_REMOVE

    def _is_dashboard_uri(self, uri: str) -> bool:
        if not self.runtime_url:
            return False
        target = urlparse(uri)
        runtime = urlparse(self.runtime_url)
        return target.scheme in {"http", "https"} and target.netloc == runtime.netloc

    def _decide_policy(self, _webview: WebKit2.WebView, decision: WebKit2.PolicyDecision, _kind: object) -> bool:
        if not isinstance(decision, WebKit2.NavigationPolicyDecision):
            return False
        uri = decision.get_request().get_uri()
        if self._is_dashboard_uri(uri) or uri.startswith(("about:", "blob:", "data:")):
            return False
        if uri.startswith("nexcode://oauth-complete"):
            decision.ignore()
            self._finish_oauth_return()
            return True
        if uri.startswith(("http://", "https://", "mailto:")):
            decision.ignore()
            try:
                Gio.AppInfo.launch_default_for_uri(uri, None)
            except GLib.Error as error:
                self._runtime_failed(f"Could not open the external link: {error.message}")
            return True
        decision.ignore()
        return True

    def _load_failed(self, _webview: WebKit2.WebView, _event: object, uri: str, error: GLib.Error) -> bool:
        if uri.startswith("nexcode://oauth-complete"):
            self._finish_oauth_return()
            return True
        self._runtime_failed(f"The dashboard could not be loaded: {error.message}")
        return False

    def _quit_from_window(self, _window: Gtk.Window, _event: object) -> bool:
        self.quit()
        return True

    def do_shutdown(self) -> None:
        self.cancel.set()
        self._stop_runtime()
        if self.log_handle is not None:
            self.log_handle.close()
            self.log_handle = None
        Gtk.Application.do_shutdown(self)

    def _stop_runtime(self) -> None:
        try:
            runtime = _runtime_root()
            bun = _bun_binary(runtime)
            launcher = _launcher(runtime)
            env = os.environ.copy()
            env["NEXCODE_DESKTOP_APP"] = "1"
            subprocess.run(
                [str(bun), "--no-env-file", str(launcher), "stop"],
                cwd=runtime,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=25,
                check=False,
            )
        except (OSError, RuntimeError, subprocess.TimeoutExpired):
            pass

        process = self.runtime_process
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    raise SystemExit(NexCodeApplication().run(sys.argv))
