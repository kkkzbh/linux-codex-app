#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDolphinController, DOLPHIN_TOOLS } from "../plugins/dolphin/scripts/dolphin-lib.mjs";
import { assertPluginManifestBasics, runPluginValidatorIfAvailable } from "./plugin-test-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const installerRoot = path.dirname(scriptDir);
const pluginRoot = path.join(installerRoot, "plugins", "dolphin");
const mcpScript = path.join(pluginRoot, "scripts", "dolphin-mcp.mjs");
const marketplaceFilterScript = path.join(scriptDir, "filter-bundled-marketplace.mjs");
const marketplaceAddScript = path.join(scriptDir, "add-local-bundled-marketplace-plugins.mjs");
const dolphinWindowAccessScript = path.join(scriptDir, "install-dolphin-window-access.sh");

function makeTempDir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function parseJsonTextToolResult(result) {
  const text = result.content?.find((item) => item.type === "text")?.text ?? "";
  assert.equal(result.isError, undefined, text);
  return JSON.parse(text);
}

function assertCommandCall(calls, command, argsPrefix) {
  const call = calls.find(
    (candidate) =>
      candidate.command === command &&
      argsPrefix.every((value, index) => candidate.args[index] === value),
  );
  assert.ok(call, `Missing command call: ${command}`);
  assert.deepEqual(call.args.slice(0, argsPrefix.length), argsPrefix);
  return call;
}

