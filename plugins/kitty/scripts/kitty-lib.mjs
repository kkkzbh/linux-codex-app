import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_READ_LINES = 200;
const MAX_READ_LINES = 2_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const MAX_COMMAND_TIMEOUT_MS = 600_000;
const DEFAULT_SOCKET_TIMEOUT_MS = 5_000;
const DEFAULT_FEEDBACK_DELAY_MS = 300;
const MAX_FEEDBACK_DELAY_MS = 5_000;
const DEFAULT_QUIET_MS = 500;
const MAX_QUIET_MS = 30_000;
const SHELL_READY_DELAY_MS = 900;
const RUN_POLL_MS = 100;
const PLACEMENTS = ["current", "window", "tab", "split", "hsplit", "vsplit"];
const READ_MODES = ["screen", "scrollback", "tail", "last_cmd_output"];
const FEEDBACK_MODES = ["screen", "tail", "scrollback", "last_cmd_output"];
const WAIT_FOR_MODES = ["none", "delay", "change", "quiet", "regex"];
const LAYOUTS = ["splits", "tall", "stack", "grid", "fat"];
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGKILL"];

export const KITTY_TOOLS = [
  {
    name: "kitty_list",
    title: "List Kitty Terminals",
    description: "List numbered kitty instances, tabs, and windows so the model can choose a visible terminal target.",
    inputSchema: {
      type: "object",
      properties: {
        include_unmanaged: {
          type: "boolean",
          description: "Include user-opened kitty processes as process-only entries when no remote-control socket is registered.",
          default: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "kitty_send",
    title: "Send Input to Kitty",
    description: "Send a shell command, raw text, or key input to a numbered kitty terminal and return terminal feedback.",
    inputSchema: {
      type: "object",
      properties: {
        window_id: { type: "integer", description: "Target kitty window id." },
        short_id: { type: "string", description: "Human-visible kitty short id, such as K1. Missing targets are created automatically." },
        command: { type: "string", description: "Shell command to send. A trailing newline is added when missing." },
        text: { type: "string", description: "Raw text to send through kitty send-text." },
        key: { type: "string", description: "Key chord to send, such as ctrl+c, enter, or esc." },
        bracketed_paste: { type: "boolean", description: "Wrap text input in bracketed paste markers.", default: false },
        wait_for: {
          type: "string",
          enum: WAIT_FOR_MODES,
          description: "Feedback wait strategy after sending input.",
        },
        feedback_mode: {
          type: "string",
          enum: FEEDBACK_MODES,
          description: "Read mode used for feedback.",
          default: "screen",
        },
        feedback_delay_ms: {
          type: "integer",
          minimum: 0,
          maximum: MAX_FEEDBACK_DELAY_MS,
          description: "Delay before reading feedback for wait_for=delay.",
          default: DEFAULT_FEEDBACK_DELAY_MS,
        },
        quiet_ms: {
          type: "integer",
          minimum: 0,
          maximum: MAX_QUIET_MS,
          description: "Required stable-screen duration for wait_for=quiet.",
          default: DEFAULT_QUIET_MS,
        },
        timeout_ms: {
          type: "integer",
          minimum: 0,
          maximum: MAX_COMMAND_TIMEOUT_MS,
          description: "Maximum time to wait for change, quiet, or regex feedback.",
        },
        pattern: { type: "string", description: "Regular expression to wait for when wait_for=regex." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "kitty_read",
    title: "Read Kitty Screen",
    description: "Read the current screen, tail, scrollback, or last command output from a numbered kitty terminal.",
    inputSchema: {
      type: "object",
      properties: {
        window_id: { type: "integer", description: "Kitty window id." },
        short_id: { type: "string", description: "Human-visible kitty short id, such as K1. Missing targets are created automatically." },
        mode: {
          type: "string",
          enum: READ_MODES,
          description: "Text extent to read.",
          default: "screen",
        },
        lines: {
          type: "integer",
          minimum: 1,
          maximum: MAX_READ_LINES,
          description: "Maximum lines to return for tail or scrollback reads.",
          default: DEFAULT_READ_LINES,
        },
        ansi: { type: "boolean", description: "Preserve ANSI styling escapes.", default: false },
        include_layout: { type: "boolean", description: "Include simplified tabs/windows metadata.", default: false },
      },
      additionalProperties: false,
    },
  },
];

export function createKittyController(deps = {}) {
  const context = {
    env: deps.env ?? process.env,
    cwd: deps.cwd ?? process.cwd(),
    homedir: deps.homedir ?? os.homedir(),
    stateRoot: deps.stateRoot ?? defaultStateRoot(deps.env ?? process.env),
    runDetached: deps.runDetached ?? runDetached,
    runBuffered: deps.runBuffered ?? runBuffered,
    runWithInput: deps.runWithInput ?? runWithInput,
    waitForSocket: deps.waitForSocket ?? waitForSocket,
    sleep: deps.sleep ?? sleep,
    nowMs: deps.nowMs ?? (() => Date.now()),
    makeId: deps.makeId ?? makeId,
    socketTimeoutMs: deps.socketTimeoutMs ?? DEFAULT_SOCKET_TIMEOUT_MS,
  };

  return {
    tools: KITTY_TOOLS,
    async callTool(name, args = {}) {
      switch (name) {
        case "kitty_list":
          return await listKitty(context, args);
        case "kitty_open":
          return await openKitty(context, args);
        case "kitty_run":
          return await runCommand(context, args);
        case "kitty_read":
          return await readKitty(context, args);
        case "kitty_send":
          return await sendInput(context, args);
        case "kitty_layout":
          return await setLayout(context, args);
        case "kitty_focus":
          return await focusTarget(context, args);
        case "kitty_close":
          return await closeTarget(context, args);
        default:
          throw new Error(`Unknown Kitty tool: ${name}`);
      }
    },
  };
}

async function listKitty(context, args) {
  const registry = await readRegistry(context);
  const instances = [];

  for (const instance of registry.instances) {
    const kind = instanceKind(instance);
    if (instance.status === "closed") {
      instances.push({
        ...instance,
        kind,
        managed: kind === "managed",
        adopted: kind === "adopted",
        display_name: displayInstanceName(instance),
        selector: selectorForInstance(instance),
        controllable: false,
        reachable: false,
        tabs: [],
        windows: [],
      });
      continue;
    }

    try {
      const snapshot = await readKittySnapshot(context, instance, { timeoutMs: 5_000 });
      instances.push({
        ...instance,
        kind,
        managed: kind === "managed",
        adopted: kind === "adopted",
        display_name: displayInstanceName(instance),
        selector: selectorForInstance(instance),
        controllable: true,
        reachable: true,
        os_windows: snapshot.os_windows,
        tabs: snapshot.tabs,
        windows: snapshot.windows.map((window) => decorateWindow(instance, window)),
      });
    } catch (error) {
      instances.push({
        ...instance,
        kind,
        managed: kind === "managed",
        adopted: kind === "adopted",
        display_name: displayInstanceName(instance),
        selector: selectorForInstance(instance),
        controllable: false,
        reachable: false,
        error: error instanceof Error ? error.message : String(error),
        tabs: [],
        windows: [],
      });
    }
  }

  const unmanaged = args.include_unmanaged ? await listUnmanagedKittyProcesses(context, registry.instances) : [];
  return { ok: true, state_root: context.stateRoot, instances, unmanaged };
}

async function openKitty(context, args) {
  await ensureStateDirs(context);
  const instanceId = context.makeId("ki");
  const shortId = await allocateShortId(context, args.short_id);
  const socket = path.join(socketDir(context), `${instanceId}.sock`);
  await rm(socket, { force: true }).catch(() => {});

  const title = optionalNonEmptyString(args.title, "title") ?? "Codex Kitty";
  const cwd = args.cwd == null ? undefined : await resolveDirectory(context, args.cwd);
  const layout = optionalEnum(args.layout, "layout", LAYOUTS);
  const command = context.env.CODEX_KITTY_BIN || "kitty";
  const commandArgs = [
    "-o",
    "allow_remote_control=socket-only",
    "--listen-on",
    `unix:${socket}`,
    "--detach",
    "--title",
    title,
  ];
  if (cwd) {
    commandArgs.push("--directory", cwd);
  }

  let launch;
  try {
    launch = await context.runDetached(command, commandArgs, {
      cwd: cwd ?? context.cwd,
      env: managedKittyEnv(context, {
        CODEX_KITTY_WRAPPER_BYPASS: "1",
        CODEX_KITTY_INSTANCE_ID: instanceId,
        CODEX_KITTY_SHORT_ID: shortId,
        CODEX_KITTY_INSTANCE_KIND: "managed",
        CODEX_KITTY_SOCKET: socket,
      }),
    });
  } catch (error) {
    throw mapCommandError(command, error);
  }

  try {
    await context.waitForSocket(socket, context.socketTimeoutMs);
  } catch (error) {
    throw new Error(`socket_unreachable: managed kitty socket did not become available at ${socket}`);
  }

  const instance = {
    instance_id: instanceId,
    short_id: shortId,
    kind: "managed",
    socket,
    pid: launch.pid,
    title,
    cwd,
    status: "running",
    created_at: new Date(context.nowMs()).toISOString(),
    created_at_ms: context.nowMs(),
  };
  await upsertInstance(context, instance);

  if (layout) {
    await setLayout(context, { instance_id: instanceId, layout, tab_id: -1 });
  }

  const initialized = await withInitialWindowMetadata(context, instance).catch(() => instance);
  if (initialized !== instance) {
    await upsertInstance(context, initialized);
  }
  await setLastUsedShortId(context, initialized.short_id);

  return { ok: true, action: "open", managed: true, controllable: true, display_name: displayInstanceName(initialized), selector: selectorForInstance(initialized), ...initialized };
}

async function runCommand(context, args) {
  const command = requireNonEmptyString(args.cmd, "cmd");
  const sent = await sendInput(context, {
    ...args,
    command,
    wait_for: args.wait === false ? "none" : args.wait_for,
    timeout_ms: args.timeout_ms,
  });
  return {
    ...sent,
    action: "run_legacy",
    status: sent.feedback?.timed_out ? "timeout" : "observed",
    output: sent.feedback?.text,
    tail: sent.feedback?.text,
    exit_code: null,
  };
}

async function readKitty(context, args) {
  const runState = args.run_id ? await readRunState(context, args.run_id) : null;
  const instance = await resolveInstance(context, { instance_id: args.instance_id ?? runState?.instance_id, short_id: args.short_id }, { autoCreate: true, defaultShortId: true });
  const target = await ensureShellWindow(context, instance, { window_id: args.window_id ?? runState?.window_id, placement: "current" });
  const windowId = target.window_id;

  const mode = optionalEnum(args.mode ?? "screen", "mode", READ_MODES);
  const lines = clampInteger(args.lines, DEFAULT_READ_LINES, 1, MAX_READ_LINES);
  const read = await readWindowText(context, instance, windowId, { mode, lines, ansi: Boolean(args.ansi) });
  const response = {
    ok: true,
    action: "read",
    instance_id: instance.instance_id,
    short_id: instance.short_id,
    instance_kind: instanceKind(instance),
    run_id: runState?.run_id,
    window_id: windowId,
    mode,
    lines: mode === "screen" ? undefined : lines,
    ansi: Boolean(args.ansi),
    status: runState?.status ?? "unknown",
    exit_code: runState?.exit_code,
    target,
    text: read.text,
    truncated: read.truncated,
  };
  if (args.include_layout) {
    const snapshot = await readKittySnapshot(context, instance, { timeoutMs: 5_000 });
    response.layout = {
      tabs: snapshot.tabs,
      windows: snapshot.windows.map((window) => decorateWindow(instance, window)),
      active_window_id: snapshot.windows.find((window) => window.is_active || window.is_focused)?.id,
    };
  }
  await setLastUsedShortId(context, instance.short_id);
  return response;
}

async function sendInput(context, args) {
  const mode = resolveSendMode(args);
  if (mode.name === "regex") {
    throw new Error("internal error: regex is a wait strategy, not an input mode");
  }
  validateFeedbackArgs(args, mode.name);
  const runState = args.run_id ? await readRunState(context, args.run_id) : null;
  const instance = await resolveInstance(context, { instance_id: args.instance_id ?? runState?.instance_id, short_id: args.short_id }, { autoCreate: true, defaultShortId: true });
  const target = await ensureShellWindow(context, instance, { window_id: args.window_id ?? runState?.window_id, placement: "current" });
  const windowId = requireInteger(target.window_id, "window_id");

  const waitFor = resolveWaitFor(args, mode.name);
  const feedbackMode = optionalEnum(args.feedback_mode ?? "screen", "feedback_mode", FEEDBACK_MODES);
  const before = waitFor === "none" ? null : await readFeedbackText(context, instance, windowId, feedbackMode);
  let response;
  if (mode.name === "key") {
    await runKitten(context, instance, ["send-key", "--match", `id:${windowId}`, mode.payload], { timeoutMs: 10_000 });
    response = {
      ok: true,
      action: "send_key",
      instance_id: instance.instance_id,
      short_id: instance.short_id,
      run_id: runState?.run_id,
      window_id: windowId,
      target,
      key: mode.payload,
      sent: {
        mode: "key",
        key: mode.payload,
      },
    };
  } else {
    await sendTextToWindow(context, instance, windowId, mode.payload, { bracketedPaste: mode.name === "text" && Boolean(args.bracketed_paste) });
    response = {
      ok: true,
      action: mode.name === "command" ? "send_command" : "send_text",
      instance_id: instance.instance_id,
      short_id: instance.short_id,
      run_id: runState?.run_id,
      window_id: windowId,
      target,
      bytes: Buffer.byteLength(mode.payload, "utf8"),
      sent: {
        mode: mode.name,
        bytes: Buffer.byteLength(mode.payload, "utf8"),
      },
    };
  }

  const feedback = await readFeedbackAfterSend(context, instance, windowId, args, mode.name, waitFor, feedbackMode, before);
  if (feedback) {
    response.feedback = feedback;
  }
  await setLastUsedShortId(context, instance.short_id);
  return response;
}

function resolveSendMode(args) {
  const candidates = [
    ["command", Object.hasOwn(args, "command") && args.command != null],
    ["text", Object.hasOwn(args, "text") && args.text != null],
    ["key", Object.hasOwn(args, "key") && args.key != null],
  ].filter(([, present]) => present);
  if (candidates.length !== 1) {
    throw new Error("kitty_send requires exactly one of command, text, or key");
  }

  const [name] = candidates[0];
  if (name === "command") {
    const command = requireNonEmptyString(args.command, "command");
    return { name, payload: command.endsWith("\n") ? command : `${command}\n` };
  }
  if (name === "key") {
    return { name, payload: requireNonEmptyString(args.key, "key") };
  }
  return { name, payload: String(args.text) };
}

function resolveWaitFor(args, mode) {
  if (args.feedback === false) {
    return "none";
  }
  return optionalEnum(args.wait_for ?? (mode === "command" ? "quiet" : "delay"), "wait_for", WAIT_FOR_MODES);
}

function validateFeedbackArgs(args, mode) {
  const waitFor = resolveWaitFor(args, mode);
  if (waitFor === "regex") {
    requireNonEmptyString(args.pattern, "pattern");
    try {
      new RegExp(args.pattern);
    } catch (error) {
      throw new Error(`pattern must be a valid regular expression: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function readFeedbackAfterSend(context, instance, windowId, args, mode, waitFor, feedbackMode, before) {
  if (waitFor === "none") {
    return null;
  }

  const startedAtMs = context.nowMs();
  const defaultTimeoutMs = mode === "command" ? DEFAULT_COMMAND_TIMEOUT_MS : 5_000;
  const timeoutMs = clampInteger(args.timeout_ms, defaultTimeoutMs, 0, MAX_COMMAND_TIMEOUT_MS);
  const feedbackDelayMs = clampInteger(args.feedback_delay_ms, DEFAULT_FEEDBACK_DELAY_MS, 0, MAX_FEEDBACK_DELAY_MS);
  const quietMs = clampInteger(args.quiet_ms, DEFAULT_QUIET_MS, 0, MAX_QUIET_MS);
  const pattern = waitFor === "regex" ? new RegExp(requireNonEmptyString(args.pattern, "pattern")) : null;

  if (waitFor === "delay") {
    if (feedbackDelayMs > 0) {
      await context.sleep(feedbackDelayMs);
    }
    const after = await readFeedbackText(context, instance, windowId, feedbackMode);
    return feedbackPayload(context, waitFor, feedbackMode, before, after, { startedAtMs });
  }

  let latest = before ?? { text: "", truncated: false };
  let sawChange = false;
  let quietSinceMs = null;
  const deadline = startedAtMs + timeoutMs;

  while (context.nowMs() <= deadline) {
    const after = await readFeedbackText(context, instance, windowId, feedbackMode);
    const changedFromBefore = before ? before.text !== after.text : undefined;
    const changedFromLatest = latest.text !== after.text;
    if (changedFromBefore) {
      sawChange = true;
    }

    if (waitFor === "change" && changedFromBefore) {
      return feedbackPayload(context, waitFor, feedbackMode, before, after, { startedAtMs });
    }

    if (waitFor === "regex" && pattern.test(after.text)) {
      return feedbackPayload(context, waitFor, feedbackMode, before, after, { startedAtMs, matched: true });
    }

    if (waitFor === "quiet") {
      if (changedFromLatest) {
        quietSinceMs = context.nowMs();
      } else if (sawChange && quietSinceMs != null && context.nowMs() - quietSinceMs >= quietMs) {
        return feedbackPayload(context, waitFor, feedbackMode, before, after, { startedAtMs });
      }
    }

    latest = after;
    await context.sleep(RUN_POLL_MS);
  }

  return feedbackPayload(context, waitFor, feedbackMode, before, latest, {
    startedAtMs,
    timedOut: true,
    matched: waitFor === "regex" && pattern ? pattern.test(latest.text) : false,
  });
}

async function readFeedbackText(context, instance, windowId, feedbackMode) {
  return await readWindowText(context, instance, windowId, { mode: feedbackMode, lines: DEFAULT_READ_LINES, ansi: false }).catch((error) => ({
    text: "",
    truncated: false,
    read_error: error instanceof Error ? error.message : String(error),
  }));
}

function feedbackPayload(context, waitFor, feedbackMode, before, after, options = {}) {
  return {
    wait_for: waitFor,
    mode: feedbackMode,
    text: after.text,
    truncated: after.truncated,
    changed: before ? before.text !== after.text : undefined,
    matched: Boolean(options.matched),
    timed_out: Boolean(options.timedOut),
    elapsed_ms: options.startedAtMs == null ? undefined : Math.max(0, context.nowMs() - options.startedAtMs),
    read_error: after.read_error,
  };
}

async function setLayout(context, args) {
  const instance = await resolveInstance(context, args, { autoCreate: false });
  const layout = requireEnum(args.layout, "layout", LAYOUTS);
  const match = layoutTabMatch(args);
  await runKitten(context, instance, ["goto-layout", "--match", match, layout], { timeoutMs: 10_000 });
  return { ok: true, action: "layout", instance_id: instance.instance_id, short_id: instance.short_id, match, layout };
}

async function focusTarget(context, args) {
  const instance = await resolveInstance(context, args, { autoCreate: false });
  const windowId = args.window_id == null ? null : requireInteger(args.window_id, "window_id");
  const tabId = args.tab_id == null ? null : requireInteger(args.tab_id, "tab_id");
  if ((windowId == null) === (tabId == null)) {
    throw new Error("kitty_focus requires exactly one of window_id or tab_id");
  }

  if (windowId != null) {
    await runKitten(context, instance, ["focus-window", "--match", `id:${windowId}`], { timeoutMs: 10_000 });
    return { ok: true, action: "focus_window", instance_id: instance.instance_id, short_id: instance.short_id, window_id: windowId };
  }

  await runKitten(context, instance, ["focus-tab", "--match", `id:${tabId}`], { timeoutMs: 10_000 });
  return { ok: true, action: "focus_tab", instance_id: instance.instance_id, short_id: instance.short_id, tab_id: tabId };
}

async function closeTarget(context, args) {
  const runState = args.run_id ? await readRunState(context, args.run_id) : null;
  const instance = await resolveInstance(context, { instance_id: args.instance_id ?? runState?.instance_id, short_id: args.short_id }, { autoCreate: false });
  const signal = optionalEnum(args.signal, "signal", SIGNALS);
  const windowId = args.window_id ?? runState?.window_id;
  const tabId = args.tab_id;

  if (signal) {
    if (windowId == null) {
      throw new Error("kitty_close signal requires run_id or window_id");
    }
    await runKitten(context, instance, ["signal-child", "--match", `id:${windowId}`, signal], { timeoutMs: 10_000 });
  }

  if (windowId != null) {
    await runKitten(context, instance, ["close-window", "--match", `id:${requireInteger(windowId, "window_id")}`], { timeoutMs: 10_000 });
    return { ok: true, action: "close_window", instance_id: instance.instance_id, short_id: instance.short_id, run_id: runState?.run_id, window_id: windowId, signal };
  }

  if (tabId != null) {
    await runKitten(context, instance, ["close-tab", "--match", `id:${requireInteger(tabId, "tab_id")}`], { timeoutMs: 10_000 });
    return { ok: true, action: "close_tab", instance_id: instance.instance_id, short_id: instance.short_id, tab_id: tabId };
  }

  if (args.instance_id != null || args.short_id != null) {
    if (instanceKind(instance) === "adopted") {
      throw new Error("refusing to close adopted kitty instance; close a specific run, window, or tab instead");
    }
    await runKitten(context, instance, ["close-window", "--match", "all"], { timeoutMs: 10_000 });
    await upsertInstance(context, { ...instance, status: "closed", closed_at: new Date(context.nowMs()).toISOString(), closed_at_ms: context.nowMs() });
    return { ok: true, action: "close_instance", instance_id: instance.instance_id, short_id: instance.short_id };
  }

  throw new Error("kitty_close requires run_id, window_id, tab_id, or instance_id");
}

async function resolveInstance(context, selector = {}, options = {}) {
  const registry = await readRegistry(context);
  const instanceId = typeof selector === "string" ? selector : selector.instance_id;
  const shortId = normalizeOptionalShortId(typeof selector === "string" ? undefined : selector.short_id)
    ?? (options.defaultShortId ? normalizeOptionalShortId(registry.last_used_short_id) ?? "K1" : undefined);
  if (instanceId || shortId) {
    const matches = registry.instances.filter((candidate) =>
      instanceId ? candidate.instance_id === instanceId : candidate.short_id === shortId,
    );
    const instance = matches.find((candidate) => candidate.status !== "closed") ?? matches[0];
    if (!instance) {
      if (shortId && options.autoCreate) {
        const opened = await openKitty(context, { short_id: shortId, title: `Codex Kitty ${shortId}` });
        return publicInstanceFromOpen(opened, true);
      }
      throw new Error(`socket_unreachable: unknown kitty instance ${instanceId ?? shortId}`);
    }
    if (instance.status === "closed" && shortId && options.autoCreate) {
      const opened = await openKitty(context, { short_id: shortId, title: `Codex Kitty ${shortId}` });
      return publicInstanceFromOpen(opened, true);
    }
    if (shortId && options.autoCreate) {
      try {
        await ensureSocketReachable(instance.socket);
      } catch (error) {
        if (!processAlive(instance.pid)) {
          await upsertInstance(context, { ...instance, status: "closed", closed_at: new Date(context.nowMs()).toISOString(), closed_at_ms: context.nowMs() });
          const opened = await openKitty(context, { short_id: shortId, title: `Codex Kitty ${shortId}` });
          return publicInstanceFromOpen(opened, true);
        }
        throw error;
      }
    }
    return instance;
  }

  const active = registry.instances.filter((candidate) => candidate.status !== "closed");
  const managed = active.filter((candidate) => instanceKind(candidate) === "managed");
  const adopted = active.filter((candidate) => instanceKind(candidate) === "adopted");

  if (managed.length === 1) {
    return managed[0];
  }
  if (managed.length > 1) {
    throw ambiguousInstanceError("multiple managed kitty instances are available", managed);
  }
  if (adopted.length === 1) {
    return adopted[0];
  }
  if (adopted.length > 1) {
    throw ambiguousInstanceError("multiple adopted kitty instances are available", adopted);
  }

  if (options.autoCreate) {
    const opened = await openKitty(context, { short_id: "K1", title: "Codex Kitty K1" });
    return publicInstanceFromOpen(opened, true);
  }

  throw new Error("socket_unreachable: no managed kitty instance is registered");
}

function publicInstanceFromOpen(opened, autoCreated = false) {
  return {
    instance_id: opened.instance_id,
    short_id: opened.short_id,
    socket: opened.socket,
    pid: opened.pid,
    title: opened.title,
    cwd: opened.cwd,
    kind: opened.kind,
    status: opened.status,
    initial_window_id: opened.initial_window_id,
    initial_tab_id: opened.initial_tab_id,
    default_window_id: opened.default_window_id,
    created_at: opened.created_at,
    created_at_ms: opened.created_at_ms,
    _auto_created: autoCreated,
  };
}

async function runKitten(context, instance, args, options = {}) {
  await ensureSocketReachable(instance.socket);
  const command = context.env.CODEX_KITTEN_BIN || "kitten";
  try {
    return await context.runBuffered(command, ["@", "--to", `unix:${instance.socket}`, ...args], options);
  } catch (error) {
    throw mapKittenError(command, instance.socket, error);
  }
}

async function runKittenInput(context, instance, args, input, options = {}) {
  await ensureSocketReachable(instance.socket);
  const command = context.env.CODEX_KITTEN_BIN || "kitten";
  try {
    return await context.runWithInput(command, ["@", "--to", `unix:${instance.socket}`, ...args], input, options);
  } catch (error) {
    throw mapKittenError(command, instance.socket, error);
  }
}

function parseKittyJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [];
}

async function readKittySnapshot(context, instance, options = {}) {
  const result = await runKitten(context, instance, ["ls"], options);
  const osWindows = parseKittyJson(result.stdout);
  return {
    os_windows: osWindows,
    tabs: normalizeTabs(osWindows),
    windows: normalizeWindows(osWindows),
  };
}

async function ensureShellWindow(context, instance, args = {}) {
  if (args.window_id != null) {
    const windowId = requireInteger(args.window_id, "window_id");
    const snapshot = await readKittySnapshot(context, instance, { timeoutMs: 5_000 }).catch(() => null);
    const window = snapshot?.windows.find((candidate) => candidate.id === windowId);
    return targetForWindow(instance, window ?? { id: windowId });
  }

  const placement = optionalEnum(args.placement ?? "current", "placement", PLACEMENTS);
  if (placement !== "current") {
    return await launchShellWindow(context, instance, args, placement);
  }

  const snapshot = await readKittySnapshot(context, instance, { timeoutMs: 5_000 });
  const preferred = snapshot.windows.find((window) => Number.isInteger(instance.default_window_id) && window.id === instance.default_window_id)
    ?? snapshot.windows.find((window) => Number.isInteger(instance.initial_window_id) && window.id === instance.initial_window_id)
    ?? snapshot.windows.find((window) => window.is_focused || window.is_active)
    ?? snapshot.windows[0];
  if (!preferred) {
    return await launchShellWindow(context, instance, args, "window");
  }
  if (instance._auto_created && preferred.id === instance.initial_window_id) {
    await context.sleep(SHELL_READY_DELAY_MS);
  }
  await rememberDefaultWindow(context, instance, preferred.id);
  return targetForWindow(instance, preferred);
}

async function launchShellWindow(context, instance, args, placement) {
  if (["split", "hsplit", "vsplit"].includes(placement)) {
    await setLayout(context, { instance_id: instance.instance_id, layout: "splits", tab_id: -1 });
  }

  const cwd = args.cwd == null ? instance.cwd ?? context.cwd : await resolveDirectory(context, args.cwd);
  const title = optionalNonEmptyString(args.title, "title") ?? `Codex Kitty ${instance.short_id ?? ""}`.trim();
  const launchArgs = [
    "launch",
    "--type",
    placement === "tab" ? "tab" : "window",
    "--title",
    title,
    "--cwd",
    cwd,
    "--env",
    `CODEX_KITTY_INSTANCE_ID=${instance.instance_id}`,
    "--env",
    `CODEX_KITTY_INSTANCE_KIND=${instanceKind(instance)}`,
    "--env",
    `CODEX_KITTY_SOCKET=${instance.socket}`,
  ];
  if (instance.short_id) {
    launchArgs.push("--env", `CODEX_KITTY_SHORT_ID=${instance.short_id}`);
  }
  const location = placementLocation(placement);
  if (location) {
    launchArgs.push("--location", location);
  }

  const launch = await runKitten(context, instance, launchArgs, { timeoutMs: 10_000 });
  const windowId = parseWindowId(launch.stdout);
  await context.sleep(SHELL_READY_DELAY_MS);
  const snapshot = await readKittySnapshot(context, instance, { timeoutMs: 5_000 }).catch(() => null);
  const window = snapshot?.windows.find((candidate) => candidate.id === windowId) ?? { id: windowId, title, cwd };
  await rememberDefaultWindow(context, instance, windowId);
  return targetForWindow(instance, window);
}

async function rememberDefaultWindow(context, instance, windowId) {
  const updated = { ...stripInternalInstanceFields(instance), default_window_id: windowId };
  await upsertInstance(context, updated);
}

function targetForWindow(instance, window) {
  return {
    short_id: instance.short_id,
    instance_id: instance.instance_id,
    instance_kind: instanceKind(instance),
    window_id: window.id,
    tab_id: window.tab_id,
    title: window.title,
    cwd: window.cwd,
    cmdline: window.cmdline,
    focused: Boolean(window.is_focused),
    active: Boolean(window.is_active),
  };
}

async function sendTextToWindow(context, instance, windowId, text, options = {}) {
  const commandArgs = ["send-text", "--match", `id:${windowId}`, "--stdin"];
  if (options.bracketedPaste) {
    commandArgs.push("--bracketed-paste=enable");
  }
  await runKittenInput(context, instance, commandArgs, text, { timeoutMs: 10_000 });
}

async function readWindowText(context, instance, windowId, args = {}) {
  const mode = optionalEnum(args.mode ?? "screen", "mode", READ_MODES);
  const lines = clampInteger(args.lines, DEFAULT_READ_LINES, 1, MAX_READ_LINES);
  const extent = mode === "screen" ? "screen" : mode === "last_cmd_output" ? "last_cmd_output" : "all";
  const commandArgs = ["get-text", "--match", `id:${windowId}`, "--extent", extent];
  if (args.ansi) {
    commandArgs.push("--ansi");
  }
  const result = await runKitten(context, instance, commandArgs, { timeoutMs: 10_000 });
  const selected = mode === "screen" ? result.stdout : limitTextLines(result.stdout, lines);
  const text = typeof selected === "string" ? selected : selected.text;
  const truncated = typeof selected === "string" ? false : selected.truncated;
  return { text, truncated };
}

function normalizeTabs(osWindows) {
  const tabs = [];
  for (const osWindow of osWindows) {
    for (const tab of osWindow.tabs ?? []) {
      tabs.push({
        id: tab.id,
        title: tab.title,
        layout: tab.layout,
        is_active: tab.is_active,
        os_window_id: osWindow.id,
        active_window_id: tab.active_window_history?.[0],
      });
    }
  }
  return tabs;
}

function normalizeWindows(osWindows) {
  const windows = [];
  for (const osWindow of osWindows) {
    for (const tab of osWindow.tabs ?? []) {
      for (const window of tab.windows ?? []) {
        windows.push({
          id: window.id,
          title: window.title,
          cwd: window.cwd,
          pid: window.pid,
          cmdline: window.cmdline,
          is_active: window.is_active,
          is_focused: window.is_focused,
          tab_id: tab.id,
          tab_title: tab.title,
          os_window_id: osWindow.id,
        });
      }
    }
  }
  return windows;
}

function displayInstanceName(instance) {
  const marker = instance.short_id ? `[${instance.short_id}] ` : "";
  const title = instance.title || instance.instance_id || "kitty";
  return `${marker}${title} (${instanceKind(instance)})`;
}

function managedKittyEnv(context, extra = {}) {
  const env = { ...context.env };

  // Codex often runs with non-interactive terminal hints. A visible kitty should
  // behave like a user-opened terminal, so do not pass those hints through.
  delete env.NO_COLOR;
  if (env.TERM === "dumb") {
    delete env.TERM;
  }
  if (env.COLORTERM === "") {
    delete env.COLORTERM;
  }
  if (env.CLICOLOR === "0") {
    delete env.CLICOLOR;
  }
  if (env.CLICOLOR_FORCE === "0") {
    delete env.CLICOLOR_FORCE;
  }
  if (env.FORCE_COLOR === "0") {
    delete env.FORCE_COLOR;
  }
  if (env.LS_COLORS === "") {
    delete env.LS_COLORS;
  }

  return { ...env, ...extra };
}

function selectorForInstance(instance) {
  return instance.short_id ? { short_id: instance.short_id } : { instance_id: instance.instance_id };
}

function decorateWindow(instance, window) {
  const selector = { ...selectorForInstance(instance), window_id: window.id };
  return {
    ...window,
    selector,
    display_name: `${instance.short_id ? `[${instance.short_id}] ` : ""}window ${window.id}: ${window.title || window.cwd || "kitty"}`,
  };
}

async function withInitialWindowMetadata(context, instance) {
  const snapshot = await readKittySnapshot(context, instance, { timeoutMs: 5_000 });
  const activeWindow = snapshot.windows.find((window) => window.is_active || window.is_focused) ?? snapshot.windows[0];
  if (!activeWindow) {
    return instance;
  }
  return {
    ...instance,
    initial_window_id: activeWindow.id,
    initial_tab_id: activeWindow.tab_id,
  };
}

async function initialWindowForRunCleanup(context, instance) {
  if (instanceKind(instance) !== "managed") {
    return null;
  }
  if (Number.isInteger(instance.initial_window_id)) {
    return instance.initial_window_id;
  }

  try {
    const snapshot = await readKittySnapshot(context, instance, { timeoutMs: 5_000 });
    if (snapshot.windows.length === 1) {
      return snapshot.windows[0].id;
    }
  } catch {
    return null;
  }

  return null;
}

async function closeInitialWindowAfterLaunch(context, instance, initialWindowId, launchedWindowId) {
  if (!Number.isInteger(initialWindowId) || initialWindowId === launchedWindowId || instanceKind(instance) !== "managed") {
    return null;
  }

  try {
    await runKitten(context, instance, ["close-window", "--match", `id:${initialWindowId}`], { timeoutMs: 10_000 });
    const registryInstance = stripInternalInstanceFields(instance);
    await upsertInstance(context, {
      ...registryInstance,
      initial_window_id: null,
      initial_window_closed_at: new Date(context.nowMs()).toISOString(),
      initial_window_closed_at_ms: context.nowMs(),
    });
    return initialWindowId;
  } catch {
    return null;
  }
}

function stripInternalInstanceFields(instance) {
  const { _auto_created, ...publicInstance } = instance;
  return publicInstance;
}

async function listUnmanagedKittyProcesses(context, managedInstances) {
  try {
    const result = await context.runBuffered("pgrep", ["-a", "kitty"], { timeoutMs: 5_000, allowNonZero: true });
    const managedPids = new Set(managedInstances.map((instance) => Number(instance.pid)).filter(Number.isFinite));
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [pidText, ...rest] = line.split(/\s+/);
        return {
          pid: Number(pidText),
          command: rest.join(" "),
          managed: managedPids.has(Number(pidText)),
          controllable: false,
          reason: "no registered remote-control socket",
        };
      })
      .filter((entry) => !entry.managed);
  } catch (error) {
    return [
      {
        controllable: false,
        error: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

async function readRunState(context, runId) {
  const statusFile = path.join(runDir(context), `${requireNonEmptyString(runId, "run_id")}.json`);
  let state;
  try {
    state = JSON.parse(await readFile(statusFile, "utf8"));
  } catch (error) {
    throw new Error(`run_status_unknown: ${runId}`);
  }

  if (state.result_file) {
    const result = await readOptionalJson(state.result_file);
    if (result) {
      state = { ...state, ...result };
      await writeJsonAtomic(statusFile, state);
    }
  }
  return state;
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function placementLocation(placement) {
  switch (placement) {
    case "split":
      return "split";
    case "hsplit":
      return "hsplit";
    case "vsplit":
      return "vsplit";
    default:
      return null;
  }
}

function layoutTabMatch(args) {
  if (args.window_id != null) {
    return `window_id:${requireInteger(args.window_id, "window_id")}`;
  }
  if (args.tab_id != null) {
    return `id:${requireInteger(args.tab_id, "tab_id")}`;
  }
  return "id:-1";
}

function parseWindowId(stdout) {
  const value = stdout.trim().split(/\s+/).find(Boolean);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`window_not_found: kitty launch did not return a window id: ${stdout.trim()}`);
  }
  return parsed;
}

function limitTextLines(text, maxLines) {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return { text, truncated: false };
  }
  return { text: lines.slice(-maxLines).join("\n"), truncated: true };
}

async function ensureStateDirs(context) {
  await mkdir(context.stateRoot, { recursive: true, mode: 0o700 });
  await mkdir(socketDir(context), { recursive: true, mode: 0o700 });
  await mkdir(runDir(context), { recursive: true, mode: 0o700 });
}

function socketDir(context) {
  return path.join(context.stateRoot, "sockets");
}

function runDir(context) {
  return path.join(context.stateRoot, "runs");
}

function registryPath(context) {
  return path.join(context.stateRoot, "instances.json");
}

async function readRegistry(context) {
  try {
    const registry = JSON.parse(await readFile(registryPath(context), "utf8"));
    return {
      version: 1,
      last_used_short_id: normalizeOptionalShortId(registry.last_used_short_id),
      instances: Array.isArray(registry.instances) ? registry.instances : [],
    };
  } catch {
    return { version: 1, instances: [] };
  }
}

function instanceKind(instance) {
  return instance?.kind === "adopted" ? "adopted" : "managed";
}

function ambiguousInstanceError(message, instances) {
  const candidates = instances.map((instance) => ({
    instance_id: instance.instance_id,
    short_id: instance.short_id,
    kind: instanceKind(instance),
    display_name: displayInstanceName(instance),
    selector: selectorForInstance(instance),
    title: instance.title,
    cwd: instance.cwd,
    status: instance.status,
  }));
  return new Error(`${message}; specify instance_id or short_id. Candidates: ${JSON.stringify(candidates)}`);
}

async function allocateShortId(context, requestedShortId) {
  await ensureStateDirs(context);
  const requested = normalizeOptionalShortId(requestedShortId);
  const registry = await readRegistry(context);
  const used = new Set(
    registry.instances
      .filter((instance) => instance.status !== "closed")
      .map((instance) => instance.short_id)
      .filter(Boolean),
  );

  if (requested) {
    if (used.has(requested)) {
      throw new Error(`short_id_unavailable: ${requested} is already registered`);
    }
    return requested;
  }

  for (let index = 1; index < 100; index += 1) {
    const candidate = `K${index}`;
    if (used.has(candidate)) {
      continue;
    }
    try {
      await access(path.join(context.stateRoot, "adopted", `${candidate}.sock`), fsConstants.F_OK);
      continue;
    } catch {
      return candidate;
    }
  }

  throw new Error("no available Codex Kitty short id K1..K99");
}

async function upsertInstance(context, instance) {
  await ensureStateDirs(context);
  const registry = await readRegistry(context);
  const instances = registry.instances.filter((candidate) => candidate.instance_id !== instance.instance_id);
  instances.push(instance);
  await writeJsonAtomic(registryPath(context), { version: 1, last_used_short_id: registry.last_used_short_id, instances });
}

async function setLastUsedShortId(context, shortId) {
  const normalized = normalizeOptionalShortId(shortId);
  if (!normalized) {
    return;
  }
  await ensureStateDirs(context);
  const registry = await readRegistry(context);
  await writeJsonAtomic(registryPath(context), { ...registry, last_used_short_id: normalized });
}

async function writeJsonAtomic(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await rename(tmpPath, filePath);
}

async function ensureSocketReachable(socket) {
  try {
    await access(socket, fsConstants.R_OK | fsConstants.W_OK);
  } catch {
    throw new Error(`socket_unreachable: kitty remote-control socket is unavailable: ${socket}`);
  }
}

function normalizeOptionalShortId(value) {
  if (value == null || value === "") {
    return undefined;
  }
  const text = String(value).trim().toUpperCase();
  if (!/^K([1-9][0-9]?)$/.test(text)) {
    throw new Error("short_id must be K1..K99");
  }
  return text;
}

function processAlive(pid) {
  const parsed = Number(pid);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return false;
  }
  try {
    process.kill(parsed, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function waitForSocket(socket, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      await ensureSocketReachable(socket);
      return true;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`socket_unreachable: ${socket}`);
}

async function resolveDirectory(context, value) {
  const resolved = path.resolve(context.cwd, requireNonEmptyString(value, "cwd"));
  const stat = await lstat(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolved}`);
  }
  return resolved;
}

function defaultStateRoot(env) {
  if (env.CODEX_KITTY_STATE_DIR) {
    return path.resolve(env.CODEX_KITTY_STATE_DIR);
  }
  if (env.XDG_RUNTIME_DIR) {
    return path.join(env.XDG_RUNTIME_DIR, "codex-kitty");
  }
  return path.join(os.tmpdir(), `codex-kitty-${getUid()}`);
}

function getUid() {
  return typeof process.getuid === "function" ? process.getuid() : os.userInfo().username;
}

function makeId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function optionalNonEmptyString(value, name) {
  if (value == null) {
    return undefined;
  }
  return requireNonEmptyString(value, name);
}

function optionalEnum(value, name, allowed) {
  if (value == null) {
    return undefined;
  }
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function requireEnum(value, name, allowed) {
  if (value == null) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return optionalEnum(value, name, allowed);
}

function requireInteger(value, name) {
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
  return value;
}

function clampInteger(value, fallback, min, max) {
  const candidate = value == null ? fallback : Number(value);
  if (!Number.isInteger(candidate)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, candidate));
}

function mapCommandError(command, error) {
  if (error?.code === "ENOENT") {
    if (path.basename(command) === "kitty") {
      return new Error("kitty_not_found: kitty command is not available");
    }
    return new Error(`command_not_found: ${command}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function mapKittenError(command, socket, error) {
  if (error?.code === "ENOENT") {
    return new Error("kitten_not_found: kitten command is not available");
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("No such file") || message.includes("Connection refused")) {
    return new Error(`socket_unreachable: kitty remote-control socket is unavailable: ${socket}`);
  }
  if (message.toLowerCase().includes("remote control") && message.toLowerCase().includes("disabled")) {
    return new Error(`remote_control_disabled: kitty remote control is disabled for socket ${socket}`);
  }
  return new Error(message);
}

function runDetached(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: true,
      env: spawnEnv(options),
      stdio: "ignore",
    });

    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("spawn", () => {
      if (!settled) {
        settled = true;
        child.unref();
        resolve({ pid: child.pid });
      }
    });
  });
}

function runBuffered(command, args = [], options = {}) {
  return runProcess(command, args, "", options);
}

function runWithInput(command, args = [], input = "", options = {}) {
  return runProcess(command, args, input, options);
}

function runProcess(command, args, input, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: spawnEnv(options),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timeoutMs = options.timeoutMs ?? 10_000;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`Command timed out: ${command}`));
      }
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code === 0 || options.allowNonZero) {
        resolve({ stdout, stderr, code });
        return;
      }
      reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}${stderr ? `\n${stderr}` : ""}`));
    });

    child.stdin.end(input);
  });
}

function spawnEnv(options = {}) {
  return options.env ?? process.env;
}
