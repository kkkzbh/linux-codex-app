#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const installerRoot = path.dirname(scriptDir);
const pluginRoot = path.resolve(
  process.env.CODEX_COMPUTER_USE_PLUGIN_ROOT ?? path.join(installerRoot, "plugins", "computer-use"),
);
const mcpScript = path.join(pluginRoot, "scripts", "computer-use-mcp.mjs");
const args = new Set(process.argv.slice(2));
const shouldObserve = args.has("--observe");
const shouldInput = args.has("--input");
const shouldTestIsolated = args.has("--isolated");
const rootQueryIndex = process.argv.indexOf("--root-query");
const rootQuery = rootQueryIndex >= 0 ? process.argv[rootQueryIndex + 1] : null;

if (rootQueryIndex >= 0 && !rootQuery) {
  throw new Error("--root-query requires a window title or application substring");
}

function usage() {
  return `Usage: smoke-computer-use-plugin.mjs [--observe] [--input] [--isolated] [--root-query QUERY]

Default smoke checks KWin window-root discovery through the MCP server.
--observe additionally creates a state and captures the target window.
--input additionally sends Escape in a state-scoped foreground transaction.
--isolated launches System Settings in a private KWin session and verifies ref-based pointer delivery.
--root-query selects an exact smoke target from discovered windows by title or application substring.`;
}

if (args.has("--help")) {
  console.log(usage());
  process.exit(0);
}

async function main() {
  const client = startMcpServer();
  try {
    await client.request("initialize", { protocolVersion: "2025-06-18" });

    if (!shouldTestIsolated || shouldObserve || shouldInput) {
      await testForegroundRoute(client);
    }

    if (shouldTestIsolated) {
      await testIsolatedRefPointer(client);
    }
  } finally {
    client.stop();
  }
}

async function testForegroundRoute(client) {
  const roots = await callTool(client, "find_roots", {
    kind: "window",
    foreground_reason: "Smoke test explicitly verifies the user's existing foreground window route",
  });
  assert.equal(roots.protocolVersion, 2);
  assert.ok(Array.isArray(roots.roots));
  assert.ok(roots.roots.length > 0, "expected at least one KWin window root");
  assert.ok(roots.roots.every((root) => root.routing?.target === "foreground"));
  const normalizedQuery = rootQuery?.toLocaleLowerCase();
  const active = normalizedQuery
    ? roots.roots.find((root) => `${root.title} ${root.app}`.toLocaleLowerCase().includes(normalizedQuery))
    : roots.roots.find((root) => root.active) ?? roots.roots[0];
  assert.ok(active, `no discovered window matched --root-query ${rootQuery}`);
  console.log(`roots=${roots.roots.length} active=${active?.title ?? "<none>"} route=foreground`);

  let observed = null;
  if (shouldObserve || shouldInput) {
    observed = await callTool(client, "observe_ui", {
      rootRef: active.rootRef,
      include_image: true,
      timeout_ms: 120000,
    });
    assert.ok(observed.image?.width > 0);
    assert.ok(observed.image?.height > 0);
    assertUsableAccessibilityCoordinates(observed);
    console.log(
      `observe=${observed.stateId}:${observed.image.width}x${observed.image.height} epoch=${observed.epoch}`
      + ` atspi=${observed.coordinateSpace.accessibility_source_space}`,
    );
  }

  if (shouldInput) {
    const input = await callTool(client, "act_ui", {
      stateId: observed.stateId,
      policy: "foreground",
      actions: [{ op: "key", key: "escape", modifiers: [] }],
      include_image: false,
    });
    assert.equal(input.outcome, "unknown");
    assert.equal(input.observation.outline.nodes, undefined);
    console.log(`input=${input.outcome}:escape successor=${input.observation.stateId}`);
  }
}

