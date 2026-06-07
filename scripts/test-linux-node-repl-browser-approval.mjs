#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const nodeReplPath = path.join(scriptDir, "linux-node-repl.mjs");

function makeBrowserApprovalRequest(origin) {
  return {
    message: `Allow Browser Use to access ${origin}?`,
    meta: {
      codex_approval_kind: "mcp_tool_call",
      codex_request_type: "approval_request",
      connector_id: "browser-use",
      connector_name: "Browser Use",
      persist: "always",
      tool_name: "access_browser_origin",
      tool_title: "Access browser origin",
      tool_params: { origin },
    },
  };
}

function makeBrowserHistoryApprovalRequest() {
  return {
    message: "Allow Browser Use to read your browsing history?",
    meta: {
      codex_approval_kind: "mcp_tool_call",
      connector_id: "browser-use",
      connector_name: "Browser Use",
      tool_params: { max_results: 100 },
      sensitive_data: "browsing_history",
    },
  };
}

function makeBrowserFileTransferApprovalRequest(transferKind, origin) {
  return {
    message: transferKind === "download" ? `Allow download from ${origin}?` : `Allow upload to ${origin}?`,
    meta: {
      codex_approval_kind: "mcp_tool_call",
      connector_id: "browser-use",
      connector_name: "Browser Use",
      persist: ["session", "always"],
      tool_params: {},
      file_transfer: transferKind,
      origin,
    },
  };
}

function startJsonSocket(socketPath, handler) {
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    const chunks = [];
    socket.on("error", () => {});
    const safeEnd = (message) => {
      if (!socket.destroyed) {
        socket.write(JSON.stringify(message), () => {
          if (!socket.destroyed) {
            socket.end();
          }
        });
      }
    };
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("end", async () => {
      try {
        const request = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        const response = await handler(request);
        safeEnd(response);
      } catch (error) {
        safeEnd({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve(server));
  });
}

function startRepl(env = {}) {
  const child = spawn(process.execPath, [nodeReplPath], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pending = new Map();
  let stderr = "";

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  child.stdout.setEncoding("utf8");
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        break;
      }

      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) {
        continue;
      }

      const message = JSON.parse(line);
      if (Object.prototype.hasOwnProperty.call(message, "id") && pending.has(message.id)) {
        const { resolve, reject, timer } = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(timer);
        if (message.error) {
          reject(new Error(message.error.message || "JSON-RPC error"));
        } else {
          resolve(message.result);
        }
      } else {
        startRepl.unhandled.push(message);
      }
    }
  });

  function request(method, params) {
    const id = startRepl.nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}\n${stderr}`));
      }, 10_000);
      pending.set(id, { resolve, reject, timer });
    });
  }

  function close() {
    child.kill("SIGTERM");
  }

  return { request, close };
}

startRepl.nextId = 1;
startRepl.unhandled = [];

async function callCreateElicitationTool(repl, request) {
  return repl.request("tools/call", {
    name: "js",
    arguments: {
      code: `return await nodeRepl.createElicitation(${JSON.stringify(request)});`,
    },
  });
}

async function callCreateElicitation(repl, request) {
  const result = await callCreateElicitationTool(repl, request);
  const text = result.content?.find((item) => item.type === "text")?.text ?? "";
  assert.equal(result.isError, undefined, text);
  return JSON.parse(text);
}

async function callCreateElicitationError(repl, request) {
  const result = await callCreateElicitationTool(repl, request);
  const text = result.content?.find((item) => item.type === "text")?.text ?? "";
  assert.equal(result.isError, true);
  return text;
}

async function withRepl(env, fn) {
  const repl = startRepl(env);
  try {
    await repl.request("initialize", {});
    return await fn(repl);
  } finally {
    repl.close();
  }
}

async function testNodeReplExposesEnvForBrowserClient() {
  await withRepl(
    {
      BROWSER_USE_DISABLE_AMBIENT_NETWORK: "1",
      CODEX_BROWSER_BACKENDS_REGISTRY: "/tmp/codex-browser-backends-test.json",
    },
    async (repl) => {
      const result = await repl.request("tools/call", {
        name: "js",
        arguments: {
          code: `return {
            disableAmbientNetwork: nodeRepl.env?.BROWSER_USE_DISABLE_AMBIENT_NETWORK,
            registry: nodeRepl.env?.CODEX_BROWSER_BACKENDS_REGISTRY,
          };`,
        },
      });
      const text = result.content?.find((item) => item.type === "text")?.text ?? "";
      assert.equal(result.isError, undefined, text);
      assert.deepEqual(JSON.parse(text), {
        disableAmbientNetwork: "1",
        registry: "/tmp/codex-browser-backends-test.json",
      });
    },
  );
}

async function testNodeReplRecoversDesktopEnvFromSystemdUserEnvironment() {
  const tempDir = mkdtempSync(path.join(tmpdir(), "codex-node-repl-env-test-"));
  const binDir = path.join(tempDir, "bin");
  const systemctlPath = path.join(binDir, "systemctl");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    systemctlPath,
    `#!/usr/bin/env bash
if [ "$1" = "--user" ] && [ "$2" = "show-environment" ]; then
  cat <<'EOF'
DISPLAY=:77
WAYLAND_DISPLAY=wayland-test
XDG_RUNTIME_DIR=/run/user/777
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/777/bus
XAUTHORITY=/run/user/777/xauth_test
EOF
  exit 0
