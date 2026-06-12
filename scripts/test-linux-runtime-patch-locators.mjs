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
const browserAutomationRuntimeNameFeature = browserChromeSubpatchById.get("browser-automation-runtime-name");
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
assert.equal(featureIds.has("browser-automation-runtime-name"), false);
assert.equal(featureIds.has("browser-backend-registry"), false);
assert.equal(featureIds.has("browser-security"), false);
assert.equal(featureIds.has("chrome-extension-status"), false);
assert.equal(featureIds.has("chrome-setup-url"), false);
assert.equal(featureIds.has("plugin-mcp-reload"), false);
assert.deepEqual(
  browserChromeSubpatches.map((subpatch) => subpatch.id),
  [
    "browser-use",
    "browser-automation-runtime-name",
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
  markdownLocalMediaFeature.requiredMarkers.webviewMarkdown.includes(
    "queryConfig:{cacheKey:s==null?void 0:Array.isArray(s)?[`markdown-media`,...s]:[`markdown-media`,s],enabled:I,gcTime:1/0,staleTime:0,refetchOnMount:`always`}",
  ),
  true,
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
  false,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes("group/windows-top-bar"),
  false,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes("codex-linux-header-tint-mask"),
  false,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes("syncLinuxHeaderTintMask"),
  false,
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
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes(
    "--codex-linux-sidebar-glass-dark:rgba(14,14,16,.72)",
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes(
    '[data-codex-window-type="electron"][data-codex-os="linux"].electron-dark .app-shell-left-panel',
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes(
    "--codex-linux-titlebar-glass-dark:rgba(10,10,12,.94)",
  ),
  false,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes(
    "var(--codex-linux-titlebar-glass,var(--codex-titlebar-tint,transparent))",
  ),
  false,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes(
    "showApplicationMenu:process.platform===`linux`?void 0:async",
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes(
    "button:not(:disabled){opacity:1!important;filter:none!important;color:var(--color-token-text-primary)!important;}",
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes(
    'app-shell-header-context-menu-surface"]{opacity:1!important;filter:none!important;color:var(--color-token-text-primary)!important;}',
  ),
  false,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes(
    ':is(button,a,[role="button"],span,svg){opacity:1!important;filter:none!important;color:inherit!important;}',
  ),
  false,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].mainRequiredMarkers.includes(
    "frame:!1,hasShadow:!0,transparent:!0,backgroundColor:`#00000000`,autoHideMenuBar:!0",
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].mainRequiredMarkers.includes("setMenuBarVisibility(!1)"),
  true,
);
assert.equal(FEATURE_MARKERS["native-titlebar"].mainRequiredMarkers.includes("setMenu(null)"), true);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].mainRequiredMarkers.includes("BrowserWindow.getAllWindows().forEach"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].mainRequiredMarkers.includes(
    "process.platform===`linux`?r.Menu.setApplicationMenu(null):r.Menu.setApplicationMenu(st)",
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].mainForbiddenMarkers.includes(
    "frame:!1,hasShadow:!0,transparent:!0,backgroundColor:`#00000000`};",
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].mainForbiddenMarkers.includes(
    "__codexCustomTitlebar&&M.setMenuBarVisibility(!1)",
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].mainForbiddenMarkers.includes("r.Menu.setApplicationMenu(st),Tq(_)"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes(
    '[class~="group/windows-top-bar"]>*{visibility:hidden!important;opacity:0!important;}',
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes("syncLinuxSidebarTopbar"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes("--codex-linux-sidebar-top-surface-width"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes(
    'group/windows-top-bar"]{width:var(--codex-linux-sidebar-top-surface-width)!important;',
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes(
    '.fixed>[data-test-id="header-shell-slot"]:first-child{visibility:hidden!important;opacity:0!important;}',
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes(
    'setProperty("clip-path","inset(0 0 0 "+i+"px)","important")',
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes("codex-linux-header-tint-mask"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes("syncLinuxHeaderTintMask"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes("ensureLinuxHeaderTintMask"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes("--codex-linux-titlebar-glass-dark"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes("var(--codex-linux-titlebar-glass"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes(
    'app-shell-header-context-menu-surface"]{opacity:1!important;filter:none!important;color:var(--color-token-text-primary)!important;}',
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes(
    ':is(button,a,[role="button"],span,svg){opacity:1!important;filter:none!important;color:inherit!important;}',
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes("ResizeObserver"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes(
    'n.style.background=a?"transparent":"var(--codex-titlebar-tint,transparent)"',
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes(
    "showApplicationMenu:async(t,n,i)=>{await e.ipcRenderer.invoke(r,{menuId:t,x:n,y:i})}",
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
    "function Ve(e,{buildFlavor:t=n.P.resolve(),env:r=p.default.env,platform:i=p.default.platform}={}){let a=i===`darwin`&&!n.P.isInternal(t)&&e.computerUseNodeRepl!=null?{...e,computerUseNodeRepl:!1}:e,o=i===`win32`&&e.computerUse===!0?{...a,computerUseNodeRepl:!0}:a,s=i===`win32`&&r.CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE===`1`?{...o,computerUse:!0,computerUseNodeRepl:!0}:o,c=t===n.P.Dev?He(r):null;return c==null?{...s,deviceAttestation:ve({platform:i})}:{...s,...c,deviceAttestation:ve({platform:i})}}",
    '"chrome-extension-installed-read":async({extensionId:e})=>({installed:oa({extensionId:e})});',
    "function Uo({homeDir:e,localAppDataDir:t,platform:n}){return n===`darwin`?(0,a.join)(e,`Library`,`Application Support`,`Google`,`Chrome`):n===`win32`?(0,a.join)(t??(0,a.join)(e,`AppData`,`Local`),`Google`,`Chrome`,`User Data`):null}",
  ].join(""),
};

assert.equal(browserUseFeature.isApplied(bundleSources), false);
bundleSources = browserUseFeature.apply(bundleSources);
browserUseFeature.verify(bundleSources);
assert.equal(bundleSources.main.includes("CODEX_ELECTRON_ENABLE_LINUX_BROWSER_USE"), true);

let browserAutomationRuntimeNameBundle = {
  main: [
    "rawValue:e.CODEX_NODE_REPL_PATH",
    "devRelativePathSegments:[`electron`,`bin`,`node_repl`]",
    "nodeReplPath:h.path,nodeReplPathSource:h.source",
    "safe:{backend:`node_repl`,phase:`runtime-paths`}",
    '"node-repl-active-execs-kill":async({sessionId:e,turnId:n})=>kill(e,n)',
  ].join(";"),
  worker: [
    "Run a node_repl JavaScript snippet",
    "nodeRepl.write(finalUrl);",
    "q({browserClientPath:OV,codexCliPath:OV,nodePath:OV,nodeReplPath:OV,platform:W().catch(`unknown`)});",
    "E.default.join(`node_repl`,`active_execs`)",
  ].join(""),
	  buildBrowserRuntimeSource: [
	    "var Th=`NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS`,Dh=`NODE_REPL_NODE_PATH`,kh=`node_repl`;",
	    "function Nh({nodeReplPath:a}){return{[`mcp_servers.${kh}`]:{command:a}}}",
	    "nodeRepl.write(finalUrl);",
	  ].join(""),
  buildChromeNativeHostSource: [
    "function Pc(e){return Mc({executableName:process.platform===`win32`?`node_repl.exe`:`node_repl`})}",
    "jp=e.Di({nodeReplPath:e.ji().trim().min(1),chromeNativeHosts:e.vi(e.ji())})",
  ].join(""),
  webviewCoreSource: [
    "Do not run ad hoc node_repl browser-client path discovery.",
    "Run a node_repl JavaScript snippet",
    "nodeRepl.write(finalUrl);",
    "U({browserClientPath:Fc,codexCliPath:Fc,nodePath:Fc,nodeReplPath:Fc,platform:z().catch(`unknown`)});",
  ].join(""),
  webviewAppServerManagerSignals:
    "e(`node-repl-active-execs-kill`,{params:{sessionId:n,turnId:r}});z.warning(`Timed out killing active node_repl execs`)",
  webviewDebugModal: "za=`node_repl`;value:`No Node REPL tool calls for this thread`",
  webviewLocalConversationThread: "if(a.type!==`mcpToolCall`||a.server===`node_repl`)continue;",
  webviewSplitItemsIntoRenderGroups: "e.invocation.server===`node_repl`&&(e.invocation.tool===`js`||e.invocation.tool===`js_reset`)",
};
assert.equal(browserAutomationRuntimeNameFeature.isApplied(browserAutomationRuntimeNameBundle), false);
browserAutomationRuntimeNameBundle = browserAutomationRuntimeNameFeature.apply(
  browserAutomationRuntimeNameBundle,
);
browserAutomationRuntimeNameFeature.verify(browserAutomationRuntimeNameBundle);
assert.equal(browserAutomationRuntimeNameBundle.webviewCoreSource.includes("browserAutomationPath"), true);
assert.equal(browserAutomationRuntimeNameBundle.webviewCoreSource.includes("browserAutomation.write"), true);
assert.equal(browserAutomationRuntimeNameBundle.webviewDebugModal.includes("Node REPL"), false);
assert.equal(browserAutomationRuntimeNameBundle.main.includes("CODEX_BROWSER_AUTOMATION_PATH"), true);
assert.equal(browserAutomationRuntimeNameBundle.main.includes("browser-automation-active-execs-kill"), true);
assert.equal(browserAutomationRuntimeNameBundle.buildBrowserRuntimeSource.includes("BROWSER_AUTOMATION_NODE_PATH"), true);
assert.equal(browserAutomationRuntimeNameBundle.buildChromeNativeHostSource.includes("browser_automation"), true);

assert.equal(chromeExtensionStatusFeature.isApplied(bundleSources), false);
bundleSources = chromeExtensionStatusFeature.apply(bundleSources);
chromeExtensionStatusFeature.verify(bundleSources);
assert.equal(bundleSources.main.includes("`.config`,`google-chrome`"), true);
assert.equal(bundleSources.main.includes("n===`linux`?(0,a.join)(e,`.config`,`google-chrome`):null"), true);

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
    "function Me(e){let t=(0,X.c)(48),{computerUseAvailability:n}=e,r=j(),{selectedHostId:i}=G(),a=m(i).kind===`local`,o;t[0]===i?o=t[1]:(o={hostId:i},t[0]=i,t[1]=o);let s=I(o),c;t[2]===Symbol.for(`react.memo_cache_sentinel`)?(c=[],t[2]=c):c=t[2];let l=ee(i,c),u=ve(i),d;t[3]!==u||t[4]!==l.availablePlugins?(d=T(l.availablePlugins,Te,u),t[3]=u,t[4]=l.availablePlugins,t[5]=d):d=t[5];let f=d,p;",
  webviewComputerUseProviderSettings:
    "function an(e,t,n){let r=e.filter(e=>e.plugin.name===t||e.plugin.id.split(`@`)[0]===t),i=E(ye());return(i==null?void 0:r.find(e=>e.marketplaceName===i))??r.find(e=>O(e.marketplaceName))??r.find(e=>e.marketplaceName===`openai-curated`)??r.find(e=>ze(n,e.marketplacePath))??null}",
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
    "d=T([...l.availablePlugins,...l.installedPlugins],Te,u)",
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
    "let f=d??codexLinuxComputerUseProvider(),p;",
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
    "q=h(`app-shell-left-panel relative flex min-h-0 shrink-0 flex-col overflow-hidden`,`w-token-sidebar`),J=(0,$.jsx)(`div`,{className:`draggable h-toolbar w-full shrink-0`})",
};
assert.equal(settingsSidebarSurfaceFeature.isApplied(settingsSidebarBundle), false);
settingsSidebarBundle = settingsSidebarSurfaceFeature.apply(settingsSidebarBundle);
settingsSidebarSurfaceFeature.verify(settingsSidebarBundle);
assert.equal(settingsSidebarBundle.webviewSettingsPage.includes("app-shell-left-panel"), true);
assert.equal(settingsSidebarBundle.webviewSettingsPage.includes("pointer-events-auto relative flex min-h-0 shrink-0"), true);

const patchedOpenTargetsAnchor = openTargetsFeature.getPatchedGhosttyAnchor();
assert.equal(patchedOpenTargetsAnchor.includes("detect:()=>po(`gwenview`)"), true);
assert.equal(patchedOpenTargetsAnchor.includes("detect:()=>po(`typora`)??po(`typora-x11-fcitx`)"), true);
assert.equal(patchedOpenTargetsAnchor.includes("detect:()=>Fi(`"), false);

console.error("[INFO] Linux runtime patch locator tests passed");
