#!/usr/bin/env node

import assert from "node:assert/strict";
import { browserChromeSubpatches } from "./linux-runtime/features/browser-chrome/index.mjs";
import { computerUseAvailabilityFeature } from "./linux-runtime/features/computer-use-availability.mjs";
import { computerUseProviderFeature } from "./linux-runtime/features/computer-use-provider.mjs";
import { generatedOutputArtifactsFeature } from "./linux-runtime/features/generated-output-artifacts.mjs";
import { linuxPatchFeatures } from "./linux-runtime/features/index.mjs";
import { FEATURE_MARKERS } from "./linux-runtime/markers.mjs";
import { markdownLocalMediaFeature } from "./linux-runtime/features/markdown-local-media.mjs";
import { openTargetsFeature } from "./linux-runtime/features/open-targets.mjs";
import { settingsSidebarSurfaceFeature } from "./linux-runtime/features/settings-sidebar-surface.mjs";

const featureIds = new Set(linuxPatchFeatures.map((feature) => feature.id));
const browserChromeSubpatchById = new Map(
  browserChromeSubpatches.map((subpatch) => [subpatch.id, subpatch]),
);
const browserUseFeature = browserChromeSubpatchById.get("browser-use");
const chromeExtensionStatusFeature = browserChromeSubpatchById.get("chrome-extension-status");
const chromeSetupUrlFeature = browserChromeSubpatchById.get("chrome-setup-url");

