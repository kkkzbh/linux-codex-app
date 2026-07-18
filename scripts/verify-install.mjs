#!/usr/bin/env node

import {
  cpSync,
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
  BUNDLED_SKILLS_MANIFEST_FILENAME,
  readBundledSkillsManifest,
  verifyBundledSkillsTree,
} from "./bundled-skills-integrity.mjs";
import {
  LINUX_PATCH_STATE_FILENAME,
  getAppAsarSignature,
  isLinuxPatchStateCurrent,
  loadLinuxPatchState,
} from "./linux-runtime/state.mjs";

const EXPECTED_APP_ICON_SHA256 = "1c926e380bfe6a50f40648dd9bc5de88da7271546491adf99ec72172e17df6a0";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MINIFIED_IDENTIFIER = String.raw`[$A-Z_a-z][$\w]*`;
const CURRENT_DIRECT_CLICK_MOUSE_MOVE_REGEX = new RegExp(
  String.raw`async clickPoint\((?<event>${MINIFIED_IDENTIFIER})\)\{[\s\S]*?await this\.ui\.moveMouse\([^)]*\),await this\.dispatchCdpMouseMove\(\{modifiers:\k<event>\.modifiers,point:${MINIFIED_IDENTIFIER},target:${MINIFIED_IDENTIFIER}\}\);[\s\S]*?async dispatchCdpMouseMove\((?<moveEvent>${MINIFIED_IDENTIFIER})\)\{await this\.cdp\.callTarget\(\k<moveEvent>\.target,"Input\.dispatchMouseEvent",\{type:"mouseMoved",x:\k<moveEvent>\.point\.x,y:\k<moveEvent>\.point\.y,button:"none"`,
);

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

function hasCurrentDirectClickMouseMove(clientSource) {
  return CURRENT_DIRECT_CLICK_MOUSE_MOVE_REGEX.test(clientSource);
}

function findAppleMetadataFiles(rootDir) {
  const metadataFiles = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.name.includes(":com.apple.")) {
        metadataFiles.push(entryPath);
      }

      if (entry.isDirectory()) {
        visit(entryPath);
      }
    }
  };

  visit(rootDir);
  return metadataFiles;
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

