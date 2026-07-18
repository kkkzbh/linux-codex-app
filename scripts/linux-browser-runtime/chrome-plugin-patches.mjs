import path from "node:path";
import { patchFile } from "./patch-utils.mjs";

function replaceOrThrow(source, search, replacement, label) {
  if (!source.includes(search)) {
    if (source.includes(replacement)) {
      return source;
    }

    throw new Error(`Failed to patch ${label}: expected upstream anchor not found`);
  }

  return source.replace(search, replacement);
}

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
  {
    label: "Linux native host staged runtime validation",
    apply(source) {
      let updated = source;
      updated = replaceOrThrow(
        updated,
        `function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
`,
        `function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getLinuxNativeHostPathForPluginRoot(pluginRoot) {
  const platformDir = { linux: "linux" }[process.platform];
  const executableName = platformDir === "linux" ? "extension-host" : null;
  if (!platformDir || !executableName) return null;

  return path.resolve(
    pluginRoot,
    "extension-host",
    platformDir,
    os.arch(),
    executableName,
  );
}

function getExpectedLinuxHostConfig(manifest, actualHostConfig) {
  const actualHostPath = typeof manifest.path === "string" ? manifest.path : null;
  if (actualHostPath == null) {
    return {
      actualHostPath,
      expectedHostPath: null,
      hostConfigPath: null,
      actualHostConfig: null,
      expectedHostConfig: null,
      hostConfigProblem: "native host manifest path is missing",
    };
  }

  const configPath = path.join(path.dirname(actualHostPath), "extension-host-config.json");
  const browserAutomationPath = actualHostConfig?.browserAutomationPath;
  if (typeof browserAutomationPath !== "string" || browserAutomationPath.trim().length === 0 || !path.isAbsolute(browserAutomationPath)) {
    return {
      actualHostPath,
      expectedHostPath: null,
      hostConfigPath: configPath,
      actualHostConfig,
      expectedHostConfig: null,
      hostConfigProblem: "native host config is missing an absolute browserAutomationPath",
    };
  }

  const resourcesDir = path.dirname(path.resolve(browserAutomationPath));
  const pluginRoot = path.resolve(resourcesDir, "plugins", "openai-bundled", "plugins", "chrome");
  const expectedHostPath = getLinuxNativeHostPathForPluginRoot(pluginRoot);
  return {
    actualHostPath,
    expectedHostPath,
    hostConfigPath: configPath,
    actualHostConfig,
    expectedHostConfig: {
      browserClientPath: path.resolve(pluginRoot, "scripts", "browser-client.mjs"),
      codexCliPath: path.resolve(resourcesDir, "codex"),
      nodePath: path.resolve(resourcesDir, "node"),
      browserAutomationPath: path.resolve(resourcesDir, "browser_automation"),
    },
    hostConfigProblem: null,
  };
}

function getLinuxNativeHostRuntimeStatus(manifest) {
  if (process.platform !== "linux") {
    return {
      actualHostPath: typeof manifest.path === "string" ? manifest.path : null,
      expectedHostPath: null,
      hostPathMatchesExpected: true,
      hostConfigMatchesExpected: true,
      hostConfigProblem: null,
    };
  }

  const actualHostPath = typeof manifest.path === "string" ? manifest.path : null;
  if (actualHostPath == null) {
    return {
      actualHostPath,
      expectedHostPath: null,
      hostPathMatchesExpected: false,
      hostConfigMatchesExpected: false,
      hostConfigProblem: "native host manifest path is missing",
    };
  }

  let actualHostConfig;
  const configPath = path.join(path.dirname(actualHostPath), "extension-host-config.json");
  try {
    actualHostConfig = readJsonFile(configPath);
  } catch (error) {
    return {
      actualHostPath,
      expectedHostPath: null,
      hostPathMatchesExpected: false,
      hostConfigPath: configPath,
      hostConfigMatchesExpected: false,
      hostConfigProblem: \`could not read native host config: \${error instanceof Error ? error.message : String(error)}\`,
    };
  }

  const expected = getExpectedLinuxHostConfig(manifest, actualHostConfig);
  if (expected.hostConfigProblem != null) {
    return {
      ...expected,
      hostPathMatchesExpected: false,
      hostConfigMatchesExpected: false,
    };
  }

  const hostPathMatchesExpected =
    expected.actualHostPath != null &&
    expected.expectedHostPath != null &&
    path.resolve(expected.actualHostPath) === path.resolve(expected.expectedHostPath);
  const configMismatches = Object.entries(expected.expectedHostConfig)
    .filter(([key, expectedValue]) => path.resolve(String(actualHostConfig?.[key] ?? "")) !== expectedValue)
    .map(([key]) => key);
  const hostConfigMatchesExpected = configMismatches.length === 0;

  return {
    actualHostPath: expected.actualHostPath,
    expectedHostPath: expected.expectedHostPath,
    hostPathMatchesExpected,
    hostConfigPath: expected.hostConfigPath,
    expectedHostConfig: expected.expectedHostConfig,
    actualHostConfig,
    hostConfigMatchesExpected,
    hostConfigProblem: hostConfigMatchesExpected
      ? null
      : \`native host config does not match staged runtime paths: \${configMismatches.join(", ")}\`,
  };
}
`,
        "Chrome native host manifest checker staged runtime helpers",
      );
      updated = replaceOrThrow(
        updated,
        `  const registryMatchesManifestPath =
    location.registryManifestPath == null ||
    path.resolve(location.registryManifestPath) ===
      path.resolve(location.manifestPath);
  const correct =
    nameMatches && hasExpectedOrigin && registryMatchesManifestPath;
`,
        `  const registryMatchesManifestPath =
    location.registryManifestPath == null ||
    path.resolve(location.registryManifestPath) ===
      path.resolve(location.manifestPath);
  const linuxRuntimeStatus = getLinuxNativeHostRuntimeStatus(manifest);
  const correct =
    nameMatches &&
    hasExpectedOrigin &&
    registryMatchesManifestPath &&
    linuxRuntimeStatus.hostPathMatchesExpected &&
    linuxRuntimeStatus.hostConfigMatchesExpected;
`,
        "Chrome native host manifest checker correctness",
      );
      updated = replaceOrThrow(
        updated,
        `    registryMatchesManifestPath,
    correct,
    problem: correct
      ? null
      : describeManifestProblem({
          nameMatches,
          hasExpectedOrigin,
          registryMatchesManifestPath,
        }),
  };
}

function describeManifestProblem({
  nameMatches,
  hasExpectedOrigin,
  registryMatchesManifestPath,
}) {
`,
        `    registryMatchesManifestPath,
    ...linuxRuntimeStatus,
    correct,
    problem: correct
      ? null
      : describeManifestProblem({
          nameMatches,
          hasExpectedOrigin,
          registryMatchesManifestPath,
          hostPathMatchesExpected: linuxRuntimeStatus.hostPathMatchesExpected,
          hostConfigMatchesExpected: linuxRuntimeStatus.hostConfigMatchesExpected,
          hostConfigProblem: linuxRuntimeStatus.hostConfigProblem,
        }),
  };
}

function describeManifestProblem({
  nameMatches,
  hasExpectedOrigin,
  registryMatchesManifestPath,
  hostPathMatchesExpected,
  hostConfigMatchesExpected,
  hostConfigProblem,
}) {
`,
        "Chrome native host manifest checker status fields",
      );
      updated = replaceOrThrow(
        updated,
        `  if (!registryMatchesManifestPath) {
    problems.push(
      "registry manifest path does not match checked manifest path",
    );
  }

  return problems.join("; ");
}
`,
        `  if (!registryMatchesManifestPath) {
    problems.push(
      "registry manifest path does not match checked manifest path",
    );
  }
  if (!hostPathMatchesExpected) {
    problems.push("native host manifest path does not point at the staged Chrome extension host");
  }
  if (!hostConfigMatchesExpected) {
    problems.push(hostConfigProblem || "native host config does not match staged runtime paths");
  }

  return problems.join("; ");
}
`,
        "Chrome native host manifest checker problem details",
      );
      updated = replaceOrThrow(
        updated,
        `    if (result.allowedOrigins)
      console.log(\`Allowed origins: \${result.allowedOrigins.join(", ")}\`);
    console.log(\`Correct: \${result.correct ? "yes" : "no"}\`);
`,
        `    if (result.allowedOrigins)
      console.log(\`Allowed origins: \${result.allowedOrigins.join(", ")}\`);
    if (result.expectedHostPath)
      console.log(\`Expected native host path: \${result.expectedHostPath}\`);
    if (result.actualHostPath)
      console.log(\`Actual native host path: \${result.actualHostPath}\`);
    if (result.hostConfigPath)
      console.log(\`Native host config: \${result.hostConfigPath}\`);
    console.log(\`Correct: \${result.correct ? "yes" : "no"}\`);
`,
        "Chrome native host manifest checker CLI output",
      );
      return updated;
    },
    appliedMarkers: [
      "getLinuxNativeHostPathForPluginRoot",
      "hostConfigMatchesExpected",
      "native host manifest path does not point at the staged Chrome extension host",
    ],
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
      if (!source.includes("nodeReplPath")) {
        if (
          source.includes("browserAutomationPath") &&
          source.includes("Missing staged Chrome extension host") &&
          source.includes("t.appServerRuntimePaths")
        ) {
          return source;
        }

        throw new Error("Failed to patch Chrome native host installer browser automation config field: expected upstream anchor not found");
      }

      let updated = source.replaceAll("nodeReplPath", "browserAutomationPath");
      const linuxResolver = `var N=(t,e)=>{if(process.platform==="linux"){let o=e?.browserAutomationPath;if(typeof o!=="string"||!o.trim())throw new Error("Missing staged browserAutomationPath for Linux Chrome native host install");let n=P.resolve(P.dirname(o),"plugins","openai-bundled","plugins","chrome"),r=l(n);if(!A(r))throw new Error(\`Missing staged Chrome extension host at \${r}\`);return n}let i=P.resolve(t).split(P.sep),a=i.lastIndexOf("cache");return a<1||i[a-1]!=="plugins"||i.length<=a+3?t:P.resolve(t,"..","latest")};`;
      updated = replaceOrThrow(
        updated,
        `var N=t=>{let e=P.resolve(t).split(P.sep),o=e.lastIndexOf("cache");return o<1||e[o-1]!=="plugins"||e.length<=o+3?t:P.resolve(t,"..","latest")};`,
        linuxResolver,
        "Chrome native host installer staged plugin root resolver",
      );
      updated = replaceOrThrow(
        updated,
        `var Pt=async t=>{let e=N(D.resolve(import.meta.dirname,".."));`,
        `var Pt=async t=>{let e=N(D.resolve(import.meta.dirname,".."),t.appServerRuntimePaths);`,
        "Chrome native host installer staged runtime paths argument",
      );
      return updated;
    },
    appliedMarkers: [
      "browserAutomationPath",
      "Missing staged Chrome extension host",
      "t.appServerRuntimePaths",
    ],
  },
];

