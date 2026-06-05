---
name: computer-use
description: Use owner-authorized KDE Wayland foreground desktop observation and input. Screenshots default to KWin ScreenShot2, pointer and keyboard input use the pre-authorized KDE RemoteDesktop portal, and tray-hidden apps can be restored through KDE StatusNotifierItem.
---

# Computer Use

Use these tools when the user wants Codex to operate visible KDE Wayland desktop apps.

Start an operation with `computer_begin_round`, then call `computer_observe`, `computer_list_desktops`, or `computer_list_windows`. Input tools auto-start a round when needed, but an explicit begin makes the cursor glow and desktop restore lifecycle visible. Use `computer_list_tray_items` when the target app is hidden to the KDE system tray and does not currently have a KWin window. Screenshot capture defaults to `backend: "direct"` through KWin ScreenShot2 authorization from the activated Codex desktop entry. Foreground input tools default to `backend: "portal"` through KDE RemoteDesktop, using the installer-managed portal pre-authorization so normal operation should not show KDE portal dialogs.

When operating a window, use `computer_activate_window` first unless the target is already active. The broker moves activated windows and active input targets to KWin virtual desktop 1 for the current Computer Use round, records their original virtual desktops, and keeps them there for subsequent operations to avoid repeated desktop shuffling. Call `computer_end_round` when the round ends so cursor glow stops and moved windows return to their original virtual desktops. `computer_release_desktops` remains a compatibility alias for this cleanup. `computer_list_windows` returns each window's virtual desktop ownership.

Use `computer_open_app` with `reuse_existing: true` when the app is probably already running and reusing its current window or tray item is safer than starting another process. Leave `reuse_existing` false when the task needs a new app launch, such as opening a fresh Chrome window for testing.

When the app only exists in the system tray, prefer `computer_activate_tray_item` with the `ref`, `service`/`path`, or query returned by `computer_list_tray_items`. That invokes KDE StatusNotifierItem DBus activation instead of guessing tray coordinates. Tray queries also match the StatusNotifierItem owner process fields, so apps with generic or blank tray metadata can still be selected by executable name when KDE exposes the item through StatusNotifierWatcher. After a window appears, continue with normal foreground tools.

Do not use direct pointer input paths. On Plasma 6.3+, the activation helper pre-authorizes KDE RemoteDesktop for `app_id: "codex"` and the broker registers that app id before portal calls; without that pre-authorization, input can show KDE remote-control dialogs.

Coordinates are in the visible compositor coordinate space returned by `computer_observe`.

Do not claim background control. These tools operate the foreground desktop and can be interrupted by user pointer or keyboard activity.

Prefer `computer_type` for text. It uses clipboard paste for non-ASCII text when `wl-copy` is available, then sends the paste shortcut through the RemoteDesktop portal.

Use `computer_wait` with `observe: true` after actions that trigger UI transitions. Pass the same screenshot `backend` you would use for `computer_observe` when direct KWin screenshot access is not available in the current process.
