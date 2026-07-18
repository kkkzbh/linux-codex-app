#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { browserChromeSubpatches } from "./linux-runtime/features/browser-chrome/index.mjs";
import { computerUseAvailabilityFeature } from "./linux-runtime/features/computer-use-availability.mjs";
import { computerUseProviderFeature } from "./linux-runtime/features/computer-use-provider.mjs";
import { generatedOutputArtifactsFeature } from "./linux-runtime/features/generated-output-artifacts.mjs";
import { linuxPatchFeatures } from "./linux-runtime/features/index.mjs";
import { getLinuxOpenTargetAssets } from "./linux-runtime/linux-desktop-assets.mjs";
import { FEATURE_MARKERS } from "./linux-runtime/markers.mjs";
import { openTargetsFeature } from "./linux-runtime/features/open-targets.mjs";
import { settingsSidebarSurfaceFeature } from "./linux-runtime/features/settings-sidebar-surface.mjs";
import { settingsSuggestedPromptsFeature } from "./linux-runtime/features/settings-suggested-prompts.mjs";

const featureIds = new Set(linuxPatchFeatures.map((feature) => feature.id));
const browserChromeSubpatchById = new Map(
  browserChromeSubpatches.map((subpatch) => [subpatch.id, subpatch]),
);
const browserUseFeature = browserChromeSubpatchById.get("browser-use");
const browserStorageIdentityFeature = browserChromeSubpatchById.get(
  "browser-storage-identity",
);
const browserSessionRoutingFeature = browserChromeSubpatchById.get(
  "browser-session-routing",
);
const browserAutomationRuntimeNameFeature = browserChromeSubpatchById.get("browser-automation-runtime-name");
const chromeNativeHostStagingFeature = browserChromeSubpatchById.get("chrome-native-host-staging");
const browserProfileImportFeature = browserChromeSubpatchById.get("browser-profile-import");
const browserSecurityFeature = browserChromeSubpatchById.get("browser-security");
const chromeSetupUrlFeature = browserChromeSubpatchById.get("chrome-setup-url");

assert.equal(linuxPatchFeatures.find((feature) => feature.id === "browser-chrome")?.version, 12);
assert.equal(browserStorageIdentityFeature?.version, 3);
assert.equal(browserSessionRoutingFeature?.version, 1);
assert.equal(browserSecurityFeature?.version, 3);
assert.equal(browserProfileImportFeature?.version, 6);

const linuxOpenTargetAssets = getLinuxOpenTargetAssets();
for (const key of [
  "vscode",
  "dolphin",
  "gwenview",
  "typora",
  "wps",
  "officeRemoteApp",
  "clion",
  "pycharm",
  "webstorm",
]) {
  const asset = linuxOpenTargetAssets[key];
  const hasCommand =
    typeof asset?.command === "string" ||
    Object.values(asset?.commands ?? {}).some((command) => typeof command === "string");
  if (hasCommand) {
    assert.match(asset.iconDataUrl ?? "", /^data:image\/png;base64,/);
  }
}
for (const iconDataUrl of Object.values(linuxOpenTargetAssets.defaultAppIconByExtension)) {
  assert.match(iconDataUrl, /^data:image\/png;base64,/);
}

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
assert.equal(featureIds.has("primary-window-focusability"), false);
assert.equal(featureIds.has("settings-suggested-prompts"), true);
assert.equal(featureIds.has("avatar-overlay-transparency"), false);
assert.equal(featureIds.has("browser-use"), false);
assert.equal(featureIds.has("browser-automation-runtime-name"), false);
assert.equal(featureIds.has("browser-backend-registry"), false);
assert.equal(featureIds.has("browser-security"), false);
assert.equal(featureIds.has("chrome-extension-settings"), false);
assert.equal(featureIds.has("chrome-extension-status"), false);
assert.equal(featureIds.has("chrome-setup-url"), false);
assert.equal(featureIds.has("plugin-mcp-reload"), false);

const installerSource = readFileSync(new URL("../install.sh", import.meta.url), "utf8");
const linuxBundleContext = readFileSync(
  new URL("./linux-runtime/bundle-context.mjs", import.meta.url),
  "utf8",
);
assert.equal(installerSource.includes("packages/standalone/current/codex"), true);
assert.equal(installerSource.includes("CODEX_CLI_PATH"), true);
assert.equal(installerSource.includes("CODEX_STANDALONE_CLI_PATH"), false);
assert.equal(installerSource.includes("CODEX_PATCHED_STANDALONE_CLI_PATH"), false);
assert.equal(installerSource.includes("codex-standalone-patched"), false);
assert.equal(installerSource.includes("codex-linux-browser-profile-import.cjs"), true);
assert.equal(installerSource.includes("codex-linux-onepassword-browser-provider.cjs"), true);
assert.equal(existsSync(new URL("./linux-browser-profile-import.cjs", import.meta.url)), true);
assert.equal(
  existsSync(new URL("./codex-linux-onepassword-browser-provider.cjs", import.meta.url)),
  true,
);
assert.equal(
  existsSync(new URL("./build-patched-codex-cli.sh", import.meta.url)),
  false,
);
assert.equal(
  existsSync(new URL("./patch-codex-mcp-refresh-shutdown.mjs", import.meta.url)),
  false,
);
assert.equal(linuxBundleContext.includes('[["nodeReplPath", "browserAutomationPath"]'), true);
assert.equal(linuxBundleContext.includes('["nodeRepl.write", "browserAutomation.write"]'), true);
assert.equal(linuxBundleContext.includes("use-model-settings"), false);
assert.equal(linuxBundleContext.includes("webviewModelSettings"), false);
assert.equal(linuxBundleContext.includes("webviewAppShell"), false);
assert.equal(linuxBundleContext.includes("webviewUsePlugins"), false);
assert.equal(linuxBundleContext.includes("webviewRemoteConnectionVisibility"), false);
assert.equal(linuxBundleContext.includes("webviewRemoteControlConnectionsVisibility"), false);
assert.equal(linuxBundleContext.includes("webviewGeneralSettings"), true);
assert.equal(linuxBundleContext.includes("webviewAmbientSuggestionsEligibility"), true);
assert.equal(linuxBundleContext.includes("webviewOpenTargetSelection"), true);
assert.equal(linuxBundleContext.includes("webviewOpenTargetResourceActions"), true);
assert.equal(linuxBundleContext.includes("webviewAvatarOverlay"), false);
assert.equal(linuxBundleContext.includes("codexLinuxEnsureAvatarOverlayTransparent"), false);

