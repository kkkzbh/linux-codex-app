import { FEATURE_MARKERS } from "../../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../../replace-utils.mjs";

function replaceAllOrThrow(source, searchValue, replacement, description) {
  if (source.includes(searchValue)) {
    return source.replaceAll(searchValue, replacement);
  }
  if (source.includes(replacement)) {
    return source;
  }
  throw new Error(`Failed to patch ${description}`);
}

function replaceRuntimeNameTokens(source) {
  return source
    .replaceAll("CODEX_NODE_REPL_PATH", "CODEX_BROWSER_AUTOMATION_PATH")
    .replaceAll("NODE_REPL", "BROWSER_AUTOMATION")
    .replaceAll("nodeRepl", "browserAutomation")
    .replaceAll("node_repl", "browser_automation")
    .replaceAll("Node REPL", "browser_automation")
    .replaceAll("node-repl", "browser-automation");
}

function replaceRequiredRuntimeNames(source, description) {
  let updated = source;
  updated = replaceAllOrThrow(
    updated,
    "nodeReplPath",
    "browserAutomationPath",
    `${description} browser automation runtime path`,
  );
  return replaceRuntimeNameTokens(updated);
}

export const browserAutomationRuntimeNameFeature = {
  id: "browser-automation-runtime-name",
  version: 1,
  requiredMarkers: FEATURE_MARKERS["browser-automation-runtime-name"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["browser-automation-runtime-name"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    return {
      ...bundleSources,
      main: replaceRuntimeNameTokens(bundleSources.main),
      worker: replaceRequiredRuntimeNames(bundleSources.worker, "worker browser automation runtime"),
      buildBrowserRuntimeSource: replaceRequiredRuntimeNames(
        bundleSources.buildBrowserRuntimeSource,
        "build browser automation runtime source",
      ),
      buildChromeNativeHostSource: replaceRuntimeNameTokens(bundleSources.buildChromeNativeHostSource),
      webviewCoreSource: replaceRequiredRuntimeNames(
        bundleSources.webviewCoreSource,
        "webview core source",
      ),
      webviewAppServerManagerSignals: replaceRuntimeNameTokens(bundleSources.webviewAppServerManagerSignals),
      webviewDebugModal: replaceRuntimeNameTokens(bundleSources.webviewDebugModal),
      webviewLocalConversationThread: replaceRuntimeNameTokens(bundleSources.webviewLocalConversationThread),
      webviewSplitItemsIntoRenderGroups: replaceOrThrow(
        replaceRuntimeNameTokens(bundleSources.webviewSplitItemsIntoRenderGroups),
        "e.invocation.server===`node_repl`",
        "e.invocation.server===`browser_automation`",
        "webview render group browser automation source grouping",
        { appliedMarkers: ["e.invocation.server===`browser_automation`"] },
      ),
    };
  },
  verify(bundleSources) {
    for (const [sourceKey, markers] of Object.entries(this.requiredMarkers)) {
      ensureMarkersPresent(
        bundleSources[sourceKey] ?? "",
        markers,
        `browser automation runtime name patch in ${sourceKey}`,
      );
    }
    for (const [sourceKey, markers] of Object.entries(this.forbiddenMarkers)) {
      ensureMarkersAbsent(
        bundleSources[sourceKey] ?? "",
        markers,
        `browser automation runtime name patch in ${sourceKey}`,
      );
    }
  },
  isApplied(bundleSources) {
    try {
      this.verify(bundleSources);
      return true;
    } catch {
      return false;
    }
  },
};
