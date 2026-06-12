import { patchFile } from "./patch-utils.mjs";

export const CHROME_MANIFEST_CHECK_PATCHES = [
  {
    label: "Linux native host manifest path",
    search: `  if (process.platform === "win32") {
    const registryKey = \`\${WINDOWS_NATIVE_HOST_REGISTRY_KEY_PREFIX}\\\\\${expectedHostName}\`;
    const registryManifestPath = readWindowsRegistryDefaultValue(registryKey);

    return {
      manifestPath: registryManifestPath || getDefaultWindowsManifestPath(),
      registryKey,
      registryManifestPath,
      registryKeyExists: registryManifestPath != null,
    };
  }

  throw new Error(
    \`Unsupported platform for native host manifest check: \${process.platform}. This script supports macOS and Windows.\`,
  );`,
    replacement: `  if (process.platform === "win32") {
    const registryKey = \`\${WINDOWS_NATIVE_HOST_REGISTRY_KEY_PREFIX}\\\\\${expectedHostName}\`;
    const registryManifestPath = readWindowsRegistryDefaultValue(registryKey);

    return {
      manifestPath: registryManifestPath || getDefaultWindowsManifestPath(),
      registryKey,
      registryManifestPath,
      registryKeyExists: registryManifestPath != null,
    };
  }

  if (process.platform === "linux") {
    return {
      manifestPath: path.join(
        os.homedir(),
        ".config",
        "google-chrome",
        "NativeMessagingHosts",
        \`\${expectedHostName}.json\`,
      ),
      registryKey: null,
      registryManifestPath: null,
      registryKeyExists: null,
    };
  }

  throw new Error(
    \`Unsupported platform for native host manifest check: \${process.platform}. This script supports macOS, Windows, and Linux.\`,
  );`,
  },
];

export const CHROME_RUNNING_CHECK_PATCHES = [
  {
    label: "Linux extension-capable Chrome detection",
    search: `function parseProcessList(output, processNames) {
  if (!output) return [];

  const processes = [];
  for (const line of output.split(/\\r?\\n/)) {
    const match = line.match(/^\\s*(\\d+)\\s+(.+?)\\s*$/);
    if (!match) continue;

    const [, pid, command] = match;
    const processName = chromeProcessNameForCommand(command);
    if (!processNames.has(processName)) continue;

    processes.push({
      pid: Number(pid),
      process_name: processName,
      command: stripCommandArguments(command),
    });
  }

  return processes;
}`,
    replacement: `function isLinuxExtensionCapableChromeCommand(command) {
  if (process.platform !== "linux") return true;

  return ![
    /\\s--type=/,
    /\\s--headless(?:=|\\s|$)/,
    /\\s--disable-extensions(?:=|\\s|$)/,
    /\\s--user-data-dir=\\/tmp\\/puppeteer_dev_chrome_profile-/,
  ].some((pattern) => pattern.test(command));
}

function parseProcessList(output, processNames) {
  if (!output) return [];

  const processes = [];
  for (const line of output.split(/\\r?\\n/)) {
    const match = line.match(/^\\s*(\\d+)\\s+(.+?)\\s*$/);
    if (!match) continue;

    const [, pid, command] = match;
    const processName = chromeProcessNameForCommand(command);
    if (!processNames.has(processName)) continue;
    if (!isLinuxExtensionCapableChromeCommand(command)) continue;

    processes.push({
      pid: Number(pid),
      process_name: processName,
      command: stripCommandArguments(command),
    });
  }

  return processes;
}`,
  },
  {
    label: "Linux full Chrome command inspection",
    search: `  let processList;
  try {
    processList = runCommand("ps", ["-A", "-o", "pid=", "-o", "comm="]);
  } catch (error) {
    if (singletonProcess != null) return [singletonProcess];

    throw error;
  }`,
    replacement: `  let processList;
  try {
    processList =
      process.platform === "linux"
        ? runCommand("ps", ["-A", "-ww", "-o", "pid=", "-o", "command="])
        : runCommand("ps", ["-A", "-o", "pid=", "-o", "comm="]);
  } catch (error) {
    if (singletonProcess != null) return [singletonProcess];

    throw error;
  }`,
  },
];

export const CHROME_INSTALL_MANIFEST_PATCHES = [
  {
    label: "browser automation native host config path",
    apply(source) {
      return source.replaceAll("nodeReplPath", "browserAutomationPath");
    },
    appliedMarkers: ["browserAutomationPath"],
  },
];

