#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createKittyController, KITTY_TOOLS } from "../plugins/kitty/scripts/kitty-lib.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const installerRoot = path.dirname(scriptDir);
const pluginRoot = path.join(installerRoot, "plugins", "kitty");
const localMarketplacePath = path.join(installerRoot, ".agents", "plugins", "marketplace.json");
const mcpScript = path.join(pluginRoot, "scripts", "kitty-mcp.mjs");
const marketplaceFilterScript = path.join(scriptDir, "filter-bundled-marketplace.mjs");
const marketplaceAddScript = path.join(scriptDir, "add-local-bundled-marketplace-plugins.mjs");
const kittyWindowAccessScript = path.join(scriptDir, "install-kitty-window-access.sh");
const pluginValidator = "/home/kkkzbh/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py";

function makeTempDir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function parseJsonTextToolResult(result) {
  const text = result.content?.find((item) => item.type === "text")?.text ?? "";
  assert.equal(result.isError, undefined, text);
  return JSON.parse(text);
}

function assertCommandCall(calls, command, subcommand) {
  const call = calls.find((candidate) => candidate.command === command && candidate.args.includes(subcommand));
  assert.ok(call, `Missing command call: ${command} ${subcommand}`);
  return call;
}

function fakeKittyLs() {
  return JSON.stringify([
    {
      id: 1,
      tabs: [
        {
          id: 7,
          title: "tab",
          layout: "splits",
          active_window_history: [42],
          windows: [
            {
              id: 42,
              title: "codex",
              cwd: "/tmp",
              pid: 4242,
              cmdline: ["sh"],
              is_active: true,
              is_focused: true,
            },
          ],
        },
      ],
    },
  ]);
}