fi
exit 1
`,
  );
  chmodSync(systemctlPath, 0o755);

  try {
    await withRepl(
      {
        PATH: `${binDir}:${process.env.PATH}`,
        DISPLAY: "",
        WAYLAND_DISPLAY: "",
        XDG_RUNTIME_DIR: "",
        DBUS_SESSION_BUS_ADDRESS: "",
        XAUTHORITY: "",
      },
      async (repl) => {
        const result = await repl.request("tools/call", {
          name: "js",
          arguments: {
            code: `return {
              nodeReplDisplay: nodeRepl.env?.DISPLAY,
              processDisplay: process.env?.DISPLAY,
              wayland: nodeRepl.env?.WAYLAND_DISPLAY,
              xdg: nodeRepl.env?.XDG_RUNTIME_DIR,
              dbus: nodeRepl.env?.DBUS_SESSION_BUS_ADDRESS,
              xauthority: nodeRepl.env?.XAUTHORITY,
            };`,
          },
        });
        const text = result.content?.find((item) => item.type === "text")?.text ?? "";
        assert.equal(result.isError, undefined, text);
        assert.deepEqual(JSON.parse(text), {
          nodeReplDisplay: ":77",
          processDisplay: ":77",
          wayland: "wayland-test",
          xdg: "/run/user/777",
          dbus: "unix:path=/run/user/777/bus",
          xauthority: "/run/user/777/xauth_test",
        });
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testLocalOriginAcceptsWithoutClientApproval() {
  await withRepl({}, async (repl) => {
    const result = await callCreateElicitation(repl, makeBrowserApprovalRequest("http://127.0.0.1:5173"));
    assert.deepEqual(result, { action: "accept" });
  });
}

async function testDesktopApprovalAccepts() {
  const tempDir = mkdtempSync(path.join(tmpdir(), "codex-browser-approval-test-"));
  const socketPath = path.join(tempDir, "approval.sock");
  const server = await startJsonSocket(socketPath, async (request) => {
    assert.equal(request.meta?.tool_name, "access_browser_origin");
    return { ok: true, action: "accept" };
  });

  try {
    await withRepl({ CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET: socketPath }, async (repl) => {
      const result = await callCreateElicitation(repl, makeBrowserApprovalRequest("https://example.com"));
      assert.deepEqual(result, { action: "accept" });
    });
  } finally {
    server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testDesktopApprovalDeclines() {
  const tempDir = mkdtempSync(path.join(tmpdir(), "codex-browser-approval-test-"));
  const socketPath = path.join(tempDir, "approval.sock");
  const server = await startJsonSocket(socketPath, async () => ({ ok: true, action: "decline" }));

  try {
    await withRepl({ CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET: socketPath }, async (repl) => {
      const result = await callCreateElicitation(repl, makeBrowserApprovalRequest("https://example.com"));
      assert.deepEqual(result, { action: "decline" });
    });
  } finally {
    server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testHistoryApprovalUsesDesktopBridge() {
  const tempDir = mkdtempSync(path.join(tmpdir(), "codex-browser-approval-test-"));
  const socketPath = path.join(tempDir, "approval.sock");
  const server = await startJsonSocket(socketPath, async (request) => {
    assert.equal(request.meta?.sensitive_data, "browsing_history");
    return { ok: true, action: "accept" };
  });

  try {
    await withRepl({ CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET: socketPath }, async (repl) => {
      const result = await callCreateElicitation(repl, makeBrowserHistoryApprovalRequest());
      assert.deepEqual(result, { action: "accept" });
    });
  } finally {
    server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testFileTransferApprovalUsesDesktopBridge() {
  const tempDir = mkdtempSync(path.join(tmpdir(), "codex-browser-approval-test-"));
  const socketPath = path.join(tempDir, "approval.sock");
  const server = await startJsonSocket(socketPath, async (request) => {
    assert.equal(request.meta?.file_transfer, "download");
    assert.equal(request.meta?.origin, "https://example.com/path");
    return { ok: true, action: "accept" };
  });

  try {
    await withRepl({ CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET: socketPath }, async (repl) => {
      const result = await callCreateElicitation(
        repl,
        makeBrowserFileTransferApprovalRequest("download", "https://example.com/path"),
      );
      assert.deepEqual(result, { action: "accept" });
    });
  } finally {
    server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testLocalFileTransferAcceptsWithoutClientApproval() {
  await withRepl({}, async (repl) => {
    const result = await callCreateElicitation(
      repl,
      makeBrowserFileTransferApprovalRequest("upload", "http://localhost:3000/path"),
    );
    assert.deepEqual(result, { action: "accept" });
  });
}

async function testInvalidBrowserApprovalFailsClosed() {
  await withRepl({ CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET: "/tmp/does-not-matter.sock" }, async (repl) => {
    const result = await callCreateElicitation(
      repl,
      {
        message: "Allow something else?",
        meta: {
          codex_approval_kind: "mcp_tool_call",
          connector_id: "browser-use",
          tool_name: "upload_file",
          tool_params: { origin: "https://example.com" },
        },
      },
    );
    assert.deepEqual(result, { action: "decline" });
  });
}

async function testPublicOriginWithoutDesktopBridgeFailsClosed() {
  await withRepl({ CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET: "/tmp/codex-browser-approval-missing.sock" }, async (repl) => {
    const message = await callCreateElicitationError(repl, makeBrowserApprovalRequest("https://example.com"));
    assert.match(message, /Linux browser approval bridge unavailable/);
  });
}

await testNodeReplExposesEnvForBrowserClient();
await testNodeReplRecoversDesktopEnvFromSystemdUserEnvironment();
await testLocalOriginAcceptsWithoutClientApproval();
await testDesktopApprovalAccepts();
await testDesktopApprovalDeclines();
await testHistoryApprovalUsesDesktopBridge();
await testFileTransferApprovalUsesDesktopBridge();
await testLocalFileTransferAcceptsWithoutClientApproval();
await testInvalidBrowserApprovalFailsClosed();
await testPublicOriginWithoutDesktopBridgeFailsClosed();

console.error("[INFO] Linux node_repl browser approval tests passed");
