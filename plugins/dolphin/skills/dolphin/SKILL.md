---
name: dolphin
description: Use when the user asks Codex to control KDE Dolphin or perform Linux file-manager workflows such as opening folders, revealing files, reading open Dolphin windows or selected files, listing, searching, creating folders, renaming, copying, moving, trashing, copying paths, opening properties, or opening a terminal in a folder.
---

# Dolphin

Prefer the Dolphin MCP tools for KDE file-manager work on Linux.

Use the non-UI filesystem tools for background work whenever possible:

- `dolphin_list_directory`
- `dolphin_search`
- `dolphin_create_folder`
- `dolphin_rename_path`
- `dolphin_copy_path`
- `dolphin_move_path`
- `dolphin_move_to_trash`
- `dolphin_copy_paths_to_clipboard`

Use the window-context tools when the user wants Codex to continue from an already opened Dolphin window:

- `dolphin_list_windows`
- `dolphin_get_selection`
- `dolphin_list_window_directory`
- `dolphin_operate_on_selection`
- `dolphin_open_window_context`

Use UI-facing tools only when the user wants Dolphin or a desktop dialog to appear:

- `dolphin_open_path`
- `dolphin_reveal_path`
- `dolphin_show_properties`
- `dolphin_open_terminal`

These tools use Linux filesystem APIs, Dolphin, KDE/Freedesktop commands, AT-SPI, and the clipboard provider. They do not drive the foreground mouse or keyboard.

Dolphin selections are readable for windows launched after Dolphin window access was enabled. The Linux installer activation installs a user-level Dolphin desktop-entry override plus a `dolphin` wrapper, and windows opened by this plugin also launch with `QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1`. Already-running Dolphin processes from before that setting cannot be changed in place; reopen them first.
