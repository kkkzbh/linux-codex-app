---
name: kitty
description: Use numbered managed or adopted kitty terminals for listing terminal windows, unified terminal input, and screen inspection.
---

# Kitty

Use the kitty tools when the user wants Codex to use a visible local kitty terminal on Linux.

Use `kitty_list` before choosing among existing numbered terminals, when the user asks what kitty windows exist, or after creating a split/window/tab so you can report the new window id. Treat `short_id` such as `K1` as the user-facing selector.

Use `kitty_send` for all terminal input. It has three mutually exclusive modes:

- `command`: shell commands. Example: `kitty_send({ "short_id": "K1", "command": "pwd" })`. A newline is added automatically, the default wait strategy is `quiet`, and the visible terminal shows only the real command and output.
- `text`: raw text for interactive programs, ssh, tmux, vim/nvim, prompts, and REPLs. Example: `kitty_send({ "short_id": "K1", "text": "i" })`.
- `key`: key chords such as `ctrl+c`, `enter`, or `esc`. Example: `kitty_send({ "short_id": "K1", "key": "ctrl+c" })`.

`kitty_send` returns terminal feedback, not process-level stdout/stderr/exit code. If a command's status matters, inspect the output and, when needed, send another command such as `echo $?`.

Use `wait_for` to control feedback: `delay`, `change`, `quiet`, `regex`, or `none`. Prefer `quiet` for ordinary shell commands, `regex` when waiting for a known prompt or phrase, and `delay` for TUI or raw interaction.

Use `kitty_read` to inspect what a numbered terminal currently looks like without sending input. Prefer `mode: "screen"` when the user asks what is visible, `tail` for logs, and `include_layout: true` when window metadata matters.

Do not expect `kitty_send` to know when remote ssh commands, tmux pane commands, or TUI actions have completed. In those contexts, use `text` or `key`, read the screen feedback, and continue interactively.

Do not use hidden open/run/layout/focus/close helpers as the model workflow. The model-facing kitty interface is `kitty_list`, `kitty_send`, and `kitty_read`.
