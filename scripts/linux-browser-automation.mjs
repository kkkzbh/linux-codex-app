#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const serverInfo = {
  name: "browser_automation",
  version: "0.1.0-linux",
};

const browserAutomationConfig = Object.freeze({
  runtime: "browser_automation",
  platform: "linux",
  version: serverInfo.version,
});

const tools = [
  {
    name: "js",
    description:
      [
        "Run JavaScript in a persistent Node-backed kernel with top-level await.",
        "This is the JavaScript execution tool for the browser_automation MCP server.",
        "For the Chrome and Browser plugins, this is also the expected browser automation entrypoint:",
        "read the relevant Chrome/Browser skill, import that plugin's scripts/browser-client.mjs, call setupBrowserRuntime({ globals: globalThis }), then use agent.browsers.get(\"extension\") for Chrome or the Browser skill's backend for the in-app browser.",
        "Do not conclude that Chrome is unavailable, and do not fall back to Computer Use, merely because separate Chrome-specific click/type/navigate/screenshot tools are not visible.",
      ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript source to execute.",
        },
        timeout_ms: {
          type: "number",
          description: "Optional execution timeout in milliseconds.",
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
  {
    name: "js_reset",
    description: "Reset the persistent JavaScript kernel and clear bindings created by prior js calls.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

const DESKTOP_ENV_KEYS = [
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "XAUTHORITY",
  "CODEX_BROWSER_BACKENDS_REGISTRY",
  "CODEX_DESKTOP_AUTH_FETCH_SOCKET",
  "CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET",
];

let currentExec = null;
let browserAutomationEnv = createBrowserAutomationEnv();
let kernel = createKernel();
let jsQueue = Promise.resolve();
const pendingRequestIds = new Set();
const cancelledRequestIds = new Set();

class FatalExecutionError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = "FatalExecutionError";
    this.exitCode = exitCode;
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message, data) {
  send({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } });
}

function requestIdKey(id) {
  if (typeof id === "string") {
    return `string:${id}`;
  }
  if (typeof id === "number") {
    return Number.isFinite(id) ? `number:${id}` : null;
  }
  return null;
}

function parseEnvironmentEntries(raw) {
  const env = {};
  for (const entry of raw.split(/\0|\r?\n/)) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = entry.slice(0, separator);
    const value = entry.slice(separator + 1);
    if (value.trim()) {
      env[key] = value;
    }
  }

  return env;
}

function mergeMissingEnv(target, source, keys = Object.keys(source)) {
  for (const key of keys) {
    if (target[key]?.trim()) {
      continue;
    }

    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      target[key] = value;
      process.env[key] = value;
    }
  }
}

function readParentProcessEnv() {
  if (process.platform !== "linux" || !process.ppid) {
    return {};
  }

  try {
    return parseEnvironmentEntries(readFileSync(`/proc/${process.ppid}/environ`, "utf8"));
  } catch {
    return {};
  }
}

function readSystemdUserEnv() {
  if (process.platform !== "linux") {
    return {};
  }

  try {
    return parseEnvironmentEntries(
      execFileSync("systemctl", ["--user", "show-environment"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1_000,
      }),
    );
  } catch {
    return {};
  }
}

function createBrowserAutomationEnv() {
  const env = { ...process.env };
  mergeMissingEnv(env, readSystemdUserEnv(), DESKTOP_ENV_KEYS);
  mergeMissingEnv(env, readParentProcessEnv(), DESKTOP_ENV_KEYS);
  return env;
}

