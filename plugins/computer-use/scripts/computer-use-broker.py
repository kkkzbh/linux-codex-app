#!/usr/bin/env python3

import base64
import io
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import uuid
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

DEVICE_KEYBOARD = 1
DEVICE_POINTER = 2
SCREENCAST_SOURCE_MONITOR = 1
SCREENCAST_CURSOR_EMBEDDED = 2
BUTTON_CODES = {
    "left": 272,
    "right": 273,
    "middle": 274,
}
DEFAULT_POINTER_ANIMATION_MS = 220
DEFAULT_POINTER_ANIMATION_STEP_PX = 18
MAX_POINTER_ANIMATION_STEPS = 80
MIN_POINTER_ANIMATION_STEPS = 2
SCRIPT_DIR = Path(__file__).resolve().parent
GLOW_OVERLAY_SCRIPT = SCRIPT_DIR / "computer-use-glow-overlay.py"
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


def requested_backend(params):
    backend = params.get("backend") or os.environ.get("CODEX_COMPUTER_USE_BACKEND") or "direct"
    backend = str(backend).strip().lower()
    if backend not in ("direct", "portal", "auto"):
        raise ValueError(f"unknown backend: {backend}")
    return backend


def ensure_portal_input(params):
    backend = params.get("backend")
    if backend is not None and str(backend).strip().lower() != "portal":
        raise ValueError("KDE Wayland foreground input is RemoteDesktop portal-only")


def current_pointer_position():
    try:
        data = run_kwin_script("cursor_position", {})
        return (float(data["x"]), float(data["y"]))
    except Exception as error:
        debug(f"could not read current pointer position: {error}")
        return None


def pointer_animation_params(params, start_x, start_y, x, y):
    duration_ms = int(
        params.get(
            "animation_ms",
            os.environ.get("CODEX_COMPUTER_USE_POINTER_ANIMATION_MS", DEFAULT_POINTER_ANIMATION_MS),
        )
    )
    duration_ms = max(0, min(2000, duration_ms))
    distance = ((x - start_x) ** 2 + (y - start_y) ** 2) ** 0.5
    if "animation_steps" in params:
        steps = int(params["animation_steps"])
    else:
        steps = int(round(distance / DEFAULT_POINTER_ANIMATION_STEP_PX))
    steps = max(MIN_POINTER_ANIMATION_STEPS, min(MAX_POINTER_ANIMATION_STEPS, steps))
    if distance < 1:
        return (0, 1)
    return (duration_ms, steps)


def smoothstep(t):
    t = max(0.0, min(1.0, float(t)))
    return t * t * (3 - 2 * t)


def direct_setup_hint(kind):
    if kind == "observe":
        return (
            "Direct screenshot requires launching Codex from the activated KDE desktop entry "
            "that declares X-KDE-DBUS-Restricted-Interfaces=org.kde.KWin.ScreenShot2. "
            "Run scripts/activate-install.sh for the staged install and restart Codex from that launcher."
        )
    return "Foreground input uses the pre-authorized KDE RemoteDesktop portal."


class DirectBackendUnavailable(RuntimeError):
    pass


