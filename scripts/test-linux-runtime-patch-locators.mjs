#!/usr/bin/env node

import assert from "node:assert/strict";
import { browserUseFeature } from "./linux-runtime/features/browser-use.mjs";
import { chromeExtensionStatusFeature } from "./linux-runtime/features/chrome-extension-status.mjs";
import { chromeSetupUrlFeature } from "./linux-runtime/features/chrome-setup-url.mjs";
import { conversationLocalImagesFeature } from "./linux-runtime/features/conversation-local-images.mjs";
import { conversationModelSelectorFeature } from "./linux-runtime/features/conversation-model-selector.mjs";
import { directiveStripFeature } from "./linux-runtime/features/directive-strip.mjs";
import { localImageCacheRefreshFeature } from "./linux-runtime/features/local-image-cache-refresh.mjs";
import { openTargetsFeature } from "./linux-runtime/features/open-targets.mjs";
import { pluginMcpReloadFeature } from "./linux-runtime/features/plugin-mcp-reload.mjs";
import { preferencesFeature } from "./linux-runtime/features/preferences.mjs";
import { remoteControlBackendFeature } from "./linux-runtime/features/remote-control-backend.mjs";
import { remoteControlVisibilityFeature } from "./linux-runtime/features/remote-control-visibility.mjs";
import { settingsSidebarSurfaceFeature } from "./linux-runtime/features/settings-sidebar-surface.mjs";
import { workingSessionsStatusFeature } from "./linux-runtime/features/working-sessions-status.mjs";

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

let preferenceBundle = {
  main: '"set-preferred-app":async({target:selected})=>(persist(this.getSettingsStore(),null,selected),{success:!0})',
};
assert.equal(preferencesFeature.isApplied(preferenceBundle), false);
preferenceBundle = preferencesFeature.apply(preferenceBundle);
preferencesFeature.verify(preferenceBundle);
assert.equal(preferenceBundle.main.includes("codexLinuxPreferredTargetCwd??null"), true);

let modelSettingsBundle = {
  webviewModelSettings:
    "function useModelSettings(input=null){let queryCtx=useCtx(ctxToken),queryClient=queryCtx.queryClient,conversationCtx=readConversation(input),host=conversationCtx.hostId,isRegistered=readRegistration(registry,host),details=readDetails(host),localState=readLocalState(),cwd=conversationCtx.cwd,modelQuery=readModelQuery({hostId:host,cwd:cwd,isHostRegistered:isRegistered})",
};
assert.equal(conversationModelSelectorFeature.isApplied(modelSettingsBundle), false);
modelSettingsBundle = conversationModelSelectorFeature.apply(modelSettingsBundle);
conversationModelSelectorFeature.verify(modelSettingsBundle);
assert.equal(modelSettingsBundle.webviewModelSettings.includes("cwd=input==null?null:conversationCtx.cwd"), true);

let directiveBundle = {
  webviewFollowUp: "var hiddenDirectiveRegex=/^::[a-zA-Z0-9-]+.*$/gm;",
};
assert.equal(directiveStripFeature.isApplied(directiveBundle), false);
directiveBundle = directiveStripFeature.apply(directiveBundle);
directiveStripFeature.verify(directiveBundle);
assert.equal(directiveBundle.webviewFollowUp.includes("git-create-pr"), true);

let imageCacheBundle = {
  webviewMarkdown: "queryConfig:{enabled:isEnabled,gcTime:1/0,staleTime:1/0}",
  webviewUsePlugins: "queryKey:queryKeyFor(`read-file-binary`,filePath),retry:!1,gcTime:1/0,staleTime:constants.INFINITE",
};
assert.equal(localImageCacheRefreshFeature.isApplied(imageCacheBundle), false);
imageCacheBundle = localImageCacheRefreshFeature.apply(imageCacheBundle);
localImageCacheRefreshFeature.verify(imageCacheBundle);
assert.equal(imageCacheBundle.webviewMarkdown.includes("refetchOnMount:`always`"), true);
assert.equal(imageCacheBundle.webviewUsePlugins.includes("staleTime:0"), true);

let conversationImageBundle = {
  webviewFollowUp: [
    "case`imageGeneration`:a.push({type:`generated-image`,id:n.id,src:n.src,status:n.status});break;",
    "case`imageView`:{let e=Cx(n.path),r=e==null?null:sx(e,`Image`);if(r==null)break;let i=t===f?l:null;if(p!=null){p.content=`${p.content}\\n${r}`,p.sentAtMs=i;break}p={type:`assistant-message`,content:r,sentAtMs:i,completed:!0,phase:null,renderPlaceholderWhileStreaming:!1,structuredOutput:void 0},a.push(p);break}",
    "case`imageView`:return Cx(e.path)!=null;",
  ].join(""),
  webviewUsePlugins:
    "function C(e){if(e==null)return null;let t=e.trim();if(t.length===0)return null;let n=t.toLowerCase();if(n.startsWith(`data:`)||n.startsWith(`http:`)||n.startsWith(`https:`)||n.startsWith(`file:`)||n.startsWith(`vscode-resource:`)||n.startsWith(`vscode-webview:`)||n.startsWith(`vscode-file:`))return null;let r=a(t);return d(r)?r:null}",
};
assert.equal(conversationLocalImagesFeature.isApplied(conversationImageBundle), false);
conversationImageBundle = conversationLocalImagesFeature.apply(conversationImageBundle);
conversationLocalImagesFeature.verify(conversationImageBundle);
assert.equal(conversationImageBundle.webviewFollowUp.includes("codexImageViewId"), true);
assert.equal(conversationImageBundle.webviewFollowUp.includes("app://fs/@fs"), true);
assert.equal(conversationImageBundle.webviewUsePlugins.includes("typeof e!==`string`"), true);

