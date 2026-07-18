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
    return alternatives.some((requiredContent) => {
      if (requiredContent instanceof RegExp) {
        return requiredContent.test(source);
      }
      return source.includes(requiredContent);
    });
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
  const webviewJavaScriptBundlePattern = /^.+\.js$/;
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
    webviewJavaScriptBundlePattern,
    [["nodeReplPath", "browserAutomationPath"], ["nodeRepl.write", "browserAutomation.write"]],
    "webview core source",
  );
  const webviewBrowserSidebarRuntimePath = findAssetFileContainingGroups(
    webviewAssetsDir,
    /^.+\.js$/,
    [
      ["getBrowserStorageId(", "codexLinuxBrowserStorageId("],
      "getPagePersistence(",
      "renderer disposed browser sidebar webview",
    ],
    "webview Browser sidebar runtime",
  );
  const webviewAmbientSuggestionsEligibilityPath = findAssetFileContainingGroups(
    webviewAssetsDir,
    webviewJavaScriptBundlePattern,
    [
      /function [A-Za-z_$][\w$]*\(\{authMethod:[A-Za-z_$][\w$]*,email:[A-Za-z_$][\w$]*,plan:[A-Za-z_$][\w$]*\}\)\{return [A-Za-z_$][\w$]*===`apikey`\?!0:[A-Za-z_$][\w$]*===`chatgpt`\?/,
      /function [A-Za-z_$][\w$]*\(\{email:[A-Za-z_$][\w$]*,plan:[A-Za-z_$][\w$]*\}\)\{return [A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\)\|\|[A-Za-z_$][\w$]*\.some\([A-Za-z_$][\w$]*=>[A-Za-z_$][\w$]*===[A-Za-z_$][\w$]*\)\}/,
      [
        /\b[A-Za-z_$][\w$]*=\[`plus`,`pro`,`business`,`team`,`self_serve_business_usage_based`\]/,
        /\b[A-Za-z_$][\w$]*=\[`plus`,`pro`,`prolite`,`business`,`team`,`self_serve_business_usage_based`\]/,
      ],
    ],
    "webview ambient suggestions eligibility",
  );
  const webviewComposerPath = findAssetFile(
    webviewAssetsDir,
    /^composer-[^.]+\.js$/,
    "webview composer",
  );
  const webviewSettingsPagePath = findAssetFileContainingGroups(
    webviewAssetsDir,
    webviewJavaScriptBundlePattern,
    [
      [
        "app-shell-left-panel relative flex min-h-0 shrink-0 flex-col overflow-hidden",
        "app-shell-left-panel window-fx-sidebar-surface relative flex min-h-0 shrink-0 flex-col overflow-hidden",
      ],
    ],
    "webview settings page",
  );
  const webviewGeneralSettingsPath = findAssetFileContainingGroups(
    webviewAssetsDir,
    /^general-settings-[^.]+\.js$/,
    [
      "settings.agent.ambientSuggestions.rowLabel",
      "settings.agent.ambientSuggestions.toggleLabel",
      /if\(![A-Za-z_$][\w$]*\(\{authMethod:[A-Za-z_$][\w$]*,email:[A-Za-z_$][\w$]*\?\.[A-Za-z_$][\w$]*\?\?[A-Za-z_$][\w$]*,plan:[A-Za-z_$][\w$]*\?\.[A-Za-z_$][\w$]*\?\?[A-Za-z_$][\w$]*\}\)\)return null/,
      [
        /\b[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*\(`2425897452`\)/,
        /\b[A-Za-z_$][\w$]*=!0/,
      ],
    ],
    "webview general settings",
  );
  const webviewComputerUseSettingsPath = findAssetFile(
    webviewAssetsDir,
    /^computer-use-settings-[^.]+\.js$/,
    "webview computer use settings",
  );
  const webviewComputerUseProviderSettingsPath = findAssetFileContainingGroups(
    webviewAssetsDir,
    /^browser-use-settings-[^.]+\.js$/,
    [
      [
        "e.filter(e=>e.plugin.name===t||e.plugin.id.split(`@`)[0]===t",
        "plugin.name===`kde-computer-use`",
      ],
      "marketplaceName===`openai-curated`",
      "marketplacePath",
    ],
    "webview computer use provider settings",
  );
  const webviewBrowserProfileImportDialogPath = findAssetFile(
    webviewAssetsDir,
    /^browser-profile-import-dialog-[^.]+\.js$/,
    "webview browser profile import dialog",
  );
  const webviewPluginFeatureGatePath = findAssetFileContainingGroups(
    webviewAssetsDir,
    webviewJavaScriptBundlePattern,
    [
      [
        /function [A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*)\)\{return \1===`macOS`\|\|\1===`windows`\}/,
        /function [A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*)\)\{return \1===`macOS`\|\|\1===`windows`\|\|\1===`linux`\}/,
      ],
      [
        /isComputerUseGateEnabled:[A-Za-z_$][\w$]*,isHostCompatiblePlatform:[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\)/,
        /isComputerUseGateEnabled:[A-Za-z_$][\w$]*\|\|[A-Za-z_$][\w$]*===`linux`,isHostCompatiblePlatform:[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\)/,
      ],
      "featureName:`computer_use`",
    ],
    "webview plugin feature gate",
  );
  const webviewFollowUpPath = findAssetFileContainingGroups(
    webviewAssetsDir,
    webviewJavaScriptBundlePattern,
    ["case`steered`:", "type:`steered`", "case`imageGeneration`:", "type:`generated-image`"],
    "webview follow-up",
  );
  const webviewOpenTargetSelectionPath = findAssetFileContainingGroups(
    webviewAssetsDir,
    webviewJavaScriptBundlePattern,
    [
      "includeHiddenTargets",
      "e.filter(e=>e.target===`systemDefault`||e.target===`fileManager`)",
      "availableTargets",
    ],
    "webview open target selection",
  );
  const webviewOpenTargetNativeMenuPath = findAssetFileContainingGroups(
    webviewAssetsDir,
    webviewJavaScriptBundlePattern,
    [
      "data-tab-preview-pin-exempt",
      "targetPath",
      [
        /\(0,[A-Za-z_$][\w$]*\.jsx\)\([A-Za-z_$][\w$]*,\{awaitBeforeOpen:!1,getItems:[A-Za-z_$][\w$]*,onBeforeOpen:[A-Za-z_$][\w$]*,children:[A-Za-z_$][\w$]*\}\)/,
        /\(0,[A-Za-z_$][\w$]*\.jsx\)\([A-Za-z_$][\w$]*,\{awaitBeforeOpen:!0,getItems:[A-Za-z_$][\w$]*,onBeforeOpen:[A-Za-z_$][\w$]*,children:[A-Za-z_$][\w$]*\}\)/,
      ],
    ],
    "webview open target native menu",
  );
  const webviewOpenTargetResourceActionsPath = findAssetFileContainingGroups(
    webviewAssetsDir,
    webviewJavaScriptBundlePattern,
    [
      [
        /function [A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*)\)\{return \1\.target===`systemDefault`&&\1\.appPath!=null&&\1\.kind===`native`\}/,
        /function [A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*)\)\{return \1\.target===`systemDefault`&&\1\.kind===`native`\}/,
      ],
      [
        /function [A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*)\)\{return \1\.default===!0&&\1\.kind===`native`&&\1\.appPath!=null\}/,
        /function [A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*)\)\{return \1\.default===!0&&\1\.kind===`native`\}/,
      ],
      "localConversation.endResource.openIn",
    ],
    "webview open target resource actions",
  );
  const webviewLocalConversationThreadPath = findAssetFile(
    webviewAssetsDir,
    /^local-conversation-thread-[^.]+\.js$/,
    "webview local conversation thread",
  );
  const webviewGeneratedOutputArtifactsPath = findAssetFileContainingGroups(
    webviewAssetsDir,
    webviewJavaScriptBundlePattern,
    [
      "includeGeneratedImages",
      "projectlessOutputDirectory",
      "assistantContent",
      "turnArtifacts",
    ],
    "webview generated output artifacts",
  );
  const webviewMarkdownPath = findAssetFileContainingGroups(
    webviewAssetsDir,
    webviewJavaScriptBundlePattern,
    [
      ["read-file-binary", "codexLinuxMarkdownImageMimeType"],
      "markdown-media",
      "blockRemoteMedia",
      "mediaPresentation",
    ],
    "webview markdown",
  );
  const webviewPluginAvailabilityPath = findAssetFileContainingGroups(
    webviewAssetsDir,
    webviewJavaScriptBundlePattern,
    [
      "assets/google-chrome.png",
      "scripts/extension-id.json",
      "chromewebstore.google.com/detail/codex",
    ],
    "webview plugin availability",
  );
  const webviewAppServerManagerSignalsPath = findAssetFileContainingGroups(
    webviewAssetsDir,
    webviewJavaScriptBundlePattern,
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
    webviewJavaScriptBundlePattern,
    [
      "mcp-tool-call",
      ["invocation.server===`node_repl`", "invocation.server===`browser_automation`"],
      "case`commands`:return",
    ],
    "webview render group splitter",
  );
  const webviewPluginDetailPath = findAssetFileContaining(
    webviewAssetsDir,
    /^plugin-detail-page-[^.]+\.js$/,
    "plugins.detail.setup.openBrowserExtension",
    "webview plugin detail",
  );
  const bundleSourcePaths = Object.freeze({
    main: mainPath,
    preload: preloadPath,
    worker: workerPath,
    buildBrowserRuntimeSource: buildBrowserRuntimeSourcePath,
    buildChromeNativeHostSource: buildChromeNativeHostSourcePath,
    webviewHtml: webviewHtmlPath,
    webviewIndex: webviewIndexPath,
    webviewCoreSource: webviewCoreSourcePath,
    webviewBrowserSidebarRuntime: webviewBrowserSidebarRuntimePath,
    webviewAmbientSuggestionsEligibility: webviewAmbientSuggestionsEligibilityPath,
    webviewComposer: webviewComposerPath,
    webviewSettingsPage: webviewSettingsPagePath,
    webviewGeneralSettings: webviewGeneralSettingsPath,
    webviewComputerUseSettings: webviewComputerUseSettingsPath,
    webviewComputerUseProviderSettings: webviewComputerUseProviderSettingsPath,
    webviewBrowserProfileImportDialog: webviewBrowserProfileImportDialogPath,
    webviewPluginFeatureGate: webviewPluginFeatureGatePath,
    webviewFollowUp: webviewFollowUpPath,
    webviewOpenTargetSelection: webviewOpenTargetSelectionPath,
    webviewOpenTargetNativeMenu: webviewOpenTargetNativeMenuPath,
    webviewOpenTargetResourceActions: webviewOpenTargetResourceActionsPath,
    webviewLocalConversationThread: webviewLocalConversationThreadPath,
    webviewGeneratedOutputArtifacts: webviewGeneratedOutputArtifactsPath,
    webviewMarkdown: webviewMarkdownPath,
    webviewPluginAvailability: webviewPluginAvailabilityPath,
    webviewAppServerManagerSignals: webviewAppServerManagerSignalsPath,
    webviewDebugModal: webviewDebugModalPath,
    webviewSplitItemsIntoRenderGroups: webviewSplitItemsIntoRenderGroupsPath,
    webviewPluginDetail: webviewPluginDetailPath,
  });

  function syncSharedBundleSource(sources, sourceKey, source) {
    const sourcePath = bundleSourcePaths[sourceKey];
    if (sourcePath == null) {
      throw new Error(`Unknown bundle source key: ${sourceKey}`);
    }
    const syncedSources = { ...sources };
    for (const [key, filePath] of Object.entries(bundleSourcePaths)) {
      if (filePath === sourcePath && Object.hasOwn(syncedSources, key)) {
        syncedSources[key] = source;
      }
    }
    return syncedSources;
  }

  function assertSharedBundleSourcesInSync(sources) {
    const valuesByPath = new Map();
    for (const [key, filePath] of Object.entries(bundleSourcePaths)) {
      if (!Object.hasOwn(sources, key)) {
        continue;
      }
      const previous = valuesByPath.get(filePath);
      if (previous == null) {
        valuesByPath.set(filePath, { key, value: sources[key] });
      } else if (previous.value !== sources[key]) {
        throw new Error(`Expected shared bundle source keys to stay in sync: ${previous.key}, ${key}`);
      }
    }
  }

  return {
    extractedAppDir,
    buildDir,
    bundleSourcePaths,
    mainPath,
    preloadPath,
    workerPath,
    buildBrowserRuntimeSourcePath,
    buildChromeNativeHostSourcePath,
    webviewHtmlPath,
    webviewIndexPath,
    webviewCoreSourcePath,
    webviewBrowserSidebarRuntimePath,
    webviewAmbientSuggestionsEligibilityPath,
    webviewComposerPath,
    webviewSettingsPagePath,
    webviewGeneralSettingsPath,
    webviewComputerUseSettingsPath,
    webviewComputerUseProviderSettingsPath,
    webviewBrowserProfileImportDialogPath,
    webviewPluginFeatureGatePath,
    webviewFollowUpPath,
    webviewOpenTargetSelectionPath,
    webviewOpenTargetNativeMenuPath,
    webviewOpenTargetResourceActionsPath,
    webviewLocalConversationThreadPath,
    webviewGeneratedOutputArtifactsPath,
    webviewMarkdownPath,
    webviewPluginAvailabilityPath,
    webviewAppServerManagerSignalsPath,
    webviewDebugModalPath,
    webviewSplitItemsIntoRenderGroupsPath,
    webviewPluginDetailPath,
    syncSharedBundleSource,
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
    readWebviewBrowserSidebarRuntimeSource() {
      return readFileSync(webviewBrowserSidebarRuntimePath, "utf8");
    },
    writeWebviewBrowserSidebarRuntimeSource(source) {
      writeFileSync(webviewBrowserSidebarRuntimePath, source);
    },
    readWebviewAmbientSuggestionsEligibilitySource() {
      return readFileSync(webviewAmbientSuggestionsEligibilityPath, "utf8");
    },
    writeWebviewAmbientSuggestionsEligibilitySource(source) {
      writeFileSync(webviewAmbientSuggestionsEligibilityPath, source);
    },
    readWebviewHtmlSource() {
      return readFileSync(webviewHtmlPath, "utf8");
    },
    writeWebviewHtmlSource(source) {
      writeFileSync(webviewHtmlPath, source);
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
    readWebviewGeneralSettingsSource() {
      return readFileSync(webviewGeneralSettingsPath, "utf8");
    },
    writeWebviewGeneralSettingsSource(source) {
      writeFileSync(webviewGeneralSettingsPath, source);
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
    readWebviewBrowserProfileImportDialogSource() {
      return readFileSync(webviewBrowserProfileImportDialogPath, "utf8");
    },
    writeWebviewBrowserProfileImportDialogSource(source) {
      writeFileSync(webviewBrowserProfileImportDialogPath, source);
    },
    readWebviewPluginFeatureGateSource() {
      return readFileSync(webviewPluginFeatureGatePath, "utf8");
    },
    writeWebviewPluginFeatureGateSource(source) {
      writeFileSync(webviewPluginFeatureGatePath, source);
    },
    readWebviewFollowUpSource() {
      return readFileSync(webviewFollowUpPath, "utf8");
    },
    writeWebviewFollowUpSource(source) {
      writeFileSync(webviewFollowUpPath, source);
    },
    readWebviewOpenTargetSelectionSource() {
      return readFileSync(webviewOpenTargetSelectionPath, "utf8");
    },
    writeWebviewOpenTargetSelectionSource(source) {
      writeFileSync(webviewOpenTargetSelectionPath, source);
    },
    readWebviewOpenTargetNativeMenuSource() {
      return readFileSync(webviewOpenTargetNativeMenuPath, "utf8");
    },
    writeWebviewOpenTargetNativeMenuSource(source) {
      writeFileSync(webviewOpenTargetNativeMenuPath, source);
    },
    readWebviewOpenTargetResourceActionsSource() {
      return readFileSync(webviewOpenTargetResourceActionsPath, "utf8");
    },
    writeWebviewOpenTargetResourceActionsSource(source) {
      writeFileSync(webviewOpenTargetResourceActionsPath, source);
    },
    readWebviewLocalConversationThreadSource() {
      return readFileSync(webviewLocalConversationThreadPath, "utf8");
    },
    writeWebviewLocalConversationThreadSource(source) {
      writeFileSync(webviewLocalConversationThreadPath, source);
    },
    readWebviewGeneratedOutputArtifactsSource() {
      return readFileSync(webviewGeneratedOutputArtifactsPath, "utf8");
    },
    writeWebviewGeneratedOutputArtifactsSource(source) {
      writeFileSync(webviewGeneratedOutputArtifactsPath, source);
    },
    readWebviewMarkdownSource() {
      return readFileSync(webviewMarkdownPath, "utf8");
    },
    writeWebviewMarkdownSource(source) {
      writeFileSync(webviewMarkdownPath, source);
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
        webviewBrowserSidebarRuntime: readFileSync(webviewBrowserSidebarRuntimePath, "utf8"),
        webviewAmbientSuggestionsEligibility: readFileSync(
          webviewAmbientSuggestionsEligibilityPath,
          "utf8",
        ),
        webviewComposer: readFileSync(webviewComposerPath, "utf8"),
        webviewSettingsPage: readFileSync(webviewSettingsPagePath, "utf8"),
        webviewGeneralSettings: readFileSync(webviewGeneralSettingsPath, "utf8"),
        webviewComputerUseSettings: readFileSync(webviewComputerUseSettingsPath, "utf8"),
        webviewComputerUseProviderSettings: readFileSync(
          webviewComputerUseProviderSettingsPath,
          "utf8",
        ),
        webviewBrowserProfileImportDialog: readFileSync(
          webviewBrowserProfileImportDialogPath,
          "utf8",
        ),
        webviewPluginFeatureGate: readFileSync(webviewPluginFeatureGatePath, "utf8"),
        webviewFollowUp: readFileSync(webviewFollowUpPath, "utf8"),
        webviewOpenTargetSelection: readFileSync(webviewOpenTargetSelectionPath, "utf8"),
        webviewOpenTargetNativeMenu: readFileSync(webviewOpenTargetNativeMenuPath, "utf8"),
        webviewOpenTargetResourceActions: readFileSync(
          webviewOpenTargetResourceActionsPath,
          "utf8",
        ),
        webviewLocalConversationThread: readFileSync(webviewLocalConversationThreadPath, "utf8"),
        webviewGeneratedOutputArtifacts: readFileSync(
          webviewGeneratedOutputArtifactsPath,
          "utf8",
        ),
        webviewMarkdown: readFileSync(webviewMarkdownPath, "utf8"),
        webviewPluginAvailability: readFileSync(webviewPluginAvailabilityPath, "utf8"),
        webviewAppServerManagerSignals: readFileSync(webviewAppServerManagerSignalsPath, "utf8"),
        webviewDebugModal: readFileSync(webviewDebugModalPath, "utf8"),
        webviewSplitItemsIntoRenderGroups: readFileSync(
          webviewSplitItemsIntoRenderGroupsPath,
          "utf8",
        ),
        webviewPluginDetail: readFileSync(webviewPluginDetailPath, "utf8"),
      };
    },
    writeBundleSources(sources) {
      assertSharedBundleSourcesInSync(sources);

      writeFileSync(mainPath, sources.main);
      writeFileSync(preloadPath, sources.preload);
      writeFileSync(workerPath, sources.worker);
      writeFileSync(buildBrowserRuntimeSourcePath, sources.buildBrowserRuntimeSource);
      writeFileSync(buildChromeNativeHostSourcePath, sources.buildChromeNativeHostSource);
      writeFileSync(webviewHtmlPath, sources.webviewHtml);
      writeFileSync(webviewIndexPath, sources.webviewIndex);
      writeFileSync(webviewCoreSourcePath, sources.webviewCoreSource);
      writeFileSync(webviewBrowserSidebarRuntimePath, sources.webviewBrowserSidebarRuntime);
      writeFileSync(
        webviewAmbientSuggestionsEligibilityPath,
        sources.webviewAmbientSuggestionsEligibility,
      );
      writeFileSync(webviewComposerPath, sources.webviewComposer);
      writeFileSync(webviewSettingsPagePath, sources.webviewSettingsPage);
      writeFileSync(webviewGeneralSettingsPath, sources.webviewGeneralSettings);
      writeFileSync(webviewComputerUseSettingsPath, sources.webviewComputerUseSettings);
      writeFileSync(
        webviewComputerUseProviderSettingsPath,
        sources.webviewComputerUseProviderSettings,
      );
      writeFileSync(
        webviewBrowserProfileImportDialogPath,
        sources.webviewBrowserProfileImportDialog,
      );
      writeFileSync(webviewPluginFeatureGatePath, sources.webviewPluginFeatureGate);
      writeFileSync(webviewFollowUpPath, sources.webviewFollowUp);
      writeFileSync(webviewOpenTargetSelectionPath, sources.webviewOpenTargetSelection);
      writeFileSync(webviewOpenTargetNativeMenuPath, sources.webviewOpenTargetNativeMenu);
      writeFileSync(
        webviewOpenTargetResourceActionsPath,
        sources.webviewOpenTargetResourceActions,
      );
      writeFileSync(webviewLocalConversationThreadPath, sources.webviewLocalConversationThread);
      writeFileSync(
        webviewGeneratedOutputArtifactsPath,
        sources.webviewGeneratedOutputArtifacts,
      );
      writeFileSync(webviewMarkdownPath, sources.webviewMarkdown);
      writeFileSync(webviewPluginAvailabilityPath, sources.webviewPluginAvailability);
      writeFileSync(webviewAppServerManagerSignalsPath, sources.webviewAppServerManagerSignals);
      writeFileSync(webviewDebugModalPath, sources.webviewDebugModal);
      writeFileSync(webviewSplitItemsIntoRenderGroupsPath, sources.webviewSplitItemsIntoRenderGroups);
      writeFileSync(webviewPluginDetailPath, sources.webviewPluginDetail);
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
      this.verifyJavaScript(webviewBrowserSidebarRuntimePath);
      this.verifyJavaScript(webviewAmbientSuggestionsEligibilityPath);
      this.verifyJavaScript(webviewComposerPath);
      this.verifyJavaScript(webviewSettingsPagePath);
      this.verifyJavaScript(webviewGeneralSettingsPath);
      this.verifyJavaScript(webviewComputerUseSettingsPath);
      this.verifyJavaScript(webviewComputerUseProviderSettingsPath);
      this.verifyJavaScript(webviewBrowserProfileImportDialogPath);
      this.verifyJavaScript(webviewPluginFeatureGatePath);
      this.verifyJavaScript(webviewFollowUpPath);
      this.verifyJavaScript(webviewOpenTargetSelectionPath);
      this.verifyJavaScript(webviewOpenTargetNativeMenuPath);
      this.verifyJavaScript(webviewOpenTargetResourceActionsPath);
      this.verifyJavaScript(webviewLocalConversationThreadPath);
      this.verifyJavaScript(webviewGeneratedOutputArtifactsPath);
      this.verifyJavaScript(webviewMarkdownPath);
      this.verifyJavaScript(webviewPluginAvailabilityPath);
      this.verifyJavaScript(webviewAppServerManagerSignalsPath);
      this.verifyJavaScript(webviewDebugModalPath);
      this.verifyJavaScript(webviewSplitItemsIntoRenderGroupsPath);
      this.verifyJavaScript(webviewPluginDetailPath);
    },
  };
}