function assertUsableAccessibilityCoordinates(observation) {
  const nodes = observation.outline?.nodes ?? [];
  if (nodes.length === 0) {
    return;
  }
  assert.match(observation.coordinateSpace.accessibility_source_space, /^(screen|window-local)$/);
  const rootNode = nodes.find((node) => node.depth === 0 && node.bounds != null);
  assert.ok(rootNode, "expected a bounded accessibility root node");
  const centerX = rootNode.bounds.x + rootNode.bounds.width / 2;
  const centerY = rootNode.bounds.y + rootNode.bounds.height / 2;
  assert.ok(centerX >= 0 && centerX <= observation.coordinateSpace.width, "accessibility root is outside the window image on x");
  assert.ok(centerY >= 0 && centerY <= observation.coordinateSpace.height, "accessibility root is outside the window image on y");
}

async function testIsolatedRefPointer(client) {
  const started = await callTool(client, "isolated_start", {
    screen_width: 1280,
    screen_height: 800,
    timeout_ms: 120000,
  });
  const sessionId = started.session_id;
  try {
    const apps = await callTool(client, "find_roots", {
      session_id: sessionId,
      kind: "application",
      query: "systemsettings",
    });
    assert.ok(apps.roots.length > 0, "expected the System Settings desktop entry");
    const appState = await callTool(client, "observe_ui", {
      session_id: sessionId,
      rootRef: apps.roots[0].rootRef,
      include_image: false,
    });
    await callTool(client, "act_ui", {
      session_id: sessionId,
      stateId: appState.stateId,
      policy: "semantic_only",
      actions: [{ op: "press", ref: appState.outline.nodes[0].ref }],
      include_image: false,
    });

    const windowRoot = await waitForWindowRoot(client, sessionId, "systemsettings");
    const observed = await callTool(client, "observe_ui", {
      session_id: sessionId,
      rootRef: windowRoot.rootRef,
      include_image: true,
      timeout_ms: 120000,
    });
    assertUsableAccessibilityCoordinates(observed);
    const editable = observed.outline.nodes.find((node) => (
      node.capabilities?.includes("editable_text") && boundsCenterIsInsideImage(node.bounds, observed.coordinateSpace)
    ));
    assert.ok(editable?.ref, "expected a visible editable System Settings search field");
    const marker = `isolated-ref-${Date.now()}`;
    const acted = await callTool(client, "act_ui", {
      session_id: sessionId,
      stateId: observed.stateId,
      policy: "foreground",
      actions: [
        { op: "click", ref: editable.ref },
        { op: "type_text", text: marker },
      ],
      expect: { text: marker, timeout_ms: 10000 },
      include_image: false,
      timeout_ms: 120000,
    });
    assert.equal(acted.outcome, "worked");
    assert.equal(acted.observation.outline.nodes, undefined);
    assert.equal(windowRoot.routing?.target, "isolated");
    const closed = await callTool(client, "act_ui", {
      session_id: sessionId,
      stateId: acted.observation.stateId,
      policy: "foreground",
      actions: [{ op: "key", key: "f4", modifiers: ["alt"] }],
      expect: { gone: true, timeout_ms: 10000 },
      include_image: false,
      timeout_ms: 120000,
    });
    assert.equal(closed.outcome, "worked");
    assert.equal(closed.observation.root.present, false);
    console.log(
      `isolated=${sessionId} ref-click=${acted.outcome} root-gone=${closed.outcome}`
      + ` atspi=${observed.coordinateSpace.accessibility_source_space}`,
    );
  } finally {
    await callTool(client, "isolated_stop", { session_id: sessionId, force: true });
  }
}

function boundsCenterIsInsideImage(bounds, coordinateSpace) {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return false;
  }
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return centerX >= 0 && centerX <= coordinateSpace.width && centerY >= 0 && centerY <= coordinateSpace.height;
}

async function waitForWindowRoot(client, sessionId, query) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const windows = await callTool(client, "find_roots", {
      session_id: sessionId,
      kind: "window",
      query,
    });
    if (windows.roots.length > 0) {
      return windows.roots[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for isolated window: ${query}`);
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
