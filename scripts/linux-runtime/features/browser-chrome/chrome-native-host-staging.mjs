import { FEATURE_MARKERS } from "../../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../../replace-utils.mjs";

const MINIFIED_IDENTIFIER = String.raw`[$A-Z_a-z][$\w]*`;
const INSTALL_NATIVE_HOST_CALL = new RegExp(
  String.raw`await (?<install>${MINIFIED_IDENTIFIER})\(\{codexHome:(?<request>${MINIFIED_IDENTIFIER})\.codexHome,devRuntimeRepoRoot:\k<request>\.devRuntimeRepoRoot,extensionId:await (?<readExtensionId>${MINIFIED_IDENTIFIER})\((?<cacheRoot>${MINIFIED_IDENTIFIER})\),nativeHostName:(?<nativeHostName>${MINIFIED_IDENTIFIER}),pluginVersion:(?<manifest>${MINIFIED_IDENTIFIER})\.version,pluginRoot:\k<cacheRoot>,resourcesPath:\k<request>\.resourcesPath\}\)`,
);
const INSTALL_NATIVE_HOST_START = new RegExp(
  String.raw`async function (?<install>${MINIFIED_IDENTIFIER})\((?<options>${MINIFIED_IDENTIFIER})\)\{let (?<target>${MINIFIED_IDENTIFIER})=(?<resolveTarget>${MINIFIED_IDENTIFIER})\(\),(?<hostPath>${MINIFIED_IDENTIFIER})=await (?<resolveHost>${MINIFIED_IDENTIFIER})\(\{pluginRoot:\k<options>\.pluginRoot,target:\k<target>\}\),`,
);
const BROWSER_CLIENT_PATH = new RegExp(
  String.raw`browserClientPath:\(0,(?<pathModule>${MINIFIED_IDENTIFIER})\.join\)\((?<options>${MINIFIED_IDENTIFIER})\.pluginRoot,` +
    "`scripts`,`browser-client.mjs`" +
    String.raw`\)`,
);

function requireSingleMatch(source, pattern, description) {
  const matches = [...source.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))];
  if (matches.length !== 1) {
    throw new Error(`Failed to patch ${description}: upstream anchor matched ${matches.length} times`);
  }
  return matches[0];
}

export const chromeNativeHostStagingFeature = {
  id: "chrome-native-host-staging",
  version: 1,
  requiredMarkers: FEATURE_MARKERS["chrome-native-host-staging"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["chrome-native-host-staging"].forbiddenMarkers,
  apply(bundleSources, context) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let source = bundleSources.buildChromeNativeHostSource;
    const browserClientMatch = requireSingleMatch(
      source,
      BROWSER_CLIENT_PATH,
      "Linux Chrome native host browser client staging",
    );
    const pathModule = browserClientMatch.groups.pathModule;

    source = replaceOrThrow(
      source,
      INSTALL_NATIVE_HOST_CALL,
      (...args) => {
        const groups = args.at(-1);
        return `await ${groups.install}({codexHome:${groups.request}.codexHome,devRuntimeRepoRoot:${groups.request}.devRuntimeRepoRoot,extensionId:await ${groups.readExtensionId}(${groups.cacheRoot}),nativeHostName:${groups.nativeHostName},pluginName:${groups.request}.pluginName,pluginVersion:${groups.manifest}.version,pluginRoot:${groups.cacheRoot},resourcesPath:${groups.request}.resourcesPath})`;
      },
      "Linux Chrome native host plugin name ownership",
    );
    source = replaceOrThrow(
      source,
      INSTALL_NATIVE_HOST_START,
      (...args) => {
        const groups = args.at(-1);
        return `async function ${groups.install}(${groups.options}){let ${groups.target}=${groups.resolveTarget}(),codexLinuxChromePluginRoot=(0,${pathModule}.join)(${groups.options}.resourcesPath,\`plugins\`,\`openai-bundled\`,\`plugins\`,${groups.options}.pluginName),${groups.hostPath}=await ${groups.resolveHost}({pluginRoot:codexLinuxChromePluginRoot,target:${groups.target}}),`;
      },
      "Linux Chrome native host staged extension host",
    );
    source = replaceOrThrow(
      source,
      BROWSER_CLIENT_PATH,
      (...args) => {
        const groups = args.at(-1);
        return `browserClientPath:(0,${groups.pathModule}.join)(codexLinuxChromePluginRoot,\`scripts\`,\`browser-client.mjs\`)`;
      },
      "Linux Chrome native host staged browser client",
    );

    let sources = { ...bundleSources, buildChromeNativeHostSource: source };
    if (typeof context?.syncSharedBundleSource === "function") {
      sources = context.syncSharedBundleSource(
        sources,
        "buildChromeNativeHostSource",
        sources.buildChromeNativeHostSource,
      );
    }
    return sources;
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.buildChromeNativeHostSource,
      this.requiredMarkers.buildChromeNativeHostSource,
      "Linux Chrome native host staging patch",
    );
    ensureMarkersAbsent(
      bundleSources.buildChromeNativeHostSource,
      this.forbiddenMarkers.buildChromeNativeHostSource,
      "Linux Chrome native host staging patch",
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
