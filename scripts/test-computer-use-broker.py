#!/usr/bin/env python3
import base64
import importlib.util
import json
import os
import sys
import tempfile
import threading
import time
import types
import shlex
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BROKER_PATH = ROOT / "plugins" / "computer-use" / "scripts" / "computer-use-broker.py"
ISOLATED_SESSION_PATH = ROOT / "plugins" / "computer-use" / "scripts" / "computer-use-isolated-session.py"


def load_broker_module():
    spec = importlib.util.spec_from_file_location("computer_use_broker", BROKER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_isolated_session_module():
    spec = importlib.util.spec_from_file_location("computer_use_isolated_session", ISOLATED_SESSION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeAccessible:
    def __init__(self, name, role, description="", children=None, text="", bounds=None, window_bounds=None, pid=0):
        self.name = name
        self._role = role
        self.description = description
        self._children = children or []
        self._text = text
        self._bounds = bounds
        self._window_bounds = bounds if window_bounds is None else window_bounds
        self._pid = pid

    @property
    def childCount(self):
        return len(self._children)

    def getChildAtIndex(self, index):
        return self._children[index]

    def getRoleName(self):
        return self._role

    def get_process_id(self):
        return self._pid

    def getState(self):
        return types.SimpleNamespace(getStates=lambda: [])

    def queryComponent(self):
        if self._bounds is None:
            raise RuntimeError("no component")
        return types.SimpleNamespace(
            getExtents=lambda coordinate_type: self._bounds if coordinate_type == 0 else self._window_bounds
        )

    def queryText(self):
        if not self._text:
            raise RuntimeError("no text")
        return types.SimpleNamespace(
            characterCount=len(self._text),
            getText=lambda start, end: self._text[start:end],
        )

    def queryAction(self):
        raise RuntimeError("no actions")


def install_fake_pyatspi(apps):
    desktop = FakeAccessible("desktop", "desktop", children=apps)
    fake_pyatspi = types.ModuleType("pyatspi")
    fake_pyatspi.Registry = types.SimpleNamespace(getDesktop=lambda index: desktop)
    old_pyatspi = sys.modules.get("pyatspi")
    sys.modules["pyatspi"] = fake_pyatspi
    return old_pyatspi


def restore_fake_pyatspi(old_pyatspi):
    if old_pyatspi is None:
        sys.modules.pop("pyatspi", None)
    else:
        sys.modules["pyatspi"] = old_pyatspi


def test_deduplicate_desktop_entries_keeps_first_xdg_priority_entry():
    module = load_broker_module()
    user_entry = {"desktop_id": "qq.desktop", "path": "/home/me/.local/share/applications/qq.desktop", "name": "QQ user"}
    system_entry = {"desktop_id": "qq.desktop", "path": "/usr/share/applications/qq.desktop", "name": "QQ system"}
    music_entry = {"desktop_id": "com.qq.QQmusic.desktop", "path": "/usr/share/applications/com.qq.QQmusic.desktop", "name": "QQ Music"}

    assert module.deduplicate_desktop_entries([user_entry, system_entry, music_entry]) == [user_entry, music_entry]


def test_desktop_entry_selection_prefers_named_app_over_chrome_web_app_prefix():
    module = load_broker_module()
    chrome_web_app = {
        "desktop_id": "chrome-lodlkdfmihgonocnmddehnfgiljnadcf-Profile_5.desktop",
        "path": "/home/me/.local/share/applications/chrome-lodlkdfmihgonocnmddehnfgiljnadcf-Profile_5.desktop",
        "name": "X",
        "generic_name": "",
        "startup_wm_class": "crx_lodlkdfmihgonocnmddehnfgiljnadcf",
        "exec": '/opt/google/chrome/google-chrome "--profile-directory=Profile 5" --app-id=lodlkdfmihgonocnmddehnfgiljnadcf',
        "hidden": False,
    }
    google_chrome = {
        "desktop_id": "google-chrome.desktop",
        "path": "/home/me/.local/share/applications/google-chrome.desktop",
        "name": "Google Chrome",
        "generic_name": "Web Browser",
        "startup_wm_class": "",
        "exec": "/home/me/.local/bin/google-chrome-v1 %U",
        "hidden": False,
    }

    assert module.select_desktop_entry([chrome_web_app, google_chrome], None, "chrome") == google_chrome


def test_open_app_can_reuse_and_activate_existing_matching_window():
    module = load_broker_module()
    broker = module.Broker()
    entry = {
        "desktop_id": "google-chrome.desktop",
        "path": "/usr/share/applications/google-chrome.desktop",
        "name": "Google Chrome",
        "generic_name": "Web Browser",
        "startup_wm_class": "google-chrome",
        "exec": "/usr/bin/google-chrome %U",
        "hidden": False,
    }
    existing_window = {
        "id": "chrome-window",
        "title": "ChatGPT - Google Chrome",
        "app": "google-chrome",
        "pid": 100,
        "active": False,
        "minimized": True,
    }

    module.find_desktop_entries = lambda: [entry]

    def fake_popen(*args, **kwargs):
        raise AssertionError("reuse_existing should not launch a new process")

    old_popen = module.subprocess.Popen
    module.subprocess.Popen = fake_popen

    def fake_list_windows(params):
        assert params["app"] in ("google-chrome", "google-chrome.desktop", "Google Chrome")
        if params["app"] == "google-chrome":
            return {"windows": [existing_window]}
        return {"windows": []}

    activated_calls = []

    def fake_activate_window(params):
        activated_calls.append(params)
        return {"window": {"id": params["window_id"], "active": True}}

    broker.list_windows = fake_list_windows
    broker.activate_window = fake_activate_window

    try:
        result = broker.open_app({"query": "chrome", "reuse_existing": True, "activate": True})
    finally:
        module.subprocess.Popen = old_popen

    assert result["launched"] is False
    assert result["reused_existing"] is True
    assert result["target_window"] == existing_window
    assert result["activated"] == {"id": "chrome-window", "active": True}
    assert activated_calls == [{"window_id": "chrome-window", "wait_ms": 300}]


def test_open_app_reuse_matches_exec_name_when_display_name_differs():
    module = load_broker_module()
    broker = module.Broker()
    entry = {
        "desktop_id": "remote-viewer.desktop",
        "path": "/usr/share/applications/remote-viewer.desktop",
        "name": "Remote Viewer",
        "generic_name": "",
        "startup_wm_class": "",
        "exec": "remote-viewer %u",
        "hidden": False,
    }
    existing_window = {
        "id": "remote-viewer-window",
        "title": "Windows 11 VM Installer",
        "app": "remote-viewer",
        "pid": 200,
        "active": False,
        "minimized": False,
    }

    module.find_desktop_entries = lambda: [entry]

    def fake_popen(*args, **kwargs):
        raise AssertionError("reuse_existing should match the Exec basename before launching")

    old_popen = module.subprocess.Popen
    module.subprocess.Popen = fake_popen

    def fake_list_windows(params):
        assert params["app"] in ("remote-viewer", "remote-viewer.desktop", "Remote Viewer")
        if params["app"] == "remote-viewer":
            return {"windows": [existing_window]}
        return {"windows": []}

    broker.list_windows = fake_list_windows
    broker.activate_window = lambda params: {"window": {"id": params["window_id"], "active": True}}

    try:
        result = broker.open_app({"query": "remote-viewer", "reuse_existing": True, "activate": True})
    finally:
        module.subprocess.Popen = old_popen

    assert result["launched"] is False
    assert result["reused_existing"] is True
    assert result["target_window"] == existing_window
    assert result["activated"] == {"id": "remote-viewer-window", "active": True}


def test_open_app_can_reuse_tray_item_when_no_window_exists():
    module = load_broker_module()
    broker = module.Broker()
    entry = {
        "desktop_id": "wechat.desktop",
        "path": "/usr/share/applications/wechat.desktop",
        "name": "wechat",
        "generic_name": "",
        "startup_wm_class": "",
        "exec": "/usr/bin/wechat %U",
        "hidden": False,
    }

    module.find_desktop_entries = lambda: [entry]

    def fake_popen(*args, **kwargs):
        raise AssertionError("reuse_existing tray activation should not launch a new process")

    old_popen = module.subprocess.Popen
    module.subprocess.Popen = fake_popen
    broker.list_windows = lambda params: {"windows": []}
    tray_calls = []

    def fake_activate_tray_item(params):
        tray_calls.append(params)
        return {"activated": True, "item": {"id": "wechat"}, "window": {"id": "wechat-window"}}

    broker.activate_tray_item = fake_activate_tray_item

    try:
        result = broker.open_app({"query": "wechat", "reuse_existing": True, "activate": True})
    finally:
        module.subprocess.Popen = old_popen

    assert result["launched"] is False
    assert result["reused_existing"] is True
    assert result["reuse_source"] == "tray"
    assert result["target_window"] is None
    assert result["activated"] == {"id": "wechat-window"}
    assert tray_calls == [{"query": "wechat", "wait_ms": 500}]


def test_list_windows_defaults_to_token_lean_summary_with_limit():
    module = load_broker_module()
    broker = module.Broker()
    windows = [
        {
            "id": "chrome",
            "index": 0,
            "caption": "ChatGPT - Google Chrome",
            "resourceClass": "google-chrome",
            "resourceName": "chrome",
            "desktopFileName": "google-chrome",
            "pid": 100,
            "x": 10,
            "y": 20,
            "width": 800,
            "height": 600,
            "active": True,
            "minimized": False,
            "specialWindow": False,
            "dock": False,
            "desktopWindow": False,
            "skipTaskbar": False,
            "fullScreen": False,
            "keepAbove": False,
            "output": "eDP-1",
            "desktops": [{"id": "desk-1", "name": "Desktop 1", "index": 0, "number": 1}],
        },
        {
            "id": "codex",
            "index": 1,
            "caption": "Codex",
            "resourceClass": "codex",
            "resourceName": "Codex",
            "desktopFileName": "codex",
            "pid": 200,
            "active": False,
            "minimized": False,
            "specialWindow": False,
            "dock": False,
            "desktopWindow": False,
            "desktops": [],
        },
    ]

    def fake_run_kwin_script(action, args):
        assert action == "list"
        return {
            "windows": windows,
            "virtual_desktops": [],
            "current_virtual_desktop": None,
            "desktop_one": None,
            "active_window_id": "chrome",
        }

    module.run_kwin_script = fake_run_kwin_script

    result = broker.list_windows({"limit": 1})

    assert result["matched_count"] == 2
    assert result["truncated"] is True
    assert result["windows"] == [
        {
            "id": "chrome",
            "index": 0,
            "title": "ChatGPT - Google Chrome",
            "app": "google-chrome",
            "resource_name": "chrome",
            "desktop_file": "google-chrome",
            "pid": 100,
            "active": True,
            "minimized": False,
            "geometry": {"x": 10, "y": 20, "width": 800, "height": 600},
            "desktops": [{"id": "desk-1", "name": "Desktop 1", "index": 0, "number": 1}],
        }
    ]
    assert "resourceClass" not in result["windows"][0]


def test_list_windows_full_detail_preserves_raw_kwin_fields():
    module = load_broker_module()
    broker = module.Broker()
    window = {
        "id": "chrome",
        "index": 0,
        "caption": "ChatGPT - Google Chrome",
        "resourceClass": "google-chrome",
        "resourceName": "chrome",
        "desktopFileName": "google-chrome",
        "active": True,
        "minimized": False,
        "specialWindow": False,
        "dock": False,
        "desktopWindow": False,
    }

    def fake_run_kwin_script(action, args):
        assert action == "list"
        return {"windows": [window], "active_window_id": "chrome"}

    module.run_kwin_script = fake_run_kwin_script

    result = broker.list_windows({"detail": "full"})

    assert result["windows"] == [window]


def test_accessibility_tree_uses_window_id_to_scope_at_spi_tree():
    module = load_broker_module()
    broker = module.Broker()
    windows = [
        {
            "id": "dolphin-window",
            "index": 0,
            "caption": "Home — Dolphin",
            "resourceClass": "dolphin",
            "resourceName": "dolphin",
            "desktopFileName": "org.kde.dolphin",
            "pid": 100,
            "active": True,
            "minimized": False,
        },
        {
            "id": "systemsettings-window",
            "index": 1,
            "caption": "窗口装饰 — 系统设置",
            "resourceClass": "systemsettings",
            "resourceName": "systemsettings",
            "desktopFileName": "systemsettings",
            "pid": 200,
            "active": False,
            "minimized": False,
            "x": 10,
            "y": 20,
            "width": 800,
            "height": 600,
        },
    ]

    def fake_run_kwin_script(action, args):
        assert action == "list"
        return {"windows": windows, "active_window_id": "dolphin-window"}

    module.run_kwin_script = fake_run_kwin_script
    apps = [
        FakeAccessible(
            "",
            "application",
            "",
            [FakeAccessible("窗口装饰 — wrong app", "frame", children=[FakeAccessible("wrong", "label", text="wrong")])],
            pid=999,
        ),
        FakeAccessible(
            "dolphin",
            "application",
            "/usr/bin/dolphin",
            [FakeAccessible("Home — Dolphin", "frame", children=[FakeAccessible("Places", "label", text="Places")])],
            pid=100,
        ),
        FakeAccessible(
            "systemsettings",
            "application",
            "/usr/bin/systemsettings",
            [
                FakeAccessible(
                    "窗口装饰  — 系统设置",
                    "frame",
                    children=[FakeAccessible("边框宽度", "label", text="边框宽度")],
                ),
                FakeAccessible(
                    "文本和字体 — 系统设置",
                    "frame",
                    children=[FakeAccessible("窗口标题", "label", text="窗口标题")],
                ),
            ],
            pid=200,
        ),
    ]
    old_pyatspi = install_fake_pyatspi(apps)
    try:
        result = broker.accessibility_tree(
            {"window_id": "systemsettings-window", "max_depth": 4, "max_nodes": 50}
        )
    finally:
        restore_fake_pyatspi(old_pyatspi)

    names = [node["name"] for node in result["nodes"]]
    assert result["target_window"]["id"] == "systemsettings-window"
    assert names[0] == "窗口装饰  — 系统设置"
    assert "边框宽度" in names
    assert "dolphin" not in names
    assert "Home — Dolphin" not in names
    assert "窗口装饰 — wrong app" not in names
    assert "wrong" not in names
    assert "文本和字体 — 系统设置" not in names
    assert "窗口标题" not in names


def test_accessibility_tree_title_selects_matching_kwin_window_and_frame():
    module = load_broker_module()
    broker = module.Broker()
    windows = [
        {
            "id": "decorations",
            "index": 0,
            "caption": "窗口装饰 — 系统设置",
            "resourceClass": "systemsettings",
            "resourceName": "systemsettings",
            "desktopFileName": "systemsettings",
            "pid": 200,
            "active": True,
            "minimized": False,
        },
        {
            "id": "fonts",
            "index": 1,
            "caption": "文本和字体 — 系统设置",
            "resourceClass": "systemsettings",
            "resourceName": "systemsettings",
            "desktopFileName": "systemsettings",
            "pid": 200,
            "active": False,
            "minimized": False,
        },
    ]

    def fake_run_kwin_script(action, args):
        assert action == "list"
        return {"windows": windows, "active_window_id": "decorations"}

    module.run_kwin_script = fake_run_kwin_script
    apps = [
        FakeAccessible(
            "systemsettings",
            "application",
            "/usr/bin/systemsettings",
            [
                FakeAccessible(
                    "窗口装饰 — 系统设置",
                    "frame",
                    children=[FakeAccessible("边框宽度", "label", text="边框宽度")],
                ),
                FakeAccessible(
                    "文本和字体 — 系统设置",
                    "frame",
                    children=[FakeAccessible("窗口标题", "label", text="窗口标题")],
                ),
            ],
            pid=200,
        ),
    ]
    old_pyatspi = install_fake_pyatspi(apps)
    try:
        result = broker.accessibility_tree({"app": "systemsettings", "title": "文本和字体", "max_nodes": 50})
    finally:
        restore_fake_pyatspi(old_pyatspi)

    names = [node["name"] for node in result["nodes"]]
    assert result["target_window"]["id"] == "fonts"
    assert names[0] == "文本和字体 — 系统设置"
    assert "窗口标题" in names
    assert "窗口装饰 — 系统设置" not in names
    assert "边框宽度" not in names


def test_accessibility_tree_accepts_changed_title_for_unique_pid_window():
    module = load_broker_module()
    broker = module.Broker()
    window = {
        "id": "kwrite-window",
        "index": 0,
        "caption": "无标题 — KWrite",
        "resourceClass": "org.kde.kwrite",
        "resourceName": "kwrite",
        "desktopFileName": "org.kde.kwrite",
        "pid": 300,
        "active": True,
        "minimized": False,
    }

    def fake_run_kwin_script(action, args):
        assert action == "list"
        return {"windows": [window], "active_window_id": "kwrite-window"}

    module.run_kwin_script = fake_run_kwin_script
    apps = [
        FakeAccessible(
            "kwrite",
            "application",
            "/usr/bin/kwrite",
            [
                FakeAccessible(
                    "无标题 (修复验证：你好，AT-SPI！) * — KWrite",
                    "frame",
                    children=[FakeAccessible("editor", "text", text="修复验证：你好，AT-SPI！")],
                )
            ],
            pid=300,
        )
    ]
    old_pyatspi = install_fake_pyatspi(apps)
    try:
        result = broker.accessibility_tree({"window_id": "kwrite-window", "max_nodes": 50})
    finally:
        restore_fake_pyatspi(old_pyatspi)

    assert result["window_match"] == "unique-pid-window"
    assert result["matched_window_count"] == 1
    assert result["nodes"][0]["name"] == "无标题 (修复验证：你好，AT-SPI！) * — KWrite"
    assert result["nodes"][1]["text"] == "修复验证：你好，AT-SPI！"


def test_accessibility_tree_title_does_not_match_application_root_name():
    module = load_broker_module()
    broker = module.Broker()
    window = {
        "id": "home",
        "index": 0,
        "caption": "Home — Dolphin",
        "resourceClass": "dolphin",
        "resourceName": "dolphin",
        "desktopFileName": "org.kde.dolphin",
        "pid": 100,
        "active": True,
        "minimized": False,
    }

    def fake_run_kwin_script(action, args):
        assert action == "list"
        return {"windows": [window], "active_window_id": "home"}

    module.run_kwin_script = fake_run_kwin_script
    apps = [
        FakeAccessible(
            "dolphin",
            "application",
            "/usr/bin/dolphin",
            [
                FakeAccessible("Home — Dolphin", "frame", children=[FakeAccessible("Places", "label", text="Places")]),
                FakeAccessible(
                    "Old Home — Dolphin",
                    "frame",
                    children=[FakeAccessible("Old Places", "label", text="Old Places")],
                ),
                FakeAccessible(
                    "home — dolphin",
                    "frame",
                    children=[FakeAccessible("lowercase places", "label", text="lowercase places")],
                ),
                FakeAccessible(
                    "Downloads — Dolphin",
                    "frame",
                    children=[FakeAccessible("Downloads", "label", text="Downloads")],
                ),
            ],
            pid=100,
        )
    ]
    old_pyatspi = install_fake_pyatspi(apps)
    try:
        result = broker.accessibility_tree({"window_id": "home", "max_nodes": 50})
    finally:
        restore_fake_pyatspi(old_pyatspi)

    names = [node["name"] for node in result["nodes"]]
    assert names[0] == "Home — Dolphin"
    assert "Places" in names
    assert "dolphin" not in names
    assert "Old Home — Dolphin" not in names
    assert "Old Places" not in names
    assert "home — dolphin" not in names
    assert "lowercase places" not in names
    assert "Downloads — Dolphin" not in names
    assert "Downloads" not in names


def test_accessibility_tree_app_filter_uses_window_identity_not_title():
    module = load_broker_module()
    broker = module.Broker()
    windows = [
        {
            "id": "chrome",
            "index": 0,
            "caption": "Dolphin docs - Google Chrome",
            "resourceClass": "google-chrome",
            "resourceName": "chrome",
            "desktopFileName": "google-chrome",
            "pid": 300,
            "active": True,
            "minimized": False,
        },
        {
            "id": "dolphin",
            "index": 1,
            "caption": "Home — Dolphin",
            "resourceClass": "org.kde.dolphin",
            "resourceName": "dolphin",
            "desktopFileName": "org.kde.dolphin",
            "pid": 100,
            "active": False,
            "minimized": False,
        },
    ]

    def fake_run_kwin_script(action, args):
        assert action == "list"
        return {"windows": windows, "active_window_id": "chrome"}

    module.run_kwin_script = fake_run_kwin_script
    apps = [
        FakeAccessible(
            "chrome",
            "application",
            "/opt/google/chrome/chrome",
            [FakeAccessible("Dolphin docs - Google Chrome", "frame", children=[FakeAccessible("docs", "label")])],
            pid=300,
        ),
        FakeAccessible(
            "dolphin",
            "application",
            "/usr/bin/dolphin",
            [FakeAccessible("Home — Dolphin", "frame", children=[FakeAccessible("Places", "label", text="Places")])],
            pid=100,
        ),
    ]
    old_pyatspi = install_fake_pyatspi(apps)
    try:
        result = broker.accessibility_tree({"app": "dolphin", "max_nodes": 50})
    finally:
        restore_fake_pyatspi(old_pyatspi)

    names = [node["name"] for node in result["nodes"]]
    assert result["target_window"]["id"] == "dolphin"
    assert names[0] == "Home — Dolphin"
    assert "Places" in names
    assert "Dolphin docs - Google Chrome" not in names
    assert "docs" not in names


def test_key_combo_uses_portal_keycodes_for_modified_shortcuts():
    module = load_broker_module()

    assert module.key_combo_keycode_events("v", ["ctrl"]) == [
        (29, True),
        (47, True),
        (47, False),
        (29, False),
    ]
    assert module.key_combo_keycode_events("F4", ["alt"]) == [
        (56, True),
        (62, True),
        (62, False),
        (56, False),
    ]


def test_status_notifier_item_ref_parses_unique_and_well_known_names():
    module = load_broker_module()

    assert module.parse_status_notifier_item_ref(":1.234/StatusNotifierItem") == {
        "ref": ":1.234/StatusNotifierItem",
        "service": ":1.234",
        "path": "/StatusNotifierItem",
    }
    assert module.parse_status_notifier_item_ref("org.kde.StatusNotifierItem-84436-1/StatusNotifierItem") == {
        "ref": "org.kde.StatusNotifierItem-84436-1/StatusNotifierItem",
        "service": "org.kde.StatusNotifierItem-84436-1",
        "path": "/StatusNotifierItem",
    }


def test_session_bus_sets_glib_main_loop_before_creating_bus():
    module = load_broker_module()
    calls = []
    fake_dbus = types.ModuleType("dbus")
    fake_mainloop = types.ModuleType("dbus.mainloop")
    fake_glib = types.ModuleType("dbus.mainloop.glib")

    class FakeMainLoop:
        def __init__(self, set_as_default=False):
            calls.append(("mainloop", set_as_default))

    class FakeBus:
        def __init__(self):
            calls.append(("bus", None))

    fake_glib.DBusGMainLoop = FakeMainLoop
    fake_mainloop.glib = fake_glib
    fake_dbus.mainloop = fake_mainloop
    fake_dbus.SessionBus = FakeBus
    old_modules = {name: sys.modules.get(name) for name in ("dbus", "dbus.mainloop", "dbus.mainloop.glib")}
    sys.modules["dbus"] = fake_dbus
    sys.modules["dbus.mainloop"] = fake_mainloop
    sys.modules["dbus.mainloop.glib"] = fake_glib
    try:
        assert isinstance(module.session_bus(), FakeBus)
    finally:
        for name, old_module in old_modules.items():
            if old_module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = old_module

    assert calls == [("mainloop", True), ("bus", None)]


def test_select_tray_item_prefers_exact_query_match():
    module = load_broker_module()
    items = [
        {
            "ref": "org.example.App/StatusNotifierItem",
            "service": "org.example.App",
            "path": "/StatusNotifierItem",
            "id": "example",
            "title": "Example",
            "icon_name": "example",
        },
        {
            "ref": "org.qq.QQ/StatusNotifierItem",
            "service": "org.qq.QQ",
            "path": "/StatusNotifierItem",
            "id": "qq",
            "title": "QQ",
            "icon_name": "qq",
        },
    ]

    assert module.select_tray_item(items, {"query": "qq"}) == items[1]
    assert module.select_tray_item(items, {"service": "org.qq.QQ", "path": "/StatusNotifierItem"}) == items[1]
    assert module.select_tray_item(items, {"item_ref": "org.qq.QQ/StatusNotifierItem"}) == items[1]
    assert module.select_tray_item(items, {"query": "missing"}) is None


def test_select_tray_item_matches_owner_process_fields():
    module = load_broker_module()
    item = module.public_status_notifier_item(
        {"ref": ":1.156/StatusNotifierItem", "service": ":1.156", "path": "/StatusNotifierItem"},
        {"Id": "chrome_status_icon_1", "Title": "", "Status": "Active"},
        {"pid": 84435, "exe": "/opt/QQ/qq", "comm": "qq"},
    )

    assert item["owner_pid"] == 84435
    assert item["owner_exe"] == "/opt/QQ/qq"
    assert item["owner_comm"] == "qq"
    assert module.select_tray_item([item], {"query": "qq"}) == item


def test_wait_observe_passes_requested_screenshot_backend():
    module = load_broker_module()
    broker = module.Broker()
    observe_calls = []

    def fake_observe(params):
        observe_calls.append(params)
        return {"backend": params.get("backend")}

    broker.observe = fake_observe

    result = broker.wait({"ms": 0, "observe": True, "backend": "portal", "allow_portal_fallback": True})

    assert result == {"waited_ms": 0, "observation": {"backend": "portal"}}
    assert observe_calls == [
        {
            "include_image": True,
            "include_windows": True,
            "backend": "portal",
            "allow_portal_fallback": True,
        }
    ]


def test_capture_kwin_screenshot_uses_authorized_helper():
    module = load_broker_module()
    with tempfile.TemporaryDirectory() as temp_dir:
        helper = Path(temp_dir) / "codex-computer-use-screenshot"
        helper.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")
        helper.chmod(0o755)

        old_helper = os.environ.get("CODEX_COMPUTER_USE_SCREENSHOT_HELPER")
        os.environ["CODEX_COMPUTER_USE_SCREENSHOT_HELPER"] = str(helper)
        old_run = module.subprocess.run
        calls = []

        class FakeResult:
            returncode = 0
            stderr = ""
            stdout = json.dumps(
                {
                    "data_base64": base64.b64encode(b"png").decode("ascii"),
                    "width": 3,
                    "height": 4,
                    "cropped": True,
                    "scale": 1.0,
                    "format": 4,
                }
            )

        def fake_run(args, **kwargs):
            calls.append((args, kwargs))
            return FakeResult()

        module.subprocess.run = fake_run
        try:
            result = module.capture_kwin_screenshot_png({"x": 1.2, "y": 2.4, "width": 3.0, "height": 4.0}, 0.2)
            window_result = module.capture_kwin_screenshot_png(None, 0.2, window_id="window-uuid")
        finally:
            module.subprocess.run = old_run
            if old_helper is None:
                os.environ.pop("CODEX_COMPUTER_USE_SCREENSHOT_HELPER", None)
            else:
                os.environ["CODEX_COMPUTER_USE_SCREENSHOT_HELPER"] = old_helper

    assert result == {
        "bytes": b"png",
        "width": 3,
        "height": 4,
        "cropped": True,
        "scale": 1.0,
        "format": 4,
    }
    assert window_result == result
    assert calls == [
        (
            [str(helper), "--area", "1", "2", "3", "4"],
            {
                "env": None,
                "stdout": module.subprocess.PIPE,
                "stderr": module.subprocess.PIPE,
                "text": True,
                "timeout": 0.2,
                "check": False,
            },
        ),
        (
            [str(helper), "--window", "window-uuid"],
            {
                "env": None,
                "stdout": module.subprocess.PIPE,
                "stderr": module.subprocess.PIPE,
                "text": True,
                "timeout": 0.2,
                "check": False,
            },
        ),
    ]


def test_capture_kwin_screenshot_requires_installed_helper():
    module = load_broker_module()
    with tempfile.TemporaryDirectory() as temp_dir:
        helper = Path(temp_dir) / "missing-helper"
        old_helper = os.environ.get("CODEX_COMPUTER_USE_SCREENSHOT_HELPER")
        os.environ["CODEX_COMPUTER_USE_SCREENSHOT_HELPER"] = str(helper)
        try:
            try:
                module.capture_kwin_screenshot_png(None, 5)
            except RuntimeError as error:
                assert "Computer Use screenshot helper is not installed" in str(error)
            else:
                raise AssertionError("missing screenshot helper should fail")
        finally:
            if old_helper is None:
                os.environ.pop("CODEX_COMPUTER_USE_SCREENSHOT_HELPER", None)
            else:
                os.environ["CODEX_COMPUTER_USE_SCREENSHOT_HELPER"] = old_helper


def test_click_smoothly_moves_to_target_before_pressing_button():
    module = load_broker_module()
    broker = module.Broker()
    events = []

    class FakePortal:
        def ensure_remote(self, timeout):
            events.append(("ensure_remote", timeout))

        def pointer_move(self, x, y):
            events.append(("move", round(x, 3), round(y, 3)))

        def pointer_button(self, button, pressed):
            events.append(("button", button, pressed))

    broker.portal = FakePortal()
    broker.round_id = "round-test"
    broker.round_active = True
    module.run_kwin_script = lambda action, args: {"x": 10, "y": 20} if action == "cursor_position" else {}
    module.time.sleep = lambda seconds: None

    result = broker.click_foreground({"x": 110, "y": 120})

    moves = [event for event in events if event[0] == "move"]
    first_button_index = next(index for index, event in enumerate(events) if event[:2] == ("button", "left"))
    move_indexes = [index for index, event in enumerate(events) if event[0] == "move"]

    assert result["animated"] is True
    assert module.MIN_POINTER_ANIMATION_MS <= result["animation_ms"] <= module.MAX_POINTER_ANIMATION_MS
    assert len(moves) == result["animation_steps"]
    assert moves[0] != ("move", 110, 120)
    assert moves[-1] == ("move", 110, 120)
    assert max(move_indexes) < first_button_index

    x_deltas = [moves[0][1] - 10] + [moves[index][1] - moves[index - 1][1] for index in range(1, len(moves))]
    assert x_deltas[0] < max(x_deltas)
    assert x_deltas[-1] < max(x_deltas)


def test_pointer_animation_uses_live_cursor_position_for_every_click():
    module = load_broker_module()
    broker = module.Broker()
    broker.round_id = "round-test"
    broker.round_active = True
    starts = iter(((10, 20), (310, 420)))
    module.current_pointer_position = lambda: next(starts)
    module.time.sleep = lambda seconds: None
    moves = []

    class FakePortal:
        def pointer_move(self, x, y):
            moves.append((x, y))

    portal = FakePortal()
    broker.move_pointer(portal, 110, 120, {})
    first_click_move_count = len(moves)
    broker.move_pointer(portal, 410, 520, {})

    assert moves[0] != moves[first_click_move_count]
    assert moves[first_click_move_count][0] > 310
    assert moves[first_click_move_count][1] > 420


def test_round_lifecycle_activates_real_cursor_theme_before_click():
    module = load_broker_module()
    broker = module.Broker()
    events = []

    class FakeGlow:
        active = False

        def start(self):
            self.active = True
            events.append(("glow", "start"))

        def stop(self):
            self.active = False
            events.append(("glow", "stop"))

    class FakePortal:
        def ensure_remote(self, timeout):
            events.append(("ensure_remote", timeout))

        def pointer_move(self, x, y):
            events.append(("move", round(x, 3), round(y, 3)))

        def pointer_button(self, button, pressed):
            events.append(("button", button, pressed))

    broker.glow = FakeGlow()
    broker.portal = FakePortal()
    module.run_kwin_script = lambda action, args: {"x": 0, "y": 0} if action == "cursor_position" else {"restored": False}
    module.time.sleep = lambda seconds: None

    begin = broker.begin_round({"glow": True})
    click = broker.click_foreground({"x": 60, "y": 80})
    end = broker.end_round({})

    assert begin["round_active"] is True
    assert begin["glow_active"] is True
    assert click["round_id"] == begin["round_id"]
    assert click["glow_active"] is True
    assert end["round_active"] is False
    assert events[0] == ("glow", "start")
    assert events[-1] == ("glow", "stop")


def write_cursor_glow_theme(theme_path, base_theme="Base-Cursor", base_size=32):
    theme_path.mkdir(parents=True)
    (theme_path / "index.theme").write_text(
        "[Icon Theme]\n"
        "Name=Codex-Computer-Use-Glow\n"
        f"Inherits={base_theme}\n"
        f"X-Codex-BaseTheme={base_theme}\n"
        f"X-Codex-BaseSize={base_size}\n"
        "X-Codex-Animation=outward-edge-diffusion\n",
        encoding="utf-8",
    )


def test_cursor_glow_theme_applies_and_restores_plasma_theme():
    module = load_broker_module()
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        theme_path = root / "Codex-Computer-Use-Glow"
        write_cursor_glow_theme(theme_path)
        state = {"theme": "Base-Cursor", "size": 32}
        applied = []
        glow = module.CursorGlowTheme(
            theme_path=theme_path,
            apply_command="/usr/bin/true",
            read_command="/usr/bin/true",
            lock_path=root / "cursor.lock",
        )
        glow.current_theme = lambda: (state["theme"], state["size"])

        def apply_theme(theme, size):
            applied.append((theme, size))
            state.update(theme=theme, size=size)

        glow.apply_theme = apply_theme
        glow.start()

        assert glow.active is True
        assert state == {"theme": "Codex-Computer-Use-Glow", "size": 32}
        glow.stop()
        assert glow.active is False
        assert state == {"theme": "Base-Cursor", "size": 32}
        assert applied == [("Codex-Computer-Use-Glow", 32), ("Base-Cursor", 32)]


def test_cursor_glow_theme_rejects_a_different_active_base_theme():
    module = load_broker_module()
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        theme_path = root / "Codex-Computer-Use-Glow"
        write_cursor_glow_theme(theme_path)
        glow = module.CursorGlowTheme(
            theme_path=theme_path,
            apply_command="/usr/bin/true",
            read_command="/usr/bin/true",
            lock_path=root / "cursor.lock",
        )
        glow.current_theme = lambda: ("Different-Cursor", 32)

        try:
            glow.start()
        except RuntimeError as error:
            assert "different Plasma cursor theme" in str(error)
        else:
            raise AssertionError("CursorGlowTheme.start should reject stale generated-theme metadata")
        assert glow.active is False
        assert glow.lock_file is None


def test_cursor_glow_theme_has_single_global_round_owner():
    module = load_broker_module()
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        theme_path = root / "Codex-Computer-Use-Glow"
        write_cursor_glow_theme(theme_path)
        state = {"theme": "Base-Cursor", "size": 32}

        def make_glow():
            glow = module.CursorGlowTheme(
                theme_path=theme_path,
                apply_command="/usr/bin/true",
                read_command="/usr/bin/true",
                lock_path=root / "cursor.lock",
            )
            glow.current_theme = lambda: (state["theme"], state["size"])
            glow.apply_theme = lambda theme, size: state.update(theme=theme, size=size)
            return glow

        owner = make_glow()
        contender = make_glow()
        owner.start()
        try:
            contender.start()
        except RuntimeError as error:
            assert "owns the global cursor glow theme" in str(error)
        else:
            raise AssertionError("a second Computer Use round should not own the global Plasma cursor theme")
        finally:
            owner.stop()

        assert state == {"theme": "Base-Cursor", "size": 32}


def test_window_local_accessibility_coordinates_use_matching_buffer_geometry():
    module = load_broker_module()
    tree = {
        "nodes": [
            {
                "depth": 0,
                "role": "frame",
                "bounds": {"x": 0, "y": 0, "width": 640, "height": 480},
                "backend_window_bounds": {"x": 0, "y": 0, "width": 640, "height": 480},
            },
            {
                "depth": 1,
                "role": "button",
                "bounds": {"x": 8, "y": 212, "width": 100, "height": 57},
                "backend_window_bounds": {"x": 8, "y": 212, "width": 100, "height": 57},
            },
        ]
    }
    window = {
        "id": "window-1",
        "frame_geometry": {"x": 320, "y": 146, "width": 640, "height": 510},
        "buffer_geometry": {"x": 320, "y": 175, "width": 640, "height": 480},
    }
    png = {"width": 1280, "height": 960}

    transform = module.map_accessibility_to_window_image(tree, window, png)

    assert transform["geometry_source"] == "buffer_geometry"
    assert transform["accessibility_source_space"] == "window-local"
    assert tree["nodes"][1]["bounds"] == {"x": 16.0, "y": 424.0, "width": 200.0, "height": 114.0}

    root = {"backend_coordinate_transform": transform}
    target = FakeAccessible("Save", "button", bounds=(8, 212, 100, 57))
    point = module.foreground_action_point(root, {"kind": "atspi", "target": target}, {})
    assert point == (378.0, 415.5)


def test_screen_accessibility_coordinates_map_through_the_same_transform():
    module = load_broker_module()
    tree = {
        "nodes": [
            {
                "depth": 0,
                "role": "frame",
                "bounds": {"x": 320, "y": 175, "width": 640, "height": 480},
                "backend_window_bounds": {"x": 0, "y": 0, "width": 640, "height": 480},
            },
            {
                "depth": 1,
                "role": "button",
                "bounds": {"x": 328, "y": 387, "width": 100, "height": 57},
                "backend_window_bounds": {"x": 8, "y": 212, "width": 100, "height": 57},
            },
        ]
    }
    window = {
        "id": "window-1",
        "frame_geometry": {"x": 320, "y": 146, "width": 640, "height": 510},
        "buffer_geometry": {"x": 320, "y": 175, "width": 640, "height": 480},
    }
    transform = module.map_accessibility_to_window_image(tree, window, {"width": 640, "height": 480})

    assert transform["accessibility_source_space"] == "screen"
    assert tree["nodes"][1]["bounds"] == {"x": 8.0, "y": 212.0, "width": 100.0, "height": 57.0}

    root = {"backend_coordinate_transform": transform}
    target = FakeAccessible(
        "Save",
        "button",
        bounds=(328, 387, 100, 57),
        window_bounds=(8, 212, 100, 57),
    )
    point = module.foreground_action_point(root, {"kind": "atspi", "target": target}, {})
    assert point == (378.0, 415.5)


def test_unclassified_accessibility_coordinates_disable_ref_pointer_delivery():
    module = load_broker_module()
    tree = {
        "nodes": [
            {
                "depth": 0,
                "role": "frame",
                "bounds": {"x": 100, "y": 100, "width": 640, "height": 480},
                "backend_window_bounds": {"x": 0, "y": 0, "width": 640, "height": 480},
            }
        ]
    }
    window = {
        "id": "window-1",
        "frame_geometry": {"x": 320, "y": 146, "width": 640, "height": 510},
        "buffer_geometry": {"x": 320, "y": 175, "width": 640, "height": 480},
    }
    transform = module.map_accessibility_to_window_image(tree, window, {"width": 640, "height": 480})

    assert transform["accessibility_source_space"] == "unavailable"
    assert tree["nodes"][0]["bounds"] is None
    root = {"backend_coordinate_transform": transform}
    target = FakeAccessible("Save", "button", bounds=(100, 100, 640, 480), window_bounds=(0, 0, 640, 480))
    try:
        module.foreground_action_point(root, {"kind": "atspi", "target": target}, {})
    except ValueError as error:
        assert "coordinate space is unavailable" in str(error)
    else:
        raise AssertionError("ambiguous AT-SPI coordinates were delivered through an element ref")


def test_broker_routes_session_id_to_isolated_supervisor():
    module = load_broker_module()
    broker = module.Broker()
    calls = []

    class FakeSupervisor:
        def call(self, method, params):
            calls.append((method, params))
            return {"backend": "isolated"}

        def stop(self, params):
            return {"state": "Stopped"}

    broker.isolated = FakeSupervisor()
    params = {"session_id": "isolated-1", "root": {"kind": "window"}}
    result = broker.handle("act_transaction", params)

    assert result == {"backend": "isolated"}
    assert calls == [("act_transaction", params)]


def test_v2_broker_rejects_legacy_public_method():
    module = load_broker_module()
    broker = module.Broker()

    try:
        broker.handle("computer_click", {"x": 1, "y": 2})
    except ValueError as error:
        assert "unknown method" in str(error)
    else:
        raise AssertionError("legacy public method was accepted")


def test_accessibility_look_store_binds_refs_to_one_exact_look():
    module = load_broker_module()
    store = module.AccessibilityLookStore(limit=2)
    first = store.begin("window:w1:desktop-pid:42")
    wire = store.bind(first, "atspi", object(), ["action"])

    assert store.require(first, wire, "window:w1:desktop-pid:42")["capabilities"] == ["action"]
    for call in (
        lambda: store.require(first, wire, "window:w2:desktop-pid:42"),
        lambda: store.require(first, "wire-99"),
    ):
        try:
            call()
        except ValueError:
            pass
        else:
            raise AssertionError("look store accepted a cross-root or unknown wire ref")

    store.begin("window:w2:desktop-pid:43")
    store.begin("window:w3:desktop-pid:44")
    try:
        store.require(first, wire)
    except ValueError as error:
        assert "stale" in str(error)
    else:
        raise AssertionError("expired look remained actionable")


def test_v2_accessibility_outline_contains_opaque_wire_refs_and_capabilities():
    module = load_broker_module()
    button = FakeAccessible("Save", "push button", bounds=(20, 30, 80, 40), pid=42)
    frame = FakeAccessible("Demo", "frame", children=[button], bounds=(0, 0, 640, 480), pid=42)
    app = FakeAccessible("Demo App", "application", children=[frame], pid=42)
    old_pyatspi = install_fake_pyatspi([app])
    try:
        store = module.AccessibilityLookStore()
        tree = module.read_accessibility_tree(
            {
                "target_window": {"id": "w1", "pid": 42, "caption": "Demo"},
                "max_depth": 5,
                "max_nodes": 20,
            },
            look_store=store,
            root_identity="window:w1:desktop-pid:42",
        )
    finally:
        restore_fake_pyatspi(old_pyatspi)

    assert tree["look_id"].startswith("look-")
    assert [node["wire_ref"] for node in tree["nodes"]] == ["wire-1", "wire-2"]
    assert "component" in tree["nodes"][0]["capabilities"]
    assert store.require(tree["look_id"], "wire-2")["target"] is button


def test_semantic_set_text_requires_readback_verification():
    module = load_broker_module()
    broker = module.Broker()

    class EditableAccessible:
        def __init__(self, accepts):
            self.text = "before"
            self.accepts = accepts

        def queryEditableText(self):
            def set_text(value):
                if self.accepts:
                    self.text = value
                return self.accepts

            return types.SimpleNamespace(setTextContents=set_text)

        def queryText(self):
            return types.SimpleNamespace(
                characterCount=len(self.text),
                getText=lambda start, end: self.text[start:end],
            )

    verified = broker._execute_semantic_action(
        {"kind": "window"},
        {"kind": "atspi", "target": EditableAccessible(True)},
        "set_text",
        {"text": "after"},
    )
    rejected = broker._execute_semantic_action(
        {"kind": "window"},
        {"kind": "atspi", "target": EditableAccessible(False)},
        "set_text",
        {"text": "after"},
    )

    assert verified["outcome"] == "worked"
    assert verified["verified"] is True
    assert rejected["outcome"] == "didnt"
    assert rejected["side_effect_free"] is True


def test_semantic_press_treats_do_action_as_delivery_evidence():
    module = load_broker_module()
    broker = module.Broker()

    class ActionAccessible:
        def __init__(self, result):
            self.result = result

        def queryAction(self):
            return types.SimpleNamespace(
                nActions=1,
                getName=lambda index: "click",
                doAction=lambda index: self.result,
            )

    delivered = broker._execute_semantic_action(
        {"kind": "window"},
        {"kind": "atspi", "target": ActionAccessible(True)},
        "press",
        {},
    )
    refused = broker._execute_semantic_action(
        {"kind": "window"},
        {"kind": "atspi", "target": ActionAccessible(False)},
        "press",
        {},
    )

    assert delivered["outcome"] == "unknown"
    assert delivered["delivered"] is True
    assert refused["outcome"] == "didnt"
    assert refused["side_effect_free"] is True


def test_window_image_coordinate_mapping_is_explicit_and_bounded():
    module = load_broker_module()
    root = {
        "backend_coordinate_transform": {
            "window_id": "w1",
            "origin_x": 100,
            "origin_y": 50,
            "scale_x": 2,
            "scale_y": 2,
            "image_width": 800,
            "image_height": 600,
        }
    }

    assert module.map_window_image_point(root, 200, 100) == (200.0, 100.0)
    try:
        module.map_window_image_point(root, 800, 10)
    except ValueError as error:
        assert "outside" in str(error)
    else:
        raise AssertionError("out-of-image coordinate was accepted")


def test_portal_absolute_coordinates_use_stream_position():
    module = load_broker_module()
    portal = object.__new__(module.PortalSession)
    portal.remote_streams = [[17, {"position": [1920, 0], "size": [2560, 1440]}]]

    assert portal.screen_to_stream_coordinates(2020, 300) == (17, 100.0, 300.0)
    try:
        portal.screen_to_stream_coordinates(100, 300)
    except ValueError as error:
        assert "outside RemoteDesktop stream" in str(error)
    else:
        raise AssertionError("coordinate outside the portal stream was accepted")


def test_event_journal_sequences_are_resource_scoped():
    module = load_broker_module()
    journal = module.EventJournal()
    resource_a = "desktop-pid:10"
    resource_b = "desktop-pid:20"
    initial = journal.snapshot(resource_a)

    journal.record("object:text-changed", {"pid": 20}, resource_b)
    assert journal.snapshot(resource_a) == initial
    journal.record("object:text-changed", {"pid": 10}, resource_a)
    assert journal.wait_after(resource_a, initial, 0) > initial


def test_foreground_lease_script_has_no_window_desktop_reassignment():
    module = load_broker_module()
    source = module.kwin_script_source("service", "/path", "lease_acquire", {"window_id": "w1"})
    lease_section = source[source.index('if (action === "lease_acquire")'):source.index('if (action === "lease_validate")')]

    assert "workspace.currentDesktop" in lease_section
    assert "workspace.activeWindow = window" in lease_section
    assert "window.desktops =" not in lease_section


def test_isolated_bus_readiness_reply_requires_one_typed_value():
    module = load_isolated_session_module()

    assert module.parse_busctl_reply('{"type":"b","data":[true]}', "b") is True
    assert module.parse_busctl_reply('{"type":"s","data":["unix:path=/tmp/at-spi"]}', "s") == "unix:path=/tmp/at-spi"

    for reply in [
        '{"type":"s","data":[true]}',
        '{"type":"b","data":[]}',
        '{"type":"b","data":[true,false]}',
        "not-json",
    ]:
        try:
            module.parse_busctl_reply(reply, "b")
        except RuntimeError:
            pass
        else:
            raise AssertionError(f"invalid busctl reply was accepted: {reply}")


def test_isolated_xwayland_environment_is_explicit_and_validated():
    module = load_isolated_session_module()

    assert module.parse_xwayland_environment(
        '{"version":1,"display":":7","xauthority":""}'
    ) == {"DISPLAY": ":7"}
    assert module.parse_xwayland_environment(
        '{"version":1,"display":":8","xauthority":"/run/user/1000/xauth"}'
    ) == {"DISPLAY": ":8", "XAUTHORITY": "/run/user/1000/xauth"}

    for payload in [
        '{"version":2,"display":":7","xauthority":""}',
        '{"version":1,"display":"localhost:7","xauthority":""}',
        '{"version":1,"display":":7","xauthority":null}',
        "not-json",
    ]:
        try:
            module.parse_xwayland_environment(payload)
        except RuntimeError:
            pass
        else:
            raise AssertionError(f"invalid Xwayland environment was accepted: {payload}")


def test_isolated_kwin_command_owns_xwayland_and_environment_bridge():
    module = load_isolated_session_module()
    environment_path = Path("/run/user/1000/codex/xwayland-environment.json")

    command = module.build_kwin_command(1280, 800, "wayland-codex", environment_path)

    assert command[:4] == ["kwin_wayland", "--virtual", "--no-lockscreen", "--xwayland"]
    assert shlex.split(command[-1]) == [
        sys.executable,
        str(module.XWAYLAND_ENVIRONMENT_HELPER_PATH),
        str(environment_path),
    ]


def test_root_gone_expectation_uses_authoritative_root_presence():
    module = load_broker_module()
    present = {
        "root": {"kind": "window", "title": "Demo"},
        "outline": {
            "nodes": [
                {"role": "window", "name": "Demo", "states": ["active"]},
            ]
        },
    }
    missing = {
        "root": {"kind": "window", "title": "Demo", "present": False},
        "outline": {
            "nodes": [
                {"role": "window", "name": "Demo", "states": ["defunct"]},
            ]
        },
    }

    assert module.evaluate_observation_expectation(present, {"gone": False}) == (
        True,
        {"alive": True, "role": "window", "text": "Demo", "value": None},
    )
    assert module.evaluate_observation_expectation(present, {"gone": True})[0] is False
    assert module.evaluate_observation_expectation(missing, {"gone": True}) == (
        True,
        {"alive": False, "role": "window", "text": "Demo", "value": None},
    )
    assert module.evaluate_observation_expectation(missing, {"gone": False})[0] is False


def main():
    test_deduplicate_desktop_entries_keeps_first_xdg_priority_entry()
    test_desktop_entry_selection_prefers_named_app_over_chrome_web_app_prefix()
    test_list_windows_defaults_to_token_lean_summary_with_limit()
    test_list_windows_full_detail_preserves_raw_kwin_fields()
    test_key_combo_uses_portal_keycodes_for_modified_shortcuts()
    test_status_notifier_item_ref_parses_unique_and_well_known_names()
    test_session_bus_sets_glib_main_loop_before_creating_bus()
    test_select_tray_item_prefers_exact_query_match()
    test_select_tray_item_matches_owner_process_fields()
    test_capture_kwin_screenshot_uses_authorized_helper()
    test_capture_kwin_screenshot_requires_installed_helper()
    test_broker_routes_session_id_to_isolated_supervisor()
    test_v2_broker_rejects_legacy_public_method()
    test_accessibility_look_store_binds_refs_to_one_exact_look()
    test_v2_accessibility_outline_contains_opaque_wire_refs_and_capabilities()
    test_semantic_set_text_requires_readback_verification()
    test_semantic_press_treats_do_action_as_delivery_evidence()
    test_window_local_accessibility_coordinates_use_matching_buffer_geometry()
    test_screen_accessibility_coordinates_map_through_the_same_transform()
    test_unclassified_accessibility_coordinates_disable_ref_pointer_delivery()
    test_window_image_coordinate_mapping_is_explicit_and_bounded()
    test_portal_absolute_coordinates_use_stream_position()
    test_event_journal_sequences_are_resource_scoped()
    test_foreground_lease_script_has_no_window_desktop_reassignment()
    test_isolated_bus_readiness_reply_requires_one_typed_value()
    test_isolated_xwayland_environment_is_explicit_and_validated()
    test_isolated_kwin_command_owns_xwayland_and_environment_bridge()
    test_root_gone_expectation_uses_authoritative_root_presence()
    print("Computer Use broker tests passed")


if __name__ == "__main__":
    main()