async function testControllerTools() {
  const tempDir = makeTempDir("codex-dolphin-tools-");
  const detachedCalls = [];
  const bufferedCalls = [];
  const inputCalls = [];
  let fakeA11ySnapshot;
  const env = {
    WAYLAND_DISPLAY: "wayland-1",
    CODEX_DOLPHIN_BIN: "dolphin-test",
    CODEX_DOLPHIN_TRASH_BIN: "gio-test",
    CODEX_DOLPHIN_CLIPBOARD_BIN: "wl-copy-test",
    CODEX_DOLPHIN_DBUS_SEND_BIN: "dbus-send-test",
    CODEX_DOLPHIN_TERMINAL_BIN: "konsole",
  };
  const controller = createDolphinController({
    cwd: tempDir,
    homedir: tempDir,
    env,
    queryA11y: async () => fakeA11ySnapshot,
    runDetached: async (command, args, options = {}) => {
      detachedCalls.push({ command, args, options });
      return { pid: 4242 };
    },
    runBuffered: async (command, args, options = {}) => {
      bufferedCalls.push({ command, args, options });
      return { stdout: "ok\n", stderr: "" };
    },
    runWithInput: async (command, args, input, options = {}) => {
      inputCalls.push({ command, args, input, options });
      return { stdout: "", stderr: "" };
    },
  });

  try {
    await writeFile(path.join(tempDir, "alpha.txt"), "alpha");
    await writeFile(path.join(tempDir, "select-a.txt"), "select a");
    await writeFile(path.join(tempDir, "select-b.txt"), "select b");
    await writeFile(path.join(tempDir, ".hidden.txt"), "hidden");
    await mkdir(path.join(tempDir, "nested"));
    await writeFile(path.join(tempDir, "nested", "beta.txt"), "beta");
    await mkdir(path.join(tempDir, "selected-copy"));

    fakeA11ySnapshot = {
      ok: true,
      backend: "atspi-test",
      warnings: [],
      setup_hint: "test hint",
      windows: [
        {
          window_id: "atspi:0:0",
          title: `${tempDir} — Dolphin`,
          current_directory: tempDir,
          focused: true,
          active: false,
          accessible: true,
          selected_items: [
            {
              name: "select-a.txt",
              path: path.join(tempDir, "select-a.txt"),
              states: ["selected"],
            },
            {
              name: "select-b.txt",
              path: path.join(tempDir, "select-b.txt"),
              states: ["selected"],
            },
          ],
          selected_paths: [path.join(tempDir, "select-a.txt"), path.join(tempDir, "select-b.txt")],
          selected_count: 2,
          file_view_names: [path.basename(tempDir)],
        },
      ],
    };
    const created = await controller.callTool("dolphin_create_folder", { path: "created/deep" });
    assert.equal(created.created, true);
    assert.ok(existsSync(path.join(tempDir, "created", "deep")));

    const listed = await controller.callTool("dolphin_list_directory", {
      path: ".",
      recursive: true,
      max_entries: 20,
    });
    assert.equal(listed.path, tempDir);
    assert.equal(listed.entries.some((entry) => entry.name === ".hidden.txt"), false);
    assert.equal(listed.entries.some((entry) => entry.relative_path === "nested/beta.txt"), true);

    const listedHidden = await controller.callTool("dolphin_list_directory", {
      path: ".",
      include_hidden: true,
    });
    assert.equal(listedHidden.entries.some((entry) => entry.name === ".hidden.txt"), true);

    const windows = await controller.callTool("dolphin_list_windows", {});
    assert.equal(windows.windows.length, 1);
    assert.equal(windows.windows[0].selected_count, 2);

    const selection = await controller.callTool("dolphin_get_selection", {});
    assert.deepEqual(selection.selected_paths, fakeA11ySnapshot.windows[0].selected_paths);

    const windowDirectory = await controller.callTool("dolphin_list_window_directory", { max_entries: 20 });
    assert.equal(windowDirectory.path, tempDir);
    assert.equal(windowDirectory.entries.some((entry) => entry.name === "select-a.txt"), true);

    const selectionList = await controller.callTool("dolphin_operate_on_selection", { operation: "list" });
    assert.deepEqual(selectionList.selected_paths, fakeA11ySnapshot.windows[0].selected_paths);

    const selectionCopy = await controller.callTool("dolphin_operate_on_selection", {
      operation: "copy_to",
      destination: "selected-copy",
    });
    assert.equal(selectionCopy.results.length, 2);
    assert.ok(existsSync(path.join(tempDir, "selected-copy", "select-a.txt")));

    const selectionClipboard = await controller.callTool("dolphin_operate_on_selection", {
      operation: "copy_paths_to_clipboard",
      clipboard_format: "paths",
    });
    assert.equal(selectionClipboard.action, "selection_copy_paths_to_clipboard");

    const selectionTrash = await controller.callTool("dolphin_operate_on_selection", { operation: "trash" });
    assert.equal(selectionTrash.results.length, 2);

    const selectionProperties = await controller.callTool("dolphin_operate_on_selection", { operation: "show_properties" });
    assert.equal(selectionProperties.action, "selection_show_properties");

    const selectionReveal = await controller.callTool("dolphin_operate_on_selection", { operation: "reveal_first" });
    assert.equal(selectionReveal.action, "selection_reveal_first");

    const windowFolder = await controller.callTool("dolphin_open_window_context", { mode: "folder" });
    assert.equal(windowFolder.path, tempDir);

    const windowSelection = await controller.callTool("dolphin_open_window_context", { mode: "selection" });
    assert.equal(windowSelection.path, path.join(tempDir, "select-a.txt"));

    const search = await controller.callTool("dolphin_search", { path: ".", query: "bet" });
    assert.equal(search.results.length, 1);
    assert.equal(search.results[0].relative_path, "nested/beta.txt");

    const renamed = await controller.callTool("dolphin_rename_path", {
      path: "alpha.txt",
      new_name: "renamed.txt",
    });
    assert.equal(renamed.destination, path.join(tempDir, "renamed.txt"));
    assert.ok(existsSync(path.join(tempDir, "renamed.txt")));

    await assert.rejects(
      () => controller.callTool("dolphin_rename_path", { path: "renamed.txt", new_name: "../bad.txt" }),
      /simple basename/,
    );

    const copied = await controller.callTool("dolphin_copy_path", {
      source: "renamed.txt",
      destination: "copied.txt",
    });
    assert.equal(copied.destination, path.join(tempDir, "copied.txt"));
    assert.ok(existsSync(path.join(tempDir, "copied.txt")));

    await assert.rejects(
      () => controller.callTool("dolphin_copy_path", { source: "renamed.txt", destination: "copied.txt" }),
      /Destination already exists/,
    );

    const moved = await controller.callTool("dolphin_move_path", {
      source: "copied.txt",
      destination: "moved.txt",
    });
    assert.equal(moved.destination, path.join(tempDir, "moved.txt"));
    assert.ok(existsSync(path.join(tempDir, "moved.txt")));
    assert.equal(existsSync(path.join(tempDir, "copied.txt")), false);

    const opened = await controller.callTool("dolphin_open_path", { path: ".", mode: "new_window" });
    assert.equal(opened.command, "dolphin-test");
    assert.deepEqual(opened.args, ["--new-window", tempDir]);

    const revealed = await controller.callTool("dolphin_reveal_path", { path: "moved.txt" });
    assert.equal(revealed.command, "dolphin-test");
    assert.deepEqual(revealed.args, ["--select", path.join(tempDir, "moved.txt")]);

    const properties = await controller.callTool("dolphin_show_properties", { paths: ["moved.txt"] });
    assert.equal(properties.command, "dbus-send-test");
    assert.ok(properties.args.includes("org.freedesktop.FileManager1.ShowItemProperties"));
    assert.ok(properties.uris[0].startsWith("file://"));

    const terminal = await controller.callTool("dolphin_open_terminal", { path: "moved.txt" });
    assert.equal(terminal.working_directory, tempDir);
    assert.deepEqual(terminal.args, ["--workdir", tempDir]);

    const trashed = await controller.callTool("dolphin_move_to_trash", { path: "moved.txt" });
    assert.equal(trashed.command, "gio-test");
    assert.deepEqual(trashed.args, ["trash", path.join(tempDir, "moved.txt")]);

    const clipboard = await controller.callTool("dolphin_copy_paths_to_clipboard", {
      paths: ["renamed.txt"],
      format: "uris",
    });
    assert.equal(clipboard.mimeType, "text/uri-list");
    const pathClipboardCall = assertCommandCall(inputCalls, "wl-copy-test", ["--type", "text/plain"]);
    assert.match(pathClipboardCall.input, /select-a\.txt\n/);
    const uriClipboardCall = assertCommandCall(inputCalls, "wl-copy-test", ["--type", "text/uri-list"]);
    assert.match(uriClipboardCall.input, /^file:\/\/.*renamed\.txt\n$/);

    assertCommandCall(detachedCalls, "dolphin-test", ["--new-window"]);
    assertCommandCall(bufferedCalls, "gio-test", ["trash"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
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
  function request(method, params = {}) {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}\n${stderr}`));
      }, 5_000);
      pending.set(id, { resolve, reject, timer });
    });
  }

  return {
    request,
    close: () => child.kill("SIGTERM"),
  };
}

async function testLineDelimitedMcpServer() {
  const tempDir = makeTempDir("codex-dolphin-mcp-");
  const server = startMcpServer();
  try {
    await writeFile(path.join(tempDir, "item.txt"), "item");
    const initialize = await server.request("initialize", { protocolVersion: "2025-06-18" });
    assert.equal(initialize.result.serverInfo.name, "dolphin");

    const toolList = await server.request("tools/list");
    const toolNames = toolList.result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(toolNames, DOLPHIN_TOOLS.map((tool) => tool.name).sort());

    const call = await server.request("tools/call", {
      name: "dolphin_list_directory",
      arguments: { path: tempDir },
    });
    const result = parseJsonTextToolResult(call.result);
    assert.equal(result.entries.some((entry) => entry.name === "item.txt"), true);
  } finally {
    server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testHeaderDelimitedMcpServer() {
  const child = spawn(process.execPath, [mcpScript], {
    cwd: pluginRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });

  try {
    const responsePromise = readHeaderMessage(child.stdout);
    const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: {} });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
    const response = await responsePromise;
    assert.deepEqual(response, { jsonrpc: "2.0", id: 1, result: {} });
  } finally {
    child.kill("SIGTERM");
  }
}

function readHeaderMessage(stream) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for header-delimited MCP response"));
    }, 5_000);
    const cleanup = () => {
      clearTimeout(timer);
      stream.off("data", onData);
    };
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      const separator = buffer.indexOf("\r\n\r\n");
      if (separator < 0) {
        return;
      }
      const headerText = buffer.subarray(0, separator).toString("ascii");
      const length = Number.parseInt(headerText.match(/^Content-Length:\s*(\d+)$/im)?.[1] ?? "", 10);
      if (!Number.isInteger(length)) {
        cleanup();
        reject(new Error(`Invalid header response: ${headerText}`));
        return;
      }
      const bodyStart = separator + 4;
      if (buffer.length < bodyStart + length) {
        return;
      }
      const payload = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      cleanup();
      resolve(JSON.parse(payload));
    };
    stream.on("data", onData);
  });
}

function testMarketplaceScripts() {
  const tempDir = makeTempDir("codex-dolphin-marketplace-");
  try {
    const sourcePath = path.join(tempDir, "source.json");
    const destPath = path.join(tempDir, "dest.json");
    writeFileSync(
      sourcePath,
      JSON.stringify({
        name: "openai-bundled",
        interface: { displayName: "OpenAI Bundled" },
        plugins: ["browser", "chrome", "latex", "computer-use"].map((name) => ({
          name,
          source: { source: "local", path: `./plugins/${name}` },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Productivity",
        })),
      }),
    );

    let run = spawnSync(process.execPath, [marketplaceFilterScript, sourcePath, destPath, "browser", "chrome", "latex"], {
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);

    run = spawnSync(process.execPath, [marketplaceAddScript, destPath, "dolphin"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);

    run = spawnSync(process.execPath, [marketplaceAddScript, destPath, "kde-computer-use=computer-use"], {
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);

    const marketplace = JSON.parse(readFileSync(destPath, "utf8"));
    assert.deepEqual(marketplace.plugins.map((plugin) => plugin.name), [
      "browser",
      "chrome",
      "latex",
      "dolphin",
      "kde-computer-use",
    ]);
    const dolphin = marketplace.plugins.find((plugin) => plugin.name === "dolphin");
    assert.ok(dolphin, "Expected marketplace to include dolphin");
    assert.equal(dolphin.source.path, "./plugins/dolphin");
    assert.equal(dolphin.policy.installation, "AVAILABLE");
    assert.equal(dolphin.policy.authentication, "ON_INSTALL");

    const computerUse = marketplace.plugins.find((plugin) => plugin.name === "kde-computer-use");
    assert.ok(computerUse, "Expected marketplace to include kde-computer-use");
    assert.equal(computerUse.source.path, "./plugins/computer-use");

    run = spawnSync(process.execPath, [marketplaceAddScript, destPath, "dolphin"], { encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /already contains local plugin entries/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function testPluginMetadata() {
  const manifest = JSON.parse(readFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  assertPluginManifestBasics(manifest, pluginRoot);
  assert.equal(manifest.name, "dolphin");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(manifest.interface.composerIcon, "./assets/org.kde.dolphin.png");
  assert.ok(existsSync(path.join(pluginRoot, "assets", "org.kde.dolphin.png")));
  assert.ok(existsSync(path.join(pluginRoot, "scripts", "dolphin-a11y.py")));

  const mcpManifest = JSON.parse(readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8"));
  assert.equal(mcpManifest.mcp_servers, undefined);
  assert.equal(mcpManifest.mcpServers, undefined);
  assert.equal(mcpManifest.dolphin.command, "node");
  assert.deepEqual(mcpManifest.dolphin.args, ["./scripts/dolphin-mcp.mjs"]);
  assert.equal(mcpManifest.dolphin.cwd, ".");

  runPluginValidatorIfAvailable(pluginRoot, "dolphin");
}

function testDolphinWindowAccessInstaller() {
  const tempDir = makeTempDir("codex-dolphin-access-");
  try {
    const dataHome = path.join(tempDir, "data-home");
    const dataDir = path.join(tempDir, "data-dir");
    const binHome = path.join(tempDir, "bin-home");
    const fakeSystemBin = path.join(tempDir, "system-bin");
    const sourceApplications = path.join(dataDir, "applications");
    mkdirSync(sourceApplications, { recursive: true });
    mkdirSync(fakeSystemBin, { recursive: true });
    writeFileSync(path.join(fakeSystemBin, "dolphin"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(
      path.join(sourceApplications, "org.kde.dolphin.desktop"),
      [
        "[Desktop Entry]",
        "Name=Dolphin",
        "Exec=dolphin %u",
        "Icon=org.kde.dolphin",
        "Type=Application",
        "",
        "[Desktop Action new-window]",
        "Exec=dolphin --new-window",
        "",
      ].join("\n"),
    );

    const run = spawnSync("bash", [dolphinWindowAccessScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        XDG_DATA_HOME: dataHome,
        XDG_DATA_DIRS: dataDir,
        XDG_BIN_HOME: binHome,
        PATH: `${fakeSystemBin}:${process.env.PATH}`,
        CODEX_DOLPHIN_WINDOW_ACCESS_UPDATE_SESSION: "0",
      },
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);

    const generated = readFileSync(path.join(dataHome, "applications", "org.kde.dolphin.desktop"), "utf8");
    assert.match(generated, /X-Codex-DolphinWindowAccess=true/);
    assert.match(generated, /Exec=env QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 dolphin %u/);
    assert.match(generated, /Exec=env QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 dolphin --new-window/);

    const wrapper = readFileSync(path.join(binHome, "dolphin"), "utf8");
    assert.match(wrapper, /Codex Dolphin window access wrapper/);
    assert.match(wrapper, /QT_LINUX_ACCESSIBILITY_ALWAYS_ON/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  testPluginMetadata();
  testDolphinWindowAccessInstaller();
  testMarketplaceScripts();
  await testControllerTools();
  await testLineDelimitedMcpServer();
  await testHeaderDelimitedMcpServer();
  console.log("Dolphin plugin tests passed");
}

await main();
