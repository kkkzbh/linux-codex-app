#!/usr/bin/env python3
import importlib.util
import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BROKER_PATH = ROOT / "plugins" / "computer-use" / "scripts" / "computer-use-broker.py"


def load_broker_module():
    spec = importlib.util.spec_from_file_location("computer_use_broker", BROKER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_release_desktops_reports_closed_windows_as_missing():
    module = load_broker_module()
    broker = module.Broker()
    broker.desktop_snapshots = {
        "open-window": {"id": "open-window", "caption": "open"},
        "closed-window": {"id": "closed-window", "caption": "closed"},
    }

    def fake_run_kwin_script(action, args):
        assert action == "restore_window_desktops"
        snapshot = args["snapshot"]
        if snapshot["id"] == "closed-window":
            return {"restored": False, "missing": True, "snapshot": snapshot}
        return {"restored": True, "window": {"id": snapshot["id"], "caption": snapshot["caption"]}}

    module.run_kwin_script = fake_run_kwin_script

    result = broker.release_desktops({})

    assert result["count"] == 1
    assert result["missing_count"] == 1
    assert result["restored"] == [{"id": "open-window", "caption": "open"}]
    assert result["missing"] == [{"id": "closed-window", "caption": "closed"}]
    assert broker.desktop_snapshots == {}


def test_select_launch_window_prefers_new_window_before_existing_pid_match():
    module = load_broker_module()
    windows = [
        {"id": "old-dolphin", "caption": "old", "pid": 100},
        {"id": "new-dolphin", "caption": "/tmp", "pid": 100},
        {"id": "spawn-helper", "caption": "helper", "pid": 200},
    ]

    selected = module.select_launch_window(windows, {"old-dolphin"}, 200)

    assert selected == windows[1]


def test_select_launch_window_uses_pid_when_no_new_window_exists():
    module = load_broker_module()
    windows = [
        {"id": "old", "caption": "old", "pid": 100},
        {"id": "spawned", "caption": "spawned", "pid": 200},
    ]

    selected = module.select_launch_window(windows, {"old", "spawned"}, 200)

    assert selected == windows[1]


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

    result = broker.open_app({"query": "chrome", "reuse_existing": True, "activate": True})

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

    module.subprocess.Popen = fake_popen

    def fake_list_windows(params):
        assert params["app"] in ("remote-viewer", "remote-viewer.desktop", "Remote Viewer")
        if params["app"] == "remote-viewer":
            return {"windows": [existing_window]}
        return {"windows": []}

    broker.list_windows = fake_list_windows
    broker.activate_window = lambda params: {"window": {"id": params["window_id"], "active": True}}

    result = broker.open_app({"query": "remote-viewer", "reuse_existing": True, "activate": True})

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

    module.subprocess.Popen = fake_popen
    broker.list_windows = lambda params: {"windows": []}
    tray_calls = []

    def fake_activate_tray_item(params):
        tray_calls.append(params)
        return {"activated": True, "item": {"id": "wechat"}, "window": {"id": "wechat-window"}}

    broker.activate_tray_item = fake_activate_tray_item

    result = broker.open_app({"query": "wechat", "reuse_existing": True, "activate": True})

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
    module.run_kwin_script = lambda action, args: {"x": 10, "y": 20} if action == "cursor_position" else {}
    module.time.sleep = lambda seconds: None

    result = broker.click_foreground({"x": 110, "y": 120, "animation_ms": 200, "animation_steps": 8})

    moves = [event for event in events if event[0] == "move"]
    first_button_index = next(index for index, event in enumerate(events) if event[:2] == ("button", "left"))
    move_indexes = [index for index, event in enumerate(events) if event[0] == "move"]

    assert result["animated"] is True
    assert result["animation_steps"] == 8
    assert len(moves) == 8
    assert moves[0] != ("move", 110, 120)
    assert moves[-1] == ("move", 110, 120)
    assert max(move_indexes) < first_button_index


def test_round_lifecycle_starts_glow_and_pulses_click_before_end():
    module = load_broker_module()
    broker = module.Broker()
    events = []

    class FakeGlow:
        def start(self):
            events.append(("glow", "start"))

        def move(self, x, y):
            events.append(("glow", "move", round(x, 3), round(y, 3)))

        def pulse(self, x, y, button):
            events.append(("glow", "pulse", round(x, 3), round(y, 3), button))

        def stop(self):
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
    click = broker.click_foreground({"x": 60, "y": 80, "animation_ms": 120, "animation_steps": 4})
    end = broker.end_round({})

    assert begin["round_active"] is True
    assert begin["glow_active"] is True
    assert click["round_id"] == begin["round_id"]
    assert click["glow_active"] is True
    assert end["round_active"] is False
    assert events[0] == ("glow", "start")
    assert ("glow", "move", 60, 80) in events
    assert ("glow", "pulse", 60, 80, "left") in events
    assert events[-1] == ("glow", "stop")


def main():
    test_release_desktops_reports_closed_windows_as_missing()
    test_select_launch_window_prefers_new_window_before_existing_pid_match()
    test_select_launch_window_uses_pid_when_no_new_window_exists()
    test_deduplicate_desktop_entries_keeps_first_xdg_priority_entry()
    test_desktop_entry_selection_prefers_named_app_over_chrome_web_app_prefix()
    test_open_app_can_reuse_and_activate_existing_matching_window()
    test_open_app_reuse_matches_exec_name_when_display_name_differs()
    test_open_app_can_reuse_tray_item_when_no_window_exists()
    test_list_windows_defaults_to_token_lean_summary_with_limit()
    test_list_windows_full_detail_preserves_raw_kwin_fields()
    test_key_combo_uses_portal_keycodes_for_modified_shortcuts()
    test_status_notifier_item_ref_parses_unique_and_well_known_names()
    test_session_bus_sets_glib_main_loop_before_creating_bus()
    test_select_tray_item_prefers_exact_query_match()
    test_select_tray_item_matches_owner_process_fields()
    test_wait_observe_passes_requested_screenshot_backend()
    test_click_smoothly_moves_to_target_before_pressing_button()
    test_round_lifecycle_starts_glow_and_pulses_click_before_end()
    print("Computer Use broker tests passed")


if __name__ == "__main__":
    main()