class Broker:
    def __init__(self):
        self.portal = None
        self.desktop_snapshots = {}
        self.pointer_position = None
        self.round_id = None
        self.round_active = False
        self.glow_active = False
        self.glow = GlowOverlay()

    def handle(self, method, params):
        if method == "computer_begin_round":
            return self.begin_round(params)
        if method == "computer_end_round":
            return self.end_round(params)
        if method == "computer_observe":
            return self.observe(params)
        if method == "computer_list_desktops":
            return self.list_desktops(params)
        if method == "computer_list_apps":
            return self.list_apps(params)
        if method == "computer_list_tray_items":
            return self.list_tray_items(params)
        if method == "computer_list_windows":
            return self.list_windows(params)
        if method == "computer_open_app":
            return self.open_app(params)
        if method == "computer_activate_tray_item":
            return self.activate_tray_item(params)
        if method == "computer_activate_window":
            return self.activate_window(params)
        if method == "computer_click":
            return self.click(params)
        if method == "computer_drag":
            return self.drag(params)
        if method == "computer_scroll":
            return self.scroll(params)
        if method == "computer_key":
            return self.key(params)
        if method == "computer_type":
            return self.type_text(params)
        if method == "computer_release_desktops":
            return self.release_desktops(params)
        if method == "computer_wait":
            return self.wait(params)
        if method == "computer_get_accessibility_tree":
            return self.accessibility_tree(params)
        raise ValueError(f"unknown method: {method}")

    def ensure_portal(self):
        if self.portal is None:
            self.portal = PortalSession()
        return self.portal

    def observe(self, params):
        include_image = params.get("include_image", True)
        include_windows = params.get("include_windows", True)
        timeout_ms = int(params.get("timeout_ms", 180000))
        backend = requested_backend(params)
        try:
            if backend in ("direct", "auto"):
                result = self.observe_direct(params, include_image, timeout_ms)
            else:
                result = self.observe_portal(params, include_image, timeout_ms)
        except DirectBackendUnavailable as error:
            if backend == "auto" and params.get("allow_portal_fallback", False):
                result = self.observe_portal(params, include_image, timeout_ms)
                result["direct_error"] = str(error)
            else:
                raise
        if include_windows:
            result["windows"] = self.list_windows({}).get("windows", [])
        return result

    def observe_direct(self, params, include_image, timeout_ms):
        result = {
            "backend": "kwin-screenshot2",
            "desktop": desktop_summary(),
            "foreground_only": True,
            "setup_hint": direct_setup_hint("observe"),
        }
        if include_image:
            try:
                png = capture_kwin_screenshot_png(params.get("crop"), timeout_ms / 1000.0)
            except Exception as error:
                raise DirectBackendUnavailable(f"{error}; {direct_setup_hint('observe')}") from error
            result["image"] = {
                "mime_type": "image/png",
                "data_base64": base64.b64encode(png["bytes"]).decode("ascii"),
                "width": png["width"],
                "height": png["height"],
                "cropped": png["cropped"],
            }
            result["stream"] = {
                "id": "kwin-workspace",
                "properties": {
                    "position": [0, 0],
                    "size": [png["width"], png["height"]],
                    "source_type": "workspace",
                    "scale": png.get("scale"),
                    "coordinate_space": "native-pixels",
                },
            }
        return result

    def observe_portal(self, params, include_image, timeout_ms):
        portal = self.ensure_portal()
        portal.ensure_remote(timeout_ms / 1000.0)
        result = {
            "backend": "xdg-desktop-portal",
            "desktop": desktop_summary(),
            "stream": portal.stream_metadata(),
            "foreground_only": True,
        }
        if include_image:
            png = portal.capture_png(params.get("crop"), timeout_ms / 1000.0)
            result["image"] = {
                "mime_type": "image/png",
                "data_base64": base64.b64encode(png["bytes"]).decode("ascii"),
                "width": png["width"],
                "height": png["height"],
                "cropped": png["cropped"],
            }
        return result

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
            "desktop_one": data.get("desktop_one"),
            "detail": detail,
            "matched_count": len(filtered),
            "limit": limit,
            "truncated": len(filtered) > limit,
            "windows": [public_window(window, detail) for window in visible],
            "active_window_id": data.get("active_window_id"),
        }

    def list_desktops(self, params):
        data = run_kwin_script("list_desktops", {})
        return {
            "backend": "kwin-scripting",
            "desktop": desktop_summary(),
            "virtual_desktops": data.get("virtual_desktops", []),
            "current_virtual_desktop": data.get("current_virtual_desktop"),
            "desktop_one": data.get("desktop_one"),
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

    def open_app(self, params):
        desktop_id = params.get("desktop_id")
        query = params.get("query")
        if not desktop_id and not query:
            raise ValueError("computer_open_app requires query or desktop_id")

        entries = find_desktop_entries()
        entry = select_desktop_entry(entries, desktop_id, query)
        if entry is None:
            return {
                "launched": False,
                "error": f"no matching desktop entry for {desktop_id or query!r}",
                "candidates": entries[:20],
            }

        command = expand_exec(entry.get("exec", ""), params.get("args") or [])
        if not command:
            raise ValueError(f"desktop entry has no executable Exec line: {entry.get('path')}")

        app_match = entry.get("startup_wm_class") or entry.get("name")
        if params.get("reuse_existing", False):
            windows = self.list_windows({"app": app_match}).get("windows", [])
            target_window = select_existing_window(windows)
            if target_window:
                activated = None
                if params.get("activate", True):
                    activated = self.activate_window({"window_id": target_window.get("id"), "wait_ms": 300}).get("window")
                return {
                    "launched": False,
                    "reused_existing": True,
                    "entry": entry,
                    "windows": windows,
                    "target_window": target_window,
                    "activated": activated,
                }
            if params.get("activate", True):
                tray_result = self.activate_tray_item({"query": entry.get("name") or desktop_id or query, "wait_ms": 500})
                if tray_result.get("activated"):
                    return {
                        "launched": False,
                        "reused_existing": True,
                        "reuse_source": "tray",
                        "entry": entry,
                        "windows": windows,
                        "target_window": None,
                        "activated": tray_result.get("window"),
                        "tray_item": tray_result.get("item"),
                    }

        before_window_ids = {window.get("id") for window in self.list_windows({}).get("windows", []) if window.get("id")}
        process = subprocess.Popen(
            command,
            cwd=os.path.expanduser("~"),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        wait_ms = int(params.get("wait_ms", 1000))
        if wait_ms > 0:
            time.sleep(wait_ms / 1000.0)

        windows = self.list_windows({"app": app_match}).get("windows", [])
        target_window = select_launch_window(windows, before_window_ids, process.pid)
        activated = None
        if params.get("activate", True) and target_window:
            activated = self.activate_window({"window_id": target_window.get("id"), "wait_ms": 300}).get("window")

        return {
            "launched": True,
            "reused_existing": False,
            "pid": process.pid,
            "entry": entry,
            "command": command,
            "windows": windows,
            "target_window": target_window,
            "activated": activated,
        }

    def activate_tray_item(self, params):
        self.ensure_round(params)
        data = read_status_notifier_items()
        item = select_tray_item(data["items"], params)
        if item is None:
            return {
                "activated": False,
                "error": "no matching KDE StatusNotifierItem",
                "candidates": data["items"][:20],
                "errors": data["errors"],
            }

        action = str(params.get("action") or "activate").strip().lower()
        x = int(params.get("x", 0))
        y = int(params.get("y", 0))
        before = self.list_windows({})
        call_status_notifier_item_action(item, action, x, y)
        wait_ms = int(params.get("wait_ms", 500))
        if wait_ms > 0:
            time.sleep(wait_ms / 1000.0)

        moved_window = None
        after = self.list_windows({})
        active_window_id = after.get("active_window_id")
        if action != "context_menu" and active_window_id and active_window_id != before.get("active_window_id"):
            data = run_kwin_script("prepare_active_for_operation", {})
            self.remember_desktop_snapshot(data)
            moved_window = data.get("window")

        return {
            "backend": "kde-status-notifier",
            "activated": True,
            "action": action,
            "item": item,
            "active_window_id": active_window_id,
            "window": moved_window,
            "restore_pending": moved_window is not None,
        }

    def activate_window(self, params):
        self.ensure_round(params)
        data = run_kwin_script("activate", params)
        self.remember_desktop_snapshot(data)
        wait_ms = int(params.get("wait_ms", 300))
        if wait_ms > 0:
            time.sleep(wait_ms / 1000.0)
        return {
            "backend": "kwin-scripting",
            "activated": True,
            "window": data.get("window"),
            "desktop_snapshot": data.get("desktop_snapshot"),
            "restore_pending": data.get("desktop_snapshot") is not None,
        }

    def click(self, params):
        self.with_active_window_on_desktop_one()
        return self.click_foreground(params)

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
            self.glow_pulse(x, y, button)
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
            "round_id": self.round_id,
            "glow_active": self.glow_active,
            **animation,
        }

    def drag(self, params):
        self.with_active_window_on_desktop_one()
        return self.drag_foreground(params)

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

    def scroll(self, params):
        self.with_active_window_on_desktop_one()
        return self.scroll_foreground(params)

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
        self.ensure_round(params)
        start = self.pointer_position or current_pointer_position()
        if start is None:
            portal.pointer_move(x, y)
            self.glow_move(x, y)
            self.pointer_position = (x, y)
            return {"animated": False, "animation_steps": 1, "animation_ms": 0}

        start_x, start_y = start
        duration_ms, steps = pointer_animation_params(params, start_x, start_y, x, y)
        if duration_ms <= 0 or steps <= 1:
            portal.pointer_move(x, y)
            self.glow_move(x, y)
            self.pointer_position = (x, y)
            return {"animated": False, "animation_steps": 1, "animation_ms": 0}

        delay = duration_ms / 1000.0 / steps
        for step in range(1, steps + 1):
            t = smoothstep(step / steps)
            next_x = start_x + (x - start_x) * t
            next_y = start_y + (y - start_y) * t
            portal.pointer_move(next_x, next_y)
            self.glow_move(next_x, next_y)
            if step < steps and delay > 0:
                time.sleep(delay)
        self.pointer_position = (x, y)
        return {"animated": True, "animation_steps": steps, "animation_ms": duration_ms}

    def key(self, params):
        self.with_active_window_on_desktop_one()
        return self.key_foreground(params)

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

    def type_text(self, params):
        self.with_active_window_on_desktop_one()
        return self.type_text_foreground(params)

    def type_text_foreground(self, params):
        text = params["text"]
        method = params.get("method", "auto")
        ensure_portal_input(params)
        portal = self.ensure_portal()
        portal.ensure_remote(180.0)
        used = None
        clipboard_modified = False
        if method in ("auto", "clipboard") and (method == "clipboard" or should_use_clipboard(text)):
            if try_wl_copy(text):
                portal.key_combo("v", ["ctrl"])
                used = "clipboard"
                clipboard_modified = True
            elif method == "clipboard":
                raise RuntimeError("wl-copy failed or is not available")
        if used is None:
            for char in text:
                portal.key_char(char)
            used = "keysyms"
        if params.get("submit", False):
            portal.key_combo("enter", [])
        return {
            "typed": True,
            "backend": "xdg-desktop-portal",
            "method": used,
            "characters": len(text),
            "clipboard_modified": clipboard_modified,
            "submitted": bool(params.get("submit", False)),
        }

    def wait(self, params):
        ms = int(params.get("ms", 1000))
        if ms > 0:
            time.sleep(ms / 1000.0)
        if params.get("observe", False):
            observe_params = {"include_image": True, "include_windows": True}
            for key in ("backend", "allow_portal_fallback"):
                if key in params:
                    observe_params[key] = params[key]
            return {"waited_ms": ms, "observation": self.observe(observe_params)}
        return {"waited_ms": ms}

    def accessibility_tree(self, params):
        return read_accessibility_tree(params)

    def begin_round(self, params):
        if not self.round_active:
            self.round_id = "round-" + uuid.uuid4().hex
            self.round_active = True
        glow_requested = bool(params.get("glow", True))
        glow_active = False
        glow_error = None
        if glow_requested:
            try:
                self.glow.start()
                glow_active = bool(getattr(self.glow, "active", True))
                self.glow_active = glow_active
            except Exception as error:
                glow_error = str(error)
                self.glow_active = False
        return {
            "round_id": self.round_id,
            "round_active": self.round_active,
            "glow_active": glow_active,
            "glow_error": glow_error,
            "restore_pending": bool(self.desktop_snapshots),
        }

    def ensure_round(self, params=None):
        params = params or {}
        if not self.round_active:
            self.begin_round({"glow": params.get("glow", True)})
        return self.round_id

    def end_round(self, params):
        restore_result = self._restore_desktops()
        self.stop_glow()
        ended_round_id = self.round_id
        self.round_id = None
        self.round_active = False
        self.glow_active = False
        return {
            "round_id": ended_round_id,
            "round_active": False,
            "glow_active": False,
            **restore_result,
        }

    def glow_move(self, x, y):
        if self.round_active:
            self.glow.move(x, y)

    def glow_pulse(self, x, y, button):
        if self.round_active:
            self.glow.pulse(x, y, button)

    def stop_glow(self):
        try:
            self.glow.stop()
        except Exception:
            pass
        self.glow_active = False

    def remember_desktop_snapshot(self, data):
        snapshot = data.get("desktop_snapshot")
        if snapshot and snapshot.get("id"):
            self.desktop_snapshots.setdefault(snapshot["id"], snapshot)

    def with_active_window_on_desktop_one(self):
        self.ensure_round({})
        data = run_kwin_script("prepare_active_for_operation", {})
        self.remember_desktop_snapshot(data)
        return data.get("window")

    def restore_desktop_snapshot(self, snapshot):
        if snapshot and snapshot.get("id"):
            run_kwin_script("restore_window_desktops", {"snapshot": snapshot})

    def _restore_desktops(self):
        snapshots = list(self.desktop_snapshots.values())
        self.desktop_snapshots.clear()
        restored = []
        missing = []
        errors = []
        for snapshot in snapshots:
            try:
                data = run_kwin_script("restore_window_desktops", {"snapshot": snapshot})
                if data.get("missing"):
                    missing.append({"id": snapshot.get("id"), "caption": snapshot.get("caption")})
                elif data.get("restored"):
                    restored.append(data.get("window") or {"id": snapshot.get("id"), "caption": snapshot.get("caption")})
            except Exception as error:
                errors.append({"id": snapshot.get("id"), "caption": snapshot.get("caption"), "error": str(error)})
        if errors:
            raise RuntimeError(f"desktop restore failed: {errors}")
        return {"restored": restored, "missing": missing, "count": len(restored), "missing_count": len(missing)}

    def release_desktops(self, params):
        restore_result = self._restore_desktops()
        self.stop_glow()
        self.round_id = None
        self.round_active = False
        self.glow_active = False
        return restore_result

    def stop(self):
        if self.desktop_snapshots or self.round_active:
            self.end_round({})


class GlowOverlay:
    def __init__(self, script_path=None):
        self.script_path = Path(script_path or GLOW_OVERLAY_SCRIPT)
        self.process = None
        self.active = False
        self.disabled = os.environ.get("CODEX_COMPUTER_USE_CURSOR_GLOW", "1").strip().lower() in ("0", "false", "no")

    def start(self):
        if self.disabled:
            self.active = False
            return
        if self.process is not None and self.process.poll() is None:
            self.active = True
            return
        if not self.script_path.exists():
            self.active = False
            return
        env = os.environ.copy()
        env.setdefault("QT_QPA_PLATFORM", "xcb")
        self.process = subprocess.Popen(
            [sys.executable, str(self.script_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
            text=True,
            start_new_session=True,
        )
        self.active = self.process.poll() is None

    def send(self, payload):
        if not self.active or self.process is None or self.process.poll() is not None or self.process.stdin is None:
            self.active = False
            return
        try:
            self.process.stdin.write(json.dumps(payload, separators=(",", ":")) + "\n")
            self.process.stdin.flush()
        except (BrokenPipeError, OSError):
            self.active = False

    def move(self, x, y):
        self.send({"action": "move", "x": float(x), "y": float(y)})

    def pulse(self, x, y, button):
        self.send({"action": "pulse", "x": float(x), "y": float(y), "button": button})

    def stop(self):
        if self.process is None:
            self.active = False
            return
        self.send({"action": "stop"})
        try:
            if self.process.stdin is not None:
                self.process.stdin.close()
        except OSError:
            pass
        try:
            self.process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            self.process.terminate()
        self.process = None
        self.active = False


def capture_kwin_screenshot_png(crop, timeout_seconds):
    import dbus
    from PIL import Image

    bus = session_bus()
    obj = bus.get_object("org.kde.KWin", "/org/kde/KWin/ScreenShot2")
    iface = dbus.Interface(obj, "org.kde.KWin.ScreenShot2")
    read_fd, write_fd = os.pipe()
    chunks = []
    reader_error = []

    def reader():
        try:
            while True:
                chunk = os.read(read_fd, 1024 * 1024)
                if not chunk:
                    break
                chunks.append(chunk)
        except Exception as error:
            reader_error.append(error)

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    try:
        options = dbus.Dictionary(
            {
                "include-cursor": dbus.Boolean(True, variant_level=1),
                "native-resolution": dbus.Boolean(True, variant_level=1),
            },
            signature="sv",
        )
        if crop is None:
            results = iface.CaptureWorkspace(options, dbus.types.UnixFd(write_fd), signature="a{sv}h", timeout=max(int(timeout_seconds), 5))
        else:
            left = int(round(float(crop["x"])))
            top = int(round(float(crop["y"])))
            width = int(round(float(crop["width"])))
            height = int(round(float(crop["height"])))
            results = iface.CaptureArea(
                left,
                top,
                dbus.UInt32(width),
                dbus.UInt32(height),
                options,
                dbus.types.UnixFd(write_fd),
                signature="iiuua{sv}h",
                timeout=max(int(timeout_seconds), 5),
            )
    finally:
        try:
            os.close(write_fd)
        except OSError:
            pass

    thread.join(timeout_seconds)
    try:
        os.close(read_fd)
    except OSError:
        pass
    if thread.is_alive():
        raise TimeoutError("timed out reading KWin ScreenShot2 pipe")
    if reader_error:
        raise reader_error[0]

    metadata = native(results)
    if metadata.get("type") != "raw":
        raise RuntimeError(f"unsupported KWin screenshot type: {metadata.get('type')}")
    width = int(metadata["width"])
    height = int(metadata["height"])
    stride = int(metadata["stride"])
    image_format = int(metadata["format"])
    raw = b"".join(chunks)
    expected = stride * height
    if len(raw) < expected:
        raise RuntimeError(f"KWin screenshot pipe returned {len(raw)} bytes, expected at least {expected}")
    image = qimage_raw_to_pillow(raw[:expected], width, height, stride, image_format)
    out = io.BytesIO()
    image.save(out, format="PNG")
    return {
        "bytes": out.getvalue(),
        "width": width,
        "height": height,
        "cropped": crop is not None,
        "scale": metadata.get("scale"),
        "format": image_format,
    }


def qimage_raw_to_pillow(raw, width, height, stride, image_format):
    from PIL import Image

    # Common KWin/Spectacle formats on little-endian systems:
    # QImage::Format_RGB32=4, ARGB32=5, ARGB32_Premultiplied=6 are stored as BGRA.
    if image_format in (4, 5, 6):
        return Image.frombytes("RGBA", (width, height), raw, "raw", "BGRA", stride, 1)
    # QImage::Format_RGBX8888=16, RGBA8888=17, RGBA8888_Premultiplied=18.
    if image_format in (16, 17, 18):
        return Image.frombytes("RGBA", (width, height), raw, "raw", "RGBA", stride, 1)
    raise RuntimeError(f"unsupported QImage format from KWin screenshot: {image_format}")


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
                    "multiple": self.boolean(False),
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
        self.remote.NotifyPointerMotionAbsolute(
            self.remote_session_handle,
            self.vardict({}),
            self.uint32(self.remote_stream_id),
            self.double(x),
            self.double(y),
            timeout=5,
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


def should_use_clipboard(text):
    return any(ord(char) > 0x7F for char in text) or len(text) > 80


def try_wl_copy(text):
    try:
        subprocess.run(
            ["wl-copy"],
            input=text,
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=5,
        )
        return True
    except Exception:
        return False


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
  function geometryOf(window) {{
    const g = prop(window, "frameGeometry", null);
    if (g) {{
      return {{
        x: number(g.x, 0),
        y: number(g.y, 0),
        width: number(g.width, 0),
        height: number(g.height, 0)
      }};
    }}
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
  function desktopOne() {{
    const list = prop(workspace, "desktops", []);
    if (!list || list.length < 1) throw new Error("KWin did not report virtual desktop 1");
    return list[0];
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
  function captureDesktopSnapshot(window, index) {{
    if (!window) return null;
    return {{
      id: windowId(window, index),
      caption: text(prop(window, "caption", "")),
      on_all_desktops: Boolean(prop(window, "onAllDesktops", false)),
      desktops: windowDesktops(window)
    }};
  }}
  function moveToDesktopOne(window) {{
    const target = desktopOne();
    if (Boolean(prop(window, "onAllDesktops", false))) window.onAllDesktops = false;
    window.desktops = [target];
    workspace.currentDesktop = target;
  }}
  function restoreDesktopSnapshot(window, snapshot) {{
    if (!window || !snapshot) return false;
    if (Boolean(prop(snapshot, "on_all_desktops", false))) {{
      window.onAllDesktops = true;
      return true;
    }}
    const snapshots = prop(snapshot, "desktops", []);
    const restored = [];
    for (let i = 0; i < snapshots.length; i++) {{
      if (prop(snapshots[i], "id", "") === "*") {{
        window.onAllDesktops = true;
        return true;
      }}
      const desktop = desktopBySnapshot(snapshots[i]);
      if (desktop) restored.push(desktop);
    }}
    if (restored.length < 1) throw new Error("Could not resolve previous virtual desktop for " + text(prop(snapshot, "caption", "")));
    window.onAllDesktops = false;
    window.desktops = restored;
    return true;
  }}
  function serialize(window, index) {{
    const geom = geometryOf(window);
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
      current_virtual_desktop: currentVirtualDesktop(),
      desktop_one: desktopInfo(desktopOne(), 0)
    }};
  }}
  function matches(window, index) {{
    if (args.window_id && windowId(window, index) !== String(args.window_id)) return false;
    if (args.index !== undefined && Number(args.index) !== index) return false;
    const joined = [
      text(prop(window, "caption", "")),
      text(prop(window, "resourceClass", "")),
      text(prop(window, "resourceName", "")),
      text(prop(window, "desktopFileName", ""))
    ].join(" ").toLowerCase();
    if (args.app && joined.indexOf(String(args.app).toLowerCase()) < 0) return false;
    if (args.title && text(prop(window, "caption", "")).toLowerCase().indexOf(String(args.title).toLowerCase()) < 0) return false;
    return true;
  }}

  try {{
    if (action === "list_desktops") {{
      send({{
        ok: true,
        virtual_desktops: workspaceDesktops(),
        current_virtual_desktop: currentVirtualDesktop(),
        desktop_one: desktopInfo(desktopOne(), 0)
      }});
      return;
    }}
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
    if (action === "prepare_active_for_operation") {{
      const window = prop(workspace, "activeWindow", null);
      if (window) {{
        const list = windows();
        let activeIndex = -1;
        for (let i = 0; i < list.length; i++) if (list[i] === window) activeIndex = i;
        const snapshot = captureDesktopSnapshot(window, activeIndex);
        moveToDesktopOne(window);
        send({{ ok: true, window: serialize(window, activeIndex), desktop_snapshot: snapshot, desktop_one: desktopInfo(desktopOne(), 0) }});
        return;
      }}
      send({{ ok: true, window: null, desktop_snapshot: null, desktop_one: desktopInfo(desktopOne(), 0) }});
      return;
    }}
    if (action === "restore_window_desktops") {{
      const snapshot = args.snapshot || null;
      if (!snapshot || !snapshot.id) {{
        send({{ ok: true, restored: false, missing: false }});
        return;
      }}
      const list = windows();
      for (let i = 0; i < list.length; i++) {{
        const window = list[i];
        if (windowId(window, i) !== String(snapshot.id)) continue;
        const restored = restoreDesktopSnapshot(window, snapshot);
        send({{ ok: true, restored, window: serialize(window, i) }});
        return;
      }}
      send({{ ok: true, restored: false, missing: true, snapshot }});
      return;
    }}
    if (action === "activate") {{
      const list = windows();
      for (let i = 0; i < list.length; i++) {{
        const window = list[i];
        if (!matches(window, i)) continue;
        const snapshot = captureDesktopSnapshot(window, i);
        moveToDesktopOne(window);
        if (prop(window, "minimized", false)) window.minimized = false;
        workspace.activeWindow = window;
        if (typeof window.raise === "function") window.raise();
        send({{ ok: true, window: serialize(window, i), desktop_snapshot: snapshot }});
        return;
      }}
      send({{ ok: false, error: "no KWin window matched activation request" }});
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


def select_launch_window(windows, before_window_ids, process_pid):
    for window in windows:
        window_id = window.get("id")
        if window_id and window_id not in before_window_ids:
            return window
    for window in windows:
        try:
            if int(window.get("pid", 0)) == int(process_pid):
                return window
        except (TypeError, ValueError):
            continue
    return windows[0] if windows else None


def select_existing_window(windows):
    for window in windows:
        if window.get("active"):
            return window
    for window in windows:
        if not window.get("minimized"):
            return window
    return windows[0] if windows else None


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


def read_accessibility_tree(params):
    import pyatspi

    max_depth = int(params.get("max_depth", 5))
    max_nodes = int(params.get("max_nodes", 200))
    app_filter = params.get("app")
    title_filter = params.get("title")
    desktop = pyatspi.Registry.getDesktop(0)
    roots = []
    for index in range(desktop.childCount):
        try:
            app = desktop.getChildAtIndex(index)
            app_name = safe_attr(app, "name")
            if app_filter and not lower_contains(app_name, app_filter):
                continue
            roots.append(app)
        except Exception:
            continue
    nodes = []
    for root in roots:
        walk_accessible(root, nodes, 0, max_depth, max_nodes, title_filter)
        if len(nodes) >= max_nodes:
            break
    return {
        "backend": "at-spi",
        "nodes": nodes,
        "truncated": len(nodes) >= max_nodes,
    }


def walk_accessible(accessible, nodes, depth, max_depth, max_nodes, title_filter):
    if len(nodes) >= max_nodes or depth > max_depth:
        return
    name = safe_attr(accessible, "name")
    role = safe_call(accessible, "getRoleName") or ""
    if title_filter and depth <= 1 and not lower_contains(name, title_filter):
        pass
    node = {
        "depth": depth,
        "name": name,
        "role": role,
        "description": safe_attr(accessible, "description"),
        "states": accessible_states(accessible),
        "bounds": accessible_bounds(accessible),
    }
    text = accessible_text(accessible)
    if text:
        node["text"] = text
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
            walk_accessible(child, nodes, depth + 1, max_depth, max_nodes, None)
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
        state = accessible.getState()
        names = []
        for attr in dir(state):
            if not attr.startswith("contains"):
                continue
        return [str(item) for item in state.getStates()]
    except Exception:
        return []


def accessible_bounds(accessible):
    try:
        component = accessible.queryComponent()
        x, y, width, height = component.getExtents(0)
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


def main():
    broker = Broker()
    try:
        for line in sys.stdin:
            if not line.strip():
                continue
            request = json.loads(line)
            request_id = request.get("id")
            try:
                result = broker.handle(request.get("method"), request.get("params") or {})
                print(json.dumps({"id": request_id, "ok": True, "result": result}, ensure_ascii=False), flush=True)
            except Exception as error:
                traceback.print_exc(file=sys.stderr)
                print(json.dumps({"id": request_id, "ok": False, "error": str(error)}, ensure_ascii=False), flush=True)
    finally:
        try:
            broker.stop()
        except Exception as error:
            traceback.print_exc(file=sys.stderr)


if __name__ == "__main__":
    main()