export const CHROME_SKILL_GUIDANCE_PATCHES = [
  {
    label: "visible tool surface guidance",
    search: `Chrome is the routing touchpoint for the ChatGPT Chrome Extension:

- Use Chrome directly for Chrome setup, detection, repair, or profile checks.
- For bare or general Chrome requests, do not ask a clarification question just because the request is ambiguous. Proceed with browser automation in this skill.

If this plugin is listed as available in the session, treat that as mandatory reading before Chrome work. Open and follow this skill before saying that Chrome is unavailable and before falling back to standalone Playwright or Computer Use.
`,
    replacement: `Chrome is the routing touchpoint for the ChatGPT Chrome Extension:

- Use Chrome directly for Chrome setup, detection, repair, or profile checks.
- For bare or general Chrome requests, do not ask a clarification question just because the request is ambiguous. Proceed with browser automation in this skill.
- If this plugin is listed as available in the session, treat that as mandatory reading before Chrome browser work. Open and follow this skill before saying that Chrome is unavailable and before switching to Computer Use or any other browser-control path.
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
    appliedMarkers: [
      "## Visible Tool Surface",
      "Do not conclude that Chrome DOM/DevTools automation is unavailable",
      "Computer Use tools is not evidence",
    ],
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

export const CHROME_FILE_UPLOAD_DOC_PATCHES = [
  {
    label: "file upload workflow diagnostics",
    search: `# File Uploads
Handle file inputs and uploads through the file chooser flow:

\`\`\`js
const chooserPromise = tab.playwright.waitForEvent("filechooser", { timeoutMs: 10000 });
await tab.playwright.locator('input[type="file"]').click();
const chooser = await chooserPromise;
await chooser.setFiles(["/absolute/path/to/file.txt"]);
\`\`\`

- Start \`waitForEvent("filechooser")\` before clicking the file input or its associated upload control.
- Prefer the actual \`input[type="file"]\` when available. Click a visible button or label only when it opens the chooser.
- Use absolute paths for \`setFiles(...)\`.
- Use \`chooser.isMultiple()\` before passing multiple files when needed.
- Do not look for \`locator.setInputFiles(...)\`; uploads are exposed through the chooser object.
- Try the file chooser flow before falling back to a native picker.
- If an upload fails, use any browser-specific upload troubleshooting listed in the selected browser's documentation catalog.
`,
    replacement: `# File Uploads
Handle file inputs and uploads through the file chooser flow:

\`\`\`js
const fileInput = tab.playwright.locator('input[type="file"]');
const chooserPromise = tab.playwright.waitForEvent("filechooser");
await fileInput.click({ force: true });
const chooser = await chooserPromise;
await chooser.setFiles("/absolute/path/to/file.txt");
\`\`\`

- Start \`waitForEvent("filechooser")\` immediately before clicking the file input or its associated upload control.
- Chrome file chooser waits honor \`timeoutMs\` up to the installer-defined maximum, matching the download wait behavior. A timeout means no chooser event arrived within that requested wait.
- Prefer the actual \`input[type="file"]\` when available. When a page wraps the input in a visible label or button, trigger the same associated control.
- For custom upload controls, inspect the DOM, input geometry, labels, and event handlers. If no chooser opens, report a page-specific trigger/control failure.
- Use absolute paths for \`setFiles(...)\`.
- Use \`chooser.isMultiple()\` before passing multiple files when needed.
- Do not look for \`locator.setInputFiles(...)\`; uploads are exposed through the chooser object.
- After \`setFiles(...)\`, verify with \`input.value\`, the visible filename or hint, or the page's upload/submit result. Do not treat unreadable or empty \`input.files\` from read-only evaluation as proof that \`setFiles(...)\` failed.
- Many sites require clicking their Upload or Submit control after \`setFiles(...)\`; selecting the file alone usually does not transmit it.
- If \`waitForEvent("filechooser")\` times out, inspect the trigger/control. Do not tell the user to enable Chrome file URL access for that timeout alone.
- If \`chooser.setFiles(...)\` fails with a Chrome permission or native-host local-file access error, use \`chrome-file-upload-troubleshooting\`.
`,
    appliedMarkers: [
      "Chrome file chooser waits honor `timeoutMs`",
      "Do not tell the user to enable Chrome file URL access for that timeout alone",
      "Do not treat unreadable or empty `input.files`",
    ],
  },
  {
    label: "Chrome file upload troubleshooting scope",
    search: `# Chrome File Upload Troubleshooting
If file upload fails while setting files through a file chooser, tell the user exactly this:

\`To enable file upload, go to chrome://extensions in Chrome, click Details under the ChatGPT Chrome Extension, and enable "Allow access to file URLs." See [here](https://developers.openai.com/codex/app/chrome-extension#upload-files) for details.\`
`,
    replacement: `# Chrome File Upload Troubleshooting
Use this only after a chooser opened and \`chooser.setFiles(...)\` failed with a Chrome permission or native-host local-file access error.

Tell the user exactly this:

\`To enable file upload, go to chrome://extensions in Chrome, click Details under the ChatGPT Chrome Extension, and enable "Allow access to file URLs." See [here](https://developers.openai.com/codex/app/chrome-extension#upload-files) for details.\`

Do not use this permission prompt for \`waitForEvent("filechooser")\` timeouts. A chooser timeout means the page did not open a file chooser from the selected trigger; inspect the file input/control and try a better trigger or report the page-specific blocker.
`,
    appliedMarkers: [
      "Use this only after a chooser opened",
      "Do not use this permission prompt for `waitForEvent(\"filechooser\")` timeouts",
    ],
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

export function patchChromeFileUploadDocs(docsDir) {
  patchFile(path.join(docsDir, "file-uploads.md"), [CHROME_FILE_UPLOAD_DOC_PATCHES[0]], "Chrome file upload guidance");
  patchFile(
    path.join(docsDir, "chrome-file-upload-troubleshooting.md"),
    [CHROME_FILE_UPLOAD_DOC_PATCHES[1]],
    "Chrome file upload troubleshooting guidance",
  );
}