assert.deepEqual(
  browserChromeSubpatches.map((subpatch) => subpatch.id),
  [
    "browser-use",
    "browser-automation-runtime-name",
    "browser-backend-registry",
    "browser-storage-identity",
    "browser-session-routing",
    "browser-profile-import",
    "browser-security",
    "chrome-setup-url",
    "chrome-native-host-staging",
  ],
);
assert.equal(
  generatedOutputArtifactsFeature.requiredMarkers.webviewGeneratedOutputArtifacts.includes(
    "function codexLinuxResolveGeneratedImageArtifactPath(e,t)",
  ),
  true,
);
assert.equal(
  generatedOutputArtifactsFeature.forbiddenMarkers.webviewGeneratedOutputArtifacts.some((marker) =>
    String(marker).includes("a.push([...c,...Ym(s,r,n)])"),
  ),
  true,
);
assert.equal(Object.hasOwn(FEATURE_MARKERS, "avatar-overlay-transparency"), false);
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
    ".main-surface{border-top-left-radius:0!important;border-bottom-left-radius:0!important;border-start-start-radius:0!important;border-end-start-radius:0!important;}",
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
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes(".composer-surface-chrome"),
  true,
);
assert.equal(FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes(".ProseMirror"), true);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes("codex-linux-editor-input-style"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes("[contenteditable]"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes('[role="textbox"]'),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes("[data-codex-composer]"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes("[data-pierre-editor-surface]"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes("-webkit-user-select:text!important"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes("user-select:text!important"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes("cursor:text!important"),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes('padding-left","80px'),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes(
    'top:16px;left:16px;height:14px',
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes(
    '[["close","Close"],["minimize","Minimize"],["maximize","Maximize"]]',
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadRequiredMarkers.includes(
    "querySelector(':scope > [data-test-id=\"header-shell-slot\"]')",
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
  FEATURE_MARKERS["native-titlebar"].mainRequiredMarkers.includes(
    "n.__codexCustomTitlebar?this.windowZooms.set(n.id,t)",
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
    "process.platform===`linux`?r.Menu.setApplicationMenu(null):r.Menu.setApplicationMenu(ut)",
  ),
  false,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].mainRequiredMarkers.includes(
    "process.platform===`linux`?c.Menu.setApplicationMenu(null):c.Menu.setApplicationMenu(It)",
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].mainForbiddenMarkers.includes(
    "n===`linux`?{frame:!1,hasShadow:!0,transparent:!0,backgroundColor:`#00000000`}:{titleBarStyle:`default`};",
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].mainForbiddenMarkers.includes(
    "let F=this.installApplicationMenuTitleBarOverlaySync(M,o)",
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].mainForbiddenMarkers.includes(
    "setWindowZoom(e,t){let n=c.BrowserWindow.fromWebContents(e),r=n&&this.windowAppearances.get(n.id);n==null||r!==`primary`&&r!==`quickChat`||(process.platform===`darwin`?n.setWindowButtonPosition(A9(t)):(process.platform===`win32`||process.platform===`linux`)&&(this.windowZooms.set(n.id,t),n.setTitleBarOverlay(j9(t))))}",
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
  FEATURE_MARKERS["native-titlebar"].mainForbiddenMarkers.includes("r.Menu.setApplicationMenu(ut),NJ(_)"),
  false,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].mainForbiddenMarkers.includes("c.Menu.setApplicationMenu(It),RX(_)"),
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
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes('padding-right","96px'),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes(
    't.style.right="12px";t.style.left="auto"',
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes('padding-left","96px'),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes(
    't.style.left="12px";t.style.right="auto"',
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes(
    '[["minimize","Minimize"],["maximize","Maximize"],["close","Close"]]',
  ),
  true,
);
assert.equal(
  FEATURE_MARKERS["native-titlebar"].preloadForbiddenMarkers.includes(
    'document.querySelectorAll(\'.app-header-tint.draggable.pointer-events-none.fixed > [data-test-id="header-shell-slot"]:first-child\')',
  ),
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
    "function Xe(e,{buildFlavor:t=i.a.resolve(),env:n=g.default.env,platform:r=g.default.platform}={}){let a=r===`win32`&&e.computerUse===!0?{...e,computerUseNodeRepl:!0}:e,o=r===`win32`&&n.CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE===`1`?{...a,computerUse:!0,computerUseNodeRepl:!0}:a,s=t===i.a.Dev?Ze(n):null;return s==null?{...o,deviceAttestation:be({platform:r})}:{...o,...s,deviceAttestation:be({platform:r})}}",
    '"chrome-extension-installed-read":async({extensionId:e})=>({installed:oa({extensionId:e})});',
    "async function tc({extensionId:e,platform:t=process.platform,detectChromeCommand:n=nc,runCommand:r=Ns}){if(t===`darwin`){await r(Zs,[`-b`,Xs,$s(e)]);return}if(t===`win32`){let t=n();if(t==null)throw Error(`Google Chrome is not installed`);await r(t,[$s(e)]);return}throw Error(`Opening Chrome extension settings is only supported on macOS and Windows`)}function nc(){return ks(`chrome.exe`)??ks(`chrome`)??Vs([[`Google`,`Chrome`,`Application`,`chrome.exe`]])??rc()}",
    "function ac({homeDir:e,localAppDataDir:t,platform:n}){return n===`darwin`?(0,u.join)(e,`Library`,`Application Support`,`Google`,`Chrome`):n===`win32`?(0,u.join)(t??(0,u.join)(e,`AppData`,`Local`),`Google`,`Chrome`,`User Data`):null}",
  ].join(""),
};

assert.equal(browserUseFeature.isApplied(bundleSources), false);
bundleSources = browserUseFeature.apply(bundleSources);
browserUseFeature.verify(bundleSources);
assert.equal(bundleSources.main.includes("CODEX_ELECTRON_ENABLE_LINUX_BROWSER_USE"), true);

let browserStorageIdentityBundle = {
  webviewBrowserSidebarRuntime:
    "function Af(e,t){return t??`${e}:legacy`}function Ef(e,t){return`${e}\\0${t}`}function oe(e){return e}Store=class{tabPersistenceStates=new Map;getPagePersistence(e,t){let r=Ef(e,t),i=this.tabPersistenceStates.get(r);if(i==null){let e=oe(`browser:${crypto.randomUUID()}`);return this.tabPersistenceStates.set(r,{browserStorageId:e,mode:`persistent`}),{browserStorageId:e,restore:`none`}}return i.mode===`persistent`?{browserStorageId:i.browserStorageId,restore:`none`}:void 0}getBrowserStorageId(e,t=Af(e,void 0)){let n=Ef(e,t),r=this.tabPersistenceStates.get(n);if(r!=null)return r.browserStorageId;let i=oe(`browser:${crypto.randomUUID()}`);return this.tabPersistenceStates.set(n,{browserStorageId:i,mode:`ephemeral`}),i}}",
};
assert.equal(browserStorageIdentityFeature.isApplied(browserStorageIdentityBundle), false);
browserStorageIdentityBundle = browserStorageIdentityFeature.apply(browserStorageIdentityBundle);
browserStorageIdentityFeature.verify(browserStorageIdentityBundle);
const browserStorageIdentityStore = runInNewContext(
  `${browserStorageIdentityBundle.webviewBrowserSidebarRuntime};new Store()`,
);
assert.equal(browserStorageIdentityStore.getBrowserStorageId("conversation"), "conversation");
assert.equal(
  browserStorageIdentityStore.getBrowserStorageId("conversation", "tab"),
  "conversation\0tab",
);
assert.equal(
  browserStorageIdentityStore.getBrowserStorageId("conversation"),
  browserStorageIdentityStore.getBrowserStorageId("conversation"),
);
const persistentPage = browserStorageIdentityStore.getPagePersistence(
  "persistent-conversation",
  "persistent-tab",
);
assert.equal(persistentPage.browserStorageId, "persistent-conversation\0persistent-tab");
assert.equal(persistentPage.restore, "none");

const upstreamBrowserRouteIdentity =
  "function AP(e){let t=e[OP]??e[`data-conversation-id`]??null,r=e[kP]??null;if(typeof t==`string`&&t.length>0)return{browserTabId:typeof r==`string`&&r.length>0?n.Mc(r):NP(t),conversationId:t};let i=MP(e.partition);if(i==null||!i.startsWith(`persist:codex-browser-app-route:`))return null;try{let e=decodeURIComponent(i.slice(n.es.length));if(e.length===0)return null;let[t,r]=e.split(`\\0`);return t==null||t.length===0?null:{browserTabId:r==null||r.length===0?NP(t):n.Mc(r),conversationId:t}}catch{return null}}";
const upstreamBrowserHostIdentity =
  "function jP(e){let t=e.partition;if(typeof t!=`string`)return null;let r=t.lastIndexOf(n.$o);if(r===-1)return null;let i=t.slice(r+n.$o.length),a=i.lastIndexOf(`:`);if(a===-1)return null;let o=i.slice(0,a),s=Number(i.slice(a+1));return o.length===0||!Number.isInteger(s)||s<=0?null:{hostGeneration:s,rendererInstanceId:o}}";
let browserSessionRoutingBundle = {
  main:
    "var OP=`data-browser-sidebar-conversation-id`,kP=`data-browser-sidebar-browser-tab-id`;function MP(e){if(e==null)return null;let t=e.lastIndexOf(n.$o);return t===-1?e:e.slice(0,t)}function NP(e){return n.Mc(`${e}:legacy`)}" +
    upstreamBrowserRouteIdentity +
    upstreamBrowserHostIdentity +
    "function OL({configureBrowserSession:e,params:t,preloadPath:n,webPreferences:r}){t.partition=oS(`app`),r.session=e(),r.preload=n,AL(t,r)}",
  webviewCoreSource:
    "function _x(e,t){return`${yx}${encodeURIComponent(`${e}\\0${t}`)}`}function vx(e,t,n,r){return`${_x(e,t)}${bx}${n}:${r}`}var yx=`persist:codex-browser-app-route:`,bx=`:host:`",
  webviewBrowserSidebarRuntime: [
    "f.setAttribute(`partition`,I(t,e,a,i))",
    "a.setAttribute(`partition`,I(t,e,this.rendererInstanceId,this.hostGeneration))",
    "this.webview.setAttribute(`partition`,I(r,e,d,o))",
    "this.webview.setAttribute(`partition`,I(t,e,this.rendererInstanceId,this.hostGeneration))",
  ].join(";"),
};
assert.equal(browserSessionRoutingFeature.isApplied(browserSessionRoutingBundle), true);
assert.equal(
  browserSessionRoutingFeature.apply(browserSessionRoutingBundle),
  browserSessionRoutingBundle,
);
browserSessionRoutingFeature.verify(browserSessionRoutingBundle);
const browserIdentityApi = runInNewContext(
  `${browserSessionRoutingBundle.main};({route:AP,host:jP})`,
  {
    n: {
      $o: ":host:",
      es: "persist:codex-browser-app-route:",
      Mc: (value) => value,
    },
  },
);
const routePartition =
  "persist:codex-browser-app-route:" +
  encodeURIComponent("conversation\0tab") +
  ":host:renderer:3";
const browserRouteIdentity = browserIdentityApi.route({
  partition: routePartition,
});
assert.equal(browserRouteIdentity.browserTabId, "tab");
assert.equal(browserRouteIdentity.conversationId, "conversation");
const browserHostIdentity = browserIdentityApi.host({
  partition: routePartition,
});
assert.equal(browserHostIdentity.hostGeneration, 3);
assert.equal(browserHostIdentity.rendererInstanceId, "renderer");
assert.equal(
  browserSessionRoutingFeature.isApplied({
    ...browserSessionRoutingBundle,
    webviewCoreSource:
      "function codexLinuxBrowserPartition(){return`persist:codex-browser-app`}",
  }),
  false,
);

let browserProfileImportBundle = {
  main:
    "function mS(){if(process.platform!==`darwin`&&process.platform!==`win32`||!i.o())return null;let e=process._linkedBinding;if(typeof e!=`function`)return null;let t;try{t=e.call(process,`electron_browser_owl_profile_importer`)}catch{return null}let n=fS.safeParse(t);return n.success?n.data.owlProfileImporter:null}",
  buildBrowserRuntimeSource: "var Dv=G([`atlas`,`chrome`]),Ov=W({source:Dv",
  webviewCoreSource: "wb=V([`atlas`,`chrome`]),z({source:wb",
  webviewBrowserProfileImportDialog:
    "M=typeof document<`u`&&document.documentElement.dataset.codexOs===`win32`,ee=typeof document<`u`&&document.documentElement.dataset.codexOs===`darwin`,N=M&&k?.source===`chrome`;function ke(e){let t=(0,Q.c)(10),{profile:n}=e,r;bb0:switch(n.source){case`atlas`:{let e;t[0]===Symbol.for(`react.memo_cache_sentinel`)?(e=(0,$.jsx)(`img`,{alt:``,className:`size-4 shrink-0 rounded-[22%]`,src:J}),t[0]=e):e=t[0],r=e;break bb0}case`chrome`:{let e;t[1]===Symbol.for(`react.memo_cache_sentinel`)?(e=(0,$.jsx)(ce,{className:`size-4 shrink-0`}),t[1]=e):e=t[1],r=e}}let i;No Chrome or Atlas profiles were found on this device;Import from your browser;Choose data to bring over to the built-in browser",
  webviewComputerUseProviderSettings:
    "Developer mode;Enable full CDP access;full Chrome DevTools Protocol (CDP) access",
};
assert.equal(browserProfileImportFeature.isApplied(browserProfileImportBundle), false);
browserProfileImportBundle = browserProfileImportFeature.apply(browserProfileImportBundle);
browserProfileImportFeature.verify(browserProfileImportBundle);
assert.equal(browserProfileImportBundle.main.includes("createLinuxBrowserProfileImporter"), true);
assert.equal(
  browserProfileImportBundle.webviewBrowserProfileImportDialog.includes(
    "document.documentElement.dataset.codexOs===`darwin`&&k?.source!==`onepassword`",
  ),
  true,
);
assert.equal(
  browserProfileImportBundle.buildBrowserRuntimeSource.includes(
    "G([`atlas`,`chrome`,`onepassword`])",
  ),
  true,
);
assert.equal(
  browserProfileImportBundle.webviewCoreSource.includes(
    "V([`atlas`,`chrome`,`onepassword`])",
  ),
  true,
);
assert.equal(
  browserProfileImportBundle.webviewBrowserProfileImportDialog.includes("case`onepassword`"),
  true,
);

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

const chromeNativeHostUpstreamSource = [
    "async function sync(e){let t=getName(e.pluginName),n=manifest(e.marketplacePath),s=pluginManifest(n),c=cacheRoot(e.pluginName);await install({codexHome:e.codexHome,devRuntimeRepoRoot:e.devRuntimeRepoRoot,extensionId:await readExtensionId(c),nativeHostName:t,pluginVersion:s.version,pluginRoot:c,resourcesPath:e.resourcesPath})}",
    "async function install(e){let t=target(),n=await resolveHost({pluginRoot:e.pluginRoot,target:t}),r=await runtime(e),s={browserClientPath:(0,p.join)(e.pluginRoot,`scripts`,`browser-client.mjs`),extensionHostPath:n,nodePath:r.nodePath}}",
  ].join("");
let chromeNativeHostStagingBundle = {
  buildBrowserRuntimeSource: chromeNativeHostUpstreamSource,
  buildChromeNativeHostSource: chromeNativeHostUpstreamSource,
};
assert.equal(chromeNativeHostStagingFeature.isApplied(chromeNativeHostStagingBundle), false);
chromeNativeHostStagingBundle = chromeNativeHostStagingFeature.apply(chromeNativeHostStagingBundle, {
  syncSharedBundleSource(sources, sourceKey, source) {
    assert.equal(sourceKey, "buildChromeNativeHostSource");
    return { ...sources, buildBrowserRuntimeSource: source, buildChromeNativeHostSource: source };
  },
});
chromeNativeHostStagingFeature.verify(chromeNativeHostStagingBundle);
assert.equal(
  chromeNativeHostStagingBundle.buildBrowserRuntimeSource,
  chromeNativeHostStagingBundle.buildChromeNativeHostSource,
);
assert.equal(
  chromeNativeHostStagingBundle.buildChromeNativeHostSource.includes(
    "codexLinuxChromePluginRoot=(0,p.join)(e.resourcesPath,`plugins`,`openai-bundled`,`plugins`,e.pluginName)",
  ),
  true,
);
assert.equal(
  chromeNativeHostStagingBundle.buildChromeNativeHostSource.includes(
    "pluginRoot:codexLinuxChromePluginRoot,target:t",
  ),
  true,
);
assert.equal(
  chromeNativeHostStagingBundle.buildChromeNativeHostSource.includes(
    "browserClientPath:(0,p.join)(codexLinuxChromePluginRoot,`scripts`,`browser-client.mjs`)",
  ),
  true,
);

let browserSecurityBundle = {
  main: [
    "ex=class extends a.P{codexHome;constructor(e){super(),this.codexHome=e}async updateOriginRules(e){let t=$b.parse(e),n=await cx(this.codexHome),r=t.map(e=>({...e,origin:e.action===`add`?sx(n,e.resource,e.origin):e.origin})),i=!1;for(let e of r)i=ox(n,e)||i;return i&&await ux(this.codexHome,n),fx(n)}};async function tx(e=n.ni()){return fx(await cx(e))}",
    "var Dt=class{browserSessionRegistry;constructor(e){this.browserSessionRegistry=e}setDesktopFeatureAvailability(e){e.inAppBrowserUse!=null&&this.browserSessionRegistry.setBrowserUseNativePipeEnabled(e.inAppBrowserUse)}dispose(){this.browserSessionRegistry.setBrowserUseNativePipeEnabled(!1)}},Ot=[];",
    "let Oe=new Dt(he.getBrowserSessionRegistry());M.add(()=>{Oe.dispose(),Te.dispose()});",
  ].join(""),
};
assert.equal(browserSecurityFeature.isApplied(browserSecurityBundle), false);
browserSecurityBundle = browserSecurityFeature.apply(browserSecurityBundle);
browserSecurityFeature.verify(browserSecurityBundle);
assert.equal(browserSecurityBundle.main.includes("return await tx(e)"), true);
assert.equal(
  browserSecurityBundle.main.includes(
    "await new ex(n).updateOriginRules([{action:`add`,kind:`allowed`,origin:e.origin,resource:e.kind===`origin`?`origin`:e.transferKind}])",
  ),
  true,
);
assert.equal(browserSecurityBundle.main.includes("Linux browser-use state unavailable"), false);
assert.equal(browserSecurityBundle.main.includes("Linux browser-use approval persist failed"), false);
assert.equal(browserSecurityBundle.main.includes("return await ux(e)"), false);
assert.equal(browserSecurityBundle.main.includes("await hx(`allowed`,e.origin,n)"), false);
assert.equal(browserSecurityBundle.main.includes("await gx(e.transferKind,`allowed`,e.origin,n)"), false);
assert.equal(browserSecurityBundle.main.includes("await bx(`allowed`,e.origin,n)"), false);
assert.equal(browserSecurityBundle.main.includes("await xx(e.transferKind,`allowed`,e.origin,n)"), false);

const browserApprovalPolicyStart = browserSecurityBundle.main.indexOf(
  "function codexLinuxNormalizeBrowserApprovalOrigin",
);
const browserApprovalPolicyEnd = browserSecurityBundle.main.indexOf(
  "function codexLinuxBrowserApprovalPrompt",
);
assert.notEqual(browserApprovalPolicyStart, -1);
assert.notEqual(browserApprovalPolicyEnd, -1);

let browserStateReadError = null;
let browserRuleUpdateError = null;
let browserState = {
  approvalMode: "neverAsk",
  historyApprovalMode: "neverAsk",
  downloadApprovalMode: "neverAsk",
  uploadApprovalMode: "neverAsk",
  allowedOrigins: [],
  deniedOrigins: [],
  allowedDownloadOrigins: [],
  deniedDownloadOrigins: [],
  allowedUploadOrigins: [],
  deniedUploadOrigins: [],
};
const browserStateReads = [];
const browserRuleUpdates = [];
const browserApprovalApi = runInNewContext(
  `${browserSecurityBundle.main.slice(browserApprovalPolicyStart, browserApprovalPolicyEnd)};({
    readState: codexLinuxReadBrowserUseState,
    resolvePolicy: codexLinuxResolveBrowserApprovalPolicy,
    remember: codexLinuxRememberBrowserApproval,
  })`,
  {
    URL,
    tx: async (codexHome) => {
      browserStateReads.push(codexHome);
      if (browserStateReadError) {
        throw browserStateReadError;
      }
      return browserState;
    },
    ex: class {
      constructor(codexHome) {
        this.codexHome = codexHome;
      }

      async updateOriginRules(rules) {
        if (browserRuleUpdateError) {
          throw browserRuleUpdateError;
        }
        browserRuleUpdates.push({ codexHome: this.codexHome, rules });
        const stateKeys = {
          origin: { allowed: "allowedOrigins", denied: "deniedOrigins" },
          download: { allowed: "allowedDownloadOrigins", denied: "deniedDownloadOrigins" },
          upload: { allowed: "allowedUploadOrigins", denied: "deniedUploadOrigins" },
        };
        for (const rule of rules) {
          const keys = stateKeys[rule.resource];
          const oppositeKind = rule.kind === "allowed" ? "denied" : "allowed";
          browserState[keys[rule.kind]] = [
            ...new Set([...browserState[keys[rule.kind]], rule.origin]),
          ];
          browserState[keys[oppositeKind]] = browserState[keys[oppositeKind]].filter(
            (origin) => origin !== rule.origin,
          );
        }
      }
    },
  },
);

assert.equal(
  (
    await browserApprovalApi.resolvePolicy(
      { kind: "origin", origin: "https://example.com" },
      "/tmp/codex-home",
    )
  ).action,
  "accept",
);
assert.deepEqual(browserStateReads, ["/tmp/codex-home"]);

browserStateReadError = new Error("state read failed");
await assert.rejects(
  browserApprovalApi.readState("/tmp/codex-home"),
  /state read failed/,
);
browserStateReadError = null;

browserState = {
  ...browserState,
  approvalMode: "alwaysAsk",
  historyApprovalMode: "alwaysAsk",
  downloadApprovalMode: "alwaysAsk",
  uploadApprovalMode: "alwaysAsk",
};
await browserApprovalApi.remember(
  { kind: "origin", origin: "https://example.com" },
  "/tmp/codex-home",
);
await browserApprovalApi.remember(
  { kind: "fileTransfer", transferKind: "download", origin: "https://files.example.com" },
  "/tmp/codex-home",
);
await browserApprovalApi.remember(
  { kind: "fileTransfer", transferKind: "upload", origin: "https://uploads.example.com" },
  "/tmp/codex-home",
);
assert.equal(browserRuleUpdates.length, 3);
assert.equal(browserRuleUpdates[0].codexHome, "/tmp/codex-home");
assert.equal(
  JSON.stringify(browserRuleUpdates[0].rules),
  JSON.stringify([
    {
      action: "add",
      kind: "allowed",
      origin: "https://example.com",
      resource: "origin",
    },
  ]),
);
assert.equal(
  JSON.stringify(browserRuleUpdates[1].rules),
  JSON.stringify([
    {
      action: "add",
      kind: "allowed",
      origin: "https://files.example.com",
      resource: "download",
    },
  ]),
);
assert.equal(
  JSON.stringify(browserRuleUpdates[2].rules),
  JSON.stringify([
    {
      action: "add",
      kind: "allowed",
      origin: "https://uploads.example.com",
      resource: "upload",
    },
  ]),
);

assert.equal(
  (
    await browserApprovalApi.resolvePolicy(
      { kind: "origin", origin: "https://example.com" },
      "/tmp/codex-home",
    )
  ).action,
  "accept",
);
assert.equal(
  (
    await browserApprovalApi.resolvePolicy(
      { kind: "fileTransfer", transferKind: "download", origin: "https://files.example.com" },
      "/tmp/codex-home",
    )
  ).action,
  "accept",
);
assert.equal(
  (
    await browserApprovalApi.resolvePolicy(
      { kind: "fileTransfer", transferKind: "upload", origin: "https://uploads.example.com" },
      "/tmp/codex-home",
    )
  ).action,
  "accept",
);
assert.equal(
  await browserApprovalApi.resolvePolicy(
    { kind: "origin", origin: "https://unlisted.example.com" },
    "/tmp/codex-home",
  ),
  null,
);

browserState = {
  ...browserState,
  approvalMode: "neverAsk",
  deniedOrigins: ["https://example.com"],
};
assert.equal(
  (
    await browserApprovalApi.resolvePolicy(
      { kind: "origin", origin: "https://example.com" },
      "/tmp/codex-home",
    )
  ).action,
  "decline",
);

browserRuleUpdateError = new Error("rule update failed");
await assert.rejects(
  browserApprovalApi.remember(
    { kind: "origin", origin: "https://example.com" },
    "/tmp/codex-home",
  ),
  /rule update failed/,
);
browserRuleUpdateError = null;

assert.throws(
  () =>
    browserSecurityFeature.apply({
      main: [
        "function yt({setBrowserUseNativePipeEnabled:e}){return{setDesktopFeatureAvailability:t=>{t.inAppBrowserUse!=null&&e(t.inAppBrowserUse)},dispose:()=>{e(!1)}}}",
        "let ke=yt({setBrowserUseNativePipeEnabled:e=>{_e.getBrowserSessionRegistry().setBrowserUseNativePipeEnabled(e)}});P.add(()=>{ke.dispose(),Ee.dispose()});",
      ].join(""),
    }),
  /Current Browser Use state API anchor matched 0 times/,
);

let chromeSetupBundle = {
  webviewPluginAvailability: [
    "chromeIcon=`assets/google-chrome.png`,extensionAsset=`scripts/extension-id.json`,buildUrl=`https://chromewebstore.google.com/detail/codex/`,allowedBrowsers=makeSet([`chrome`,`chrome-dev`,`chrome-internal`]),",
    "id:extensionId,name:`ChatGPT for Chrome`,url:`${buildUrl}${extensionId}`",
  ].join(";"),
  webviewPluginDetail:
    "onClick:event=>{openBrowser({event:event,href:plugin.url,initiator:`open_in_browser_bridge`,openTarget:`external-browser`})},children:(0,detailJsx.jsx)(DetailButton,{id:`plugins.detail.setup.openBrowserExtension`",
};
assert.equal(chromeSetupUrlFeature.isApplied(chromeSetupBundle), false);
chromeSetupBundle = chromeSetupUrlFeature.apply(chromeSetupBundle);
chromeSetupUrlFeature.verify(chromeSetupBundle);
assert.equal(chromeSetupBundle.webviewPluginAvailability.includes("encodeURIComponent"), true);
assert.equal(chromeSetupBundle.webviewPluginDetail.includes("plugin_browser_extension_setup"), true);

let computerUseSettingsBundle = {
  webviewComputerUseSettings:
    "function Wt(e){let t=(0,Z.c)(35),{computerUseAvailability:n,platform:i}=e;t[5]!==v||t[6]!==_.availablePlugins?(x=K(_.availablePlugins,fn,v),t[5]=v,t[6]=_.availablePlugins,t[7]=x):x=t[7];let S=x,C;",
  webviewComputerUseProviderSettings:
    "function Oi(e,t,n){let r=e.filter(e=>e.plugin.name===t||e.plugin.id.split(`@`)[0]===t),i=y(Pt());return(i==null?void 0:r.find(e=>e.marketplaceName===i))??r.find(e=>re(e.marketplaceName))??r.find(e=>e.marketplaceName===`openai-curated`)??r.find(e=>Wt(n,e.marketplacePath))??null}",
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
  computerUseSettingsBundle.webviewComputerUseProviderSettings.includes("t===`computer-use`"),
  true,
);
assert.equal(
  computerUseSettingsBundle.webviewComputerUseSettings.includes(
    "K([..._.availablePlugins,..._.installedPlugins],fn,v)",
  ),
  true,
);
assert.equal(
  computerUseSettingsBundle.webviewComputerUseSettings.includes("codexLinuxComputerUseProvider"),
  false,
);

let computerUseAvailabilityBundle = {
  webviewPluginFeatureGate:
    "function _p(e){return e===`macOS`||e===`windows`}function vp(e){let t=(0,Sp.c)(16),{enabled:n,hostId:r}=e,i=n===void 0?!0:n,{isLoading:a,platform:o}=ba(),s=gr(`1506311413`),c;t[0]===r?c=t[1]:(c={featureName:`computer_use`,hostId:r},t[0]=r,t[1]=c);let l=mp(c),u=o===`windows`&&!a,d=i&&u,f;t[2]===d?f=t[3]:(f={enabled:d},t[2]=d,t[3]=f);let p=yp(f),m=l.isLoading||u&&p.isLoading,h=l.enabled&&(!u||p.enabled),g;t[4]!==h||t[5]!==i||t[6]!==m||t[7]!==s||t[8]!==a||t[9]!==o?(g=xp({areRequiredFeaturesEnabled:h,enabled:i,isAnyFeatureLoading:m,isComputerUseGateEnabled:s,isHostCompatiblePlatform:_p(o),isPlatformLoading:a,windowType:`electron`}),t[4]=h,t[5]=i,t[6]=m,t[7]=s,t[8]=a,t[9]=o,t[10]=g):g=t[10]}",
};
assert.equal(computerUseAvailabilityFeature.isApplied(computerUseAvailabilityBundle), false);
computerUseAvailabilityBundle = computerUseAvailabilityFeature.apply(computerUseAvailabilityBundle);
computerUseAvailabilityFeature.verify(computerUseAvailabilityBundle);
assert.equal(
  computerUseAvailabilityBundle.webviewPluginFeatureGate.includes(
    "function _p(e){return e===`macOS`||e===`windows`||e===`linux`}",
  ),
  true,
);
assert.equal(
  computerUseAvailabilityBundle.webviewPluginFeatureGate.includes(
    "isComputerUseGateEnabled:s||o===`linux`,isHostCompatiblePlatform:_p(o)",
  ),
  true,
);

let settingsSidebarBundle = {
  webviewSettingsPage:
    "className:`app-shell-left-panel relative flex min-h-0 shrink-0 flex-col overflow-hidden w-token-sidebar`",
};
assert.equal(settingsSidebarSurfaceFeature.isApplied(settingsSidebarBundle), false);
settingsSidebarBundle = settingsSidebarSurfaceFeature.apply(settingsSidebarBundle);
settingsSidebarSurfaceFeature.verify(settingsSidebarBundle);
assert.equal(settingsSidebarBundle.webviewSettingsPage.includes("app-shell-left-panel"), true);
assert.equal(settingsSidebarBundle.webviewSettingsPage.includes("window-fx-sidebar-surface"), true);

let settingsSuggestedPromptsBundle = {
  webviewGeneralSettings: [
    "function _i(){let e=(0,vi.c)(12),t=F(d),n=H(),{authMethod:r,email:i,planAtLogin:a}=_t(),o=r===`chatgpt`,s;e[0]===o?s=e[1]:(s={queryConfig:{enabled:o}},e[0]=o,e[1]=s);let{data:c}=te(`account-info`,s),l=U(x.enabled);if(!v({authMethod:r,email:c?.email??i,plan:c?.plan??a}))return null;let u,f;e[2]===Symbol.for(`react.memo_cache_sentinel`)?(u=(0,yi.jsx)(V,{...K.suggestedPrompts}),f=(0,yi.jsx)(V,{id:`settings.agent.ambientSuggestions.rowLabel`,defaultMessage:`Suggest what to do next by searching project files and connected apps`,description:`Description for the ambient suggestions setting row`}),e[2]=u,e[3]=f):(u=e[2],f=e[3]);let p=l===!0,m;e[4]===n?m=e[5]:(m=n.formatMessage({id:`settings.agent.ambientSuggestions.toggleLabel`,defaultMessage:`Enable ambient suggestions`,description:`Aria label for the ambient suggestions toggle`}),e[4]=n,e[5]=m)}",
    "function Vi(){let e=(0,Q.c)(51),t=F(`824038554`),n=F(`2423536643`),r=F(`1244621283`),a=F(`1372061905`),o=F(`4100906017`),s=F(`2425897452`),l=$t(c),{data:u,isLoading:d}=N(i),p=N(f),m=N(ee),h;}",
  ].join(""),
  webviewAmbientSuggestionsEligibility:
    "function qS({authMethod:e,email:t,plan:n}){return e===`apikey`?!0:e===`chatgpt`?JS({email:t,plan:n}):!1}function JS({email:e,plan:t}){return YS(e)||XS.some(e=>e===t)}function YS(e){return e?.toLowerCase().endsWith(`@openai.com`)===!0}var XS,ZS=e((()=>{KS(),XS=[`plus`,`pro`,`business`,`team`,`self_serve_business_usage_based`]}));",
};
assert.equal(settingsSuggestedPromptsFeature.isApplied(settingsSuggestedPromptsBundle), false);
settingsSuggestedPromptsBundle = settingsSuggestedPromptsFeature.apply(
  settingsSuggestedPromptsBundle,
);
settingsSuggestedPromptsFeature.verify(settingsSuggestedPromptsBundle);
assert.equal(settingsSuggestedPromptsBundle.webviewGeneralSettings.includes("s=F(`2425897452`)"), false);
assert.equal(
  settingsSuggestedPromptsBundle.webviewGeneralSettings.includes("s=!0,l=$t(c)"),
  true,
);
assert.equal(
  settingsSuggestedPromptsBundle.webviewGeneralSettings.includes(
    "if(!v({authMethod:r,email:c?.email??i,plan:c?.plan??a}))return null",
  ),
  true,
);
assert.equal(
  settingsSuggestedPromptsBundle.webviewAmbientSuggestionsEligibility.includes(
    "XS=[`plus`,`pro`,`prolite`,`business`,`team`,`self_serve_business_usage_based`]",
  ),
  true,
);
assert.equal(
  settingsSuggestedPromptsBundle.webviewAmbientSuggestionsEligibility.includes(
    "XS=[`plus`,`pro`,`business`,`team`,`self_serve_business_usage_based`]",
  ),
  false,
);

const patchedOpenTargetsAnchor = openTargetsFeature.getPatchedGhosttyAnchor();
assert.equal(patchedOpenTargetsAnchor.includes("detect:()=>Os(`gwenview`)"), true);
assert.equal(patchedOpenTargetsAnchor.includes("detect:()=>Os(`typora`)??Os(`typora-x11-fcitx`)"), true);
assert.equal(patchedOpenTargetsAnchor.includes("codexLinuxWpsTarget"), true);
assert.equal(patchedOpenTargetsAnchor.includes("label:`WPS`"), true);
assert.equal(patchedOpenTargetsAnchor.includes("codexLinuxOfficeRemoteAppTarget"), true);
assert.equal(patchedOpenTargetsAnchor.includes("label:`office(RemoteApp)`"), true);
assert.equal(patchedOpenTargetsAnchor.includes("codexLinuxWpsWriterTarget"), false);
assert.equal(patchedOpenTargetsAnchor.includes("WPS Writer"), false);
assert.equal(patchedOpenTargetsAnchor.includes("codexLinuxDefaultAppIconForPath"), true);
assert.equal(patchedOpenTargetsAnchor.includes('"wpso"'), true);
assert.equal(patchedOpenTargetsAnchor.includes('"dpss"'), true);
assert.equal(patchedOpenTargetsAnchor.includes("codexLinuxRemoteWordExtensions"), true);
assert.equal(patchedOpenTargetsAnchor.includes("codexLinuxRemoteAppName"), true);
assert.equal(patchedOpenTargetsAnchor.includes("detect:()=>Fi(`"), false);
assert.equal(patchedOpenTargetsAnchor.includes("data:image/svg+xml"), false);
assert.equal(patchedOpenTargetsAnchor.includes("data:image/x-xpixmap"), false);
const patchedWorkerOpenTargetsAnchor = openTargetsFeature.getPatchedWorkerGhosttyAnchor();
assert.equal(patchedWorkerOpenTargetsAnchor.includes("detect:()=>G7(`gwenview`)"), true);
assert.equal(
  patchedWorkerOpenTargetsAnchor.includes("detect:()=>G7(`typora`)??G7(`typora-x11-fcitx`)"),
  true,
);
assert.equal(patchedWorkerOpenTargetsAnchor.includes("codexLinuxWpsTarget"), true);
assert.equal(patchedWorkerOpenTargetsAnchor.includes("codexLinuxOfficeRemoteAppTarget"), true);
assert.equal(patchedWorkerOpenTargetsAnchor.includes("codexLinuxWpsWriterTarget"), false);
assert.equal(patchedWorkerOpenTargetsAnchor.includes("await q7(n,[e])"), true);
assert.equal(patchedWorkerOpenTargetsAnchor.includes("await q7(n,[`open`,t,e])"), true);
assert.equal(patchedWorkerOpenTargetsAnchor.includes("detect:()=>Fi(`"), false);
assert.equal(patchedWorkerOpenTargetsAnchor.includes("data:image/svg+xml"), false);
assert.equal(patchedWorkerOpenTargetsAnchor.includes("data:image/x-xpixmap"), false);

let openTargetsBundle = {
  main: [
    "u1=j$({id:`fileManager`,label:`Finder`,icon:`apps/finder.png`,kind:`fileManager`,darwin:{detect:()=>`open`,args:e=>As(e)},win32:{label:`File Explorer`,icon:`apps/file-explorer.png`,detect:d1,args:e=>As(e),open:async({path:e})=>f1(e)}});function d1(){let e=process.env.SystemRoot??process.env.windir;if(e){let t=(0,d.join)(e,`explorer.exe`);if((0,h.existsSync)(t))return t}return`explorer.exe`}async function f1(e){let{shell:t}=await import(`electron`),n=p1(e);if(n&&(0,h.statSync)(n).isFile()){t.showItemInFolder(n);return}let r=n??e,i=await t.openPath(r);if(i)throw Error(i)}function p1(e){let t=e;for(;;){if((0,h.existsSync)(t))return t;let e=(0,d.dirname)(t);if(e===t)return null;t=e}}",
    "var a0=M$({id:`vscode`,label:`VS Code`,icon:`apps/vscode.png`,darwinDetect:()=>C$([`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`,`/Applications/Code.app/Contents/Resources/app/bin/code`]),win32Detect:o0});function o0()",
    "j1=F1({id:`pycharm`,label:`PyCharm`,icon:`apps/pycharm.png`,toolboxTarget:`pycharm`,macExecutable:`pycharm`,windowsPathCommands:[`pycharm64.exe`,`pycharm.exe`,`pycharm`],windowsInstallDirPrefixes:[`pycharm`],windowsInstallExecutables:[`pycharm64.exe`,`pycharm.exe`]}),M1=F1({id:`webstorm`,label:`WebStorm`,icon:`apps/webstorm.svg`,toolboxTarget:`webstorm`,macExecutable:`webstorm`,windowsPathCommands:[`webstorm64.exe`,`webstorm.exe`,`webstorm`],windowsInstallDirPrefixes:[`webstorm`],windowsInstallExecutables:[`webstorm64.exe`,`webstorm.exe`]}),N1=F1({id:`phpstorm`,label:`PhpStorm`,icon:`apps/phpstorm.png`,toolboxTarget:`phpstorm`,macExecutable:`phpstorm`,windowsPathCommands:[`phpstorm64.exe`,`phpstorm.exe`,`phpstorm`],windowsInstallDirPrefixes:[`phpstorm`],windowsInstallExecutables:[`phpstorm64.exe`,`phpstorm.exe`]});function P1",
    "var m1=z$({id:`ghostty`,label:`Ghostty`,icon:`apps/ghostty.png`,appPaths:[`/Applications/Ghostty.app`],appName:`Ghostty`}),",
    "var E0=[a0,s0,r0,a1,I$,l1,q1,x0,u0,P$,v1,X1,u1,R$,h1,r1,f0,b1,U1,m1,l0,g0,E1,D1,O1,k1,A1,j1,M1,N1,$1];",
    "async getTargets({cwd:e,deferEnrichment:t=!1,hostId:r,nativeBrowserDiscovery:i=`scan`,path:a}){let{hostConfig:o}=this.executionHostRegistry.get(r??void 0);if(t&&a==null){let t=U0(this.settingsStore,e);return{preferredTarget:t,availableTargets:[],mode:`editor`,targets:r$(F0(this.settingsStore),o).map(({id:e,label:n,icon:r,kind:i,hidden:a})=>({id:e,target:e,label:n,icon:r,kind:i,hidden:a,default:t===e||void 0}))}}let{allAvailableTargets:s,targetMetadata:c}=await L0(this.settingsStore,this.#n()),l=a?.replace(/^([ab])[\\\\/]/,``)??null,u=l!=null&&e2(l)&&!n.ho(o),d=l==null||u||n.ho(o)?null:Ij(le(l,o)??l,le(e,o)??ut(this.globalState)),f=n$(o,s,c),p=new Set(f),m=H0(this.settingsStore,e,p),h=u||d!=null&&n.Fs(d),g=d!=null&&VQ(d),_=[];return h?_=await Q0(i):d!=null&&zQ(d)&&(_=await Z0(d)),{preferredTarget:m,availableTargets:Array.from(p),mode:h||g?`native`:`editor`,targets:[...c.map(({id:e,label:t,icon:n,kind:r,hidden:i})=>({id:e,target:e,label:t,icon:n,kind:r,hidden:i,available:p.has(e),default:m===e||void 0})),..._]}}loadTargetIcon",
  ].join(""),
  worker: [
    "ade=x9({id:`fileManager`,label:`Finder`,icon:`apps/finder.png`,kind:`fileManager`,darwin:{detect:()=>`open`,args:e=>K7(e)},win32:{label:`File Explorer`,icon:`apps/file-explorer.png`,detect:ode,args:e=>K7(e),open:async({path:e})=>sde(e)}});function ode(){let e=process.env.SystemRoot??process.env.windir;if(e){let t=(0,E.join)(e,`explorer.exe`);if((0,w.existsSync)(t))return t}return`explorer.exe`}async function sde(e){let{shell:t}=await import(`electron`),n=cde(e);if(n&&(0,w.statSync)(n).isFile()){t.showItemInFolder(n);return}let r=n??e,i=await t.openPath(r);if(i)throw Error(i)}function cde(e){let t=e;for(;;){if((0,w.existsSync)(t))return t;let e=(0,E.dirname)(t);if(e===t)return null;t=e}}",
    "var qde=S9({id:`vscode`,label:`VS Code`,icon:`apps/vscode.png`,darwinDetect:()=>$7([`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`,`/Applications/Code.app/Contents/Resources/app/bin/code`]),win32Detect:Jde});function Jde()",
    "Tde=N9({id:`pycharm`,label:`PyCharm`,icon:`apps/pycharm.png`,toolboxTarget:`pycharm`,macExecutable:`pycharm`,windowsPathCommands:[`pycharm64.exe`,`pycharm.exe`,`pycharm`],windowsInstallDirPrefixes:[`pycharm`],windowsInstallExecutables:[`pycharm64.exe`,`pycharm.exe`]}),Ede=N9({id:`webstorm`,label:`WebStorm`,icon:`apps/webstorm.svg`,toolboxTarget:`webstorm`,macExecutable:`webstorm`,windowsPathCommands:[`webstorm64.exe`,`webstorm.exe`,`webstorm`],windowsInstallDirPrefixes:[`webstorm`],windowsInstallExecutables:[`webstorm64.exe`,`webstorm.exe`]}),Dde=N9({id:`phpstorm`,label:`PhpStorm`,icon:`apps/phpstorm.png`,toolboxTarget:`phpstorm`,macExecutable:`phpstorm`,windowsPathCommands:[`phpstorm64.exe`,`phpstorm.exe`,`phpstorm`],windowsInstallDirPrefixes:[`phpstorm`],windowsInstallExecutables:[`phpstorm64.exe`,`phpstorm.exe`]});function Ode",
    "var lde=T9({id:`ghostty`,label:`Ghostty`,icon:`apps/ghostty.png`,appPaths:[`/Applications/Ghostty.app`],appName:`Ghostty`}),",
    "var ufe=new Map([qde,Yde,Gde,tde,zue,ide,Ide,afe,Qde,Lue,pde,zde,ade,Bue,ude,$ue,$de,hde,Pde,lde,Zde,nfe,bde,xde,Sde,Cde,wde,Tde,Ede,Dde,Vde].flatMap(e=>{let t=e.platforms[process.platform];return t==null?[]:[[e.id,{id:e.id,...t}]]}));",
  ].join(""),
  webviewOpenTargetSelection:
    "function Uj({targets:e,availableTargets:t,includeHiddenTargets:n=!1,mode:r=`editor`}){let i=e.filter(e=>e.appPath!=null);if(i.length>0)return i;if(r===`native`)return e.filter(e=>e.target===`systemDefault`||e.target===`fileManager`);let a=new Set(t);return e.filter(e=>a.has(e.target)&&(n||!e.hidden))}function Wj({preferredTarget:e,targets:t,availableTargets:n,includeHiddenTargets:r=!0,mode:i=`editor`}){let a=Uj({targets:t,availableTargets:n,includeHiddenTargets:r,mode:i});return a.length===0?null:e?a.find(t=>t.target===e)??a[0]??null:a[0]??null}async function Fnn(){let r,i,t,a,n;if(a==null){let e={...i,targets:i.targets.map(e=>({...e,available:!1,resolvedIcon:null}))};return t.setQueryData(r,e),e}return await Promise.all(i.targets.map(async e=>{e6(t,r,e.id,n,{available:!1,resolvedIcon:null})}))}",
  webviewOpenTargetNativeMenu:
    "(0,Oh.jsx)(An,{awaitBeforeOpen:!1,getItems:Ae,onBeforeOpen:je,children:Pe})",
  webviewOpenTargetResourceActions:
    "function Rsn(e){return e.target===`systemDefault`&&e.appPath!=null&&e.kind===`native`}function jsn(e){return e.default===!0&&e.kind===`native`&&e.appPath!=null}",
};
assert.equal(openTargetsFeature.isApplied(openTargetsBundle), false);
openTargetsBundle = openTargetsFeature.apply(openTargetsBundle);
openTargetsFeature.verify(openTargetsBundle);
assert.equal(openTargetsBundle.main.includes("await ps(e,[`--new-window`"), false);
assert.equal(openTargetsBundle.main.includes("await ps(e,[`--select`,n]);return}await ps(e,[n??t])"), false);
assert.equal(openTargetsBundle.main.includes("codex-dolphin-file-manager"), true);
assert.equal(
	  openTargetsBundle.main.includes(
          "(0,h.existsSync)((0,d.join)(process.resourcesPath,`codex-dolphin-file-manager`))&&(()=>{let e=process.env.CODEX_DOLPHIN_BIN?.trim();return e?e.includes(`/`)?(0,h.existsSync)(e):Os(e):Os(`dolphin`)})()?(0,d.join)(process.resourcesPath,`codex-dolphin-file-manager`):null",
	  ),
  true,
);
assert.equal(openTargetsBundle.main.includes("open:async({command:e,path:t})=>{await Ns(e,[t])}"), true);
assert.equal(openTargetsBundle.main.includes("let t=dP(s,e)"), false);
assert.equal(openTargetsBundle.main.includes("Ej(rP(s),o.hostConfig)"), false);
assert.equal(
	openTargetsBundle.main.includes(
          "{allAvailableTargets:s,targetMetadata:c}=await L0(this.settingsStore,this.#n())",
	  ),
  true,
);
assert.equal(openTargetsBundle.main.includes("availableTargets:[]"), false);
assert.equal(openTargetsBundle.worker.includes("await J7(e,[`--new-window`"), false);
assert.equal(openTargetsBundle.worker.includes("codex-dolphin-file-manager"), true);
assert.equal(
	  openTargetsBundle.worker.includes(
	    "(0,w.existsSync)((0,E.join)(process.resourcesPath,`codex-dolphin-file-manager`))&&(()=>{let e=process.env.CODEX_DOLPHIN_BIN?.trim();return e?e.includes(`/`)?(0,w.existsSync)(e):G7(e):G7(`dolphin`)})()?(0,E.join)(process.resourcesPath,`codex-dolphin-file-manager`):null",
	  ),
  true,
);
assert.equal(openTargetsBundle.worker.includes("open:async({command:e,path:t})=>{await q7(e,[t])}"), true);
assert.equal(openTargetsBundle.main.includes("var E0=[a0,s0"), true);
assert.equal(openTargetsBundle.worker.includes("var ufe=new Map([qde,Yde"), true);
assert.equal(openTargetsBundle.worker.includes("codexLinuxClionTarget,Tde"), true);
assert.equal(
  openTargetsBundle.main.includes("codexLinuxDefaultAppIconForPath(d??l)"),
  true,
);
assert.equal(openTargetsBundle.main.includes("e===`systemDefault`&&v!=null"), true);
assert.equal(openTargetsBundle.main.includes("codexLinuxWpsTarget"), true);
assert.equal(openTargetsBundle.worker.includes("codexLinuxWpsTarget"), true);
assert.equal(openTargetsBundle.main.includes("codexLinuxOfficeRemoteAppTarget"), true);
assert.equal(openTargetsBundle.worker.includes("codexLinuxOfficeRemoteAppTarget"), true);
assert.equal(openTargetsBundle.main.includes("codexLinuxWpsWriterTarget"), false);
assert.equal(openTargetsBundle.worker.includes("codexLinuxWpsWriterTarget"), false);
assert.equal(openTargetsBundle.main.includes("WPS Writer"), false);
assert.equal(openTargetsBundle.worker.includes("WPS Writer"), false);
assert.equal(openTargetsBundle.webviewOpenTargetSelection.includes("if(r===`native`&&!n)return"), true);
assert.equal(openTargetsBundle.webviewOpenTargetSelection.includes("if(r===`native`)return"), false);
assert.equal(openTargetsBundle.webviewOpenTargetNativeMenu.includes("awaitBeforeOpen:!0"), true);
assert.equal(openTargetsBundle.webviewOpenTargetNativeMenu.includes("awaitBeforeOpen:!1"), false);
assert.equal(
  openTargetsBundle.webviewOpenTargetResourceActions.includes(
    "function Rsn(e){return e.target===`systemDefault`&&e.kind===`native`}",
  ),
  true,
);
assert.equal(
  openTargetsBundle.webviewOpenTargetResourceActions.includes(
    "function jsn(e){return e.default===!0&&e.kind===`native`}",
  ),
  true,
);
assert.equal(
  openTargetsBundle.webviewOpenTargetResourceActions.includes(
    "function Rsn(e){return e.target===`systemDefault`&&e.appPath!=null&&e.kind===`native`}",
  ),
  false,
);
assert.equal(
  openTargetsBundle.webviewOpenTargetResourceActions.includes(
    "function jsn(e){return e.default===!0&&e.kind===`native`&&e.appPath!=null}",
  ),
  false,
);
assert.throws(
  () =>
    openTargetsFeature.verify({
      ...openTargetsBundle,
      main: openTargetsBundle.main.replace("codexLinuxDefaultAppIconForPath(d??l)", "null"),
    }),
  /Linux main open-target response and ordering patch is missing required markers/,
);
assert.throws(
  () =>
    openTargetsFeature.verify({
      ...openTargetsBundle,
      main: openTargetsBundle.main.replace("e===`systemDefault`&&v!=null", "false"),
    }),
  /Linux main open-target response and ordering patch is missing required markers/,
);
assert.throws(
  () =>
    openTargetsFeature.verify({
	      ...openTargetsBundle,
              main: openTargetsBundle.main.replace("var E0=[a0,s0", "var E0=[s0"),
    }),
  /Linux main open-target response and ordering patch is missing required markers/,
);
assert.throws(
  () =>
    openTargetsFeature.verify({
	      ...openTargetsBundle,
          worker: openTargetsBundle.worker.replace("var ufe=new Map([qde,Yde", "var ufe=new Map([Yde"),
    }),
  /Linux worker open-target ordering patch is missing required markers/,
);
assert.throws(
  () =>
    openTargetsFeature.verify({
      ...openTargetsBundle,
      webviewOpenTargetSelection: openTargetsBundle.webviewOpenTargetSelection.replace(
        "if(r===`native`&&!n)return e.filter(e=>e.target===`systemDefault`||e.target===`fileManager`)",
        "if(r===`native`)return e.filter(e=>e.target===`systemDefault`||e.target===`fileManager`)",
      ),
    }),
  /Linux webview open-target selection patch/,
);
assert.throws(
  () =>
    openTargetsFeature.verify({
      ...openTargetsBundle,
      webviewOpenTargetNativeMenu: openTargetsBundle.webviewOpenTargetNativeMenu.replace(
        "awaitBeforeOpen:!0",
        "awaitBeforeOpen:!1",
      ),
    }),
  /Linux webview open-target native menu patch/,
);
assert.throws(
  () =>
    openTargetsFeature.verify({
      ...openTargetsBundle,
      webviewOpenTargetResourceActions: openTargetsBundle.webviewOpenTargetResourceActions.replace(
        "function Rsn(e){return e.target===`systemDefault`&&e.kind===`native`}",
        "function Rsn(e){return e.target===`systemDefault`&&e.appPath!=null&&e.kind===`native`}",
      ),
    }),
  /Linux webview open-target resource action patch/,
);
assert.throws(
  () =>
    openTargetsFeature.verify({
      ...openTargetsBundle,
      main:
        openTargetsBundle.main +
        "ls(`gdbus`)?(0,s.join)(process.resourcesPath,`codex-dolphin-file-manager`):null",
    }),
  /Linux open-target patch still contains forbidden markers/,
);
assert.throws(
  () =>
    openTargetsFeature.verify({
      ...openTargetsBundle,
      worker:
        openTargetsBundle.worker +
        "K7(`gdbus`)?(0,E.join)(process.resourcesPath,`codex-dolphin-file-manager`):null",
    }),
  /Linux worker open-target patch still contains forbidden markers/,
);

console.error("[INFO] Linux runtime patch locator tests passed");
