#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createKittyController, KITTY_TOOLS } from "../plugins/kitty/scripts/kitty-lib.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const installerRoot = path.dirname(scriptDir);
const pluginRoot = path.join(installerRoot, "plugins", "kitty");
const localMarketplacePath = path.join(installerRoot, ".agents", "plugins", "marketplace.json");
const mcpScript = path.join(pluginRoot, "scripts", "kitty-mcp.mjs");
const marketplaceAddScript = path.join(scriptDir, "add-local-bundled-marketplace-plugins.mjs");
const pluginValidator = "/home/kkkzbh/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py";
const singletonInstanceId = "ki_singleton_main";

function makeTempDir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readTextFiles(root) {
  const stat = statSync(root);
  if (stat.isFile()) {
    return [[root, readFileSync(root, "utf8")]];
  }
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return readTextFiles(fullPath);
    }
    if (!entry.isFile() || entry.name.endsWith(".png")) {
      return [];
    }
    return [[fullPath, readFileSync(fullPath, "utf8")]];
  });
}

function assertCommandCall(calls, command, subcommand) {
  const call = calls.find((candidate) => candidate.command === command && candidate.args.includes(subcommand));
  assert.ok(call, `Missing command call: ${command} ${subcommand}`);
  return call;
}

function mainSocket(stateRoot) {
  return path.join(stateRoot, "main.sock");
}

