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

function expectedLocalPluginNames() {
  const raw = process.env.CODEX_VERIFY_LOCAL_PLUGINS ?? process.env.CODEX_LOCAL_PLUGIN_NAMES ?? "dolphin,kitty";
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
    verifyRemoteControlBackendSource(bundleSources.main);
    verifyRemoteControlDeviceKeySource(bundleSources.main);
    verifyRemoteControlVisibilitySource(bundleSources);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function verifyRemoteControlDeviceKeySource(source) {
  for (const marker of [
    "function codexLinuxDeviceKeyStorePaths",
    "function codexLinuxDeviceKeyStorePath",
    "function codexLinuxRemoteControlDeviceKeyBackend",
    "process.env.CODEX_HOME",
    "'.codex'",
    "'remote-control','device-keys','keys.json",
    "'.local','share'),'codex-app','device-keys','keys.json",
    "codexLinuxQuarantineDeviceKeyStore",
    "renameSync(o,i)",
    "createPrivateKey(r.privateKeyPem)",
    "generateKeyPairSync('ec',{namedCurve:'prime256v1'}",
    "protectionClass:'os_protected_nonextractable'",
    "e.sign('sha256',n,i)",
    "process.platform==='linux'",
  ]) {
    if (!source.includes(marker)) {
      fail(`Expected Linux remote-control device-key marker in Electron main bundle: ${marker}`);
    }
  }

  if (source.includes("Remote control device keys are only available on macOS")) {
    fail("Electron main bundle still contains the macOS-only remote-control device-key gate");
  }
}

function verifyRemoteControlBackendSource(source) {
  for (const marker of [
    "i===`linux`?{...e,control:!0",
    "CODEX_ELECTRON_ENABLE_LINUX_BROWSER_USE",
    "browserPane:!0,inAppBrowserUse:!0,inAppBrowserUseAllowed:!0,externalBrowserUse:!0,externalBrowserUseAllowed:!0",
  ]) {
    if (!source.includes(marker)) {
      fail(`Expected Linux remote-control backend marker in Electron main bundle: ${marker}`);
    }
  }

  if (
    source.includes(
      "i===`linux`&&r.CODEX_ELECTRON_ENABLE_LINUX_BROWSER_USE===`1`?{...e,browserPane:!0,inAppBrowserUse:!0,inAppBrowserUseAllowed:!0,externalBrowserUse:!0,externalBrowserUseAllowed:!0}",
    )
  ) {
    fail("Electron main bundle still leaves Linux remote-control desktop features disabled");
  }

  if (source.includes("i===`linux`?{...e,control:!0,deviceAttestation:!0")) {
    fail("Electron main bundle should not advertise Linux DeviceCheck attestation availability");
  }
}

function verifyRemoteControlVisibilitySource(bundleSources) {
  if (
    !/function [$A-Z_a-z][$\w]*\(\{remoteControlConnectionsState:[$A-Z_a-z][$\w]*,slingshotEnabled:[$A-Z_a-z][$\w]*\}\)\{return!0\}/.test(
      bundleSources.webviewRemoteControlConnectionsVisibility,
    )
  ) {
    fail("Expected webview remote-control connections visibility gate to be open");
  }

  if (!/function [$A-Z_a-z][$\w]*\(\)\{return!0\}/.test(bundleSources.webviewRemoteConnectionVisibility)) {
    fail("Expected webview remote connections feature gate to be open");
  }

  if (
    bundleSources.webviewRemoteControlConnectionsVisibility.includes(
      "return t&&(e?.available??!0)&&e?.accessRequired!==!0",
    )
  ) {
    fail("Webview remote-control connections visibility gate still depends on remote state");
  }

  if (
    bundleSources.webviewRemoteConnectionVisibility.includes("features.remote_connections") ||
    bundleSources.webviewRemoteConnectionVisibility.includes("c(`4114442250`)")
  ) {
    fail("Webview remote connections feature gate still depends on config or Statsig");
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
  const chromeRoot = path.join(resourcesDir, "plugins", "openai-bundled", "plugins", "chrome");
  const chromePluginJson = path.join(chromeRoot, ".codex-plugin", "plugin.json");
  const chromeClient = path.join(chromeRoot, "scripts", "browser-client.mjs");
  const chromeManifestCheck = path.join(chromeRoot, "scripts", "check-native-host-manifest.js");
  const chromeExtensionIdConfig = path.join(chromeRoot, "scripts", "extension-id.json");
  const chromeInstallManifest = path.join(chromeRoot, "scripts", "installManifest.mjs");
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
  const nodeReplPath = path.join(resourcesDir, "node_repl");

  requirePath(marketplacePath, "OpenAI bundled marketplace");
  requirePath(browserUsePluginJson, "Browser Use plugin manifest");
  requirePath(browserUseClient, "Browser Use client script");
  requirePath(chromePluginJson, "Chrome plugin manifest");
  requirePath(chromeClient, "Chrome client script");
  requirePath(chromeManifestCheck, "Chrome native host manifest checker");
  requirePath(chromeExtensionIdConfig, "Chrome extension ID config");
  requirePath(chromeInstallManifest, "Chrome native host installer script");
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

  requireExecutable(nodeReplPath);

  const nodeReplSource = readFileSync(nodeReplPath, "utf8");
  if (!nodeReplSource.includes("fetchViaCodexDesktop")) {
    fail(`Expected Linux node_repl to route site-status through Codex Desktop auth fetch: ${nodeReplPath}`);
  }
  if (!nodeReplSource.includes("requestDesktopBrowserApproval")) {
    fail(`Expected Linux node_repl to route Browser Use origin approval through Codex Desktop: ${nodeReplPath}`);
  }
  if (!nodeReplSource.includes("CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET")) {
    fail(`Expected Linux node_repl to use CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET: ${nodeReplPath}`);
  }
  if (!nodeReplSource.includes("Linux browser approval bridge unavailable")) {
    fail(`Expected Linux node_repl to expose a clear browser approval bridge failure: ${nodeReplPath}`);
  }
  if (nodeReplSource.includes("cf-mitigated")) {
    fail(`Linux node_repl should not fake site-status results for Cloudflare challenges: ${nodeReplPath}`);
  }
  if (nodeReplSource.includes("elicitation/create") || nodeReplSource.includes("debugCreateElicitationRaw")) {
    fail(`Linux node_repl Browser Use approval should not depend on MCP client elicitation requests: ${nodeReplPath}`);
  }
  if (nodeReplSource.includes('isLocalOrigin(origin) ? { action: "accept" } : { action: "decline" }')) {
    fail(`Linux node_repl should not silently decline non-local Browser Use origins: ${nodeReplPath}`);
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
  if (!/[$A-Z_a-z][$\w]*\(\)==="linux"\?"\.config\/google-chrome"/.test(chromeClientSource)) {
    fail(`Expected Chrome client to use Linux Chrome profile root: ${chromeClient}`);
  }
  if (!chromeClientSource.includes("waitForArrival:!1,x:r,y:n")) {
    fail(`Expected Chrome client to avoid blocking on Linux mouse move arrival: ${chromeClient}`);
  }
  if (!chromeClientSource.includes("browser backend info request timed out")) {
    fail(`Expected Chrome client to timeout unhealthy backend discovery sockets: ${chromeClient}`);
  }
  if (!chromeClientSource.includes('type:"mouseMoved",x:t.point.x,y:t.point.y,button:"none"')) {
    fail(`Expected Chrome client to dispatch an explicit CDP mouse move before clicking: ${chromeClient}`);
  }

  const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
  const pluginNames = new Set(marketplace.plugins?.map((plugin) => plugin.name));

  for (const pluginName of ["browser", "chrome", "latex", ...expectedLocalPlugins]) {
    if (!pluginNames.has(pluginName)) {
      fail(`Expected bundled marketplace to include ${pluginName}: ${marketplacePath}`);
    }
  }

  for (const localPluginName of ["dolphin", "kitty"]) {
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
      fail(`Expected Dolphin MCP manifest to use the runtime-supported mcpServers shape: ${dolphinMcpJson}`);
    }
    if (dolphinMcp?.mcpServers?.dolphin?.args?.[0] !== "./scripts/dolphin-mcp.mjs") {
      fail(`Expected Dolphin MCP manifest to launch scripts/dolphin-mcp.mjs: ${dolphinMcpJson}`);
    }
    if (dolphinMcp?.mcpServers?.dolphin?.cwd !== ".") {
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
      fail(`Expected Kitty MCP manifest to use the runtime-supported mcpServers shape: ${kittyMcpJson}`);
    }
    if (kittyMcp?.mcpServers?.kitty?.args?.[0] !== "./scripts/kitty-mcp.mjs") {
      fail(`Expected Kitty MCP manifest to launch scripts/kitty-mcp.mjs: ${kittyMcpJson}`);
    }
    if (kittyMcp?.mcpServers?.kitty?.cwd !== ".") {
      fail(`Expected Kitty MCP manifest to declare plugin-root cwd: ${kittyMcpJson}`);
    }
  }

  if (pluginNames.has("computer-use")) {
    fail(`Linux bundled marketplace should not advertise macOS-only computer-use: ${marketplacePath}`);
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
  requirePath(iconPath, "file");
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
