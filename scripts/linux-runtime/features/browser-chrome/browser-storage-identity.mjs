import { FEATURE_MARKERS } from "../../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../../replace-utils.mjs";

const IDENTIFIER = String.raw`[$A-Z_a-z][$\w]*`;
const upstreamEphemeralStorageIdentityRegex = new RegExp(
  String.raw`getBrowserStorageId\((?<conversationId>${IDENTIFIER}),(?<browserTabId>${IDENTIFIER})=(?<legacyBrowserTabId>${IDENTIFIER})\(\k<conversationId>,void 0\)\)\{let (?<routeKey>${IDENTIFIER})=(?<makeRouteKey>${IDENTIFIER})\(\k<conversationId>,\k<browserTabId>\),(?<persistenceState>${IDENTIFIER})=this\.tabPersistenceStates\.get\(\k<routeKey>\);if\(\k<persistenceState>!=null\)return \k<persistenceState>\.browserStorageId;let (?<browserStorageId>${IDENTIFIER})=(?<brandBrowserStorageId>${IDENTIFIER})\(\`browser:\$\{crypto\.randomUUID\(\)\}\`\);return this\.tabPersistenceStates\.set\(\k<routeKey>,\{browserStorageId:\k<browserStorageId>,mode:\`ephemeral\`\}\),\k<browserStorageId>\}`,
);

const upstreamPersistentStorageIdentityRegex = new RegExp(
  String.raw`getPagePersistence\((?<conversationId>${IDENTIFIER}),(?<browserTabId>${IDENTIFIER})\)\{let (?<routeKey>${IDENTIFIER})=(?<makeRouteKey>${IDENTIFIER})\(\k<conversationId>,\k<browserTabId>\),(?<persistenceState>${IDENTIFIER})=this\.tabPersistenceStates\.get\(\k<routeKey>\);if\(\k<persistenceState>==null\)\{let (?<browserStorageId>${IDENTIFIER})=(?<brandBrowserStorageId>${IDENTIFIER})\(\`browser:\$\{crypto\.randomUUID\(\)\}\`\);return this\.tabPersistenceStates\.set\(\k<routeKey>,\{browserStorageId:\k<browserStorageId>,mode:\`persistent\`\}\),\{browserStorageId:\k<browserStorageId>,restore:\`none\`\}\}`,
);

function replacementGroups(args) {
  const groups = args.at(-1);
  if (!groups || typeof groups !== "object") {
    throw new Error("Linux Browser storage identity patch expected named regex groups");
  }
  return groups;
}

function replaceEphemeralStorageIdentity(...args) {
  const {
    conversationId,
    browserTabId,
    legacyBrowserTabId,
    routeKey,
    makeRouteKey,
    persistenceState,
    browserStorageId,
    brandBrowserStorageId,
  } = replacementGroups(args);

  return (
    `codexLinuxBrowserStorageId(${conversationId},${browserTabId}){return ${brandBrowserStorageId}(` +
    `${browserTabId}===${legacyBrowserTabId}(${conversationId},void 0)?${conversationId}:` +
    `${conversationId}+\`\\0\`+${browserTabId})}` +
    `getBrowserStorageId(${conversationId},${browserTabId}=${legacyBrowserTabId}(${conversationId},void 0)){` +
    `let ${routeKey}=${makeRouteKey}(${conversationId},${browserTabId}),` +
    `${persistenceState}=this.tabPersistenceStates.get(${routeKey});` +
    `if(${persistenceState}!=null)return ${persistenceState}.browserStorageId;` +
    `let ${browserStorageId}=this.codexLinuxBrowserStorageId(${conversationId},${browserTabId});` +
    `return this.tabPersistenceStates.set(${routeKey},{browserStorageId:${browserStorageId},mode:\`ephemeral\`}),${browserStorageId}}`
  );
}

function replacePersistentStorageIdentity(...args) {
  const {
    conversationId,
    browserTabId,
    routeKey,
    makeRouteKey,
    persistenceState,
  } = replacementGroups(args);

  return (
    `getPagePersistence(${conversationId},${browserTabId}){` +
    `let ${routeKey}=${makeRouteKey}(${conversationId},${browserTabId}),` +
    `${persistenceState}=this.tabPersistenceStates.get(${routeKey});` +
    `if(${persistenceState}==null){` +
    `let codexLinuxPersistentBrowserStorageId=this.codexLinuxBrowserStorageId(` +
    `${conversationId},${browserTabId});` +
    `return this.tabPersistenceStates.set(${routeKey},{` +
    `browserStorageId:codexLinuxPersistentBrowserStorageId,mode:\`persistent\`}),{` +
    `browserStorageId:codexLinuxPersistentBrowserStorageId,restore:\`none\`}}`
  );
}

export const browserStorageIdentityFeature = {
  id: "browser-storage-identity",
  version: 3,
  requiredMarkers: FEATURE_MARKERS["browser-storage-identity"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["browser-storage-identity"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let webviewBrowserSidebarRuntime = replaceOrThrow(
      bundleSources.webviewBrowserSidebarRuntime,
      upstreamEphemeralStorageIdentityRegex,
      replaceEphemeralStorageIdentity,
      "Linux Browser ephemeral storage identity",
      { appliedMarker: "codexLinuxBrowserStorageId" },
    );
    webviewBrowserSidebarRuntime = replaceOrThrow(
      webviewBrowserSidebarRuntime,
      upstreamPersistentStorageIdentityRegex,
      replacePersistentStorageIdentity,
      "Linux Browser persistent storage identity",
    );

    return { ...bundleSources, webviewBrowserSidebarRuntime };
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.webviewBrowserSidebarRuntime,
      this.requiredMarkers,
      "Linux Browser storage identity patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewBrowserSidebarRuntime,
      this.forbiddenMarkers,
      "Linux Browser storage identity patch",
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
