#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createComputerUseController, createComputerUseEnv } from "../plugins/computer-use/scripts/computer-use-lib.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const installerRoot = path.dirname(scriptDir);
const pluginRoot = path.join(installerRoot, "plugins", "computer-use");
const localMarketplacePath = path.join(installerRoot, ".agents", "plugins", "marketplace.json");
const mcpScript = path.join(pluginRoot, "scripts", "computer-use-mcp.mjs");
const isolatedSessionScript = path.join(pluginRoot, "scripts", "computer-use-isolated-session.py");
const stateScript = path.join(pluginRoot, "scripts", "computer-use-state.mjs");
const architectureDoc = path.join(pluginRoot, "docs", "v2-architecture.md");
const xwaylandEnvironmentScript = path.join(pluginRoot, "scripts", "computer-use-xwayland-environment.py");
const nativeHelperSource = path.join(pluginRoot, "native", "codex-computer-use-screenshot.cpp");
const eisHelperSource = path.join(pluginRoot, "native", "codex-computer-use-eis.cpp");
const glowHelperSource = path.join(pluginRoot, "native", "codex-computer-use-glow.cpp");
const nativeHelperCmake = path.join(pluginRoot, "native", "CMakeLists.txt");
const accessScript = path.join(scriptDir, "install-computer-use-access.sh");
const activateScript = path.join(scriptDir, "activate-install.sh");
const expectedTools = [
  "isolated_start",
  "isolated_stop",
  "isolated_status",
  "find_roots",
  "observe_ui",
  "search_ui",
  "expand_ui",
  "inspect_ui",
  "act_ui",
  "read_text",
  "wait_for",
];

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

