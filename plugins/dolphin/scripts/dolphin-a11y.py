#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import posixpath
import sys
import traceback
from typing import Any

try:
    import pyatspi
except Exception as exc:  # pragma: no cover - exercised by integration environments
    print(
        json.dumps(
            {
                "ok": False,
                "backend": "atspi",
                "windows": [],
                "warnings": [f"pyatspi is unavailable: {exc}"],
                "setup_hint": "Install pyatspi and open Dolphin through this plugin so QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 is set.",
            }
        )
    )
    raise SystemExit(0)


MAX_DESCENDANTS = 5000


def main() -> None:
    try:
        desktop = pyatspi.Registry.getDesktop(0)
        windows: list[dict[str, Any]] = []

        for app_index in range(safe_child_count(desktop)):
            app = safe_child(desktop, app_index)
            if app is None:
                continue
            if safe_name(app).lower() != "dolphin":
                continue

            for frame_index in range(safe_child_count(app)):
                frame = safe_child(app, frame_index)
                if frame is None or safe_role(frame) != "frame":
                    continue
                windows.append(describe_window(frame, app_index, frame_index))

        print(
            json.dumps(
                {
                    "ok": True,
                    "backend": "atspi",
                    "windows": windows,
                    "warnings": accessibility_warnings(windows),
                    "setup_hint": "Dolphin windows are readable when Dolphin was started with QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1; this plugin sets it for windows it opens.",
                },
                ensure_ascii=False,
            )
        )
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "backend": "atspi",
                    "windows": [],
                    "warnings": [f"accessibility query failed: {exc}", traceback.format_exc(limit=3)],
                    "setup_hint": "Restart Dolphin through the Dolphin plugin so accessibility is enabled for selection reads.",
                },
                ensure_ascii=False,
            )
        )


def describe_window(frame: Any, app_index: int, frame_index: int) -> dict[str, Any]:
    title = safe_name(frame)
    current_directory = parse_current_directory(title)
    selected_items: list[dict[str, Any]] = []
    file_view_names: list[str] = []
    file_view_node_ids: set[int] = set()
    focused = has_state(frame, "focused") or has_focused_descendant(frame)
    active = has_state(frame, "active")

    def visit(
        node: Any,
        parent_role: str | None = None,
        _parent_name: str | None = None,
        parent_node_id: int | None = None,
    ) -> None:
        role = safe_role(node)
        name = safe_name(node)
        states = state_names(node)

        if role == "list" and has_state_name(states, "multiselectable") and name:
            file_view_names.append(name)
            file_view_node_ids.add(id(node))

        if (
            role in {"list item", "table cell"}
            and has_state_name(states, "selected")
            and has_state_name(states, "selectable")
            and current_directory
            and parent_role == "list"
            and parent_node_id in file_view_node_ids
        ):
            selected_items.append(
                {
                    "name": name,
                    "path": posixpath.join(current_directory, name),
                    "states": states,
                }
            )

    walk(frame, visit)

    return {
        "window_id": f"atspi:{app_index}:{frame_index}",
        "title": title,
        "current_directory": current_directory,
        "focused": focused,
        "active": active,
        "selected_items": selected_items,
        "selected_paths": [item["path"] for item in selected_items],
        "selected_count": len(selected_items),
        "file_view_names": sorted(set(file_view_names)),
        "accessible": True,
    }


def parse_current_directory(title: str) -> str | None:
    for marker in (" — Dolphin", " - Dolphin"):
        if title.endswith(marker):
            candidate = title[: -len(marker)]
            if candidate.startswith("/") and os.path.isabs(candidate):
                return os.path.normpath(candidate)
    return None


def accessibility_warnings(windows: list[dict[str, Any]]) -> list[str]:
    if not windows:
        return ["No accessible Dolphin windows were found."]
    warnings: list[str] = []
    for window in windows:
        if not window.get("current_directory"):
            warnings.append(f"Window does not expose an absolute current directory: {window.get('title', '')}")
    return warnings


def walk(root: Any, callback: Any) -> None:
    stack: list[tuple[Any, str | None, str | None, int | None]] = [(root, None, None, None)]
    visited = 0
    while stack and visited < MAX_DESCENDANTS:
        node, parent_role, parent_name, parent_node_id = stack.pop()
        visited += 1
        callback(node, parent_role, parent_name, parent_node_id)
        role = safe_role(node)
        name = safe_name(node)
        node_id = id(node)
        for index in reversed(range(min(safe_child_count(node), 500))):
            child = safe_child(node, index)
            if child is not None:
                stack.append((child, role, name, node_id))


def has_focused_descendant(root: Any) -> bool:
    found = False

    def check(
        node: Any,
        _parent_role: str | None = None,
        _parent_name: str | None = None,
        _parent_node_id: int | None = None,
    ) -> None:
        nonlocal found
        if has_state(node, "focused"):
            found = True

    walk(root, check)
    return found


def safe_child_count(node: Any) -> int:
    try:
        return int(node.childCount)
    except Exception:
        return 0


def safe_child(node: Any, index: int) -> Any | None:
    try:
        return node.getChildAtIndex(index)
    except Exception:
        return None


def safe_name(node: Any) -> str:
    try:
        return str(node.name or "")
    except Exception:
        return ""


def safe_role(node: Any) -> str:
    try:
        return str(node.getRoleName() or "")
    except Exception:
        return ""


def state_names(node: Any) -> list[str]:
    try:
        return [pyatspi.stateToString(state) for state in node.getState().getStates()]
    except Exception:
        return []


def has_state(node: Any, state: str) -> bool:
    return has_state_name(state_names(node), state)


def has_state_name(states: list[str], state: str) -> bool:
    return state in states


if __name__ == "__main__":
    main()
