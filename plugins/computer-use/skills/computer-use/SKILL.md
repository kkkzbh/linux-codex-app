---
name: computer-use
description: Use state-scoped KDE Wayland Computer Use. Isolated KWin is the required default for every task that does not depend on the user's existing foreground desktop state. Foreground discovery requires a concrete justification.
---

# Computer Use

Use this plugin for KDE Wayland UI automation. Prefer an app-specific plugin when it owns the requested operation.

The v2 protocol exposes `find_roots`, `observe_ui`, `search_ui`, `expand_ui`, `inspect_ui`, `act_ui`, `read_text`, and `wait_for`. Isolated lifecycle tools are `isolated_start`, `isolated_status`, and `isolated_stop`.

## Routing invariant

Use isolated Computer Use for every operation that can complete in a fresh GUI profile. This includes fresh app launches, new windows, deterministic UI tests, and work whose files are available to the isolated session. Start the isolated session before root discovery and pass its `session_id` through the complete workflow.

Foreground Computer Use is permitted only when the requested result depends on the user's existing desktop state: an already-open window or unsaved document, live Plasma or tray state, an existing GUI login that cannot be recreated in isolation, or a global shortcut. An app already being open, lower startup latency, or convenience does not make foreground control necessary.

Every foreground `find_roots` call must include `foreground_reason` with that concrete dependency. `find_roots` accepts exactly one routing authority: `session_id` for isolated work or `foreground_reason` for foreground work. Missing or mixed authority fails directly.

## State-scoped workflow

1. Select the route under the routing invariant. Normally call `isolated_start`, then call `find_roots` with `session_id`. For necessary foreground work, call `find_roots` with `foreground_reason`. Window roots address existing windows. Application roots expose exact `.desktop` launch actions. Tray roots expose exact KDE StatusNotifierItem activation actions.
2. Call `observe_ui` with one `rootRef`. Retain its `stateId`, `epoch`, and element refs such as `@e4`.
3. Use `search_ui`, `expand_ui`, and `inspect_ui` against that cached state. These calls do not touch the live desktop.
4. Use `read_text` for a live Text or Value read through an exact AT-SPI ref.
5. Call `act_ui` with the current `stateId`. Put related actions and an optional `expect` condition in one transaction.
6. Continue from the successor observation returned by `act_ui` or `wait_for`.

`act_ui` and `wait_for` return compact successor metadata by default while retaining the complete outline in `StateStore`. Use the successor `stateId` with cached inspection tools. Request `response: "full"` only when the complete successor outline is required immediately.

Element refs are valid only with their originating state. A stale state, expired look, moved window, resized window, or mismatched root must be observed again. Do not guess a replacement ref.

`act_ui` reports `worked`, `didnt`, or `unknown`. AT-SPI delivery alone is evidence that an action was sent. `set_text` becomes `worked` after its resulting value is verified. Pointer and press actions without a postcondition normally remain `unknown`; do not repeat them automatically.

Prefer `policy: "auto"`. It tries AT-SPI `Action` or `EditableText` first. Foreground delivery is allowed only after a semantic attempt reports a side-effect-free `didnt`. Use `semantic_only` when focus changes are unacceptable. Use `foreground` when the target requires physical input.

Coordinates use `window-image-px` from the exact target-window image. The backend classifies AT-SPI extents as `screen` or `window-local` by comparing screen/window extents with exact KWin geometry. An unclassified source disables ref-based pointer delivery. The backend validates KWin window identity, PID, frame/buffer geometry, focus, coordinate source, and scale before foreground delivery.

## Isolated target

Use the isolated target for all work that can run in a fresh profile:

1. Call `isolated_start` and retain `session_id`.
2. Pass `session_id` to `find_roots` and every shared v2 tool.
3. Observe an application root and press its action to launch the app, then find and observe the resulting window root.
4. Call `isolated_stop` when finished. Use `force: true` only when the session is unresponsive.

The isolated session owns a private KWin `--virtual` compositor, Wayland socket, KWin-managed rootless Xwayland display, D-Bus session, AT-SPI bus, HOME, and XDG directories. Screen capture uses KWin ScreenShot2, input uses KWin EIS, and the complete process tree belongs to one transient systemd user-scope cgroup.

This provides GUI/profile isolation. Filesystem paths, networking, the system bus, and same-user process privileges remain accessible.

## Foreground target

Use foreground roots only when the result depends on existing user windows or unsaved state, live Plasma state, tray-hidden applications, an existing GUI login, or global shortcuts. State that dependency in `foreground_reason`. Foreground transactions can take focus and can be interrupted by user activity.

KWin ScreenShot2 captures the exact target window. Physical input uses the pre-authorized KDE RemoteDesktop portal. A foreground lease switches to the target window's existing virtual desktop, validates focus and geometry, retains focus across all transaction actions, and restores the prior desktop, active window, and cursor only while it still owns the state.

Text entry prefers AT-SPI `EditableText.SetTextContents`. Physical typing sends keysyms and does not replace the user's clipboard. Tray activation uses StatusNotifierItem D-Bus metadata.

Use `wait_for` or `act_ui.expect` for transitions. AT-SPI object/window events wake the wait; a fresh authoritative observation confirms the result.

Use `expect: { ref, gone: true }` for one element disappearing. Use `expect: { gone: true }` without `ref` for the exact root/window disappearing.