export const CHROME_SKILL_GUIDANCE_PATCHES = [
  {
    label: "visible tool surface guidance",
    search: `Chrome is the routing touchpoint for the Codex Chrome Extension:

- Use Chrome directly for Chrome setup, detection, repair, or profile checks.
- For bare or general \`@chrome\` requests, do not ask a clarification question just because the request is ambiguous. Proceed with browser automation in this skill using the \`chrome\` backend.
`,
    replacement: `Chrome is the routing touchpoint for the Codex Chrome Extension:

- Use Chrome directly for Chrome setup, detection, repair, or profile checks.
- For bare or general \`@chrome\` requests, do not ask a clarification question just because the request is ambiguous. Proceed with browser automation in this skill using the \`chrome\` backend.
- If this plugin is listed as available in the session, treat that as mandatory reading before Chrome browser work. Open and follow this skill before saying that Chrome is unavailable and before falling back to Computer Use or any other browser-control path.
- Do not skip this skill just because Computer Use MCP tool calls are directly visible or appear easier to invoke. The presence of Computer Use tools is not evidence that Computer Use is the preferred Chrome surface.

## Visible Tool Surface

Chrome browser control is exposed through the \`browser_automation\` MCP server's \`js\` tool after loading this plugin's \`scripts/browser-client.mjs\`; it is expected that tool discovery may not show separate Chrome-specific \`click\`, \`type\`, \`navigate\`, \`screenshot\`, or \`devtools\` tools.

Do not conclude that Chrome DOM/DevTools automation is unavailable just because only \`browser_automation\` is visible. Use the \`browser_automation\` \`js\` tool, import \`scripts/browser-client.mjs\` from this plugin root, call \`setupBrowserRuntime({ globals: globalThis })\`, and then use \`agent.browsers.get("extension")\`.

Current verified API shape:

\`\`\`js
const { setupBrowserRuntime } = await import("<plugin root>/scripts/browser-client.mjs");
await setupBrowserRuntime({ globals: globalThis });
const browser = await agent.browsers.get("extension");
const tab = await browser.tabs.new();
await tab.goto("https://example.com/");
console.log(await tab.title());
console.log(await tab.playwright.locator("body").innerText({ timeout: 10000 }));
await tab.close();
\`\`\`

Use \`browser.tabs.new()\`, not \`browser.tabs.create()\`. Use \`tab.playwright.locator(...)\`, not \`tab.locator(...)\`.`,
  },
  {
    label: "browser automation tool naming",
    apply(source) {
      return source
        .replaceAll("mcp__node_repl__js", "mcp__browser_automation__js")
        .replaceAll("nodeRepl.emitImage", "browserAutomation.emitImage")
        .replaceAll("node_repl", "browser_automation")
        .replaceAll("Node REPL", "browser_automation")
        .replaceAll("nodeRepl", "browserAutomation")
        .replaceAll(
          "Never mention `browser_automation`, `browser_automation`, `REPL`, JavaScript sessions, or module exports unless a user is asking for that exact information.",
          "Never mention MCP internals, JavaScript sessions, or module exports unless a user is asking for that exact information.",
        )
        .replaceAll(
          "Never mention `browser_automation`, `browser_automation`, `browser_automation`, JavaScript sessions, module exports, reading documentation, or loading instructions unless a user is asking for that exact information.",
          "Never mention MCP internals, JavaScript sessions, module exports, reading documentation, or loading instructions unless a user is asking for that exact information.",
        )
        .replaceAll(
          "Never mention `browser_automation`, `browser_automation`, `REPL`, JavaScript sessions, module exports, reading documentation, or loading instructions unless a user is asking for that exact information.",
          "Never mention MCP internals, JavaScript sessions, module exports, reading documentation, or loading instructions unless a user is asking for that exact information.",
        )
        .replaceAll("calls to the REPL", "browser_automation calls");
    },
    appliedMarkers: ["browser_automation", "browserAutomation"],
  },
];

export function patchChromeManifestChecker(checkerPath) {
  patchFile(checkerPath, CHROME_MANIFEST_CHECK_PATCHES, "Chrome native host manifest checker");
}

export function patchChromeRunningChecker(checkerPath) {
  patchFile(checkerPath, CHROME_RUNNING_CHECK_PATCHES, "Chrome running checker");
}

export function patchChromeInstallManifest(installManifestPath) {
  patchFile(installManifestPath, CHROME_INSTALL_MANIFEST_PATCHES, "Chrome native host install manifest");
}

export function patchChromeSkill(skillPath) {
  patchFile(skillPath, CHROME_SKILL_GUIDANCE_PATCHES, "Chrome skill guidance");
}
