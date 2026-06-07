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

export const CHROME_SKILL_GUIDANCE_PATCHES = [
  {
    label: "visible tool surface guidance",
    search: `Chrome is the routing touchpoint for the Codex Chrome Extension:

- Use Chrome directly for browser automation requests and for Chrome setup, detection, repair, or profile checks.
- For bare or general \`@chrome\` requests, do not ask a clarification question just because the request is ambiguous. Proceed with browser automation in this skill using the \`chrome\` backend.
- If communication with the Codex Chrome Extension ultimately fails, even after checks, do not attempt to complete the user's request using applescript, bash commands or any other scripting methods.
- Do not install or repair the native host yourself. If native host setup appears broken, tell the user to reinstall the Chrome plugin from the Codex plugin UI.`,
    replacement: `Chrome is the routing touchpoint for the Codex Chrome Extension:

- Use Chrome directly for browser automation requests and for Chrome setup, detection, repair, or profile checks.
- For bare or general \`@chrome\` requests, do not ask a clarification question just because the request is ambiguous. Proceed with browser automation in this skill using the \`chrome\` backend.
- If communication with the Codex Chrome Extension ultimately fails, even after checks, do not attempt to complete the user's request using applescript, bash commands or any other scripting methods.
- Do not install or repair the native host yourself. If native host setup appears broken, tell the user to reinstall the Chrome plugin from the Codex plugin UI.
- If this plugin is listed as available in the session, treat that as mandatory reading before Chrome browser work. Open and follow this skill before saying that Chrome is unavailable and before falling back to Computer Use or any other browser-control path.
- Do not skip this skill just because Computer Use MCP tool calls are directly visible or appear easier to invoke. The presence of Computer Use tools is not evidence that Computer Use is the preferred Chrome surface.

## Visible Tool Surface

Chrome browser control is exposed through the generic Node REPL \`js\` tool after loading this plugin's \`scripts/browser-client.mjs\`; it is expected that tool discovery may not show separate Chrome-specific \`click\`, \`type\`, \`navigate\`, \`screenshot\`, or \`devtools\` tools.

Do not conclude that Chrome DOM/DevTools automation is unavailable just because only \`node_repl\` is visible. Use the Node REPL \`js\` tool, import \`scripts/browser-client.mjs\` from this plugin root, call \`setupBrowserRuntime({ globals: globalThis })\`, and then use \`agent.browsers.get("extension")\`.

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
];

export function patchChromeManifestChecker(checkerPath) {
  patchFile(checkerPath, CHROME_MANIFEST_CHECK_PATCHES, "Chrome native host manifest checker");
}

export function patchChromeRunningChecker(checkerPath) {
  patchFile(checkerPath, CHROME_RUNNING_CHECK_PATCHES, "Chrome running checker");
}

export function patchChromeSkill(skillPath) {
  patchFile(skillPath, CHROME_SKILL_GUIDANCE_PATCHES, "Chrome skill guidance");
}
