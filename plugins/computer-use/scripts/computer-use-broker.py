#!/usr/bin/env python3

import base64
import configparser
import contextlib
import fcntl
import io
import json
import math
import os
import re
import select
import shutil
import signal
import shlex
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import uuid
from collections import OrderedDict, deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


PORTAL_BUS_NAME = "org.freedesktop.portal.Desktop"
PORTAL_OBJECT_PATH = "/org/freedesktop/portal/desktop"
REMOTE_DESKTOP_IFACE = "org.freedesktop.portal.RemoteDesktop"
SCREENCAST_IFACE = "org.freedesktop.portal.ScreenCast"
REQUEST_IFACE = "org.freedesktop.portal.Request"
DBUS_PROPERTIES_IFACE = "org.freedesktop.DBus.Properties"
PORTAL_REGISTRY_IFACE = "org.freedesktop.host.portal.Registry"
KWIN_SCRIPTING_IFACE = "org.kde.kwin.Scripting"
KWIN_BRIDGE_IFACE = "org.openai.CodexComputerUse.KWinBridge"
SNI_WATCHER_BUS_NAME = "org.kde.StatusNotifierWatcher"
SNI_WATCHER_OBJECT_PATH = "/StatusNotifierWatcher"
SNI_WATCHER_IFACE = "org.kde.StatusNotifierWatcher"
SNI_ITEM_IFACE = "org.kde.StatusNotifierItem"
COMPUTER_USE_PROTOCOL_VERSION = 2
AT_SPI_COORD_TYPE_SCREEN = 0
AT_SPI_COORD_TYPE_WINDOW = 1

DEVICE_KEYBOARD = 1
DEVICE_POINTER = 2
SCREENCAST_SOURCE_MONITOR = 1
SCREENCAST_CURSOR_EMBEDDED = 2
BUTTON_CODES = {
    "left": 272,
    "right": 273,
    "middle": 274,
}
POINTER_FRAME_MS = 8
MIN_POINTER_ANIMATION_MS = 90
MAX_POINTER_ANIMATION_MS = 230
CURSOR_THEME_COMMAND_TIMEOUT_SECONDS = 10.0
CURSOR_GLOW_THEME_NAME = "Codex-Computer-Use-Glow"
SCRIPT_DIR = Path(__file__).resolve().parent
ISOLATED_SESSION_SCRIPT = SCRIPT_DIR / "computer-use-isolated-session.py"
MODIFIER_KEYSYMS = {
    "shift": 0xFFE1,
    "ctrl": 0xFFE3,
    "alt": 0xFFE9,
    "meta": 0xFFEB,
}
MODIFIER_KEYCODES = {
    "shift": 42,
    "ctrl": 29,
    "alt": 56,
    "meta": 125,
}
SPECIAL_KEYSYMS = {
    "backspace": 0xFF08,
    "tab": 0xFF09,
    "enter": 0xFF0D,
    "return": 0xFF0D,
    "escape": 0xFF1B,
    "esc": 0xFF1B,
    "delete": 0xFFFF,
    "home": 0xFF50,
    "left": 0xFF51,
    "up": 0xFF52,
    "right": 0xFF53,
    "down": 0xFF54,
    "page_up": 0xFF55,
    "pageup": 0xFF55,
    "page_down": 0xFF56,
    "pagedown": 0xFF56,
    "end": 0xFF57,
    "insert": 0xFF63,
    "space": 0x20,
}
for _i in range(1, 13):
    SPECIAL_KEYSYMS[f"f{_i}"] = 0xFFBE + _i - 1

PORTAL_KEYCODES = {
    "escape": 1,
    "esc": 1,
    "backspace": 14,
    "tab": 15,
    "enter": 28,
    "return": 28,
    "space": 57,
    "home": 102,
    "up": 103,
    "page_up": 104,
    "pageup": 104,
    "left": 105,
    "right": 106,
    "end": 107,
    "down": 108,
    "page_down": 109,
    "pagedown": 109,
    "insert": 110,
    "delete": 111,
}
for _char, _code in {
    "a": 30,
    "b": 48,
    "c": 46,
    "d": 32,
    "e": 18,
    "f": 33,
    "g": 34,
    "h": 35,
    "i": 23,
    "j": 36,
    "k": 37,
    "l": 38,
    "m": 50,
    "n": 49,
    "o": 24,
    "p": 25,
    "q": 16,
    "r": 19,
    "s": 31,
    "t": 20,
    "u": 22,
    "v": 47,
    "w": 17,
    "x": 45,
    "y": 21,
    "z": 44,
    "1": 2,
    "2": 3,
    "3": 4,
    "4": 5,
    "5": 6,
    "6": 7,
    "7": 8,
    "8": 9,
    "9": 10,
    "0": 11,
}.items():
    PORTAL_KEYCODES[_char] = _code
for _i in range(1, 11):
    PORTAL_KEYCODES[f"f{_i}"] = 58 + _i
PORTAL_KEYCODES["f11"] = 87
PORTAL_KEYCODES["f12"] = 88


def native(value):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, (list, tuple)):
        return [native(item) for item in value]
    if isinstance(value, dict):
        return {str(native(key)): native(item) for key, item in value.items()}
    try:
        return int(value)
    except Exception:
        pass
    try:
        return float(value)
    except Exception:
        pass
    return str(value)


def token(prefix):
    return f"{prefix}_{uuid.uuid4().hex}"


def lower_contains(haystack, needle):
    return needle.lower() in (haystack or "").lower()


def debug(message):
    if os.environ.get("CODEX_COMPUTER_USE_DEBUG"):
        print(f"[computer-use] {message}", file=sys.stderr, flush=True)


def session_bus():
    import dbus
    import dbus.mainloop.glib

    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    return dbus.SessionBus()


def ensure_portal_input(params):
    backend = params.get("backend")
    if backend is not None and str(backend).strip().lower() != "portal":
        raise ValueError("KDE Wayland foreground input is RemoteDesktop portal-only")


def current_pointer_position():
    data = run_kwin_script("cursor_position", {})
    return (float(data["x"]), float(data["y"]))


def pointer_animation_params(start_x, start_y, x, y):
    distance = ((x - start_x) ** 2 + (y - start_y) ** 2) ** 0.5
    if distance < 1:
        return (0, 1)
    duration_ms = round(80 + 55 * math.log2(1 + distance / 120))
    duration_ms = max(MIN_POINTER_ANIMATION_MS, min(MAX_POINTER_ANIMATION_MS, duration_ms))
    steps = math.ceil(duration_ms / POINTER_FRAME_MS)
    return (duration_ms, steps)


def minimum_jerk(t):
    t = max(0.0, min(1.0, float(t)))
    return t * t * t * (10 + t * (-15 + 6 * t))


def screenshot_helper_path():
    override = os.environ.get("CODEX_COMPUTER_USE_SCREENSHOT_HELPER")
    if override:
        return Path(override).expanduser()
    data_home = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local/share"))
    state_dir = Path(os.environ.get("CODEX_APP_STATE_DIR") or (data_home / "codex-app"))
    return state_dir / "computer-use" / "codex-computer-use-screenshot"


def glow_theme_path():
    override = os.environ.get("CODEX_COMPUTER_USE_CURSOR_GLOW_THEME_PATH")
    if override:
        return Path(override).expanduser()
    data_home = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local/share"))
    return data_home / "icons" / CURSOR_GLOW_THEME_NAME


class IsolatedSessionSupervisor:
    STATES = ("Stopped", "Starting", "Ready", "Failed", "Stopping")

    def __init__(self):
        self.state = "Stopped"
        self.session_id = None
        self.unit_name = None
        self.profile_dir = None
        self.runtime_dir = None
        self.process = None
        self.next_request_id = 1
        self.state_error = None
        self.state_lock = threading.RLock()
        self.operation_lock = threading.Lock()
        self.stderr_lock = threading.Lock()
        self.stderr_text = ""
        self.stderr_thread = None

    def start(self, params):
        timeout_ms = int(params.get("timeout_ms", 60000))
        screen_width = int(params.get("screen_width", 1280))
        screen_height = int(params.get("screen_height", 800))
        if screen_width < 320 or screen_width > 7680 or screen_height < 240 or screen_height > 4320:
            raise ValueError("isolated screen dimensions are outside the supported range")
        with self.state_lock:
            if self.state != "Stopped":
                raise RuntimeError(f"isolated session cannot start from state {self.state}")
            if not ISOLATED_SESSION_SCRIPT.is_file():
                raise RuntimeError(f"isolated session helper is missing: {ISOLATED_SESSION_SCRIPT}")
            self.state = "Starting"
            self.state_error = None
            with self.stderr_lock:
                self.stderr_text = ""
            self.session_id = "isolated-" + uuid.uuid4().hex
            unit_token = self.session_id.removeprefix("isolated-")[:20]
            self.unit_name = f"codex-computer-use-{unit_token}.scope"
            self.profile_dir = Path(tempfile.mkdtemp(prefix="codex-computer-use-profile-"))
            host_runtime = Path(os.environ.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}")
            self.runtime_dir = host_runtime / "codex-computer-use" / unit_token
            self.runtime_dir.mkdir(parents=True, mode=0o700)
            self.runtime_dir.chmod(0o700)
            command = [
                sys.executable,
                str(ISOLATED_SESSION_SCRIPT),
                "--session-id",
                self.session_id,
                "--profile-dir",
                str(self.profile_dir),
                "--runtime-dir",
                str(self.runtime_dir),
                "--screen-width",
                str(screen_width),
                "--screen-height",
                str(screen_height),
                "--timeout-ms",
                str(timeout_ms),
            ]
            self.process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
            self.stderr_thread = threading.Thread(
                target=self._drain_stderr,
                args=(self.process.stderr,),
                name="computer-use-isolated-stderr",
                daemon=True,
            )
            self.stderr_thread.start()
        try:
            message = self._read_message(timeout_ms / 1000.0)
            if message.get("event") != "state" or message.get("state") != "Ready":
                raise RuntimeError(message.get("error") or f"isolated helper returned invalid startup state: {message}")
            self._attach_process_tree_to_scope(min(5.0, timeout_ms / 1000.0))
            with self.state_lock:
                self.state = "Ready"
            return {"state": "Ready", "unit": self.unit_name, **message["result"]}
        except Exception as error:
            with self.state_lock:
                self.state = "Failed"
                self.state_error = str(error)
            self._terminate_unit(force=True)
            self._cleanup_paths()
            raise

    def call(self, method, params):
        timeout_ms = int(params.get("timeout_ms", 120000))
        self._require_session(params.get("session_id"), "Ready")
        with self.operation_lock:
            self._require_session(params.get("session_id"), "Ready")
            request_id = self.next_request_id
            self.next_request_id += 1
            request = {"id": request_id, "method": method, "params": params}
            try:
                self.process.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
                self.process.stdin.flush()
                message = self._read_message(timeout_ms / 1000.0)
            except Exception as error:
                with self.state_lock:
                    if self.state == "Stopped":
                        raise RuntimeError("isolated session stopped while the operation was in progress") from error
                    self.state = "Failed"
                    self.state_error = str(error)
                self._terminate_unit(force=True)
                raise
            if message.get("id") != request_id:
                raise RuntimeError(f"isolated helper response id mismatch: expected {request_id}, got {message.get('id')}")
            if not message.get("ok"):
                raise RuntimeError(message.get("error") or f"isolated operation failed: {method}")
            return message.get("result")

    def stop(self, params):
        force = bool(params.get("force", False))
        allow_stopped = bool(params.get("allow_stopped", False))
        requested_id = params.get("session_id")
        with self.state_lock:
            if self.state == "Stopped":
                if allow_stopped:
                    return {"state": "Stopped", "session_id": None}
                raise RuntimeError("no isolated session is running")
            if requested_id and requested_id != self.session_id:
                raise ValueError(f"unknown isolated session id: {requested_id}")
            stopped_id = self.session_id
            self.state = "Stopping"
        self._terminate_unit(force=force)
        self._cleanup_paths()
        with self.state_lock:
            self.state = "Stopped"
            self.session_id = None
            self.unit_name = None
            self.process = None
            self.state_error = None
            self.stderr_thread = None
        return {"state": "Stopped", "session_id": stopped_id, "forced": force}

    def status(self, params):
        requested_id = params.get("session_id")
        if requested_id and self.session_id and requested_id != self.session_id:
            raise ValueError(f"unknown isolated session id: {requested_id}")
        with self.state_lock:
            process_code = self.process.poll() if self.process is not None else None
            if self.state in ("Starting", "Ready") and process_code is not None:
                self.state = "Failed"
                self.state_error = self._stderr_tail() or f"isolated helper exited with code {process_code}"
            return {
                "state": self.state,
                "session_id": self.session_id,
                "unit": self.unit_name,
                "error": self.state_error,
                "isolation": "gui-profile" if self.session_id else None,
            }

    def _require_session(self, session_id, required_state):
        with self.state_lock:
            if not session_id or session_id != self.session_id:
                raise ValueError(f"unknown isolated session id: {session_id!r}")
            if self.state != required_state:
                raise RuntimeError(f"isolated session {session_id} is {self.state}, expected {required_state}")

    def _read_message(self, timeout_seconds):
        if self.process is None or self.process.stdout is None:
            raise RuntimeError("isolated helper process is unavailable")
        readable, _, _ = select.select([self.process.stdout.fileno()], [], [], max(0.001, timeout_seconds))
        if not readable:
            detail = self._stderr_tail()
            suffix = f": {detail}" if detail else ""
            raise TimeoutError(f"timed out waiting for isolated Computer Use helper{suffix}")
        line = self.process.stdout.readline()
        if not line:
            with contextlib.suppress(subprocess.TimeoutExpired):
                self.process.wait(timeout=0.5)
            raise RuntimeError(self._stderr_tail() or "isolated Computer Use helper closed its output")
        return json.loads(line)

    def _owned_process_ids(self):
        root_pid = self.process.pid
        selected = {root_pid}
        process_statuses = {}
        for entry in Path("/proc").iterdir():
            if not entry.name.isdigit():
                continue
            pid = int(entry.name)
            try:
                status = (entry / "status").read_text()
                parent_id = int(next(line for line in status.splitlines() if line.startswith("PPid:")).split()[1])
                state = next(line for line in status.splitlines() if line.startswith("State:")).split()[1]
                process_statuses[pid] = (parent_id, state)
            except (FileNotFoundError, PermissionError, StopIteration, ValueError):
                continue

        changed = True
        while changed:
            changed = False
            for pid, (parent_id, state) in process_statuses.items():
                if state not in ("X", "Z") and parent_id in selected and pid not in selected:
                    selected.add(pid)
                    changed = True
        return sorted(pid for pid in selected if process_statuses.get(pid, (None, "X"))[1] not in ("X", "Z"))

    def _freeze_process_tree(self, timeout_seconds):
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            process_ids = self._owned_process_ids()
            for pid in process_ids:
                with contextlib.suppress(ProcessLookupError, PermissionError):
                    os.kill(pid, signal.SIGSTOP)

            states = {}
            for pid in process_ids:
                try:
                    status = Path(f"/proc/{pid}/status").read_text()
                    states[pid] = next(line for line in status.splitlines() if line.startswith("State:")).split()[1]
                except (FileNotFoundError, PermissionError, StopIteration):
                    continue
            live_process_ids = sorted(pid for pid, state in states.items() if state not in ("X", "Z"))
            if live_process_ids and all(states[pid] in ("T", "t") for pid in live_process_ids):
                confirmed_process_ids = self._owned_process_ids()
                if set(confirmed_process_ids).issubset(live_process_ids):
                    return live_process_ids
            time.sleep(0.01)
        raise TimeoutError("isolated process tree did not freeze for cgroup attachment")

    def _attach_process_tree_to_scope(self, timeout_seconds):
        process_ids = self._freeze_process_tree(timeout_seconds)
        scope_created = False
        command = [
            "busctl",
            "--user",
            "call",
            "org.freedesktop.systemd1",
            "/org/freedesktop/systemd1",
            "org.freedesktop.systemd1.Manager",
            "StartTransientUnit",
            "ssa(sv)a(sa(sv))",
            self.unit_name,
            "fail",
            "2",
            "PIDs",
            "au",
            str(len(process_ids)),
            *[str(pid) for pid in process_ids],
            "TimeoutStopUSec",
            "t",
            "3000000",
            "0",
        ]
        try:
            result = subprocess.run(
                command,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout_seconds,
            )
            if result.returncode != 0:
                detail = result.stderr.strip() or result.stdout.strip()
                raise RuntimeError(f"could not create isolated Computer Use scope: {detail}")
            scope_created = True

            deadline = time.monotonic() + timeout_seconds
            while time.monotonic() < deadline:
                unattached = []
                for pid in process_ids:
                    try:
                        cgroup = Path(f"/proc/{pid}/cgroup").read_text()
                    except FileNotFoundError:
                        continue
                    if f"/{self.unit_name}" not in cgroup:
                        unattached.append(pid)
                if not unattached:
                    break
                time.sleep(0.01)
            else:
                raise TimeoutError(f"isolated process tree was not attached to {self.unit_name}: {unattached}")

            resumed = subprocess.run(
                ["systemctl", "--user", "kill", "--kill-whom=all", "--signal=CONT", self.unit_name],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                timeout=timeout_seconds,
            )
            if resumed.returncode != 0:
                raise RuntimeError(f"could not resume isolated Computer Use scope: {resumed.stderr.strip()}")
        except Exception:
            if scope_created:
                subprocess.run(
                    ["systemctl", "--user", "kill", "--kill-whom=all", "--signal=KILL", self.unit_name],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=5,
                    check=False,
                )
            else:
                for pid in process_ids:
                    with contextlib.suppress(ProcessLookupError, PermissionError):
                        os.kill(pid, signal.SIGKILL)
            raise

    def _terminate_unit(self, force):
        if not self.unit_name:
            return
        if force:
            command = ["systemctl", "--user", "kill", "--kill-whom=all", "--signal=KILL", self.unit_name]
        else:
            command = ["systemctl", "--user", "stop", self.unit_name]
        result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=False)
        if result.returncode != 0 and self.process is not None and self.process.poll() is None:
            process_ids = self._owned_process_ids()
            requested_signal = signal.SIGKILL if force else signal.SIGTERM
            for pid in process_ids:
                with contextlib.suppress(ProcessLookupError, PermissionError):
                    os.kill(pid, requested_signal)
        if self.process is not None:
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                for pid in self._owned_process_ids():
                    with contextlib.suppress(ProcessLookupError, PermissionError):
                        os.kill(pid, signal.SIGKILL)
                with contextlib.suppress(subprocess.TimeoutExpired):
                    self.process.wait(timeout=2)
        if self.stderr_thread is not None:
            self.stderr_thread.join(timeout=1)
        subprocess.run(
            ["systemctl", "--user", "reset-failed", self.unit_name],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )

    def _drain_stderr(self, stream):
        for line in stream:
            with self.stderr_lock:
                self.stderr_text = (self.stderr_text + line)[-4000:]

    def _stderr_tail(self):
        with self.stderr_lock:
            return self.stderr_text.strip()

    def _cleanup_paths(self):
        if self.runtime_dir is not None:
            shutil.rmtree(self.runtime_dir, ignore_errors=True)
            parent = self.runtime_dir.parent
            with contextlib.suppress(OSError):
                parent.rmdir()
        if self.profile_dir is not None:
            shutil.rmtree(self.profile_dir, ignore_errors=True)
        self.runtime_dir = None
        self.profile_dir = None


