import { FEATURE_MARKERS } from "../../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../../replace-utils.mjs";

const IDENTIFIER = String.raw`[$A-Z_a-z][$\w]*`;
const chromeSetupUrlBuilderRegex = new RegExp(
  String.raw`(?<chromeIcon>${IDENTIFIER})=\`assets\/google-chrome\.png\`,(?<extensionIdAsset>${IDENTIFIER})=\`scripts\/extension-id\.json\`,(?<urlBuilder>${IDENTIFIER})=\`https:\/\/chromewebstore\.google\.com\/detail\/codex\/\`,(?<browserSet>${IDENTIFIER})=(?<setFn>${IDENTIFIER})\(\[\`chrome\`,\`chrome-dev\`,\`chrome-internal\`\]\),`,
);
const chromeSetupUrlObjectRegex = new RegExp(
  String.raw`id:(?<extensionId>${IDENTIFIER}),name:\`Codex Chrome Extension\`,url:\`\$\{(?<urlBuilder>${IDENTIFIER})\}\$\{\k<extensionId>\}\``,
);
const installModalExternalOpenRegex = new RegExp(
  String.raw`onClick:\(\)=>\{(?<dispatcher>${IDENTIFIER})\.dispatchMessage\(\`open-in-browser\`,\{url:(?<plugin>${IDENTIFIER})\.url\}\)\},children:\(0,(?<jsx>${IDENTIFIER})\.jsx\)\((?<component>${IDENTIFIER}),\{id:\`plugins\.installModal\.openBrowserExtension\``,
);
const pluginDetailExternalOpenRegex = new RegExp(
  String.raw`onClick:\(\)=>\{(?<dispatcher>${IDENTIFIER})\.dispatchMessage\(\`open-in-browser\`,\{url:(?<plugin>${IDENTIFIER})\.url\}\)\},children:\(0,(?<jsx>${IDENTIFIER})\.jsx\)\((?<component>${IDENTIFIER}),\{id:\`plugins\.detail\.setup\.openBrowserExtension\``,
);

function groupsFor(args, description) {
  const groups = args.at(-1);
  if (!groups || typeof groups !== "object") {
    throw new Error(`${description} expected named regex groups`);
  }
  return groups;
}

function replaceChromeSetupUrlBuilder(...args) {
  const { chromeIcon, extensionIdAsset, urlBuilder, browserSet, setFn } = groupsFor(
    args,
    "Chrome setup URL builder patch",
  );
  return `${chromeIcon}=\`assets/google-chrome.png\`,${extensionIdAsset}=\`scripts/extension-id.json\`,${urlBuilder}=codexLinuxChromeWebStoreUrl=>\`https://chromewebstore.google.com/detail/codex/\${encodeURIComponent(codexLinuxChromeWebStoreUrl.trim())}\`,${browserSet}=${setFn}([\`chrome\`,\`chrome-dev\`,\`chrome-internal\`]),`;
}

function replaceChromeSetupUrlObject(...args) {
  const { extensionId, urlBuilder } = groupsFor(args, "Chrome setup URL object patch");
  return `id:${extensionId}.trim(),name:\`Codex Chrome Extension\`,url:${urlBuilder}(${extensionId})`;
}

function replaceExternalOpenClick(sourceId) {
  return (...args) => {
    const { dispatcher, plugin, jsx, component } = groupsFor(args, `${sourceId} external browser patch`);
    return `onClick:()=>{${dispatcher}.dispatchMessage(\`open-in-browser\`,{url:${plugin}.url,useExternalBrowser:!0,source:\`plugin_browser_extension_setup\`})},children:(0,${jsx}.jsx)(${component},{id:\`${sourceId}\``;
  };
}

export const chromeSetupUrlFeature = {
  id: "chrome-setup-url",
  version: 3,
  requiredMarkers: FEATURE_MARKERS["chrome-setup-url"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["chrome-setup-url"].forbiddenMarkers,
  apply(bundleSources, context) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let pluginAvailability = bundleSources.webviewPluginAvailability;
    let pluginDetail = bundleSources.webviewPluginDetail;
    const sharesPluginInstallFlowBundle =
      context?.webviewRemoteControlConnectionsVisibilityPath === context?.webviewPluginAvailabilityPath;

    pluginAvailability = replaceOrThrow(
      pluginAvailability,
      chromeSetupUrlBuilderRegex,
      replaceChromeSetupUrlBuilder,
      "Chrome Web Store setup URL builder",
      {
        appliedMarkers: ["https://chromewebstore.google.com/detail/codex/${encodeURIComponent"],
      },
    );

    pluginAvailability = replaceOrThrow(
      pluginAvailability,
      chromeSetupUrlObjectRegex,
      replaceChromeSetupUrlObject,
      "Chrome Web Store setup URL object",
      {
        appliedMarkers: [
          /id:[$A-Z_a-z][$\w]*\.trim\(\),name:`Codex Chrome Extension`,url:[$A-Z_a-z][$\w]*\([$A-Z_a-z][$\w]*\)/,
        ],
      },
    );

    pluginAvailability = replaceOrThrow(
      pluginAvailability,
      installModalExternalOpenRegex,
      replaceExternalOpenClick("plugins.installModal.openBrowserExtension"),
      "Chrome install modal external browser setup URL",
      {
        appliedMarkers: [
          /source:`plugin_browser_extension_setup`\}\)\},children:\(0,[$A-Z_a-z][$\w]*\.jsx\)\([$A-Z_a-z][$\w]*,\{id:`plugins\.installModal\.openBrowserExtension`/,
        ],
      },
    );

    pluginDetail = replaceOrThrow(
      pluginDetail,
      pluginDetailExternalOpenRegex,
      replaceExternalOpenClick("plugins.detail.setup.openBrowserExtension"),
      "Chrome plugin detail external browser setup URL",
      {
        appliedMarkers: [
          /source:`plugin_browser_extension_setup`\}\)\},children:\(0,[$A-Z_a-z][$\w]*\.jsx\)\([$A-Z_a-z][$\w]*,\{id:`plugins\.detail\.setup\.openBrowserExtension`/,
        ],
      },
    );

    return {
      ...bundleSources,
      webviewPluginAvailability: pluginAvailability,
      webviewRemoteControlConnectionsVisibility: sharesPluginInstallFlowBundle
        ? pluginAvailability
        : bundleSources.webviewRemoteControlConnectionsVisibility,
      webviewPluginDetail: pluginDetail,
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.webviewPluginAvailability,
      this.requiredMarkers.webviewPluginAvailability,
      "Chrome setup URL plugin availability patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewPluginAvailability,
      this.forbiddenMarkers.webviewPluginAvailability,
      "Chrome setup URL plugin availability patch",
    );
    ensureMarkersPresent(
      bundleSources.webviewPluginDetail,
      this.requiredMarkers.webviewPluginDetail,
      "Chrome setup URL plugin detail patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewPluginDetail,
      this.forbiddenMarkers.webviewPluginDetail,
      "Chrome setup URL plugin detail patch",
    );
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