async function main() {
  await testStateScopedController();
  assert.ok(existsSync(path.join(pluginRoot, ".codex-plugin", "plugin.json")), "missing plugin manifest");
  assert.ok(existsSync(path.join(pluginRoot, ".mcp.json")), "missing MCP manifest");
  assert.ok(existsSync(mcpScript), "missing MCP server");
  assert.ok(existsSync(isolatedSessionScript), "missing isolated session helper");
  assert.ok(existsSync(stateScript), "missing v2 state layer");
  assert.ok(existsSync(architectureDoc), "missing v2 architecture contract");
  assert.ok(existsSync(xwaylandEnvironmentScript), "missing isolated Xwayland environment helper");
  assert.ok(existsSync(nativeHelperSource), "missing native screenshot helper source");
  assert.ok(existsSync(eisHelperSource), "missing native EIS helper source");
  assert.ok(existsSync(glowHelperSource), "missing native cursor glow theme generator source");
  assert.ok(existsSync(nativeHelperCmake), "missing native helper CMake build definition");
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
  assert.equal(mcp?.["kwin-mcp"], undefined);
  assert.equal(mcp.mcp_servers, undefined);
  assert.equal(mcp.mcpServers, undefined);

  const hydratedEnv = createComputerUseEnv(
    { PATH: "/usr/bin", DBUS_SESSION_BUS_ADDRESS: "" },
    {
      parentEnv: {
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
        XDG_RUNTIME_DIR: "/run/user/1000",
        WAYLAND_DISPLAY: "wayland-0",
        DISPLAY: ":0",
        XDG_CURRENT_DESKTOP: "KDE",
        KDE_FULL_SESSION: "true",
      },
      systemdUserEnv: {
        DISPLAY: ":should-not-override-parent",
      },
    },
  );
  assert.equal(hydratedEnv.PATH, "/usr/bin");
  assert.equal(hydratedEnv.DBUS_SESSION_BUS_ADDRESS, "unix:path=/run/user/1000/bus");
  assert.equal(hydratedEnv.XDG_RUNTIME_DIR, "/run/user/1000");
  assert.equal(hydratedEnv.WAYLAND_DISPLAY, "wayland-0");
  assert.equal(hydratedEnv.DISPLAY, ":0");
  assert.equal(hydratedEnv.XDG_CURRENT_DESKTOP, "KDE");
  assert.equal(hydratedEnv.KDE_FULL_SESSION, "true");

  const systemdHydratedEnv = createComputerUseEnv(
    { PATH: "/usr/bin" },
    {
      parentEnv: {},
      systemdUserEnv: {
        DISPLAY: ":0",
        WAYLAND_DISPLAY: "wayland-0",
        XDG_CURRENT_DESKTOP: "KDE",
      },
    },
  );
  const runtimeDir = `/run/user/${process.getuid()}`;
  assert.equal(systemdHydratedEnv.DBUS_SESSION_BUS_ADDRESS, `unix:path=${runtimeDir}/bus`);
  assert.equal(systemdHydratedEnv.XDG_RUNTIME_DIR, runtimeDir);
  assert.equal(systemdHydratedEnv.DISPLAY, ":0");
  assert.equal(systemdHydratedEnv.WAYLAND_DISPLAY, "wayland-0");

  const brokerSource = readFileSync(path.join(pluginRoot, "scripts", "computer-use-broker.py"), "utf8");
  assert.match(brokerSource, /org\.freedesktop\.host\.portal\.Registry/);
  assert.match(brokerSource, /CODEX_COMPUTER_USE_SCREENSHOT_HELPER/);
  assert.match(brokerSource, /codex-computer-use-screenshot/);
  assert.match(brokerSource, /subprocess\.run/);
  assert.match(brokerSource, /CODEX_COMPUTER_USE_PORTAL_APP_ID/);
  assert.match(brokerSource, /ensure_portal_input/);
  assert.doesNotMatch(brokerSource, /CODEX_COMPUTER_USE_INPUT_BACKEND/);
  assert.match(brokerSource, /StatusNotifierWatcher/);
  assert.match(brokerSource, /StatusNotifierItem/);
  assert.match(brokerSource, /COMPUTER_USE_PROTOCOL_VERSION = 2/);
  assert.match(brokerSource, /lease_acquire/);
  assert.match(brokerSource, /lease_validate/);
  assert.match(brokerSource, /lease_release/);
  assert.match(brokerSource, /window-image-px/);
  assert.match(brokerSource, /accessibility_source_space/);
  assert.match(brokerSource, /setTextContents/);
  assert.match(brokerSource, /registerEventListener/);
  assert.doesNotMatch(brokerSource, /moveToDesktopOne|prepare_active_for_operation|restore_window_desktops|release_desktops/);
  assert.doesNotMatch(brokerSource, /wl-copy/);
  assert.doesNotMatch(brokerSource, /dbus\.types\.UnixFd|qimage_raw_to_pillow|unsupported QImage format from KWin screenshot/);
  assert.doesNotMatch(brokerSource, /ydotool|uinput/i);

  const isolatedSource = readFileSync(isolatedSessionScript, "utf8");
  assert.match(isolatedSource, /kwin_wayland/);
  assert.match(isolatedSource, /--xwayland/);
  assert.match(isolatedSource, /XWAYLAND_ENVIRONMENT_HELPER_PATH/);
  assert.match(isolatedSource, /xwayland_display/);
  assert.match(brokerSource, /StartTransientUnit/);
  assert.match(brokerSource, /SIGSTOP/);
  assert.match(brokerSource, /PPid:/);
  assert.match(brokerSource, /--signal=CONT/);
  assert.match(brokerSource, /reset-failed/);
  assert.match(brokerSource, /runtime_dir = host_runtime \/ "codex-computer-use" \/ unit_token/);
  assert.match(brokerSource, /computer-use-isolated-stderr/);
  assert.doesNotMatch(brokerSource, /systemd-run/);
  assert.doesNotMatch(brokerSource, /--property=KillMode=control-group/);
  assert.match(isolatedSource, /CODEX_COMPUTER_USE_EIS_HELPER/);
  assert.match(isolatedSource, /gui-profile/);
  assert.match(isolatedSource, /NameHasOwner/);
  assert.match(isolatedSource, /AT_SPI_BUS_ADDRESS/);
  assert.match(isolatedSource, /org\.a11y\.atspi\.Registry/);
  assert.doesNotMatch(isolatedSource, /kwin_mcp/);

  const nativeHelperSourceText = readFileSync(nativeHelperSource, "utf8");
  assert.match(nativeHelperSourceText, /QDBusInterface/);
  assert.match(nativeHelperSourceText, /QDBusUnixFileDescriptor/);
  assert.match(nativeHelperSourceText, /org\.kde\.KWin\.ScreenShot2/);
  assert.match(nativeHelperSourceText, /QImage/);
  assert.match(nativeHelperSourceText, /data_base64/);
  assert.match(nativeHelperSourceText, /memfd_create/);
  assert.match(nativeHelperSourceText, /CaptureWindow/);

  const eisHelperSourceText = readFileSync(eisHelperSource, "utf8");
  assert.match(eisHelperSourceText, /org\.kde\.KWin\.EIS\.RemoteDesktop/);
  assert.match(eisHelperSourceText, /libei\.so\.1/);
  assert.match(eisHelperSourceText, /ei_seat_bind_capabilities/);

  const glowHelperSourceText = readFileSync(glowHelperSource, "utf8");
  assert.match(glowHelperSourceText, /XcursorFilenameLoadImages/);
  assert.match(glowHelperSourceText, /XcursorFilenameSaveImages/);
  assert.match(glowHelperSourceText, /outward-edge-diffusion/);
  assert.match(glowHelperSourceText, /pulse_radius/);

  const accessSource = readFileSync(accessScript, "utf8");
  assert.match(accessSource, /codex-computer-use-screenshot\.desktop/);
  assert.match(accessSource, /codex-computer-use-glow\.cpp/);
  assert.match(accessSource, /codex-computer-use-eis\.cpp/);
  assert.match(accessSource, /cmake --build/);
  assert.match(accessSource, /libXcursor/);
  assert.match(accessSource, /plasma-apply-cursortheme/);
  assert.match(accessSource, /CODEX_COMPUTER_USE_SCREENSHOT_HELPER/);
  assert.match(accessSource, /CODEX_COMPUTER_USE_CURSOR_GLOW_THEME_PATH/);
  assert.match(accessSource, /X-KDE-DBUS-Restricted-Interfaces=org\.kde\.KWin\.ScreenShot2/);
  assert.match(accessSource, /kde-authorized/);
  assert.match(accessSource, /remote-desktop/);
  assert.match(accessSource, /Removed stale Computer Use direct input service/);
  assert.doesNotMatch(accessSource, /\/usr\/bin\/python3|node-22/);
  assert.doesNotMatch(accessSource, /ExecStart=.*ydotool|codex-computer-use-ydotool\.socket|\/dev\/uinput/i);

  const activateSource = readFileSync(activateScript, "utf8");
  assert.match(activateSource, /DESKTOP_ENTRY_KWIN_ALIAS_PATH/);
  assert.match(activateSource, /codex\.desktop/);
  assert.doesNotMatch(activateSource, /X-KDE-DBUS-Restricted-Interfaces=org\.kde\.KWin\.ScreenShot2/);
  assert.doesNotMatch(activateSource, /Could not enable Computer Use direct access/);

  testAccessScriptInstallsNativeHelpersAndScreenshotDesktopEntry();

  const client = startMcpServer();
  try {
    const init = await client.request("initialize", { protocolVersion: "2025-06-18" });
    assert.equal(init.result.serverInfo.name, "computer-use");
    assert.equal(init.result.serverInfo.version, "2.1.1");
    assert.match(init.result.instructions, /KDE Wayland/);
    assert.match(init.result.instructions, /state-scoped/);
    assert.match(init.result.instructions, /find_roots/);
    assert.match(init.result.instructions, /observe_ui/);
    assert.doesNotMatch(init.result.instructions, /fallback/i);
    assert.match(init.result.instructions, /foreground/);
    assert.match(init.result.instructions, /isolated Computer Use is the default/i);
    assert.match(init.result.instructions, /foreground_reason/);
    assert.doesNotMatch(init.result.instructions, /ydotool|uinput/i);

    const listed = await client.request("tools/list", {});
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), expectedTools);
    for (const tool of listed.result.tools) {
      assert.equal(tool.inputSchema.type, "object", `${tool.name} schema should be object`);
      assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} should reject unknown fields`);
      assert.ok(tool.description.length >= 20, `${tool.name} needs a useful description`);

      assert.equal(tool.inputSchema.properties?.backend, undefined, `${tool.name} should not expose a backend selector`);
      assert.equal(tool.inputSchema.properties?.allow_portal_fallback, undefined, `${tool.name} should not expose portal fallback`);
    }

    const findRootsTool = listed.result.tools.find((tool) => tool.name === "find_roots");
    assert.equal(findRootsTool.inputSchema.properties.foreground_reason.minLength, 1);
    assert.equal(findRootsTool.inputSchema.oneOf.length, 2);

    const appsResult = await client.request("tools/call", {
      name: "find_roots",
      arguments: {
        kind: "application",
        query: "dolphin",
        limit: 5,
        include_hidden: false,
        foreground_reason: "Verify foreground application-root discovery contract",
      },
    });
    const appsText = appsResult.result.content?.find((item) => item.type === "text")?.text ?? "{}";
    assert.equal(appsResult.result.isError, undefined, appsText);
    const apps = JSON.parse(appsText);
    assert.equal(apps.protocolVersion, 2);
    assert.ok(Array.isArray(apps.roots));
    assert.ok(apps.roots.length <= 5);
    for (const app of apps.roots) {
      assert.match(app.rootRef, /^@r\d+$/);
      assert.equal(app.kind, "application");
      assert.equal(typeof app.desktop_id, "string");
      assert.equal(typeof app.name, "string");
      assert.equal(typeof app.exec, "string");
      assert.deepEqual(app.routing, {
        target: "foreground",
        reason: "Verify foreground application-root discovery contract",
      });
      assert.equal(typeof app.hidden, "boolean");
    }

    const actTool = listed.result.tools.find((tool) => tool.name === "act_ui");
    assert.ok(actTool, "missing transactional action tool");
    assert.deepEqual(actTool.inputSchema.properties.policy.enum, ["semantic_only", "auto", "foreground"]);
    assert.equal(actTool.inputSchema.properties.actions.minItems, 1);
    assert.equal(actTool.inputSchema.properties.expect.type, "object");
    assert.equal(actTool.inputSchema.properties.response.default, "compact");

    const waitTool = listed.result.tools.find((tool) => tool.name === "wait_for");
    assert.equal(waitTool.inputSchema.properties.response.default, "compact");
    assert.match(waitTool.inputSchema.properties.expect.properties.gone.description, /Without ref.*root\/window/i);

    const observeTool = listed.result.tools.find((tool) => tool.name === "observe_ui");
    assert.deepEqual(observeTool.inputSchema.required, ["rootRef"]);
    assert.equal(observeTool.inputSchema.properties.include_image.default, true);

    const isolatedStart = listed.result.tools.find((tool) => tool.name === "isolated_start");
    assert.ok(isolatedStart, "missing isolated session start tool");
    assert.equal(isolatedStart.inputSchema.properties.screen_width.default, 1280);
    assert.equal(isolatedStart.inputSchema.properties.screen_height.default, 800);
  } finally {
    client.stop();
  }
}

async function testStateScopedController() {
  const calls = [];
  let observationIndex = 0;
  const observation = (text) => ({
    protocol_version: 2,
    look_id: `look-${++observationIndex}`,
    captured_at: observationIndex,
    root: { kind: "window", title: "Demo" },
    backend_root: {
      kind: "window",
      backend_ref: "window-1",
      resource_key: "desktop-pid:42",
      pid: 42,
      backend_coordinate_transform: { window_id: "window-1" },
    },
    window: { id: "window-1", title: "Demo", pid: 42 },
    coordinate_space: { name: "window-image-px", width: 640, height: 480 },
    outline: {
      nodes: [
        {
          wire_ref: `wire-${observationIndex}-1`,
          backend_window_bounds: { x: 0, y: 0, width: 640, height: 480 },
          depth: 0,
          role: "frame",
          name: "Demo",
          states: ["active"],
        },
        { wire_ref: `wire-${observationIndex}-2`, depth: 1, role: "entry", name: "Name", text, capabilities: ["text", "editable_text"] },
      ],
      truncated: false,
    },
  });
  const broker = {
    async call(method, params) {
      calls.push({ method, params });
      if (method === "find_roots") {
        assert.equal(params.foreground_reason, undefined);
        return {
          protocol_version: 2,
          roots: [{ kind: "window", backend_ref: "window-1", resource_key: "desktop-pid:42", pid: 42, title: "Demo" }],
        };
      }
      if (method === "observe_root") {
        assert.deepEqual(params.root.routing, {
          target: "foreground",
          reason: "Operate the existing Demo window state",
        });
        return observation("before");
      }
      if (method === "act_transaction") {
        assert.match(params.look_id, /^look-/);
        assert.match(params.actions[0].wire_ref, /^wire-/);
        return { outcome: "worked", evidence: [{ outcome: "worked", verified: true }], observation: observation("after") };
      }
      if (method === "read_text") {
        return { text: "before", value: null };
      }
      if (method === "wait_for") {
        return { outcome: "worked", evidence: [{ outcome: "worked" }], observation: observation("settled") };
      }
      throw new Error(`unexpected fake broker method ${method}`);
    },
    stop() {},
  };
  const controller = createComputerUseController({ broker, timeoutMs: 1000, env: {} });
  await assert.rejects(
    controller.callTool("find_roots", { kind: "window" }),
    /use isolated_start/,
  );
  await assert.rejects(
    controller.callTool("find_roots", { kind: "window", foreground_reason: "   " }),
    /use isolated_start/,
  );
  await assert.rejects(
    controller.callTool("find_roots", {
      session_id: "isolated-test",
      foreground_reason: "invalid mixed authority",
      kind: "window",
    }),
    /cannot be combined/,
  );
  const found = await controller.callTool("find_roots", {
    kind: "window",
    foreground_reason: "Operate the existing Demo window state",
  });
  assert.equal(found.protocolVersion, 2);
  assert.equal(found.roots[0].rootRef, "@r1");
  assert.deepEqual(found.roots[0].routing, {
    target: "foreground",
    reason: "Operate the existing Demo window state",
  });
  const isolatedFound = await controller.callTool("find_roots", {
    session_id: "isolated-test",
    kind: "window",
  });
  assert.equal(isolatedFound.roots[0].rootRef, "@r2");
  assert.deepEqual(isolatedFound.roots[0].routing, { target: "isolated" });
  const first = await controller.callTool("observe_ui", { rootRef: "@r1", include_image: false });
  assert.equal(first.stateId, "state-1");
  assert.equal(first.epoch, 0);
  assert.deepEqual(first.outline.nodes.map((node) => node.ref), ["@e1", "@e2"]);
  assert.equal(first.outline.nodes[0].wire_ref, undefined);
  assert.equal(first.outline.nodes[0].backend_window_bounds, undefined);
  assert.equal((await controller.callTool("search_ui", { stateId: first.stateId, query: "before" })).matches[0].ref, "@e2");
  assert.equal((await controller.callTool("expand_ui", { stateId: first.stateId, ref: "@e1" })).count, 2);
  assert.equal((await controller.callTool("inspect_ui", { stateId: first.stateId, ref: "@e2" })).node.text, "before");
  assert.equal((await controller.callTool("read_text", { stateId: first.stateId, ref: "@e2" })).text, "before");
  const acted = await controller.callTool("act_ui", {
    stateId: first.stateId,
    actions: [{ op: "set_text", ref: "@e2", text: "after" }],
    expect: { ref: "@e2", value: "after" },
    include_image: false,
  });
  assert.equal(acted.outcome, "worked");
  assert.equal(acted.observation.epoch, 1);
  assert.equal(acted.observation.outline.nodeCount, 2);
  assert.equal(acted.observation.outline.nodes, undefined);
  assert.equal(acted.diff.changed, true);
  assert.equal((await controller.callTool("search_ui", { stateId: acted.observation.stateId, query: "after" })).matches[0].ref, "@e2");
  const waited = await controller.callTool("wait_for", {
    stateId: acted.observation.stateId,
    expect: { text: "settled" },
    include_image: false,
    response: "full",
  });
  assert.equal(waited.observation.outline.nodes[1].text, "settled");
  await assert.rejects(
    controller.callTool("act_ui", { stateId: first.stateId, actions: [{ op: "press", ref: "@e2" }] }),
    /stale state/,
  );
  await assert.rejects(
    controller.callTool("read_text", { stateId: first.stateId, ref: "@e2" }),
    /stale state/,
  );
  assert.ok(calls.some((call) => call.method === "act_transaction"));
  controller.stop();
}

function writeExecutable(file, source) {
  writeFileSync(file, source, "utf8");
  chmodSync(file, 0o755);
}

function testAccessScriptInstallsNativeHelpersAndScreenshotDesktopEntry() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-computer-use-access-test-"));
  try {
    const fakeBin = path.join(tempDir, "bin");
    const dataHome = path.join(tempDir, "share");
    const configHome = path.join(tempDir, "config");
    const helperPath = path.join(dataHome, "codex-app", "computer-use", "codex-computer-use-screenshot");
    const eisHelperPath = path.join(dataHome, "codex-app", "computer-use", "codex-computer-use-eis");
    const glowThemePath = path.join(dataHome, "icons", "Codex-Computer-Use-Glow");
    writeFileSync(path.join(tempDir, ".keep"), "");
    spawnSync("mkdir", ["-p", fakeBin, dataHome, configHome], { stdio: "pipe" });

    for (const command of ["systemctl", "update-desktop-database", "kbuildsycoca6", "kbuildsycoca5"]) {
      writeExecutable(path.join(fakeBin, command), "#!/usr/bin/env bash\nexit 0\n");
    }

    const result = spawnSync("bash", [accessScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        XDG_DATA_HOME: dataHome,
        XDG_CONFIG_HOME: configHome,
        CODEX_COMPUTER_USE_PORTAL_PREAUTH: "0",
        CODEX_COMPUTER_USE_NATIVE_SOURCE_DIR: path.dirname(nativeHelperSource),
        CODEX_COMPUTER_USE_CURSOR_BASE_THEME: "Togawa-Sakiko-Pixel-Linux",
        CODEX_COMPUTER_USE_CURSOR_BASE_SIZE: "32",
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(existsSync(helperPath), "expected access script to install helper executable");
    assert.ok(existsSync(eisHelperPath), "expected access script to install EIS helper executable");
    assert.ok(existsSync(path.join(glowThemePath, "index.theme")), "expected access script to generate glow theme metadata");
    assert.ok(existsSync(path.join(glowThemePath, "cursors", "Normal")), "expected access script to generate Normal cursor frames");
    const glowThemeIndex = readFileSync(path.join(glowThemePath, "index.theme"), "utf8");
    assert.match(glowThemeIndex, /X-Codex-BaseTheme=Togawa-Sakiko-Pixel-Linux/);
    assert.match(glowThemeIndex, /X-Codex-Animation=outward-edge-diffusion/);

    const desktopEntry = readFileSync(path.join(dataHome, "applications", "codex-computer-use-screenshot.desktop"), "utf8");
    assert.match(desktopEntry, new RegExp(`Exec=${helperPath.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(desktopEntry, /NoDisplay=true/);
    assert.match(desktopEntry, /X-KDE-DBUS-Restricted-Interfaces=org\.kde\.KWin\.ScreenShot2/);
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
