# KDE Computer Use v2 architecture

Protocol version 2 has one public UI contract across the foreground desktop and isolated KWin sessions. The public MCP tools are `find_roots`, `observe_ui`, `search_ui`, `expand_ui`, `inspect_ui`, `act_ui`, `read_text`, and `wait_for`. Isolated lifecycle is owned by `isolated_start`, `isolated_status`, and `isolated_stop`.

## Routing contract

Isolated KWin is the default execution target for every operation that can complete in a fresh GUI profile. `find_roots` accepts exactly one routing authority: an isolated `session_id`, or a non-empty `foreground_reason` describing why the result depends on the user's existing desktop state. Missing authority and mixed authority fail before broker discovery. The bridge records the selected route on every discovered root and successor state.

Foreground authority is reserved for existing user windows or unsaved state, live Plasma and tray state, an existing GUI login that cannot be reproduced in isolation, and global shortcuts. Convenience, lower launch latency, and an app merely being open do not grant foreground authority.

## Ownership

The JavaScript bridge owns:

- `StateStore` and bounded observation lifetime
- stable root refs and observation-local element refs
- per-resource scheduling and mutation epochs
- stale-state rejection before delivery
- successor-state creation and observation diffs

The Python Linux backend owns:

- exact KWin root resolution, window snapshots, frame/buffer geometry, and ScreenShot2 capture
- AT-SPI traversal, opaque wire refs, interface capability discovery, semantic actions, and reads
- KDE RemoteDesktop and isolated KWin EIS delivery
- foreground leases, coordinate transforms, delivery evidence, and event journals
- `.desktop` application discovery and KDE StatusNotifierItem activation

The broker helper protocol is private. Every observation and root-discovery response carries `protocol_version: 2`; the JavaScript bridge fails on a mismatch.

## State and refs

Every observation stores `stateId`, `rootRef`, `resourceKey`, `epoch`, `coordinateSpace`, a complete bounded accessibility outline, and an optional window image. Window resources use `desktop-pid:<pid>`.

An `@e` ref resolves through `(stateId, lookId, wireRef)`. It cannot be used with another state. A state remains readable as historical evidence, while live reads and actions require the current resource epoch. There is no fuzzy stale-ref reacquisition.

## Transaction contract

`act_ui` executes this sequence in one resource lane:

1. Validate `stateId`, resource epoch, root identity, PID, geometry, and coordinate transform.
2. Try an AT-SPI semantic action when policy permits it.
3. Enter a foreground lease when physical delivery is required.
4. Execute every action while retaining the acquired focus.
5. Wait for an optional exact postcondition.
6. Capture the final accessibility outline, KWin window snapshot, and optional target-window image.
7. Save the complete successor state and return its diff plus compact successor metadata. `response: "full"` explicitly returns the complete outline.

Outcomes are `worked`, `didnt`, and `unknown`. AT-SPI `DoAction` success is delivery evidence. `EditableText.SetTextContents` becomes `worked` after the new text is read back. Pointer delivery and semantic press without a postcondition remain `unknown`, so the transaction does not retry them.

`expect.gone` has two explicit scopes. With `ref`, it checks that exact state-bound element. Without `ref`, it checks the exact root/window presence reported by authoritative KWin root resolution. Both scopes use events only for wakeup and confirm against live state.

`auto` may advance from semantic delivery to foreground delivery only when the semantic result is `didnt` and the backend proves that no side effect occurred.

## Events and observations

AT-SPI TextChanged, ChildrenChanged, StateChanged, and window lifecycle/geometry events are journaled by resource. Events wake a waiter. A live AT-SPI read plus a fresh final observation confirms the condition. Event delivery does not serve as result evidence by itself.

## Coordinates and foreground ownership

Public pointer coordinates are always `window-image-px`. The backend reads both AT-SPI screen and window extents, compares their offset with the selected KWin frame/buffer geometry within an explicit two-pixel tolerance, and records `accessibility_source_space` as `screen`, `window-local`, or `unavailable`. Screen and window-local extents pass through the same ScreenShot2 image transform. An unclassified source publishes no element bounds and rejects ref-based pointer delivery; explicit image coordinates remain available. A changed window id, PID, frame geometry, buffer geometry, or transform rejects old coordinates.

Before RemoteDesktop delivery, the backend selects the authorized portal stream containing the KWin screen point and subtracts that stream's compositor `position`. A point outside every authorized stream fails before input.

A `ForegroundLease` records the current virtual desktop, active window, and cursor; switches to the target window's existing desktop; activates and validates the exact window; and restores prior state only while the target remains active with unchanged geometry. The lease never changes the target window's desktop ownership.

## Text and clipboard

Text entry prefers AT-SPI `EditableText.SetTextContents`. Foreground physical typing sends RemoteDesktop keysyms and leaves the user's clipboard unchanged. An isolated session may use its private clipboard for text that the EIS keycode path cannot represent.

## Required invariants

- No public legacy tool aliases exist.
- No root discovery occurs without exactly one explicit routing authority: isolated `session_id` or justified `foreground_reason`.
- No state mutation can bypass the resource scheduler.
- No backend action accepts a public `@e` ref directly.
- No stale or cross-state ref is reacquired heuristically.
- No `unknown` pointer delivery is repeated automatically.
- No foreground coordinate is delivered without exact window and geometry validation.
- No ref-based pointer coordinate is delivered when the AT-SPI source space is unclassified or its center falls outside the observed window image.
- No foreground lease restores state after ownership changed externally.
- No semantic delivery result is reported as `worked` without independent verification or a satisfied postcondition.