function readBundledPluginAudit(auditPath) {
  requirePath(auditPath, "bundled plugin audit manifest");
  const audit = JSON.parse(readFileSync(auditPath, "utf8"));
  if (audit?.manifestVersion !== 1 || !Array.isArray(audit.plugins) || audit.plugins.length === 0) {
    fail(`Invalid bundled plugin audit manifest: ${auditPath}`);
  }

  const names = new Set();
  for (const plugin of audit.plugins) {
    if (
      plugin == null ||
      typeof plugin !== "object" ||
      typeof plugin.name !== "string" ||
      typeof plugin.version !== "string" ||
      !["included", "blacklisted"].includes(plugin.state)
    ) {
      fail(`Invalid bundled plugin audit entry: ${auditPath}`);
    }
    if (names.has(plugin.name)) fail(`Duplicate bundled plugin audit entry: ${plugin.name}`);
    names.add(plugin.name);
    if (plugin.state === "blacklisted" && (typeof plugin.reason !== "string" || plugin.reason.trim().length === 0)) {
      fail(`Blacklisted bundled plugin requires a reason: ${plugin.name}`);
    }
    if (plugin.state === "included" && plugin.reason != null) {
      fail(`Included bundled plugin must not carry a blacklist reason: ${plugin.name}`);
    }
  }
  return audit;
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
  const tempDir = mkdtempSync(path.join(resourcesDir, ".codex-linux-verify-"));

  try {
    runOrThrow("npx", ["--yes", "asar", "extract", appAsarPath, path.join(tempDir, "app")], resourcesDir);
    const context = createLinuxPatchContext(path.join(tempDir, "app"));
    const bundleSources = context.readBundleSources();
    verifyLinuxPatchSource(bundleSources, context);
    verifyBrowserFeatureSurface(context);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function verifyBrowserFeatureSurface(context) {
  const browserSettingsSource = readFileSync(context.webviewComputerUseProviderSettingsPath, "utf8");
  ensureMarkersPresent(
    browserSettingsSource,
    [
      "settings.browserUse.developerMode.title",
      "defaultMessage:`Developer mode`",
      "settings.browserUse.fullCdp.label",
      "defaultMessage:`Enable full CDP access`",
    ],
    "built-in Browser Developer Mode surface",
  );

  const webviewAssetsDir = path.dirname(context.webviewComputerUseProviderSettingsPath);
  const profileImportPath = readdirSync(webviewAssetsDir)
    .filter((entry) => /^browser-profile-import-dialog-[^.]+\.js$/.test(entry))
    .map((entry) => path.join(webviewAssetsDir, entry))
    .find((entryPath) => {
      const source = readFileSync(entryPath, "utf8");
      return [
        "settings.browserUse.profileImport.title",
        "settings.browserUse.profileImport.cookies",
        "defaultMessage:`Import from your browser`",
        "defaultMessage:`Cookies`",
        "No Chrome, Atlas, or 1Password profiles were found on this device",
        "case`onepassword`",
      ].every((marker) => source.includes(marker));
    });

  if (profileImportPath == null) {
    fail(`Expected built-in Browser Chrome and 1Password import surface in: ${webviewAssetsDir}`);
  }
}

function verifyBrowserProfileImportRuntime(resourcesDir) {
  const importerPath = path.join(resourcesDir, "codex-linux-browser-profile-import.cjs");
  const onePasswordProviderPath = path.join(
    resourcesDir,
    "codex-linux-onepassword-browser-provider.cjs",
  );
  requirePath(importerPath, "Linux Browser profile importer");
  requirePath(onePasswordProviderPath, "Linux 1Password Browser provider");
  runOrThrow(process.execPath, ["--check", importerPath], resourcesDir);
  runOrThrow(process.execPath, ["--check", onePasswordProviderPath], resourcesDir);
  const importerSource = readFileSync(importerPath, "utf8");
  ensureMarkersPresent(
    importerSource,
    [
      "createLinuxBrowserProfileImporter",
      "listChromeProfiles",
      "Storage.getCookies",
      "snapshotCookieDatabase",
      "new DatabaseSync(source, { readOnly: true })",
      "await stopChromeProcess(child)",
      'if (domain.startsWith(".")) details.domain = domain',
      'if (!host || !name) return null',
      "IMPORTED_SESSION_COOKIE_RETENTION_SECONDS",
      "Math.floor(nowSeconds) + IMPORTED_SESSION_COOKIE_RETENTION_SECONDS",
      "electron.session.fromPartition(targetPartition).cookies",
      "Linux browser import supports cookies only",
      "codex-linux-onepassword-browser-provider.cjs",
      'request.source === "onepassword"',
    ],
    "Linux Browser profile importer runtime",
  );
  ensureMarkersAbsent(
    importerSource,
    ["assertChromeIsClosed", "Close Chrome completely before importing cookies"],
    "obsolete Linux Browser profile importer runtime",
  );
  ensureMarkersPresent(
    readFileSync(onePasswordProviderPath, "utf8"),
    [
      "createOnePasswordBrowserProvider",
      "OP_BIOMETRIC_UNLOCK_ENABLED",
      "onepassword-browser-bindings.json",
      "codexOnePasswordWaitForLoginForm",
      "codexOnePasswordFillLoginForm",
      'partition === BUILT_IN_BROWSER_PARTITION',
      "this.credentialPromises",
    ],
    "Linux 1Password Browser provider runtime",
  );
}

function verifyChromeExtensionIntegrationInBundle(resourcesDir, appAsarPath) {
  const tempDir = mkdtempSync(path.join(resourcesDir, ".codex-chrome-status-verify-"));

  try {
    runOrThrow("npx", ["--yes", "asar", "extract", appAsarPath, path.join(tempDir, "app")], resourcesDir);
    const context = createLinuxPatchContext(path.join(tempDir, "app"));
    const source = context.readMainSource();

    if (!/"chrome-extension-installed-read":async\(\{extensionId:e\}\)=>\(\{installed:[$A-Z_a-z][$\w]*\(\{extensionId:e\}\)\}\)/.test(source)) {
      fail("Expected Electron main bundle to expose chrome-extension-installed-read");
    }

    ensureMarkersPresent(
      source,
      [
        "if(i===`linux`){let r=n.In({chromeConfigHome:e,homeDir:t,xdgConfigHome:a});return n.Fn.map(e=>(0,d.join)(r,e.userDataDirName))}",
        "if(t===`win32`||t===`linux`){let i=(n??(t===`linux`?()=>nc(e):tc))()",
        "Google Chrome or Chromium is not installed",
        "Opening Chrome extension settings is only supported on macOS, Windows, and Linux",
      ],
      "upstream Linux Chrome extension integration",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function verifyBundledPlugins(resourcesDir) {
  const expectedLocalPlugins = new Set(expectedLocalPluginNames());
  const bundledRoot = path.join(resourcesDir, "plugins", "openai-bundled");
  const marketplacePath = path.join(bundledRoot, ".agents", "plugins", "marketplace.json");
  const auditPath = path.join(bundledRoot, ".linux-bundled-plugin-audit.json");
  const bundledPluginsRoot = path.join(bundledRoot, "plugins");
  const browserUseRoot = path.join(bundledPluginsRoot, "browser");
  const browserUsePluginJson = path.join(browserUseRoot, ".codex-plugin", "plugin.json");
  const browserUseClient = path.join(browserUseRoot, "scripts", "browser-client.mjs");
  const browserUseSkill = path.join(browserUseRoot, "skills", "control-in-app-browser", "SKILL.md");
  const chromeRoot = path.join(bundledPluginsRoot, "chrome");
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
  const latexRoot = path.join(bundledPluginsRoot, "latex");
  const dolphinRoot = path.join(bundledPluginsRoot, "dolphin");
  const dolphinPluginJson = path.join(dolphinRoot, ".codex-plugin", "plugin.json");
  const dolphinMcpJson = path.join(dolphinRoot, ".mcp.json");
  const dolphinMcpServer = path.join(dolphinRoot, "scripts", "dolphin-mcp.mjs");
  const dolphinLib = path.join(dolphinRoot, "scripts", "dolphin-lib.mjs");
  const dolphinA11y = path.join(dolphinRoot, "scripts", "dolphin-a11y.py");
  const dolphinIcon = path.join(dolphinRoot, "assets", "org.kde.dolphin.png");
  const kittyRoot = path.join(bundledPluginsRoot, "kitty");
  const kittyPluginJson = path.join(kittyRoot, ".codex-plugin", "plugin.json");
  const kittyMcpJson = path.join(kittyRoot, ".mcp.json");
  const kittyMcpServer = path.join(kittyRoot, "scripts", "kitty-mcp.mjs");
  const kittyLib = path.join(kittyRoot, "scripts", "kitty-lib.mjs");
  const kittySkill = path.join(kittyRoot, "skills", "kitty", "SKILL.md");
  const kittyIcon = path.join(kittyRoot, "assets", "kitty.png");
  const computerUseRoot = path.join(bundledPluginsRoot, "computer-use");
  const computerUsePluginJson = path.join(computerUseRoot, ".codex-plugin", "plugin.json");
  const computerUseMcpJson = path.join(computerUseRoot, ".mcp.json");
  const computerUseMcpServer = path.join(computerUseRoot, "scripts", "computer-use-mcp.mjs");
  const computerUseLib = path.join(computerUseRoot, "scripts", "computer-use-lib.mjs");
  const computerUseState = path.join(computerUseRoot, "scripts", "computer-use-state.mjs");
  const computerUseBroker = path.join(computerUseRoot, "scripts", "computer-use-broker.py");
  const computerUseIsolatedSession = path.join(computerUseRoot, "scripts", "computer-use-isolated-session.py");
  const computerUseXwaylandEnvironment = path.join(computerUseRoot, "scripts", "computer-use-xwayland-environment.py");
  const computerUseNativeHelper = path.join(computerUseRoot, "native", "codex-computer-use-screenshot.cpp");
  const computerUseEisHelper = path.join(computerUseRoot, "native", "codex-computer-use-eis.cpp");
  const computerUseGlowHelper = path.join(computerUseRoot, "native", "codex-computer-use-glow.cpp");
  const computerUseNativeCmake = path.join(computerUseRoot, "native", "CMakeLists.txt");
  const computerUseSkill = path.join(computerUseRoot, "skills", "computer-use", "SKILL.md");
  const computerUseArchitecture = path.join(computerUseRoot, "docs", "v2-architecture.md");
  const computerUseIcon = path.join(computerUseRoot, "assets", "computer-use.png");
  const computerUseSmoke = path.join(SCRIPT_DIR, "smoke-computer-use-plugin.mjs");
  const computerUseAccess = path.join(SCRIPT_DIR, "install-computer-use-access.sh");
  const codexRuntimePath = path.join(resourcesDir, "codex");
  const nodeRuntimePath = path.join(resourcesDir, "node");
  const browserAutomationPath = path.join(resourcesDir, "browser_automation");
  const cuaNodeRuntimePath = path.join(resourcesDir, "cua_node", "bin", "node");
  const cuaBrowserAutomationPath = path.join(resourcesDir, "cua_node", "bin", "browser_automation");
  const dolphinFileManagerPath = path.join(resourcesDir, "codex-dolphin-file-manager");
  const browserProfileImportPath = path.join(
    resourcesDir,
    "codex-linux-browser-profile-import.cjs",
  );
  const onePasswordBrowserProviderPath = path.join(
    resourcesDir,
    "codex-linux-onepassword-browser-provider.cjs",
  );

  requirePath(marketplacePath, "OpenAI bundled marketplace");
  requirePath(auditPath, "OpenAI bundled plugin audit manifest");
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
  requirePath(browserProfileImportPath, "Linux browser profile importer");
  requirePath(onePasswordBrowserProviderPath, "Linux 1Password browser provider");
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
    requirePath(computerUseState, "Computer Use v2 state layer");
    requireExecutable(computerUseBroker);
    requireExecutable(computerUseIsolatedSession);
    requirePath(computerUseNativeHelper, "Computer Use native screenshot helper source");
    requirePath(computerUseEisHelper, "Computer Use native EIS helper source");
    requirePath(computerUseGlowHelper, "Computer Use cursor glow theme generator source");
    requirePath(computerUseNativeCmake, "Computer Use native helper CMake build definition");
    requirePath(computerUseSkill, "Computer Use skill");
    requirePath(computerUseArchitecture, "Computer Use v2 architecture contract");
    requirePath(computerUseIcon, "Computer Use plugin icon");
    requireExecutable(computerUseSmoke);
    requireExecutable(computerUseAccess);
  }

  requireExecutable(browserAutomationPath);
  requireExecutable(cuaNodeRuntimePath);
  requireExecutable(cuaBrowserAutomationPath);
  requireExecutable(dolphinFileManagerPath);
  requireExecutable(codexRuntimePath);
  requireExecutable(nodeRuntimePath);

  const codexRuntimeSource = readFileSync(codexRuntimePath, "utf8");
  if (!codexRuntimeSource.includes("packages/standalone/current/codex")) {
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

  const cuaNodeRuntimeSource = readFileSync(cuaNodeRuntimePath, "utf8");
  if (cuaNodeRuntimeSource !== nodeRuntimeSource) {
    fail(`Expected resources/cua_node/bin/node to mirror resources/node: ${cuaNodeRuntimePath}`);
  }

  const browserAutomationSource = readFileSync(browserAutomationPath, "utf8");
  const cuaBrowserAutomationSource = readFileSync(cuaBrowserAutomationPath, "utf8");
  if (cuaBrowserAutomationSource !== browserAutomationSource) {
    fail(`Expected resources/cua_node/bin/browser_automation to mirror resources/browser_automation: ${cuaBrowserAutomationPath}`);
  }
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
  if (
    !browserAutomationSource.includes("registerActiveExec") ||
    !browserAutomationSource.includes("browser_automation\", \"active_execs") ||
    !browserAutomationSource.includes("FatalExecutionError")
  ) {
    fail(`Linux browser_automation must register active execs and terminate timed-out JS cleanly: ${browserAutomationPath}`);
  }

  const dolphinFileManagerSource = readFileSync(dolphinFileManagerPath, "utf8");
  for (const forbiddenFragment of [
    "org.freedesktop.FileManager1",
    "ShowFolders",
    "ShowItems",
    "gdbus",
    "CODEX_DOLPHIN_GDBUS_BIN",
  ]) {
    if (dolphinFileManagerSource.includes(forbiddenFragment)) {
      fail(`Dolphin file-manager helper must not use generic D-Bus opens: ${dolphinFileManagerPath}`);
    }
  }
  if (
    !dolphinFileManagerSource.includes("single-process/multi-window Dolphin setup") ||
    !dolphinFileManagerSource.includes("CODEX_DOLPHIN_BIN") ||
    !dolphinFileManagerSource.includes("XDG_BIN_HOME") ||
    !dolphinFileManagerSource.includes("Codex Dolphin window access wrapper") ||
    !dolphinFileManagerSource.includes("Codex Dolphin wrapper is not installed") ||
    !dolphinFileManagerSource.includes("Dolphin wrapper is not owned by Codex") ||
    !dolphinFileManagerSource.includes('"--select"')
  ) {
    fail(`Expected Dolphin file-manager helper to document and use the Dolphin CLI path: ${dolphinFileManagerPath}`);
  }
  if (dolphinFileManagerSource.includes("--new-window")) {
    fail(`Dolphin file-manager helper must leave window creation policy to Dolphin: ${dolphinFileManagerPath}`);
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
  if (!browserUseClientSource.includes('protocol==="file:"')) {
    fail(`Expected Browser Use client to allow file:// URLs through its Linux URL policy: ${browserUseClient}`);
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
  if (!hasCurrentDirectClickMouseMove(browserUseClientSource)) {
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
  if (!hasCurrentDirectClickMouseMove(chromeClientSource)) {
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

  const chromeInstallManifestSource = readFileSync(chromeInstallManifest, "utf8");
  if (
    !chromeInstallManifestSource.includes("t.appServerRuntimePaths") ||
    !chromeInstallManifestSource.includes("Missing staged Chrome extension host")
  ) {
    fail(`Expected Chrome native host installer to resolve the staged Linux plugin root from runtime paths: ${chromeInstallManifest}`);
  }

  const chromeManifestCheckSource = readFileSync(chromeManifestCheck, "utf8");
  if (
    !chromeManifestCheckSource.includes("getExpectedLinuxHostConfig(manifest") ||
    !chromeManifestCheckSource.includes("hostConfigMatchesExpected") ||
    !chromeManifestCheckSource.includes("staged Chrome extension host")
  ) {
    fail(`Expected Chrome native host checker to reject stale cache manifests and runtime configs: ${chromeManifestCheck}`);
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
  const audit = readBundledPluginAudit(auditPath);
  const includedUpstreamPlugins = audit.plugins.filter((plugin) => plugin.state === "included");
  const blacklistedUpstreamPlugins = audit.plugins.filter((plugin) => plugin.state === "blacklisted");

  for (const pluginName of [...includedUpstreamPlugins.map((plugin) => plugin.name), ...expectedLocalPlugins]) {
    if (!pluginNames.has(pluginName)) {
      fail(`Expected bundled marketplace to include ${pluginName}: ${marketplacePath}`);
    }
  }

  const expectedMarketplacePluginNames = new Set([
    ...includedUpstreamPlugins.map((plugin) => plugin.name),
    ...expectedLocalPlugins,
  ]);
  for (const pluginName of pluginNames) {
    if (!expectedMarketplacePluginNames.has(pluginName)) {
      fail(`Bundled marketplace contains a plugin absent from its audit/local policy: ${pluginName}`);
    }
  }

  for (const plugin of includedUpstreamPlugins) {
    const pluginRoot = path.join(bundledPluginsRoot, plugin.name);
    const pluginManifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
    requirePath(pluginManifestPath, `included upstream plugin manifest for ${plugin.name}`);
    const pluginManifest = JSON.parse(readFileSync(pluginManifestPath, "utf8"));
    if (pluginManifest.name !== plugin.name || pluginManifest.version !== plugin.version) {
      fail(`Included upstream plugin manifest does not match its audit entry: ${plugin.name}`);
    }
  }

  for (const plugin of blacklistedUpstreamPlugins) {
    if (pluginNames.has(plugin.name)) {
      fail(`Blacklisted upstream plugin remains in the staged marketplace: ${plugin.name}`);
    }
    const pluginManifestPath = path.join(bundledPluginsRoot, plugin.name, ".codex-plugin", "plugin.json");
    if (existsSync(pluginManifestPath)) {
      const pluginManifest = JSON.parse(readFileSync(pluginManifestPath, "utf8"));
      if (pluginManifest.name === plugin.name) {
        fail(`Blacklisted upstream plugin payload remains staged: ${plugin.name}`);
      }
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
    if (computerUseMcp?.["kwin-mcp"] !== undefined || Object.keys(computerUseMcp).length !== 1) {
      fail(`Expected Computer Use MCP manifest to contain only the maintained computer-use server: ${computerUseMcpJson}`);
    }
    const computerUseMcpServerSource = readFileSync(computerUseMcpServer, "utf8");
    for (const marker of ['version: "2.1.1"', "isolated Computer Use is the default", "foreground_reason"]) {
      if (!computerUseMcpServerSource.includes(marker)) {
        fail(`Expected isolated-default Computer Use MCP marker ${marker}: ${computerUseMcpServer}`);
      }
    }

    const brokerSource = readFileSync(computerUseBroker, "utf8");
    for (const marker of [
      "org.freedesktop.portal.RemoteDesktop",
      "org.freedesktop.portal.ScreenCast",
      "org.freedesktop.host.portal.Registry",
      "org.kde.kwin.Scripting",
      "org.kde.StatusNotifierWatcher",
      "org.kde.StatusNotifierItem",
      "CODEX_COMPUTER_USE_SCREENSHOT_HELPER",
      "codex-computer-use-screenshot",
      "CODEX_COMPUTER_USE_CURSOR_GLOW_THEME_PATH",
      "Codex-Computer-Use-Glow",
      "plasma-apply-cursortheme",
      "outward-edge-diffusion",
      "minimum_jerk",
      "CODEX_COMPUTER_USE_PORTAL_APP_ID",
      "COMPUTER_USE_PROTOCOL_VERSION = 2",
      "find_roots",
      "observe_root",
      "act_transaction",
      "AccessibilityLookStore",
      "EventJournal",
      "lease_acquire",
      "lease_validate",
      "lease_release",
      "window-image-px",
      "accessibility_source_space",
      'root.get("present") is not False',
      "setTextContents",
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
    if (/dbus\.types\.UnixFd|qimage_raw_to_pillow|unsupported QImage format from KWin screenshot/.test(brokerSource)) {
      fail(`Computer Use direct screenshot must be owned by the native authorized helper, not Python D-Bus raw-image conversion: ${computerUseBroker}`);
    }

    const computerUseLibSource = readFileSync(computerUseLib, "utf8");
    for (const marker of [
      "response: RESPONSE_PROPERTY",
      'response === "full"',
      "nodeCount: observation.outline.nodes.length",
      "foreground_reason: FOREGROUND_REASON_PROPERTY",
      'return { target: "isolated" }',
      'return { target: "foreground", reason }',
    ]) {
      if (!computerUseLibSource.includes(marker)) {
        fail(`Expected compact Computer Use successor marker ${marker}: ${computerUseLib}`);
      }
    }

    const isolatedSource = readFileSync(computerUseIsolatedSession, "utf8");
    for (const marker of [
      "kwin_wayland",
      "CODEX_COMPUTER_USE_EIS_HELPER",
      "gui-profile",
      '"find_roots": self.find_roots_v2',
      '"observe_root": self.foreground_broker.observe_root',
      '"act_transaction": self.foreground_broker.act_transaction',
      "--xwayland",
      "XWAYLAND_ENVIRONMENT_HELPER_PATH",
      "xwayland_display",
    ]) {
      if (!isolatedSource.includes(marker)) {
        fail(`Expected maintained isolated Computer Use marker ${marker}: ${computerUseIsolatedSession}`);
      }
    }
    for (const marker of ["StartTransientUnit", "SIGSTOP", "PPid:", "--signal=CONT", "reset-failed", "unit_token", "computer-use-isolated-stderr"]) {
      if (!brokerSource.includes(marker)) {
        fail(`Expected isolated Computer Use supervisor marker ${marker}: ${computerUseBroker}`);
      }
    }
    if (brokerSource.includes("--property=KillMode=control-group")) {
      fail(`Isolated Computer Use must use a transient user scope: ${computerUseBroker}`);
    }
    if (brokerSource.includes("systemd-run")) {
      fail(`Isolated Computer Use must attach the normally spawned helper to its transient scope: ${computerUseBroker}`);
    }
    if (/kwin_mcp/.test(isolatedSource)) {
      fail(`Maintained isolated Computer Use must not depend on kwin-mcp: ${computerUseIsolatedSession}`);
    }
    if (!existsSync(computerUseXwaylandEnvironment)) {
      fail(`Computer Use Xwayland environment helper is missing: ${computerUseXwaylandEnvironment}`);
    }

    const nativeHelperSource = readFileSync(computerUseNativeHelper, "utf8");
    for (const marker of [
      "QDBusInterface",
      "QDBusUnixFileDescriptor",
      "org.kde.KWin.ScreenShot2",
      "CaptureWorkspace",
      "CaptureArea",
      "CaptureWindow",
      "QImage",
      "data_base64",
      "memfd_create",
    ]) {
      if (!nativeHelperSource.includes(marker)) {
        fail(`Expected Computer Use native screenshot helper marker ${marker}: ${computerUseNativeHelper}`);
      }
    }

    const eisHelperSource = readFileSync(computerUseEisHelper, "utf8");
    for (const marker of ["org.kde.KWin.EIS.RemoteDesktop", "libei.so.1", "ei_seat_bind_capabilities"]) {
      if (!eisHelperSource.includes(marker)) {
        fail(`Expected Computer Use EIS helper marker ${marker}: ${computerUseEisHelper}`);
      }
    }

    const glowHelperSource = readFileSync(computerUseGlowHelper, "utf8");
    for (const marker of [
      "XcursorFilenameLoadImages",
      "XcursorFilenameSaveImages",
      "outward-edge-diffusion",
      "pulse_radius",
    ]) {
      if (!glowHelperSource.includes(marker)) {
        fail(`Expected Computer Use cursor glow theme generator marker ${marker}: ${computerUseGlowHelper}`);
      }
    }

    const accessSource = readFileSync(computerUseAccess, "utf8");
    for (const marker of [
      "CMakeLists.txt",
      "codex-computer-use-glow.cpp",
      "codex-computer-use-screenshot.desktop",
      "CODEX_COMPUTER_USE_SCREENSHOT_HELPER",
      "CODEX_COMPUTER_USE_CURSOR_GLOW_THEME_PATH",
      "cmake --build",
      "libXcursor",
      "plasma-apply-cursortheme",
      "X-KDE-DBUS-Restricted-Interfaces=org.kde.KWin.ScreenShot2",
    ]) {
      if (!accessSource.includes(marker)) {
        fail(`Expected Computer Use access helper marker ${marker}: ${computerUseAccess}`);
      }
    }
    if (/\/usr\/bin\/python3|node-22/.test(accessSource)) {
      fail(`Computer Use ScreenShot2 authorization must not target interpreter executables: ${computerUseAccess}`);
    }
  }

  verifyChromeNativeHostManifestCheck(chromeRoot, chromeManifestCheck, chromeExtensionIdConfig, chromeInstallManifest, chromeHostPath);

  const appleMetadataFiles = findAppleMetadataFiles(
    path.join(resourcesDir, "plugins", "openai-bundled"),
  );

  if (appleMetadataFiles.length > 0) {
    fail(`Bundled plugin resources contain macOS metadata files: ${appleMetadataFiles.slice(0, 5).join(", ")}`);
  }
}

function verifyBundledSkills(resourcesDir) {
  const skillsRoot = path.join(resourcesDir, "skills");
  const manifestPath = path.join(resourcesDir, BUNDLED_SKILLS_MANIFEST_FILENAME);
  requirePath(manifestPath, "bundled skills manifest");
  verifyBundledSkillsTree(skillsRoot, readBundledSkillsManifest(manifestPath));
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
    const smokeResourcesDir = path.join(tempDir, "resources");
    const smokeChromeRoot = path.join(smokeResourcesDir, "plugins", "openai-bundled", "plugins", "chrome");
    cpSync(chromeRoot, smokeChromeRoot, { recursive: true });
    const smokeCheckerPath = path.join(smokeChromeRoot, "scripts", "check-native-host-manifest.js");
    const smokeChromeHostPath = path.join(
      smokeChromeRoot,
      "extension-host",
      "linux",
      process.arch,
      "extension-host",
    );
    const manifestPath = path.join(tempDir, `${hostName}.json`);
    const hostConfigPath = path.join(path.dirname(smokeChromeHostPath), "extension-host-config.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        name: hostName,
        description: "Codex chrome native messaging host",
        type: "stdio",
        path: smokeChromeHostPath,
        allowed_origins: [`chrome-extension://${extensionId}/`],
      }),
    );
    writeFileSync(
      hostConfigPath,
      `${JSON.stringify(
        {
          browserClientPath: path.join(smokeChromeRoot, "scripts", "browser-client.mjs"),
          codexCliPath: path.join(smokeResourcesDir, "codex"),
          nodePath: path.join(smokeResourcesDir, "node"),
          browserAutomationPath: path.join(smokeResourcesDir, "browser_automation"),
          extensionId,
        },
        null,
        2,
      )}\n`,
    );

    runOrThrowWithEnv("node", [smokeCheckerPath, "--json"], smokeChromeRoot, {
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
  verifyBundledSkills(resourcesDir);
  verifyBrowserProfileImportRuntime(resourcesDir);
  verifyPatchState(resourcesDir, appAsarPath);
  verifyBundle(resourcesDir, appAsarPath);
  verifyChromeExtensionIntegrationInBundle(resourcesDir, appAsarPath);

  const electronVersion = readFileSync(versionPath, "utf8").trim();
  if (electronVersion !== "42.1.0") {
    fail(`Expected Electron 42.1.0 runtime, got: ${electronVersion || "<empty>"}`);
  }

  console.error(`[INFO] Verified staged install: ${installDir}`);
}

main();