function createKernel() {
  const state = {
    responseMeta: {},
    output: [],
    images: [],
    requestMeta: {},
  };

  const sandbox = {};
  const nativePipe = {
    async createConnection(socketPath) {
      if (typeof socketPath !== "string" || socketPath.length === 0) {
        throw new Error("native pipe connect expected path");
      }

      return await new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath);
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
    },
  };

  const browserAutomation = {
    config: browserAutomationConfig,
    cwd: process.cwd(),
    env: browserAutomationEnv,
    homeDir: homedir(),
    tmpDir: tmpdir(),
    get requestMeta() {
      return state.requestMeta;
    },
    setResponseMeta(meta) {
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
        throw new Error("js response metadata must be an object");
      }

      state.responseMeta = { ...state.responseMeta, ...meta };
    },
    write(value) {
      state.output.push(String(value));
    },
    async emitImage(imageLike) {
      const image = await normalizeImage(await imageLike);
      state.images.push(image);
    },
    async createElicitation(request) {
      return createElicitation(await request);
    },
    async fetch(url, init = {}) {
      return limitedFetch(url, init);
    },
  };

  Object.assign(globalThis, {
    __codexNativePipe: nativePipe,
    browserAutomation,
  });

  Object.assign(sandbox, {
    Buffer,
    URL,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    AbortController,
    AbortSignal,
    clearInterval,
    clearTimeout,
    console: createConsole(state),
    fetch,
    global: sandbox,
    globalThis: sandbox,
    browserAutomation,
    process: createProcessShim(),
    setInterval,
    setTimeout,
    __codexNativePipe: nativePipe,
  });

  return { sandbox, state };
}

function createProcessShim() {
  const listeners = new Map();

  return {
    env: browserAutomationEnv,
    version: process.version,
    versions: process.versions,
    pid: process.pid,
    argv: ["node", "browser_automation"],
    cwd: () => process.cwd(),
    uptime: () => process.uptime(),
    memoryUsage: () => process.memoryUsage(),
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      return this;
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener);
      return this;
    },
    listeners(event) {
      return Array.from(listeners.get(event) ?? []);
    },
    exit(code = 0) {
      throw new Error(`process.exit(${code}) called`);
    },
  };
}

function createConsole(state) {
  function push(args) {
    state.output.push(`${args.map(formatValue).join(" ")}\n`);
  }

  return {
    debug: (...args) => push(args),
    error: (...args) => push(args),
    info: (...args) => push(args),
    log: (...args) => push(args),
    warn: (...args) => push(args),
  };
}

function formatValue(value) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function normalizeImage(value) {
  if (typeof value === "string") {
    if (!value.startsWith("data:image/")) {
      throw new Error("browserAutomation.emitImage only accepts image/* data URLs");
    }

    const [meta, base64] = value.split(",", 2);
    if (!base64 || !meta.includes(";base64")) {
      throw new Error("browserAutomation.emitImage received a malformed data URL");
    }

    return {
      type: "image",
      data: base64,
      mimeType: meta.slice("data:".length, meta.indexOf(";")),
    };
  }

  if (!value || typeof value !== "object") {
    throw new Error("browserAutomation.emitImage received an unsupported value");
  }

  const mimeType = value.mimeType;
  if (typeof mimeType !== "string" || !mimeType.startsWith("image/")) {
    throw new Error("browserAutomation.emitImage expected an image/* mimeType");
  }

  const bytes = value.bytes;
  if (
    !(
      Buffer.isBuffer(bytes) ||
      bytes instanceof Uint8Array ||
      bytes instanceof ArrayBuffer ||
      ArrayBuffer.isView(bytes)
    )
  ) {
    throw new Error("browserAutomation.emitImage expected bytes to be Buffer, Uint8Array, ArrayBuffer, or ArrayBufferView");
  }

  return {
    type: "image",
    data: Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength ?? undefined).toString("base64"),
    mimeType,
  };
}

async function createElicitation(request) {
  const normalized = normalizeElicitationRequest(request);
  const browserApproval = getBrowserApprovalRequest(normalized);

  if (browserApproval?.origin && isLocalOrigin(browserApproval.origin)) {
    return { action: "accept" };
  }

  if (browserApproval) {
    return requestDesktopBrowserApproval(normalized);
  }

  return { action: "decline" };
}

function normalizeElicitationRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("browserAutomation.createElicitation expected a request object");
  }

  if (typeof value.message !== "string" || value.message.trim() === "") {
    throw new Error("browserAutomation.createElicitation expected a non-empty message");
  }

  return {
    message: value.message,
    ...(value.meta && typeof value.meta === "object" ? { meta: value.meta } : {}),
    ...(value.requestedSchema && typeof value.requestedSchema === "object"
      ? { requestedSchema: value.requestedSchema }
      : {}),
  };
}

function isLocalOrigin(origin) {
  if (typeof origin !== "string") {
    return false;
  }

  if (origin.startsWith("file:")) {
    return true;
  }

  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function normalizeHttpOrigin(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
}

function getBrowserApprovalRequest(request) {
  const meta = request?.meta;
  if (!meta || typeof meta !== "object") {
    return null;
  }

  if (
    meta.codex_approval_kind !== "mcp_tool_call" ||
    meta.connector_id !== "browser-use"
  ) {
    return null;
  }

  if (meta.tool_name === "access_browser_origin") {
    const origin = normalizeHttpOrigin(meta.tool_params?.origin ?? meta.origin);
    return origin ? { kind: "origin", origin } : null;
  }

  if (meta.sensitive_data === "browsing_history") {
    return { kind: "history" };
  }

  if (meta.file_transfer === "download" || meta.file_transfer === "upload") {
    const origin = normalizeHttpOrigin(meta.origin);
    return origin ? { kind: "fileTransfer", transferKind: meta.file_transfer, origin } : null;
  }

  return null;
}

async function requestDesktopBrowserApproval(request) {
  const socketPath = getDesktopSocketEnv("CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET");
  if (!socketPath) {
    throw new Error(
      "Linux browser approval bridge unavailable: CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET is not set in browser_automation or parent app-server environment",
    );
  }

  let message;
  try {
    message = await requestUnixJson(socketPath, request, {
      description: "Codex desktop browser approval",
      timeoutMs: 120_000,
    });
  } catch (error) {
    throw new Error(
      `Linux browser approval bridge unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (message == null || typeof message !== "object") {
    throw new Error("Codex desktop browser approval returned an invalid response");
  }
  if (message.ok !== true) {
    throw new Error(message.error || "Codex desktop browser approval failed");
  }
  if (message.action === "accept" || message.action === "decline" || message.action === "cancel") {
    return { action: message.action };
  }

  throw new Error("Codex desktop browser approval returned an invalid action");
}

async function limitedFetch(url, init = {}) {
  const parsed = new URL(String(url));
  const method = String(init.method ?? "GET").toUpperCase();

  if (
    parsed.origin !== "https://chatgpt.com" ||
    parsed.pathname !== "/backend-api/aura/site_status" ||
    method !== "GET"
  ) {
    throw new Error("browserAutomation.fetch URL is not allowlisted");
  }

  return fetchViaCodexDesktop(parsed);
}

async function fetchViaCodexDesktop(parsed) {
  const socketPath = getDesktopSocketEnv("CODEX_DESKTOP_AUTH_FETCH_SOCKET");
  if (!socketPath) {
    throw new Error(
      "Codex desktop auth fetch unavailable: CODEX_DESKTOP_AUTH_FETCH_SOCKET is not set in browser_automation or parent app-server environment",
    );
  }

  const message = await requestUnixJson(socketPath, {
    method: "GET",
    url: parsed.toString(),
  }, {
    description: "Codex desktop auth fetch",
    timeoutMs: 60_000,
  });

  if (message == null || typeof message !== "object") {
    throw new Error("Codex desktop auth fetch returned an invalid response");
  }
  if (message.ok !== true) {
    throw new Error(message.error || "Codex desktop auth fetch failed");
  }

  return new Response(Buffer.from(String(message.bodyBase64 ?? ""), "base64"), {
    status: Number.isInteger(message.status) ? message.status : 502,
    statusText: typeof message.statusText === "string" ? message.statusText : "",
    headers: message.headers && typeof message.headers === "object" ? message.headers : {},
  });
}

async function requestUnixJson(socketPath, payload, options = {}) {
  const description = options.description ?? "Codex desktop socket";
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, Number(options.timeoutMs)) : 60_000;

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const chunks = [];
    const timer = setTimeout(() => {
      socket.destroy(new Error(`${description} timed out`));
    }, timeoutMs);

    socket.once("connect", () => {
      socket.end(JSON.stringify(payload));
    });

    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once("end", () => {
      clearTimeout(timer);
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        if (!body) {
          throw new Error(`${description} returned an empty response`);
        }
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function getDesktopSocketEnv(name) {
  const direct = browserAutomationEnv[name] ?? process.env[name];
  if (direct && direct.trim()) {
    return direct;
  }

  if (process.platform !== "linux" || !process.ppid) {
    return null;
  }

  try {
    const parentEnv = readFileSync(`/proc/${process.ppid}/environ`, "utf8");
    for (const entry of parentEnv.split("\0")) {
      const separator = entry.indexOf("=");
      if (separator <= 0) {
        continue;
      }
      if (entry.slice(0, separator) !== name) {
        continue;
      }
      const value = entry.slice(separator + 1);
      if (value.trim()) {
        browserAutomationEnv[name] = value;
        process.env[name] = value;
        return value;
      }
    }
  } catch {
    // Fall through to the explicit missing-environment error at the call site.
  }

  return null;
}

function normalizeTurnMetadata(requestMeta) {
  const metadata = requestMeta?.["x-codex-turn-metadata"];
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const sessionId = metadata.thread_source === "subagent" && typeof metadata.thread_id === "string"
    ? metadata.thread_id
    : metadata.session_id;
  const turnId = metadata.turn_id;

  if (typeof sessionId !== "string" || sessionId.length === 0 || typeof turnId !== "string" || turnId.length === 0) {
    return null;
  }

  return { sessionId, turnId };
}

function activeExecsDir() {
  const codexHome = browserAutomationEnv.CODEX_HOME ?? process.env.CODEX_HOME;
  if (typeof codexHome !== "string" || codexHome.trim().length === 0) {
    return null;
  }

  return path.join(codexHome, "browser_automation", "active_execs");
}

function registerActiveExec(execId, requestMeta) {
  const turnMetadata = normalizeTurnMetadata(requestMeta);
  const dir = activeExecsDir();
  if (turnMetadata == null || dir == null) {
    return null;
  }

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const recordPath = path.join(dir, `${execId}.json`);
  writeFileSync(
    recordPath,
    `${JSON.stringify(
      {
        version: 1,
        execId,
        sessionId: turnMetadata.sessionId,
        turnId: turnMetadata.turnId,
        browserAutomationPid: process.ppid,
        kernelPid: process.pid,
        startedAtMs: Date.now(),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  return () => {
    rmSync(recordPath, { force: true });
  };
}

function terminateAfterResponse(exitCode = 130) {
  setImmediate(() => {
    process.exit(exitCode);
  });
}

function terminateCurrentExec(exitCode = 130) {
  currentExec?.cleanup?.();
  currentExec = null;
  process.exit(exitCode);
}

async function executeJs(args, requestMeta, requestKey) {
  const code = args?.code ?? args?.input ?? args?.source;

  if (typeof code !== "string" || code.trim() === "") {
    throw new Error("js expects non-empty JavaScript source");
  }

  const timeoutMs = Number.isFinite(args?.timeout_ms) ? Math.max(1, Number(args.timeout_ms)) : 120_000;
  const execId = randomUUID();
  const state = kernel.state;
  state.output = [];
  state.images = [];
  state.responseMeta = {};
  state.requestMeta = requestMeta ?? {};

  currentExec = { id: execId, requestKey, cleanup: registerActiveExec(execId, state.requestMeta) };

  try {
    const result = await withTimeout(runCode(code), timeoutMs);
    if (result !== undefined) {
      state.output.push(`${formatValue(result)}\n`);
    }

    return buildToolResult(state);
  } finally {
    currentExec?.cleanup?.();
    currentExec = null;
  }
}

async function runCode(code) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const wrapped = new AsyncFunction(
    "sandbox",
    `with (sandbox) { return await (async () => {\n${code}\n})(); }`,
  );

  return await wrapped(kernel.sandbox);
}

function withTimeout(promise, timeoutMs) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new FatalExecutionError("js execution timed out", 124)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function buildToolResult(state) {
  const text = state.output.join("");
  const content = [];

  if (text.length > 0) {
    content.push({ type: "text", text });
  }

  content.push(...state.images);

  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  return {
    content,
    ...(Object.keys(state.responseMeta).length === 0 ? {} : { _meta: state.responseMeta }),
  };
}

function resetKernel() {
  browserAutomationEnv = createBrowserAutomationEnv();
  kernel = createKernel();
  return { content: [{ type: "text", text: "js execution reset" }] };
}

async function handleRequest(message) {
  switch (message.method) {
    case "initialize":
      sendResult(message.id, {
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: {
          tools: {},
        },
        serverInfo,
        instructions: "Use js to run JavaScript in the persistent Node-backed kernel.",
      });
      return;
    case "ping":
      sendResult(message.id, {});
      return;
    case "tools/list":
      sendResult(message.id, { tools });
      return;
    case "tools/call": {
      const toolName = message.params?.name;
      const args = message.params?.arguments ?? {};
      const requestMeta = message.params?._meta ?? message.params?.meta ?? {};

      try {
        if (toolName === "js") {
          const result = await enqueueJsOperation(message.id, (requestKey) => executeJs(args, requestMeta, requestKey));
          sendResult(message.id, result);
          return;
        }

        if (toolName === "js_reset") {
          const result = await enqueueJsOperation(message.id, () => resetKernel());
          sendResult(message.id, result);
          return;
        }

        throw new Error(`Unknown tool: ${toolName}`);
      } catch (error) {
        sendResult(message.id, {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        });
        if (error instanceof FatalExecutionError) {
          terminateAfterResponse(error.exitCode);
        }
      }
      return;
    }
    default:
      sendError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

async function enqueueJsOperation(requestId, operation) {
  const requestKey = requestIdKey(requestId);
  if (requestKey != null) {
    pendingRequestIds.add(requestKey);
  }

  async function runOperation() {
    try {
      if (requestKey != null && cancelledRequestIds.delete(requestKey)) {
        throw new Error("tool call cancelled");
      }

      return await operation(requestKey);
    } finally {
      if (requestKey != null) {
        pendingRequestIds.delete(requestKey);
        cancelledRequestIds.delete(requestKey);
      }
    }
  }

  const run = jsQueue.then(runOperation, runOperation);
  jsQueue = run.catch(() => {});
  return await run;
}

function handleNotification(message) {
  if (message.method !== "notifications/cancelled") {
    return;
  }

  const cancelledRequestKey = requestIdKey(message.params?.requestId);
  if (cancelledRequestKey == null) {
    return;
  }

  if (currentExec?.requestKey === cancelledRequestKey) {
    terminateCurrentExec(130);
    return;
  }

  if (pendingRequestIds.has(cancelledRequestKey)) {
    cancelledRequestIds.add(cancelledRequestKey);
  }
}

let inputBuffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;

  for (;;) {
    const newline = inputBuffer.indexOf("\n");
    if (newline < 0) {
      break;
    }

    const line = inputBuffer.slice(0, newline).replace(/\r$/, "");
    inputBuffer = inputBuffer.slice(newline + 1);

    if (line.trim() === "") {
      continue;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      sendError(null, -32700, error instanceof Error ? error.message : String(error));
      continue;
    }

    if (Object.hasOwn(message, "id") && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
      continue;
    }

    if (Object.hasOwn(message, "id")) {
      handleRequest(message).catch((error) => {
        sendError(message.id, -32603, error instanceof Error ? error.message : String(error));
      });
    } else {
      handleNotification(message);
    }
  }
});

process.stdin.resume();
