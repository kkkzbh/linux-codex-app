#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const installerRoot = path.dirname(scriptDir);
const pluginRoot = path.join(installerRoot, "plugins", "computer-use");
const mcpScript = path.join(pluginRoot, "scripts", "computer-use-mcp.mjs");
const args = new Set(process.argv.slice(2));
const shouldObserve = args.has("--observe");
const shouldInput = args.has("--input");
const backendArg = process.argv.find((arg) => arg.startsWith("--backend="));
const backend = backendArg ? backendArg.slice("--backend=".length) : null;

function usage() {
  return `Usage: smoke-computer-use-plugin.mjs [--observe] [--input] [--backend=direct|portal|auto]

Default smoke checks KWin window listing through the MCP server.
--observe additionally captures one frame. It defaults to direct KWin ScreenShot2.
--input additionally sends Escape through KDE RemoteDesktop portal.`;
}

if (args.has("--help")) {
  console.log(usage());
  process.exit(0);
}

async function main() {
  const client = startMcpServer();
  try {
    await client.request("initialize", { protocolVersion: "2025-06-18" });

    const windows = await callTool(client, "computer_list_windows", {});
    assert.equal(windows.backend, "kwin-scripting");
    assert.ok(Array.isArray(windows.windows));
    assert.ok(windows.windows.length > 0, "expected at least one KWin window");
    const active = windows.windows.find((window) => window.active);
    console.log(`windows=${windows.windows.length} active=${active?.caption ?? "<none>"}`);

    if (shouldObserve) {
      const observed = await callTool(client, "computer_observe", {
        include_image: true,
        include_windows: false,
        timeout_ms: 120000,
        backend: backend ?? "direct",
      });
      assert.ok(observed.image?.width > 0);
      assert.ok(observed.image?.height > 0);
      console.log(`observe=${observed.backend}:${observed.image.width}x${observed.image.height} stream=${observed.stream?.id}`);
    }

    if (shouldInput) {
      const input = await callTool(client, "computer_key", {
        key: "escape",
        modifiers: [],
        repeat: 1,
      });
      assert.equal(input.pressed, true);
      console.log(`input=${input.backend}:escape`);
    }
  } finally {
    client.stop();
  }
}

async function callTool(client, name, toolArgs) {
  const response = await client.request("tools/call", {
    name,
    arguments: toolArgs,
  });
  const text = response.result.content?.find((item) => item.type === "text")?.text ?? "{}";
  assert.equal(response.result.isError, undefined, text);
  return JSON.parse(text);
}

function startMcpServer() {
  const child = spawn(process.execPath, [mcpScript], {
    cwd: pluginRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  const pending = new Map();
  child.stdout.setEncoding("utf8");
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        break;
      }
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) {
        continue;
      }
      const message = JSON.parse(line);
      const pendingRequest = pending.get(message.id);
      if (pendingRequest) {
        pending.delete(message.id);
        clearTimeout(pendingRequest.timer);
        pendingRequest.resolve(message);
      }
    }
  });

  let nextId = 1;
  return {
    request(method, params = {}) {
      const id = nextId++;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for ${method}`));
        }, 180000);
        pending.set(id, { resolve, reject, timer });
      });
    },
    stop() {
      child.kill();
    },
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
