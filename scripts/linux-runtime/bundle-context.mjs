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
  const webviewIndexPath = findAssetFile(webviewAssetsDir, /^index-[^.]+\.js$/, "webview index");
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
    webviewHtmlPath,
    webviewIndexPath,
    webviewCollaborationModePath,
    webviewComposerPath,
    webviewSettingsPagePath,
    webviewAppShellPath,
    webviewFollowUpPath,
    webviewLocalConversationThreadPath,
    webviewMarkdownPath,
    webviewUsePluginsPath,
    webviewDiffAnnotationsPath,
    webviewAvatarOverlayPath,
    webviewPluginAvailabilityPath,
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
    readWebviewIndexSource() {
      return readFileSync(webviewIndexPath, "utf8");
    },
    writeWebviewIndexSource(source) {
      writeFileSync(webviewIndexPath, source);
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
        webviewHtml: readFileSync(webviewHtmlPath, "utf8"),
        webviewIndex: readFileSync(webviewIndexPath, "utf8"),
        webviewModelSettings: readFileSync(webviewCollaborationModePath, "utf8"),
        webviewComposer: readFileSync(webviewComposerPath, "utf8"),
        webviewSettingsPage: readFileSync(webviewSettingsPagePath, "utf8"),
        webviewAppShell: readFileSync(webviewAppShellPath, "utf8"),
        webviewFollowUp: readFileSync(webviewFollowUpPath, "utf8"),
        webviewLocalConversationThread: readFileSync(webviewLocalConversationThreadPath, "utf8"),
        webviewMarkdown: readFileSync(webviewMarkdownPath, "utf8"),
        webviewUsePlugins: readFileSync(webviewUsePluginsPath, "utf8"),
        webviewDiffAnnotations: readFileSync(webviewDiffAnnotationsPath, "utf8"),
        webviewAvatarOverlay: readFileSync(webviewAvatarOverlayPath, "utf8"),
        webviewPluginAvailability: readFileSync(webviewPluginAvailabilityPath, "utf8"),
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

      writeFileSync(mainPath, sources.main);
      writeFileSync(preloadPath, sources.preload);
      writeFileSync(webviewHtmlPath, sources.webviewHtml);
      writeFileSync(webviewIndexPath, sources.webviewIndex);
      writeFileSync(webviewCollaborationModePath, sources.webviewModelSettings);
      writeFileSync(webviewComposerPath, sources.webviewComposer);
      writeFileSync(webviewSettingsPagePath, sources.webviewSettingsPage);
      writeFileSync(webviewAppShellPath, sources.webviewAppShell);
      writeFileSync(webviewFollowUpPath, sources.webviewFollowUp);
      writeFileSync(webviewLocalConversationThreadPath, sources.webviewLocalConversationThread);
      writeFileSync(webviewMarkdownPath, sources.webviewMarkdown);
      writeFileSync(webviewUsePluginsPath, sources.webviewUsePlugins);
      writeFileSync(webviewDiffAnnotationsPath, sources.webviewDiffAnnotations);
      writeFileSync(webviewAvatarOverlayPath, sources.webviewAvatarOverlay);
      writeFileSync(webviewPluginAvailabilityPath, sources.webviewPluginAvailability);
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
      this.verifyJavaScript(webviewIndexPath);
      this.verifyJavaScript(webviewCollaborationModePath);
      this.verifyJavaScript(webviewComposerPath);
      this.verifyJavaScript(webviewSettingsPagePath);
      this.verifyJavaScript(webviewAppShellPath);
      this.verifyJavaScript(webviewFollowUpPath);
      this.verifyJavaScript(webviewLocalConversationThreadPath);
      this.verifyJavaScript(webviewMarkdownPath);
      this.verifyJavaScript(webviewUsePluginsPath);
      this.verifyJavaScript(webviewDiffAnnotationsPath);
      this.verifyJavaScript(webviewAvatarOverlayPath);
      this.verifyJavaScript(webviewPluginAvailabilityPath);
      this.verifyJavaScript(webviewPluginDetailPath);
      this.verifyJavaScript(webviewRemoteConnectionVisibilityPath);
      this.verifyJavaScript(webviewRemoteControlConnectionsVisibilityPath);
    },
  };
}
