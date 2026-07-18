import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPUTER_USE_PROTOCOL_VERSION,
  ResourceScheduler,
  RootStore,
  StateStore,
  expandState,
  inspectState,
  observationDiff,
  searchState,
} from "./computer-use-state.mjs";

const DEFAULT_BROKER_TIMEOUT_MS = 120_000;
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

const SESSION_PROPERTY = {
  type: "string",
  description: "Route the operation through a Ready isolated session. Omit for the user's foreground desktop.",
};
const TIMEOUT_PROPERTY = {
  type: "integer",
  minimum: 100,
  maximum: 300000,
  default: DEFAULT_BROKER_TIMEOUT_MS,
};
const STATE_PROPERTY = { type: "string", pattern: "^state-[0-9]+$" };
const ROOT_PROPERTY = { type: "string", pattern: "^@r[0-9]+$" };
const ELEMENT_PROPERTY = { type: "string", pattern: "^@e[0-9]+$" };
const FOREGROUND_REASON_PROPERTY = {
  type: "string",
  minLength: 1,
  description: "Concrete reason this operation requires the user's existing foreground desktop state.",
};
const RESPONSE_PROPERTY = {
  type: "string",
  enum: ["compact", "full"],
  default: "compact",
  description: "Return compact successor metadata by default; full includes the complete cached outline.",
};

const EXPECT_SCHEMA = {
  type: "object",
  properties: {
    ref: {
      ...ELEMENT_PROPERTY,
      description: "Scope the expectation to one element. Omit ref with gone to target root/window presence.",
    },
    text: { type: "string" },
    role: { type: "string" },
    value: {},
    gone: {
      type: "boolean",
      description: "With ref, require that element's presence state. Without ref, require the exact root/window presence state.",
    },
    timeout_ms: { type: "integer", minimum: 0, maximum: 120000, default: 5000 },
  },
  additionalProperties: false,
};