assert.equal(featureIds.has("directive-strip"), false);
assert.equal(featureIds.has("working-sessions-status"), false);
assert.equal(featureIds.has("conversation-model-selector"), false);
assert.equal(featureIds.has("preferences"), false);
assert.equal(featureIds.has("conversation-local-images"), false);
assert.equal(featureIds.has("local-image-cache-refresh"), false);
assert.equal(featureIds.has("generated-output-artifacts"), true);
assert.equal(featureIds.has("browser-chrome"), true);
assert.equal(featureIds.has("computer-use-availability"), true);
assert.equal(featureIds.has("computer-use-provider"), true);
assert.equal(featureIds.has("browser-use"), false);
assert.equal(featureIds.has("browser-backend-registry"), false);
assert.equal(featureIds.has("browser-security"), false);
assert.equal(featureIds.has("chrome-extension-status"), false);
assert.equal(featureIds.has("chrome-setup-url"), false);
assert.equal(featureIds.has("plugin-mcp-reload"), false);
assert.deepEqual(
  browserChromeSubpatches.map((subpatch) => subpatch.id),
  [
    "browser-use",
    "browser-backend-registry",
    "browser-security",
    "chrome-extension-status",
    "chrome-setup-url",
  ],
);
assert.equal(
  markdownLocalMediaFeature.requiredMarkers.webviewMarkdown.some((marker) =>
    String(marker).includes("codexLinuxNormalizeMarkdownRemoteMediaUrl"),
  ),
  false,
);
assert.equal(
  markdownLocalMediaFeature.requiredMarkers.webviewHtml.some((marker) =>
    String(marker).includes("http: https:"),
  ),
  false,
);
assert.equal(
  generatedOutputArtifactsFeature.requiredMarkers.webviewLocalConversationThread.includes(
    "function codexLinuxResolveGeneratedImageArtifactPath(e,t,n)",
  ),
  true,
);
assert.equal(
  generatedOutputArtifactsFeature.forbiddenMarkers.webviewLocalConversationThread.some((marker) =>
    String(marker).includes("for(let e of i.items)e?.type===`imageGeneration`"),
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes("codex-linux-sidebar-top-surface"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes("group/windows-top-bar"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes("syncLinuxLeftPanelTopInset"),
  false,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes("--codex-linux-left-panel-padding-top"),
  false,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes("--codex-linux-sidebar-surface"),
  false,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.some((marker) =>
    String(marker).includes("group/windows-top-bar") && String(marker).includes("background:transparent"),
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].mainRequiredMarkers.includes(
    "frame:!1,hasShadow:!0,transparent:!0,backgroundColor:`#00000000`",
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes(
    '[class~="group/windows-top-bar"]>*{visibility:hidden!important;opacity:0!important;}',
  ),
  true,
);

const appShellLeftPanelSource =
  "u&&(E||M)&&(0,Q.jsx)(vr,{paddingTop:v?`0px`:`var(--height-toolbar)`,children:c},`app-shell-left-panel`)";
assert.equal(
  appShellLeftPanelSource.includes("paddingTop:v?`0px`:`var(--height-toolbar)`"),
  true,
);

let bundleSources = {
  main: [
    "function featureGate(settings,{buildFlavor:flavor=build.O.resolve(),env:environment=proc.default.env,platform:osPlatform=proc.default.platform}={}){let merged=osPlatform===`win32`&&environment.CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE===`1`?{...settings,computerUse:!0,computerUseNodeRepl:!0}:settings,overrides=flavor===build.O.Dev?readOverrides(environment):null;return overrides==null?merged:{...merged,...overrides}}",
    '"chrome-extension-installed-read":async({extensionId:e})=>({installed:oa({extensionId:e})});',
    "function Co({homeDir:e,localAppDataDir:t,platform:n}){return n===`darwin`?(0,o.join)(e,`Library`,`Application Support`,`Google`,`Chrome`):n===`win32`?(0,o.join)(t??(0,o.join)(e,`AppData`,`Local`),`Google`,`Chrome`,`User Data`):null}",
  ].join(""),
};

assert.equal(browserUseFeature.isApplied(bundleSources), false);
bundleSources = browserUseFeature.apply(bundleSources);
browserUseFeature.verify(bundleSources);
assert.equal(bundleSources.main.includes("CODEX_ELECTRON_ENABLE_LINUX_BROWSER_USE"), true);

assert.equal(chromeExtensionStatusFeature.isApplied(bundleSources), false);
bundleSources = chromeExtensionStatusFeature.apply(bundleSources);
chromeExtensionStatusFeature.verify(bundleSources);
assert.equal(bundleSources.main.includes("`.config`,`google-chrome`"), true);
assert.equal(bundleSources.main.includes("n===`linux`?(0,o.join)(e,`.config`,`google-chrome`):null"), true);

let chromeSetupBundle = {
  webviewPluginAvailability: [
    "chromeIcon=`assets/google-chrome.png`,extensionAsset=`scripts/extension-id.json`,buildUrl=`https://chromewebstore.google.com/detail/codex/`,allowedBrowsers=makeSet([`chrome`,`chrome-dev`,`chrome-internal`]),",
    "id:extensionId,name:`Codex Chrome Extension`,url:`${buildUrl}${extensionId}`",
    "onClick:()=>{dispatcher.dispatchMessage(`open-in-browser`,{url:plugin.url})},children:(0,jsx.jsx)(Button,{id:`plugins.installModal.openBrowserExtension`",
  ].join(";"),
  webviewRemoteControlConnectionsVisibility: "",
  webviewPluginDetail:
    "onClick:()=>{detailDispatcher.dispatchMessage(`open-in-browser`,{url:plugin.url})},children:(0,detailJsx.jsx)(DetailButton,{id:`plugins.detail.setup.openBrowserExtension`",
};
assert.equal(chromeSetupUrlFeature.isApplied(chromeSetupBundle), false);
chromeSetupBundle = chromeSetupUrlFeature.apply(chromeSetupBundle, {
  webviewRemoteControlConnectionsVisibilityPath: "remote-control",
  webviewPluginAvailabilityPath: "plugin-availability",
});
chromeSetupUrlFeature.verify(chromeSetupBundle);
assert.equal(chromeSetupBundle.webviewPluginAvailability.includes("encodeURIComponent"), true);
assert.equal(chromeSetupBundle.webviewPluginAvailability.includes("useExternalBrowser:!0"), true);
assert.equal(chromeSetupBundle.webviewPluginDetail.includes("plugin_browser_extension_setup"), true);

let computerUseSettingsBundle = {
  webviewComputerUseSettings:
    "function je(e){let t=(0,Z.c)(48),{computerUseAvailability:r}=e,i=b(),{selectedHostId:a}=ce(),o=n(a).kind===`local`,s;t[0]===a?s=t[1]:(s={hostId:a},t[0]=a,t[1]=s);let c=O(s),u;t[2]===Symbol.for(`react.memo_cache_sentinel`)?(u=[],t[2]=u):u=t[2];let d=k(a,u),f=pe(a),p;t[3]!==f||t[4]!==d.availablePlugins?(p=X(d.availablePlugins,we,f),t[3]=f,t[4]=d.availablePlugins,t[5]=p):p=t[5];let m=p,h;",
  webviewComputerUseProviderSettings:
    "function St(e,t,n){let r=e.filter(e=>e.plugin.name===t||e.plugin.id.split(`@`)[0]===t),i=l(le());return(i==null?void 0:r.find(e=>e.marketplaceName===i))??r.find(e=>s(e.marketplaceName))??r.find(e=>e.marketplaceName===`openai-curated`)??r.find(e=>Ee(n,e.marketplacePath))??null}",
};
assert.equal(computerUseProviderFeature.isApplied(computerUseSettingsBundle), false);
computerUseSettingsBundle = computerUseProviderFeature.apply(computerUseSettingsBundle);
computerUseProviderFeature.verify(computerUseSettingsBundle);
assert.equal(
  computerUseSettingsBundle.webviewComputerUseProviderSettings.includes("kde-computer-use"),
  true,
);
assert.equal(
  computerUseSettingsBundle.webviewComputerUseProviderSettings.includes(
    "plugin.name===`kde-computer-use`",
  ),
  true,
);
assert.equal(
  computerUseSettingsBundle.webviewComputerUseSettings.includes(
    "p=X([...d.availablePlugins,...d.installedPlugins],we,f)",
  ),
  true,
);
assert.equal(
  computerUseSettingsBundle.webviewComputerUseSettings.includes(
    "function codexLinuxComputerUseProvider()",
  ),
  true,
);
assert.equal(
  computerUseSettingsBundle.webviewComputerUseSettings.includes(
    "let m=p??codexLinuxComputerUseProvider(),h;",
  ),
  true,
);

let computerUseAvailabilityBundle = {
  webviewPluginFeatureGate:
    "function d(e){return e===`macOS`||e===`windows`}function f(e){let t=(0,l.c)(14),{enabled:n,hostId:r}=e,i=n===void 0?!0:n,{isLoading:o,platform:c}=s(),f=a(`1506311413`),m;t[0]===r?m=t[1]:(m={featureName:`computer_use`,hostId:r},t[0]=r,t[1]=m);let h=u(m),g;t[2]!==h.enabled||t[3]!==h.isLoading||t[4]!==i||t[5]!==f||t[6]!==o||t[7]!==c?(g=p({enabled:i,isComputerUseFeatureEnabled:h.enabled,isComputerUseFeatureLoading:h.isLoading,isComputerUseGateEnabled:f,isHostCompatiblePlatform:d(c),isPlatformLoading:o,windowType:`electron`}),t[2]=h.enabled,t[3]=h.isLoading,t[4]=i,t[5]=f,t[6]=o,t[7]=c,t[8]=g):g=t[8]}",
};
assert.equal(computerUseAvailabilityFeature.isApplied(computerUseAvailabilityBundle), false);
computerUseAvailabilityBundle = computerUseAvailabilityFeature.apply(computerUseAvailabilityBundle);
computerUseAvailabilityFeature.verify(computerUseAvailabilityBundle);
assert.equal(
  computerUseAvailabilityBundle.webviewPluginFeatureGate.includes(
    "e===`macOS`||e===`windows`||e===`linux`",
  ),
  true,
);
assert.equal(
  computerUseAvailabilityBundle.webviewPluginFeatureGate.includes(
    "isComputerUseGateEnabled:f||c===`linux`",
  ),
  true,
);

let settingsSidebarBundle = {
  webviewSettingsPage:
    "J=a(`window-fx-sidebar-surface flex shrink-0 flex-col`,`w-token-sidebar`),Y=(0,$.jsx)(`div`,{className:`draggable h-toolbar w-full`})",
};
assert.equal(settingsSidebarSurfaceFeature.isApplied(settingsSidebarBundle), false);
settingsSidebarBundle = settingsSidebarSurfaceFeature.apply(settingsSidebarBundle);
settingsSidebarSurfaceFeature.verify(settingsSidebarBundle);
assert.equal(settingsSidebarBundle.webviewSettingsPage.includes("app-shell-left-panel"), true);
assert.equal(settingsSidebarBundle.webviewSettingsPage.includes("relative flex shrink-0"), true);

const patchedOpenTargetsAnchor = openTargetsFeature.getPatchedGhosttyAnchor();
assert.equal(patchedOpenTargetsAnchor.includes("detect:()=>Ka(`gwenview`)"), true);
assert.equal(patchedOpenTargetsAnchor.includes("detect:()=>Ka(`typora`)??Ka(`typora-x11-fcitx`)"), true);
assert.equal(patchedOpenTargetsAnchor.includes("detect:()=>Fi(`"), false);

console.error("[INFO] Linux runtime patch locator tests passed");
