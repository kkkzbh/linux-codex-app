import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function findAssetFile(baseDir, pattern, description) {
  const fileName = readdirSync(baseDir).find((entry) => pattern.test(entry));

  if (!fileName) {
    throw new Error(`Expected ${description} bundle not found in: ${baseDir}`);
  }

  return path.join(baseDir, fileName);
}

function findAssetFileContaining(baseDir, pattern, requiredContent, description) {
  const fileNames = readdirSync(baseDir).filter((entry) => pattern.test(entry));
  const fileName = fileNames.find((entry) => {
    const source = readFileSync(path.join(baseDir, entry), "utf8");
    return source.includes(requiredContent);
  });

  if (!fileName) {
    throw new Error(`Expected ${description} bundle not found in: ${baseDir}`);
  }

  return path.join(baseDir, fileName);
}

function matchesContentGroups(source, requiredContentGroups) {
  return requiredContentGroups.every((group) => {
    const alternatives = Array.isArray(group) ? group : [group];
    return alternatives.some((requiredContent) => source.includes(requiredContent));
  });
}

function findAssetFileContainingGroups(baseDir, pattern, requiredContentGroups, description) {
  const fileNames = readdirSync(baseDir).filter((entry) => pattern.test(entry));
  const matches = fileNames.filter((entry) => {
    const source = readFileSync(path.join(baseDir, entry), "utf8");
    return matchesContentGroups(source, requiredContentGroups);
  });

  if (matches.length === 0) {
    throw new Error(`Expected ${description} bundle not found in: ${baseDir}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Expected exactly one ${description} bundle in ${baseDir}; matched: ${matches.join(", ")}`,
    );
  }

  return path.join(baseDir, matches[0]);
}

