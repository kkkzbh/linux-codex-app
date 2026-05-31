import { FEATURE_MARKERS } from "../markers.mjs";
import {
  ensureMarkersAbsent,
  ensureMarkersPresent,
  replaceOrThrow,
} from "../replace-utils.mjs";

const linuxTitlebarInjection = `const codexLinuxIpcRenderer=(()=>{try{return typeof require=="function"?require("electron").ipcRenderer:null}catch{return null}})(),linuxTitlebarConfigPromise=process.platform==="linux"&&codexLinuxIpcRenderer?codexLinuxIpcRenderer.invoke(linuxTitlebarConfigChannel).catch(()=>({enabled:!1})):Promise.resolve({enabled:!1});let linuxTitlebarState={enabled:!1},linuxTitlebarHost=null,linuxTitlebarSyncScheduled=!1;function ensureLinuxTitlebarStyles(){if(document.getElementById("codex-linux-drag-style"))return;const e=document.createElement("style");e.id="codex-linux-drag-style",e.textContent='[data-codex-linux-drag-root="true"]{-webkit-app-region:drag;}#codex-linux-window-controls{position:fixed;top:9px;right:12px;height:28px;display:flex;align-items:center;gap:9px;z-index:2147483647;-webkit-app-region:no-drag;pointer-events:auto;opacity:1;transform:translateY(0) scale(1);transition:opacity 120ms ease,transform 120ms cubic-bezier(.2,.9,.2,1);}#codex-linux-window-controls[data-codex-linux-image-preview-open="true"]{opacity:0;transform:translateY(-2px) scale(.96);pointer-events:none;}#codex-linux-window-controls button{width:16px;height:16px;border-radius:999px;border:1px solid rgba(0,0,0,.2);padding:0;margin:0;appearance:none;-webkit-appearance:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.24),0 1px 2px rgba(0,0,0,.12);cursor:default;transform:translateY(0) scale(1);transition:transform 120ms cubic-bezier(.2,.9,.2,1),box-shadow 120ms ease,filter 120ms ease;}#codex-linux-window-controls button:hover{filter:saturate(1.16) brightness(1.06);transform:translateY(-1px) scale(1.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.34),0 3px 8px rgba(0,0,0,.18);}#codex-linux-window-controls button:active{filter:saturate(1.1) brightness(.92);transform:translateY(1px) scale(.94);box-shadow:inset 0 1px 3px rgba(0,0,0,.26),0 1px 2px rgba(0,0,0,.1);transition-duration:70ms;}#codex-linux-window-controls button:focus-visible{outline:2px solid rgba(0,102,255,.55);outline-offset:2px;}#codex-linux-window-controls button[data-codex-linux-window-action="close"]{background:#ff5f57;}#codex-linux-window-controls button[data-codex-linux-window-action="minimize"]{background:#ffbd2e;}#codex-linux-window-controls button[data-codex-linux-window-action="maximize"]{background:#28c840;}#codex-linux-window-controls:hover button:not(:hover){filter:saturate(1.04) brightness(.98);}',document.head.appendChild(e)}function performLinuxTitlebarAction(e){codexLinuxIpcRenderer&&codexLinuxIpcRenderer.invoke(linuxTitlebarActionChannel,e).catch(()=>{})}function ensureLinuxWindowControls(){if(!document.body||document.getElementById("codex-linux-window-controls"))return;const e=document.createElement("div");e.id="codex-linux-window-controls",e.setAttribute("aria-label","Window controls");for(const[t,o]of [["minimize","Minimize"],["maximize","Maximize"],["close","Close"]]){const n=document.createElement("button");n.type="button",n.setAttribute("aria-label",o),n.setAttribute("title",o),n.dataset.codexLinuxWindowAction=t,n.addEventListener("click",e=>{e.preventDefault(),e.stopPropagation(),performLinuxTitlebarAction(t)}),e.appendChild(n)}document.body.appendChild(e)}function isLinuxImagePreviewOpen(){return!!(document.querySelector('[role="dialog"][aria-label="Image preview"]')||document.querySelector('[data-testid="image-preview-dismiss-area"]'))}function syncLinuxWindowControlsVisibility(){const e=document.getElementById("codex-linux-window-controls");if(!e)return;isLinuxImagePreviewOpen()?(e.dataset.codexLinuxImagePreviewOpen="true",e.setAttribute("aria-hidden","true"),e.inert=!0):(delete e.dataset.codexLinuxImagePreviewOpen,e.removeAttribute("aria-hidden"),e.inert=!1)}function positionLinuxWindowControls(e){const t=document.getElementById("codex-linux-window-controls");if(!t)return;t.style.right="12px",t.style.left="auto";e.style.setProperty("padding-right","96px","important"),e.style.setProperty("box-sizing","border-box","important")}function markLinuxTitlebarInteractiveRegions(e){const t=['button','a','input','textarea','select','summary','[role="button"]','[role="link"]','[contenteditable="true"]'];for(const o of e.querySelectorAll(t.join(",")))o.style.setProperty("-webkit-app-region","no-drag","important")}function scoreLinuxTitlebarHost(e){const t=e.getBoundingClientRect();if(t.width<window.innerWidth*.6||t.height<40||t.height>96)return-1;if(t.top<-8||t.top>40)return-1;const o=e.querySelectorAll("button,[role='button'],a").length;return o<2?-1:t.width/window.innerWidth*10+o-Math.abs(t.top)-Math.abs(t.height-56)/12}function findLinuxTitlebarHost(){if(!document.body)return null;let e=null,t=-1;for(const o of document.body.querySelectorAll("*")){if(!(o instanceof HTMLElement))continue;const a=scoreLinuxTitlebarHost(o);a>t&&(e=o,t=a)}return e}function releaseLinuxTitlebarHost(e){e&&e.removeAttribute("data-codex-linux-drag-root")}function syncLinuxTitlebar(){if(!linuxTitlebarState.enabled||!document.body)return;ensureLinuxTitlebarStyles(),ensureLinuxWindowControls(),syncLinuxWindowControlsVisibility();let e=linuxTitlebarHost;(!(e instanceof HTMLElement)||!e.isConnected||scoreLinuxTitlebarHost(e)<0)&&(e=findLinuxTitlebarHost());if(!(e instanceof HTMLElement))return;if(linuxTitlebarHost!==e){releaseLinuxTitlebarHost(linuxTitlebarHost),linuxTitlebarHost=e}e.setAttribute("data-codex-linux-drag-root","true"),markLinuxTitlebarInteractiveRegions(e),positionLinuxWindowControls(e)}function scheduleLinuxTitlebarSync(){linuxTitlebarSyncScheduled||(linuxTitlebarSyncScheduled=!0,requestAnimationFrame(()=>{linuxTitlebarSyncScheduled=!1,syncLinuxTitlebar()}))}process.platform==="linux"&&linuxTitlebarConfigPromise.then(e=>{if(!e||!e.enabled)return;linuxTitlebarState.enabled=!0;const t=()=>{scheduleLinuxTitlebarSync();const e=new MutationObserver(()=>{scheduleLinuxTitlebarSync()});e.observe(document.body,{childList:!0,subtree:!0}),window.addEventListener("resize",scheduleLinuxTitlebarSync)};document.readyState==="loading"?window.addEventListener("DOMContentLoaded",t,{once:!0}):t()}).catch(()=>{});`;