class AccessibilityLookStore:
    def __init__(self, limit=32):
        self.limit = limit
        self.looks = OrderedDict()
        self.lock = threading.RLock()

    def begin(self, root_identity):
        look_id = "look-" + uuid.uuid4().hex
        with self.lock:
            self.looks[look_id] = {"root_identity": root_identity, "bindings": OrderedDict()}
            self.looks.move_to_end(look_id)
            while len(self.looks) > self.limit:
                self.looks.popitem(last=False)
        return look_id

    def bind(self, look_id, kind, target, capabilities=None):
        with self.lock:
            look = self.looks.get(look_id)
            if look is None:
                raise ValueError(f"stale accessibility look: {look_id}")
            wire_ref = f"wire-{len(look['bindings']) + 1}"
            look["bindings"][wire_ref] = {
                "kind": kind,
                "target": target,
                "capabilities": list(capabilities or []),
            }
            return wire_ref

    def require(self, look_id, wire_ref, root_identity=None):
        with self.lock:
            look = self.looks.get(look_id)
            if look is None:
                raise ValueError(f"stale accessibility look: {look_id}; call observe_ui again")
            if root_identity is not None and look["root_identity"] != root_identity:
                raise ValueError("accessibility look is bound to a different UI root")
            binding = look["bindings"].get(wire_ref)
            if binding is None:
                raise ValueError(f"wire ref {wire_ref!r} is not bound to look {look_id}")
            return binding

    def bindings(self, look_id):
        with self.lock:
            look = self.looks.get(look_id)
            if look is None:
                raise ValueError(f"stale accessibility look: {look_id}; call observe_ui again")
            return list(look["bindings"].values())


class EventJournal:
    EVENT_NAMES = (
        "object:text-changed",
        "object:children-changed",
        "object:state-changed",
        "window:create",
        "window:destroy",
        "window:activate",
        "window:deactivate",
        "window:move",
        "window:resize",
    )

    def __init__(self, limit=512):
        self.limit = limit
        self.events = deque(maxlen=limit)
        self.sequence = 0
        self.resource_sequences = {}
        self.condition = threading.Condition()
        self.started = False
        self.start_lock = threading.Lock()

    def ensure_started(self):
        with self.start_lock:
            if self.started:
                return
            import pyatspi

            for event_name in self.EVENT_NAMES:
                pyatspi.Registry.registerEventListener(self._on_atspi_event, event_name)
            thread = threading.Thread(
                target=pyatspi.Registry.start,
                kwargs={"asynchronous": False, "gil": True},
                daemon=True,
                name="computer-use-atspi-events",
            )
            thread.start()
            self.started = True

    def _on_atspi_event(self, event):
        source = getattr(event, "source", None)
        pid = accessible_process_id(source) if source is not None else 0
        self.record(
            str(getattr(event, "type", "at-spi")),
            {
                "pid": pid,
                "name": safe_attr(source, "name") if source is not None else "",
            },
            f"desktop-pid:{pid}" if pid > 0 else None,
        )

    def record(self, event_type, details=None, resource_key=None):
        with self.condition:
            self.sequence += 1
            if resource_key is not None:
                self.resource_sequences[resource_key] = self.sequence
            self.events.append(
                {
                    "sequence": self.sequence,
                    "type": event_type,
                    "details": details or {},
                    "resource_key": resource_key,
                    "time": time.monotonic(),
                }
            )
            self.condition.notify_all()
            return self.sequence

    def snapshot(self, resource_key):
        with self.condition:
            return self.resource_sequences.get(resource_key, 0)

    def wait_after(self, resource_key, sequence, timeout_seconds):
        with self.condition:
            deadline = time.monotonic() + max(0.0, timeout_seconds)
            while self.resource_sequences.get(resource_key, 0) <= sequence:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self.condition.wait(timeout=remaining)
            return self.resource_sequences.get(resource_key, sequence)