export function createLinuxPatchContext(extractedAppDir) {
  if (!extractedAppDir) {
    throw new Error("Expected extracted app directory");
  }

  const buildDir = path.join(extractedAppDir, ".vite", "build");
  const webviewDir = path.join(extractedAppDir, "webview");
  const webviewAssetsDir = path.join(extractedAppDir, "webview", "assets");
  const webviewHtmlPath = path.join(webviewDir, "index.html");
  const mainPath = findAssetFile(buildDir, /^main(?:-[^.]+)?\.js$/, "main");
  const preloadPath = findAssetFile(buildDir, /^preload(?:-[^.]+)?\.js$/, "preload");
  const workerPath = findAssetFile(buildDir, /^worker\.js$/, "worker");
  const buildBrowserRuntimeSourcePath = findAssetFileContainingGroups(
    buildDir,
    /^src-[^.]+\.js$/,
    [
      "mcp_servers.${",
      ["node_repl", "browser_automation"],
      ["nodeReplPath", "browserAutomationPath"],
      ["NODE_REPL_NODE_PATH", "BROWSER_AUTOMATION_NODE_PATH"],
    ],
    "build browser runtime source",
  );
  const buildChromeNativeHostSourcePath = findAssetFileContainingGroups(
    buildDir,
    /^src-[^.]+\.js$/,
    [
      ["chrome-native", "browser_automation"],
      ["NativeMessaging", "browserAutomationPath"],
      ["nodeReplPath", "browserAutomationPath"],
      ["NODE_REPL_NODE_PATH", "BROWSER_AUTOMATION_NODE_PATH"],
    ],
    "build Chrome native host source",
  );
  const webviewIndexPath = findAssetFile(webviewAssetsDir, /^index-[^.]+\.js$/, "webview index");
  const webviewCoreSourcePath = findAssetFileContainingGroups(
    webviewAssetsDir,
    /^src-[^.]+\.js$/,
    [["nodeReplPath", "browserAutomationPath"], ["nodeRepl.write", "browserAutomation.write"]],
    "webview core source",
  );
  const webviewCollaborationModePath = findAssetFile(
    webviewAssetsDir,
    /^use-model-settings-[^.]+\.js$/,
    "webview collaboration mode",
  );
  const webviewComposerPath = findAssetFile(
    webviewAssetsDir,
    /^composer-[^.]+\.js$/,
    "webview composer",
  );
  const webviewSettingsPagePath = findAssetFile(
    webviewAssetsDir,
    /^settings-page-[^.]+\.js$/,
    "webview settings page",
  );
  const webviewComputerUseSettingsPath = findAssetFile(
    webviewAssetsDir,
    /^computer-use-settings-[^.]+\.js$/,
    "webview computer use settings",
  );
  const webviewComputerUseProviderSettingsPath = findAssetFileContaining(
    webviewAssetsDir,
    /^browser-use-settings-[^.]+\.js$/,
    "r.find(e=>O(e.marketplaceName))??r.find(e=>e.marketplaceName===`openai-curated`)",
    "webview computer use provider settings",
  );
  const webviewPluginFeatureGatePath = findAssetFile(
    webviewAssetsDir,
    /^use-is-plugins-enabled-[^.]+\.js$/,
    "webview plugin feature gate",
  );
  const webviewAppShellPath = findAssetFile(
    webviewAssetsDir,
    /^app-shell-[^.]+\.js$/,
    "webview app shell",
  );
  const webviewFollowUpPath = findAssetFileContaining(
    webviewAssetsDir,
    /^[^.]+\.js$/,
    "case`steered`:a.push({type:`steered`",
    "webview follow-up",
  );
  const webviewLocalConversationThreadPath = findAssetFile(
    webviewAssetsDir,
    /^local-conversation-thread-[^.]+\.js$/,
    "webview local conversation thread",
  );
  const webviewMarkdownPath = findAssetFileContaining(
    webviewAssetsDir,
    /^markdown-[^.]+\.js$/,
    "read-file-binary",
    "webview markdown",
  );
  const webviewUsePluginsPath = findAssetFileContaining(
    webviewAssetsDir,
    /^use-plugins-[^.]+\.js$/,
    "read-file-binary",
    "webview plugin/local image helper",
  );
  const webviewDiffAnnotationsPath = findAssetFileContaining(
    webviewAssetsDir,
    /^use-diff-annotations-[^.]+\.js$/,
    "read-file",
    "webview diff annotations",
  );
  const webviewAvatarOverlayPath = findAssetFile(
    webviewAssetsDir,
    /^avatar-overlay-page-[^.]+\.js$/,
    "webview avatar overlay",
  );
  const webviewPluginAvailabilityPath = findAssetFileContaining(
    webviewAssetsDir,
    /^use-plugin-install-flow-[^.]+\.js$/,
    "plugins.installModal.openBrowserExtension",
    "webview plugin availability",
  );
  const webviewAppServerManagerSignalsPath = findAssetFileContainingGroups(
    webviewAssetsDir,
    /^app-server-manager-signals-[^.]+\.js$/,
    [["node-repl-active-execs-kill", "browser-automation-active-execs-kill"], ["node_repl", "browser_automation"]],
    "webview app server manager signals",
  );
  const webviewDebugModalPath = findAssetFileContainingGroups(
    webviewAssetsDir,
    /^debug-modal-[^.]+\.js$/,
    [["node_repl", "browser_automation"], ["Node REPL", "browser_automation"]],
    "webview debug modal",
  );
  const webviewSplitItemsIntoRenderGroupsPath = findAssetFileContainingGroups(
    webviewAssetsDir,
    /^split-items-into-render-groups-[^.]+\.js$/,
    [["e.invocation.server===`node_repl`", "e.invocation.server===`browser_automation`"]],
    "webview render group splitter",
  );
  const webviewPluginDetailPath = findAssetFileContaining(
    webviewAssetsDir,
    /^plugin-detail-page-[^.]+\.js$/,
    "plugins.detail.setup.openBrowserExtension",
    "webview plugin detail",
  );
  const webviewRemoteConnectionVisibilityPath = findAssetFile(
    webviewAssetsDir,
    /^remote-connection-visibility-[^.]+\.js$/,
    "webview remote connection visibility",
  );
  const webviewRemoteControlConnectionsVisibilityPath = webviewPluginAvailabilityPath;

  return {
    extractedAppDir,
    buildDir,
    mainPath,
    preloadPath,
    workerPath,
    buildBrowserRuntimeSourcePath,
    buildChromeNativeHostSourcePath,
    webviewHtmlPath,
    webviewIndexPath,
    webviewCoreSourcePath,
    webviewCollaborationModePath,
    webviewComposerPath,
    webviewSettingsPagePath,
    webviewComputerUseSettingsPath,
    webviewComputerUseProviderSettingsPath,
    webviewPluginFeatureGatePath,
    webviewAppShellPath,
    webviewFollowUpPath,
    webviewLocalConversationThreadPath,
    webviewMarkdownPath,
    webviewUsePluginsPath,
    webviewDiffAnnotationsPath,
    webviewAvatarOverlayPath,
    webviewPluginAvailabilityPath,
    webviewAppServerManagerSignalsPath,
    webviewDebugModalPath,
    webviewSplitItemsIntoRenderGroupsPath,
    webviewPluginDetailPath,
    webviewRemoteConnectionVisibilityPath,
    webviewRemoteControlConnectionsVisibilityPath,
    readMainSource() {
      return readFileSync(mainPath, "utf8");
    },
    writeMainSource(source) {
      writeFileSync(mainPath, source);
    },
    readPreloadSource() {
      return readFileSync(preloadPath, "utf8");
    },
    writePreloadSource(source) {
      writeFileSync(preloadPath, source);
    },
    readWorkerSource() {
      return readFileSync(workerPath, "utf8");
    },
    writeWorkerSource(source) {
      writeFileSync(workerPath, source);
    },
    readBuildBrowserRuntimeSource() {
      return readFileSync(buildBrowserRuntimeSourcePath, "utf8");
    },
    writeBuildBrowserRuntimeSource(source) {
      writeFileSync(buildBrowserRuntimeSourcePath, source);
    },
    readBuildChromeNativeHostSource() {
      return readFileSync(buildChromeNativeHostSourcePath, "utf8");
    },
    writeBuildChromeNativeHostSource(source) {
      writeFileSync(buildChromeNativeHostSourcePath, source);
    },
    readWebviewIndexSource() {
      return readFileSync(webviewIndexPath, "utf8");
    },
    writeWebviewIndexSource(source) {
      writeFileSync(webviewIndexPath, source);
    },
    readWebviewCoreSourceSource() {
      return readFileSync(webviewCoreSourcePath, "utf8");
    },
    writeWebviewCoreSourceSource(source) {
      writeFileSync(webviewCoreSourcePath, source);
    },
    readWebviewHtmlSource() {
      return readFileSync(webviewHtmlPath, "utf8");
    },
    writeWebviewHtmlSource(source) {
      writeFileSync(webviewHtmlPath, source);
    },
    readWebviewModelSettingsSource() {
      return readFileSync(webviewCollaborationModePath, "utf8");
    },
    writeWebviewModelSettingsSource(source) {
      writeFileSync(webviewCollaborationModePath, source);
    },
    readWebviewComposerSource() {
      return readFileSync(webviewComposerPath, "utf8");
    },
    writeWebviewComposerSource(source) {
      writeFileSync(webviewComposerPath, source);
    },
    readWebviewSettingsPageSource() {
      return readFileSync(webviewSettingsPagePath, "utf8");
    },
    writeWebviewSettingsPageSource(source) {
      writeFileSync(webviewSettingsPagePath, source);
    },
    readWebviewComputerUseSettingsSource() {
      return readFileSync(webviewComputerUseSettingsPath, "utf8");
    },
    writeWebviewComputerUseSettingsSource(source) {
      writeFileSync(webviewComputerUseSettingsPath, source);
    },
    readWebviewComputerUseProviderSettingsSource() {
      return readFileSync(webviewComputerUseProviderSettingsPath, "utf8");
    },
    writeWebviewComputerUseProviderSettingsSource(source) {
      writeFileSync(webviewComputerUseProviderSettingsPath, source);
    },
    readWebviewPluginFeatureGateSource() {
      return readFileSync(webviewPluginFeatureGatePath, "utf8");
    },
    writeWebviewPluginFeatureGateSource(source) {
      writeFileSync(webviewPluginFeatureGatePath, source);
    },
    readWebviewAppShellSource() {
      return readFileSync(webviewAppShellPath, "utf8");
    },
    writeWebviewAppShellSource(source) {
      writeFileSync(webviewAppShellPath, source);
    },
    readWebviewFollowUpSource() {
      return readFileSync(webviewFollowUpPath, "utf8");
    },
    writeWebviewFollowUpSource(source) {
      writeFileSync(webviewFollowUpPath, source);
    },
    readWebviewLocalConversationThreadSource() {
      return readFileSync(webviewLocalConversationThreadPath, "utf8");
    },
    writeWebviewLocalConversationThreadSource(source) {
      writeFileSync(webviewLocalConversationThreadPath, source);
    },
    readWebviewMarkdownSource() {
      return readFileSync(webviewMarkdownPath, "utf8");
    },
    writeWebviewMarkdownSource(source) {
      writeFileSync(webviewMarkdownPath, source);
    },
    readWebviewUsePluginsSource() {
      return readFileSync(webviewUsePluginsPath, "utf8");
    },
    writeWebviewUsePluginsSource(source) {
      writeFileSync(webviewUsePluginsPath, source);
    },
    readWebviewDiffAnnotationsSource() {
      return readFileSync(webviewDiffAnnotationsPath, "utf8");
    },
    writeWebviewDiffAnnotationsSource(source) {
      writeFileSync(webviewDiffAnnotationsPath, source);
    },
    readWebviewAvatarOverlaySource() {
      return readFileSync(webviewAvatarOverlayPath, "utf8");
    },
    writeWebviewAvatarOverlaySource(source) {
      writeFileSync(webviewAvatarOverlayPath, source);
    },
    readWebviewPluginAvailabilitySource() {
      return readFileSync(webviewPluginAvailabilityPath, "utf8");
    },
    writeWebviewPluginAvailabilitySource(source) {
      writeFileSync(webviewPluginAvailabilityPath, source);
    },
    readWebviewAppServerManagerSignalsSource() {
      return readFileSync(webviewAppServerManagerSignalsPath, "utf8");
    },
    writeWebviewAppServerManagerSignalsSource(source) {
      writeFileSync(webviewAppServerManagerSignalsPath, source);
    },
    readWebviewDebugModalSource() {
      return readFileSync(webviewDebugModalPath, "utf8");
    },
    writeWebviewDebugModalSource(source) {
      writeFileSync(webviewDebugModalPath, source);
    },
    readWebviewSplitItemsIntoRenderGroupsSource() {
      return readFileSync(webviewSplitItemsIntoRenderGroupsPath, "utf8");
    },
    writeWebviewSplitItemsIntoRenderGroupsSource(source) {
      writeFileSync(webviewSplitItemsIntoRenderGroupsPath, source);
    },
    readWebviewPluginDetailSource() {
      return readFileSync(webviewPluginDetailPath, "utf8");
    },
    writeWebviewPluginDetailSource(source) {
      writeFileSync(webviewPluginDetailPath, source);
    },
    readWebviewRemoteConnectionVisibilitySource() {
      return readFileSync(webviewRemoteConnectionVisibilityPath, "utf8");
    },
    writeWebviewRemoteConnectionVisibilitySource(source) {
      writeFileSync(webviewRemoteConnectionVisibilityPath, source);
    },
    readWebviewRemoteControlConnectionsVisibilitySource() {
      return readFileSync(webviewRemoteControlConnectionsVisibilityPath, "utf8");
    },
    writeWebviewRemoteControlConnectionsVisibilitySource(source) {
      writeFileSync(webviewRemoteControlConnectionsVisibilityPath, source);
    },
    readBundleSources() {
      return {
        main: readFileSync(mainPath, "utf8"),
        preload: readFileSync(preloadPath, "utf8"),
        worker: readFileSync(workerPath, "utf8"),
        buildBrowserRuntimeSource: readFileSync(buildBrowserRuntimeSourcePath, "utf8"),
        buildChromeNativeHostSource: readFileSync(buildChromeNativeHostSourcePath, "utf8"),
        webviewHtml: readFileSync(webviewHtmlPath, "utf8"),
        webviewIndex: readFileSync(webviewIndexPath, "utf8"),
        webviewCoreSource: readFileSync(webviewCoreSourcePath, "utf8"),
        webviewModelSettings: readFileSync(webviewCollaborationModePath, "utf8"),
        webviewComposer: readFileSync(webviewComposerPath, "utf8"),
        webviewSettingsPage: readFileSync(webviewSettingsPagePath, "utf8"),
        webviewComputerUseSettings: readFileSync(webviewComputerUseSettingsPath, "utf8"),
        webviewComputerUseProviderSettings: readFileSync(
          webviewComputerUseProviderSettingsPath,
          "utf8",
        ),
        webviewPluginFeatureGate: readFileSync(webviewPluginFeatureGatePath, "utf8"),
        webviewAppShell: readFileSync(webviewAppShellPath, "utf8"),
        webviewFollowUp: readFileSync(webviewFollowUpPath, "utf8"),
        webviewLocalConversationThread: readFileSync(webviewLocalConversationThreadPath, "utf8"),
        webviewMarkdown: readFileSync(webviewMarkdownPath, "utf8"),
        webviewUsePlugins: readFileSync(webviewUsePluginsPath, "utf8"),
        webviewDiffAnnotations: readFileSync(webviewDiffAnnotationsPath, "utf8"),
        webviewAvatarOverlay: readFileSync(webviewAvatarOverlayPath, "utf8"),
        webviewPluginAvailability: readFileSync(webviewPluginAvailabilityPath, "utf8"),
        webviewAppServerManagerSignals: readFileSync(webviewAppServerManagerSignalsPath, "utf8"),
        webviewDebugModal: readFileSync(webviewDebugModalPath, "utf8"),
        webviewSplitItemsIntoRenderGroups: readFileSync(
          webviewSplitItemsIntoRenderGroupsPath,
          "utf8",
        ),
        webviewPluginDetail: readFileSync(webviewPluginDetailPath, "utf8"),
        webviewRemoteConnectionVisibility: readFileSync(webviewRemoteConnectionVisibilityPath, "utf8"),
        webviewRemoteControlConnectionsVisibility: readFileSync(
          webviewRemoteControlConnectionsVisibilityPath,
          "utf8",
        ),
      };
    },
    writeBundleSources(sources) {
      if (
        webviewPluginAvailabilityPath === webviewRemoteControlConnectionsVisibilityPath &&
        sources.webviewPluginAvailability !== sources.webviewRemoteControlConnectionsVisibility
      ) {
        throw new Error(
          "Expected shared webview plugin availability and remote-control visibility sources to stay in sync",
        );
      }
      if (
        buildBrowserRuntimeSourcePath === buildChromeNativeHostSourcePath &&
        sources.buildBrowserRuntimeSource !== sources.buildChromeNativeHostSource
      ) {
        throw new Error(
          "Expected shared build browser runtime and Chrome native host sources to stay in sync",
        );
      }

      writeFileSync(mainPath, sources.main);
      writeFileSync(preloadPath, sources.preload);
      writeFileSync(workerPath, sources.worker);
      writeFileSync(buildBrowserRuntimeSourcePath, sources.buildBrowserRuntimeSource);
      writeFileSync(buildChromeNativeHostSourcePath, sources.buildChromeNativeHostSource);
      writeFileSync(webviewHtmlPath, sources.webviewHtml);
      writeFileSync(webviewIndexPath, sources.webviewIndex);
      writeFileSync(webviewCoreSourcePath, sources.webviewCoreSource);
      writeFileSync(webviewCollaborationModePath, sources.webviewModelSettings);
      writeFileSync(webviewComposerPath, sources.webviewComposer);
      writeFileSync(webviewSettingsPagePath, sources.webviewSettingsPage);
      writeFileSync(webviewComputerUseSettingsPath, sources.webviewComputerUseSettings);
      writeFileSync(
        webviewComputerUseProviderSettingsPath,
        sources.webviewComputerUseProviderSettings,
      );
      writeFileSync(webviewPluginFeatureGatePath, sources.webviewPluginFeatureGate);
      writeFileSync(webviewAppShellPath, sources.webviewAppShell);
      writeFileSync(webviewFollowUpPath, sources.webviewFollowUp);
      writeFileSync(webviewLocalConversationThreadPath, sources.webviewLocalConversationThread);
      writeFileSync(webviewMarkdownPath, sources.webviewMarkdown);
      writeFileSync(webviewUsePluginsPath, sources.webviewUsePlugins);
      writeFileSync(webviewDiffAnnotationsPath, sources.webviewDiffAnnotations);
      writeFileSync(webviewAvatarOverlayPath, sources.webviewAvatarOverlay);
      writeFileSync(webviewPluginAvailabilityPath, sources.webviewPluginAvailability);
      writeFileSync(webviewAppServerManagerSignalsPath, sources.webviewAppServerManagerSignals);
      writeFileSync(webviewDebugModalPath, sources.webviewDebugModal);
      writeFileSync(webviewSplitItemsIntoRenderGroupsPath, sources.webviewSplitItemsIntoRenderGroups);
      writeFileSync(webviewPluginDetailPath, sources.webviewPluginDetail);
      writeFileSync(webviewRemoteConnectionVisibilityPath, sources.webviewRemoteConnectionVisibility);
      writeFileSync(
        webviewRemoteControlConnectionsVisibilityPath,
        sources.webviewRemoteControlConnectionsVisibility,
      );
    },
    verifyJavaScript(filePath = mainPath) {
      const result = spawnSync(process.execPath, ["--check", filePath], {
        encoding: "utf8",
      });

      if (result.status === 0) {
        return;
      }

      const stderr = result.stderr?.trim() || result.stdout?.trim() || "Syntax check failed";
      throw new Error(`Patched bundle syntax check failed for ${filePath}\n${stderr}`);
    },
    verifyBundleSyntax() {
      this.verifyJavaScript(mainPath);
      this.verifyJavaScript(preloadPath);
      this.verifyJavaScript(workerPath);
      this.verifyJavaScript(buildBrowserRuntimeSourcePath);
      this.verifyJavaScript(buildChromeNativeHostSourcePath);
      this.verifyJavaScript(webviewIndexPath);
      this.verifyJavaScript(webviewCoreSourcePath);
      this.verifyJavaScript(webviewCollaborationModePath);
      this.verifyJavaScript(webviewComposerPath);
      this.verifyJavaScript(webviewSettingsPagePath);
      this.verifyJavaScript(webviewComputerUseSettingsPath);
      this.verifyJavaScript(webviewComputerUseProviderSettingsPath);
      this.verifyJavaScript(webviewPluginFeatureGatePath);
      this.verifyJavaScript(webviewAppShellPath);
      this.verifyJavaScript(webviewFollowUpPath);
      this.verifyJavaScript(webviewLocalConversationThreadPath);
      this.verifyJavaScript(webviewMarkdownPath);
      this.verifyJavaScript(webviewUsePluginsPath);
      this.verifyJavaScript(webviewDiffAnnotationsPath);
      this.verifyJavaScript(webviewAvatarOverlayPath);
      this.verifyJavaScript(webviewPluginAvailabilityPath);
      this.verifyJavaScript(webviewAppServerManagerSignalsPath);
      this.verifyJavaScript(webviewDebugModalPath);
      this.verifyJavaScript(webviewSplitItemsIntoRenderGroupsPath);
      this.verifyJavaScript(webviewPluginDetailPath);
      this.verifyJavaScript(webviewRemoteConnectionVisibilityPath);
      this.verifyJavaScript(webviewRemoteControlConnectionsVisibilityPath);
    },
  };
}