export const nativeTitlebarFeature = {
  id: "native-titlebar",
  version: 13,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let mainSource = bundleSources.main;
    let preloadSource = bundleSources.preload;

    mainSource = replaceOrThrow(
      mainSource,
      "Xc=`codex_desktop:trigger-sentry-test`,Zc=`codex_desktop:connect-app-host`,Qc=`icons`",
      "Xc=`codex_desktop:trigger-sentry-test`,linuxTitlebarConfigChannel=`codex_desktop:linux-titlebar-config`,linuxTitlebarActionChannel=`codex_desktop:linux-titlebar-action`,Zc=`codex_desktop:connect-app-host`,Qc=`icons`",
      "main bundle Linux titlebar IPC constants",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "case`primary`:return n===`darwin`?t?{titleBarStyle:`hiddenInset`,trafficLightPosition:{x:16,y:16}}:{vibrancy:`menu`,titleBarStyle:`hiddenInset`,trafficLightPosition:{x:16,y:16}}:n===`win32`?{titleBarStyle:`hidden`,titleBarOverlay:V1()}:{titleBarStyle:`default`};",
      "case`primary`:return n===`darwin`?t?{titleBarStyle:`hiddenInset`,trafficLightPosition:{x:16,y:16}}:{vibrancy:`menu`,titleBarStyle:`hiddenInset`,trafficLightPosition:{x:16,y:16}}:n===`win32`?{titleBarStyle:`hidden`,titleBarOverlay:V1()}:{frame:!1,hasShadow:!0};",
      "main bundle Linux primary window chrome",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "let P=this.installWindowsTitleBarOverlaySync(j,l),F=()=>{this.applyWindowBackdrop(j,l,!1)};process.platform===`darwin`&&(j.on(`move`,F),j.on(`resize`,F)),process.platform===`win32`&&j.removeMenu(),",
      "let P=this.installWindowsTitleBarOverlaySync(j,l),F=()=>{this.applyWindowBackdrop(j,l,!1)};j.__codexCustomTitlebar=process.platform===`linux`&&l===`primary`;process.platform===`darwin`&&(j.on(`move`,F),j.on(`resize`,F)),process.platform===`win32`&&j.removeMenu(),",
      "main bundle primary window marker",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "function BY({buildFlavor:e,getContextForWebContents:t,isTrustedIpcEvent:r,usesOwlAppShell:a}){i.ipcMain.on(Uc,e=>{if(!r(e)){e.returnValue=null;return}e.returnValue=n.k}),i.ipcMain.on(Wc,t=>{if(!r(t)){t.returnValue=null;return}t.returnValue=e}),i.ipcMain.on(Gc,e=>{if(!r(e)){e.returnValue=!1;return}e.returnValue=a}),i.ipcMain.on(qc,e=>{if(!r(e)){e.returnValue={};return}e.returnValue=t(e.sender)?.getSharedObjectSnapshot()??{}})}",
      "function BY({buildFlavor:e,getContextForWebContents:t,isTrustedIpcEvent:r,usesOwlAppShell:a}){i.ipcMain.on(Uc,e=>{if(!r(e)){e.returnValue=null;return}e.returnValue=n.k}),i.ipcMain.on(Wc,t=>{if(!r(t)){t.returnValue=null;return}t.returnValue=e}),i.ipcMain.on(Gc,e=>{if(!r(e)){e.returnValue=!1;return}e.returnValue=a}),i.ipcMain.on(qc,e=>{if(!r(e)){e.returnValue={};return}e.returnValue=t(e.sender)?.getSharedObjectSnapshot()??{}}),i.ipcMain.handle(linuxTitlebarConfigChannel,e=>{if(!r(e))return{enabled:!1};let t=i.BrowserWindow.fromWebContents(e.sender);return{enabled:!!t?.__codexCustomTitlebar}}),i.ipcMain.handle(linuxTitlebarActionChannel,(e,t)=>{if(!r(e))return{success:!1};let n=i.BrowserWindow.fromWebContents(e.sender);if(!n?.__codexCustomTitlebar)return{success:!1};switch(t){case`minimize`:n.minimize();break;case`maximize`:n.isMaximized()?n.unmaximize():n.maximize();break;case`close`:n.close();break;default:return{success:!1}}return{success:!0}})}",
      "main bundle Linux titlebar IPC handlers",
    );

    preloadSource = replaceOrThrow(
      preloadSource,
      "u=`codex_desktop:trigger-sentry-test`,d=`codex_desktop:connect-app-host`;function f(e){",
      "u=`codex_desktop:trigger-sentry-test`,linuxTitlebarConfigChannel=`codex_desktop:linux-titlebar-config`,linuxTitlebarActionChannel=`codex_desktop:linux-titlebar-action`,d=`codex_desktop:connect-app-host`;function f(e){",
      "preload bundle Linux titlebar IPC constants",
    );

    preloadSource = replaceOrThrow(
      preloadSource,
      "//# sourceMappingURL=preload.js.map",
      `${linuxTitlebarInjection}\n//# sourceMappingURL=preload.js.map`,
      "preload bundle Linux titlebar injector",
    );

    return {
      ...bundleSources,
      main: mainSource,
      preload: preloadSource,
    };
  },
  verify(bundleSources) {
    const markers = FEATURE_MARKERS["native-titlebar"];

    ensureMarkersPresent(bundleSources.main, markers.mainRequiredMarkers, "Linux native titlebar main patch");
    ensureMarkersPresent(
      bundleSources.preload,
      markers.preloadRequiredMarkers,
      "Linux native titlebar preload patch",
    );
    ensureMarkersAbsent(bundleSources.main, markers.mainForbiddenMarkers, "Linux native titlebar main patch");
    ensureMarkersAbsent(
      bundleSources.preload,
      markers.preloadForbiddenMarkers,
      "Linux native titlebar preload patch",
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