class Broker:
    def __init__(self, pointer_visuals=True):
        self.portal = None
        self.glow = CursorGlowTheme() if pointer_visuals else None
        self.foreground_lock = threading.RLock()
        self.isolated = IsolatedSessionSupervisor()
        self.looks = AccessibilityLookStore()
        self.events = EventJournal()
        self.physical_executor = None
        self.pointer_restorer = None

    def handle(self, method, params):
        if method == "isolated_start":
            return self.isolated.start(params)
        if method == "isolated_stop":
            return self.isolated.stop(params)
        if method == "isolated_status":
            return self.isolated.status(params)
        if params.get("session_id"):
            return self.isolated.call(method, params)
        handlers = {
            "find_roots": self.find_roots,
            "observe_root": self.observe_root,
            "read_text": self.read_text_v2,
            "act_transaction": self.act_transaction,
            "wait_for": self.wait_for_v2,
        }
        handler = handlers.get(method)
        if handler is not None:
            return handler(params)
        raise ValueError(f"unknown method: {method}")

    def find_roots(self, params):
        kind = str(params.get("kind") or "window")
        if kind not in ("window", "application", "tray_item", "all"):
            raise ValueError(f"unknown root kind: {kind}")
        query = str(params.get("query") or "").strip().lower()
        limit = max(1, min(200, int(params.get("limit", 50))))
        roots = []
        if kind in ("window", "all"):
            windows = self.list_windows(
                {
                    "app": params.get("query"),
                    "include_special": params.get("include_special", False),
                    "include_minimized": params.get("include_minimized", True),
                    "detail": "full",
                    "limit": limit,
                }
            ).get("windows", [])
            for window in windows:
                pid = accessibility_target_pid(window)
                roots.append(
                    {
                        "kind": "window",
                        "backend_ref": str(window.get("id") or ""),
                        "resource_key": f"desktop-pid:{pid}",
                        "title": window_title(window),
                        "app": str(window.get("resourceClass") or ""),
                        "pid": pid,
                        "active": bool(window.get("active")),
                        "minimized": bool(window.get("minimized")),
                        "frame_geometry": window.get("frame_geometry"),
                        "buffer_geometry": window.get("buffer_geometry"),
                    }
                )
        if kind in ("application", "all"):
            apps = self.list_apps(
                {
                    "query": params.get("query"),
                    "include_hidden": params.get("include_hidden", False),
                    "limit": limit,
                }
            ).get("apps", [])
            for app in apps:
                desktop_id = str(app.get("desktop_id") or "")
                roots.append(
                    {
                        "kind": "application",
                        "backend_ref": desktop_id,
                        "resource_key": f"application:{desktop_id}",
                        **app,
                    }
                )
        if kind in ("tray_item", "all"):
            tray_items = self.list_tray_items({"query": params.get("query"), "limit": limit}).get("items", [])
            for item in tray_items:
                if query and not tray_item_matches(item, query):
                    continue
                item_ref = str(item.get("ref") or "")
                owner_pid = int(item.get("owner_pid") or 0)
                roots.append(
                    {
                        "kind": "tray_item",
                        "backend_ref": item_ref,
                        "resource_key": f"desktop-pid:{owner_pid}" if owner_pid > 0 else f"tray:{item_ref}",
                        **item,
                    }
                )
        return {
            "protocol_version": COMPUTER_USE_PROTOCOL_VERSION,
            "roots": roots[:limit],
            "truncated": len(roots) > limit,
        }

    def observe_root(self, params):
        return self._observe_root(
            params["root"],
            bool(params.get("include_image", True)),
            int(params.get("max_depth") or 8),
            int(params.get("max_nodes") or 500),
            int(params.get("timeout_ms") or 120000),
            allow_missing=False,
        )

    def _observe_root(self, root, include_image, max_depth, max_nodes, timeout_ms, allow_missing):
        kind = str(root.get("kind") or "")
        if kind == "window":
            window = resolve_exact_root_window(root, self.list_windows, allow_missing=allow_missing)
            if window is None:
                return missing_window_observation(root, self.looks)
            root_identity = ui_root_identity(root)
            tree = read_accessibility_tree(
                {
                    "target_window": window,
                    "max_depth": max_depth,
                    "max_nodes": max_nodes,
                },
                look_store=self.looks,
                root_identity=root_identity,
            )
            png = capture_kwin_screenshot_png(
                None,
                max(0.1, timeout_ms / 1000.0),
                window_id=window.get("id"),
            )
            transform = map_accessibility_to_window_image(tree, window, png)
            backend_root = {
                **root,
                "pid": accessibility_target_pid(window),
                "title": window_title(window),
                "frame_geometry": window.get("frame_geometry"),
                "buffer_geometry": window.get("buffer_geometry"),
                "backend_coordinate_transform": transform,
            }
            observation = {
                "protocol_version": COMPUTER_USE_PROTOCOL_VERSION,
                "look_id": tree["look_id"],
                "captured_at": time.time(),
                "root": public_ui_root(backend_root),
                "backend_root": backend_root,
                "window": public_window(window, "summary"),
                "coordinate_space": {
                    "name": "window-image-px",
                    "width": png["width"],
                    "height": png["height"],
                    "window_id": str(window.get("id") or ""),
                    "accessibility_source_space": transform["accessibility_source_space"],
                    "scale_x": transform["scale_x"],
                    "scale_y": transform["scale_y"],
                },
                "outline": {
                    "nodes": tree["nodes"],
                    "truncated": tree["truncated"],
                },
            }
            if include_image:
                observation["image"] = screenshot_payload(png)
            return observation
        if kind == "application":
            try:
                entry = resolve_exact_application_root(root)
            except ValueError:
                if allow_missing:
                    return missing_window_observation(root, self.looks)
                raise
            return synthetic_root_observation(root, "application", entry, self.looks)
        if kind == "tray_item":
            try:
                item = resolve_exact_tray_root(root)
            except ValueError:
                if allow_missing:
                    return missing_window_observation(root, self.looks)
                raise
            return synthetic_root_observation(root, "tray_item", item, self.looks)
        raise ValueError(f"unknown UI root kind: {kind}")

    def _probe_condition_observation(self, root):
        if root.get("kind") != "window":
            return self._observe_root(root, False, 8, 500, 5000, allow_missing=True)
        window = resolve_exact_root_window(root, self.list_windows, allow_missing=True)
        if window is None:
            return missing_window_observation(root, self.looks)
        tree = read_accessibility_tree(
            {"target_window": window, "max_depth": 8, "max_nodes": 500},
            look_store=self.looks,
            root_identity=ui_root_identity(root),
        )
        return {"outline": {"nodes": tree["nodes"], "truncated": tree["truncated"]}}

    def read_text_v2(self, params):
        binding = self.looks.require(
            params["look_id"],
            params["wire_ref"],
            ui_root_identity(params["root"]),
        )
        text, value = read_binding_text(binding, int(params.get("start", 0)), int(params.get("end", -1)))
        return {
            "lookId": params["look_id"],
            "text": text,
            "value": value,
            "selection": read_binding_selection(binding),
        }

    def act_transaction(self, params):
        root = params["root"]
        look_id = params["look_id"]
        actions = params.get("actions") or []
        if not actions:
            raise ValueError("act_transaction requires at least one action")
        policy = str(params.get("policy") or "auto")
        if policy not in ("semantic_only", "auto", "foreground"):
            raise ValueError(f"unknown action policy: {policy}")
        timeout_ms = int(params.get("timeout_ms") or 120000)
        evidence = []
        lease = None
        final_observation = None
        with self.foreground_lock:
            try:
                if root.get("kind") == "window":
                    validate_root_geometry(root, self.list_windows)
                for action in actions:
                    action_evidence, lease = self._execute_v2_action(root, look_id, action, policy, lease)
                    evidence.append(action_evidence)
                expect = params.get("expect")
                expectation = None
                if expect:
                    expectation = self._wait_for_condition(root, look_id, expect, timeout_ms)
                    evidence.append(expectation)
                final_observation = self._observe_root(
                    root,
                    bool(params.get("include_image", True)),
                    8,
                    500,
                    timeout_ms,
                    allow_missing=True,
                )
            finally:
                if lease is not None:
                    evidence.append(lease.release())
        return {
            "outcome": transaction_outcome(evidence, bool(params.get("expect"))),
            "evidence": evidence,
            "observation": final_observation,
        }

    def _execute_v2_action(self, root, look_id, action, policy, lease):
        op = str(action.get("op") or "")
        binding = None
        if action.get("wire_ref"):
            binding = self.looks.require(look_id, action["wire_ref"], ui_root_identity(root))
        if op in ("press", "set_text") and policy != "foreground":
            semantic = self._execute_semantic_action(root, binding, op, action)
            if semantic["outcome"] != "didnt" or policy == "semantic_only":
                return semantic, lease
            if not semantic.get("side_effect_free", False):
                return semantic, lease
        if policy == "semantic_only":
            return {
                "op": op,
                "backend": "semantic",
                "outcome": "didnt",
                "reason": "operation has no semantic implementation",
                "side_effect_free": True,
            }, lease
        if root.get("kind") != "window":
            raise ValueError(f"foreground delivery requires a window root, received {root.get('kind')}")
        if lease is None:
            lease = ForegroundLease(self, root)
            lease.acquire()
        else:
            lease.validate()
        if op in ("press", "click", "set_text", "scroll", "drag"):
            lease.ensure_pointer_visual()
        executor = self.physical_executor or self._execute_foreground_action
        return executor(root, binding, op, action), lease

    def _execute_semantic_action(self, root, binding, op, action):
        if binding is None:
            return {
                "op": op,
                "backend": "semantic",
                "outcome": "didnt",
                "reason": "semantic action requires an element ref",
                "side_effect_free": True,
            }
        if binding["kind"] == "application":
            if op != "press":
                return {"op": op, "backend": "desktop-entry", "outcome": "didnt", "side_effect_free": True}
            process = launch_desktop_entry(binding["target"])
            self.events.record("application:launched", {"pid": process.pid}, root.get("resource_key"))
            return {"op": op, "backend": "desktop-entry", "outcome": "unknown", "delivered": True, "pid": process.pid}
        if binding["kind"] == "tray_item":
            if op != "press":
                return {"op": op, "backend": "status-notifier", "outcome": "didnt", "side_effect_free": True}
            call_status_notifier_item_action(binding["target"], "activate", 0, 0)
            self.events.record("tray:activated", {"ref": binding["target"].get("ref")}, root.get("resource_key"))
            return {"op": op, "backend": "status-notifier", "outcome": "unknown", "delivered": True}
        accessible = binding["target"]
        if op == "press":
            try:
                interface = accessible.queryAction()
            except Exception:
                return {
                    "op": op,
                    "backend": "at-spi-action",
                    "outcome": "didnt",
                    "reason": "Action interface unavailable",
                    "side_effect_free": True,
                }
            action_index = preferred_accessible_action(interface)
            delivered = bool(interface.doAction(action_index))
            return {
                "op": op,
                "backend": "at-spi-action",
                "outcome": "unknown" if delivered else "didnt",
                "delivered": delivered,
                "action_index": action_index,
                "side_effect_free": not delivered,
            }
        if op == "set_text":
            text = action.get("text")
            if not isinstance(text, str):
                raise ValueError("set_text requires text")
            before = accessible_text(accessible)
            try:
                editable = accessible.queryEditableText()
            except Exception:
                return {
                    "op": op,
                    "backend": "at-spi-editable-text",
                    "outcome": "didnt",
                    "reason": "EditableText interface unavailable",
                    "side_effect_free": True,
                }
            delivered = bool(editable.setTextContents(text))
            after = accessible_text(accessible)
            verified = after == text
            return {
                "op": op,
                "backend": "at-spi-editable-text",
                "outcome": "worked" if verified else "didnt",
                "delivered": delivered,
                "verified": verified,
                "side_effect_free": not delivered and after == before,
            }
        return {"op": op, "backend": "semantic", "outcome": "didnt", "side_effect_free": True}

    def _execute_foreground_action(self, root, binding, op, action):
        if op in ("press", "click"):
            x, y = foreground_action_point(root, binding, action)
            delivery = self.click_foreground({"x": x, "y": y, "button": action.get("button", "left"), "count": action.get("count", 1)})
        elif op == "drag":
            x, y = foreground_action_point(root, binding, action)
            to_x, to_y = map_window_image_point(root, action.get("to_x"), action.get("to_y"))
            delivery = self.drag_foreground({"x": x, "y": y, "to_x": to_x, "to_y": to_y, "button": action.get("button", "left")})
        elif op == "scroll":
            delivery_params = {"dx": action.get("dx", 0), "dy": action.get("dy", 0), "steps": 1}
            if binding is not None or (action.get("x") is not None and action.get("y") is not None):
                delivery_params["x"], delivery_params["y"] = foreground_action_point(root, binding, action)
            delivery = self.scroll_foreground(delivery_params)
        elif op == "key":
            if not action.get("key"):
                raise ValueError("key action requires key")
            delivery = self.key_foreground({"key": action["key"], "modifiers": action.get("modifiers") or [], "repeat": 1})
        elif op == "type_text":
            if not isinstance(action.get("text"), str):
                raise ValueError("type_text requires text")
            delivery = self.type_text_foreground({"text": action["text"]})
        elif op == "set_text":
            if binding is None:
                raise ValueError("foreground set_text requires an element ref")
            x, y = foreground_action_point(root, binding, action)
            self.click_foreground({"x": x, "y": y, "button": "left", "count": 1})
            self.key_foreground({"key": "a", "modifiers": ["ctrl"], "repeat": 1})
            delivery = self.type_text_foreground({"text": action.get("text", "")})
        else:
            raise ValueError(f"unknown UI action: {op}")
        return {"op": op, "backend": delivery.get("backend", "foreground"), "outcome": "unknown", "delivered": True}

    def _wait_for_condition(self, root, look_id, expect, timeout_ms):
        self.events.ensure_started()
        deadline = time.monotonic() + max(0, int(expect.get("timeout_ms", timeout_ms))) / 1000.0
        resource_key = str(root.get("resource_key") or ui_root_identity(root))
        sequence = self.events.snapshot(resource_key)
        while True:
            if expect.get("wire_ref"):
                matched, observed = evaluate_expectation(self.looks, look_id, expect)
            else:
                probe = self._probe_condition_observation(root)
                matched, observed = evaluate_observation_expectation(probe, expect)
            if matched:
                return {
                    "backend": "event-journal+authoritative-read",
                    "outcome": "worked",
                    "matched": True,
                    "observed": observed,
                }
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return {
                    "backend": "event-journal+authoritative-read",
                    "outcome": "didnt",
                    "matched": False,
                    "observed": observed,
                }
            sequence = self.events.wait_after(resource_key, sequence, min(remaining, 0.25))

    def wait_for_v2(self, params):
        evidence = self._wait_for_condition(
            params["root"],
            params["look_id"],
            params["expect"],
            int(params.get("timeout_ms") or 5000),
        )
        observation = self._observe_root(
            params["root"],
            bool(params.get("include_image", True)),
            8,
            500,
            int(params.get("timeout_ms") or 5000),
            allow_missing=True,
        )
        return {"outcome": evidence["outcome"], "evidence": [evidence], "observation": observation}

    def ensure_portal(self):
        if self.portal is None:
            self.portal = PortalSession()
        return self.portal

    def list_windows(self, params):
        data = run_kwin_script("list", {})
        windows = data.get("windows", [])
        app_filter = params.get("app")
        include_special = params.get("include_special", False)
        include_minimized = params.get("include_minimized", True)
        detail = str(params.get("detail") or "summary").strip().lower()
        if detail not in ("summary", "full"):
            raise ValueError(f"unknown window detail: {detail}")
        limit = max(1, min(200, int(params.get("limit", 50))))
        filtered = []
        for window in windows:
            if not include_special and (
                window.get("specialWindow") or window.get("dock") or window.get("desktopWindow")
            ):
                continue
            if not include_minimized and window.get("minimized"):
                continue
            if app_filter:
                joined = " ".join(
                    str(window.get(key, ""))
                    for key in ("caption", "resourceClass", "resourceName", "desktopFileName")
                )
                if not lower_contains(joined, app_filter):
                    continue
            filtered.append(window)
        visible = filtered[:limit]
        return {
            "backend": "kwin-scripting",
            "desktop": desktop_summary(),
            "virtual_desktops": data.get("virtual_desktops", []),
            "current_virtual_desktop": data.get("current_virtual_desktop"),
            "detail": detail,
            "matched_count": len(filtered),
            "limit": limit,
            "truncated": len(filtered) > limit,
            "windows": [public_window(window, detail) for window in visible],
            "active_window_id": data.get("active_window_id"),
        }

    def list_apps(self, params):
        query = str(params.get("query") or "").strip().lower()
        include_hidden = bool(params.get("include_hidden", False))
        limit = max(1, min(200, int(params.get("limit", 50))))
        entries = find_desktop_entries()
        ranked = []
        for index, entry in enumerate(entries):
            if not include_hidden and (entry.get("hidden") or entry.get("no_display")):
                continue
            rank = desktop_entry_rank(entry, query)
            if rank is None:
                continue
            ranked.append((rank, index, entry))
        ranked.sort(key=lambda item: (item[0], item[2].get("name", "").lower(), item[1]))
        apps = [public_desktop_entry(entry) for _, _, entry in ranked[:limit]]
        return {
            "backend": "desktop-entry",
            "query": params.get("query", ""),
            "include_hidden": include_hidden,
            "limit": limit,
            "matched_count": len(ranked),
            "truncated": len(ranked) > limit,
            "apps": apps,
        }

    def list_tray_items(self, params):
        query = str(params.get("query") or "").strip().lower()
        limit = max(1, min(200, int(params.get("limit", 50))))
        include_errors = bool(params.get("include_errors", False))
        data = read_status_notifier_items()
        ranked = []
        for index, item in enumerate(data["items"]):
            if query and not tray_item_matches(item, query):
                continue
            ranked.append((tray_item_rank(item, query), index, item))
        ranked.sort(key=lambda item: (item[0], item[2].get("title", "").lower(), item[1]))
        result = {
            "backend": "kde-status-notifier",
            "query": params.get("query", ""),
            "limit": limit,
            "matched_count": len(ranked),
            "truncated": len(ranked) > limit,
            "items": [item for _, _, item in ranked[:limit]],
            "error_count": len(data["errors"]),
        }
        if include_errors:
            result["errors"] = data["errors"]
        return result

    def click_foreground(self, params):
        x = float(params["x"])
        y = float(params["y"])
        button = params.get("button", "left")
        count = int(params.get("count", 1))
        interval = int(params.get("interval_ms", 120)) / 1000.0
        ensure_portal_input(params)
        portal = self.ensure_portal()
        portal.ensure_remote(180.0)
        animation = self.move_pointer(portal, x, y, params)
        for i in range(count):
            portal.pointer_button(button, True)
            time.sleep(0.04)
            portal.pointer_button(button, False)
            if i + 1 < count and interval > 0:
                time.sleep(interval)
        return {
            "clicked": True,
            "backend": "xdg-desktop-portal",
            "x": x,
            "y": y,
            "button": button,
            "count": count,
            **animation,
        }

    def drag_foreground(self, params):
        x = float(params["x"])
        y = float(params["y"])
        to_x = float(params["to_x"])
        to_y = float(params["to_y"])
        button = params.get("button", "left")
        steps = int(params.get("steps", 20))
        duration = int(params.get("duration_ms", 500)) / 1000.0
        ensure_portal_input(params)
        portal = self.ensure_portal()
        portal.ensure_remote(180.0)
        self.move_pointer(portal, x, y, params)
        portal.pointer_button(button, True)
        delay = duration / max(steps, 1)
        for step in range(1, steps + 1):
            t = step / steps
            portal.pointer_move(x + (to_x - x) * t, y + (to_y - y) * t)
            if delay > 0:
                time.sleep(delay)
        portal.pointer_button(button, False)
        return {"dragged": True, "backend": "xdg-desktop-portal", "from": [x, y], "to": [to_x, to_y], "button": button}


    def scroll_foreground(self, params):
        dx = float(params.get("dx", 0))
        dy = float(params.get("dy", 0))
        steps = int(params.get("steps", 1))
        ensure_portal_input(params)
        portal = self.ensure_portal()
        portal.ensure_remote(180.0)
        if "x" in params and "y" in params:
            self.move_pointer(portal, float(params["x"]), float(params["y"]), params)
        for index in range(steps):
            portal.pointer_axis(dx, dy, index + 1 == steps)
        return {"scrolled": True, "backend": "xdg-desktop-portal", "dx": dx, "dy": dy, "steps": steps}

    def move_pointer(self, portal, x, y, params):
        start_x, start_y = current_pointer_position()
        duration_ms, steps = pointer_animation_params(start_x, start_y, x, y)
        if duration_ms <= 0 or steps <= 1:
            portal.pointer_move(x, y)
            return {"animated": False, "animation_steps": 1, "animation_ms": 0}

        delay = duration_ms / 1000.0 / steps
        for step in range(1, steps + 1):
            t = minimum_jerk(step / steps)
            next_x = start_x + (x - start_x) * t
            next_y = start_y + (y - start_y) * t
            portal.pointer_move(next_x, next_y)
            if step < steps and delay > 0:
                time.sleep(delay)
        return {"animated": True, "animation_steps": steps, "animation_ms": duration_ms}


    def key_foreground(self, params):
        key = params["key"]
        modifiers = params.get("modifiers") or []
        repeat = int(params.get("repeat", 1))
        ensure_portal_input(params)
        portal = self.ensure_portal()
        portal.ensure_remote(180.0)
        for _ in range(repeat):
            portal.key_combo(key, modifiers)
        return {"pressed": True, "backend": "xdg-desktop-portal", "key": key, "modifiers": modifiers, "repeat": repeat}


    def type_text_foreground(self, params):
        text = params["text"]
        ensure_portal_input(params)
        portal = self.ensure_portal()
        portal.ensure_remote(180.0)
        for char in text:
            portal.key_char(char)
        if params.get("submit", False):
            portal.key_combo("enter", [])
        return {
            "typed": True,
            "backend": "xdg-desktop-portal",
            "method": "keysyms",
            "characters": len(text),
            "submitted": bool(params.get("submit", False)),
        }


    def stop(self):
        self.isolated.stop({"force": True, "allow_stopped": True})


