#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const installerRoot = path.dirname(scriptDir);
const pluginRoot = path.join(installerRoot, "plugins", "computer-use");
const localMarketplacePath = path.join(installerRoot, ".agents", "plugins", "marketplace.json");
const mcpScript = path.join(pluginRoot, "scripts", "computer-use-mcp.mjs");
const glowScript = path.join(pluginRoot, "scripts", "computer-use-glow-overlay.py");
const accessScript = path.join(scriptDir, "install-computer-use-access.sh");
const activateScript = path.join(scriptDir, "activate-install.sh");
const expectedTools = [
  "computer_begin_round",
  "computer_end_round",
  "computer_observe",
  "computer_list_desktops",
  "computer_list_apps",
  "computer_list_tray_items",
  "computer_list_windows",
  "computer_open_app",
  "computer_activate_tray_item",
  "computer_activate_window",
  "computer_click",
  "computer_drag",
  "computer_scroll",
  "computer_key",
  "computer_type",
  "computer_release_desktops",
  "computer_wait",
  "computer_get_accessibility_tree",
];

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

async function main() {
  assert.ok(existsSync(path.join(pluginRoot, ".codex-plugin", "plugin.json")), "missing plugin manifest");
  assert.ok(existsSync(path.join(pluginRoot, ".mcp.json")), "missing MCP manifest");
  assert.ok(existsSync(mcpScript), "missing MCP server");
  assert.ok(existsSync(glowScript), "missing cursor glow overlay helper");
  assert.ok(existsSync(accessScript), "missing Computer Use access helper");
  assert.ok(existsSync(activateScript), "missing activate helper");

  const manifest = readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
  assert.equal(manifest.name, "kde-computer-use");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.interface?.composerIcon, "./assets/computer-use.png");
  assert.match(manifest.description, /KDE Wayland/);
  assert.doesNotMatch(manifest.description, /ydotool|uinput/i);
  assert.doesNotMatch(manifest.interface?.longDescription ?? "", /ydotool|uinput/i);
  assert.ok(existsSync(path.join(pluginRoot, "assets", "computer-use.png")), "missing Computer Use icon");

  const localMarketplace = readJson(localMarketplacePath);
  assert.equal(localMarketplace.name, "local-plugins");
  const localPlugin = localMarketplace.plugins.find((plugin) => plugin.name === "kde-computer-use");
  assert.ok(localPlugin, "Expected installer local marketplace to include kde-computer-use");
  assert.equal(localPlugin.source.path, "./plugins/computer-use");
  assert.equal(localPlugin.policy.installation, "AVAILABLE");
  assert.equal(localPlugin.policy.authentication, "ON_INSTALL");
  assert.equal(localPlugin.category, "Productivity");

  const mcp = readJson(path.join(pluginRoot, ".mcp.json"));
  assert.equal(mcp?.["computer-use"]?.command, "node");
  assert.deepEqual(mcp?.["computer-use"]?.args, ["./scripts/computer-use-mcp.mjs"]);
  assert.equal(mcp?.["computer-use"]?.cwd, ".");
  assert.equal(mcp.mcp_servers, undefined);
  assert.equal(mcp.mcpServers, undefined);

  const brokerSource = readFileSync(path.join(pluginRoot, "scripts", "computer-use-broker.py"), "utf8");
  assert.match(brokerSource, /org\.kde\.KWin\.ScreenShot2/);
  assert.match(brokerSource, /org\.freedesktop\.host\.portal\.Registry/);
  assert.match(brokerSource, /CODEX_COMPUTER_USE_PORTAL_APP_ID/);
  assert.match(brokerSource, /ensure_portal_input/);
  assert.doesNotMatch(brokerSource, /CODEX_COMPUTER_USE_INPUT_BACKEND/);
    assert.match(brokerSource, /list_desktops/);
    assert.match(brokerSource, /StatusNotifierWatcher/);
    assert.match(brokerSource, /StatusNotifierItem/);
    assert.match(brokerSource, /desktopOne/);
  assert.match(brokerSource, /moveToDesktopOne/);
  assert.match(brokerSource, /captureDesktopSnapshot/);
  assert.match(brokerSource, /restoreDesktopSnapshot/);
  assert.match(brokerSource, /release_desktops/);
  assert.match(brokerSource, /with_active_window_on_desktop_one/);
  assert.match(brokerSource, /allow_portal_fallback/);
  assert.doesNotMatch(brokerSource, /ydotool|uinput/i);

  const accessSource = readFileSync(accessScript, "utf8");
  assert.match(accessSource, /kde-authorized/);
  assert.match(accessSource, /remote-desktop/);
  assert.match(accessSource, /Removed stale Computer Use direct input service/);
  assert.doesNotMatch(accessSource, /ExecStart=.*ydotool|codex-computer-use-ydotool\.socket|\/dev\/uinput/i);

  const activateSource = readFileSync(activateScript, "utf8");
  assert.match(activateSource, /X-KDE-DBUS-Restricted-Interfaces=org\.kde\.KWin\.ScreenShot2/);
  assert.match(activateSource, /DESKTOP_ENTRY_KWIN_ALIAS_PATH/);
  assert.match(activateSource, /codex\.desktop/);

  const client = startMcpServer();
  try {
    const init = await client.request("initialize", { protocolVersion: "2025-06-18" });
    assert.equal(init.result.serverInfo.name, "computer-use");
    assert.match(init.result.instructions, /KDE Wayland/);
    assert.match(init.result.instructions, /foreground/);
    assert.match(init.result.instructions, /KWin ScreenShot2/);
    assert.match(init.result.instructions, /RemoteDesktop/);
    assert.doesNotMatch(init.result.instructions, /ydotool|uinput/i);

    const listed = await client.request("tools/list", {});
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), expectedTools);
    const inputTools = new Set(["computer_click", "computer_drag", "computer_scroll", "computer_key", "computer_type"]);
    for (const tool of listed.result.tools) {
      assert.equal(tool.inputSchema.type, "object", `${tool.name} schema should be object`);
      assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} should reject unknown fields`);
      assert.ok(tool.description.length >= 20, `${tool.name} needs a useful description`);

      const backend = tool.inputSchema.properties?.backend;
      if (tool.name === "computer_observe" || tool.name === "computer_wait") {
        assert.equal(backend.default, "direct", `${tool.name} screenshot backend should default to direct`);
      } else if (inputTools.has(tool.name)) {
        assert.equal(backend, undefined, `${tool.name} should not expose an input backend selector`);
        assert.doesNotMatch(tool.description, /ydotool|uinput/i, `${tool.name} should not mention direct input helpers`);
      } else if (backend) {
        assert.fail(`${tool.name} should not expose a backend selector`);
      }
      const allowPortalFallback = tool.inputSchema.properties?.allow_portal_fallback;
      if (tool.name === "computer_observe" || tool.name === "computer_wait") {
        assert.equal(allowPortalFallback.default, false, `${tool.name} should not silently fall back to portal prompts`);
      } else {
        assert.equal(allowPortalFallback, undefined, `${tool.name} should not expose portal fallback`);
      }
    }

    const appsResult = await client.request("tools/call", {
      name: "computer_list_apps",
      arguments: { query: "dolphin", limit: 5, include_hidden: false },
    });
    const appsText = appsResult.result.content?.find((item) => item.type === "text")?.text ?? "{}";
    assert.equal(appsResult.result.isError, undefined, appsText);
    const apps = JSON.parse(appsText);
    assert.equal(apps.backend, "desktop-entry");
    assert.equal(apps.query, "dolphin");
    assert.equal(apps.limit, 5);
    assert.ok(Array.isArray(apps.apps));
    assert.ok(apps.apps.length <= 5);
    for (const app of apps.apps) {
      assert.equal(typeof app.desktop_id, "string");
      assert.equal(typeof app.name, "string");
      assert.equal(typeof app.exec, "string");
      assert.equal(typeof app.hidden, "boolean");
    }

    const trayTool = listed.result.tools.find((tool) => tool.name === "computer_activate_tray_item");
    assert.ok(trayTool, "missing tray activation tool");
    assert.equal(trayTool.inputSchema.properties.query.type, "string");
    assert.equal(trayTool.inputSchema.properties.action.default, "activate");

    const windowTool = listed.result.tools.find((tool) => tool.name === "computer_list_windows");
    assert.ok(windowTool, "missing window listing tool");
    assert.deepEqual(windowTool.inputSchema.properties.detail.enum, ["summary", "full"]);
    assert.equal(windowTool.inputSchema.properties.detail.default, "summary");
    assert.equal(windowTool.inputSchema.properties.limit.default, 50);

    const openAppTool = listed.result.tools.find((tool) => tool.name === "computer_open_app");
    assert.ok(openAppTool, "missing app launch tool");
    assert.equal(openAppTool.inputSchema.properties.reuse_existing.type, "boolean");
    assert.equal(openAppTool.inputSchema.properties.reuse_existing.default, false);
  } finally {
    client.stop();
  }
}

function startMcpServer() {
  const child = spawn(process.execPath, [mcpScript], {
    cwd: pluginRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
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
          reject(new Error(`Timed out waiting for ${method}\n${stderr}`));
        }, 5_000);
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
