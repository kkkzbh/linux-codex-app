const PRIVATE_BUNDLE = "private-bundle";

export const LINUX_PATCH_CONTRACTS = {
  "open-targets": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream exact registry anchors plus post-patch markers",
    risk: "high",
    reason: "The upstream open-target registry is private bundle state and has no stable external extension point.",
  },
  "directive-strip": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "regex-preserve-minified directive-regex replacement",
    risk: "medium",
    reason: "The hidden-directive sanitizer lives in the webview follow-up bundle.",
  },
  "markdown-local-media": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream exact renderer helper anchors plus CSP markers",
    risk: "high",
    reason: "Markdown media rendering and CSP are webview-private behavior.",
  },
  "local-image-cache-refresh": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "regex-preserve-minified query-option replacement",
    risk: "medium",
    reason: "Cache freshness is controlled inside bundled React query callsites.",
  },
  "conversation-local-images": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream exact structured-output case anchors",
    risk: "high",
    reason: "Conversation image projection is produced by private webview reducers.",
  },
  "conversation-model-selector": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "regex-preserve-minified model-settings cwd hook",
    risk: "medium",
    reason: "The start-screen model selector has no installer-owned external hook.",
  },
  preferences: {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "regex-preserve-minified main-process RPC handler insertion",
    risk: "medium",
    reason: "Preferred-app persistence is implemented in the Electron main bundle.",
  },
  "remote-control-device-key": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream exact device-key backend replacement",
    risk: "high",
    reason: "Remote-control enrollment calls the bundled native device-key backend directly.",
  },
  "remote-control-visibility": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "regex-preserve-minified remote-control UI gate replacement",
    risk: "medium",
    reason: "The visibility gates are compiled into webview feature modules.",
  },
  "native-titlebar": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream exact main IPC anchors plus preload bootstrap injection",
    risk: "high",
    reason: "Linux frameless-window behavior needs coordinated main/preload/webview changes.",
  },
  "settings-sidebar-surface": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream exact settings sidebar class anchor",
    risk: "medium",
    reason: "The standalone settings route sidebar is compiled into a private webview settings page chunk.",
  },
  "avatar-overlay-transparency": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream exact window/background style markers",
    risk: "medium",
    reason: "The avatar overlay is controlled by bundled window and webview styles.",
  },
  "working-sessions-status": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "regex-preserve-minified IPC initializer and tray-thread lifecycle hook",
    risk: "medium",
    reason: "The running-session count is only available inside the tray state update path.",
  },
  "browser-use": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "regex-preserve-minified feature-flag gate replacement",
    risk: "medium",
    reason: "Browser Use availability is gated in the Electron feature assembly.",
  },
  "remote-control-backend": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "regex-preserve-minified desktop capability assembly replacement",
    risk: "high",
    reason: "Remote-control backend capability selection is private main-process bundle logic.",
  },
  "browser-backend-registry": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream exact native-pipe server wrapper replacement",
    risk: "high",
    reason: "The in-app browser backend pipe is created inside private Electron runtime code.",
  },
  "browser-security": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream exact auth-fetch and approval bridge insertion",
    risk: "high",
    reason: "Browser security mediation spans private main-process sockets and webview client calls.",
  },
  "chrome-extension-status": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "regex-preserve-minified Chrome profile root branch",
    risk: "medium",
    reason: "The plugin installed-state probe reads platform-specific profile paths in the main bundle.",
  },
  "chrome-setup-url": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "regex-preserve-minified plugin setup URL and open-in-browser action markers",
    risk: "medium",
    reason: "The setup buttons are compiled webview plugin-install UI callsites.",
  },
  "plugin-mcp-reload": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream exact plugin install-flow anchors",
    risk: "medium",
    reason: "Plugin-installed MCP servers are loaded by the app-server, but plugin installation is handled in a private webview flow.",
  },
};

export function getLinuxPatchContract(feature) {
  return LINUX_PATCH_CONTRACTS[feature.id] ?? null;
}

export function describeLinuxPatchFeature(feature) {
  const contract = getLinuxPatchContract(feature);
  if (!contract) {
    throw new Error(`Missing Linux patch contract for feature: ${feature.id}`);
  }

  return {
    id: feature.id,
    version: feature.version,
    ...contract,
  };
}

export function assertLinuxPatchContracts(features) {
  const missing = features.filter((feature) => !getLinuxPatchContract(feature)).map((feature) => feature.id);
  if (missing.length > 0) {
    throw new Error(`Missing Linux patch contracts: ${missing.join(", ")}`);
  }
}
