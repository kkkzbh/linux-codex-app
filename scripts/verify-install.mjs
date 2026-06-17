#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createLinuxPatchContext } from "./linux-runtime/bundle-context.mjs";
import { linuxPatchFeatures, verifyLinuxPatchSource } from "./linux-runtime/features/index.mjs";
import { START_SCRIPT_MARKERS } from "./linux-runtime/markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent } from "./linux-runtime/replace-utils.mjs";
import {
  LINUX_PATCH_STATE_FILENAME,
  getAppAsarSignature,
  isLinuxPatchStateCurrent,
  loadLinuxPatchState,
} from "./linux-runtime/state.mjs";

const EXPECTED_APP_ICON_SHA256 = "1c926e380bfe6a50f40648dd9bc5de88da7271546491adf99ec72172e17df6a0";

function usage() {
  return `Usage: verify-install.mjs <install-dir>

Verify that a staged Codex install contains the current Linux runtime layout
and the expected installer-side patch markers.`;
}

function fail(message) {
  throw new Error(message);
}

function requirePath(pathValue, kind) {
  if (!existsSync(pathValue)) {
    fail(`Expected ${kind} not found: ${pathValue}`);
  }
}

function requireExecutable(pathValue) {
  requirePath(pathValue, "executable");
  const mode = lstatSync(pathValue).mode & 0o111;

  if (mode === 0) {
    fail(`Expected executable not found: ${pathValue}`);
  }
}

function sha256File(pathValue) {
  return createHash("sha256").update(readFileSync(pathValue)).digest("hex");
}

function verifyAppIcon(iconPath) {
  requirePath(iconPath, "file");

  const data = readFileSync(iconPath);
  const pngSignature = "89504e470d0a1a0a";
  if (data.subarray(0, 8).toString("hex") !== pngSignature) {
    fail(`Expected app icon to be a PNG: ${iconPath}`);
  }

  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== 544 || height !== 544) {
    fail(`Expected app icon to be 544x544, got ${width}x${height}: ${iconPath}`);
  }

  const sha256 = sha256File(iconPath);
  if (sha256 !== EXPECTED_APP_ICON_SHA256) {
    fail(`Expected installer app icon sha256 ${EXPECTED_APP_ICON_SHA256}, got ${sha256}: ${iconPath}`);
  }
}

