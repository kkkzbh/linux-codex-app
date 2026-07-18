#!/usr/bin/env python3

import argparse
import contextlib
import importlib.util
import json
import os
import re
import select
import shlex
import shutil
import signal
import subprocess
import sys
import time
import traceback
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
BROKER_PATH = SCRIPT_DIR / "computer-use-broker.py"
XWAYLAND_ENVIRONMENT_HELPER_PATH = SCRIPT_DIR / "computer-use-xwayland-environment.py"


def load_foreground_module():
    spec = importlib.util.spec_from_file_location("codex_computer_use_foreground", BROKER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load Computer Use broker module: {BROKER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FOREGROUND = load_foreground_module()


def log(message):
    print(f"[computer-use-isolated] {message}", file=sys.stderr, flush=True)


class Deadline:
    def __init__(self, timeout_ms):
        self.end = time.monotonic() + max(1, int(timeout_ms)) / 1000.0

    def remaining(self):
        remaining = self.end - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("isolated Computer Use operation exceeded its deadline")
        return remaining

    def sleep(self, seconds):
        seconds = max(0.0, float(seconds))
        if seconds > self.remaining():
            raise TimeoutError("isolated Computer Use operation exceeded its deadline")
        time.sleep(seconds)


def parse_busctl_reply(output, expected_type):
    try:
        reply = json.loads(output)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"D-Bus readiness probe returned invalid JSON: {output!r}") from error
    if reply.get("type") != expected_type or len(reply.get("data", [])) != 1:
        raise RuntimeError(f"D-Bus readiness probe returned an invalid reply: {reply}")
    return reply["data"][0]


def parse_xwayland_environment(output):
    try:
        payload = json.loads(output)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Xwayland environment bridge returned invalid JSON: {output!r}") from error
    if payload.get("version") != 1:
        raise RuntimeError(f"Xwayland environment bridge returned an unsupported version: {payload!r}")
    display = payload.get("display")
    if not isinstance(display, str) or re.fullmatch(r":\d+", display) is None:
        raise RuntimeError(f"Xwayland environment bridge returned an invalid display: {display!r}")
    xauthority = payload.get("xauthority")
    if not isinstance(xauthority, str):
        raise RuntimeError(f"Xwayland environment bridge returned an invalid Xauthority value: {xauthority!r}")
    environment = {"DISPLAY": display}
    if xauthority:
        environment["XAUTHORITY"] = xauthority
    return environment


def build_kwin_command(screen_width, screen_height, socket_name, environment_path):
    environment_helper = shlex.join(
        [sys.executable, str(XWAYLAND_ENVIRONMENT_HELPER_PATH), str(environment_path)]
    )
    return [
        "kwin_wayland",
        "--virtual",
        "--no-lockscreen",
        "--xwayland",
        "--width",
        str(screen_width),
        "--height",
        str(screen_height),
        "--socket",
        socket_name,
        environment_helper,
    ]


class KWinEisInput:
    def __init__(self, env, timeout_seconds, helper):
        self.process = subprocess.Popen(
            [str(helper)],
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self.next_id = 1
        readable, _, _ = select.select([self.process.stdout.fileno()], [], [], timeout_seconds)
        if not readable:
            raise TimeoutError("Computer Use EIS helper did not report readiness")
        line = self.process.stdout.readline()
        if not line:
            with contextlib.suppress(subprocess.TimeoutExpired):
                self.process.wait(timeout=0.2)
            detail = self.process.stderr.read().strip() if self.process.poll() is not None else ""
            raise RuntimeError(detail or f"Computer Use EIS helper exited during startup: {self.process.returncode}")
        ready = json.loads(line)
        if ready.get("event") != "ready":
            raise RuntimeError(f"Computer Use EIS helper returned invalid readiness data: {ready}")

    def _call(self, operation):
        request_id = self.next_id
        self.next_id += 1
        operation["id"] = request_id
        self.process.stdin.write(json.dumps(operation) + "\n")
        self.process.stdin.flush()
        response = json.loads(self.process.stdout.readline())
        if response.get("id") != request_id or not response.get("ok"):
            raise RuntimeError(response.get("error") or "Computer Use EIS helper returned an invalid response")

    def move(self, x, y):
        self._call({"op": "move", "x": float(x), "y": float(y)})

    def button(self, code, pressed):
        self._call({"op": "button", "code": int(code), "pressed": bool(pressed)})

    def scroll(self, dx, dy, stop=False):
        self._call({"op": "scroll", "dx": float(dx), "dy": float(dy), "stop": bool(stop)})

    def key(self, keycode, pressed):
        self._call({"op": "key", "code": int(keycode), "pressed": bool(pressed)})

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            with contextlib.suppress(subprocess.TimeoutExpired):
                self.process.wait(timeout=2)
        if self.process.poll() is None:
            self.process.kill()


ASCII_KEYCODES = {}
for normal, shifted, codes in [
    ("`1234567890-=", "~!@#$%^&*()_+", [41, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]),
    ("qwertyuiop[]\\", "QWERTYUIOP{}|", [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 43]),
    ("asdfghjkl;'", 'ASDFGHJKL:"', [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40]),
    ("zxcvbnm,./", "ZXCVBNM<>?", [44, 45, 46, 47, 48, 49, 50, 51, 52, 53]),
]:
    for char, code in zip(normal, codes, strict=True):
        ASCII_KEYCODES[char] = (code, False)
    for char, code in zip(shifted, codes, strict=True):
        ASCII_KEYCODES[char] = (code, True)
ASCII_KEYCODES.update({" ": (57, False), "\t": (15, False), "\n": (28, False)})


class IsolatedSession:
    def __init__(self, args):
        self.args = args
        self.session_id = args.session_id
        self.profile_dir = Path(args.profile_dir)
        self.runtime_dir = Path(args.runtime_dir)
        self.socket_name = "wayland-codex"
        self.xwayland_environment_path = self.runtime_dir / "xwayland-environment.json"
        self.dbus_address = f"unix:path={self.runtime_dir / 'bus'}"
        self.atspi_bus_address = None
        self.processes = []
        self.critical_processes = []
        self.input = None
        self.foreground_broker = FOREGROUND.Broker(pointer_visuals=False)
        self.foreground_broker.physical_executor = self._execute_v2_foreground_action
        self.foreground_broker.pointer_restorer = self._restore_pointer
        self.log_handles = []
        self.env = self._build_env()
        os.environ.clear()
        os.environ.update(self.env)

    def _publish_runtime_environment(self, environment):
        self.env.update(environment)
        os.environ.update(environment)

    def _restore_pointer(self, x, y):
        if self.input is not None:
            self.input.move(x, y)

    def _validate_required_helpers(self):
        executable_helpers = {
            "screenshot": Path(self.env["CODEX_COMPUTER_USE_SCREENSHOT_HELPER"]),
            "EIS": Path(self.env["CODEX_COMPUTER_USE_EIS_HELPER"]),
        }
        for name, path in executable_helpers.items():
            if not path.is_file() or not os.access(path, os.X_OK):
                raise RuntimeError(f"Computer Use {name} helper is unavailable: {path}")
        if not XWAYLAND_ENVIRONMENT_HELPER_PATH.is_file():
            raise RuntimeError(f"Xwayland environment helper is unavailable: {XWAYLAND_ENVIRONMENT_HELPER_PATH}")

    def _build_env(self):
        screenshot_helper = FOREGROUND.screenshot_helper_path()
        eis_helper = Path(os.environ.get("CODEX_COMPUTER_USE_EIS_HELPER") or screenshot_helper.with_name("codex-computer-use-eis"))
        for relative in [".config", ".local/share", ".local/state", ".cache", "logs"]:
            (self.profile_dir / relative).mkdir(parents=True, exist_ok=True)
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self.runtime_dir.chmod(0o700)
        env = dict(os.environ)
        env.update(
            {
                "HOME": str(self.profile_dir),
                "XDG_CONFIG_HOME": str(self.profile_dir / ".config"),
                "XDG_DATA_HOME": str(self.profile_dir / ".local/share"),
                "XDG_CACHE_HOME": str(self.profile_dir / ".cache"),
                "XDG_STATE_HOME": str(self.profile_dir / ".local/state"),
                "XDG_RUNTIME_DIR": str(self.runtime_dir),
                "DBUS_SESSION_BUS_ADDRESS": self.dbus_address,
                "KDE_FULL_SESSION": "true",
                "KDE_SESSION_VERSION": "6",
                "XDG_SESSION_TYPE": "wayland",
                "XDG_CURRENT_DESKTOP": "KDE",
                "QT_QPA_PLATFORM": "wayland",
                "QT_LINUX_ACCESSIBILITY_ALWAYS_ON": "1",
                "QT_ACCESSIBILITY": "1",
                "ATSPI_DBUS_IMPLEMENTATION": "dbus-daemon",
                "KWIN_SCREENSHOT_NO_PERMISSION_CHECKS": "1",
                "KWIN_WAYLAND_NO_PERMISSION_CHECKS": "1",
                "CODEX_COMPUTER_USE_SCREENSHOT_HELPER": str(screenshot_helper),
                "CODEX_COMPUTER_USE_EIS_HELPER": str(eis_helper),
            }
        )
        env.pop("DISPLAY", None)
        env.pop("WAYLAND_DISPLAY", None)
        env.pop("XAUTHORITY", None)
        return env

    def _log(self, name):
        handle = (self.profile_dir / "logs" / f"{name}.log").open("ab", buffering=0)
        self.log_handles.append(handle)
        return handle

    def _spawn(self, command, name, env=None, critical=False):
        process = subprocess.Popen(
            command,
            env=env or self.env,
            cwd=self.profile_dir,
            stdin=subprocess.DEVNULL,
            stdout=self._log(name),
            stderr=subprocess.STDOUT,
        )
        self.processes.append(process)
        if critical:
            self.critical_processes.append(process)
        return process

    def _dbus_call(self, address, destination, object_path, interface, method, deadline, signature=None, arguments=None):
        command = [
            "busctl",
            f"--address={address}",
            "--json=short",
            f"--timeout={max(0.1, min(1.0, deadline.remaining()))}s",
            "call",
            destination,
            object_path,
            interface,
            method,
        ]
        if signature:
            command.append(signature)
            command.extend(arguments or [])
        result = subprocess.run(
            command,
            env=self.env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=max(0.1, min(1.5, deadline.remaining())),
        )
        if result.returncode != 0:
            detail = result.stderr.strip() or result.stdout.strip()
            raise RuntimeError(f"D-Bus readiness probe failed: {detail or f'busctl exited with {result.returncode}'}")
        return result.stdout

    def _bus_name_has_owner(self, address, name, deadline):
        output = self._dbus_call(
            address,
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "NameHasOwner",
            deadline,
            "s",
            [name],
        )
        owned = parse_busctl_reply(output, "b")
        if not isinstance(owned, bool):
            raise RuntimeError(f"D-Bus NameHasOwner returned a non-boolean value: {owned!r}")
        return owned

    def _wait_for_bus_name(self, address, name, deadline, component):
        while not self._bus_name_has_owner(address, name, deadline):
            self._require_children_alive()
            try:
                deadline.sleep(0.05)
            except TimeoutError as error:
                raise RuntimeError(f"{component} did not own {name} before the startup deadline") from error

    def _get_atspi_bus_address(self, deadline):
        output = self._dbus_call(
            self.dbus_address,
            "org.a11y.Bus",
            "/org/a11y/bus",
            "org.a11y.Bus",
            "GetAddress",
            deadline,
        )
        address = parse_busctl_reply(output, "s")
        if not isinstance(address, str) or not address.startswith("unix:"):
            raise RuntimeError(f"AT-SPI bus launcher returned an invalid address: {address!r}")
        return address

    def _wait_for_xwayland_environment(self, deadline):
        while not self.xwayland_environment_path.exists():
            self._require_children_alive()
            try:
                deadline.sleep(0.05)
            except TimeoutError as error:
                raise RuntimeError("KWin did not publish its managed Xwayland environment before the startup deadline") from error
        try:
            output = self.xwayland_environment_path.read_text(encoding="utf-8")
        except OSError as error:
            raise RuntimeError(f"could not read the KWin Xwayland environment: {error}") from error
        return parse_xwayland_environment(output)

    def start(self, timeout_ms):
        deadline = Deadline(timeout_ms)
        self._validate_required_helpers()
        log("starting private D-Bus")
        self._spawn(
            ["dbus-daemon", "--session", "--nofork", "--nopidfile", f"--address={self.dbus_address}"],
            "dbus",
            critical=True,
        )
        bus_path = self.runtime_dir / "bus"
        while not bus_path.exists():
            self._require_children_alive()
            deadline.sleep(0.05)

        log("starting private AT-SPI")
        atspi_launcher = Path("/usr/libexec/at-spi-bus-launcher")
        if not atspi_launcher.is_file():
            raise RuntimeError(f"AT-SPI bus launcher is unavailable: {atspi_launcher}")
        self._spawn([str(atspi_launcher), "--launch-immediately"], "at-spi-bus", critical=True)
        self._wait_for_bus_name(self.dbus_address, "org.a11y.Bus", deadline, "AT-SPI bus launcher")
        self.atspi_bus_address = self._get_atspi_bus_address(deadline)
        self._publish_runtime_environment({"AT_SPI_BUS_ADDRESS": self.atspi_bus_address})
        registry = Path("/usr/libexec/at-spi2-registryd")
        if not registry.is_file():
            raise RuntimeError(f"AT-SPI registry is unavailable: {registry}")
        self._spawn([str(registry)], "at-spi-registry", critical=True)
        self._wait_for_bus_name(
            self.atspi_bus_address,
            "org.a11y.atspi.Registry",
            deadline,
            "AT-SPI registry",
        )

        kwin_env = dict(self.env)
        kwin_env.pop("QT_QPA_PLATFORM", None)
        self.kwin = self._spawn(
            build_kwin_command(
                self.args.screen_width,
                self.args.screen_height,
                self.socket_name,
                self.xwayland_environment_path,
            ),
            "kwin",
            kwin_env,
            critical=True,
        )
        socket_path = self.runtime_dir / self.socket_name
        while not socket_path.exists():
            self._require_children_alive()
            deadline.sleep(0.05)
        self._publish_runtime_environment(
            {
                "WAYLAND_DISPLAY": self.socket_name,
                **self._wait_for_xwayland_environment(deadline),
            }
        )

        activation_environment = [
            f"WAYLAND_DISPLAY={self.socket_name}",
            f"DISPLAY={self.env['DISPLAY']}",
            "QT_QPA_PLATFORM=wayland",
        ]
        if "XAUTHORITY" in self.env:
            activation_environment.append(f"XAUTHORITY={self.env['XAUTHORITY']}")
        subprocess.run(
            ["dbus-update-activation-environment", *activation_environment],
            env=self.env,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=deadline.remaining(),
        )

        log("connecting native KWin EIS helper")
        last_error = None
        while self.input is None:
            try:
                self.input = KWinEisInput(
                    self.env,
                    min(10.0, deadline.remaining()),
                    Path(self.env["CODEX_COMPUTER_USE_EIS_HELPER"]),
                )
            except Exception as error:
                last_error = error
                self._require_children_alive()
                log(f"KWin EIS is not ready: {error}")
                try:
                    deadline.sleep(0.5)
                except TimeoutError as timeout_error:
                    raise RuntimeError(f"native KWin EIS readiness failed: {last_error}") from timeout_error
        log("verifying direct KWin ScreenShot2")
        try:
            FOREGROUND.capture_kwin_screenshot_png(None, deadline.remaining(), env=self.env)
        except Exception as error:
            raise RuntimeError(f"isolated ScreenShot2 readiness check failed: {error}") from error
        log("session ready")
        return self.status()

    def _require_children_alive(self):
        for process in self.critical_processes:
            return_code = process.poll()
            if return_code is not None:
                raise RuntimeError(f"isolated session process exited during startup: pid={process.pid} code={return_code}")

    def status(self):
        return {
            "session_id": self.session_id,
            "isolation": "gui-profile",
            "screen": {"width": self.args.screen_width, "height": self.args.screen_height},
            "profile_dir": str(self.profile_dir),
            "runtime_dir": str(self.runtime_dir),
            "wayland_display": self.socket_name,
            "xwayland_display": self.env.get("DISPLAY"),
        }

    def handle(self, method, params):
        handlers = {
            "find_roots": self.find_roots_v2,
            "observe_root": self.foreground_broker.observe_root,
            "read_text": self.foreground_broker.read_text_v2,
            "act_transaction": self.foreground_broker.act_transaction,
            "wait_for": self.foreground_broker.wait_for_v2,
        }
        handler = handlers.get(method)
        if handler is None:
            raise ValueError(f"isolated backend does not implement protocol method: {method}")
        return handler(params)

    def find_roots_v2(self, params):
        kind = str(params.get("kind") or "window")
        if kind == "tray_item":
            raise ValueError("isolated sessions do not own a Plasma StatusNotifierItem watcher")
        if kind != "all":
            return self.foreground_broker.find_roots(params)
        window_params = {**params, "kind": "window"}
        application_params = {**params, "kind": "application"}
        windows = self.foreground_broker.find_roots(window_params)["roots"]
        applications = self.foreground_broker.find_roots(application_params)["roots"]
        limit = max(1, min(200, int(params.get("limit", 50))))
        roots = (windows + applications)[:limit]
        return {
            "protocol_version": FOREGROUND.COMPUTER_USE_PROTOCOL_VERSION,
            "roots": roots,
            "truncated": len(windows) + len(applications) > limit,
        }

    def _execute_v2_foreground_action(self, root, binding, op, action):
        deadline = Deadline(120000)
        if op in ("press", "click"):
            x, y = FOREGROUND.foreground_action_point(root, binding, action)
            delivery = self.click({"x": x, "y": y, "button": action.get("button", "left"), "count": action.get("count", 1)}, deadline)
        elif op == "drag":
            x, y = FOREGROUND.foreground_action_point(root, binding, action)
            to_x, to_y = FOREGROUND.map_window_image_point(root, action.get("to_x"), action.get("to_y"))
            delivery = self.drag({"x": x, "y": y, "to_x": to_x, "to_y": to_y, "button": action.get("button", "left")}, deadline)
        elif op == "scroll":
            payload = {"dx": action.get("dx", 0), "dy": action.get("dy", 0), "steps": 1}
            if binding is not None or (action.get("x") is not None and action.get("y") is not None):
                payload["x"], payload["y"] = FOREGROUND.foreground_action_point(root, binding, action)
            delivery = self.scroll(payload, deadline)
        elif op == "key":
            if not action.get("key"):
                raise ValueError("key action requires key")
            delivery = self.key({"key": action["key"], "modifiers": action.get("modifiers") or [], "repeat": 1}, deadline)
        elif op == "type_text":
            if not isinstance(action.get("text"), str):
                raise ValueError("type_text requires text")
            delivery = self.type_text({"text": action["text"]}, deadline)
        elif op == "set_text":
            if binding is None:
                raise ValueError("foreground set_text requires an element ref")
            x, y = FOREGROUND.foreground_action_point(root, binding, action)
            self.click({"x": x, "y": y, "button": "left", "count": 1}, deadline)
            self.key({"key": "a", "modifiers": ["ctrl"], "repeat": 1}, deadline)
            delivery = self.type_text({"text": action.get("text", "")}, deadline)
        else:
            raise ValueError(f"unknown isolated UI action: {op}")
        return {"op": op, "backend": delivery.get("backend", "kwin-eis"), "outcome": "unknown", "delivered": True}

    def _move_pointer(self, x, y, deadline):
        current = FOREGROUND.run_kwin_script("cursor_position", {})
        start_x, start_y = float(current["x"]), float(current["y"])
        duration_ms, steps = FOREGROUND.pointer_animation_params(start_x, start_y, x, y)
        for step in range(1, steps + 1):
            t = FOREGROUND.minimum_jerk(step / steps)
            self.input.move(start_x + (x - start_x) * t, start_y + (y - start_y) * t)
            if step < steps:
                deadline.sleep(duration_ms / 1000.0 / steps)
        return {"animated": steps > 1, "animation_steps": steps, "animation_ms": duration_ms}

    def click(self, params, deadline):
        x, y = float(params["x"]), float(params["y"])
        animation = self._move_pointer(x, y, deadline)
        code = FOREGROUND.BUTTON_CODES[params.get("button", "left")]
        count = int(params.get("count", 1))
        interval = int(params.get("interval_ms", 120)) / 1000.0
        for index in range(count):
            self.input.button(code, True)
            deadline.sleep(0.04)
            self.input.button(code, False)
            if index + 1 < count and interval:
                deadline.sleep(interval)
        return {"clicked": True, "backend": "kwin-eis", "session_id": self.session_id, "x": x, "y": y, "count": count, **animation}

    def drag(self, params, deadline):
        x, y = float(params["x"]), float(params["y"])
        to_x, to_y = float(params["to_x"]), float(params["to_y"])
        self._move_pointer(x, y, deadline)
        code = FOREGROUND.BUTTON_CODES[params.get("button", "left")]
        self.input.button(code, True)
        steps = int(params.get("steps", 20))
        delay = int(params.get("duration_ms", 500)) / 1000.0 / steps
        try:
            for step in range(1, steps + 1):
                t = step / steps
                self.input.move(x + (to_x - x) * t, y + (to_y - y) * t)
                if step < steps:
                    deadline.sleep(delay)
        finally:
            self.input.button(code, False)
        return {"dragged": True, "backend": "kwin-eis", "session_id": self.session_id, "from": [x, y], "to": [to_x, to_y]}

    def scroll(self, params, deadline):
        if "x" in params or "y" in params:
            if "x" not in params or "y" not in params:
                raise ValueError("scroll requires both x and y when positioning the pointer")
            self._move_pointer(float(params["x"]), float(params["y"]), deadline)
        steps = int(params.get("steps", 1))
        for index in range(steps):
            self.input.scroll(float(params.get("dx", 0)), float(params.get("dy", 0)), index + 1 == steps)
        return {"scrolled": True, "backend": "kwin-eis", "session_id": self.session_id, "steps": steps}

    def _keycode(self, key):
        normalized = str(key).lower()
        if normalized in FOREGROUND.PORTAL_KEYCODES:
            return FOREGROUND.PORTAL_KEYCODES[normalized]
        if len(key) == 1 and key in ASCII_KEYCODES:
            return ASCII_KEYCODES[key][0]
        raise ValueError(f"unsupported isolated keyboard key: {key}")

    def _key_combo(self, key, modifiers):
        codes = [FOREGROUND.MODIFIER_KEYCODES[item] for item in modifiers]
        for code in codes:
            self.input.key(code, True)
        try:
            code = self._keycode(key)
            self.input.key(code, True)
            self.input.key(code, False)
        finally:
            for code in reversed(codes):
                self.input.key(code, False)

    def key(self, params, deadline):
        del deadline
        modifiers = params.get("modifiers") or []
        repeat = int(params.get("repeat", 1))
        for _ in range(repeat):
            self._key_combo(params["key"], modifiers)
        return {"pressed": True, "backend": "kwin-eis", "session_id": self.session_id, "key": params["key"], "modifiers": modifiers, "repeat": repeat}

    def _type_ascii(self, text):
        for char in text:
            code, shift = ASCII_KEYCODES[char]
            if shift:
                self.input.key(FOREGROUND.MODIFIER_KEYCODES["shift"], True)
            self.input.key(code, True)
            self.input.key(code, False)
            if shift:
                self.input.key(FOREGROUND.MODIFIER_KEYCODES["shift"], False)

    def _paste(self, text, deadline):
        process = subprocess.Popen(
            ["wl-copy", "--paste-once", "--type", "text/plain;charset=utf-8"],
            env=self.env,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=self._log("wl-copy"),
            text=True,
        )
        process.stdin.write(text)
        process.stdin.close()
        deadline.sleep(0.1)
        self._key_combo("v", ["ctrl"])
        with contextlib.suppress(subprocess.TimeoutExpired):
            process.wait(timeout=min(2.0, deadline.remaining()))
        if process.poll() is None:
            process.terminate()

    def type_text(self, params, deadline):
        text = params["text"]
        method = params.get("method", "auto")
        ascii_supported = all(char in ASCII_KEYCODES for char in text)
        if method == "clipboard" or not ascii_supported:
            self._paste(text, deadline)
            used = "clipboard"
        else:
            self._type_ascii(text)
            used = "keycodes"
        if params.get("submit", False):
            self._key_combo("enter", [])
        return {"typed": True, "backend": "kwin-eis", "session_id": self.session_id, "method": used, "characters": len(text), "submitted": bool(params.get("submit", False))}

    def close(self):
        if self.input is not None:
            with contextlib.suppress(Exception):
                self.input.close()
            self.input = None
        for process in reversed(self.processes):
            if process.poll() is None:
                with contextlib.suppress(ProcessLookupError):
                    process.terminate()
        end = time.monotonic() + 2.0
        for process in reversed(self.processes):
            if process.poll() is None:
                with contextlib.suppress(subprocess.TimeoutExpired):
                    process.wait(timeout=max(0.01, end - time.monotonic()))
            if process.poll() is None:
                with contextlib.suppress(ProcessLookupError):
                    process.kill()
        for handle in self.log_handles:
            with contextlib.suppress(Exception):
                handle.close()


def session_main(args):
    session = IsolatedSession(args)
    exiting = False

    def terminate(signum, frame):
        del signum, frame
        nonlocal exiting
        exiting = True

    signal.signal(signal.SIGTERM, terminate)
    signal.signal(signal.SIGINT, terminate)
    try:
        ready = session.start(args.timeout_ms)
        print(json.dumps({"event": "state", "state": "Ready", "result": ready}, ensure_ascii=False), flush=True)
        while not exiting:
            line = sys.stdin.readline()
            if not line:
                break
            request = json.loads(line)
            request_id = request.get("id")
            method = request.get("method")
            if method == "shutdown":
                print(json.dumps({"id": request_id, "ok": True, "result": {"stopping": True}}), flush=True)
                break
            try:
                result = session.handle(method, request.get("params") or {})
                response = {"id": request_id, "ok": True, "result": result}
            except Exception as error:
                traceback.print_exc(file=sys.stderr)
                response = {"id": request_id, "ok": False, "error": str(error)}
            print(json.dumps(response, ensure_ascii=False), flush=True)
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"event": "state", "state": "Failed", "error": str(error)}, ensure_ascii=False), flush=True)
        return 1
    finally:
        session.close()
    return 0


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-id")
    parser.add_argument("--profile-dir")
    parser.add_argument("--runtime-dir")
    parser.add_argument("--screen-width", type=int, default=1280)
    parser.add_argument("--screen-height", type=int, default=800)
    parser.add_argument("--timeout-ms", type=int, default=60000)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    if not arguments.session_id or not arguments.profile_dir or not arguments.runtime_dir:
        raise SystemExit("isolated session requires session-id, profile-dir, and runtime-dir")
    raise SystemExit(session_main(arguments))
