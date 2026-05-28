import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_READ_LINES = 200;
const MAX_READ_LINES = 2_000;
const DEFAULT_TAIL_LINES = 120;
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const MAX_COMMAND_TIMEOUT_MS = 600_000;
const DEFAULT_SOCKET_TIMEOUT_MS = 5_000;
const RUN_POLL_MS = 100;
const PLACEMENTS = ["window", "tab", "split", "hsplit", "vsplit"];
const READ_MODES = ["screen", "scrollback", "tail", "last_cmd_output"];
const LAYOUTS = ["splits", "tall", "stack", "grid", "fat"];
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGKILL"];

export const KITTY_TOOLS = [
  {
    name: "kitty_list",
    title: "List Kitty Terminals",
    description: "List managed kitty instances, tabs, and windows. Optionally include process-only unmanaged kitty discovery.",
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
    name: "kitty_open",
    title: "Open Managed Kitty",
    description: "Open a managed kitty instance with a private remote-control Unix socket.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "OS window title for the managed kitty instance." },
        cwd: { type: "string", description: "Working directory for the initial kitty shell." },
        layout: {
          type: "string",
          enum: LAYOUTS,
          description: "Initial kitty layout to apply after the remote-control socket is available.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "kitty_run",
    title: "Run Command in Kitty",
    description: "Run a shell command in a new controlled kitty tab, window, or split and return a run/window handle.",
    inputSchema: {
      type: "object",
      properties: {
        cmd: { type: "string", description: "Shell command to run." },
        cwd: { type: "string", description: "Working directory for the command. Relative paths resolve from the MCP server cwd." },
        instance_id: { type: "string", description: "Kitty instance id. If omitted, a unique managed/adopted instance is selected or a new managed instance is opened." },
        short_id: { type: "string", description: "Human-visible kitty short id, such as K1." },
        placement: {
          type: "string",
          enum: PLACEMENTS,
          description: "Where to create the command terminal.",
          default: "window",
        },
        title: { type: "string", description: "Window title for the command terminal." },
        wait: { type: "boolean", description: "Wait for the command to exit and return a tail of output.", default: false },
        timeout_ms: {
          type: "integer",
          minimum: 1,
          maximum: MAX_COMMAND_TIMEOUT_MS,
          description: "Maximum time to wait when wait is true.",
          default: DEFAULT_COMMAND_TIMEOUT_MS,
        },
        tail_lines: {
          type: "integer",
          minimum: 1,
          maximum: MAX_READ_LINES,
          description: "Tail lines to return when wait is true.",
          default: DEFAULT_TAIL_LINES,
        },
        close_empty_initial: {
          type: "boolean",
          description: "Close the initial idle shell window after launching the run. Defaults to true only when kitty_run opens a new managed instance automatically.",
        },
      },
      required: ["cmd"],
      additionalProperties: false,
    },
  },
  {
    name: "kitty_read",
    title: "Read Kitty Output",
    description: "Read screen, scrollback, tail, or last command output from a managed or adopted kitty window.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string", description: "Run id returned by kitty_run." },
        window_id: { type: "integer", description: "Kitty window id." },
        instance_id: { type: "string", description: "Kitty instance id." },
        short_id: { type: "string", description: "Human-visible kitty short id, such as K1." },
        mode: {
          type: "string",
          enum: READ_MODES,
          description: "Text extent to read.",
          default: "tail",
        },
        lines: {
          type: "integer",
          minimum: 1,
          maximum: MAX_READ_LINES,
          description: "Maximum lines to return for tail or scrollback reads.",
          default: DEFAULT_READ_LINES,
        },
        ansi: { type: "boolean", description: "Preserve ANSI styling escapes.", default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: "kitty_send",
    title: "Send Input to Kitty",
    description: "Send explicit text or key input to a managed or adopted kitty window.",
    inputSchema: {
      type: "object",
      properties: {
        window_id: { type: "integer", description: "Target kitty window id." },
        run_id: { type: "string", description: "Run id returned by kitty_run. May be used instead of window_id." },
        instance_id: { type: "string", description: "Kitty instance id." },
        short_id: { type: "string", description: "Human-visible kitty short id, such as K1." },
        text: { type: "string", description: "Text to send through stdin to kitty send-text." },
        key: { type: "string", description: "Key chord to send, such as ctrl+c or enter." },
        bracketed_paste: { type: "boolean", description: "Wrap text in bracketed paste markers.", default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: "kitty_layout",
    title: "Set Kitty Layout",
    description: "Set a kitty layout on a managed or adopted kitty tab.",
    inputSchema: {
      type: "object",
      properties: {
        tab_id: { type: "integer", description: "Kitty tab id." },
        window_id: { type: "integer", description: "Window id whose parent tab should receive the layout." },
        instance_id: { type: "string", description: "Kitty instance id." },
        short_id: { type: "string", description: "Human-visible kitty short id, such as K1." },
        layout: { type: "string", enum: LAYOUTS, description: "Kitty layout name." },
      },
      required: ["layout"],
      additionalProperties: false,
    },
  },
  {
    name: "kitty_focus",
    title: "Focus Kitty Target",
    description: "Focus a managed or adopted kitty window or tab.",
    inputSchema: {
      type: "object",
      properties: {
        window_id: { type: "integer", description: "Kitty window id to focus." },
        tab_id: { type: "integer", description: "Kitty tab id to focus." },
        instance_id: { type: "string", description: "Kitty instance id." },
        short_id: { type: "string", description: "Human-visible kitty short id, such as K1." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "kitty_close",
    title: "Close Kitty Target",
    description: "Close a managed kitty run, window, tab, or instance. Optionally signal a foreground child before closing.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string", description: "Run id returned by kitty_run." },
        window_id: { type: "integer", description: "Kitty window id to close." },
        tab_id: { type: "integer", description: "Kitty tab id to close." },
        instance_id: { type: "string", description: "Kitty instance id." },
        short_id: { type: "string", description: "Human-visible kitty short id, such as K1." },
        signal: {
          type: "string",
          enum: SIGNALS,
          description: "Signal to send to the foreground child before closing a run/window.",
        },
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
  const shortId = await allocateShortId(context);
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
      env: {
        ...context.env,
        CODEX_KITTY_WRAPPER_BYPASS: "1",
        CODEX_KITTY_INSTANCE_ID: instanceId,
        CODEX_KITTY_SHORT_ID: shortId,
        CODEX_KITTY_INSTANCE_KIND: "managed",
        CODEX_KITTY_SOCKET: socket,
      },
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

  return { ok: true, action: "open", managed: true, controllable: true, display_name: displayInstanceName(initialized), selector: selectorForInstance(initialized), ...initialized };
}

async function runCommand(context, args) {
  const commandText = requireNonEmptyString(args.cmd, "cmd");
  const placement = optionalEnum(args.placement ?? "window", "placement", PLACEMENTS);
  const wait = Boolean(args.wait);
  const timeoutMs = clampInteger(args.timeout_ms, DEFAULT_COMMAND_TIMEOUT_MS, 1, MAX_COMMAND_TIMEOUT_MS);
  const tailLines = clampInteger(args.tail_lines, DEFAULT_TAIL_LINES, 1, MAX_READ_LINES);
  const instance = await resolveInstance(context, args, { autoCreate: true });
  const closeEmptyInitial = args.close_empty_initial == null ? Boolean(instance._auto_created) : Boolean(args.close_empty_initial);
  const initialWindowIdToClose = closeEmptyInitial ? await initialWindowForRunCleanup(context, instance) : null;
  const cwd = args.cwd == null ? context.cwd : await resolveDirectory(context, args.cwd);
  const runId = context.makeId("kr");
  const title = optionalNonEmptyString(args.title, "title") ?? `codex: ${commandText.slice(0, 48)}`;
  const statusFile = path.join(runDir(context), `${runId}.json`);
  const resultFile = path.join(runDir(context), `${runId}.result.json`);
  await ensureStateDirs(context);

  if (["split", "hsplit", "vsplit"].includes(placement)) {
    await setLayout(context, { instance_id: instance.instance_id, layout: "splits", tab_id: -1 });
  }

  const launchArgs = [
    "launch",
    "--type",
    placement === "tab" ? "tab" : "window",
    "--hold",
    "--title",
    title,
    "--cwd",
    cwd,
    "--env",
    `CODEX_KITTY_COMMAND=${commandText}`,
    "--env",
    `CODEX_KITTY_RUN_ID=${runId}`,
    "--env",
    `CODEX_KITTY_RUN_RESULT_FILE=${resultFile}`,
    "--env",
    `CODEX_KITTY_TITLE=${title}`,
    "--env",
    `CODEX_KITTY_INSTANCE_ID=${instance.instance_id}`,
    "--env",
    `CODEX_KITTY_INSTANCE_KIND=${instanceKind(instance)}`,
    "--env",
    `CODEX_KITTY_SOCKET=${instance.socket}`,
    "--var",
    "codex_managed=1",
    "--var",
    `codex_run_id=${runId}`,
  ];

  const location = placementLocation(placement);
  if (location) {
    launchArgs.push("--location", location);
  }

  if (instance.short_id) {
    launchArgs.push("--env", `CODEX_KITTY_SHORT_ID=${instance.short_id}`);
  }

  launchArgs.push("--", "sh", "-lc", kittyRunWrapperScript());
  const launch = await runKitten(context, instance, launchArgs, { timeoutMs: 10_000 });
  const windowId = parseWindowId(launch.stdout);
  const closedInitialWindowId = await closeInitialWindowAfterLaunch(context, instance, initialWindowIdToClose, windowId);
  const runState = {
    run_id: runId,
    instance_id: instance.instance_id,
    short_id: instance.short_id,
    instance_kind: instanceKind(instance),
    socket: instance.socket,
    window_id: windowId,
    tab_id: null,
    command: commandText,
    cwd,
    placement,
    title,
    status: "running",
    closed_initial_window_id: closedInitialWindowId,
    status_file: statusFile,
    result_file: resultFile,
    started_at: new Date(context.nowMs()).toISOString(),
    started_at_ms: context.nowMs(),
  };
  await writeJsonAtomic(statusFile, runState);

  const base = { ok: true, action: "run", ...runState };
  if (!wait) {
    return base;
  }

  const finalState = await waitForRunExit(context, runState, timeoutMs);
  const read = await readKitty(context, { run_id: runId, mode: "tail", lines: tailLines }).catch((error) => ({
    text: "",
    truncated: false,
    read_error: error instanceof Error ? error.message : String(error),
  }));
  return {
    ...base,
    ...finalState,
    timed_out: finalState.status !== "exited",
    tail: read.text,
    tail_truncated: read.truncated,
    read_error: read.read_error,
  };
}

async function readKitty(context, args) {
  const runState = args.run_id ? await readRunState(context, args.run_id) : null;
  const instance = await resolveInstance(context, { instance_id: args.instance_id ?? runState?.instance_id, short_id: args.short_id }, { autoCreate: false });
  const windowId = args.window_id ?? runState?.window_id;
  if (windowId == null) {
    throw new Error("window_not_found: kitty_read requires window_id or run_id");
  }

  const mode = optionalEnum(args.mode ?? "tail", "mode", READ_MODES);
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
  return {
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
    text,
    truncated,
  };
}

async function sendInput(context, args) {
  const runState = args.run_id ? await readRunState(context, args.run_id) : null;
  const instance = await resolveInstance(context, { instance_id: args.instance_id ?? runState?.instance_id, short_id: args.short_id }, { autoCreate: false });
  const windowId = args.window_id ?? runState?.window_id;
  if (windowId == null) {
    throw new Error("kitty_send requires window_id or run_id");
  }
  requireInteger(windowId, "window_id");
  const hasText = Object.hasOwn(args, "text") && args.text != null;
  const hasKey = Object.hasOwn(args, "key") && args.key != null;
  if (hasText === hasKey) {
    throw new Error("kitty_send requires exactly one of text or key");
  }

  if (hasText) {
    const text = String(args.text);
    const commandArgs = ["send-text", "--match", `id:${windowId}`, "--stdin"];
    if (args.bracketed_paste) {
      commandArgs.push("--bracketed-paste=enable");
    }
    await runKittenInput(context, instance, commandArgs, text, { timeoutMs: 10_000 });
    return { ok: true, action: "send_text", instance_id: instance.instance_id, short_id: instance.short_id, run_id: runState?.run_id, window_id: windowId, bytes: Buffer.byteLength(text, "utf8") };
  }

  const key = requireNonEmptyString(args.key, "key");
  await runKitten(context, instance, ["send-key", "--match", `id:${windowId}`, key], { timeoutMs: 10_000 });
  return { ok: true, action: "send_key", instance_id: instance.instance_id, short_id: instance.short_id, run_id: runState?.run_id, window_id: windowId, key };
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
  const shortId = typeof selector === "string" ? undefined : selector.short_id;
  if (instanceId || shortId) {
    const instance = registry.instances.find((candidate) =>
      instanceId ? candidate.instance_id === instanceId : candidate.short_id === shortId,
    );
    if (!instance) {
      throw new Error(`socket_unreachable: unknown kitty instance ${instanceId ?? shortId}`);
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
    const opened = await openKitty(context, { title: "Codex Kitty" });
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
      created_at: opened.created_at,
      created_at_ms: opened.created_at_ms,
      _auto_created: true,
    };
  }

  throw new Error("socket_unreachable: no managed kitty instance is registered");
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

async function waitForRunExit(context, state, timeoutMs) {
  const deadline = context.nowMs() + timeoutMs;
  while (context.nowMs() <= deadline) {
    const result = await readOptionalJson(state.result_file);
    if (result) {
      const merged = { ...state, ...result };
      await writeJsonAtomic(state.status_file, merged);
      return merged;
    }
    await context.sleep(RUN_POLL_MS);
  }
  return { ...state, status: "running" };
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function kittyRunWrapperScript() {
  return [
    'printf "\\033]2;%s\\007" "$CODEX_KITTY_TITLE" 2>/dev/null || true',
    'eval "$CODEX_KITTY_COMMAND"',
    "code=$?",
    'ended="$(date +%s%3N 2>/dev/null || printf "%s000" "$(date +%s)")"',
    'printf \'{"status":"exited","exit_code":%s,"ended_at_ms":%s}\\n\' "$code" "$ended" > "$CODEX_KITTY_RUN_RESULT_FILE"',
    'exit "$code"',
  ].join("; ");
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
    return { version: 1, instances: Array.isArray(registry.instances) ? registry.instances : [] };
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

async function allocateShortId(context) {
  await ensureStateDirs(context);
  const registry = await readRegistry(context);
  const used = new Set(
    registry.instances
      .filter((instance) => instance.status !== "closed")
      .map((instance) => instance.short_id)
      .filter(Boolean),
  );

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
  await writeJsonAtomic(registryPath(context), { version: 1, instances });
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

function clampInteger(value, defaultValue, min, max) {
  const candidate = value == null ? defaultValue : Number(value);
  if (!Number.isInteger(candidate)) {
    return defaultValue;
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
      env: options.env ? { ...process.env, ...options.env } : process.env,
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
      env: options.env ? { ...process.env, ...options.env } : process.env,
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