let remoteVisibilityBundle = {
  webviewPluginAvailability: "",
  webviewRemoteControlConnectionsVisibility:
    "function connectionsVisible({remoteControlConnectionsState:state,slingshotEnabled:flag}){return flag&&(state?.available??!0)&&state?.accessRequired!==!0}",
  webviewRemoteConnectionVisibility:
    "function remoteGate(){let cache=(0,react.c)(3),{data:data}=read(queryClient,key(arg)),statsig=readGate(`4114442250`);if(data?.config[`features.remote_connections`]===!0)return!0;let features=data?.config.features;if(typeof features!=`object`||!features||Array.isArray(features))return statsig;let value;return cache[0]!==features||cache[1]!==statsig?(value=Object.getOwnPropertyDescriptor(features,`remote_connections`)?.value===!0||statsig,cache[0]=features,cache[1]=statsig,cache[2]=value):value=cache[2],value}",
};
assert.equal(remoteControlVisibilityFeature.isApplied(remoteVisibilityBundle), false);
remoteVisibilityBundle = remoteControlVisibilityFeature.apply(remoteVisibilityBundle, {
  webviewRemoteControlConnectionsVisibilityPath: "remote-control",
  webviewPluginAvailabilityPath: "plugin-availability",
});
remoteControlVisibilityFeature.verify(remoteVisibilityBundle);
assert.equal(remoteVisibilityBundle.webviewRemoteControlConnectionsVisibility.includes("return!0"), true);
assert.equal(remoteVisibilityBundle.webviewRemoteConnectionVisibility.includes("return!0"), true);

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

let pluginMcpReloadBundle = {
  webviewPluginAvailability: [
    "var X=E();function Me(){return null}",
    "let _=await qe({authPolicy:h.authPolicy,codexHome:c,hostId:t,plugin:f,queryClient:a,windowType:`electron`});if(h.authPolicy===`ON_USE`){return null}",
  ].join(";"),
  webviewRemoteControlConnectionsVisibility: "",
};
assert.equal(pluginMcpReloadFeature.isApplied(pluginMcpReloadBundle), false);
pluginMcpReloadBundle = pluginMcpReloadFeature.apply(pluginMcpReloadBundle, {
  webviewRemoteControlConnectionsVisibilityPath: "plugin-availability",
  webviewPluginAvailabilityPath: "plugin-availability",
});
pluginMcpReloadFeature.verify(pluginMcpReloadBundle);
assert.equal(pluginMcpReloadBundle.webviewPluginAvailability.includes("codexLinuxPluginHasMcp"), true);
assert.equal(
  pluginMcpReloadBundle.webviewPluginAvailability.includes("codex-app-server-restart"),
  true,
);
assert.equal(
  pluginMcpReloadBundle.webviewRemoteControlConnectionsVisibility,
  pluginMcpReloadBundle.webviewPluginAvailability,
);

let workingSessionsBundle = {
  main: [
    "function registerIpc({buildFlavor:flavor,getContextForWebContents:contextForWebContents,isTrustedIpcEvent:isTrusted,usesOwlAppShell:usesOwl}){electronMain.ipcMain.on(channel,event=>{})}",
    "case`view-focused`:case`quit-app`:case`tray-menu-threads-changed`:break;",
  ].join(""),
};
assert.equal(workingSessionsStatusFeature.isApplied(workingSessionsBundle), false);
workingSessionsBundle = workingSessionsStatusFeature.apply(workingSessionsBundle);
workingSessionsStatusFeature.verify(workingSessionsBundle);
assert.equal(workingSessionsBundle.main.includes("electronMain.app.on(`before-quit`"), true);
assert.equal(workingSessionsBundle.main.includes("codexLinuxWriteWorkingSessionsStatus(a);break;"), true);

let remoteBackendBundle = {
  main: "function mergeFeatures(base,{buildFlavor:flavor=build.O.resolve(),env:environment=proc.default.env,platform:platformName=proc.default.platform}={}){let merged=platformName===`linux`&&environment.CODEX_ELECTRON_ENABLE_LINUX_BROWSER_USE===`1`?{...base,browserPane:!0,inAppBrowserUse:!0,inAppBrowserUseAllowed:!0,externalBrowserUse:!0,externalBrowserUseAllowed:!0}:platformName===`win32`&&environment.CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE===`1`?{...base,computerUse:!0,computerUseNodeRepl:!0}:base,overrides=flavor===build.O.Dev?readOverrides(environment):null;return overrides==null?merged:{...merged,...overrides}}",
};
assert.equal(remoteControlBackendFeature.isApplied(remoteBackendBundle), false);
remoteBackendBundle = remoteControlBackendFeature.apply(remoteBackendBundle);
remoteControlBackendFeature.verify(remoteBackendBundle);
assert.equal(remoteBackendBundle.main.includes("control:!0"), true);
assert.equal(remoteBackendBundle.main.includes("deviceAttestation:!0"), false);

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