async function testControllerTools() {
  const tempDir = makeTempDir("codex-kitty-tools-");
  const stateRoot = path.join(tempDir, "state");
  const bufferedCalls = [];
  const detachedCalls = [];
  const inputCalls = [];
  const ids = ["ki_test", "kr_nowait", "kr_wait"];
  let nowMs = 1_800_000_000_000;

  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: {
      CODEX_KITTY_BIN: "kitty-test",
      CODEX_KITTEN_BIN: "kitten-test",
    },
    nowMs: () => nowMs++,
    sleep: async (ms) => {
      nowMs += ms;
    },
    makeId: (prefix) => ids.shift() ?? `${prefix}_extra`,
    waitForSocket: async (socket) => {
      mkdirSync(path.dirname(socket), { recursive: true });
      writeFileSync(socket, "");
      return true;
    },
    runDetached: async (command, args, options = {}) => {
      detachedCalls.push({ command, args, options });
      return { pid: 12345 };
    },
    runBuffered: async (command, args, options = {}) => {
      bufferedCalls.push({ command, args, options });
      if (command === "pgrep") {
        return { stdout: "900 /usr/bin/kitty\n", stderr: "", code: 0 };
      }
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      const subcommand = args[args.indexOf("unix:" + path.join(stateRoot, "sockets", "ki_test.sock")) + 1];
      if (args.includes("ls")) {
        return { stdout: fakeKittyLs(), stderr: "", code: 0 };
      }
      if (args.includes("launch")) {
        const resultEnv = args.find((value) => value.startsWith("CODEX_KITTY_RUN_RESULT_FILE="));
        const resultPath = resultEnv?.slice("CODEX_KITTY_RUN_RESULT_FILE=".length);
        if (resultPath) {
          writeFileSync(resultPath, '{"status":"exited","exit_code":7,"ended_at_ms":1800000000500}\n');
        }
        return { stdout: "42\n", stderr: "", code: 0 };
      }
      if (args.includes("get-text")) {
        return { stdout: Array.from({ length: 6 }, (_, index) => `line ${index + 1}`).join("\n"), stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0, subcommand };
    },
    runWithInput: async (command, args, input, options = {}) => {
      inputCalls.push({ command, args, input, options });
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    const opened = await controller.callTool("kitty_open", { title: "Codex Kitty Test", cwd: tempDir, layout: "splits" });
    assert.equal(opened.instance_id, "ki_test");
    assert.equal(opened.short_id, "K1");
    assert.equal(opened.kind, "managed");
    assert.equal(opened.controllable, true);
    assert.equal(detachedCalls[0].command, "kitty-test");
    assert.deepEqual(detachedCalls[0].args.slice(0, 4), ["-o", "allow_remote_control=socket-only", "--listen-on", `unix:${opened.socket}`]);
    assert.ok(detachedCalls[0].args.includes("--detach"));
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_WRAPPER_BYPASS, "1");
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_INSTANCE_ID, "ki_test");
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_SHORT_ID, "K1");
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_INSTANCE_KIND, "managed");
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_SOCKET, opened.socket);

    const listed = await controller.callTool("kitty_list", { include_unmanaged: true });
    assert.equal(listed.instances[0].windows[0].id, 42);
    assert.equal(listed.instances[0].kind, "managed");
    assert.equal(listed.instances[0].short_id, "K1");
    assert.equal(listed.instances[0].display_name, "[K1] Codex Kitty Test (managed)");
    assert.deepEqual(listed.instances[0].selector, { short_id: "K1" });
    assert.equal(listed.instances[0].windows[0].display_name, "[K1] window 42: codex");
    assert.deepEqual(listed.instances[0].windows[0].selector, { short_id: "K1", window_id: 42 });
    assert.equal(listed.unmanaged[0].pid, 900);

    const run = await controller.callTool("kitty_run", {
      cmd: "npm test",
      cwd: tempDir,
      placement: "vsplit",
      title: "tests",
    });
    assert.equal(run.run_id, "kr_nowait");
    assert.equal(run.window_id, 42);
    assert.equal(run.status, "running");
    const launchCall = assertCommandCall(bufferedCalls, "kitten-test", "launch");
    assert.ok(launchCall.args.includes("--to"));
    assert.ok(launchCall.args.includes(`unix:${opened.socket}`));
    assert.ok(launchCall.args.includes("--location"));
    assert.ok(launchCall.args.includes("vsplit"));
    assert.ok(launchCall.args.includes("CODEX_KITTY_COMMAND=npm test"));
    assert.ok(launchCall.args.includes("CODEX_KITTY_INSTANCE_ID=ki_test"));
    assert.ok(launchCall.args.includes("CODEX_KITTY_SHORT_ID=K1"));
    assert.ok(launchCall.args.includes("CODEX_KITTY_INSTANCE_KIND=managed"));
    assert.ok(launchCall.args.includes(`CODEX_KITTY_SOCKET=${opened.socket}`));

    const waited = await controller.callTool("kitty_run", {
      cmd: "false",
      cwd: tempDir,
      wait: true,
      tail_lines: 3,
    });
    assert.equal(waited.run_id, "kr_wait");
    assert.equal(waited.status, "exited");
    assert.equal(waited.exit_code, 7);
    assert.equal(waited.tail, "line 4\nline 5\nline 6");
    assert.equal(waited.tail_truncated, true);

    const read = await controller.callTool("kitty_read", { run_id: "kr_wait", mode: "tail", lines: 2 });
    assert.equal(read.text, "line 5\nline 6");
    assert.equal(read.exit_code, 7);

    const screen = await controller.callTool("kitty_read", { run_id: "kr_wait", mode: "screen", lines: 2 });
    assert.equal(screen.text, "line 1\nline 2\nline 3\nline 4\nline 5\nline 6");
    assert.equal(screen.truncated, false);
    assert.equal(screen.lines, undefined);

    const sentText = await controller.callTool("kitty_send", { instance_id: "ki_test", window_id: 42, text: "q", bracketed_paste: true });
    assert.equal(sentText.bytes, 1);
    assert.equal(inputCalls[0].command, "kitten-test");
    assert.ok(inputCalls[0].args.includes("send-text"));
    assert.ok(inputCalls[0].args.includes("--stdin"));
    assert.ok(inputCalls[0].args.includes("--bracketed-paste=enable"));
    assert.equal(inputCalls[0].input, "q");

    const sentKey = await controller.callTool("kitty_send", { instance_id: "ki_test", window_id: 42, key: "ctrl+c" });
    assert.equal(sentKey.key, "ctrl+c");
    assert.ok(assertCommandCall(bufferedCalls, "kitten-test", "send-key").args.includes("ctrl+c"));

    await assert.rejects(
      () => controller.callTool("kitty_send", { instance_id: "ki_test", window_id: 42, text: "x", key: "enter" }),
      /exactly one of text or key/,
    );
    await assert.rejects(
      () => controller.callTool("kitty_send", { instance_id: "ki_test", text: "x" }),
      /requires window_id or run_id/,
    );

    await controller.callTool("kitty_layout", { instance_id: "ki_test", window_id: 42, layout: "grid" });
    assert.ok(bufferedCalls.some((call) => call.command === "kitten-test" && call.args.includes("goto-layout") && call.args.includes("window_id:42")));

    await controller.callTool("kitty_focus", { instance_id: "ki_test", window_id: 42 });
    assert.ok(assertCommandCall(bufferedCalls, "kitten-test", "focus-window").args.includes("id:42"));

    await controller.callTool("kitty_close", { instance_id: "ki_test", run_id: "kr_wait", signal: "SIGINT" });
    assert.ok(assertCommandCall(bufferedCalls, "kitten-test", "signal-child").args.includes("SIGINT"));
    assert.ok(assertCommandCall(bufferedCalls, "kitten-test", "close-window").args.includes("id:42"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testAutoCreatedRunClosesInitialWindow() {
  const tempDir = makeTempDir("codex-kitty-auto-run-");
  const stateRoot = path.join(tempDir, "state");
  const bufferedCalls = [];
  const detachedCalls = [];
  const ids = ["ki_auto", "kr_auto"];

  function autoLs() {
    return JSON.stringify([
      {
        id: 1,
        tabs: [
          {
            id: 3,
            title: "tab",
            layout: "splits",
            windows: [
              {
                id: 11,
                title: "empty shell",
                cwd: tempDir,
                pid: 111,
                cmdline: ["zsh"],
                is_active: true,
                is_focused: true,
              },
            ],
          },
        ],
      },
    ]);
  }

  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: {
      CODEX_KITTY_BIN: "kitty-test",
      CODEX_KITTEN_BIN: "kitten-test",
    },
    makeId: (prefix) => ids.shift() ?? `${prefix}_extra`,
    waitForSocket: async (socket) => {
      mkdirSync(path.dirname(socket), { recursive: true });
      writeFileSync(socket, "");
      return true;
    },
    runDetached: async (command, args, options = {}) => {
      detachedCalls.push({ command, args, options });
      return { pid: 22222 };
    },
    runBuffered: async (command, args, options = {}) => {
      bufferedCalls.push({ command, args, options });
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      if (args.includes("ls")) {
        return { stdout: autoLs(), stderr: "", code: 0 };
      }
      if (args.includes("launch")) {
        return { stdout: "22\n", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    const run = await controller.callTool("kitty_run", { cmd: "printf ok", cwd: tempDir });
    assert.equal(run.instance_id, "ki_auto");
    assert.equal(run.short_id, "K1");
    assert.equal(run.window_id, 22);
    assert.equal(run.closed_initial_window_id, 11);
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_SHORT_ID, "K1");
    const launchCall = assertCommandCall(bufferedCalls, "kitten-test", "launch");
    assert.ok(launchCall.args.includes("CODEX_KITTY_SHORT_ID=K1"));
    const closeCall = bufferedCalls.find((call) => call.command === "kitten-test" && call.args.includes("close-window") && call.args.includes("id:11"));
    assert.ok(closeCall, "Expected auto-created kitty_run to close the initial empty shell window");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testAdoptedRegistrySelection() {
  const tempDir = makeTempDir("codex-kitty-adopted-");
  const stateRoot = path.join(tempDir, "state");
  const socket = path.join(stateRoot, "adopted", "K1.sock");
  const bufferedCalls = [];
  const inputCalls = [];
  mkdirSync(path.dirname(socket), { recursive: true });
  writeFileSync(socket, "");
  writeFileSync(
    path.join(stateRoot, "instances.json"),
    JSON.stringify({
      version: 1,
      instances: [
        {
          instance_id: "ki_adopted_k1",
          short_id: "K1",
          kind: "adopted",
          socket,
          status: "running",
          title: "Kitty K1",
          cwd: tempDir,
        },
      ],
    }),
  );

  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: { CODEX_KITTEN_BIN: "kitten-test" },
    makeId: (prefix) => `${prefix}_run`,
    runBuffered: async (command, args, options = {}) => {
      bufferedCalls.push({ command, args, options });
      if (args.includes("ls")) {
        return { stdout: fakeKittyLs(), stderr: "", code: 0 };
      }
      if (args.includes("launch")) {
        return { stdout: "42\n", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    runWithInput: async (command, args, input, options = {}) => {
      inputCalls.push({ command, args, input, options });
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    const listed = await controller.callTool("kitty_list", {});
    assert.equal(listed.instances[0].kind, "adopted");
    assert.equal(listed.instances[0].short_id, "K1");

    const run = await controller.callTool("kitty_run", { short_id: "K1", cmd: "printf ok", cwd: tempDir });
    assert.equal(run.instance_id, "ki_adopted_k1");
    assert.equal(run.short_id, "K1");
    assert.equal(run.instance_kind, "adopted");
    assert.ok(bufferedCalls.some((call) => call.args.includes("launch") && call.args.includes(`unix:${socket}`)));

    const sent = await controller.callTool("kitty_send", { run_id: run.run_id, text: "q" });
    assert.equal(sent.short_id, "K1");
    assert.equal(sent.window_id, 42);
    assert.equal(inputCalls[0].input, "q");

    await assert.rejects(
      () => controller.callTool("kitty_close", { short_id: "K1" }),
      /refusing to close adopted kitty instance/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testAmbiguousSelection() {
  const tempDir = makeTempDir("codex-kitty-ambiguous-");
  const stateRoot = path.join(tempDir, "state");
  mkdirSync(path.join(stateRoot, "sockets"), { recursive: true });
  const firstSocket = path.join(stateRoot, "sockets", "one.sock");
  const secondSocket = path.join(stateRoot, "sockets", "two.sock");
  writeFileSync(firstSocket, "");
  writeFileSync(secondSocket, "");
  writeFileSync(
    path.join(stateRoot, "instances.json"),
    JSON.stringify({
      version: 1,
      instances: [
        { instance_id: "ki_one", kind: "managed", socket: firstSocket, status: "running", cwd: tempDir },
        { instance_id: "ki_two", kind: "managed", socket: secondSocket, status: "running", cwd: tempDir },
      ],
    }),
  );

  const controller = createKittyController({ cwd: tempDir, stateRoot });
  try {
    await assert.rejects(() => controller.callTool("kitty_run", { cmd: "pwd", cwd: tempDir }), /multiple managed kitty instances/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testErrorShapes() {
  const tempDir = makeTempDir("codex-kitty-errors-");
  try {
    const missingKitty = createKittyController({
      cwd: tempDir,
      stateRoot: path.join(tempDir, "missing-kitty"),
      runDetached: async () => {
        const error = new Error("spawn kitty ENOENT");
        error.code = "ENOENT";
        throw error;
      },
      waitForSocket: async () => true,
    });
    await assert.rejects(() => missingKitty.callTool("kitty_open", {}), /kitty_not_found/);

    const stateRoot = path.join(tempDir, "missing-kitten");
    const socket = path.join(stateRoot, "sockets", "ki_error.sock");
    mkdirSync(path.dirname(socket), { recursive: true });
    writeFileSync(socket, "");
    mkdirSync(stateRoot, { recursive: true });
    writeFileSync(
      path.join(stateRoot, "instances.json"),
      JSON.stringify({ version: 1, instances: [{ instance_id: "ki_error", socket, status: "running" }] }),
    );

    const missingKitten = createKittyController({
      cwd: tempDir,
      stateRoot,
      runBuffered: async () => {
        const error = new Error("spawn kitten ENOENT");
        error.code = "ENOENT";
        throw error;
      },
    });
    await assert.rejects(() => missingKitten.callTool("kitty_layout", { instance_id: "ki_error", layout: "grid" }), /kitten_not_found/);

    const unreachable = createKittyController({ cwd: tempDir, stateRoot: path.join(tempDir, "unreachable") });
    mkdirSync(path.join(tempDir, "unreachable"), { recursive: true });
    writeFileSync(
      path.join(tempDir, "unreachable", "instances.json"),
      JSON.stringify({ version: 1, instances: [{ instance_id: "ki_missing", socket: path.join(tempDir, "no.sock"), status: "running" }] }),
    );
    await assert.rejects(() => unreachable.callTool("kitty_layout", { instance_id: "ki_missing", layout: "grid" }), /socket_unreachable/);

    const noRun = createKittyController({ cwd: tempDir, stateRoot: path.join(tempDir, "no-run") });
    await assert.rejects(() => noRun.callTool("kitty_read", { run_id: "kr_missing" }), /run_status_unknown/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function startMcpServer() {
  const child = spawn(process.execPath, [mcpScript], {
    cwd: pluginRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let nextId = 1;
  const pending = new Map();
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.trim()) {
        continue;
      }
      const message = JSON.parse(line);
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
      }
    }
  });

  function request(method, params = {}) {
    const id = nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 5_000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  return {
    child,
    request,
    close: () => child.kill("SIGTERM"),
  };
}

async function testLineDelimitedMcpServer() {
  const server = startMcpServer();
  try {
    const initialize = await server.request("initialize", { protocolVersion: "2025-06-18" });
    assert.equal(initialize.result.serverInfo.name, "kitty");

    const toolList = await server.request("tools/list");
    const toolNames = toolList.result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(toolNames, KITTY_TOOLS.map((tool) => tool.name).sort());

    const call = await server.request("tools/call", {
      name: "kitty_list",
      arguments: {},
    });
    const result = parseJsonTextToolResult(call.result);
    assert.equal(result.ok, true);
  } finally {
    server.close();
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
  const tempDir = makeTempDir("codex-kitty-marketplace-");
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

    run = spawnSync(process.execPath, [marketplaceAddScript, destPath, "dolphin", "kitty"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);

    const marketplace = JSON.parse(readFileSync(destPath, "utf8"));
    assert.deepEqual(
      marketplace.plugins.map((plugin) => plugin.name),
      ["browser", "chrome", "latex", "dolphin", "kitty"],
    );
    const kitty = marketplace.plugins.at(-1);
    assert.equal(kitty.source.path, "./plugins/kitty");
    assert.equal(kitty.policy.installation, "AVAILABLE");
    assert.equal(kitty.policy.authentication, "ON_INSTALL");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function testLocalMarketplaceMetadata() {
  const marketplace = JSON.parse(readFileSync(localMarketplacePath, "utf8"));
  assert.equal(marketplace.name, "local-plugins");
  const kitty = marketplace.plugins.find((plugin) => plugin.name === "kitty");
  assert.ok(kitty, "Expected installer local marketplace to include kitty");
  assert.equal(kitty.source.path, "./plugins/kitty");
  assert.equal(kitty.policy.installation, "AVAILABLE");
  assert.equal(kitty.policy.authentication, "ON_INSTALL");
  assert.equal(kitty.category, "Productivity");
}

function testKittyWindowAccessInstaller() {
  const tempDir = makeTempDir("codex-kitty-access-");
  try {
    const home = path.join(tempDir, "home");
    const dataHome = path.join(tempDir, "data-home");
    const dataDir = path.join(tempDir, "data-dir");
    const binHome = path.join(tempDir, "bin-home");
    const fakeBin = path.join(tempDir, "fake-bin");
    const sourceApplications = path.join(dataDir, "applications");
    const poshDir = path.join(home, ".poshthemes");
    const fakeKitty = path.join(fakeBin, "kitty-real");
    const fakeLog = path.join(tempDir, "fake-kitty.log");
    const stateRoot = path.join(tempDir, "state");

    mkdirSync(sourceApplications, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(binHome, { recursive: true });
    mkdirSync(poshDir, { recursive: true });
    writeFileSync(path.join(binHome, "kitty"), "#!/usr/bin/env bash\n# user wrapper\n", { mode: 0o755 });
    writeFileSync(
      fakeKitty,
      [
        "#!/usr/bin/env bash",
        'printf "short=%s\\nkind=%s\\nsocket=%s\\nargs=%s\\n" "$CODEX_KITTY_SHORT_ID" "$CODEX_KITTY_INSTANCE_KIND" "$CODEX_KITTY_SOCKET" "$*" > "$FAKE_KITTY_LOG"',
      ].join("\n"),
      { mode: 0o755 },
    );
    writeFileSync(
      path.join(sourceApplications, "kitty.desktop"),
      ["[Desktop Entry]", "Name=kitty", "Exec=kitty", "Icon=kitty", "Type=Application", ""].join("\n"),
    );
    writeFileSync(
      path.join(sourceApplications, "kitty-open.desktop"),
      ["[Desktop Entry]", "Name=kitty URL Launcher", "Exec=kitty +open %U", "Icon=kitty", "Type=Application", ""].join("\n"),
    );

    const poshConfig = path.join(poshDir, "catppuccin_mocha.omp.json");
    writeFileSync(
      poshConfig,
      JSON.stringify({
        palette: { lavender: "#B4BEFE" },
        blocks: [
          {
            type: "prompt",
            alignment: "left",
            segments: [
              { type: "os", template: "{{.Icon}} " },
              { type: "session", template: "{{ .UserName }}@{{ .HostName }} " },
            ],
          },
        ],
      }),
    );

    const run = spawnSync("bash", [kittyWindowAccessScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        XDG_DATA_HOME: dataHome,
        XDG_DATA_DIRS: dataDir,
        XDG_BIN_HOME: binHome,
        CODEX_KITTY_REAL_BIN: fakeKitty,
        CODEX_KITTY_OH_MY_POSH_CONFIG: poshConfig,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);

    const rerun = spawnSync("bash", [kittyWindowAccessScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        XDG_DATA_HOME: dataHome,
        XDG_DATA_DIRS: dataDir,
        XDG_BIN_HOME: binHome,
        CODEX_KITTY_REAL_BIN: fakeKitty,
        CODEX_KITTY_OH_MY_POSH_CONFIG: poshConfig,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
    });
    assert.equal(rerun.status, 0, rerun.stdout + rerun.stderr);

    const wrapperPath = path.join(binHome, "kitty");
    const wrapper = readFileSync(wrapperPath, "utf8");
    assert.match(wrapper, /Codex Kitty window access wrapper/);
    assert.match(wrapper, /CODEX_KITTY_SHORT_ID/);
    assert.match(wrapper, /allow_remote_control=socket-only/);
    assert.ok(readdirSync(binHome).some((name) => name.startsWith("kitty.codex-backup-")));

    const desktop = readFileSync(path.join(dataHome, "applications", "kitty.desktop"), "utf8");
    assert.match(desktop, /X-Codex-KittyWindowAccess=true/);
    assert.match(desktop, /Icon=kitty/);
    assert.match(desktop, new RegExp(`Exec=${escapeRegExp(wrapperPath)}`));

    const openDesktop = readFileSync(path.join(dataHome, "applications", "kitty-open.desktop"), "utf8");
    assert.match(openDesktop, /Icon=kitty/);
    assert.match(openDesktop, new RegExp(`Exec=${escapeRegExp(wrapperPath)} \\+open %U`));

    const prompt = JSON.parse(readFileSync(poshConfig, "utf8"));
    const segments = prompt.blocks[0].segments;
    assert.equal(segments[0].type, "os");
    assert.equal(segments[1].type, "text");
    assert.match(segments[1].template, /CODEX_KITTY_SHORT_ID/);
    assert.equal(segments[2].type, "session");
    assert.ok(readdirSync(poshDir).some((name) => name.startsWith("catppuccin_mocha.omp.json.codex-backup-")));

    const launched = spawnSync(wrapperPath, ["--class", "demo"], {
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_KITTY_STATE_DIR: stateRoot,
        FAKE_KITTY_LOG: fakeLog,
      },
    });
    assert.equal(launched.status, 0, launched.stdout + launched.stderr);
    const fakeOutput = readFileSync(fakeLog, "utf8");
    assert.match(fakeOutput, /short=K1/);
    assert.match(fakeOutput, /kind=adopted/);
    assert.match(fakeOutput, /socket=.*K1\.sock/);
    assert.match(fakeOutput, /args=-o allow_remote_control=socket-only --listen-on unix:.*K1\.sock --class demo/);

    const registry = JSON.parse(readFileSync(path.join(stateRoot, "instances.json"), "utf8"));
    assert.equal(registry.instances[0].kind, "adopted");
    assert.equal(registry.instances[0].short_id, "K1");
    assert.equal(registry.instances[0].pid, launched.pid);

    writeFileSync(fakeLog, "");
    const bypassed = spawnSync(wrapperPath, ["--listen-on", "unix:/tmp/user.sock"], {
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_KITTY_STATE_DIR: path.join(tempDir, "state-bypass"),
        FAKE_KITTY_LOG: fakeLog,
      },
    });
    assert.equal(bypassed.status, 0, bypassed.stdout + bypassed.stderr);
    const bypassOutput = readFileSync(fakeLog, "utf8");
    assert.match(bypassOutput, /short=/);
    assert.doesNotMatch(bypassOutput, /short=K/);
    assert.match(bypassOutput, /args=--listen-on unix:\/tmp\/user\.sock/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function testKittyWindowAccessWrapperSkip() {
  const tempDir = makeTempDir("codex-kitty-access-skip-wrapper-");
  try {
    const home = path.join(tempDir, "home");
    const dataHome = path.join(tempDir, "data-home");
    const dataDir = path.join(tempDir, "data-dir");
    const binHome = path.join(tempDir, "bin-home");
    const fakeBin = path.join(tempDir, "fake-bin");
    const sourceApplications = path.join(dataDir, "applications");
    const fakeKitty = path.join(fakeBin, "kitty-real");

    mkdirSync(sourceApplications, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(fakeKitty, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    writeFileSync(path.join(sourceApplications, "kitty.desktop"), ["[Desktop Entry]", "Name=kitty", "Exec=kitty", "Icon=kitty", ""].join("\n"));
    writeFileSync(path.join(sourceApplications, "kitty-open.desktop"), ["[Desktop Entry]", "Name=kitty URL Launcher", "Exec=kitty +open %U", "Icon=kitty", ""].join("\n"));

    const run = spawnSync("bash", [kittyWindowAccessScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        XDG_DATA_HOME: dataHome,
        XDG_DATA_DIRS: dataDir,
        XDG_BIN_HOME: binHome,
        CODEX_KITTY_REAL_BIN: fakeKitty,
        CODEX_KITTY_WINDOW_ACCESS_WRAPPER: "0",
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.equal(existsSync(path.join(binHome, "kitty")), false);
    assert.match(readFileSync(path.join(dataHome, "applications", "kitty.desktop"), "utf8"), /^Exec=kitty$/m);
    assert.match(readFileSync(path.join(dataHome, "applications", "kitty-open.desktop"), "utf8"), /^Exec=kitty \+open %U$/m);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function testPluginMetadata() {
  const manifest = JSON.parse(readFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(manifest.name, "kitty");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(manifest.interface.composerIcon, "./assets/kitty.png");
  assert.ok(existsSync(path.join(pluginRoot, "assets", "kitty.png")));
  assert.ok(existsSync(path.join(pluginRoot, "skills", "kitty", "SKILL.md")));

  const mcpManifest = JSON.parse(readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8"));
  assert.equal(mcpManifest.mcpServers.kitty.command, "node");
  assert.deepEqual(mcpManifest.mcpServers.kitty.args, ["./scripts/kitty-mcp.mjs"]);

  const validation = spawnSync("python3", [pluginValidator, pluginRoot], { encoding: "utf8" });
  assert.equal(validation.status, 0, validation.stdout + validation.stderr);
}

async function main() {
  testPluginMetadata();
  testKittyWindowAccessInstaller();
  testKittyWindowAccessWrapperSkip();
  testMarketplaceScripts();
  testLocalMarketplaceMetadata();
  await testControllerTools();
  await testAutoCreatedRunClosesInitialWindow();
  await testAdoptedRegistrySelection();
  await testAmbiguousSelection();
  await testErrorShapes();
  await testLineDelimitedMcpServer();
  await testHeaderDelimitedMcpServer();
  console.log("Kitty plugin tests passed");
}

await main();
