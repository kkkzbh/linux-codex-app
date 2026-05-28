---
name: kitty
description: Use managed or adopted kitty terminals for Linux command runs, terminal output inspection, layouts, focus, and explicit interactive input through kitty remote-control sockets.
---

# Kitty

Use the kitty tools when the user wants Codex to open or manage a visible local kitty terminal on Linux.

Prefer `kitty_run` for commands. It creates a controlled terminal target and returns a run/window handle. Read output with `kitty_read`.

If the user asks to open a kitty and immediately run a single visible command, call `kitty_run` directly instead of calling `kitty_open` first. When you already opened a fresh managed kitty and want the command to be the only visible kitty window, pass `close_empty_initial: true`.

Use `kitty_send` only for explicit interaction with an already running terminal program, such as sending `q`, `ctrl+c`, or text to a shell prompt. Do not use it as the default way to run commands.

When the user refers to a visible marker such as `[K1]`, pass that value as `short_id`. `kitty_list` returns display names and selector objects; use those selectors when choosing a target. If multiple kitty instances are available and the user did not specify one, do not guess.

Do not assume old user-opened kitty windows are controllable. The plugin controls managed kitty instances and future user-opened kitty launches adopted by the Codex wrapper.
