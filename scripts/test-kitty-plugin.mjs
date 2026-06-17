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
const marketplaceFilterScript = path.join(scriptDir, "filter-bundled-marketplace.mjs");
const marketplaceAddScript = path.join(scriptDir, "add-local-bundled-marketplace-plugins.mjs");
const kittyWindowAccessScript = path.join(scriptDir, "install-kitty-window-access.sh");
const pluginValidator = "/home/kkkzbh/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py";

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
  const tempDir = makeTempDir("codex-plugin-kitty-tools-");
  const stateRoot = path.join(tempDir, "state");
  const bufferedCalls = [];
  const detachedCalls = [];
  const inputCalls = [];
  const ids = ["ki_test"];
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
    makeId: (prefix) => ids.shift() ?? `${prefix}_extra`,
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
        return { stdout: "42\n", stderr: "", code: 0 };
      }
      if (args.includes("get-text")) {
        return { stdout: getTextFrames.shift() ?? "screen stable", stderr: "", code: 0 };
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
    assert.ok(detachedCalls[0].args.includes("--start-as=hidden"));
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_WRAPPER_BYPASS, "1");
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_INSTANCE_ID, "ki_test");
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_SHORT_ID, "K1");
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_INSTANCE_KIND, "managed");
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_SOCKET, opened.socket);
    assert.equal(detachedCalls[0].options.env.NO_COLOR, undefined);
    assert.equal(detachedCalls[0].options.env.TERM, undefined);
    assert.equal(detachedCalls[0].options.env.COLORTERM, undefined);
    assert.equal(detachedCalls[0].options.env.CLICOLOR, undefined);
    assert.equal(detachedCalls[0].options.env.FORCE_COLOR, undefined);
    assert.equal(detachedCalls[0].options.env.LS_COLORS, undefined);
    const initialLaunch = assertCommandCall(bufferedCalls, "kitten-test", "launch");
    assert.ok(initialLaunch.args.includes("--type"));
    assert.ok(initialLaunch.args.includes("os-window"));
    assert.ok(initialLaunch.args.includes("--dont-take-focus"));
    assert.ok(initialLaunch.args.includes("--cwd"));
    assert.ok(initialLaunch.args.includes(tempDir));

    assert.deepEqual(KITTY_TOOLS.map((tool) => tool.name), ["kitty_list", "kitty_open", "kitty_send", "kitty_read"]);
    const openTool = KITTY_TOOLS.find((tool) => tool.name === "kitty_open");
    assert.ok(openTool);
    assert.deepEqual(Object.keys(openTool.inputSchema.properties), ["short_id", "title", "cwd", "layout"]);
    assert.equal(openTool.inputSchema.additionalProperties, false);

    const listed = await controller.callTool("kitty_list", { include_unmanaged: true });
    assert.equal(listed.instances[0].windows[0].id, 42);
    assert.equal(listed.instances[0].kind, "managed");
    assert.equal(listed.instances[0].short_id, "K1");
    assert.equal(listed.instances[0].display_name, "[K1] Codex Kitty Test (managed)");
    assert.deepEqual(listed.instances[0].selector, { short_id: "K1" });
    assert.equal(listed.instances[0].windows[0].display_name, "[K1] window 42: codex");
    assert.deepEqual(listed.instances[0].windows[0].selector, { short_id: "K1", window_id: 42 });
    assert.equal(listed.unmanaged[0].pid, 900);

    getTextFrames.push("prompt", "prompt\nnpm test\nrunning", "prompt\nnpm test\nrunning");
    const sentCommand = await controller.callTool("kitty_send", {
      command: "npm test",
      short_id: "K1",
      quiet_ms: 0,
    });
    assert.equal(sentCommand.action, "send_command");
    assert.equal(sentCommand.window_id, 42);
    assert.equal(sentCommand.sent.mode, "command");
    assert.equal(sentCommand.feedback.wait_for, "quiet");
    assert.equal(sentCommand.feedback.changed, true);
    assert.ok(inputCalls[0].args.includes("send-text"));
    assert.ok(inputCalls[0].args.includes("--stdin"));
    assert.equal(inputCalls[0].input, "npm test\n");
    assert.doesNotMatch(inputCalls[0].input, /__codex_status|printf|codex_run|result\.json/);

    getTextFrames.push("line 1\nline 2\nline 3\nline 4\nline 5\nline 6");
    const read = await controller.callTool("kitty_read", { short_id: "K1", mode: "tail", lines: 2 });
    assert.match(read.text, /line 6/);
    assert.equal(read.short_id, "K1");
    assert.equal(read.window_id, 42);

    getTextFrames.push("line 1\nline 2\nline 3\nline 4\nline 5\nline 6");
    const screen = await controller.callTool("kitty_read", { short_id: "K1", mode: "screen", lines: 2, include_layout: true });
    assert.match(screen.text, /line 1/);
    assert.equal(screen.truncated, false);
    assert.equal(screen.lines, undefined);
    assert.equal(screen.layout.windows[0].id, 42);

    getTextFrames.push("line 1", "line 1\nq");
    const sentText = await controller.callTool("kitty_send", { short_id: "K1", window_id: 42, text: "q", bracketed_paste: true, feedback_delay_ms: 0 });
    assert.equal(sentText.bytes, 1);
    assert.equal(sentText.short_id, "K1");
    assert.equal(sentText.sent.mode, "text");
    assert.equal(sentText.feedback.wait_for, "delay");
    assert.ok(sentText.feedback.text.includes("line 1"));
    assert.equal(inputCalls.at(-1).command, "kitten-test");
    assert.ok(inputCalls.at(-1).args.includes("send-text"));
    assert.ok(inputCalls.at(-1).args.includes("--stdin"));
    assert.ok(inputCalls.at(-1).args.includes("--bracketed-paste=enable"));
    assert.equal(inputCalls.at(-1).input, "q");

    getTextFrames.push("before key", "after key");
    const sentKey = await controller.callTool("kitty_send", { short_id: "K1", window_id: 42, key: "ctrl+c", feedback_delay_ms: 0 });
    assert.equal(sentKey.key, "ctrl+c");
    assert.equal(sentKey.sent.mode, "key");
    assert.equal(sentKey.feedback.wait_for, "delay");
    assert.ok(assertCommandCall(bufferedCalls, "kitten-test", "send-key").args.includes("ctrl+c"));

    await assert.rejects(
      () => controller.callTool("kitty_send", { short_id: "K1", window_id: 42, command: "pwd", text: "x", key: "enter" }),
      /exactly one of command, text, or key/,
    );

    await controller.callTool("kitty_layout", { instance_id: "ki_test", window_id: 42, layout: "grid" });
    assert.ok(bufferedCalls.some((call) => call.command === "kitten-test" && call.args.includes("goto-layout") && call.args.includes("window_id:42")));

    await controller.callTool("kitty_focus", { instance_id: "ki_test", window_id: 42 });
    assert.ok(assertCommandCall(bufferedCalls, "kitten-test", "focus-window").args.includes("id:42"));

    await controller.callTool("kitty_close", { instance_id: "ki_test", window_id: 42, signal: "SIGINT" });
    assert.ok(assertCommandCall(bufferedCalls, "kitten-test", "signal-child").args.includes("SIGINT"));
    assert.ok(assertCommandCall(bufferedCalls, "kitten-test", "close-window").args.includes("id:42"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testManagedOpenTemporarilyRestoresKwinFocus() {
  const tempDir = makeTempDir("codex-plugin-kitty-focus-");
  const stateRoot = path.join(tempDir, "state");
  const bufferedCalls = [];
  const events = [];
  const detachedCalls = [];
  let focusScriptText = "";

  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: {
      CODEX_KITTY_BIN: "kitty-test",
      CODEX_KITTEN_BIN: "kitten-test",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      KDE_FULL_SESSION: "true",
      XDG_CURRENT_DESKTOP: "KDE",
      XDG_SESSION_TYPE: "wayland",
    },
    makeId: () => "ki_focus",
    waitForSocket: async (socket) => {
      mkdirSync(path.dirname(socket), { recursive: true });
      writeFileSync(socket, "");
      return true;
    },
    sleep: async () => {},
    runDetached: async (command, args, options = {}) => {
      detachedCalls.push({ command, args, options });
      return { pid: process.pid };
    },
    runBuffered: async (command, args, options = {}) => {
      bufferedCalls.push({ command, args, options });
      if (command === "qdbus") {
        if (args.includes("loadScript")) {
          const scriptPath = args[args.indexOf("loadScript") + 1];
          focusScriptText = readFileSync(scriptPath, "utf8");
          events.push("focus-load");
          return { stdout: "7\n", stderr: "", code: 0 };
        }
        if (args.includes("start")) {
          events.push("focus-start");
          return { stdout: "", stderr: "", code: 0 };
        }
        if (args.includes("unloadScript")) {
          events.push("focus-unload");
          return { stdout: "true\n", stderr: "", code: 0 };
        }
        throw new Error(`unexpected qdbus args: ${args.join(" ")}`);
      }
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      if (args.includes("ls")) {
        return { stdout: fakeKittyLs(), stderr: "", code: 0 };
      }
      if (args.includes("launch")) {
        events.push("kitty-launch");
        return { stdout: "42\n", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    const opened = await controller.callTool("kitty_open", { title: "Focus Test", cwd: tempDir });
    assert.equal(opened.instance_id, "ki_focus");
    assert.equal(detachedCalls[0].command, "kitty-test");
    assert.deepEqual(events, ["focus-load", "focus-start", "kitty-launch", "focus-unload"]);
    assert.match(focusScriptText, /workspace\.activeWindow/);
    assert.match(focusScriptText, /workspace\.windowActivated/);
    assert.match(focusScriptText, /callDBus/);
    assert.match(focusScriptText, /Focus Test/);
    assert.ok(bufferedCalls.some((call) => call.command === "qdbus" && call.args.includes("unloadScript")));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testAutoCreatedCommandUsesRequestedSharedShell() {
  const tempDir = makeTempDir("codex-plugin-kitty-auto-run-");
  const stateRoot = path.join(tempDir, "state");
  const bufferedCalls = [];
  const detachedCalls = [];
  const inputCalls = [];
  const ids = ["ki_auto"];
  const getTextFrames = ["prompt", "prompt\nprintf ok", "prompt\nprintf ok"];

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
      return { pid: process.pid };
    },
    runBuffered: async (command, args, options = {}) => {
      bufferedCalls.push({ command, args, options });
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      if (args.includes("ls")) {
        return { stdout: autoLs(), stderr: "", code: 0 };
      }
      if (args.includes("get-text")) {
        return { stdout: getTextFrames.shift() ?? "prompt\nprintf ok", stderr: "", code: 0 };
      }
      if (args.includes("launch")) {
        return { stdout: "11\n", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    runWithInput: async (command, args, input, options = {}) => {
      inputCalls.push({ command, args, input, options });
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    const sent = await controller.callTool("kitty_send", { short_id: "K7", command: "printf ok", quiet_ms: 0 });
    assert.equal(sent.instance_id, "ki_auto");
    assert.equal(sent.short_id, "K7");
    assert.equal(sent.window_id, 11);
    assert.equal(sent.sent.mode, "command");
    assert.equal(sent.feedback.wait_for, "quiet");
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_SHORT_ID, "K7");
    assert.ok(inputCalls[0].args.includes("send-text"));
    assert.equal(inputCalls[0].input, "printf ok\n");
    assert.doesNotMatch(inputCalls[0].input, /__codex_status|printf .*status|codex_run|result\.json/);
    const launchCalls = bufferedCalls.filter((call) => call.args.includes("launch"));
    assert.equal(launchCalls.length, 1);
    assert.ok(launchCalls[0].args.includes("os-window"));
    assert.ok(launchCalls[0].args.includes("--dont-take-focus"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testDefaultDetachedEnvDoesNotRePolluteManagedKitty() {
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
        CODEX_KITTY_RESTORE_FOCUS: "0",
        CODEX_KITTY_BIN: fakeKitty,
        CODEX_KITTEN_BIN: "kitten-test",
        FAKE_KITTY_ENV_FILE: envFile,
      NO_COLOR: "1",
      TERM: "dumb",
    },
    makeId: (prefix) => `${prefix}_env`,
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
      if (args.includes("launch")) {
        return { stdout: "42\n", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    await controller.callTool("kitty_open", { title: "Detached Env", cwd: tempDir });
    const envText = readFileSync(envFile, "utf8");
    assert.match(envText, /CODEX_KITTY_SHORT_ID=K1/);
    assert.match(envText, /CODEX_KITTY_INSTANCE_KIND=managed/);
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

async function testManagedKittyUsesUserSessionEnvironmentWhenMcpEnvIsHeadless() {
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
    makeId: (prefix) => `${prefix}_session`,
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
      if (command === "qdbus") {
        return { stdout: args.includes("loadScript") ? "7\n" : "", stderr: "", code: 0 };
      }
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      if (args.includes("ls")) {
        return { stdout: fakeKittyLs(), stderr: "", code: 0 };
      }
      if (args.includes("launch")) {
        return { stdout: "42\n", stderr: "", code: 0 };
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

async function testListPrunesClosedAndDeadInstances() {
  const tempDir = makeTempDir("codex-plugin-kitty-prune-");
  const stateRoot = path.join(tempDir, "state");
  const socketsDir = path.join(stateRoot, "sockets");
  mkdirSync(socketsDir, { recursive: true });
  const liveSocket = path.join(socketsDir, "live.sock");
  const deadSocket = path.join(socketsDir, "dead.sock");
  const closedSocket = path.join(socketsDir, "closed.sock");
  const reachableDeadPidSocket = path.join(socketsDir, "reachable-dead-pid.sock");
  const windowlessSocket = path.join(socketsDir, "windowless.sock");
  const deadPid = 999999999;
  const windowlessPid = 999999996;
  writeFileSync(liveSocket, "");
  writeFileSync(deadSocket, "");
  writeFileSync(closedSocket, "");
  writeFileSync(reachableDeadPidSocket, "");
  writeFileSync(windowlessSocket, "");
  writeFileSync(
    path.join(stateRoot, "instances.json"),
    JSON.stringify({
      version: 1,
      last_used_short_id: "K2",
      instances: [
        { instance_id: "ki_live", short_id: "K1", kind: "managed", socket: liveSocket, pid: process.pid, status: "running", cwd: tempDir },
        { instance_id: "ki_dead", short_id: "K2", kind: "managed", socket: deadSocket, pid: deadPid, status: "running", cwd: tempDir },
        { instance_id: "ki_closed", short_id: "K3", kind: "managed", socket: closedSocket, pid: 999999998, status: "closed", cwd: tempDir },
        { instance_id: "ki_reachable_dead_pid", short_id: "K4", kind: "managed", socket: reachableDeadPidSocket, pid: 999999997, status: "running", cwd: tempDir },
        { instance_id: "ki_windowless", short_id: "K5", kind: "managed", socket: windowlessSocket, pid: windowlessPid, status: "running", cwd: tempDir },
      ],
    }),
  );

  const killed = [];
  const killedPids = new Set();
  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: { CODEX_KITTEN_BIN: "kitten-test" },
    sleep: async () => {},
    processAlive: (pid) => (pid === deadPid || pid === windowlessPid) && !killedPids.has(pid),
    killProcess: (pid, signal) => {
      killed.push({ pid, signal });
      if (signal === "SIGTERM") {
        killedPids.add(pid);
      }
    },
    readProcessCommandLine: async (pid) => {
      if (pid === deadPid) {
        return `/usr/bin/kitty --listen-on unix:${deadSocket}`;
      }
      if (pid === windowlessPid) {
        return `/usr/bin/kitty --listen-on unix:${windowlessSocket}`;
      }
      return "";
    },
    runBuffered: async (command, args) => {
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      if (args.includes(`unix:${deadSocket}`)) {
        const error = new Error(`connect ECONNREFUSED ${deadSocket}`);
        error.code = "ECONNREFUSED";
        throw error;
      }
      if (args.includes(`unix:${windowlessSocket}`)) {
        return { stdout: "[]", stderr: "", code: 0 };
      }
      assert.ok(
        args.includes(`unix:${liveSocket}`) || args.includes(`unix:${reachableDeadPidSocket}`),
        `unexpected socket in args: ${args.join(" ")}`,
      );
      if (args.includes("ls")) {
        return { stdout: fakeKittyLs(), stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    const listed = await controller.callTool("kitty_list", {});
    assert.deepEqual(listed.instances.map((instance) => instance.short_id), ["K1", "K4"]);
    assert.equal(existsSync(deadSocket), false);
    assert.equal(existsSync(closedSocket), false);
    assert.equal(existsSync(reachableDeadPidSocket), true);
    assert.equal(existsSync(windowlessSocket), false);
    const registry = JSON.parse(readFileSync(path.join(stateRoot, "instances.json"), "utf8"));
    assert.deepEqual(registry.instances.map((instance) => instance.instance_id), ["ki_live", "ki_reachable_dead_pid"]);
    assert.equal(registry.last_used_short_id, undefined);
    assert.deepEqual(killed, [
      { pid: deadPid, signal: "SIGTERM" },
      { pid: windowlessPid, signal: "SIGTERM" },
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testSendReplacesUnreachableRegisteredInstance() {
  const tempDir = makeTempDir("codex-plugin-kitty-replace-stale-");
  const stateRoot = path.join(tempDir, "state");
  const socketsDir = path.join(stateRoot, "sockets");
  mkdirSync(socketsDir, { recursive: true });
  const staleSocket = path.join(socketsDir, "stale.sock");
  const replacementSocket = path.join(socketsDir, "ki_replacement.sock");
  const stalePid = 999999999;
  writeFileSync(staleSocket, "");
  writeFileSync(
    path.join(stateRoot, "instances.json"),
    JSON.stringify({
      version: 1,
      instances: [
        { instance_id: "ki_stale", short_id: "K8", kind: "managed", socket: staleSocket, pid: stalePid, status: "running", cwd: tempDir },
      ],
    }),
  );

  const detachedCalls = [];
  const inputCalls = [];
  const killed = [];
  const killedPids = new Set();
  const getTextFrames = ["prompt", "prompt\nprintf fresh", "prompt\nprintf fresh"];
  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: {
      CODEX_KITTY_BIN: "kitty-test",
      CODEX_KITTEN_BIN: "kitten-test",
    },
    makeId: () => "ki_replacement",
    waitForSocket: async (socket) => {
      mkdirSync(path.dirname(socket), { recursive: true });
      writeFileSync(socket, "");
      return true;
    },
    sleep: async () => {},
    processAlive: (pid) => pid === stalePid && !killedPids.has(pid),
    killProcess: (pid, signal) => {
      killed.push({ pid, signal });
      if (signal === "SIGTERM") {
        killedPids.add(pid);
      }
    },
    readProcessCommandLine: async (pid) => pid === stalePid ? `/usr/bin/kitty --listen-on unix:${staleSocket}` : "",
    runDetached: async (command, args, options = {}) => {
      detachedCalls.push({ command, args, options });
      return { pid: process.pid };
    },
    runBuffered: async (command, args) => {
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      if (args.includes(`unix:${staleSocket}`)) {
        throw new Error("Connection refused");
      }
      assert.ok(args.includes(`unix:${replacementSocket}`), `unexpected socket in args: ${args.join(" ")}`);
      if (args.includes("launch")) {
        return { stdout: "42\n", stderr: "", code: 0 };
      }
      if (args.includes("ls")) {
        return { stdout: fakeKittyLs(), stderr: "", code: 0 };
      }
      if (args.includes("get-text")) {
        return { stdout: getTextFrames.shift() ?? "prompt\nprintf fresh", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    runWithInput: async (command, args, input) => {
      inputCalls.push({ command, args, input });
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    const sent = await controller.callTool("kitty_send", { short_id: "K8", command: "printf fresh", quiet_ms: 0 });
    assert.equal(sent.instance_id, "ki_replacement");
    assert.equal(sent.short_id, "K8");
    assert.equal(sent.window_id, 42);
    assert.equal(existsSync(staleSocket), false);
    assert.ok(detachedCalls[0].args.includes("--start-as=hidden"));
    assert.equal(inputCalls[0].input, "printf fresh\n");
    assert.deepEqual(killed, [{ pid: stalePid, signal: "SIGTERM" }]);
    const registry = JSON.parse(readFileSync(path.join(stateRoot, "instances.json"), "utf8"));
    assert.deepEqual(registry.instances.map((instance) => instance.instance_id), ["ki_replacement"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testSendReplacesWindowlessRegisteredInstance() {
  const tempDir = makeTempDir("codex-plugin-kitty-replace-windowless-");
  const stateRoot = path.join(tempDir, "state");
  const socketsDir = path.join(stateRoot, "sockets");
  mkdirSync(socketsDir, { recursive: true });
  const windowlessSocket = path.join(socketsDir, "windowless.sock");
  const replacementSocket = path.join(socketsDir, "ki_replacement_windowless.sock");
  const windowlessPid = 999999999;
  writeFileSync(windowlessSocket, "");
  writeFileSync(
    path.join(stateRoot, "instances.json"),
    JSON.stringify({
      version: 1,
      instances: [
        { instance_id: "ki_windowless", short_id: "K8", kind: "managed", socket: windowlessSocket, pid: windowlessPid, status: "running", cwd: tempDir },
      ],
    }),
  );

  const detachedCalls = [];
  const inputCalls = [];
  const killed = [];
  const killedPids = new Set();
  const getTextFrames = ["prompt", "prompt\nprintf fresh", "prompt\nprintf fresh"];
  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: {
      CODEX_KITTY_BIN: "kitty-test",
      CODEX_KITTEN_BIN: "kitten-test",
    },
    makeId: () => "ki_replacement_windowless",
    waitForSocket: async (socket) => {
      mkdirSync(path.dirname(socket), { recursive: true });
      writeFileSync(socket, "");
      return true;
    },
    sleep: async () => {},
    processAlive: (pid) => pid === windowlessPid && !killedPids.has(pid),
    killProcess: (pid, signal) => {
      killed.push({ pid, signal });
      if (signal === "SIGTERM") {
        killedPids.add(pid);
      }
    },
    readProcessCommandLine: async (pid) => pid === windowlessPid ? `/usr/bin/kitty --listen-on unix:${windowlessSocket}` : "",
    runDetached: async (command, args, options = {}) => {
      detachedCalls.push({ command, args, options });
      return { pid: process.pid };
    },
    runBuffered: async (command, args) => {
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      if (args.includes(`unix:${windowlessSocket}`)) {
        return { stdout: "[]", stderr: "", code: 0 };
      }
      assert.ok(args.includes(`unix:${replacementSocket}`), `unexpected socket in args: ${args.join(" ")}`);
      if (args.includes("launch")) {
        return { stdout: "42\n", stderr: "", code: 0 };
      }
      if (args.includes("ls")) {
        return { stdout: fakeKittyLs(), stderr: "", code: 0 };
      }
      if (args.includes("get-text")) {
        return { stdout: getTextFrames.shift() ?? "prompt\nprintf fresh", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    runWithInput: async (command, args, input) => {
      inputCalls.push({ command, args, input });
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    const sent = await controller.callTool("kitty_send", { short_id: "K8", command: "printf fresh", quiet_ms: 0 });
    assert.equal(sent.instance_id, "ki_replacement_windowless");
    assert.equal(sent.short_id, "K8");
    assert.equal(sent.window_id, 42);
    assert.equal(existsSync(windowlessSocket), false);
    assert.ok(detachedCalls[0].args.includes("--start-as=hidden"));
    assert.equal(inputCalls[0].input, "printf fresh\n");
    assert.deepEqual(killed, [{ pid: windowlessPid, signal: "SIGTERM" }]);
    const registry = JSON.parse(readFileSync(path.join(stateRoot, "instances.json"), "utf8"));
    assert.deepEqual(registry.instances.map((instance) => instance.instance_id), ["ki_replacement_windowless"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testOpenPrunesInactiveBeforeAllocatingShortId() {
  const tempDir = makeTempDir("codex-plugin-kitty-open-prune-inactive-");
  const stateRoot = path.join(tempDir, "state");
  const socketsDir = path.join(stateRoot, "sockets");
  mkdirSync(socketsDir, { recursive: true });
  const windowlessSocket = path.join(socketsDir, "windowless.sock");
  const unreachableSocket = path.join(socketsDir, "unreachable.sock");
  const replacementSocket = path.join(socketsDir, "ki_replacement_open.sock");
  const windowlessPid = 999999999;
  const unreachablePid = 999999998;
  writeFileSync(windowlessSocket, "");
  writeFileSync(unreachableSocket, "");
  writeFileSync(
    path.join(stateRoot, "instances.json"),
    JSON.stringify({
      version: 1,
      last_used_short_id: "K2",
      instances: [
        { instance_id: "ki_windowless", short_id: "K1", kind: "managed", socket: windowlessSocket, pid: windowlessPid, status: "running", cwd: tempDir },
        { instance_id: "ki_unreachable", short_id: "K2", kind: "managed", socket: unreachableSocket, pid: unreachablePid, status: "running", cwd: tempDir },
      ],
    }),
  );

  const detachedCalls = [];
  const killed = [];
  const killedPids = new Set();
  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: {
      CODEX_KITTY_BIN: "kitty-test",
      CODEX_KITTEN_BIN: "kitten-test",
    },
    makeId: () => "ki_replacement_open",
    waitForSocket: async (socket) => {
      mkdirSync(path.dirname(socket), { recursive: true });
      writeFileSync(socket, "");
      return true;
    },
    sleep: async () => {},
    processAlive: (pid) => (pid === windowlessPid || pid === unreachablePid) && !killedPids.has(pid),
    killProcess: (pid, signal) => {
      killed.push({ pid, signal });
      if (signal === "SIGTERM") {
        killedPids.add(pid);
      }
    },
    readProcessCommandLine: async (pid) => {
      if (pid === windowlessPid) {
        return `/usr/bin/kitty --listen-on unix:${windowlessSocket}`;
      }
      if (pid === unreachablePid) {
        return `/usr/bin/kitty --listen-on unix:${unreachableSocket}`;
      }
      return "";
    },
    runDetached: async (command, args, options = {}) => {
      detachedCalls.push({ command, args, options });
      return { pid: process.pid };
    },
    runBuffered: async (command, args) => {
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      if (args.includes(`unix:${windowlessSocket}`)) {
        return { stdout: "[]", stderr: "", code: 0 };
      }
      if (args.includes(`unix:${unreachableSocket}`)) {
        const error = new Error(`connect ECONNREFUSED ${unreachableSocket}`);
        error.code = "ECONNREFUSED";
        throw error;
      }
      assert.ok(args.includes(`unix:${replacementSocket}`), `unexpected socket in args: ${args.join(" ")}`);
      if (args.includes("launch")) {
        return { stdout: "42\n", stderr: "", code: 0 };
      }
      if (args.includes("ls")) {
        return { stdout: fakeKittyLs(), stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  try {
    const opened = await controller.callTool("kitty_open", { title: "Replacement Open" });
    assert.equal(opened.instance_id, "ki_replacement_open");
    assert.equal(opened.short_id, "K1");
    assert.equal(existsSync(windowlessSocket), false);
    assert.equal(existsSync(unreachableSocket), false);
    assert.deepEqual(killed, [
      { pid: windowlessPid, signal: "SIGTERM" },
      { pid: unreachablePid, signal: "SIGTERM" },
    ]);
    assert.equal(detachedCalls[0].options.env.CODEX_KITTY_SHORT_ID, "K1");
    const registry = JSON.parse(readFileSync(path.join(stateRoot, "instances.json"), "utf8"));
    assert.deepEqual(registry.instances.map((instance) => instance.instance_id), ["ki_replacement_open"]);
    assert.equal(registry.instances[0].short_id, "K1");
    assert.equal(registry.last_used_short_id, "K1");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testAdoptedRegistrySelection() {
  const tempDir = makeTempDir("codex-plugin-kitty-adopted-");
  const stateRoot = path.join(tempDir, "state");
  const socket = path.join(stateRoot, "adopted", "K1.sock");
  const bufferedCalls = [];
  const inputCalls = [];
  const getTextFrames = ["prompt", "prompt\nprintf ok", "prompt\nprintf ok", "before q", "after q"];
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
      if (args.includes("get-text")) {
        return { stdout: getTextFrames.shift() ?? "after q", stderr: "", code: 0 };
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

    const command = await controller.callTool("kitty_send", { short_id: "K1", command: "printf ok", quiet_ms: 0 });
    assert.equal(command.instance_id, "ki_adopted_k1");
    assert.equal(command.short_id, "K1");
    assert.equal(command.target.instance_kind, "adopted");
    assert.ok(inputCalls[0].args.includes("send-text"));
    assert.equal(inputCalls[0].input, "printf ok\n");
    assert.equal(bufferedCalls.some((call) => call.args.includes("launch")), false);

    const sent = await controller.callTool("kitty_send", { short_id: "K1", text: "q", feedback_delay_ms: 0 });
    assert.equal(sent.short_id, "K1");
    assert.equal(sent.window_id, 42);
    assert.equal(inputCalls.at(-1).input, "q");

    await assert.rejects(
      () => controller.callTool("kitty_close", { short_id: "K1" }),
      /refusing to close adopted kitty instance/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testLastUsedShortIdSelection() {
  const tempDir = makeTempDir("codex-plugin-kitty-last-used-");
  const stateRoot = path.join(tempDir, "state");
  mkdirSync(path.join(stateRoot, "sockets"), { recursive: true });
  const firstSocket = path.join(stateRoot, "sockets", "k1.sock");
  const secondSocket = path.join(stateRoot, "sockets", "k2.sock");
  writeFileSync(firstSocket, "");
  writeFileSync(secondSocket, "");
  writeFileSync(
    path.join(stateRoot, "instances.json"),
    JSON.stringify({
      version: 1,
      last_used_short_id: "K2",
      instances: [
        { instance_id: "ki_one", short_id: "K1", kind: "managed", socket: firstSocket, status: "running", cwd: tempDir },
        { instance_id: "ki_two", short_id: "K2", kind: "managed", socket: secondSocket, status: "running", cwd: tempDir },
      ],
    }),
  );

  const inputCalls = [];
  const getTextFrames = ["prompt", "prompt\npwd", "prompt\npwd"];
  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: { CODEX_KITTEN_BIN: "kitten-test" },
    makeId: (prefix) => `${prefix}_last`,
    runBuffered: async (command, args) => {
      if (command !== "kitten-test") {
        throw new Error(`unexpected command: ${command}`);
      }
      if (args.includes("ls")) {
        return { stdout: fakeKittyLs(), stderr: "", code: 0 };
      }
      if (args.includes("get-text")) {
        return { stdout: getTextFrames.shift() ?? "prompt\npwd", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    runWithInput: async (command, args, input) => {
      inputCalls.push({ command, args, input });
      return { stdout: "", stderr: "", code: 0 };
    },
  });
  try {
    const sent = await controller.callTool("kitty_send", { command: "pwd", quiet_ms: 0 });
    assert.equal(sent.short_id, "K2");
    assert.equal(sent.instance_id, "ki_two");
    assert.equal(inputCalls[0].input, "pwd\n");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testSendWaitStrategies() {
  const tempDir = makeTempDir("codex-plugin-kitty-wait-");
  const stateRoot = path.join(tempDir, "state");
  const socket = path.join(stateRoot, "sockets", "ki_wait.sock");
  const inputCalls = [];
  const bufferedCalls = [];
  let nowMs = 1_800_000_100_000;
  let getTextFrames = [];
  mkdirSync(path.dirname(socket), { recursive: true });
  writeFileSync(socket, "");
  writeFileSync(
    path.join(stateRoot, "instances.json"),
    JSON.stringify({
      version: 1,
      instances: [{ instance_id: "ki_wait", short_id: "K1", kind: "managed", socket, status: "running", cwd: tempDir }],
    }),
  );

  const controller = createKittyController({
    cwd: tempDir,
    stateRoot,
    env: { CODEX_KITTEN_BIN: "kitten-test" },
    nowMs: () => nowMs,
    sleep: async (ms) => {
      nowMs += ms;
    },
    runBuffered: async (command, args) => {
      bufferedCalls.push({ command, args });
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
    const none = await controller.callTool("kitty_send", { short_id: "K1", text: "x", wait_for: "none" });
    assert.equal(none.feedback, undefined);
    assert.equal(inputCalls.at(-1).input, "x");

    getTextFrames = ["before", "after"];
    const change = await controller.callTool("kitty_send", { short_id: "K1", text: "y", wait_for: "change", timeout_ms: 500 });
    assert.equal(change.feedback.wait_for, "change");
    assert.equal(change.feedback.changed, true);
    assert.equal(change.feedback.timed_out, false);

    getTextFrames = ["before regex", "still waiting", "done MATCH"];
    const regex = await controller.callTool("kitty_send", { short_id: "K1", text: "z", wait_for: "regex", pattern: "MATCH", timeout_ms: 500 });
    assert.equal(regex.feedback.wait_for, "regex");
    assert.equal(regex.feedback.matched, true);
    assert.equal(regex.feedback.timed_out, false);

    await assert.rejects(
      () => controller.callTool("kitty_send", { short_id: "K1", text: "bad", wait_for: "regex" }),
      /pattern must be a non-empty string/,
    );

    getTextFrames = ["same", "same", "same"];
    const timeout = await controller.callTool("kitty_send", { short_id: "K1", text: "t", wait_for: "change", timeout_ms: 100 });
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

function testKittyWindowAccessInstaller() {
  const tempDir = makeTempDir("codex-plugin-kitty-access-");
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
        ...withoutCodexKittyEnv(),
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
        ...withoutCodexKittyEnv(),
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
        ...withoutCodexKittyEnv(),
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
        ...withoutCodexKittyEnv(),
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
  const tempDir = makeTempDir("codex-plugin-kitty-access-skip-wrapper-");
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
        ...withoutCodexKittyEnv(),
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
  const scannedFiles = [...readTextFiles(pluginRoot), ...readTextFiles(kittyWindowAccessScript)];
  const offenders = scannedFiles
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
  testKittyWindowAccessInstaller();
  testKittyWindowAccessWrapperSkip();
  testMarketplaceScripts();
  testLocalMarketplaceMetadata();
  await testControllerTools();
  await testManagedOpenTemporarilyRestoresKwinFocus();
  await testAutoCreatedCommandUsesRequestedSharedShell();
  await testDefaultDetachedEnvDoesNotRePolluteManagedKitty();
  await testManagedKittyUsesUserSessionEnvironmentWhenMcpEnvIsHeadless();
  await testListPrunesClosedAndDeadInstances();
  await testSendReplacesUnreachableRegisteredInstance();
  await testSendReplacesWindowlessRegisteredInstance();
  await testOpenPrunesInactiveBeforeAllocatingShortId();
  await testAdoptedRegistrySelection();
  await testLastUsedShortIdSelection();
  await testSendWaitStrategies();
  await testErrorShapes();
  await testLineDelimitedMcpServer();
  await testHeaderDelimitedMcpServer();
  console.log("Kitty plugin tests passed");
}

await main();