function expectedLocalPluginNames() {
  const raw = process.env.CODEX_VERIFY_LOCAL_PLUGINS ?? process.env.CODEX_LOCAL_PLUGIN_NAMES ?? "dolphin,kitty,kde-computer-use";
  return raw
    .split(/[\s,]+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function runOrThrow(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status === 0) {
    return;
  }

  throw new Error(
    [
      `Command failed: ${command} ${args.join(" ")}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function runOrThrowWithEnv(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: "pipe",
  });

  if (result.status === 0) {
    return;
  }

  throw new Error(
    [
      `Command failed: ${command} ${args.join(" ")}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function verifyStartScript(startScriptPath) {
  const source = readFileSync(startScriptPath, "utf8");

  ensureMarkersPresent(source, START_SCRIPT_MARKERS.requiredMarkers, "start.sh");
  ensureMarkersAbsent(source, START_SCRIPT_MARKERS.forbiddenMarkers, "start.sh");

  const syntaxResult = spawnSync("bash", ["-n", startScriptPath], {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (syntaxResult.status !== 0) {
    fail(
      syntaxResult.stderr?.trim() || syntaxResult.stdout?.trim() || `bash -n failed for ${startScriptPath}`,
    );
  }
}

function verifyElectronSymlink(electronPath) {
  if (!lstatSync(electronPath).isSymbolicLink()) {
    fail(`Expected compatibility symlink at: ${electronPath}`);
  }

  if (realpathSync(electronPath) !== realpathSync(path.join(path.dirname(electronPath), "Codex"))) {
    fail(`Expected ${electronPath} to resolve to Codex`);
  }
}

function verifyPatchState(resourcesDir, appAsarPath) {
  const statePath = path.join(resourcesDir, LINUX_PATCH_STATE_FILENAME);
  requirePath(statePath, "patch-state file");

  const state = loadLinuxPatchState(statePath);
  const appAsarSignature = getAppAsarSignature(appAsarPath);

  if (!isLinuxPatchStateCurrent({ state, appAsarSignature, features: linuxPatchFeatures })) {
    fail(`Linux patch-state is stale or incomplete: ${statePath}`);
  }
}

function verifyBundle(resourcesDir, appAsarPath) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-linux-verify-"));

  try {
    runOrThrow("npx", ["--yes", "asar", "extract", appAsarPath, path.join(tempDir, "app")], resourcesDir);
    const context = createLinuxPatchContext(path.join(tempDir, "app"));
    const bundleSources = context.readBundleSources();
    verifyLinuxPatchSource(bundleSources, context);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function verifyChromeExtensionStatusInBundle(resourcesDir, appAsarPath) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-chrome-status-verify-"));

  try {
    runOrThrow("npx", ["--yes", "asar", "extract", appAsarPath, path.join(tempDir, "app")], resourcesDir);
    const context = createLinuxPatchContext(path.join(tempDir, "app"));
    const source = context.readMainSource();

    if (!/"chrome-extension-installed-read":async\(\{extensionId:e\}\)=>\(\{installed:[$A-Z_a-z][$\w]*\(\{extensionId:e\}\)\}\)/.test(source)) {
      fail("Expected Electron main bundle to expose chrome-extension-installed-read");
    }

    if (!/n===`linux`\?\(0,[$A-Z_a-z][$\w]*\.join\)\(e,`\.config`,`google-chrome`\):null/.test(source)) {
      fail("Expected Electron main bundle to detect installed Chrome extensions under ~/.config/google-chrome on Linux");
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function verifyBundledPlugins(resourcesDir) {
  const expectedLocalPlugins = new Set(expectedLocalPluginNames());
  const marketplacePath = path.join(resourcesDir, "plugins", "openai-bundled", ".agents", "plugins", "marketplace.json");
  const browserUseRoot = path.join(resourcesDir, "plugins", "openai-bundled", "plugins", "browser");
  const browserUsePluginJson = path.join(browserUseRoot, ".codex-plugin", "plugin.json");
  const browserUseClient = path.join(browserUseRoot, "scripts", "browser-client.mjs");
  const browserUseSkill = path.join(browserUseRoot, "skills", "control-in-app-browser", "SKILL.md");
  const chromeRoot = path.join(resourcesDir, "plugins", "openai-bundled", "plugins", "chrome");
  const chromePluginJson = path.join(chromeRoot, ".codex-plugin", "plugin.json");
  const chromeClient = path.join(chromeRoot, "scripts", "browser-client.mjs");
  const chromeRunningCheck = path.join(chromeRoot, "scripts", "chrome-is-running.js");
  const chromeManifestCheck = path.join(chromeRoot, "scripts", "check-native-host-manifest.js");
  const chromeExtensionIdConfig = path.join(chromeRoot, "scripts", "extension-id.json");
  const chromeInstallManifest = path.join(chromeRoot, "scripts", "installManifest.mjs");
  const chromeSkill = path.join(chromeRoot, "skills", "control-chrome", "SKILL.md");
  const chromeHostPath = path.join(chromeRoot, "extension-host", "linux", process.arch, "extension-host");
  const chromeHostDir = path.dirname(chromeHostPath);
  const chromeHostConstants = path.join(chromeHostDir, "constants.mjs");
  const chromeHostFrame = path.join(chromeHostDir, "frame.mjs");
  const chromeHostRegistry = path.join(chromeHostDir, "registry.mjs");
  const latexRoot = path.join(resourcesDir, "plugins", "openai-bundled", "plugins", "latex");
  const dolphinRoot = path.join(resourcesDir, "plugins", "openai-bundled", "plugins", "dolphin");
  const dolphinPluginJson = path.join(dolphinRoot, ".codex-plugin", "plugin.json");
  const dolphinMcpJson = path.join(dolphinRoot, ".mcp.json");
  const dolphinMcpServer = path.join(dolphinRoot, "scripts", "dolphin-mcp.mjs");
  const dolphinLib = path.join(dolphinRoot, "scripts", "dolphin-lib.mjs");
  const dolphinA11y = path.join(dolphinRoot, "scripts", "dolphin-a11y.py");
  const dolphinIcon = path.join(dolphinRoot, "assets", "org.kde.dolphin.png");
  const kittyRoot = path.join(resourcesDir, "plugins", "openai-bundled", "plugins", "kitty");
  const kittyPluginJson = path.join(kittyRoot, ".codex-plugin", "plugin.json");
  const kittyMcpJson = path.join(kittyRoot, ".mcp.json");
  const kittyMcpServer = path.join(kittyRoot, "scripts", "kitty-mcp.mjs");
  const kittyLib = path.join(kittyRoot, "scripts", "kitty-lib.mjs");
  const kittySkill = path.join(kittyRoot, "skills", "kitty", "SKILL.md");
  const kittyIcon = path.join(kittyRoot, "assets", "kitty.png");
  const computerUseRoot = path.join(resourcesDir, "plugins", "openai-bundled", "plugins", "computer-use");
  const computerUsePluginJson = path.join(computerUseRoot, ".codex-plugin", "plugin.json");
  const computerUseMcpJson = path.join(computerUseRoot, ".mcp.json");
  const computerUseMcpServer = path.join(computerUseRoot, "scripts", "computer-use-mcp.mjs");
  const computerUseLib = path.join(computerUseRoot, "scripts", "computer-use-lib.mjs");
  const computerUseBroker = path.join(computerUseRoot, "scripts", "computer-use-broker.py");
  const computerUseSkill = path.join(computerUseRoot, "skills", "computer-use", "SKILL.md");
  const computerUseIcon = path.join(computerUseRoot, "assets", "computer-use.png");
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const computerUseSmoke = path.join(scriptDir, "smoke-computer-use-plugin.mjs");
  const computerUseAccess = path.join(scriptDir, "install-computer-use-access.sh");
  const codexRuntimePath = path.join(resourcesDir, "codex");
  const nodeRuntimePath = path.join(resourcesDir, "node");
  const browserAutomationPath = path.join(resourcesDir, "browser_automation");

  requirePath(marketplacePath, "OpenAI bundled marketplace");
  requirePath(browserUsePluginJson, "Browser Use plugin manifest");
  requirePath(browserUseClient, "Browser Use client script");
  requirePath(browserUseSkill, "Browser Use control skill");
  requirePath(chromePluginJson, "Chrome plugin manifest");
  requirePath(chromeClient, "Chrome client script");
  requirePath(chromeRunningCheck, "Chrome running checker");
  requirePath(chromeManifestCheck, "Chrome native host manifest checker");
  requirePath(chromeExtensionIdConfig, "Chrome extension ID config");
  requirePath(chromeInstallManifest, "Chrome native host installer script");
  requirePath(chromeSkill, "Chrome control skill");
  requireExecutable(chromeHostPath);
  requirePath(chromeHostConstants, "Chrome Linux native host constants module");
  requirePath(chromeHostFrame, "Chrome Linux native host frame module");
  requirePath(chromeHostRegistry, "Chrome Linux native host registry module");
  requirePath(latexRoot, "latex bundled plugin");

  if (expectedLocalPlugins.has("dolphin")) {
    requirePath(dolphinPluginJson, "Dolphin plugin manifest");
    requirePath(dolphinMcpJson, "Dolphin MCP manifest");
    requireExecutable(dolphinMcpServer);
    requirePath(dolphinLib, "Dolphin MCP library");
    requireExecutable(dolphinA11y);
    requirePath(dolphinIcon, "Dolphin plugin icon");
  }

  if (expectedLocalPlugins.has("kitty")) {
    requirePath(kittyPluginJson, "Kitty plugin manifest");
    requirePath(kittyMcpJson, "Kitty MCP manifest");
    requireExecutable(kittyMcpServer);
    requirePath(kittyLib, "Kitty MCP library");
    requirePath(kittySkill, "Kitty skill");
    requirePath(kittyIcon, "Kitty plugin icon");
  }

  if (expectedLocalPlugins.has("kde-computer-use")) {
    requirePath(computerUsePluginJson, "Computer Use plugin manifest");
    requirePath(computerUseMcpJson, "Computer Use MCP manifest");
    requireExecutable(computerUseMcpServer);
    requirePath(computerUseLib, "Computer Use MCP library");
    requireExecutable(computerUseBroker);
    requirePath(computerUseSkill, "Computer Use skill");
    requirePath(computerUseIcon, "Computer Use plugin icon");
    requireExecutable(computerUseSmoke);
    requireExecutable(computerUseAccess);
  }

  requireExecutable(browserAutomationPath);
  requireExecutable(codexRuntimePath);
  requireExecutable(nodeRuntimePath);

  const codexRuntimeSource = readFileSync(codexRuntimePath, "utf8");
  if (!codexRuntimeSource.includes("CODEX_STANDALONE_CLI_PATH")) {
    fail(`Expected resources/codex to resolve the official standalone CLI: ${codexRuntimePath}`);
  }
  if (!codexRuntimeSource.includes("CODEX_CLI_PATH")) {
    fail(`Expected resources/codex to honor CODEX_CLI_PATH: ${codexRuntimePath}`);
  }

  const nodeRuntimeSource = readFileSync(nodeRuntimePath, "utf8");
  if (!nodeRuntimeSource.includes("CODEX_BROWSER_USE_NODE_PATH")) {
    fail(`Expected resources/node to honor CODEX_BROWSER_USE_NODE_PATH: ${nodeRuntimePath}`);
  }
  if (!nodeRuntimeSource.includes("codex-primary-runtime")) {
    fail(`Expected resources/node to resolve the primary Codex runtime Node: ${nodeRuntimePath}`);
  }

  const browserAutomationSource = readFileSync(browserAutomationPath, "utf8");
  if (!browserAutomationSource.includes("fetchViaCodexDesktop")) {
    fail(`Expected Linux browser_automation to route site-status through Codex Desktop auth fetch: ${browserAutomationPath}`);
  }
  if (!browserAutomationSource.includes("requestDesktopBrowserApproval")) {
    fail(`Expected Linux browser_automation to route Browser Use origin approval through Codex Desktop: ${browserAutomationPath}`);
  }
  if (!browserAutomationSource.includes("CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET")) {
    fail(`Expected Linux browser_automation to use CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET: ${browserAutomationPath}`);
  }
  if (!browserAutomationSource.includes("systemctl") || !browserAutomationSource.includes("show-environment")) {
    fail(`Expected Linux browser_automation to recover desktop session variables from systemd user environment: ${browserAutomationPath}`);
  }
  if (!browserAutomationSource.includes("WAYLAND_DISPLAY") || !browserAutomationSource.includes("DBUS_SESSION_BUS_ADDRESS")) {
    fail(`Expected Linux browser_automation to expose desktop session variables to browser plugins: ${browserAutomationPath}`);
  }
  if (!browserAutomationSource.includes("Linux browser approval bridge unavailable")) {
    fail(`Expected Linux browser_automation to expose a clear browser approval bridge failure: ${browserAutomationPath}`);
  }
  if (browserAutomationSource.includes("cf-mitigated")) {
    fail(`Linux browser_automation should not fake site-status results for Cloudflare challenges: ${browserAutomationPath}`);
  }
  if (browserAutomationSource.includes("elicitation/create") || browserAutomationSource.includes("debugCreateElicitationRaw")) {
    fail(`Linux browser_automation Browser Use approval should not depend on MCP client elicitation requests: ${browserAutomationPath}`);
  }
  if (browserAutomationSource.includes('isLocalOrigin(origin) ? { action: "accept" } : { action: "decline" }')) {
    fail(`Linux browser_automation should not silently decline non-local Browser Use origins: ${browserAutomationPath}`);
  }

  const browserUseClientSource = readFileSync(browserUseClient, "utf8");
  if (!browserUseClientSource.includes("globalThis.__codexNativePipe")) {
    fail(`Expected Browser Use client to support Linux native pipe bridge: ${browserUseClient}`);
  }
  if (!browserUseClientSource.includes("CODEX_BROWSER_BACKENDS_REGISTRY")) {
    fail(`Expected Browser Use client to use Linux typed backend registry: ${browserUseClient}`);
  }
  if (!browserUseClientSource.includes("Linux browser backend registry unavailable")) {
    fail(`Expected Browser Use client to fail clearly when registry is unavailable: ${browserUseClient}`);
  }
  if (!browserUseClientSource.includes('/proc/${l.ppid}/environ')) {
    fail(`Expected Browser Use client to recover Linux registry env from parent process env: ${browserUseClient}`);
  }
  if (!browserUseClientSource.includes("browser backend registry type mismatch")) {
    fail(`Expected Browser Use client to verify registry backend type against getInfo: ${browserUseClient}`);
  }
  if (browserUseClientSource.includes("OS(Zf)") || browserUseClientSource.includes("map(e=>BS.resolve(Zf,e))")) {
    fail(`Browser Use client should not enumerate legacy Linux browser socket directories: ${browserUseClient}`);
  }
  if (/privilegedNodeRepl|outside node repl/.test(browserUseClientSource)) {
    fail(`Browser Use client must not retain old node repl runtime naming: ${browserUseClient}`);
  }
  if (!/[$A-Z_a-z][$\w]*\(\)==="linux"\?"\.config\/google-chrome"/.test(browserUseClientSource)) {
    fail(`Expected Browser Use client to use Linux Chrome profile root: ${browserUseClient}`);
  }
  if (!browserUseClientSource.includes("waitForArrival:!1,x:r,y:n")) {
    fail(`Expected Browser Use client to avoid blocking on Linux mouse move arrival: ${browserUseClient}`);
  }
  if (!browserUseClientSource.includes("browser backend info request timed out")) {
    fail(`Expected Browser Use client to timeout unhealthy backend discovery sockets: ${browserUseClient}`);
  }
  if (!browserUseClientSource.includes('type:"mouseMoved",x:t.point.x,y:t.point.y,button:"none"')) {
    fail(`Expected Browser Use client to dispatch an explicit CDP mouse move before clicking: ${browserUseClient}`);
  }

  const chromeClientSource = readFileSync(chromeClient, "utf8");
  if (!chromeClientSource.includes("globalThis.__codexNativePipe")) {
    fail(`Expected Chrome client to support Linux native pipe bridge: ${chromeClient}`);
  }
  if (!chromeClientSource.includes("CODEX_BROWSER_BACKENDS_REGISTRY")) {
    fail(`Expected Chrome client to use Linux typed backend registry: ${chromeClient}`);
  }
  if (!chromeClientSource.includes("Linux browser backend registry unavailable")) {
    fail(`Expected Chrome client to fail clearly when registry is unavailable: ${chromeClient}`);
  }
  if (!chromeClientSource.includes('/proc/${l.ppid}/environ')) {
    fail(`Expected Chrome client to recover Linux registry env from parent process env: ${chromeClient}`);
  }
  if (!chromeClientSource.includes("browser backend registry type mismatch")) {
    fail(`Expected Chrome client to verify registry backend type against getInfo: ${chromeClient}`);
  }
  if (chromeClientSource.includes("OS(Zf)") || chromeClientSource.includes("map(e=>BS.resolve(Zf,e))")) {
    fail(`Chrome client should not enumerate legacy Linux browser socket directories: ${chromeClient}`);
  }
  if (/privilegedNodeRepl|outside node repl/.test(chromeClientSource)) {
    fail(`Chrome client must not retain old node repl runtime naming: ${chromeClient}`);
  }
  if (!/[$A-Z_a-z][$\w]*\(\)==="linux"\?"\.config\/google-chrome"/.test(chromeClientSource)) {
    fail(`Expected Chrome client to use Linux Chrome profile root: ${chromeClient}`);
  }
  if (!chromeClientSource.includes("waitForArrival:!1,x:r,y:n")) {
    fail(`Expected Chrome client to avoid blocking on Linux mouse move arrival: ${chromeClient}`);
  }
  if (!chromeClientSource.includes("browser backend info request timed out")) {
    fail(`Expected Chrome client to timeout unhealthy backend discovery sockets: ${chromeClient}`);
  }
  if (!chromeClientSource.includes("codexLinuxChromeBackendAllowlist")) {
    fail(`Expected Chrome client to keep the Chrome backend available when the shared browser_automation MCP env is iab-only: ${chromeClient}`);
  }
  if (!chromeClientSource.includes('type:"mouseMoved",x:t.point.x,y:t.point.y,button:"none"')) {
    fail(`Expected Chrome client to dispatch an explicit CDP mouse move before clicking: ${chromeClient}`);
  }

  const browserUseSkillSource = readFileSync(browserUseSkill, "utf8");
  const browserUseManifest = JSON.parse(readFileSync(browserUsePluginJson, "utf8"));
  if (browserUseManifest.keywords?.includes("node-repl")) {
    fail(`Browser Use plugin manifest must not advertise the old node-repl keyword: ${browserUsePluginJson}`);
  }
  if (!browserUseManifest.keywords?.includes("browser-automation")) {
    fail(`Browser Use plugin manifest should advertise browser-automation keyword: ${browserUsePluginJson}`);
  }
  if (
    !browserUseSkillSource.includes("mcp__browser_automation__js") ||
    !browserUseSkillSource.includes("browserAutomation.write")
  ) {
    fail(`Expected Browser Use skill to use browser_automation tool naming throughout: ${browserUseSkill}`);
  }
  if (/node_repl|Node REPL|mcp__node_repl|nodeRepl|REPL/.test(browserUseSkillSource)) {
    fail(`Browser Use skill must not mention the old node_repl or REPL tool surface: ${browserUseSkill}`);
  }

  const chromeRunningCheckSource = readFileSync(chromeRunningCheck, "utf8");
  if (!chromeRunningCheckSource.includes("isLinuxExtensionCapableChromeCommand")) {
    fail(`Expected Chrome running checker to filter Linux Chrome processes that cannot load extensions: ${chromeRunningCheck}`);
  }
  if (!chromeRunningCheckSource.includes('"-ww"')) {
    fail(`Expected Chrome running checker to inspect full Linux Chrome command lines: ${chromeRunningCheck}`);
  }

  const chromeSkillSource = readFileSync(chromeSkill, "utf8");
  if (!chromeSkillSource.includes("## Visible Tool Surface")) {
    fail(`Expected Chrome skill to explain the browser_automation browser-client tool surface: ${chromeSkill}`);
  }
  if (!chromeSkillSource.includes("Do not conclude that Chrome DOM/DevTools automation is unavailable")) {
    fail(`Expected Chrome skill to prevent fallback when Chrome-specific tools are not directly visible: ${chromeSkill}`);
  }
  if (!chromeSkillSource.includes("browser.tabs.new()") || !chromeSkillSource.includes("tab.playwright.locator")) {
    fail(`Expected Chrome skill to document the current Chrome browser API shape: ${chromeSkill}`);
  }
  if (!chromeSkillSource.includes("mcp__browser_automation__js") || !chromeSkillSource.includes("browserAutomation.write")) {
    fail(`Expected Chrome skill to use browser_automation tool naming throughout: ${chromeSkill}`);
  }
  if (/node_repl|Node REPL|mcp__node_repl|nodeRepl|REPL/.test(chromeSkillSource)) {
    fail(`Chrome skill must not mention the old node_repl or REPL tool surface: ${chromeSkill}`);
  }

  const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
  const pluginNames = new Set(marketplace.plugins?.map((plugin) => plugin.name));

  for (const pluginName of ["browser", "chrome", "latex", ...expectedLocalPlugins]) {
    if (!pluginNames.has(pluginName)) {
      fail(`Expected bundled marketplace to include ${pluginName}: ${marketplacePath}`);
    }
  }

  for (const localPluginName of ["dolphin", "kitty", "kde-computer-use", "computer-use"]) {
    if (!expectedLocalPlugins.has(localPluginName) && pluginNames.has(localPluginName)) {
      fail(`Optional plugin should not be bundled unless explicitly requested: ${localPluginName}`);
    }
  }

  if (expectedLocalPlugins.has("dolphin")) {
    const dolphinMarketplaceEntry = marketplace.plugins.find((plugin) => plugin.name === "dolphin");
    if (dolphinMarketplaceEntry?.source?.path !== "./plugins/dolphin") {
      fail(`Expected Dolphin marketplace source to point at ./plugins/dolphin: ${marketplacePath}`);
    }
    if (dolphinMarketplaceEntry?.policy?.installation !== "AVAILABLE") {
      fail(`Expected Dolphin marketplace installation policy to be AVAILABLE: ${marketplacePath}`);
    }

    const dolphinManifest = JSON.parse(readFileSync(dolphinPluginJson, "utf8"));
    if (dolphinManifest?.mcpServers !== "./.mcp.json") {
      fail(`Expected Dolphin plugin manifest to declare .mcp.json: ${dolphinPluginJson}`);
    }
    if (dolphinManifest?.interface?.composerIcon !== "./assets/org.kde.dolphin.png") {
      fail(`Expected Dolphin plugin to use the packaged Dolphin icon: ${dolphinPluginJson}`);
    }

    const dolphinMcp = JSON.parse(readFileSync(dolphinMcpJson, "utf8"));
    if (dolphinMcp?.mcp_servers) {
      fail(`Expected Dolphin MCP manifest to use the documented direct server-map shape: ${dolphinMcpJson}`);
    }
    if (dolphinMcp?.mcpServers) {
      fail(`Expected Dolphin MCP manifest not to use legacy mcpServers wrapping: ${dolphinMcpJson}`);
    }
    if (dolphinMcp?.dolphin?.args?.[0] !== "./scripts/dolphin-mcp.mjs") {
      fail(`Expected Dolphin MCP manifest to launch scripts/dolphin-mcp.mjs: ${dolphinMcpJson}`);
    }
    if (dolphinMcp?.dolphin?.cwd !== ".") {
      fail(`Expected Dolphin MCP manifest to declare plugin-root cwd: ${dolphinMcpJson}`);
    }
  }

  if (expectedLocalPlugins.has("kitty")) {
    const kittyMarketplaceEntry = marketplace.plugins.find((plugin) => plugin.name === "kitty");
    if (kittyMarketplaceEntry?.source?.path !== "./plugins/kitty") {
      fail(`Expected Kitty marketplace source to point at ./plugins/kitty: ${marketplacePath}`);
    }
    if (kittyMarketplaceEntry?.policy?.installation !== "AVAILABLE") {
      fail(`Expected Kitty marketplace installation policy to be AVAILABLE: ${marketplacePath}`);
    }

    const kittyManifest = JSON.parse(readFileSync(kittyPluginJson, "utf8"));
    if (kittyManifest?.mcpServers !== "./.mcp.json") {
      fail(`Expected Kitty plugin manifest to declare .mcp.json: ${kittyPluginJson}`);
    }
    if (kittyManifest?.interface?.composerIcon !== "./assets/kitty.png") {
      fail(`Expected Kitty plugin to use the packaged Kitty icon: ${kittyPluginJson}`);
    }

    const kittyMcp = JSON.parse(readFileSync(kittyMcpJson, "utf8"));
    if (kittyMcp?.mcp_servers) {
      fail(`Expected Kitty MCP manifest to use the documented direct server-map shape: ${kittyMcpJson}`);
    }
    if (kittyMcp?.mcpServers) {
      fail(`Expected Kitty MCP manifest not to use legacy mcpServers wrapping: ${kittyMcpJson}`);
    }
    if (kittyMcp?.kitty?.args?.[0] !== "./scripts/kitty-mcp.mjs") {
      fail(`Expected Kitty MCP manifest to launch scripts/kitty-mcp.mjs: ${kittyMcpJson}`);
    }
    if (kittyMcp?.kitty?.cwd !== ".") {
      fail(`Expected Kitty MCP manifest to declare plugin-root cwd: ${kittyMcpJson}`);
    }
  }

  if (expectedLocalPlugins.has("kde-computer-use")) {
    const computerUseMarketplaceEntry = marketplace.plugins.find((plugin) => plugin.name === "kde-computer-use");
    if (computerUseMarketplaceEntry?.source?.path !== "./plugins/computer-use") {
      fail(`Expected Computer Use marketplace source to point at ./plugins/computer-use: ${marketplacePath}`);
    }
    if (computerUseMarketplaceEntry?.policy?.installation !== "AVAILABLE") {
      fail(`Expected Computer Use marketplace installation policy to be AVAILABLE: ${marketplacePath}`);
    }

    const computerUseManifest = JSON.parse(readFileSync(computerUsePluginJson, "utf8"));
    if (computerUseManifest?.name !== "kde-computer-use") {
      fail(`Expected Computer Use plugin identity to avoid the upstream computer-use reserved name: ${computerUsePluginJson}`);
    }
    if (computerUseManifest?.mcpServers !== "./.mcp.json") {
      fail(`Expected Computer Use plugin manifest to declare .mcp.json: ${computerUsePluginJson}`);
    }
    if (computerUseManifest?.interface?.composerIcon !== "./assets/computer-use.png") {
      fail(`Expected Computer Use plugin to use the packaged icon: ${computerUsePluginJson}`);
    }
    if (!/KDE Wayland/.test(computerUseManifest?.description ?? "")) {
      fail(`Expected Computer Use plugin to describe KDE Wayland scope: ${computerUsePluginJson}`);
    }

    const computerUseMcp = JSON.parse(readFileSync(computerUseMcpJson, "utf8"));
    if (computerUseMcp?.mcp_servers) {
      fail(`Expected Computer Use MCP manifest to use the documented direct server-map shape: ${computerUseMcpJson}`);
    }
    if (computerUseMcp?.mcpServers) {
      fail(`Expected Computer Use MCP manifest not to use legacy mcpServers wrapping: ${computerUseMcpJson}`);
    }
    if (computerUseMcp?.["computer-use"]?.args?.[0] !== "./scripts/computer-use-mcp.mjs") {
      fail(`Expected Computer Use MCP manifest to launch scripts/computer-use-mcp.mjs: ${computerUseMcpJson}`);
    }
    if (computerUseMcp?.["computer-use"]?.cwd !== ".") {
      fail(`Expected Computer Use MCP manifest to declare plugin-root cwd: ${computerUseMcpJson}`);
    }

    const brokerSource = readFileSync(computerUseBroker, "utf8");
    for (const marker of [
      "org.freedesktop.portal.RemoteDesktop",
      "org.freedesktop.portal.ScreenCast",
      "org.freedesktop.host.portal.Registry",
      "org.kde.kwin.Scripting",
      "org.kde.KWin.ScreenShot2",
      "org.kde.StatusNotifierWatcher",
      "org.kde.StatusNotifierItem",
      "CODEX_COMPUTER_USE_PORTAL_APP_ID",
      "list_desktops",
      "computer_list_tray_items",
      "computer_activate_tray_item",
      "computer_release_desktops",
      "captureDesktopSnapshot",
      "restoreDesktopSnapshot",
      "ensure_portal_input",
      "NotifyPointerMotionAbsolute",
      "NotifyKeyboardKeycode",
      "NotifyKeyboardKeysym",
      "pipewiresrc",
    ]) {
      if (!brokerSource.includes(marker)) {
        fail(`Expected Computer Use broker marker ${marker}: ${computerUseBroker}`);
      }
    }
    if (/ydotool|uinput/i.test(brokerSource)) {
      fail(`Computer Use broker must not expose direct input helper paths: ${computerUseBroker}`);
    }
  }

  verifyChromeNativeHostManifestCheck(chromeRoot, chromeManifestCheck, chromeExtensionIdConfig, chromeInstallManifest, chromeHostPath);

  const appleMetadataFiles = [];
  const collectAppleMetadataFiles = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.name.includes(":com.apple.")) {
        appleMetadataFiles.push(entryPath);
      }

      if (entry.isDirectory()) {
        collectAppleMetadataFiles(entryPath);
      }
    }
  };

  collectAppleMetadataFiles(path.join(resourcesDir, "plugins", "openai-bundled"));

  if (appleMetadataFiles.length > 0) {
    fail(`Bundled plugin resources contain macOS metadata files: ${appleMetadataFiles.slice(0, 5).join(", ")}`);
  }
}

function verifyChromeNativeHostManifestCheck(chromeRoot, checkerPath, extensionIdConfigPath, installManifestPath, chromeHostPath) {
  const extensionId = JSON.parse(readFileSync(extensionIdConfigPath, "utf8"))?.extensionId;
  if (typeof extensionId !== "string" || extensionId.length === 0) {
    fail(`Expected Chrome extension ID config to contain extensionId: ${extensionIdConfigPath}`);
  }

  const chromeHostSource = readFileSync(chromeHostPath, "utf8");
  for (const marker of [
    "pendingByHostId",
    "rewriteRequestForChrome",
    "rewriteResponseForClient",
    "originalId",
    "CHROME_NATIVE_HOST_REQUEST_TIMEOUT_MS",
    "Chrome native host request timed out",
    'method === "ping"',
    'result: "pong"',
    "registerBrowserBackend",
    "pruneBrowserBackendRegistry",
    'type: "extension"',
    'owner: "chrome-native-host"',
  ]) {
    if (!chromeHostSource.includes(marker)) {
      fail(`Expected Chrome Linux native host marker ${marker}: ${chromeHostPath}`);
    }
  }

  const chromeHostRegistrySource = readFileSync(path.join(path.dirname(chromeHostPath), "registry.mjs"), "utf8");
  for (const marker of [
    "normalizeRegistryEntry",
    "writeBrowserBackendRegistry",
    "pruneBrowserBackendRegistry",
    "registerBrowserBackend",
    "pidIsAlive",
  ]) {
    if (!chromeHostRegistrySource.includes(marker)) {
      fail(`Expected Chrome Linux native host registry marker ${marker}: ${chromeHostPath}`);
    }
  }

  const installManifestSource = readFileSync(installManifestPath, "utf8");
  const hostName = installManifestSource.match(/extensionHostName:"([^"]+)"/)?.[1];
  if (typeof hostName !== "string" || hostName.length === 0) {
    fail(`Expected Chrome installManifest to contain extensionHostName: ${installManifestPath}`);
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-chrome-host-verify-"));
  try {
    const manifestPath = path.join(tempDir, `${hostName}.json`);
    writeFileSync(
      manifestPath,
      JSON.stringify({
        name: hostName,
        description: "Codex chrome native messaging host",
        type: "stdio",
        path: chromeHostPath,
        allowed_origins: [`chrome-extension://${extensionId}/`],
      }),
    );

    runOrThrowWithEnv("node", [checkerPath, "--json"], chromeRoot, {
      CODEX_CHROME_NATIVE_HOST_MANIFEST_PATH: manifestPath,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function main() {
  const installDirArg = process.argv[2];

  if (!installDirArg || process.argv.length !== 3) {
    console.error(usage());
    process.exit(1);
  }

  const installDir = realpathSync(installDirArg);
  const startScriptPath = path.join(installDir, "start.sh");
  const codexBinPath = path.join(installDir, "Codex");
  const electronPath = path.join(installDir, "electron");
  const iconPath = path.join(installDir, "icon.png");
  const versionPath = path.join(installDir, "version");
  const resourcesDir = path.join(installDir, "resources");
  const appAsarPath = path.join(resourcesDir, "app.asar");

  requirePath(installDir, "directory");
  requireExecutable(startScriptPath);
  requireExecutable(codexBinPath);
  verifyAppIcon(iconPath);
  requirePath(versionPath, "file");
  requirePath(appAsarPath, "file");

  verifyStartScript(startScriptPath);
  verifyElectronSymlink(electronPath);
  verifyBundledPlugins(resourcesDir);
  verifyPatchState(resourcesDir, appAsarPath);
  verifyBundle(resourcesDir, appAsarPath);
  verifyChromeExtensionStatusInBundle(resourcesDir, appAsarPath);

  const electronVersion = readFileSync(versionPath, "utf8").trim();
  if (electronVersion !== "42.1.0") {
    fail(`Expected Electron 42.1.0 runtime, got: ${electronVersion || "<empty>"}`);
  }

  console.error(`[INFO] Verified staged install: ${installDir}`);
}

main();