export const COMPUTER_USE_TOOLS = [
  {
    name: "isolated_start",
    title: "Start Isolated Session",
    description: "Start a self-owned KWin virtual GUI/profile-isolated session with private Wayland, Xwayland, D-Bus, AT-SPI, HOME, and XDG directories.",
    inputSchema: {
      type: "object",
      properties: {
        screen_width: { type: "integer", minimum: 320, maximum: 7680, default: 1280 },
        screen_height: { type: "integer", minimum: 240, maximum: 4320, default: 800 },
        timeout_ms: { type: "integer", minimum: 5000, maximum: 300000, default: 60000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "isolated_stop",
    title: "Stop Isolated Session",
    description: "Stop the isolated session and its transient systemd user-scope cgroup.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session id returned by isolated_start." },
        force: { type: "boolean", default: false },
        timeout_ms: { type: "integer", minimum: 1000, maximum: 30000, default: 15000 },
      },
      required: ["session_id"],
      additionalProperties: false,
    },
  },
  {
    name: "isolated_status",
    title: "Get Isolated Session Status",
    description: "Return the isolated SessionSupervisor state.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "find_roots",
    title: "Find UI Roots",
    description: "Discover exact roots in an isolated session by default. Foreground discovery requires a concrete foreground_reason.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: SESSION_PROPERTY,
        foreground_reason: FOREGROUND_REASON_PROPERTY,
        kind: { type: "string", enum: ["window", "application", "tray_item", "all"], default: "window" },
        query: { type: "string", description: "Case-insensitive name, title, executable, desktop id, or class query." },
        include_special: { type: "boolean", default: false },
        include_minimized: { type: "boolean", default: true },
        include_hidden: { type: "boolean", default: false },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        timeout_ms: TIMEOUT_PROPERTY,
      },
      oneOf: [
        { required: ["session_id"], not: { required: ["foreground_reason"] } },
        { required: ["foreground_reason"], not: { required: ["session_id"] } },
      ],
      additionalProperties: false,
    },
  },
  {
    name: "observe_ui",
    title: "Observe UI",
    description: "Create a state-scoped accessibility outline and optional target-window image for one exact root.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: SESSION_PROPERTY,
        rootRef: ROOT_PROPERTY,
        include_image: { type: "boolean", default: true },
        max_depth: { type: "integer", minimum: 1, maximum: 20, default: 8 },
        max_nodes: { type: "integer", minimum: 1, maximum: 2000, default: 500 },
        timeout_ms: TIMEOUT_PROPERTY,
      },
      required: ["rootRef"],
      additionalProperties: false,
    },
  },
  {
    name: "search_ui",
    title: "Search UI State",
    description: "Search the full cached outline of one observation without touching the live desktop.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: SESSION_PROPERTY,
        stateId: STATE_PROPERTY,
        query: { type: "string", minLength: 1 },
        roles: { type: "array", items: { type: "string" }, default: [] },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 25 },
      },
      required: ["stateId", "query"],
      additionalProperties: false,
    },
  },
  {
    name: "expand_ui",
    title: "Expand UI Element",
    description: "Return descendants of an element from the full cached outline.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: SESSION_PROPERTY,
        stateId: STATE_PROPERTY,
        ref: ELEMENT_PROPERTY,
        depth: { type: "integer", minimum: 1, maximum: 20, default: 1 },
      },
      required: ["stateId", "ref"],
      additionalProperties: false,
    },
  },
  {
    name: "inspect_ui",
    title: "Inspect UI Element",
    description: "Inspect one exact element from a cached observation.",
    inputSchema: {
      type: "object",
      properties: { session_id: SESSION_PROPERTY, stateId: STATE_PROPERTY, ref: ELEMENT_PROPERTY },
      required: ["stateId", "ref"],
      additionalProperties: false,
    },
  },
  {
    name: "act_ui",
    title: "Act on UI",
    description: "Validate state, execute semantic or foreground actions in one resource transaction, verify a postcondition, cache the complete successor, and return compact successor metadata by default.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: SESSION_PROPERTY,
        stateId: STATE_PROPERTY,
        policy: { type: "string", enum: ["semantic_only", "auto", "foreground"], default: "auto" },
        actions: {
          type: "array",
          minItems: 1,
          maxItems: 32,
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["press", "click", "set_text", "type_text", "key", "scroll", "drag"] },
              ref: ELEMENT_PROPERTY,
              x: { type: "number" },
              y: { type: "number" },
              to_x: { type: "number" },
              to_y: { type: "number" },
              text: { type: "string" },
              key: { type: "string" },
              modifiers: { type: "array", items: { type: "string", enum: ["ctrl", "alt", "shift", "meta"] }, default: [] },
              button: { type: "string", enum: ["left", "middle", "right"], default: "left" },
              count: { type: "integer", minimum: 1, maximum: 5, default: 1 },
              dx: { type: "number", default: 0 },
              dy: { type: "number", default: 0 },
            },
            required: ["op"],
            additionalProperties: false,
          },
        },
        expect: EXPECT_SCHEMA,
        include_image: { type: "boolean", default: true },
        response: RESPONSE_PROPERTY,
        timeout_ms: TIMEOUT_PROPERTY,
      },
      required: ["stateId", "actions"],
      additionalProperties: false,
    },
  },
  {
    name: "read_text",
    title: "Read UI Text",
    description: "Read text or value through the exact AT-SPI wire ref bound to a current state.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: SESSION_PROPERTY,
        stateId: STATE_PROPERTY,
        ref: ELEMENT_PROPERTY,
        start: { type: "integer", minimum: 0, default: 0 },
        end: { type: "integer", minimum: -1, default: -1 },
        timeout_ms: TIMEOUT_PROPERTY,
      },
      required: ["stateId", "ref"],
      additionalProperties: false,
    },
  },
  {
    name: "wait_for",
    title: "Wait for UI",
    description: "Wait on the root event journal, confirm an exact condition with a fresh observation, cache the complete successor, and return compact successor metadata by default.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: SESSION_PROPERTY,
        stateId: STATE_PROPERTY,
        expect: EXPECT_SCHEMA,
        include_image: { type: "boolean", default: true },
        response: RESPONSE_PROPERTY,
        timeout_ms: { type: "integer", minimum: 0, maximum: 120000, default: 5000 },
      },
      required: ["stateId", "expect"],
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
  const broker = deps.broker ?? new BrokerClient(context);
  const roots = new RootStore();
  const states = new StateStore();
  const scheduler = new ResourceScheduler();

  function requireState(args) {
    const state = states.require(args.stateId);
    if (args.session_id != null && state.sessionId !== args.session_id) {
      throw new Error(`state ${state.stateId} belongs to session ${state.sessionId ?? "foreground"}`);
    }
    return state;
  }

  function scopedExpect(state, expect) {
    if (expect == null) {
      return null;
    }
    const scoped = { ...expect, wire_ref: states.wireRef(state, expect.ref, true) };
    delete scoped.ref;
    return scoped;
  }

  function rootRouting(args) {
    if (args.session_id != null) {
      if (args.foreground_reason != null) {
        throw new Error("foreground_reason cannot be combined with session_id");
      }
      return { target: "isolated" };
    }
    const reason = typeof args.foreground_reason === "string" ? args.foreground_reason.trim() : "";
    if (!reason) {
      throw new Error(
        "foreground root discovery requires foreground_reason; use isolated_start when the task does not require the user's existing desktop state",
      );
    }
    return { target: "foreground", reason };
  }

  function successorObservation(state, response) {
    if (response === "full") {
      return state.observation;
    }
    const observation = state.observation;
    const compact = {
      stateId: observation.stateId,
      rootRef: observation.rootRef,
      resourceKey: observation.resourceKey,
      epoch: observation.epoch,
      coordinateSpace: observation.coordinateSpace,
      capturedAt: observation.capturedAt,
      root: observation.root,
      window: observation.window,
      outline: {
        nodeCount: observation.outline.nodes.length,
        truncated: observation.outline.truncated,
      },
    };
    if (observation.image != null) {
      compact.image = observation.image;
    }
    return compact;
  }

  async function observeRoot(root, args, epoch) {
    const timeoutMs = args.timeout_ms ?? context.timeoutMs;
    const observation = await broker.call("observe_root", {
      session_id: root.sessionId,
      root: root.backend,
      include_image: args.include_image ?? true,
      max_depth: args.max_depth,
      max_nodes: args.max_nodes,
      timeout_ms: args.timeout_ms,
    }, timeoutMs + 2000);
    return states.save(root, epoch, observation);
  }

  return {
    tools: COMPUTER_USE_TOOLS,
    async callTool(name, args = {}) {
      if (!COMPUTER_USE_TOOLS.some((tool) => tool.name === name)) {
        throw new Error(`Unknown Computer Use tool: ${name}`);
      }
      const timeoutMs = Number.isInteger(args.timeout_ms) ? args.timeout_ms : context.timeoutMs;
      if (name === "isolated_start" || name === "isolated_status") {
        return await broker.call(name, args, timeoutMs + 2000);
      }
      if (name === "isolated_stop") {
        const result = await broker.call(name, args, timeoutMs + 2000);
        roots.deleteSession(args.session_id);
        states.deleteSession(args.session_id);
        return result;
      }
      if (name === "find_roots") {
        const routing = rootRouting(args);
        const brokerArgs = { ...args };
        delete brokerArgs.foreground_reason;
        const result = await broker.call("find_roots", brokerArgs, timeoutMs + 2000);
        if (result.protocol_version !== COMPUTER_USE_PROTOCOL_VERSION) {
          throw new Error(`backend protocol mismatch: expected ${COMPUTER_USE_PROTOCOL_VERSION}`);
        }
        const routedRoots = result.roots.map((root) => ({ ...root, routing }));
        const publicRoots = roots.registerMany(routedRoots, args.session_id ?? null);
        return { protocolVersion: COMPUTER_USE_PROTOCOL_VERSION, roots: publicRoots, count: publicRoots.length };
      }
      if (name === "observe_ui") {
        const root = roots.require(args.rootRef, args.session_id);
        return await scheduler.read(root.backend.resource_key, async () => {
          const epoch = scheduler.epoch(root.backend.resource_key);
          return (await observeRoot(root, args, epoch)).observation;
        });
      }
      if (name === "search_ui") {
        return searchState(requireState(args), args);
      }
      if (name === "expand_ui") {
        return expandState(requireState(args), args.ref, args.depth ?? 1);
      }
      if (name === "inspect_ui") {
        return inspectState(requireState(args), args.ref);
      }
      if (name === "read_text") {
        const state = requireState(args);
        scheduler.assertCurrent(state.resourceKey, state.epoch);
        return await scheduler.read(state.resourceKey, () => broker.call("read_text", {
          session_id: state.sessionId,
          root: state.backendRoot,
          look_id: state.lookId,
          wire_ref: states.wireRef(state, args.ref),
          start: args.start ?? 0,
          end: args.end ?? -1,
          timeout_ms: args.timeout_ms,
        }, timeoutMs + 2000));
      }
      if (name === "act_ui") {
        const state = requireState(args);
        const actions = args.actions.map((action) => {
          const scoped = { ...action, wire_ref: states.wireRef(state, action.ref, true) };
          delete scoped.ref;
          return scoped;
        });
        return await scheduler.mutate(state.resourceKey, state.epoch, async (successorEpoch) => {
          const result = await broker.call("act_transaction", {
            session_id: state.sessionId,
            root: state.backendRoot,
            look_id: state.lookId,
            actions,
            expect: scopedExpect(state, args.expect),
            policy: args.policy ?? "auto",
            include_image: args.include_image ?? true,
            timeout_ms: args.timeout_ms,
          }, timeoutMs + 2000);
          const root = roots.require(state.rootRef, state.sessionId);
          const successor = states.save(root, successorEpoch, result.observation);
          return {
            outcome: result.outcome,
            evidence: result.evidence,
            diff: observationDiff(state, successor),
            observation: successorObservation(successor, args.response ?? "compact"),
          };
        });
      }
      if (name === "wait_for") {
        const state = requireState(args);
        scheduler.assertCurrent(state.resourceKey, state.epoch);
        return await scheduler.read(state.resourceKey, async () => {
          const result = await broker.call("wait_for", {
            session_id: state.sessionId,
            root: state.backendRoot,
            look_id: state.lookId,
            expect: scopedExpect(state, args.expect),
            include_image: args.include_image ?? true,
            timeout_ms: args.timeout_ms,
          }, timeoutMs + 2000);
          const root = roots.require(state.rootRef, state.sessionId);
          const successor = states.save(root, state.epoch, result.observation);
          return {
            outcome: result.outcome,
            evidence: result.evidence,
            diff: observationDiff(state, successor),
            observation: successorObservation(successor, args.response ?? "compact"),
          };
        });
      }
      throw new Error(`Computer Use controller has no implementation for ${name}`);
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
    this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
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
    if (this.child != null) {
      this.child.kill();
      this.child = null;
    }
  }
}