class CursorGlowTheme:
    def __init__(self, theme_path=None, apply_command=None, read_command=None, lock_path=None):
        self.theme_name = CURSOR_GLOW_THEME_NAME
        self.theme_path = Path(theme_path or glow_theme_path())
        self.apply_command = Path(apply_command or "/usr/bin/plasma-apply-cursortheme")
        self.read_command = Path(read_command or "/usr/bin/kreadconfig6")
        self.lock_path = Path(lock_path) if lock_path else None
        self.lock_file = None
        self.original_theme = None
        self.original_size = None
        self.active = False
        self.disabled = os.environ.get("CODEX_COMPUTER_USE_CURSOR_GLOW", "1").strip().lower() in ("0", "false", "no")

    def metadata(self):
        index_path = self.theme_path / "index.theme"
        if not index_path.is_file():
            raise RuntimeError(f"Computer Use cursor glow theme is not installed: {index_path}")
        parser = configparser.ConfigParser(interpolation=None)
        parser.read(index_path, encoding="utf-8")
        try:
            section = parser["Icon Theme"]
            base_theme = section["X-Codex-BaseTheme"].strip()
            base_size = int(section["X-Codex-BaseSize"])
            animation = section["X-Codex-Animation"].strip()
        except (KeyError, ValueError) as error:
            raise RuntimeError(f"Computer Use cursor glow theme metadata is invalid: {index_path}") from error
        if not base_theme or base_size <= 0 or animation != "outward-edge-diffusion":
            raise RuntimeError(f"Computer Use cursor glow theme metadata is invalid: {index_path}")
        return {"base_theme": base_theme, "base_size": base_size}

    def runtime_lock_path(self):
        if self.lock_path is not None:
            return self.lock_path
        runtime_dir = os.environ.get("XDG_RUNTIME_DIR")
        if not runtime_dir:
            raise RuntimeError("XDG_RUNTIME_DIR is required for Computer Use cursor glow ownership")
        return Path(runtime_dir) / "codex-computer-use-cursor-glow.lock"

    def acquire_lock(self):
        lock_path = self.runtime_lock_path()
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        self.lock_file = lock_path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(self.lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            self.lock_file.close()
            self.lock_file = None
            raise RuntimeError("Another foreground transaction owns the global cursor glow theme") from error

    def release_lock(self):
        if self.lock_file is None:
            return
        fcntl.flock(self.lock_file.fileno(), fcntl.LOCK_UN)
        self.lock_file.close()
        self.lock_file = None

    def read_setting(self, key):
        if not self.read_command.is_file() or not os.access(self.read_command, os.X_OK):
            raise RuntimeError(f"Computer Use cursor setting reader is unavailable: {self.read_command}")
        result = subprocess.run(
            [str(self.read_command), "--file", "kcminputrc", "--group", "Mouse", "--key", key],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=CURSOR_THEME_COMMAND_TIMEOUT_SECONDS,
            check=False,
        )
        if result.returncode != 0:
            details = result.stderr.strip() or result.stdout.strip()
            raise RuntimeError(f"Failed to read Plasma cursor setting {key}: {details}")
        value = result.stdout.strip()
        if not value:
            raise RuntimeError(f"Plasma cursor setting {key} is empty")
        return value

    def current_theme(self):
        theme = self.read_setting("cursorTheme")
        size_text = self.read_setting("cursorSize")
        try:
            size = int(size_text)
        except ValueError as error:
            raise RuntimeError(f"Plasma cursor size is invalid: {size_text}") from error
        if size <= 0:
            raise RuntimeError(f"Plasma cursor size is invalid: {size_text}")
        return theme, size

    def apply_theme(self, theme, size):
        if not self.apply_command.is_file() or not os.access(self.apply_command, os.X_OK):
            raise RuntimeError(f"Plasma cursor theme command is unavailable: {self.apply_command}")
        result = subprocess.run(
            [str(self.apply_command), theme, "--size", str(size)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=CURSOR_THEME_COMMAND_TIMEOUT_SECONDS,
            check=False,
        )
        if result.returncode != 0:
            details = result.stderr.strip() or result.stdout.strip()
            raise RuntimeError(f"Failed to apply Plasma cursor theme {theme}: {details}")
        current_theme, current_size = self.current_theme()
        if current_theme != theme or current_size != size:
            raise RuntimeError(
                f"Plasma did not activate cursor theme {theme} at size {size}: active={current_theme} size={current_size}"
            )

    def start(self):
        if self.disabled:
            self.active = False
            return
        if self.active:
            return
        try:
            metadata = self.metadata()
            self.acquire_lock()
            current_theme, current_size = self.current_theme()
            if current_size != metadata["base_size"]:
                raise RuntimeError(
                    "Computer Use cursor glow theme size no longer matches Plasma; reactivate the staged install"
                )
            if current_theme == self.theme_name:
                self.original_theme = metadata["base_theme"]
            elif current_theme == metadata["base_theme"]:
                self.original_theme = current_theme
                self.apply_theme(self.theme_name, current_size)
            else:
                raise RuntimeError(
                    "Computer Use cursor glow theme was generated for a different Plasma cursor theme; "
                    "reactivate the staged install"
                )
            self.original_size = current_size
            self.active = True
        except Exception:
            self.active = False
            self.original_theme = None
            self.original_size = None
            self.release_lock()
            raise

    def stop(self):
        if not self.active:
            self.release_lock()
            return
        self.apply_theme(self.original_theme, self.original_size)
        self.active = False
        self.original_theme = None
        self.original_size = None
        self.release_lock()


def capture_kwin_screenshot_png(crop, timeout_seconds, env=None, window_id=None):
    helper = screenshot_helper_path()
    if not helper.is_file():
        raise RuntimeError(f"Computer Use screenshot helper is not installed: {helper}")
    if not os.access(helper, os.X_OK):
        raise RuntimeError(f"Computer Use screenshot helper is not executable: {helper}")

    if window_id is not None:
        args = [str(helper), "--window", str(window_id)]
    elif crop is None:
        args = [str(helper), "--workspace"]
    else:
        left = int(round(float(crop["x"])))
        top = int(round(float(crop["y"])))
        width = int(round(float(crop["width"])))
        height = int(round(float(crop["height"])))
        args = [str(helper), "--area", str(left), str(top), str(width), str(height)]

    try:
        result = subprocess.run(
            args,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=max(float(timeout_seconds), 0.1),
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise TimeoutError(f"timed out waiting for Computer Use screenshot helper: {helper}") from error

    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"exit code {result.returncode}"
        raise RuntimeError(f"Computer Use screenshot helper failed: {detail}")

    try:
        payload = json.loads(result.stdout)
        png_bytes = base64.b64decode(payload["data_base64"], validate=True)
    except Exception as error:
        raise RuntimeError(f"Computer Use screenshot helper returned invalid output: {error}") from error

    if not png_bytes:
        raise RuntimeError("Computer Use screenshot helper returned an empty image")

    return {
        "bytes": png_bytes,
        "width": int(payload["width"]),
        "height": int(payload["height"]),
        "cropped": bool(payload["cropped"]),
        "scale": payload.get("scale"),
        "format": int(payload["format"]),
    }


class PortalSession:
    def __init__(self):
        import dbus
        import dbus.mainloop.glib

        self.dbus = dbus
        self.bus = session_bus()
        self.portal_object = self.bus.get_object(PORTAL_BUS_NAME, PORTAL_OBJECT_PATH)
        self.registered_app_id = self.register_app_id()
        self.remote = dbus.Interface(self.portal_object, REMOTE_DESKTOP_IFACE)
        self.screencast = dbus.Interface(self.portal_object, SCREENCAST_IFACE)
        self.props = dbus.Interface(self.portal_object, DBUS_PROPERTIES_IFACE)
        self.screencast_session_handle = None
        self.screencast_streams = []
        self.screencast_stream_id = None
        self.pipewire_fd = None
        self.remote_session_handle = None
        self.remote_streams = []
        self.remote_stream_id = None

    def register_app_id(self):
        if os.environ.get("CODEX_COMPUTER_USE_PORTAL_REGISTER", "1") == "0":
            return None
        app_id = os.environ.get("CODEX_COMPUTER_USE_PORTAL_APP_ID", "codex").strip()
        if not app_id:
            return None
        try:
            registry = dbus.Interface(self.portal_object, PORTAL_REGISTRY_IFACE)
            registry.Register(app_id, dbus.Dictionary({}, signature="sv"), timeout=5)
            debug(f"portal registry app_id registered: {app_id}")
            return app_id
        except Exception as error:
            debug(f"portal registry app_id registration failed for {app_id}: {error}")
            return None

    def ensure_screencast(self, timeout_seconds):
        if self.screencast_session_handle is not None:
            return

        call_timeout = max(int(timeout_seconds), 30)
        debug("screencast: checking portal properties")
        sc_version = native(self.props.Get(SCREENCAST_IFACE, "version", timeout=call_timeout))
        available_sources = native(self.props.Get(SCREENCAST_IFACE, "AvailableSourceTypes", timeout=call_timeout))
        if (available_sources & SCREENCAST_SOURCE_MONITOR) == 0:
            raise RuntimeError(f"ScreenCast portal lacks monitor source support: {available_sources}")

        debug("screencast: CreateSession")
        create_handle = self.screencast.CreateSession(
            self.vardict(
                {
                    "handle_token": self.string(token("sc_create")),
                    "session_handle_token": self.string(token("sc_session")),
                }
            ),
            timeout=call_timeout,
        )
        debug(f"screencast: waiting CreateSession {create_handle}")
        create_response = self.wait_request(create_handle, timeout_seconds)
        self.screencast_session_handle = self.object_path(create_response["results"]["session_handle"])

        debug("screencast: SelectSources")
        sources_handle = self.screencast.SelectSources(
            self.screencast_session_handle,
            self.vardict(
                {
                    "handle_token": self.string(token("sc_sources")),
                    "types": self.uint32(SCREENCAST_SOURCE_MONITOR),
                    "multiple": self.boolean(False),
                    "cursor_mode": self.uint32(SCREENCAST_CURSOR_EMBEDDED),
                    "persist_mode": self.uint32(1),
                }
            ),
            timeout=call_timeout,
        )
        debug(f"screencast: waiting SelectSources {sources_handle}")
        self.wait_request(sources_handle, timeout_seconds)

        debug("screencast: Start")
        start_handle = self.screencast.Start(
            self.screencast_session_handle,
            "",
            self.vardict({"handle_token": self.string(token("sc_start"))}),
            timeout=call_timeout,
        )
        debug(f"screencast: waiting Start {start_handle}")
        start_response = self.wait_request(start_handle, timeout_seconds)
        self.screencast_streams = native(start_response["results"].get("streams", []))
        if not self.screencast_streams:
            raise RuntimeError("ScreenCast portal did not return a stream")
        self.screencast_stream_id = int(self.screencast_streams[0][0])

        debug("screencast: OpenPipeWireRemote")
        fd = self.screencast.OpenPipeWireRemote(
            self.screencast_session_handle,
            self.vardict({}),
            timeout=call_timeout,
        )
        self.pipewire_fd = unix_fd_to_int(fd)
        debug("screencast: PipeWire fd ready")
        self.screencast_portal_version = sc_version

    def ensure_remote(self, timeout_seconds):
        if self.remote_session_handle is not None:
            return

        call_timeout = max(int(timeout_seconds), 30)
        debug("remote: checking portal properties")
        rd_version = native(self.props.Get(REMOTE_DESKTOP_IFACE, "version", timeout=call_timeout))
        available_devices = native(self.props.Get(REMOTE_DESKTOP_IFACE, "AvailableDeviceTypes", timeout=call_timeout))
        available_sources = native(self.props.Get(SCREENCAST_IFACE, "AvailableSourceTypes", timeout=call_timeout))
        if (available_devices & (DEVICE_KEYBOARD | DEVICE_POINTER)) != (DEVICE_KEYBOARD | DEVICE_POINTER):
            raise RuntimeError(f"RemoteDesktop portal lacks pointer/keyboard devices: {available_devices}")
        if (available_sources & SCREENCAST_SOURCE_MONITOR) == 0:
            raise RuntimeError(f"ScreenCast portal lacks monitor source support: {available_sources}")

        debug("remote: CreateSession")
        create_handle = self.remote.CreateSession(
            self.vardict(
                {
                    "handle_token": self.string(token("rd_create")),
                    "session_handle_token": self.string(token("rd_session")),
                }
            ),
            timeout=call_timeout,
        )
        debug(f"remote: waiting CreateSession {create_handle}")
        create_response = self.wait_request(create_handle, timeout_seconds)
        self.remote_session_handle = self.object_path(create_response["results"]["session_handle"])

        debug("remote: SelectDevices")
        devices_handle = self.remote.SelectDevices(
            self.remote_session_handle,
            self.vardict(
                {
                    "handle_token": self.string(token("rd_devices")),
                    "types": self.uint32(DEVICE_KEYBOARD | DEVICE_POINTER),
                }
            ),
            timeout=call_timeout,
        )
        debug(f"remote: waiting SelectDevices {devices_handle}")
        self.wait_request(devices_handle, timeout_seconds)

        debug("remote: SelectSources")
        sources_handle = self.screencast.SelectSources(
            self.remote_session_handle,
            self.vardict(
                {
                    "handle_token": self.string(token("rd_sources")),
                    "types": self.uint32(SCREENCAST_SOURCE_MONITOR),
                    "multiple": self.boolean(True),
                    "cursor_mode": self.uint32(SCREENCAST_CURSOR_EMBEDDED),
                }
            ),
            timeout=call_timeout,
        )
        debug(f"remote: waiting SelectSources {sources_handle}")
        self.wait_request(sources_handle, timeout_seconds)

        debug("remote: Start")
        start_handle = self.remote.Start(
            self.remote_session_handle,
            "",
            self.vardict({"handle_token": self.string(token("rd_start"))}),
            timeout=call_timeout,
        )
        debug(f"remote: waiting Start {start_handle}")
        start_response = self.wait_request(start_handle, timeout_seconds)
        self.remote_streams = native(start_response["results"].get("streams", []))
        if not self.remote_streams:
            raise RuntimeError("RemoteDesktop portal did not return a ScreenCast stream")
        self.remote_stream_id = int(self.remote_streams[0][0])
        debug("remote: OpenPipeWireRemote")
        fd = self.screencast.OpenPipeWireRemote(
            self.remote_session_handle,
            self.vardict({}),
            timeout=call_timeout,
        )
        self.pipewire_fd = unix_fd_to_int(fd)
        self.screencast_stream_id = self.remote_stream_id
        debug("remote: session ready")
        self.remote_portal_version = rd_version

    def stream_metadata(self):
        streams = self.remote_streams or self.screencast_streams
        stream_id = self.remote_stream_id if self.remote_stream_id is not None else self.screencast_stream_id
        return {
            "id": stream_id,
            "properties": streams[0][1] if streams else {},
            "portal_versions": {
                "screencast": getattr(self, "screencast_portal_version", None),
                "remote_desktop": getattr(self, "remote_portal_version", None),
            },
            "registered_app_id": self.registered_app_id,
        }

    def capture_png(self, crop, timeout_seconds):
        if self.pipewire_fd is None or self.screencast_stream_id is None:
            raise RuntimeError("ScreenCast portal session is not started")
        png_bytes = capture_pipewire_png(os.dup(self.pipewire_fd), self.screencast_stream_id, timeout_seconds)
        width = None
        height = None
        cropped = False
        if crop is not None:
            from PIL import Image

            image = Image.open(io.BytesIO(png_bytes))
            left = int(round(float(crop["x"])))
            top = int(round(float(crop["y"])))
            right = left + int(round(float(crop["width"])))
            bottom = top + int(round(float(crop["height"])))
            image = image.crop((left, top, right, bottom))
            out = io.BytesIO()
            image.save(out, format="PNG")
            png_bytes = out.getvalue()
            width, height = image.size
            cropped = True
        else:
            try:
                from PIL import Image

                image = Image.open(io.BytesIO(png_bytes))
                width, height = image.size
            except Exception:
                pass
        return {"bytes": png_bytes, "width": width, "height": height, "cropped": cropped}

    def pointer_move(self, x, y):
        stream_id, stream_x, stream_y = self.screen_to_stream_coordinates(x, y)
        self.remote.NotifyPointerMotionAbsolute(
            self.remote_session_handle,
            self.vardict({}),
            self.uint32(stream_id),
            self.double(stream_x),
            self.double(stream_y),
            timeout=5,
        )

    def screen_to_stream_coordinates(self, x, y):
        if not self.remote_streams:
            raise RuntimeError("RemoteDesktop portal has no absolute-coordinate stream")
        screen_x, screen_y = float(x), float(y)
        stream_descriptions = []
        for stream_id, properties in self.remote_streams:
            position = properties.get("position")
            size = properties.get("size")
            if not isinstance(position, (list, tuple)) or len(position) != 2:
                raise RuntimeError(f"RemoteDesktop stream {stream_id} is missing its compositor position")
            if not isinstance(size, (list, tuple)) or len(size) != 2:
                raise RuntimeError(f"RemoteDesktop stream {stream_id} is missing its compositor size")
            left, top = float(position[0]), float(position[1])
            width, height = float(size[0]), float(size[1])
            stream_descriptions.append({"id": stream_id, "position": [left, top], "size": [width, height]})
            if left <= screen_x < left + width and top <= screen_y < top + height:
                return int(stream_id), screen_x - left, screen_y - top
        raise ValueError(
            f"screen coordinate ({screen_x}, {screen_y}) is outside RemoteDesktop streams {stream_descriptions}"
        )

    def pointer_button(self, button, pressed):
        code = BUTTON_CODES.get(button)
        if code is None:
            raise ValueError(f"unknown pointer button: {button}")
        self.remote.NotifyPointerButton(
            self.remote_session_handle,
            self.vardict({}),
            self.int32(code),
            self.uint32(1 if pressed else 0),
            timeout=5,
        )

    def pointer_axis(self, dx, dy, finish):
        self.remote.NotifyPointerAxis(
            self.remote_session_handle,
            self.vardict({"finish": self.boolean(finish)}),
            self.double(dx),
            self.double(dy),
            timeout=5,
        )

    def key_combo(self, key, modifiers):
        if modifiers:
            events = key_combo_keycode_events(key, modifiers)
            for keycode, pressed in events:
                self.key_keycode(keycode, pressed)
                time.sleep(0.03)
            return
        try:
            keycode = portal_keycode_for_key(key)
            self.key_keycode(keycode, True)
            time.sleep(0.03)
            self.key_keycode(keycode, False)
            return
        except ValueError:
            pass
        keysym = keysym_for_key(key)
        self.key_keysym(keysym, True)
        time.sleep(0.03)
        self.key_keysym(keysym, False)

    def key_char(self, char):
        if char == "\n":
            self.key_combo("enter", [])
            return
        if char == "\t":
            self.key_combo("tab", [])
            return
        keysym = keysym_for_char(char)
        self.key_keysym(keysym, True)
        self.key_keysym(keysym, False)

    def key_keysym(self, keysym, pressed):
        self.remote.NotifyKeyboardKeysym(
            self.remote_session_handle,
            self.vardict({}),
            self.int32(keysym),
            self.uint32(1 if pressed else 0),
            timeout=5,
        )

    def key_keycode(self, keycode, pressed):
        self.remote.NotifyKeyboardKeycode(
            self.remote_session_handle,
            self.vardict({}),
            self.int32(keycode),
            self.uint32(1 if pressed else 0),
            timeout=5,
        )

    def wait_request(self, handle, timeout_seconds):
        from gi.repository import GLib

        result = {}
        loop = GLib.MainLoop()

        def on_response(response, results):
            result["response"] = int(response)
            result["results"] = native(results)
            loop.quit()

        self.bus.add_signal_receiver(
            on_response,
            signal_name="Response",
            dbus_interface=REQUEST_IFACE,
            path=str(handle),
        )
        timeout_id = GLib.timeout_add(int(timeout_seconds * 1000), loop.quit)
        loop.run()
        GLib.source_remove(timeout_id)
        try:
            self.bus.remove_signal_receiver(
                on_response,
                signal_name="Response",
                dbus_interface=REQUEST_IFACE,
                path=str(handle),
            )
        except Exception:
            pass
        if not result:
            raise TimeoutError(f"portal request timed out: {handle}")
        if result["response"] != 0:
            raise RuntimeError(f"portal request denied or cancelled: response={result['response']}")
        return result

    def vardict(self, values):
        return self.dbus.Dictionary(values, signature="sv")

    def string(self, value):
        return self.dbus.String(value, variant_level=1)

    def uint32(self, value):
        return self.dbus.UInt32(value, variant_level=1)

    def int32(self, value):
        return self.dbus.Int32(value, variant_level=1)

    def double(self, value):
        return self.dbus.Double(value, variant_level=1)

    def boolean(self, value):
        return self.dbus.Boolean(value, variant_level=1)

    def object_path(self, value):
        return self.dbus.ObjectPath(str(value))


def unix_fd_to_int(fd):
    if hasattr(fd, "take"):
        return fd.take()
    return int(fd)


def capture_pipewire_png(fd, stream_id, timeout_seconds):
    import gi

    gi.require_version("Gst", "1.0")
    from gi.repository import Gst

    Gst.init(None)
    debug("pipewire: building GStreamer pipeline")
    pipeline = Gst.parse_launch(
        f"pipewiresrc fd={int(fd)} path={int(stream_id)} do-timestamp=true "
        "! videoconvert ! pngenc ! appsink name=sink emit-signals=false max-buffers=1 drop=true sync=false"
    )
    sink = pipeline.get_by_name("sink")
    bus = pipeline.get_bus()
    debug("pipewire: starting GStreamer pipeline")
    pipeline.set_state(Gst.State.PLAYING)
    deadline = time.monotonic() + timeout_seconds
    try:
        while time.monotonic() < deadline:
            sample = sink.emit("try-pull-sample", 100 * Gst.MSECOND)
            if sample is not None:
                buffer = sample.get_buffer()
                debug("pipewire: frame received")
                return buffer.extract_dup(0, buffer.get_size())
            message = bus.pop_filtered(Gst.MessageType.ERROR | Gst.MessageType.EOS)
            if message is not None:
                if message.type == Gst.MessageType.ERROR:
                    error, detail = message.parse_error()
                    raise RuntimeError(f"GStreamer PipeWire capture failed: {error.message}; {detail}")
                raise RuntimeError("GStreamer PipeWire capture ended before a frame was received")
        raise TimeoutError("timed out waiting for PipeWire frame")
    finally:
        pipeline.set_state(Gst.State.NULL)


def keysym_for_key(key):
    name = str(key).strip()
    lowered = name.lower().replace("-", "_")
    if len(name) == 1:
        return keysym_for_char(name)
    if lowered in SPECIAL_KEYSYMS:
        return SPECIAL_KEYSYMS[lowered]
    try:
        import gi

        gi.require_version("Gdk", "3.0")
        from gi.repository import Gdk

        keyval = Gdk.keyval_from_name(name)
        if keyval:
            return int(keyval)
    except Exception:
        pass
    raise ValueError(f"unknown key: {key}")


def portal_keycode_for_key(key):
    name = str(key).strip().lower().replace("-", "_")
    if len(name) == 1:
        name = name.lower()
    if name in PORTAL_KEYCODES:
        return PORTAL_KEYCODES[name]
    raise ValueError(f"unknown portal keycode key: {key}")


def key_combo_keycode_events(key, modifiers):
    modifier_codes = [MODIFIER_KEYCODES[name] for name in modifiers]
    keycode = portal_keycode_for_key(key)
    return (
        [(code, True) for code in modifier_codes]
        + [(keycode, True), (keycode, False)]
        + [(code, False) for code in reversed(modifier_codes)]
    )


def keysym_for_char(char):
    codepoint = ord(char)
    if codepoint <= 0xFF:
        return codepoint
    return 0x01000000 + codepoint


def desktop_summary():
    return {
        "session_type": os.environ.get("XDG_SESSION_TYPE"),
        "current_desktop": os.environ.get("XDG_CURRENT_DESKTOP"),
        "kde_full_session": os.environ.get("KDE_FULL_SESSION"),
        "kde_session_version": os.environ.get("KDE_SESSION_VERSION"),
        "wayland_display": os.environ.get("WAYLAND_DISPLAY"),
        "display": os.environ.get("DISPLAY"),
    }


def run_kwin_script(action, args):
    import dbus
    import dbus.mainloop.glib
    import dbus.service
    import gi

    gi.require_version("GLib", "2.0")
    from gi.repository import GLib

    bus = session_bus()
    nonce = "cu" + uuid.uuid4().hex
    service_name = f"org.openai.CodexComputerUse.{nonce}"
    object_path = f"/org/openai/CodexComputerUse/{nonce}"
    plugin_name = f"codex_computer_use_{nonce}"
    loop = GLib.MainLoop()
    result = {}

    class Receiver(dbus.service.Object):
        @dbus.service.method(KWIN_BRIDGE_IFACE, in_signature="s", out_signature="")
        def Receive(self, payload):
            result["payload"] = str(payload)
            loop.quit()

    bus_name = dbus.service.BusName(service_name, bus)
    receiver = Receiver(bus_name, object_path)
    script = kwin_script_source(service_name, object_path, action, args)
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as tmp:
        tmp.write(script)
        script_path = tmp.name

    scripting = None
    try:
        scripting = dbus.Interface(bus.get_object("org.kde.KWin", "/Scripting"), KWIN_SCRIPTING_IFACE)
        load_script = scripting.get_dbus_method("loadScript", KWIN_SCRIPTING_IFACE)
        loaded = int(load_script(script_path, plugin_name, signature="ss"))
        if loaded < 0:
            raise RuntimeError("KWin refused to load Computer Use script")
        scripting.start()
        timeout_id = GLib.timeout_add(5000, loop.quit)
        loop.run()
        GLib.source_remove(timeout_id)
        if "payload" not in result:
            raise TimeoutError("KWin script did not return window metadata")
        payload = json.loads(result["payload"])
        if not payload.get("ok", False):
            raise RuntimeError(payload.get("error", "KWin script failed"))
        return payload
    finally:
        if scripting is not None:
            try:
                unload_script = scripting.get_dbus_method("unloadScript", KWIN_SCRIPTING_IFACE)
                unload_script(plugin_name, signature="s")
            except Exception:
                pass
        try:
            receiver.remove_from_connection()
        except Exception:
            pass
        try:
            os.unlink(script_path)
        except OSError:
            pass


def read_status_notifier_items():
    import dbus

    bus = session_bus()
    watcher = bus.get_object(SNI_WATCHER_BUS_NAME, SNI_WATCHER_OBJECT_PATH)
    watcher_props = dbus.Interface(watcher, DBUS_PROPERTIES_IFACE)
    refs = native(watcher_props.Get(SNI_WATCHER_IFACE, "RegisteredStatusNotifierItems", timeout=5))
    items = []
    errors = []
    for ref in refs:
        try:
            parsed = parse_status_notifier_item_ref(ref)
            obj = bus.get_object(parsed["service"], parsed["path"])
            props = dbus.Interface(obj, DBUS_PROPERTIES_IFACE)
            item_props = native(props.GetAll(SNI_ITEM_IFACE, timeout=3))
            owner = status_notifier_owner_info(bus, parsed["service"])
            items.append(public_status_notifier_item(parsed, item_props, owner))
        except Exception as error:
            errors.append({"ref": str(ref), "error": str(error)})
    return {"items": items, "errors": errors}


def parse_status_notifier_item_ref(ref):
    text = str(ref).strip()
    slash = text.find("/")
    if slash <= 0:
        raise ValueError(f"invalid StatusNotifierItem ref: {ref!r}")
    service = text[:slash]
    path = text[slash:]
    if not path.startswith("/") or not service:
        raise ValueError(f"invalid StatusNotifierItem ref: {ref!r}")
    return {"ref": text, "service": service, "path": path}


def status_notifier_owner_info(bus, service):
    import dbus

    owner = {}
    try:
        dbus_obj = bus.get_object("org.freedesktop.DBus", "/org/freedesktop/DBus")
        dbus_iface = dbus.Interface(dbus_obj, "org.freedesktop.DBus")
        pid = int(native(dbus_iface.GetConnectionUnixProcessID(service, timeout=3)))
        owner["pid"] = pid
    except Exception:
        return owner

    pid = owner.get("pid")
    if not pid:
        return owner
    try:
        owner["exe"] = os.readlink(f"/proc/{pid}/exe")
    except OSError:
        pass
    try:
        owner["comm"] = Path(f"/proc/{pid}/comm").read_text(encoding="utf-8").strip()
    except OSError:
        pass
    return owner


def public_status_notifier_item(parsed, props, owner=None):
    item = {
        "ref": parsed["ref"],
        "service": parsed["service"],
        "path": parsed["path"],
        "id": text_prop(props.get("Id")),
        "title": text_prop(props.get("Title")),
        "status": text_prop(props.get("Status")),
        "category": text_prop(props.get("Category")),
        "icon_name": text_prop(props.get("IconName")),
        "attention_icon_name": text_prop(props.get("AttentionIconName")),
        "overlay_icon_name": text_prop(props.get("OverlayIconName")),
        "item_is_menu": bool(props.get("ItemIsMenu", False)),
    }
    owner = owner or {}
    if owner.get("pid"):
        item["owner_pid"] = owner["pid"]
    if owner.get("exe"):
        item["owner_exe"] = owner["exe"]
    if owner.get("comm"):
        item["owner_comm"] = owner["comm"]
    tooltip = tooltip_text(props.get("ToolTip"))
    if tooltip:
        item["tooltip"] = tooltip
    if props.get("WindowId") is not None:
        try:
            item["window_id"] = int(props.get("WindowId"))
        except (TypeError, ValueError):
            item["window_id"] = text_prop(props.get("WindowId"))
    if props.get("Menu") is not None:
        item["menu_path"] = text_prop(props.get("Menu"))
    return item


def text_prop(value):
    if value is None:
        return ""
    return str(value)


def tooltip_text(value):
    if value is None:
        return ""
    if isinstance(value, (list, tuple)) and len(value) >= 4:
        return " ".join(part for part in (text_prop(value[2]).strip(), text_prop(value[3]).strip()) if part)
    return ""


def tray_item_match_fields(item):
    return [
        item.get("ref", ""),
        item.get("service", ""),
        item.get("path", ""),
        item.get("id", ""),
        item.get("title", ""),
        item.get("status", ""),
        item.get("category", ""),
        item.get("icon_name", ""),
        item.get("attention_icon_name", ""),
        item.get("overlay_icon_name", ""),
        item.get("tooltip", ""),
        str(item.get("owner_pid", "")),
        item.get("owner_exe", ""),
        item.get("owner_comm", ""),
    ]


def tray_item_matches(item, query):
    needle = str(query).strip().lower()
    return bool(needle) and any(needle in field.lower() for field in tray_item_match_fields(item) if field)


def tray_item_rank(item, query):
    needle = str(query).strip().lower()
    if not needle:
        return 2
    fields = [field.lower() for field in tray_item_match_fields(item) if field]
    if any(field == needle for field in fields):
        return 0
    if any(field.startswith(needle) for field in fields):
        return 1
    return 2


def select_tray_item(items, params):
    item_ref = params.get("item_ref")
    if item_ref:
        try:
            parsed = parse_status_notifier_item_ref(item_ref)
        except ValueError:
            parsed = None
        for item in items:
            if item.get("ref") == item_ref:
                return item
            if parsed and item.get("service") == parsed["service"] and item.get("path") == parsed["path"]:
                return item
        return None

    service = params.get("service")
    path = params.get("path")
    if service and path:
        for item in items:
            if item.get("service") == service and item.get("path") == path:
                return item
        return None

    query = str(params.get("query") or "").strip().lower()
    if not query:
        return None
    matches = [item for item in items if tray_item_matches(item, query)]
    if not matches:
        return None
    matches.sort(key=lambda item: (tray_item_rank(item, query), item.get("title", "").lower()))
    return matches[0]


def call_status_notifier_item_action(item, action, x, y):
    import dbus

    methods = {
        "activate": "Activate",
        "secondary_activate": "SecondaryActivate",
        "context_menu": "ContextMenu",
    }
    method_name = methods.get(action)
    if method_name is None:
        raise ValueError(f"unknown tray item action: {action}")
    bus = session_bus()
    obj = bus.get_object(item["service"], item["path"])
    iface = dbus.Interface(obj, SNI_ITEM_IFACE)
    method = getattr(iface, method_name)
    method(dbus.Int32(x), dbus.Int32(y), signature="ii", timeout=5)


def kwin_script_source(service_name, object_path, action, args):
    return f"""
(function() {{
  const service = {json.dumps(service_name)};
  const objectPath = {json.dumps(object_path)};
  const iface = {json.dumps(KWIN_BRIDGE_IFACE)};
  const action = {json.dumps(action)};
  const args = {json.dumps(args)};

  function send(payload) {{
    callDBus(service, objectPath, iface, "Receive", JSON.stringify(payload));
  }}
  function prop(obj, name, fallback) {{
    try {{
      const value = obj[name];
      if (value === undefined || value === null) return fallback;
      return value;
    }} catch (error) {{
      return fallback;
    }}
  }}
  function text(value) {{
    if (value === undefined || value === null) return "";
    return String(value);
  }}
  function number(value, fallback) {{
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }}
  function geometryProperty(window, propertyName) {{
    const g = prop(window, propertyName, null);
    if (g) {{
      return {{
        x: number(g.x, 0),
        y: number(g.y, 0),
        width: number(g.width, 0),
        height: number(g.height, 0)
      }};
    }}
    return null;
  }}
  function geometryOf(window) {{
    const frame = geometryProperty(window, "frameGeometry");
    if (frame) return frame;
    return {{
      x: number(prop(window, "x", 0), 0),
      y: number(prop(window, "y", 0), 0),
      width: number(prop(window, "width", 0), 0),
      height: number(prop(window, "height", 0), 0)
    }};
  }}
  function windowId(window, index) {{
    const internalId = prop(window, "internalId", "");
    if (text(internalId) !== "") return text(internalId);
    const windowId = prop(window, "windowId", "");
    if (text(windowId) !== "") return text(windowId);
    return [
      text(prop(window, "pid", "")),
      text(prop(window, "resourceClass", "")),
      text(prop(window, "caption", "")),
      String(index)
    ].join(":");
  }}
  function windows() {{
    if (typeof workspace.windowList === "function") return workspace.windowList();
    return [];
  }}
  function desktopInfo(desktop, index) {{
    if (!desktop) return null;
    return {{
      id: text(prop(desktop, "id", "")),
      name: text(prop(desktop, "name", "")),
      index,
      number: number(prop(desktop, "x11DesktopNumber", index + 1), index + 1)
    }};
  }}
  function workspaceDesktops() {{
    const list = prop(workspace, "desktops", []);
    const out = [];
    for (let i = 0; i < list.length; i++) out.push(desktopInfo(list[i], i));
    return out;
  }}
  function cursorPosition() {{
    const pos = prop(workspace, "cursorPos", null);
    if (!pos) return null;
    return {{
      x: number(prop(pos, "x", 0), 0),
      y: number(prop(pos, "y", 0), 0)
    }};
  }}
  function currentVirtualDesktop() {{
    const current = prop(workspace, "currentDesktop", null);
    const list = prop(workspace, "desktops", []);
    for (let i = 0; i < list.length; i++) {{
      if (list[i] === current || text(prop(list[i], "id", "")) === text(prop(current, "id", ""))) return desktopInfo(current, i);
    }}
    return desktopInfo(current, -1);
  }}
  function desktopIndex(desktop) {{
    const list = prop(workspace, "desktops", []);
    const id = text(prop(desktop, "id", ""));
    for (let i = 0; i < list.length; i++) {{
      if (list[i] === desktop || text(prop(list[i], "id", "")) === id) return i;
    }}
    return -1;
  }}
  function desktopBySnapshot(snapshot) {{
    const list = prop(workspace, "desktops", []);
    const id = text(prop(snapshot, "id", ""));
    const numberValue = number(prop(snapshot, "number", 0), 0);
    for (let i = 0; i < list.length; i++) {{
      if (id && text(prop(list[i], "id", "")) === id) return list[i];
    }}
    for (let i = 0; i < list.length; i++) {{
      if (number(prop(list[i], "x11DesktopNumber", i + 1), i + 1) === numberValue) return list[i];
    }}
    return null;
  }}
  function windowDesktops(window) {{
    if (Boolean(prop(window, "onAllDesktops", false))) {{
      return [{{ id: "*", name: "All Desktops", index: -1, number: 0 }}];
    }}
    const list = prop(window, "desktops", []);
    const out = [];
    for (let i = 0; i < list.length; i++) out.push(desktopInfo(list[i], desktopIndex(list[i])));
    return out;
  }}
  function serialize(window, index) {{
    const geom = geometryOf(window);
    const bufferGeom = geometryProperty(window, "bufferGeometry") || geom;
    const active = prop(workspace, "activeWindow", null) === window;
    return {{
      id: windowId(window, index),
      index,
      caption: text(prop(window, "caption", "")),
      resourceClass: text(prop(window, "resourceClass", "")),
      resourceName: text(prop(window, "resourceName", "")),
      desktopFileName: text(prop(window, "desktopFileName", "")),
      pid: number(prop(window, "pid", 0), 0),
      x: geom.x,
      y: geom.y,
      width: geom.width,
      height: geom.height,
      frame_geometry: geom,
      buffer_geometry: bufferGeom,
      active,
      minimized: Boolean(prop(window, "minimized", false)),
      specialWindow: Boolean(prop(window, "specialWindow", false)),
      dock: Boolean(prop(window, "dock", false)),
      desktopWindow: Boolean(prop(window, "desktopWindow", false)),
      skipTaskbar: Boolean(prop(window, "skipTaskbar", false)),
      fullScreen: Boolean(prop(window, "fullScreen", false)),
      keepAbove: Boolean(prop(window, "keepAbove", false)),
      output: text(prop(prop(window, "output", null), "name", "")),
      desktops: windowDesktops(window)
    }};
  }}
  function collect() {{
    const list = windows();
    const out = [];
    let activeId = "";
    for (let i = 0; i < list.length; i++) {{
      const item = serialize(list[i], i);
      if (item.active) activeId = item.id;
      out.push(item);
    }}
    return {{
      ok: true,
      windows: out,
      active_window_id: activeId,
      virtual_desktops: workspaceDesktops(),
      current_virtual_desktop: currentVirtualDesktop()
    }};
  }}
  function geometryMatches(actual, expected) {{
    if (!expected) return true;
    if (!actual) return false;
    const keys = ["x", "y", "width", "height"];
    for (let i = 0; i < keys.length; i++) {{
      const key = keys[i];
      if (Math.abs(number(actual[key], 0) - number(expected[key], 0)) > 0.01) return false;
    }}
    return true;
  }}
  function findWindowById(id) {{
    const list = windows();
    for (let i = 0; i < list.length; i++) {{
      if (windowId(list[i], i) === String(id)) return {{ window: list[i], index: i }};
    }}
    return null;
  }}

  try {{
    if (action === "cursor_position") {{
      const pos = cursorPosition();
      if (!pos) {{
        send({{ ok: false, error: "KWin cursorPos is unavailable" }});
        return;
      }}
      send({{ ok: true, x: pos.x, y: pos.y }});
      return;
    }}
    if (action === "list") {{
      send(collect());
      return;
    }}
    if (action === "lease_acquire") {{
      const found = findWindowById(args.window_id);
      if (!found) throw new Error("foreground lease target window no longer exists");
      const window = found.window;
      const serialized = serialize(window, found.index);
      if (number(args.expected_pid, 0) > 0 && serialized.pid !== number(args.expected_pid, 0)) throw new Error("foreground lease target pid changed");
      if (!geometryMatches(serialized.frame_geometry, args.expected_frame_geometry)) throw new Error("foreground lease frame geometry changed");
      if (!geometryMatches(serialized.buffer_geometry, args.expected_buffer_geometry)) throw new Error("foreground lease buffer geometry changed");
      const priorDesktopObject = prop(workspace, "currentDesktop", null);
      const priorDesktop = currentVirtualDesktop();
      const priorActive = prop(workspace, "activeWindow", null);
      const priorActiveId = priorActive ? windowId(priorActive, windows().indexOf(priorActive)) : "";
      try {{
        if (!Boolean(prop(window, "onAllDesktops", false))) {{
          const targetDesktops = prop(window, "desktops", []);
          if (!targetDesktops || targetDesktops.length < 1) throw new Error("foreground lease target has no virtual desktop");
          workspace.currentDesktop = targetDesktops[0];
        }}
        if (prop(window, "minimized", false)) window.minimized = false;
        workspace.activeWindow = window;
        if (typeof window.raise === "function") window.raise();
        const active = prop(workspace, "activeWindow", null);
        if (active !== window) throw new Error("KWin did not grant foreground focus to the lease target");
      }} catch (error) {{
        if (serialized.minimized) window.minimized = true;
        if (priorDesktopObject) workspace.currentDesktop = priorDesktopObject;
        if (priorActive) workspace.activeWindow = priorActive;
        throw error;
      }}
      send({{
        ok: true,
        lease: {{
          target_window_id: windowId(window, found.index),
          previous_active_window_id: priorActiveId,
          previous_desktop: priorDesktop,
          target_was_minimized: serialized.minimized,
          frame_geometry: serialized.frame_geometry,
          buffer_geometry: serialized.buffer_geometry
        }},
        window: serialize(window, found.index)
      }});
      return;
    }}
    if (action === "lease_validate") {{
      const lease = args.lease || {{}};
      const active = prop(workspace, "activeWindow", null);
      const list = windows();
      let activeIndex = -1;
      for (let i = 0; i < list.length; i++) if (list[i] === active) activeIndex = i;
      const owned = active && windowId(active, activeIndex) === String(lease.target_window_id || "");
      const serialized = owned ? serialize(active, activeIndex) : null;
      const geometryValid = owned && geometryMatches(serialized.frame_geometry, lease.frame_geometry) && geometryMatches(serialized.buffer_geometry, lease.buffer_geometry);
      send({{ ok: true, owned: Boolean(owned && geometryValid), geometry_valid: Boolean(geometryValid), window: serialized }});
      return;
    }}
    if (action === "lease_release") {{
      const lease = args.lease || {{}};
      const active = prop(workspace, "activeWindow", null);
      const list = windows();
      let activeIndex = -1;
      for (let i = 0; i < list.length; i++) if (list[i] === active) activeIndex = i;
      if (!active || windowId(active, activeIndex) !== String(lease.target_window_id || "")) {{
        send({{ ok: true, restored: false, reason: "lease ownership changed" }});
        return;
      }}
      const serialized = serialize(active, activeIndex);
      if (!geometryMatches(serialized.frame_geometry, lease.frame_geometry) || !geometryMatches(serialized.buffer_geometry, lease.buffer_geometry)) {{
        send({{ ok: true, restored: false, reason: "lease geometry changed" }});
        return;
      }}
      const previousDesktop = desktopBySnapshot(lease.previous_desktop || {{}});
      if (previousDesktop) workspace.currentDesktop = previousDesktop;
      const previousActive = findWindowById(lease.previous_active_window_id || "");
      if (previousActive) {{
        workspace.activeWindow = previousActive.window;
        if (typeof previousActive.window.raise === "function") previousActive.window.raise();
      }}
      if (Boolean(lease.target_was_minimized)) active.minimized = true;
      send({{ ok: true, restored: true }});
      return;
    }}
    send({{ ok: false, error: "unknown KWin action: " + action }});
  }} catch (error) {{
    send({{ ok: false, error: String(error && error.stack ? error.stack : error) }});
  }}
}})();
"""


def find_desktop_entries():
    roots = [Path.home() / ".local/share/applications"]
    for base in os.environ.get("XDG_DATA_DIRS", "/usr/local/share:/usr/share").split(":"):
        if base:
            roots.append(Path(base) / "applications")
    entries = []
    seen = set()
    for root in roots:
        if not root.is_dir():
            continue
        for path in root.rglob("*.desktop"):
            if path in seen:
                continue
            seen.add(path)
            entry = parse_desktop_entry(path, root)
            if entry and entry.get("type", "Application") == "Application":
                entries.append(entry)
    entries = deduplicate_desktop_entries(entries)
    entries.sort(key=lambda item: (item.get("name", "").lower(), item.get("desktop_id", "")))
    return entries


def deduplicate_desktop_entries(entries):
    result = []
    seen = set()
    for entry in entries:
        desktop_id = entry.get("desktop_id")
        if desktop_id and desktop_id in seen:
            continue
        if desktop_id:
            seen.add(desktop_id)
        result.append(entry)
    return result


def parse_desktop_entry(path, root):
    data = {}
    in_desktop_entry = False
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            in_desktop_entry = line == "[Desktop Entry]"
            continue
        if not in_desktop_entry or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if "[" in key:
            continue
        data[key] = value
    if "Exec" not in data and "Name" not in data:
        return None
    try:
        desktop_id = str(path.relative_to(root)).replace("/", "-")
    except ValueError:
        desktop_id = path.name
    return {
        "desktop_id": desktop_id,
        "path": str(path),
        "name": data.get("Name", path.stem),
        "generic_name": data.get("GenericName", ""),
        "type": data.get("Type", "Application"),
        "exec": data.get("Exec", ""),
        "startup_wm_class": data.get("StartupWMClass", ""),
        "no_display": data.get("NoDisplay", "false").lower() == "true",
        "hidden": data.get("Hidden", "false").lower() == "true",
    }


def public_desktop_entry(entry):
    return {
        "desktop_id": entry.get("desktop_id", ""),
        "name": entry.get("name", ""),
        "generic_name": entry.get("generic_name", ""),
        "exec": entry.get("exec", ""),
        "startup_wm_class": entry.get("startup_wm_class", ""),
        "no_display": bool(entry.get("no_display")),
        "hidden": bool(entry.get("hidden")),
    }


def desktop_entry_rank(entry, query):
    needle = str(query or "").strip().lower()
    if not needle:
        return 2

    name_fields = [entry.get("name", ""), entry.get("generic_name", "")]
    desktop_fields = [entry.get("desktop_id", ""), Path(entry.get("path", "")).name]
    startup_fields = [entry.get("startup_wm_class", "")]
    exec_names = executable_names(entry.get("exec", ""))
    all_fields = name_fields + desktop_fields + startup_fields + [entry.get("exec", "")]

    if not any(needle in field.lower() for field in all_fields if field):
        return None
    if any(field.lower() == needle for field in name_fields + desktop_fields + startup_fields if field):
        return 0

    rank = None
    if any(token == needle for field in name_fields for token in search_tokens(field)):
        rank = 1
    elif any(token == needle for field in exec_names + startup_fields for token in search_tokens(field)):
        rank = 2
    elif any(token == needle for field in desktop_fields for token in search_tokens(field)):
        rank = 3
    elif any(field.lower().startswith(needle) for field in name_fields + exec_names + startup_fields if field):
        rank = 4
    elif any(field.lower().startswith(needle) for field in desktop_fields if field):
        rank = 5
    else:
        rank = 6

    if is_generated_chrome_web_app(entry) and not any(needle in field.lower() for field in name_fields if field):
        rank += 4
    return rank


def search_tokens(value):
    return [token for token in re.split(r"[^a-z0-9]+", str(value).lower()) if token]


def executable_names(exec_line):
    try:
        parts = shlex.split(exec_line)
    except ValueError:
        parts = str(exec_line).split()
    names = []
    for part in parts:
        if not part or part.startswith("-") or part.startswith("%"):
            continue
        names.append(Path(part).name)
    return names


def is_generated_chrome_web_app(entry):
    desktop_id = str(entry.get("desktop_id", "")).lower()
    exec_line = str(entry.get("exec", "")).lower()
    return desktop_id.startswith("chrome-") or "--app-id=" in exec_line or "--app-id" in exec_line


def public_window(window, detail):
    if detail == "full":
        return window
    return {
        "id": window.get("id", ""),
        "index": window.get("index", 0),
        "title": window.get("caption", ""),
        "app": window.get("resourceClass", ""),
        "resource_name": window.get("resourceName", ""),
        "desktop_file": window.get("desktopFileName", ""),
        "pid": window.get("pid", 0),
        "active": bool(window.get("active", False)),
        "minimized": bool(window.get("minimized", False)),
        "geometry": {
            "x": window.get("x", 0),
            "y": window.get("y", 0),
            "width": window.get("width", 0),
            "height": window.get("height", 0),
        },
        "desktops": window.get("desktops", []),
    }


def window_title(window):
    return str(window.get("caption") or window.get("title") or "")


def select_desktop_entry(entries, desktop_id, query):
    visible = [entry for entry in entries if not entry.get("hidden")]
    if desktop_id:
        for entry in visible:
            if entry.get("desktop_id") == desktop_id or Path(entry.get("path", "")).name == desktop_id:
                return entry
    if not query:
        return None
    ranked = []
    for index, entry in enumerate(visible):
        rank = desktop_entry_rank(entry, query)
        if rank is not None:
            ranked.append((rank, entry.get("name", "").lower(), index, entry))
    ranked.sort(key=lambda item: (item[0], item[1], item[2]))
    return ranked[0][3] if ranked else None


def expand_exec(exec_line, extra_args):
    if not exec_line:
        return []
    parts = shlex.split(exec_line)
    expanded = []
    for part in parts:
        if part == "%%":
            expanded.append("%")
            continue
        if re.fullmatch(r"%[fFuUdDnNickvm]", part):
            continue
        cleaned = re.sub(r"%[fFuUdDnNickvm]", "", part)
        if cleaned:
            expanded.append(cleaned)
    expanded.extend(str(arg) for arg in extra_args)
    return expanded


def ui_root_identity(root):
    return f"{root.get('kind', '')}:{root.get('backend_ref', '')}:{root.get('resource_key', '')}"


def public_ui_root(root):
    return {
        key: value
        for key, value in root.items()
        if not key.startswith("backend_") and key not in ("resource_key",)
    }


def resolve_exact_root_window(root, list_windows, allow_missing=False):
    window_id = str(root.get("backend_ref") or "")
    if not window_id:
        raise ValueError("window root is missing its exact KWin id")
    windows = list_windows(
        {
            "include_special": True,
            "include_minimized": True,
            "detail": "full",
            "limit": 200,
        }
    ).get("windows", [])
    for window in windows:
        if str(window.get("id") or "") != window_id:
            continue
        expected_pid = int(root.get("pid") or 0)
        actual_pid = accessibility_target_pid(window)
        if expected_pid > 0 and actual_pid != expected_pid:
            raise ValueError(f"window root pid changed from {expected_pid} to {actual_pid}; call find_roots again")
        return window
    if allow_missing:
        return None
    raise ValueError(f"KWin window root {window_id!r} no longer exists; call find_roots again")


def validate_root_geometry(root, list_windows):
    window = resolve_exact_root_window(root, list_windows)
    for key in ("frame_geometry", "buffer_geometry"):
        expected = root.get(key)
        actual = window.get(key)
        if expected is not None and geometry_signature(expected) != geometry_signature(actual):
            raise ValueError(f"window {key} changed after observation; call observe_ui again")
    transform = root.get("backend_coordinate_transform")
    if not isinstance(transform, dict) or transform.get("window_id") != str(window.get("id") or ""):
        raise ValueError("window coordinate transform is missing or stale; call observe_ui again")
    return window


def geometry_signature(geometry):
    if not isinstance(geometry, dict):
        return None
    return tuple(round(float(geometry.get(key, 0)), 4) for key in ("x", "y", "width", "height"))


def resolve_exact_application_root(root):
    desktop_id = str(root.get("backend_ref") or "")
    for entry in find_desktop_entries():
        if entry.get("desktop_id") == desktop_id:
            return entry
    raise ValueError(f"desktop entry {desktop_id!r} no longer exists; call find_roots again")


def resolve_exact_tray_root(root):
    item_ref = str(root.get("backend_ref") or "")
    for item in read_status_notifier_items()["items"]:
        if item.get("ref") == item_ref:
            return item
    raise ValueError(f"StatusNotifierItem {item_ref!r} no longer exists; call find_roots again")


def screenshot_payload(png):
    return {
        "mime_type": "image/png",
        "data_base64": base64.b64encode(png["bytes"]).decode("ascii"),
        "width": png["width"],
        "height": png["height"],
        "cropped": png["cropped"],
        "scale": png.get("scale"),
    }


def synthetic_root_observation(root, kind, target, look_store):
    look_id = look_store.begin(ui_root_identity(root))
    capabilities = ["action"]
    wire_ref = look_store.bind(look_id, kind, target, capabilities)
    if kind == "application":
        name = str(target.get("name") or target.get("desktop_id") or "")
        role = "application"
        actions = ["launch"]
    else:
        name = str(target.get("title") or target.get("id") or target.get("ref") or "")
        role = "status icon"
        actions = ["activate"]
    return {
        "protocol_version": COMPUTER_USE_PROTOCOL_VERSION,
        "look_id": look_id,
        "captured_at": time.time(),
        "root": public_ui_root(root),
        "backend_root": root,
        "window": None,
        "coordinate_space": {"name": "none"},
        "outline": {
            "nodes": [
                {
                    "wire_ref": wire_ref,
                    "depth": 0,
                    "name": name,
                    "role": role,
                    "description": "",
                    "states": ["enabled"],
                    "bounds": None,
                    "actions": actions,
                    "capabilities": capabilities,
                }
            ],
            "truncated": False,
        },
    }


def missing_window_observation(root, look_store):
    look_id = look_store.begin(ui_root_identity(root))
    wire_ref = look_store.bind(look_id, "missing", root, [])
    return {
        "protocol_version": COMPUTER_USE_PROTOCOL_VERSION,
        "look_id": look_id,
        "captured_at": time.time(),
        "root": {**public_ui_root(root), "present": False},
        "backend_root": root,
        "window": None,
        "coordinate_space": {"name": "none"},
        "outline": {
            "nodes": [
                {
                    "wire_ref": wire_ref,
                    "depth": 0,
                    "name": str(root.get("title") or ""),
                    "role": {"application": "application", "tray_item": "status icon"}.get(root.get("kind"), "window"),
                    "description": "",
                    "states": ["defunct"],
                    "bounds": None,
                    "capabilities": [],
                }
            ],
            "truncated": False,
        },
    }


def map_accessibility_to_window_image(tree, window, png):
    nodes = tree.get("nodes") or []
    paired_bounds = [
        (node.get("bounds"), node.get("backend_window_bounds"), int(node.get("depth") or 0))
        for node in nodes
        if usable_bounds(node.get("bounds")) and usable_bounds(node.get("backend_window_bounds"))
    ]
    screen_bounds = [node.get("bounds") for node in nodes if usable_bounds(node.get("bounds"))]
    geometries = []
    for key in ("buffer_geometry", "frame_geometry"):
        geometry = window.get(key)
        if geometry and float(geometry.get("width", 0)) > 0 and float(geometry.get("height", 0)) > 0:
            if paired_bounds:
                anchor_screen, anchor_window, anchor_depth = min(
                    paired_bounds,
                    key=lambda item: (
                        bounds_size_distance(item[1], geometry),
                        item[2],
                    ),
                )
                distance = bounds_size_distance(anchor_window, geometry)
                geometries.append((distance, anchor_depth, key, geometry, anchor_screen, anchor_window))
            elif screen_bounds:
                anchor_screen = min(screen_bounds, key=lambda bounds: bounds_size_distance(bounds, geometry))
                distance = bounds_size_distance(anchor_screen, geometry)
                geometries.append((distance, 0, key, geometry, anchor_screen, None))
            else:
                geometries.append((0, 0, key, geometry, None, None))
    if not geometries:
        raise RuntimeError("KWin did not provide usable frame or buffer geometry")
    _, _, source, geometry, anchor_screen, anchor_window = min(
        geometries,
        key=lambda item: (item[0], item[1], item[2] != "buffer_geometry"),
    )
    scale_x = float(png["width"]) / float(geometry["width"])
    scale_y = float(png["height"]) / float(geometry["height"])
    origin_x = float(geometry["x"])
    origin_y = float(geometry["y"])
    accessibility_source = classify_accessibility_coordinate_space(
        anchor_screen,
        anchor_window,
        origin_x,
        origin_y,
    )
    for node in nodes:
        if accessibility_source == "screen":
            bounds = node.get("bounds")
            offset_x = origin_x
            offset_y = origin_y
        elif accessibility_source == "window-local":
            bounds = node.get("backend_window_bounds")
            offset_x = 0.0
            offset_y = 0.0
        else:
            node["bounds"] = None
            continue
        if not usable_bounds(bounds):
            node["bounds"] = None
            continue
        node["bounds"] = {
            "x": (float(bounds["x"]) - offset_x) * scale_x,
            "y": (float(bounds["y"]) - offset_y) * scale_y,
            "width": float(bounds["width"]) * scale_x,
            "height": float(bounds["height"]) * scale_y,
        }
    return {
        "window_id": str(window.get("id") or ""),
        "geometry_source": source,
        "accessibility_source_space": accessibility_source,
        "origin_x": origin_x,
        "origin_y": origin_y,
        "scale_x": scale_x,
        "scale_y": scale_y,
        "image_width": int(png["width"]),
        "image_height": int(png["height"]),
    }


def usable_bounds(bounds):
    return (
        isinstance(bounds, dict)
        and float(bounds.get("width", 0)) > 0
        and float(bounds.get("height", 0)) > 0
    )


def bounds_size_distance(bounds, geometry):
    return abs(float(bounds["width"]) - float(geometry["width"])) + abs(
        float(bounds["height"]) - float(geometry["height"])
    )


def classify_accessibility_coordinate_space(screen_bounds, window_bounds, origin_x, origin_y):
    if not usable_bounds(screen_bounds) or not usable_bounds(window_bounds):
        return "unavailable"
    delta_x = float(screen_bounds["x"]) - float(window_bounds["x"])
    delta_y = float(screen_bounds["y"]) - float(window_bounds["y"])
    local_error = abs(delta_x) + abs(delta_y)
    screen_error = abs(delta_x - origin_x) + abs(delta_y - origin_y)
    tolerance = 2.0
    if local_error <= tolerance and screen_error <= tolerance:
        return "window-local"
    if local_error <= tolerance:
        return "window-local"
    if screen_error <= tolerance:
        return "screen"
    return "unavailable"


def map_window_image_point(root, x, y):
    if x is None or y is None:
        raise ValueError("foreground coordinates require both x and y")
    transform = root.get("backend_coordinate_transform") or {}
    point_x = float(x)
    point_y = float(y)
    width = float(transform.get("image_width", 0))
    height = float(transform.get("image_height", 0))
    if not (0 <= point_x < width and 0 <= point_y < height):
        raise ValueError(f"window-image coordinate ({point_x}, {point_y}) is outside {width}x{height}")
    scale_x = float(transform.get("scale_x", 0))
    scale_y = float(transform.get("scale_y", 0))
    if scale_x <= 0 or scale_y <= 0:
        raise ValueError("window coordinate transform has an invalid scale")
    return (
        float(transform["origin_x"]) + point_x / scale_x,
        float(transform["origin_y"]) + point_y / scale_y,
    )


def foreground_action_point(root, binding, action):
    if action.get("x") is not None or action.get("y") is not None:
        return map_window_image_point(root, action.get("x"), action.get("y"))
    if binding is None or binding.get("kind") != "atspi":
        raise ValueError("foreground action requires window-image coordinates or an AT-SPI element ref")
    transform = root.get("backend_coordinate_transform") or {}
    source_space = transform.get("accessibility_source_space")
    if source_space == "screen":
        bounds = accessible_bounds(binding["target"], AT_SPI_COORD_TYPE_SCREEN)
        offset_x = float(transform.get("origin_x", 0))
        offset_y = float(transform.get("origin_y", 0))
    elif source_space == "window-local":
        bounds = accessible_bounds(binding["target"], AT_SPI_COORD_TYPE_WINDOW)
        offset_x = 0.0
        offset_y = 0.0
    else:
        raise ValueError("AT-SPI coordinate space is unavailable; use explicit window-image coordinates")
    if not usable_bounds(bounds):
        raise ValueError("AT-SPI element has no usable bounds in the observed coordinate space")
    image_x = (float(bounds["x"]) + float(bounds["width"]) / 2 - offset_x) * float(transform["scale_x"])
    image_y = (float(bounds["y"]) + float(bounds["height"]) / 2 - offset_y) * float(transform["scale_y"])
    try:
        return map_window_image_point(root, image_x, image_y)
    except ValueError as error:
        raise ValueError("AT-SPI element center is outside the observed window image; call observe_ui again") from error


class ForegroundLease:
    def __init__(self, broker, root):
        self.broker = broker
        self.root = root
        self.snapshot = None
        self.cursor = None
        self.pointer_visual_active = False

    def acquire(self):
        validate_root_geometry(self.root, self.broker.list_windows)
        self.cursor = current_pointer_position()
        self.snapshot = run_kwin_script(
            "lease_acquire",
            {
                "window_id": self.root.get("backend_ref"),
                "expected_pid": int(self.root.get("pid") or 0),
                "expected_frame_geometry": self.root.get("frame_geometry"),
                "expected_buffer_geometry": self.root.get("buffer_geometry"),
            },
        ).get("lease")
        if not self.snapshot:
            raise RuntimeError("KWin did not return a foreground lease")

    def validate(self):
        if self.snapshot is None:
            raise RuntimeError("foreground lease is not active")
        validation = run_kwin_script("lease_validate", {"lease": self.snapshot})
        if not validation.get("owned"):
            raise RuntimeError("foreground lease lost window, focus, or geometry ownership")

    def ensure_pointer_visual(self):
        if self.pointer_visual_active or self.broker.glow is None:
            return
        self.broker.glow.start()
        self.pointer_visual_active = True

    def release(self):
        try:
            if self.snapshot is None:
                return {"backend": "foreground-lease", "outcome": "worked", "restored": False}
            validation = run_kwin_script("lease_validate", {"lease": self.snapshot})
            if validation.get("owned") and self.cursor is not None:
                if self.broker.pointer_restorer is not None:
                    self.broker.pointer_restorer(*self.cursor)
                elif self.broker.portal is not None:
                    self.broker.portal.pointer_move(*self.cursor)
            released = run_kwin_script("lease_release", {"lease": self.snapshot})
            self.snapshot = None
            restored = bool(released.get("restored"))
            return {
                "backend": "foreground-lease",
                "outcome": "worked" if restored else "unknown",
                "restored": restored,
                "reason": released.get("reason"),
            }
        finally:
            if self.pointer_visual_active:
                self.broker.glow.stop()
                self.pointer_visual_active = False


def launch_desktop_entry(entry):
    command = expand_exec(entry.get("exec", ""), [])
    if not command:
        raise ValueError(f"desktop entry has no executable command: {entry.get('desktop_id')}")
    return subprocess.Popen(
        command,
        cwd=os.path.expanduser("~"),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def preferred_accessible_action(interface):
    names = [str(interface.getName(index) or "").strip().lower() for index in range(interface.nActions)]
    for preferred in ("click", "press", "activate", "open"):
        for index, name in enumerate(names):
            if preferred in name:
                return index
    if not names:
        raise ValueError("AT-SPI Action interface exposes no actions")
    return 0


def read_binding_text(binding, start=0, end=-1):
    if binding["kind"] == "missing":
        raise ValueError("element is defunct")
    if binding["kind"] in ("application", "tray_item"):
        target = binding["target"]
        return str(target.get("name") or target.get("title") or target.get("id") or ""), None
    accessible = binding["target"]
    text = ""
    try:
        text_interface = accessible.queryText()
        character_count = int(text_interface.characterCount)
        actual_end = character_count if end < 0 else min(character_count, end)
        text = str(text_interface.getText(min(start, actual_end), actual_end))
    except Exception:
        text = accessible_text(accessible)
    value = None
    try:
        value = native(accessible.queryValue().currentValue)
    except Exception:
        pass
    return text, value


def read_binding_selection(binding):
    if binding["kind"] != "atspi":
        return []
    return accessible_selection(binding["target"])


def binding_snapshot(binding):
    if binding["kind"] == "missing":
        return {"alive": False, "role": "window", "text": "", "value": None}
    if binding["kind"] in ("application", "tray_item"):
        target = binding["target"]
        return {
            "alive": True,
            "role": "application" if binding["kind"] == "application" else "status icon",
            "text": str(target.get("name") or target.get("title") or target.get("id") or ""),
            "value": None,
        }
    accessible = binding["target"]
    try:
        import pyatspi

        state = accessible.getState()
        if state.contains(pyatspi.STATE_DEFUNCT):
            return {"alive": False, "role": "", "text": "", "value": None}
    except Exception:
        pass
    try:
        role = str(accessible.getRoleName() or "")
    except Exception:
        return {"alive": False, "role": "", "text": "", "value": None}
    text, value = read_binding_text(binding)
    return {"alive": True, "role": role, "text": text, "value": value}


def expectation_matches(snapshot, expect):
    if "gone" in expect:
        desired_gone = bool(expect["gone"])
        if desired_gone != (not snapshot["alive"]):
            return False
    elif not snapshot["alive"]:
        return False
    if "role" in expect and str(snapshot["role"]).strip().lower() != str(expect["role"]).strip().lower():
        return False
    if "text" in expect and str(expect["text"]) not in str(snapshot["text"]):
        return False
    if "value" in expect and snapshot["value"] != expect["value"]:
        return False
    return True


def evaluate_expectation(look_store, look_id, expect):
    wire_ref = expect.get("wire_ref")
    if wire_ref:
        snapshot = binding_snapshot(look_store.require(look_id, wire_ref))
        return expectation_matches(snapshot, expect), snapshot
    if expect.get("gone"):
        raise ValueError("expect.gone requires an element ref")
    snapshots = [binding_snapshot(binding) for binding in look_store.bindings(look_id)]
    for snapshot in snapshots:
        if expectation_matches(snapshot, expect):
            return True, snapshot
    return False, {"candidate_count": len(snapshots)}


def evaluate_observation_expectation(observation, expect):
    nodes = observation.get("outline", {}).get("nodes", [])
    if "gone" in expect:
        root = observation.get("root") or {}
        root_node = nodes[0] if nodes else {}
        snapshot = {
            "alive": root.get("present") is not False,
            "role": root_node.get("role", root.get("kind", "")),
            "text": root_node.get("text") or root_node.get("name") or root.get("title") or "",
            "value": root_node.get("value"),
        }
        return expectation_matches(snapshot, expect), snapshot
    for node in nodes:
        snapshot = {
            "alive": "defunct" not in (node.get("states") or []),
            "role": node.get("role", ""),
            "text": node.get("text") or node.get("name") or "",
            "value": node.get("value"),
        }
        if expectation_matches(snapshot, expect):
            return True, snapshot
    return False, {"candidate_count": len(nodes)}


def transaction_outcome(evidence, has_expectation):
    if has_expectation:
        expectation = next((item for item in reversed(evidence) if "matched" in item), None)
        if expectation is None:
            raise RuntimeError("transaction expectation evidence is missing")
        return expectation["outcome"]
    outcomes = [item.get("outcome") for item in evidence]
    if any(outcome == "unknown" for outcome in outcomes):
        return "unknown"
    if any(outcome == "didnt" for outcome in outcomes):
        return "didnt"
    return "worked"


def read_accessibility_tree(params, look_store=None, root_identity=None):
    import pyatspi

    max_depth = int(params.get("max_depth", 5))
    max_nodes = int(params.get("max_nodes", 200))
    target_window = params.get("target_window") or {}
    title_terms = accessibility_title_terms(target_window)
    target_pid = accessibility_target_pid(target_window)
    if target_pid <= 0:
        raise ValueError(f"KWin target window has no process id for AT-SPI scoping: {public_window(target_window, 'summary')}")
    if not title_terms:
        raise ValueError(f"KWin target window has no title for AT-SPI window scoping: {public_window(target_window, 'summary')}")
    desktop = pyatspi.Registry.getDesktop(0)
    roots = []
    app_candidates = []
    for index in range(desktop.childCount):
        try:
            app = desktop.getChildAtIndex(index)
            app_candidates.append(accessible_label(app))
            if accessible_process_id(app) != target_pid:
                continue
            roots.append(app)
        except Exception:
            continue
    if not roots:
        raise ValueError(
            "no AT-SPI application matched KWin window process id "
            f"pid={target_pid} candidates={app_candidates[:12]}"
        )
    tree_roots = roots
    window_match = "application"
    window_candidates = []
    if title_terms:
        exact_roots = []
        pid_window_roots = []
        for root in roots:
            matched_roots, window_roots, candidates = find_accessible_window_roots(root, title_terms)
            window_candidates.extend(candidates)
            exact_roots.extend(matched_roots)
            pid_window_roots.extend(window_roots)
        if exact_roots:
            tree_roots = exact_roots
            window_match = "exact-title"
        elif len(pid_window_roots) == 1:
            tree_roots = pid_window_roots
            window_match = "unique-pid-window"
        else:
            raise ValueError(
                "no AT-SPI window matched KWin window title "
                f"terms={title_terms} same_pid_window_count={len(pid_window_roots)} "
                f"candidates={window_candidates[:16]}"
            )
    if look_store is None:
        look_store = AccessibilityLookStore()
    if root_identity is None:
        root_identity = f"window:{target_window.get('id', '')}:desktop-pid:{target_pid}"
    look_id = look_store.begin(root_identity)
    nodes = []
    for root in tree_roots:
        walk_accessible(root, nodes, 0, max_depth, max_nodes, look_store, look_id)
        if len(nodes) >= max_nodes:
            break
    return {
        "backend": "at-spi",
        "look_id": look_id,
        "target_window": public_window(target_window, "summary") if target_window else None,
        "matched_app_count": len(roots),
        "matched_window_count": len(tree_roots),
        "window_match": window_match,
        "nodes": nodes,
        "truncated": len(nodes) >= max_nodes,
    }


def accessibility_target_pid(window):
    try:
        return int(window.get("pid", 0))
    except (TypeError, ValueError):
        return 0


def accessibility_title_terms(window):
    terms = []
    target_title = window_title(window)
    add_accessibility_term(terms, target_title)
    return terms


def add_accessibility_term(terms, value):
    if value is None:
        return
    text = str(value).strip()
    if not text:
        return
    normalized = normalized_accessible_text(text)
    if normalized and normalized not in terms:
        terms.append(normalized)


def find_accessible_window_roots(root, title_terms):
    matches = []
    window_roots = []
    candidates = []
    seen = set()

    def visit(accessible, depth):
        if depth > 3:
            return
        name = safe_attr(accessible, "name")
        role = safe_call(accessible, "getRoleName") or ""
        if name and is_accessible_window_role(role):
            label = accessible_label(accessible)
            candidates.append(label)
            window_roots.append(accessible)
            if any(accessible_title_matches(name, term) for term in title_terms):
                marker = id(accessible)
                if marker not in seen:
                    seen.add(marker)
                    matches.append(accessible)
        try:
            child_count = int(accessible.childCount)
        except Exception:
            child_count = 0
        for index in range(child_count):
            try:
                visit(accessible.getChildAtIndex(index), depth + 1)
            except Exception:
                continue

    visit(root, 0)
    return matches, window_roots, candidates


def is_accessible_window_role(role):
    normalized = str(role).strip().lower()
    return normalized in ("frame", "dialog", "window", "alert")


def accessible_title_matches(name, term):
    return normalized_accessible_text(name) == normalized_accessible_text(term)


def normalized_accessible_text(value):
    return re.sub(r"\s+", " ", str(value or "").strip())


def accessible_label(accessible):
    role = safe_call(accessible, "getRoleName") or ""
    name = safe_attr(accessible, "name")
    description = safe_attr(accessible, "description")
    return f"pid={accessible_process_id(accessible)} role={role} name={name} description={description}"


def accessible_process_id(accessible):
    try:
        return int(accessible.get_process_id())
    except Exception:
        return 0


def walk_accessible(accessible, nodes, depth, max_depth, max_nodes, look_store=None, look_id=None):
    if len(nodes) >= max_nodes or depth > max_depth:
        return
    name = safe_attr(accessible, "name")
    role = safe_call(accessible, "getRoleName") or ""
    capabilities = accessible_capabilities(accessible)
    node = {
        "depth": depth,
        "name": name,
        "role": role,
        "description": safe_attr(accessible, "description"),
        "states": accessible_states(accessible),
        "bounds": accessible_bounds(accessible, AT_SPI_COORD_TYPE_SCREEN),
        "backend_window_bounds": accessible_bounds(accessible, AT_SPI_COORD_TYPE_WINDOW),
        "capabilities": capabilities,
    }
    if look_store is not None and look_id is not None:
        node["wire_ref"] = look_store.bind(look_id, "atspi", accessible, capabilities)
    text = accessible_text(accessible)
    if text:
        node["text"] = text
    value = accessible_value(accessible)
    if value is not None:
        node["value"] = value
    selection = accessible_selection(accessible)
    if selection:
        node["selection"] = selection
    actions = accessible_actions(accessible)
    if actions:
        node["actions"] = actions
    nodes.append(node)
    if depth == max_depth:
        return
    try:
        child_count = int(accessible.childCount)
    except Exception:
        child_count = 0
    for index in range(child_count):
        if len(nodes) >= max_nodes:
            return
        try:
            child = accessible.getChildAtIndex(index)
            walk_accessible(child, nodes, depth + 1, max_depth, max_nodes, look_store, look_id)
        except Exception:
            continue


def safe_attr(obj, name):
    try:
        value = getattr(obj, name)
        return "" if value is None else str(value)
    except Exception:
        return ""


def safe_call(obj, name):
    try:
        return getattr(obj, name)()
    except Exception:
        return None


def accessible_states(accessible):
    try:
        import pyatspi

        state = accessible.getState()
        return [str(pyatspi.stateToString(item)) for item in state.getStates()]
    except Exception:
        return []


def accessible_bounds(accessible, coordinate_type=AT_SPI_COORD_TYPE_SCREEN):
    try:
        component = accessible.queryComponent()
        x, y, width, height = component.getExtents(coordinate_type)
        return {"x": x, "y": y, "width": width, "height": height}
    except Exception:
        return None


def accessible_text(accessible):
    try:
        text = accessible.queryText()
        count = min(int(text.characterCount), 500)
        return text.getText(0, count)
    except Exception:
        return ""


def accessible_actions(accessible):
    try:
        action = accessible.queryAction()
        return [action.getName(index) for index in range(action.nActions)]
    except Exception:
        return []


def accessible_value(accessible):
    try:
        return native(accessible.queryValue().currentValue)
    except Exception:
        return None


def accessible_selection(accessible):
    try:
        selection = accessible.querySelection()
        selected = []
        for index in range(int(selection.nSelectedChildren)):
            child = selection.getSelectedChild(index)
            selected.append({"name": safe_attr(child, "name"), "role": safe_call(child, "getRoleName") or ""})
        return selected
    except Exception:
        return []


def accessible_capabilities(accessible):
    capabilities = []
    for name, query in (
        ("action", "queryAction"),
        ("editable_text", "queryEditableText"),
        ("text", "queryText"),
        ("value", "queryValue"),
        ("selection", "querySelection"),
        ("component", "queryComponent"),
    ):
        try:
            getattr(accessible, query)()
            capabilities.append(name)
        except Exception:
            pass
    return capabilities


def main():
    broker = Broker()
    output_lock = threading.Lock()
    executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="computer-use")

    def respond(payload):
        with output_lock:
            print(json.dumps(payload, ensure_ascii=False), flush=True)

    def process_request(request):
        request_id = request.get("id")
        try:
            result = broker.handle(request.get("method"), request.get("params") or {})
            respond({"id": request_id, "ok": True, "result": result})
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            respond({"id": request_id, "ok": False, "error": str(error)})

    def terminate(signum, frame):
        del frame
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGINT, terminate)
    signal.signal(signal.SIGTERM, terminate)
    try:
        for line in sys.stdin:
            if not line.strip():
                continue
            request = json.loads(line)
            executor.submit(process_request, request)
    finally:
        try:
            broker.stop()
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
        executor.shutdown(wait=False, cancel_futures=True)


if __name__ == "__main__":
    main()