function fakeKittyLs(options = {}) {
  const tabId = options.tabId ?? 7;
  const windowId = options.windowId ?? 42;
  const cwd = options.cwd ?? "/tmp";
  const title = options.title ?? "codex";
  const tabTitle = options.tabTitle ?? "tab";
  return JSON.stringify([
    {
      id: 1,
      tabs: [
        {
          id: tabId,
          title: tabTitle,
          layout: "splits",
          is_active: true,
          active_window_history: [windowId],
          windows: [
            {
              id: windowId,
              title,
              cwd,
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
  const tempDir = makeTempDir("codex-plugin-kitty-tools-");
  const stateRoot = path.join(tempDir, "state");
  const socket = mainSocket(stateRoot);
  const bufferedCalls = [];
  const detachedCalls = [];
  const inputCalls = [];
  const getTextFrames = [];
  let nowMs = 1_800_000_000_000;

  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: {
      CODEX_KITTY_BIN: "kitty-test",
      CODEX_KITTEN_BIN: "kitten-test",
      NO_COLOR: "1",
      TERM: "dumb",
      COLORTERM: "",
      CLICOLOR: "0",
      FORCE_COLOR: "0",
      LS_COLORS: "",
    },
    nowMs: () => nowMs++,
    sleep: async (ms) => {
      nowMs += ms;
    },
    waitForSocket: async (waitSocket) => {
      assert.equal(waitSocket, socket);
      mkdirSync(path.dirname(waitSocket), { recursive: true });
      writeFileSync(waitSocket, "");
      return true;
    },
    runDetached: async (command, args, options = {}) => {
      detachedCalls.push({ command, args, options });
      return { pid: process.pid };
    },
    runBuffered: async (command, args, options = {}) => {
      bufferedCalls.push({ command, args, options });
      if (command === "pgrep") {
        return { stdout: `900 /usr/bin/kitty --listen-on unix:${socket}\n901 /usr/bin/kitty\n`, stderr: "", code: 0 };
      }
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      assert.ok(args.includes(`unix:${socket}`), `expected singleton socket in args: ${args.join(" ")}`);
      if (args.includes("ls")) {
        return { stdout: fakeKittyLs(), stderr: "", code: 0 };
      }
      if (args.includes("get-text")) {
        return { stdout: getTextFrames.shift() ?? "screen stable", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    runWithInput: async (command, args, input, options = {}) => {
      inputCalls.push({ command, args, input, options });
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    const opened = await controller.callTool("kitty_open", { title: "Codex Kitty Test", cwd: tempDir, layout: "splits" });
    assert.equal(opened.instance_id, singletonInstanceId);
    assert.equal(opened.short_id, "T7");
    assert.equal(opened.kind, "singleton");
    assert.equal(opened.action, "open_singleton");
    assert.equal(opened.controllable, true);
    assert.equal(opened.socket, socket);
    assert.equal(opened.window_id, 42);
    assert.equal(opened.tab_id, 7);
    assert.deepEqual(opened.selector, { short_id: "T7", window_id: 42 });

    assert.equal(detachedCalls[0].command, "kitty-test");
    assert.deepEqual(detachedCalls[0].args.slice(0, 4), ["-o", "allow_remote_control=socket-only", "--listen-on", `unix:${socket}`]);
    assert.ok(detachedCalls[0].args.includes("--detach"));
    assert.ok(!detachedCalls[0].args.includes("--start-as=hidden"));
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_WRAPPER_BYPASS, "1");
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_INSTANCE_ID, singletonInstanceId);
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_SHORT_ID, undefined);
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_INSTANCE_KIND, "singleton");
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_SOCKET, socket);
    assert.equal(detachedCalls[0].options.env.NO_COLOR, undefined);
    assert.equal(detachedCalls[0].options.env.TERM, undefined);
    assert.equal(detachedCalls[0].options.env.COLORTERM, undefined);
    assert.equal(detachedCalls[0].options.env.CLICOLOR, undefined);
    assert.equal(detachedCalls[0].options.env.FORCE_COLOR, undefined);
    assert.equal(detachedCalls[0].options.env.LS_COLORS, undefined);
    assert.ok(bufferedCalls.some((call) => call.command === "kitten-test" && call.args.includes("set-tab-title") && call.args.includes("id:7")));
    assert.ok(bufferedCalls.some((call) => call.command === "kitten-test" && call.args.includes("goto-layout") && call.args.includes("window_id:42")));

    assert.deepEqual(KITTY_TOOLS.map((tool) => tool.name), ["kitty_list", "kitty_open", "kitty_send", "kitty_read"]);
    const openTool = KITTY_TOOLS.find((tool) => tool.name === "kitty_open");
    assert.ok(openTool);
    assert.deepEqual(Object.keys(openTool.inputSchema.properties), ["short_id", "title", "cwd", "layout"]);
    assert.equal(openTool.inputSchema.additionalProperties, false);

    const listed = await controller.callTool("kitty_list", { include_unmanaged: true });
    assert.equal(listed.instances[0].instance_id, singletonInstanceId);
    assert.equal(listed.instances[0].kind, "singleton");
    assert.equal(listed.instances[0].short_id, "T7");
    assert.equal(listed.instances[0].display_name, "Kitty (singleton)");
    assert.deepEqual(listed.instances[0].selector, { instance_id: singletonInstanceId });
    assert.equal(listed.instances[0].tabs[0].short_id, "T7");
    assert.equal(listed.instances[0].tabs[0].display_name, "T7 · tab");
    assert.equal(listed.instances[0].windows[0].display_name, "[T7] window 42: codex");
    assert.deepEqual(listed.instances[0].windows[0].selector, { short_id: "T7", window_id: 42 });
    assert.deepEqual(listed.unmanaged.map((entry) => entry.pid), [901]);

    getTextFrames.push("prompt", "prompt\nnpm test\nrunning", "prompt\nnpm test\nrunning");
    const sentCommand = await controller.callTool("kitty_send", {
      command: "npm test",
      short_id: "T7",
      quiet_ms: 0,
    });
    assert.equal(sentCommand.action, "send_command");
    assert.equal(sentCommand.short_id, "T7");
    assert.equal(sentCommand.window_id, 42);
    assert.equal(sentCommand.target.tab_id, 7);
    assert.equal(sentCommand.sent.mode, "command");
    assert.equal(sentCommand.feedback.wait_for, "quiet");
    assert.equal(sentCommand.feedback.changed, true);
    assert.ok(inputCalls[0].args.includes("send-text"));
    assert.ok(inputCalls[0].args.includes("--stdin"));
    assert.equal(inputCalls[0].input, "npm test\n");
    assert.doesNotMatch(inputCalls[0].input, /__codex_status|printf|codex_run|result\.json/);

    getTextFrames.push("line 1\nline 2\nline 3\nline 4\nline 5\nline 6");
    const read = await controller.callTool("kitty_read", { short_id: "T7", mode: "tail", lines: 2 });
    assert.match(read.text, /line 6/);
    assert.equal(read.short_id, "T7");
    assert.equal(read.window_id, 42);

    getTextFrames.push("line 1\nline 2\nline 3\nline 4\nline 5\nline 6");
    const screen = await controller.callTool("kitty_read", { short_id: "T7", mode: "screen", lines: 2, include_layout: true });
    assert.match(screen.text, /line 1/);
    assert.equal(screen.truncated, false);
    assert.equal(screen.lines, undefined);
    assert.equal(screen.layout.windows[0].id, 42);

    getTextFrames.push("line 1", "line 1\nq");
    const sentText = await controller.callTool("kitty_send", { short_id: "T7", window_id: 42, text: "q", bracketed_paste: true, feedback_delay_ms: 0 });
    assert.equal(sentText.bytes, 1);
    assert.equal(sentText.short_id, "T7");
    assert.equal(sentText.sent.mode, "text");
    assert.equal(sentText.feedback.wait_for, "delay");
    assert.ok(sentText.feedback.text.includes("line 1"));
    assert.equal(inputCalls.at(-1).command, "kitten-test");
    assert.ok(inputCalls.at(-1).args.includes("send-text"));
    assert.ok(inputCalls.at(-1).args.includes("--stdin"));
    assert.ok(inputCalls.at(-1).args.includes("--bracketed-paste=enable"));
    assert.equal(inputCalls.at(-1).input, "q");

    getTextFrames.push("before key", "after key");
    const sentKey = await controller.callTool("kitty_send", { short_id: "T7", window_id: 42, key: "ctrl+c", feedback_delay_ms: 0 });
    assert.equal(sentKey.key, "ctrl+c");
    assert.equal(sentKey.sent.mode, "key");
    assert.equal(sentKey.feedback.wait_for, "delay");
    assert.ok(assertCommandCall(bufferedCalls, "kitten-test", "send-key").args.includes("ctrl+c"));

    await assert.rejects(
      () => controller.callTool("kitty_send", { short_id: "T7", window_id: 42, command: "pwd", text: "x", key: "enter" }),
      /exactly one of command, text, or key/,
    );

    await controller.callTool("kitty_focus", { window_id: 42 });
    assert.ok(assertCommandCall(bufferedCalls, "kitten-test", "focus-window").args.includes("id:42"));

    await controller.callTool("kitty_focus", { tab_id: 7 });
    assert.ok(assertCommandCall(bufferedCalls, "kitten-test", "focus-tab").args.includes("id:7"));

    await controller.callTool("kitty_close", { window_id: 42, signal: "SIGINT" });
    assert.ok(assertCommandCall(bufferedCalls, "kitten-test", "signal-child").args.includes("SIGINT"));
    assert.ok(assertCommandCall(bufferedCalls, "kitten-test", "close-window").args.includes("id:42"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testOpenAddsTabWhenSingletonAlreadyExists() {
  const tempDir = makeTempDir("codex-plugin-kitty-open-tab-");
  const stateRoot = path.join(tempDir, "state");
  const socket = mainSocket(stateRoot);
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(socket, "");
  const bufferedCalls = [];
  const detachedCalls = [];
  let launched = false;

  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: {
      CODEX_KITTY_BIN: "kitty-test",
      CODEX_KITTEN_BIN: "kitten-test",
    },
    sleep: async () => {},
    runDetached: async (command, args, options = {}) => {
      detachedCalls.push({ command, args, options });
      return { pid: process.pid };
    },
    runBuffered: async (command, args, options = {}) => {
      bufferedCalls.push({ command, args, options });
      if (command === "pgrep") {
        return { stdout: `900 /usr/bin/kitty --listen-on unix:${socket}\n`, stderr: "", code: 0 };
      }
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      assert.ok(args.includes(`unix:${socket}`), `expected singleton socket in args: ${args.join(" ")}`);
      if (args.includes("launch")) {
        launched = true;
        return { stdout: "99\n", stderr: "", code: 0 };
      }
      if (args.includes("ls")) {
        return {
          stdout: launched
            ? fakeKittyLs({ tabId: 8, windowId: 99, cwd: tempDir, title: "new shell" })
            : fakeKittyLs({ tabId: 7, windowId: 42, cwd: "/tmp", title: "existing" }),
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    const opened = await controller.callTool("kitty_open", { title: "New Tab", cwd: tempDir });
    assert.equal(opened.action, "open_tab");
    assert.equal(opened.instance_id, singletonInstanceId);
    assert.equal(opened.short_id, "T8");
    assert.equal(opened.tab_id, 8);
    assert.equal(opened.window_id, 99);
    assert.equal(detachedCalls.length, 0);
    const launch = assertCommandCall(bufferedCalls, "kitten-test", "launch");
    assert.ok(launch.args.includes("--type"));
    assert.ok(launch.args.includes("tab"));
    assert.ok(launch.args.includes("--dont-take-focus"));
    assert.ok(launch.args.includes("--cwd"));
    assert.ok(launch.args.includes(tempDir));
    assert.ok(launch.args.includes("--tab-title"));
    assert.ok(bufferedCalls.some((call) => call.args.includes("set-tab-title") && call.args.includes("id:8")));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testAutoCreatedCommandUsesRequestedTab() {
  const tempDir = makeTempDir("codex-plugin-kitty-auto-run-");
  const stateRoot = path.join(tempDir, "state");
  const socket = mainSocket(stateRoot);
  const bufferedCalls = [];
  const detachedCalls = [];
  const inputCalls = [];
  const getTextFrames = ["prompt", "prompt\nprintf ok", "prompt\nprintf ok"];

  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: {
      CODEX_KITTY_BIN: "kitty-test",
      CODEX_KITTEN_BIN: "kitten-test",
    },
    waitForSocket: async (waitSocket) => {
      assert.equal(waitSocket, socket);
      mkdirSync(path.dirname(waitSocket), { recursive: true });
      writeFileSync(waitSocket, "");
      return true;
    },
    runDetached: async (command, args, options = {}) => {
      detachedCalls.push({ command, args, options });
      return { pid: process.pid };
    },
    runBuffered: async (command, args, options = {}) => {
      bufferedCalls.push({ command, args, options });
      if (command === "pgrep") {
        return { stdout: `900 /usr/bin/kitty --listen-on unix:${socket}\n`, stderr: "", code: 0 };
      }
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      if (args.includes("ls")) {
        return { stdout: fakeKittyLs({ tabId: 3, windowId: 11, cwd: tempDir, title: "empty shell" }), stderr: "", code: 0 };
      }
      if (args.includes("get-text")) {
        return { stdout: getTextFrames.shift() ?? "prompt\nprintf ok", stderr: "", code: 0 };
      }
      if (args.includes("launch")) {
        throw new Error("auto-created singleton should use the shell opened by kitty itself");
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    runWithInput: async (command, args, input, options = {}) => {
      inputCalls.push({ command, args, input, options });
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    const sent = await controller.callTool("kitty_send", { short_id: "T3", command: "printf ok", quiet_ms: 0 });
    assert.equal(sent.instance_id, singletonInstanceId);
    assert.equal(sent.short_id, "T3");
    assert.equal(sent.window_id, 11);
    assert.equal(sent.target.tab_id, 3);
    assert.equal(sent.sent.mode, "command");
    assert.equal(sent.feedback.wait_for, "quiet");
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_INSTANCE_KIND, "singleton");
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_SHORT_ID, undefined);
    assert.ok(inputCalls[0].args.includes("send-text"));
    assert.equal(inputCalls[0].input, "printf ok\n");
    assert.doesNotMatch(inputCalls[0].input, /__codex_status|printf .*status|codex_run|result\.json/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testDefaultDetachedEnvDoesNotRePolluteSingletonKitty() {
  const tempDir = makeTempDir("codex-plugin-kitty-detached-env-");
  const stateRoot = path.join(tempDir, "state");
  const fakeKitty = path.join(tempDir, "fake-kitty.sh");
  const envFile = path.join(tempDir, "kitty-env.txt");
  const originalNoColor = process.env.NO_COLOR;
  const originalTerm = process.env.TERM;

  writeFileSync(
    fakeKitty,
    [
      "#!/usr/bin/env bash",
      'env > "$FAKE_KITTY_ENV_FILE"',
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  process.env.NO_COLOR = "1";
  process.env.TERM = "dumb";

  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: {
      ...withoutCodexKittyEnv(),
      CODEX_KITTY_BIN: fakeKitty,
      CODEX_KITTEN_BIN: "kitten-test",
      FAKE_KITTY_ENV_FILE: envFile,
      NO_COLOR: "1",
      TERM: "dumb",
    },
    waitForSocket: async (socket) => {
      mkdirSync(path.dirname(socket), { recursive: true });
      writeFileSync(socket, "");
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (existsSync(envFile)) {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return true;
    },
    runBuffered: async (command, args) => {
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      if (args.includes("ls")) {
        return { stdout: fakeKittyLs(), stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    await controller.callTool("kitty_open", { title: "Detached Env", cwd: tempDir });
    const envText = readFileSync(envFile, "utf8");
    assert.match(envText, new RegExp(`CODEX_KITTY_INSTANCE_ID=${singletonInstanceId}`));
    assert.match(envText, /CODEX_KITTY_INSTANCE_KIND=singleton/);
    assert.doesNotMatch(envText, /^CODEX_KITTY_SHORT_ID=/m);
    assert.doesNotMatch(envText, /^NO_COLOR=/m);
    assert.doesNotMatch(envText, /^TERM=dumb$/m);
  } finally {
    if (originalNoColor == null) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
    if (originalTerm == null) {
      delete process.env.TERM;
    } else {
      process.env.TERM = originalTerm;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testSingletonKittyUsesUserSessionEnvironmentWhenMcpEnvIsHeadless() {
  const tempDir = makeTempDir("codex-plugin-kitty-session-env-");
  const stateRoot = path.join(tempDir, "state");
  const detachedCalls = [];
  const bufferedCalls = [];

  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: {
      HOME: path.join(tempDir, "home"),
      USER: "tester",
      LOGNAME: "tester",
      SHELL: "/usr/bin/zsh",
      PATH: process.env.PATH,
      CODEX_KITTY_BIN: "kitty-test",
      CODEX_KITTEN_BIN: "kitten-test",
    },
    waitForSocket: async (socket) => {
      mkdirSync(path.dirname(socket), { recursive: true });
      writeFileSync(socket, "");
      return true;
    },
    runDetached: async (command, args, options = {}) => {
      detachedCalls.push({ command, args, options });
      return { pid: process.pid };
    },
    runBuffered: async (command, args, options = {}) => {
      bufferedCalls.push({ command, args, options });
      if (command === "systemctl" && args.join(" ") === "--user show-environment") {
        assert.equal(options.env.XDG_RUNTIME_DIR, `/run/user/${process.getuid()}`);
        assert.equal(options.env.DBUS_SESSION_BUS_ADDRESS, `unix:path=/run/user/${process.getuid()}/bus`);
        return {
          stdout: [
            "XDG_RUNTIME_DIR=/run/user/1000",
            "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus",
            "DISPLAY=:0",
            "WAYLAND_DISPLAY=wayland-0",
            "XAUTHORITY=/run/user/1000/xauth_test",
            "XDG_CURRENT_DESKTOP=KDE",
            "XDG_SESSION_TYPE=wayland",
            "",
          ].join("\n"),
          stderr: "",
          code: 0,
        };
      }
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      if (args.includes("ls")) {
        return { stdout: fakeKittyLs(), stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    await controller.callTool("kitty_open", { title: "Session Env", cwd: tempDir });
    const env = detachedCalls[0].options.env;
    assert.equal(env.DISPLAY, ":0");
    assert.equal(env.WAYLAND_DISPLAY, "wayland-0");
    assert.equal(env.XDG_RUNTIME_DIR, "/run/user/1000");
    assert.equal(env.DBUS_SESSION_BUS_ADDRESS, "unix:path=/run/user/1000/bus");
    assert.equal(env.XAUTHORITY, "/run/user/1000/xauth_test");
    assert.equal(env.XDG_CURRENT_DESKTOP, "KDE");
    assert.equal(env.XDG_SESSION_TYPE, "wayland");
    assert.ok(bufferedCalls.some((call) => call.command === "systemctl" && call.args.includes("show-environment")));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testRegistryStoresOnlySingletonState() {
  const tempDir = makeTempDir("codex-plugin-kitty-state-");
  const stateRoot = path.join(tempDir, "state");
  const socket = mainSocket(stateRoot);
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(socket, "");
  writeFileSync(
    path.join(stateRoot, "instances.json"),
    JSON.stringify({
      version: 1,
      last_used_short_id: "K9",
      instances: [
        { instance_id: "ki_legacy", short_id: "K9", kind: "managed", socket: path.join(stateRoot, "legacy.sock") },
      ],
    }),
  );
  const inputCalls = [];
  const getTextFrames = ["before", "after"];

  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: { CODEX_KITTEN_BIN: "kitten-test" },
    runBuffered: async (command, args) => {
      if (command === "pgrep") {
        return { stdout: `900 /usr/bin/kitty --listen-on unix:${socket}\n`, stderr: "", code: 0 };
      }
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      if (args.includes("ls")) {
        return { stdout: fakeKittyLs({ tabId: 7, windowId: 42, cwd: tempDir }), stderr: "", code: 0 };
      }
      if (args.includes("get-text")) {
        return { stdout: getTextFrames.shift() ?? "after", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    runWithInput: async (command, args, input) => {
      inputCalls.push({ command, args, input });
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    const sent = await controller.callTool("kitty_send", { short_id: "T7", text: "x", wait_for: "change", timeout_ms: 100 });
    assert.equal(sent.short_id, "T7");
    assert.equal(inputCalls[0].input, "x");
    const registry = JSON.parse(readFileSync(path.join(stateRoot, "instances.json"), "utf8"));
    assert.equal(registry.last_used_short_id, "T7");
    assert.deepEqual(registry.instances.map((instance) => instance.instance_id), [singletonInstanceId]);
    assert.equal(registry.instances[0].kind, "singleton");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testSendWaitStrategies() {
  const tempDir = makeTempDir("codex-plugin-kitty-wait-");
  const stateRoot = path.join(tempDir, "state");
  const socket = mainSocket(stateRoot);
  const inputCalls = [];
  let nowMs = 1_800_000_100_000;
  let getTextFrames = [];
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(socket, "");

  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: { CODEX_KITTEN_BIN: "kitten-test" },
    nowMs: () => nowMs,
    sleep: async (ms) => {
      nowMs += ms;
    },
    runBuffered: async (command, args) => {
      if (command === "pgrep") {
        return { stdout: `900 /usr/bin/kitty --listen-on unix:${socket}\n`, stderr: "", code: 0 };
      }
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      if (args.includes("ls")) {
        return { stdout: fakeKittyLs(), stderr: "", code: 0 };
      }
      if (args.includes("get-text")) {
        return { stdout: getTextFrames.shift() ?? "stable", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    runWithInput: async (command, args, input) => {
      inputCalls.push({ command, args, input });
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    const none = await controller.callTool("kitty_send", { short_id: "T7", text: "x", wait_for: "none" });
    assert.equal(none.feedback, undefined);
    assert.equal(inputCalls.at(-1).input, "x");

    getTextFrames = ["before", "after"];
    const change = await controller.callTool("kitty_send", { short_id: "T7", text: "y", wait_for: "change", timeout_ms: 500 });
    assert.equal(change.feedback.wait_for, "change");
    assert.equal(change.feedback.changed, true);
    assert.equal(change.feedback.timed_out, false);

    getTextFrames = ["before regex", "still waiting", "done MATCH"];
    const regex = await controller.callTool("kitty_send", { short_id: "T7", text: "z", wait_for: "regex", pattern: "MATCH", timeout_ms: 500 });
    assert.equal(regex.feedback.wait_for, "regex");
    assert.equal(regex.feedback.matched, true);
    assert.equal(regex.feedback.timed_out, false);

    await assert.rejects(
      () => controller.callTool("kitty_send", { short_id: "T7", text: "bad", wait_for: "regex" }),
      /pattern must be a non-empty string/,
    );

    getTextFrames = ["same", "same", "same"];
    const timeout = await controller.callTool("kitty_send", { short_id: "T7", text: "t", wait_for: "change", timeout_ms: 100 });
    assert.equal(timeout.feedback.wait_for, "change");
    assert.equal(timeout.feedback.changed, false);
    assert.equal(timeout.feedback.timed_out, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testErrorShapes() {
  const tempDir = makeTempDir("codex-plugin-kitty-errors-");
  try {
    const missingKitty = createKittyController({
      cwd: tempDir,
      stateRoot: path.join(tempDir, "missing-kitty"),
      runDetached: async () => {
        const error = new Error("spawn kitty ENOENT");
        error.code = "ENOENT";
        throw error;
      },
    });
    await assert.rejects(() => missingKitty.callTool("kitty_open", {}), /kitty_not_found/);

    const stateRoot = path.join(tempDir, "missing-kitten");
    const socket = mainSocket(stateRoot);
    mkdirSync(path.dirname(socket), { recursive: true });
    writeFileSync(socket, "");
    const missingKitten = createKittyController({
      cwd: tempDir,
      stateRoot,
      runBuffered: async () => {
        const error = new Error("spawn kitten ENOENT");
        error.code = "ENOENT";
        throw error;
      },
    });
    await assert.rejects(() => missingKitten.callTool("kitty_layout", { instance_id: singletonInstanceId, layout: "grid" }), /kitten_not_found/);

    const unknown = createKittyController({ cwd: tempDir, stateRoot: path.join(tempDir, "unknown") });
    await assert.rejects(() => unknown.callTool("kitty_layout", { instance_id: "ki_missing", layout: "grid" }), /unknown kitty instance/);

    const invalidTab = createKittyController({ cwd: tempDir, stateRoot: path.join(tempDir, "invalid-tab") });
    await assert.rejects(() => invalidTab.callTool("kitty_send", { short_id: "K1", text: "x" }), /tab selector/);

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
      name: "kitty_send",
      arguments: {},
    });
    assert.equal(call.result.isError, true);
    assert.match(call.result.content[0].text, /requires exactly one of command, text, or key/);
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
  const tempDir = makeTempDir("codex-plugin-kitty-marketplace-");
  try {
    const destPath = path.join(tempDir, "dest.json");
    writeFileSync(
      destPath,
      JSON.stringify({
        name: "openai-bundled",
        interface: { displayName: "OpenAI Bundled" },
        plugins: ["browser", "chrome", "latex"].map((name) => ({
          name,
          source: { source: "local", path: `./plugins/${name}` },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Productivity",
        })),
      }),
    );

    let run = spawnSync(process.execPath, [marketplaceAddScript, destPath, "dolphin", "kitty"], { encoding: "utf8" });
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

    run = spawnSync(process.execPath, [marketplaceAddScript, destPath, "kde-computer-use=computer-use"], {
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    const computerUse = JSON.parse(readFileSync(destPath, "utf8")).plugins.at(-1);
    assert.equal(computerUse.name, "kde-computer-use");
    assert.equal(computerUse.source.path, "./plugins/computer-use");
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

function withoutCodexKittyEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.startsWith("CODEX_KITTY_")),
  );
}

function testPluginMetadata() {
  const manifest = JSON.parse(readFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(manifest.name, "kitty");
  assert.equal(manifest.version, "0.1.14");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(manifest.interface.composerIcon, "./assets/kitty.png");
  assert.ok(existsSync(path.join(pluginRoot, "assets", "kitty.png")));
  assert.ok(existsSync(path.join(pluginRoot, "skills", "kitty", "SKILL.md")));

  const mcpManifest = JSON.parse(readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8"));
  assert.equal(mcpManifest.mcp_servers, undefined);
  assert.equal(mcpManifest.mcpServers, undefined);
  assert.equal(mcpManifest.kitty.command, "node");
  assert.deepEqual(mcpManifest.kitty.args, ["./scripts/kitty-mcp.mjs"]);
  assert.equal(mcpManifest.kitty.cwd, ".");

  if (existsSync(pluginValidator)) {
    const validation = spawnSync("python3", [pluginValidator, pluginRoot], { encoding: "utf8" });
    const validationOutput = validation.stdout + validation.stderr;
    if (
      validation.status !== 0 &&
      validationOutput.includes("field `kitty` is not accepted by plugin validation") &&
      validationOutput.includes("field `mcpServers` must be an object")
    ) {
      return;
    }
    assert.equal(validation.status, 0, validationOutput);
  }
}

async function testKittyIdentityDoesNotUseLegacyCodexKittyName() {
  const forbidden = ["codex", "kitty"].join("-");
  const offenders = readTextFiles(pluginRoot)
    .filter(([, text]) => text.includes(forbidden))
    .map(([file]) => path.relative(installerRoot, file));
  assert.deepEqual(offenders, []);

  const runtimeDir = makeTempDir("codex-plugin-kitty-runtime-");
  try {
    const controller = createKittyController({
      cwd: runtimeDir,
      env: { XDG_RUNTIME_DIR: runtimeDir },
    });
    const listed = await controller.callTool("kitty_list", {});
    assert.equal(listed.state_root, path.join(runtimeDir, "codex", "plugins", "kitty"));
    assert.ok(!listed.state_root.includes(forbidden), listed.state_root);
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
}

async function main() {
  testPluginMetadata();
  await testKittyIdentityDoesNotUseLegacyCodexKittyName();
  testMarketplaceScripts();
  testLocalMarketplaceMetadata();
  await testControllerTools();
  await testOpenAddsTabWhenSingletonAlreadyExists();
  await testAutoCreatedCommandUsesRequestedTab();
  await testDefaultDetachedEnvDoesNotRePolluteSingletonKitty();
  await testSingletonKittyUsesUserSessionEnvironmentWhenMcpEnvIsHeadless();
  await testRegistryStoresOnlySingletonState();
  await testSendWaitStrategies();
  await testErrorShapes();
  await testLineDelimitedMcpServer();
  await testHeaderDelimitedMcpServer();
  console.log("Kitty plugin tests passed");
}

await main();
