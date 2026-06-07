import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BROKER_TIMEOUT_MS = 120_000;
const DEFAULT_INPUT_TIMEOUT_MS = 180_000;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const brokerScript = path.join(scriptDir, "computer-use-broker.py");
const DESKTOP_SESSION_ENV_KEYS = [
  "DBUS_SESSION_BUS_ADDRESS",
  "DESKTOP_SESSION",
  "DISPLAY",
  "KDE_FULL_SESSION",
  "KDE_SESSION_VERSION",
  "QT_QPA_PLATFORM",
  "WAYLAND_DISPLAY",
  "XDG_CURRENT_DESKTOP",
  "XDG_DATA_DIRS",
  "XDG_RUNTIME_DIR",
  "XDG_SESSION_DESKTOP",
  "XDG_SESSION_TYPE",
];

const BUTTONS = ["left", "middle", "right"];
const TYPE_METHODS = ["auto", "clipboard", "keysyms"];
const OBSERVE_BACKENDS = ["direct", "portal", "auto"];

export const COMPUTER_USE_TOOLS = [
  {
    name: "computer_begin_round",
    title: "Begin Round",
    description: "Start a Computer Use round, enabling cursor glow and grouping virtual desktop moves until the round ends.",
    inputSchema: {
      type: "object",
      properties: {
        glow: { type: "boolean", description: "Enable the cursor glow overlay for this round.", default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: "computer_end_round",
    title: "End Round",
    description: "End the current Computer Use round, stop cursor glow, and restore windows moved to KDE virtual desktop 1.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "computer_observe",
    title: "Observe Desktop",
    description: "Capture the currently visible KDE Wayland desktop. The default direct backend uses KWin ScreenShot2 without portal prompts.",
    inputSchema: {
      type: "object",
      properties: {
        include_image: { type: "boolean", description: "Return a base64 PNG screenshot.", default: true },
        include_windows: { type: "boolean", description: "Include KWin window metadata with the screenshot.", default: true },
        crop: {
          type: "object",
          description: "Optional compositor-coordinate crop rectangle.",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number", minimum: 1 },
            height: { type: "number", minimum: 1 },
          },
          required: ["x", "y", "width", "height"],
          additionalProperties: false,
        },
        timeout_ms: {
          type: "integer",
          minimum: 1000,
          maximum: 300000,
          description: "Maximum time to wait for the selected backend and frame capture.",
          default: DEFAULT_INPUT_TIMEOUT_MS,
        },
        backend: {
          type: "string",
          enum: OBSERVE_BACKENDS,
          description: "Screenshot backend. direct uses owner-authorized KWin ScreenShot2; portal uses KDE RemoteDesktop.",
          default: "direct",
        },
        allow_portal_fallback: {
          type: "boolean",
          description: "Allow auto mode to fall back to XDG portal prompts if the direct backend is not configured.",
          default: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "computer_list_desktops",
    title: "List Desktops",
    description: "List KDE Wayland virtual desktops and the current desktop.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "computer_list_apps",
    title: "List Apps",
    description: "List launchable desktop apps from .desktop metadata for use with computer_open_app.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional case-insensitive app name, desktop id, executable, or StartupWMClass filter." },
        include_hidden: { type: "boolean", description: "Include Hidden or NoDisplay desktop entries.", default: false },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Maximum number of apps to return.", default: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "computer_list_tray_items",
    title: "List Tray Items",
    description: "List KDE StatusNotifierItem system tray entries for tray-hidden apps such as chat clients.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional case-insensitive tray item id, title, icon, service, or tooltip filter." },
        include_errors: { type: "boolean", description: "Include stale or unreadable tray item DBus errors.", default: false },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Maximum number of tray items to return.", default: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "computer_list_windows",
    title: "List Windows",
    description: "List KDE Wayland windows with virtual desktop metadata using KWin scripting.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", description: "Optional case-insensitive app/window class filter." },
        include_special: { type: "boolean", description: "Include desktop, dock, and special windows.", default: false },
        include_minimized: { type: "boolean", description: "Include minimized windows.", default: true },
        detail: {
          type: "string",
          enum: ["summary", "full"],
          description: "Window metadata detail. summary is token-lean and sufficient for activation; full returns raw KWin fields.",
          default: "summary",
        },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Maximum number of windows to return.", default: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "computer_open_app",
    title: "Open App",
    description: "Launch an installed desktop app from .desktop metadata, then optionally return matching windows.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "App name, executable, desktop id, or StartupWMClass to search for." },
        desktop_id: { type: "string", description: "Exact desktop entry id, such as org.kde.dolphin.desktop." },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Additional app arguments appended after desktop Exec field expansion.",
          default: [],
        },
        activate: { type: "boolean", description: "Try to activate a matching window after launch.", default: true },
        reuse_existing: {
          type: "boolean",
          description: "Activate an existing matching window or tray item instead of launching a new process when one is already present.",
          default: false,
        },
        wait_ms: {
          type: "integer",
          minimum: 0,
          maximum: 30000,
          description: "Delay before listing windows after launch.",
          default: 1000,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "computer_activate_tray_item",
    title: "Activate Tray Item",
    description: "Activate a KDE StatusNotifierItem system tray entry to restore a tray-hidden foreground app without coordinate guessing.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Case-insensitive tray item id, title, icon, service, or tooltip filter." },
        item_ref: { type: "string", description: "Exact StatusNotifierItem ref returned by computer_list_tray_items." },
        service: { type: "string", description: "Exact DBus service returned by computer_list_tray_items." },
        path: { type: "string", description: "Exact DBus object path returned by computer_list_tray_items." },
        action: {
          type: "string",
          enum: ["activate", "secondary_activate", "context_menu"],
          description: "StatusNotifierItem action to invoke.",
          default: "activate",
        },
        x: { type: "integer", description: "Anchor x coordinate for the tray item action.", default: 0 },
        y: { type: "integer", description: "Anchor y coordinate for the tray item action.", default: 0 },
        wait_ms: {
          type: "integer",
          minimum: 0,
          maximum: 10000,
          description: "Delay after tray activation.",
          default: 500,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "computer_activate_window",
    title: "Activate Window",
    description: "Bring a KDE Wayland window to the foreground using KWin scripting.",
    inputSchema: {
      type: "object",
      properties: {
        window_id: { type: "string", description: "Window id returned by computer_list_windows." },
        index: { type: "integer", minimum: 0, description: "Window list index when no id is available." },
        app: { type: "string", description: "Case-insensitive app/window class filter." },
        title: { type: "string", description: "Case-insensitive window title filter." },
        wait_ms: {
          type: "integer",
          minimum: 0,
          maximum: 10000,
          description: "Delay after activation.",
          default: 300,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "computer_click",
    title: "Click",
    description: "Move the pointer and click on the foreground KDE Wayland desktop through the pre-authorized RemoteDesktop portal.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Visible desktop x coordinate from computer_observe." },
        y: { type: "number", description: "Visible desktop y coordinate from computer_observe." },
        button: { type: "string", enum: BUTTONS, description: "Pointer button.", default: "left" },
        count: { type: "integer", minimum: 1, maximum: 5, description: "Click count.", default: 1 },
        interval_ms: { type: "integer", minimum: 0, maximum: 2000, description: "Delay between repeated clicks.", default: 120 },
        animation_ms: { type: "integer", minimum: 0, maximum: 2000, description: "Pointer movement animation duration before the click.", default: 220 },
        animation_steps: { type: "integer", minimum: 2, maximum: 80, description: "Pointer movement interpolation steps before the click." },
      },
      required: ["x", "y"],
      additionalProperties: false,
    },
  },
  {
    name: "computer_drag",
    title: "Drag",
    description: "Drag from one foreground desktop coordinate to another through the pre-authorized RemoteDesktop portal.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Start x coordinate from computer_observe." },
        y: { type: "number", description: "Start y coordinate from computer_observe." },
        to_x: { type: "number", description: "End x coordinate from computer_observe." },
        to_y: { type: "number", description: "End y coordinate from computer_observe." },
        button: { type: "string", enum: BUTTONS, description: "Pointer button.", default: "left" },
        duration_ms: { type: "integer", minimum: 1, maximum: 10000, description: "Drag duration.", default: 500 },
        steps: { type: "integer", minimum: 2, maximum: 200, description: "Motion interpolation steps.", default: 20 },
      },
      required: ["x", "y", "to_x", "to_y"],
      additionalProperties: false,
    },
  },
  {
    name: "computer_scroll",
    title: "Scroll",
    description: "Scroll the foreground desktop at an optional coordinate through the pre-authorized RemoteDesktop portal.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Optional x coordinate from computer_observe to move to before scrolling." },
        y: { type: "number", description: "Optional y coordinate from computer_observe to move to before scrolling." },
        dx: { type: "number", description: "Horizontal smooth-scroll delta.", default: 0 },
        dy: { type: "number", description: "Vertical smooth-scroll delta.", default: 0 },
        steps: { type: "integer", minimum: 1, maximum: 100, description: "Repeat count.", default: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "computer_key",
    title: "Press Key",
    description: "Send a key or key chord to the foreground KDE Wayland desktop through the pre-authorized RemoteDesktop portal.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Key name or single character, such as enter, escape, a, F5." },
        modifiers: {
          type: "array",
          items: { type: "string", enum: ["ctrl", "alt", "shift", "meta"] },
          description: "Modifier keys pressed around the key.",
          default: [],
        },
        repeat: { type: "integer", minimum: 1, maximum: 100, description: "Number of times to press the key.", default: 1 },
      },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: "computer_type",
    title: "Type Text",
    description: "Type or paste text into the foreground app through the pre-authorized RemoteDesktop portal.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to enter into the foreground app." },
        method: { type: "string", enum: TYPE_METHODS, description: "Text entry method.", default: "auto" },
        submit: { type: "boolean", description: "Press Enter after text entry.", default: false },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "computer_release_desktops",
    title: "Release Desktops",
    description: "Compatibility alias for ending the current Computer Use round and restoring moved KDE virtual desktops.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "computer_wait",
    title: "Wait",
    description: "Wait for the foreground desktop to settle and optionally return a fresh KDE Wayland desktop observation.",
    inputSchema: {
      type: "object",
      properties: {
        ms: { type: "integer", minimum: 0, maximum: 120000, description: "Milliseconds to wait.", default: 1000 },
        observe: { type: "boolean", description: "Return computer_observe output after waiting.", default: false },
        backend: {
          type: "string",
          enum: OBSERVE_BACKENDS,
          description: "Screenshot backend used only when observe is true.",
          default: "direct",
        },
        allow_portal_fallback: {
          type: "boolean",
          description: "Allow auto mode to fall back to XDG portal prompts when observe is true.",
          default: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "computer_get_accessibility_tree",
    title: "Get Accessibility Tree",
    description: "Read a bounded AT-SPI accessibility tree from the active or selected foreground window.",
    inputSchema: {
      type: "object",
      properties: {
        window_id: { type: "string", description: "Optional window id returned by computer_list_windows." },
        app: { type: "string", description: "Optional app/window class filter." },
        title: { type: "string", description: "Optional title filter." },
        max_depth: { type: "integer", minimum: 1, maximum: 12, description: "Maximum tree depth.", default: 5 },
        max_nodes: { type: "integer", minimum: 1, maximum: 1000, description: "Maximum nodes to return.", default: 200 },
      },
      additionalProperties: false,
    },
  },
];

export function createComputerUseController(deps = {}) {
  const context = {
    env: createComputerUseEnv(deps.env ?? process.env, deps),
    cwd: deps.cwd ?? process.cwd(),
    spawnProcess: deps.spawnProcess ?? spawn,
    python: deps.python ?? process.env.CODEX_COMPUTER_USE_PYTHON ?? "python3",
    brokerScript: deps.brokerScript ?? brokerScript,
    timeoutMs: deps.timeoutMs ?? DEFAULT_BROKER_TIMEOUT_MS,
  };
  const broker = new BrokerClient(context);

  return {
    tools: COMPUTER_USE_TOOLS,
    async callTool(name, args = {}) {
      if (!COMPUTER_USE_TOOLS.some((tool) => tool.name === name)) {
        throw new Error(`Unknown Computer Use tool: ${name}`);
      }
      const timeoutMs = Number.isInteger(args.timeout_ms) ? args.timeout_ms : context.timeoutMs;
      return await broker.call(name, args, timeoutMs);
    },
    stop() {
      broker.stop();
    },
  };
}

export function createComputerUseEnv(baseEnv = process.env, deps = {}) {
  const env = { ...baseEnv };
  mergeMissingDesktopEnv(env, deps.parentEnv ?? readParentProcessEnv(process.ppid));
  ensureDefaultUserBusEnv(env);
  mergeMissingDesktopEnv(env, deps.systemdUserEnv ?? readSystemdUserEnvironment(env));
  ensureDefaultUserBusEnv(env);
  return env;
}

function ensureDefaultUserBusEnv(env) {
  if (!env.XDG_RUNTIME_DIR && typeof process.getuid === "function") {
    env.XDG_RUNTIME_DIR = `/run/user/${process.getuid()}`;
  }
  if (env.XDG_RUNTIME_DIR && !env.DBUS_SESSION_BUS_ADDRESS) {
    env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${env.XDG_RUNTIME_DIR}/bus`;
  }
}

function mergeMissingDesktopEnv(target, source) {
  if (source == null || typeof source !== "object") {
    return;
  }
  for (const key of DESKTOP_SESSION_ENV_KEYS) {
    if ((target[key] == null || target[key] === "") && typeof source[key] === "string" && source[key] !== "") {
      target[key] = source[key];
    }
  }
}

function readParentProcessEnv(ppid) {
  if (!Number.isInteger(ppid) || ppid <= 1) {
    return {};
  }
  try {
    return parseNullSeparatedEnv(readFileSync(`/proc/${ppid}/environ`));
  } catch {
    return {};
  }
}

function readSystemdUserEnvironment(env) {
  try {
    return parseLineEnv(execFileSync("systemctl", ["--user", "show-environment"], {
      encoding: "utf8",
      env,
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }));
  } catch {
    return {};
  }
}

function parseNullSeparatedEnv(buffer) {
  const env = {};
  for (const entry of buffer.toString("utf8").split("\0")) {
    const index = entry.indexOf("=");
    if (index > 0) {
      env[entry.slice(0, index)] = entry.slice(index + 1);
    }
  }
  return env;
}

function parseLineEnv(text) {
  const env = {};
  for (const line of String(text).split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0) {
      env[line.slice(0, index)] = line.slice(index + 1);
    }
  }
  return env;
}

class BrokerClient {
  constructor(context) {
    this.context = context;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.stderr = "";
  }

  call(method, params, timeoutMs) {
    this.ensureStarted();
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    this.child.stdin.write(`${payload}\n`);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}\n${this.stderr.trim()}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
    });
  }

  ensureStarted() {
    if (this.child != null && !this.child.killed) {
      return;
    }

    this.stderr = "";
    this.buffer = "";
    this.child = this.context.spawnProcess(this.context.python, [this.context.brokerScript], {
      cwd: this.context.cwd,
      env: this.context.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
      if (this.stderr.length > 16_000) {
        this.stderr = this.stderr.slice(-16_000);
      }
    });
    this.child.on("exit", (code, signal) => {
      const error = new Error(`Computer Use broker exited: code=${code ?? "null"} signal=${signal ?? "null"}`);
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(error);
        this.pending.delete(id);
      }
      this.child = null;
    });
  }

  handleStdout(chunk) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) {
        continue;
      }
      const message = JSON.parse(line);
      const pending = this.pending.get(message.id);
      if (pending == null) {
        continue;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) {
        pending.resolve(message.result);
      } else {
        pending.reject(new Error(message.error ?? `Computer Use broker failed for ${pending.method}`));
      }
    }
  }

  stop() {
    if (this.child == null) {
      return;
    }
    this.child.kill();
    this.child = null;
  }
}
