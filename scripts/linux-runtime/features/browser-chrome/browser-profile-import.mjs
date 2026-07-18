import { FEATURE_MARKERS } from "../../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../../replace-utils.mjs";

const upstreamProfileImporterFactory =
  "function mS(){if(process.platform!==`darwin`&&process.platform!==`win32`||!i.o())return null;let e=process._linkedBinding;if(typeof e!=`function`)return null;let t;try{t=e.call(process,`electron_browser_owl_profile_importer`)}catch{return null}let n=fS.safeParse(t);return n.success?n.data.owlProfileImporter:null}";

const linuxProfileImporterFactory =
  "function mS(){if(process.platform===`linux`)return require((0,d.join)(process.resourcesPath,`codex-linux-browser-profile-import.cjs`)).createLinuxBrowserProfileImporter({electron:c});if(process.platform!==`darwin`&&process.platform!==`win32`||!i.o())return null;let e=process._linkedBinding;if(typeof e!=`function`)return null;let t;try{t=e.call(process,`electron_browser_owl_profile_importer`)}catch{return null}let n=fS.safeParse(t);return n.success?n.data.owlProfileImporter:null}";

const upstreamMainProfileSourceSchema = "var Dv=G([`atlas`,`chrome`]),Ov=W({source:Dv";
const linuxMainProfileSourceSchema =
  "var Dv=G([`atlas`,`chrome`,`onepassword`]),Ov=W({source:Dv";

const upstreamWebviewProfileSourceSchema = "wb=V([`atlas`,`chrome`]),z({source:wb";
const linuxWebviewProfileSourceSchema =
  "wb=V([`atlas`,`chrome`,`onepassword`]),z({source:wb";

const upstreamCloseBrowserGuidance =
  "M=typeof document<`u`&&document.documentElement.dataset.codexOs===`win32`,ee=typeof document<`u`&&document.documentElement.dataset.codexOs===`darwin`,N=M&&k?.source===`chrome`";

const linuxCloseBrowserGuidance =
  "M=typeof document<`u`&&document.documentElement.dataset.codexOs===`win32`,ee=typeof document<`u`&&document.documentElement.dataset.codexOs===`darwin`&&k?.source!==`onepassword`,N=M&&k?.source===`chrome`";

const upstreamProfileIconSwitch =
  "function ke(e){let t=(0,Q.c)(10),{profile:n}=e,r;bb0:switch(n.source){case`atlas`:{let e;t[0]===Symbol.for(`react.memo_cache_sentinel`)?(e=(0,$.jsx)(`img`,{alt:``,className:`size-4 shrink-0 rounded-[22%]`,src:J}),t[0]=e):e=t[0],r=e;break bb0}case`chrome`:{let e;t[1]===Symbol.for(`react.memo_cache_sentinel`)?(e=(0,$.jsx)(ce,{className:`size-4 shrink-0`}),t[1]=e):e=t[1],r=e}}let i";

const linuxProfileIconSwitch =
  "function ke(e){let t=(0,Q.c)(10),{profile:n}=e,r;bb0:switch(n.source){case`atlas`:{let e;t[0]===Symbol.for(`react.memo_cache_sentinel`)?(e=(0,$.jsx)(`img`,{alt:``,className:`size-4 shrink-0 rounded-[22%]`,src:J}),t[0]=e):e=t[0],r=e;break bb0}case`chrome`:{let e;t[1]===Symbol.for(`react.memo_cache_sentinel`)?(e=(0,$.jsx)(ce,{className:`size-4 shrink-0`}),t[1]=e):e=t[1],r=e;break bb0}case`onepassword`:{r=(0,$.jsx)(ge,{className:`size-4 shrink-0`});break bb0}}let i";

const upstreamNoProfilesMessage = "No Chrome or Atlas profiles were found on this device";
const linuxNoProfilesMessage =
  "No Chrome, Atlas, or 1Password profiles were found on this device";

export const browserProfileImportFeature = {
  id: "browser-profile-import",
  version: 6,
  requiredMarkers: FEATURE_MARKERS["browser-profile-import"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["browser-profile-import"].forbiddenMarkers,
  apply(bundleSources, context) {
    if (this.isApplied(bundleSources)) return bundleSources;
    let webviewBrowserProfileImportDialog = replaceOrThrow(
      bundleSources.webviewBrowserProfileImportDialog,
      upstreamCloseBrowserGuidance,
      linuxCloseBrowserGuidance,
      "Linux browser profile import close-browser guidance",
    );
    webviewBrowserProfileImportDialog = replaceOrThrow(
      webviewBrowserProfileImportDialog,
      upstreamProfileIconSwitch,
      linuxProfileIconSwitch,
      "1Password browser profile icon",
    );
    webviewBrowserProfileImportDialog = replaceOrThrow(
      webviewBrowserProfileImportDialog,
      upstreamNoProfilesMessage,
      linuxNoProfilesMessage,
      "1Password browser profile empty state",
    );
    let sources = {
      ...bundleSources,
      main: replaceOrThrow(
        bundleSources.main,
        upstreamProfileImporterFactory,
        linuxProfileImporterFactory,
        "Linux browser profile importer factory",
      ),
      buildBrowserRuntimeSource: replaceOrThrow(
        bundleSources.buildBrowserRuntimeSource,
        upstreamMainProfileSourceSchema,
        linuxMainProfileSourceSchema,
        "1Password main profile source schema",
      ),
      webviewCoreSource: replaceOrThrow(
        bundleSources.webviewCoreSource,
        upstreamWebviewProfileSourceSchema,
        linuxWebviewProfileSourceSchema,
        "1Password webview profile source schema",
      ),
      webviewBrowserProfileImportDialog,
    };
    if (typeof context?.syncSharedBundleSource === "function") {
      sources = context.syncSharedBundleSource(
        sources,
        "buildBrowserRuntimeSource",
        sources.buildBrowserRuntimeSource,
      );
      sources = context.syncSharedBundleSource(
        sources,
        "webviewCoreSource",
        sources.webviewCoreSource,
      );
    }
    return sources;
  },
  verify(bundleSources) {
    for (const [sourceKey, markers] of Object.entries(this.requiredMarkers)) {
      ensureMarkersPresent(
        bundleSources[sourceKey] ?? "",
        markers,
        `Linux browser profile import patch in ${sourceKey}`,
      );
    }
    for (const [sourceKey, markers] of Object.entries(this.forbiddenMarkers)) {
      ensureMarkersAbsent(
        bundleSources[sourceKey] ?? "",
        markers,
        `Linux browser profile import patch in ${sourceKey}`,
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
