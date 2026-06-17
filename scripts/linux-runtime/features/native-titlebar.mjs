import { FEATURE_MARKERS } from "../markers.mjs";
import {
  ensureMarkersAbsent,
  ensureMarkersPresent,
  replaceOrThrow,
} from "../replace-utils.mjs";

const linuxTitlebarInjection = `
const codexLinuxIpcRenderer=(()=>{try{return typeof require=="function"?require("electron").ipcRenderer:null}catch{return null}})();
const linuxTitlebarConfigPromise=process.platform==="linux"&&codexLinuxIpcRenderer?codexLinuxIpcRenderer.invoke(linuxTitlebarConfigChannel).catch(()=>({enabled:!1})):Promise.resolve({enabled:!1});
let linuxTitlebarState={enabled:!1},linuxTitlebarHost=null,linuxTitlebarSyncScheduled=!1,linuxTitlebarDebugLast="";
function ensureLinuxTitlebarStyles(){if(document.getElementById("codex-linux-drag-style"))return;const e=document.createElement("style");e.id="codex-linux-drag-style";e.textContent='[data-codex-linux-drag-root="true"]{-webkit-app-region:drag;}[data-codex-window-type="electron"][data-codex-os="linux"]{--codex-linux-sidebar-glass-dark:rgba(14,14,16,.72);--codex-linux-sidebar-glass-light:color-mix(in srgb,var(--color-token-editor-background) 58%,transparent);}[data-codex-window-type="electron"][data-codex-os="linux"] .app-shell-left-panel{background:var(--codex-linux-sidebar-glass-light)!important;background-color:var(--codex-linux-sidebar-glass-light)!important;-webkit-backdrop-filter:blur(28px) saturate(1.25);backdrop-filter:blur(28px) saturate(1.25);}[data-codex-window-type="electron"][data-codex-os="linux"].dark .app-shell-left-panel,[data-codex-window-type="electron"][data-codex-os="linux"].electron-dark .app-shell-left-panel{background:var(--codex-linux-sidebar-glass-dark)!important;background-color:var(--codex-linux-sidebar-glass-dark)!important;}[data-codex-window-type="electron"][data-codex-os="linux"] .app-shell-left-panel:after{background:inherit!important;}.app-header-tint.draggable.pointer-events-none.fixed{background:transparent!important;background-color:transparent!important;box-shadow:none!important;}[data-codex-window-type="electron"][data-codex-os="linux"] .app-header-tint.draggable.pointer-events-none.fixed [data-test-id="header-shell-slot"] button:not(:disabled){opacity:1!important;filter:none!important;color:var(--color-token-text-primary)!important;}[data-codex-window-type="electron"][data-codex-os="linux"] .app-shell-left-panel .app-header-tint{background:transparent!important;background-color:transparent!important;box-shadow:none!important;}#codex-linux-window-controls{position:fixed;top:9px;right:12px;height:28px;display:flex;align-items:center;gap:9px;z-index:2147483647;-webkit-app-region:no-drag;pointer-events:auto;opacity:1;transform:translateY(0) scale(1);transition:opacity 120ms ease,transform 120ms cubic-bezier(.2,.9,.2,1);}#codex-linux-window-controls[data-codex-linux-window-controls-hidden="true"]{opacity:0;transform:translateY(-2px) scale(.96);pointer-events:none;}#codex-linux-window-controls button{width:16px;height:16px;border-radius:999px;border:1px solid rgba(0,0,0,.2);padding:0;margin:0;appearance:none;-webkit-appearance:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.24),0 1px 2px rgba(0,0,0,.12);cursor:default;transform:translateY(0) scale(1);transition:transform 120ms cubic-bezier(.2,.9,.2,1),box-shadow 120ms ease,filter 120ms ease;}#codex-linux-window-controls button:hover{filter:saturate(1.16) brightness(1.06);transform:translateY(-1px) scale(1.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.34),0 3px 8px rgba(0,0,0,.18);}#codex-linux-window-controls button:active{filter:saturate(1.1) brightness(.92);transform:translateY(1px) scale(.94);box-shadow:inset 0 1px 3px rgba(0,0,0,.26),0 1px 2px rgba(0,0,0,.1);transition-duration:70ms;}#codex-linux-window-controls button:focus-visible{outline:2px solid rgba(0,102,255,.55);outline-offset:2px;}#codex-linux-window-controls button[data-codex-linux-window-action="close"]{background:#ff5f57;}#codex-linux-window-controls button[data-codex-linux-window-action="minimize"]{background:#ffbd2e;}#codex-linux-window-controls button[data-codex-linux-window-action="maximize"]{background:#28c840;}#codex-linux-window-controls:hover button:not(:hover){filter:saturate(1.04) brightness(.98);}';document.head.appendChild(e)}
function performLinuxTitlebarAction(e){codexLinuxIpcRenderer&&codexLinuxIpcRenderer.invoke(linuxTitlebarActionChannel,e).catch(()=>{})}
function ensureLinuxWindowControls(){if(!document.body||document.getElementById("codex-linux-window-controls"))return;const e=document.createElement("div");e.id="codex-linux-window-controls";e.setAttribute("aria-label","Window controls");for(const[t,o]of [["minimize","Minimize"],["maximize","Maximize"],["close","Close"]]){const n=document.createElement("button");n.type="button";n.setAttribute("aria-label",o);n.setAttribute("title",o);n.dataset.codexLinuxWindowAction=t;n.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();performLinuxTitlebarAction(t)});e.appendChild(n)}document.body.appendChild(e)}
function isLinuxImagePreviewOpen(){return!!(document.querySelector('[role="dialog"][aria-label="Image preview"]')||document.querySelector('[data-testid="image-preview-dismiss-area"]'))}
function isLinuxSettingsSurface(){const e=String(window.location?.pathname??"")+" "+String(window.location?.hash??"");return/(^|[\\/#])settings([\\/?#]|$)/.test(e)||!!document.querySelector('[data-testid="settings-page"],[data-testid="settings-sidebar"],[data-settings-route]')}
function shouldHideLinuxWindowControls(){return isLinuxImagePreviewOpen()||isLinuxSettingsSurface()}
function syncLinuxWindowControlsVisibility(e=shouldHideLinuxWindowControls()){const t=document.getElementById("codex-linux-window-controls");if(!t)return;e?(t.dataset.codexLinuxWindowControlsHidden="true",t.setAttribute("aria-hidden","true"),t.inert=!0):(delete t.dataset.codexLinuxWindowControlsHidden,t.removeAttribute("aria-hidden"),t.inert=!1)}
function positionLinuxWindowControls(e){const t=document.getElementById("codex-linux-window-controls");if(!t)return;t.style.right="12px";t.style.left="auto";e.style.setProperty("padding-right","96px","important");e.style.setProperty("box-sizing","border-box","important")}
function resetLinuxWindowControlsPosition(e){e.style.removeProperty("padding-right");e.style.removeProperty("box-sizing")}
function linuxRoundRect(e){const t=e.getBoundingClientRect();return{left:Math.round(t.left),top:Math.round(t.top),right:Math.round(t.right),bottom:Math.round(t.bottom),width:Math.round(t.width),height:Math.round(t.height)}}
function linuxElementDebug(e){if(!(e instanceof HTMLElement))return null;const t=getComputedStyle(e);return{rect:linuxRoundRect(e),className:String(e.className??""),clipPath:e.style.clipPath||t.clipPath,backgroundColor:t.backgroundColor,backgroundImage:t.backgroundImage,opacity:t.opacity,filter:t.filter,backdropFilter:t.backdropFilter,webkitBackdropFilter:t.webkitBackdropFilter,zIndex:t.zIndex,paddingTop:t.paddingTop,paddingRight:t.paddingRight,childElementCount:e.childElementCount,text:typeof e.innerText=="string"?e.innerText.slice(0,120):""}}
function linuxPointDebug(e,t){try{return document.elementsFromPoint(e,t).slice(0,8).map(linuxElementDebug).filter(Boolean)}catch{return[]}}
function reportLinuxTitlebarDebug(e){if(process.env.CODEX_LINUX_TITLEBAR_DEBUG!=="1"||!codexLinuxIpcRenderer)return;try{codexLinuxIpcRenderer.invoke(linuxTitlebarDebugChannel,e).catch(()=>{})}catch{}}
function reportLinuxTitlebarSnapshot(e,t){if(process.env.CODEX_LINUX_TITLEBAR_DEBUG!=="1")return;const o=document.querySelector(".app-shell-left-panel"),n=[...document.querySelectorAll(".app-header-tint.draggable.pointer-events-none.fixed")].map(linuxElementDebug),r={type:"titlebar-sync",route:String(window.location?.pathname??"")+String(window.location?.hash??""),hidden:e,sidebar:linuxElementDebug(o),sidebarAfter:null,pointSamples:{left24:linuxPointDebug(24,24),left96:linuxPointDebug(96,24),left96ToolbarBottom:linuxPointDebug(96,45),left96ContentStart:linuxPointDebug(96,46),left220:linuxPointDebug(220,24),left96Lower:linuxPointDebug(96,56),title:linuxPointDebug(Math.floor(window.innerWidth/2),24)},headers:n,host:linuxElementDebug(t)};if(o instanceof HTMLElement)try{const e=getComputedStyle(o,":after");r.sidebarAfter={content:e.content,width:e.width,right:e.right,inset:e.inset,backgroundColor:e.backgroundColor}}catch{}const s=JSON.stringify(r);s!==linuxTitlebarDebugLast&&(linuxTitlebarDebugLast=s,reportLinuxTitlebarDebug(r))}
function markLinuxTitlebarInteractiveRegions(e){const t=['button','a','input','textarea','select','summary','[role="button"]','[role="link"]','[contenteditable="true"]'];for(const o of e.querySelectorAll(t.join(",")))o.style.setProperty("-webkit-app-region","no-drag","important")}
function scoreLinuxTitlebarHost(e){const t=e.getBoundingClientRect();if(t.width<window.innerWidth*.6||t.height<40||t.height>96)return-1;if(t.top<-8||t.top>40)return-1;const o=e.querySelectorAll("button,[role='button'],a").length;return o<2?-1:t.width/window.innerWidth*10+o-Math.abs(t.top)-Math.abs(t.height-56)/12}
function findLinuxTitlebarHost(){if(!document.body)return null;let e=null,t=-1;for(const o of document.body.querySelectorAll("*")){if(!(o instanceof HTMLElement))continue;const a=scoreLinuxTitlebarHost(o);a>t&&(e=o,t=a)}return e}
function releaseLinuxTitlebarHost(e){e&&(e.removeAttribute("data-codex-linux-drag-root"),resetLinuxWindowControlsPosition(e))}
function syncLinuxTitlebar(){if(!linuxTitlebarState.enabled||!document.body)return;ensureLinuxTitlebarStyles();const e=shouldHideLinuxWindowControls();e||ensureLinuxWindowControls();syncLinuxWindowControlsVisibility(e);let t=linuxTitlebarHost;(!(t instanceof HTMLElement)||!t.isConnected||scoreLinuxTitlebarHost(t)<0)&&(t=findLinuxTitlebarHost());if(!(t instanceof HTMLElement)){releaseLinuxTitlebarHost(linuxTitlebarHost);linuxTitlebarHost=null;reportLinuxTitlebarSnapshot(e,null);return}if(linuxTitlebarHost!==t){releaseLinuxTitlebarHost(linuxTitlebarHost);linuxTitlebarHost=t}t.setAttribute("data-codex-linux-drag-root","true");markLinuxTitlebarInteractiveRegions(t);e?resetLinuxWindowControlsPosition(t):positionLinuxWindowControls(t);reportLinuxTitlebarSnapshot(e,t)}
function scheduleLinuxTitlebarSync(){linuxTitlebarSyncScheduled||(linuxTitlebarSyncScheduled=!0,requestAnimationFrame(()=>{linuxTitlebarSyncScheduled=!1;syncLinuxTitlebar()}))}
process.platform==="linux"&&linuxTitlebarConfigPromise.then(e=>{if(!e||!e.enabled)return;linuxTitlebarState.enabled=!0;const t=()=>{scheduleLinuxTitlebarSync();const e=new MutationObserver(()=>{scheduleLinuxTitlebarSync()});e.observe(document.body,{childList:!0,subtree:!0,attributes:!0,attributeFilter:["class","style"]});window.addEventListener("resize",scheduleLinuxTitlebarSync)};document.readyState==="loading"?window.addEventListener("DOMContentLoaded",t,{once:!0}):t()}).catch(()=>{});
`.trim();

const linuxTitlebarInjectionRegex =
  /const codexLinuxIpcRenderer[\s\S]*?process\.platform==="linux"&&linuxTitlebarConfigPromise\.then\([\s\S]*?\)\.catch\(\(\)=>\{\}\);/;

const linuxTitlebarMainConstantsPatched =
  "Il=`codex_desktop:system-theme-variant-updated`,Ll=`codex_desktop:trigger-sentry-test`,linuxTitlebarConfigChannel=`codex_desktop:linux-titlebar-config`,linuxTitlebarActionChannel=`codex_desktop:linux-titlebar-action`,linuxTitlebarDebugChannel=`codex_desktop:linux-titlebar-debug`,Rl=`codex_desktop:connect-app-host`,zl=`icons`";

const linuxTitlebarMainConstantsWithoutDebug =
  "Il=`codex_desktop:system-theme-variant-updated`,Ll=`codex_desktop:trigger-sentry-test`,linuxTitlebarConfigChannel=`codex_desktop:linux-titlebar-config`,linuxTitlebarActionChannel=`codex_desktop:linux-titlebar-action`,Rl=`codex_desktop:connect-app-host`,zl=`icons`";

const linuxTitlebarMainHandlersPatched =
  "function YQ({buildFlavor:e,getContextForWebContents:t,isTrustedIpcEvent:i,usesOwlAppShell:a}){r.ipcMain.on(Al,e=>{if(!i(e)){e.returnValue=null;return}e.returnValue=n.N}),r.ipcMain.on(jl,t=>{if(!i(t)){t.returnValue=null;return}t.returnValue=e}),r.ipcMain.on(Ml,e=>{if(!i(e)){e.returnValue=!1;return}e.returnValue=a}),r.ipcMain.on(Pl,e=>{if(!i(e)){e.returnValue={};return}e.returnValue=t(e.sender)?.getSharedObjectSnapshot()??{}}),r.ipcMain.handle(linuxTitlebarConfigChannel,e=>{if(!i(e))return{enabled:!1};let t=r.BrowserWindow.fromWebContents(e.sender);return{enabled:!!t?.__codexCustomTitlebar}}),r.ipcMain.handle(linuxTitlebarActionChannel,(e,t)=>{if(!i(e))return{success:!1};let n=r.BrowserWindow.fromWebContents(e.sender);if(!n?.__codexCustomTitlebar)return{success:!1};switch(t){case`minimize`:n.minimize();break;case`maximize`:n.isMaximized()?n.unmaximize():n.maximize();break;case`close`:n.close();break;default:return{success:!1}}return{success:!0}}),r.ipcMain.handle(linuxTitlebarDebugChannel,(e,t)=>{if(!i(e)||process.env.CODEX_LINUX_TITLEBAR_DEBUG!==`1`)return{success:!1};try{let n=require(`node:fs`),a=require(`node:path`),o=process.env.CODEX_LINUX_TITLEBAR_DEBUG_LOG||a.join(r.app.getPath(`userData`),`linux-titlebar-debug.jsonl`);return n.appendFileSync(o,JSON.stringify({time:new Date().toISOString(),payload:t})+`\\n`),{success:!0,path:o}}catch(e){return{success:!1,error:e instanceof Error?e.message:String(e)}}})}";

const linuxTitlebarMainHandlersWithoutDebug =
  "function YQ({buildFlavor:e,getContextForWebContents:t,isTrustedIpcEvent:i,usesOwlAppShell:a}){r.ipcMain.on(Al,e=>{if(!i(e)){e.returnValue=null;return}e.returnValue=n.N}),r.ipcMain.on(jl,t=>{if(!i(t)){t.returnValue=null;return}t.returnValue=e}),r.ipcMain.on(Ml,e=>{if(!i(e)){e.returnValue=!1;return}e.returnValue=a}),r.ipcMain.on(Pl,e=>{if(!i(e)){e.returnValue={};return}e.returnValue=t(e.sender)?.getSharedObjectSnapshot()??{}}),r.ipcMain.handle(linuxTitlebarConfigChannel,e=>{if(!i(e))return{enabled:!1};let t=r.BrowserWindow.fromWebContents(e.sender);return{enabled:!!t?.__codexCustomTitlebar}}),r.ipcMain.handle(linuxTitlebarActionChannel,(e,t)=>{if(!i(e))return{success:!1};let n=r.BrowserWindow.fromWebContents(e.sender);if(!n?.__codexCustomTitlebar)return{success:!1};switch(t){case`minimize`:n.minimize();break;case`maximize`:n.isMaximized()?n.unmaximize():n.maximize();break;case`close`:n.close();break;default:return{success:!1}}return{success:!0}})}";

const linuxTitlebarPreloadConstantsPatched =
  "u=`codex_desktop:trigger-sentry-test`,linuxTitlebarConfigChannel=`codex_desktop:linux-titlebar-config`,linuxTitlebarActionChannel=`codex_desktop:linux-titlebar-action`,linuxTitlebarDebugChannel=`codex_desktop:linux-titlebar-debug`,d=`codex_desktop:connect-app-host`;function f(e){";

const linuxTitlebarMenuScrub =
  "process.platform===`linux`&&r.BrowserWindow.getAllWindows().forEach(e=>{e.__codexCustomTitlebar&&!e.isDestroyed()&&(e.setMenu(null),e.setMenuBarVisibility(!1))})";

const linuxTitlebarApplicationMenuPatch =
  "process.platform===`linux`?r.Menu.setApplicationMenu(null):r.Menu.setApplicationMenu(ut)";

const linuxTitlebarOverlayInstallPatch =
  "let P=process.platform===`linux`?void 0:this.installApplicationMenuTitleBarOverlaySync(M,l),te=()=>{this.applyWindowBackdrop(M,l,!1)}";

const linuxTitlebarApplicationMenuBridgePatch =
  "showApplicationMenu:process.platform===`linux`?void 0:async(t,n,i)=>{await e.ipcRenderer.invoke(r,{menuId:t,x:n,y:i})}";

export const nativeTitlebarFeature = {
  id: "native-titlebar",
  version: 35,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let mainSource = bundleSources.main;
    let preloadSource = bundleSources.preload;

    if (mainSource.includes("__codexCustomTitlebar") && preloadSource.includes("codexLinuxIpcRenderer")) {
      if (!mainSource.includes("autoHideMenuBar:!0")) {
        mainSource = replaceOrThrow(
          mainSource,
          "case`primary`:return n===`darwin`?t?{titleBarStyle:`hiddenInset`,trafficLightPosition:C6(r)}:{vibrancy:`menu`,titleBarStyle:`hiddenInset`,trafficLightPosition:C6(r)}:n===`win32`?{titleBarStyle:`hidden`,titleBarOverlay:w6(r)}:n===`linux`?{frame:!1,hasShadow:!0,transparent:!0,backgroundColor:`#00000000`}:{titleBarStyle:`default`};",
          "case`primary`:return n===`darwin`?t?{titleBarStyle:`hiddenInset`,trafficLightPosition:C6(r)}:{vibrancy:`menu`,titleBarStyle:`hiddenInset`,trafficLightPosition:C6(r)}:n===`win32`?{titleBarStyle:`hidden`,titleBarOverlay:w6(r)}:n===`linux`?{frame:!1,hasShadow:!0,transparent:!0,backgroundColor:`#00000000`,autoHideMenuBar:!0}:{titleBarStyle:`default`};",
          "main bundle Linux primary window chrome menu bar refresh",
        );
      }

      if (!mainSource.includes(linuxTitlebarOverlayInstallPatch)) {
        mainSource = replaceOrThrow(
          mainSource,
          "let P=this.installApplicationMenuTitleBarOverlaySync(M,l),te=()=>{this.applyWindowBackdrop(M,l,!1)}",
          linuxTitlebarOverlayInstallPatch,
          "main bundle Linux titlebar overlay install guard refresh",
        );
      }

      if (!mainSource.includes("setMenu(null)")) {
        mainSource = replaceOrThrow(
          mainSource,
          `${linuxTitlebarOverlayInstallPatch};M.__codexCustomTitlebar=process.platform===\`linux\`&&l===\`primary\`;M.__codexCustomTitlebar&&M.setMenuBarVisibility(!1);process.platform===\`darwin\`&&(M.on(\`move\`,te),M.on(\`resize\`,te)),process.platform===\`win32\`&&M.removeMenu(),`,
          `${linuxTitlebarOverlayInstallPatch};M.__codexCustomTitlebar=process.platform===\`linux\`&&l===\`primary\`;M.__codexCustomTitlebar&&(M.setMenu(null),M.setMenuBarVisibility(!1));process.platform===\`darwin\`&&(M.on(\`move\`,te),M.on(\`resize\`,te)),process.platform===\`win32\`&&M.removeMenu(),`,
          "main bundle primary window menu removal refresh",
        );
      }

      if (!mainSource.includes(linuxTitlebarMenuScrub)) {
        mainSource = replaceOrThrow(
          mainSource,
          "r.Menu.setApplicationMenu(ut),NJ(_)",
          `r.Menu.setApplicationMenu(ut),${linuxTitlebarMenuScrub},NJ(_)`,
          "main bundle Linux custom titlebar menu scrub refresh",
        );
      }

      if (!mainSource.includes(linuxTitlebarApplicationMenuPatch)) {
        mainSource = replaceOrThrow(
          mainSource,
          `r.Menu.setApplicationMenu(ut),${linuxTitlebarMenuScrub},NJ(_)`,
          `${linuxTitlebarApplicationMenuPatch},${linuxTitlebarMenuScrub},NJ(_)`,
          "main bundle Linux application menu removal refresh",
        );
      }

      if (!mainSource.includes("linuxTitlebarDebugChannel")) {
        mainSource = replaceOrThrow(
          mainSource,
          linuxTitlebarMainConstantsWithoutDebug,
          linuxTitlebarMainConstantsPatched,
          "main bundle Linux titlebar IPC constants refresh",
        );

        mainSource = replaceOrThrow(
          mainSource,
          linuxTitlebarMainHandlersWithoutDebug,
          linuxTitlebarMainHandlersPatched,
          "main bundle Linux titlebar debug IPC handler",
        );
      }

      if (!preloadSource.includes("linuxTitlebarDebugChannel")) {
        preloadSource = replaceOrThrow(
          preloadSource,
          "u=`codex_desktop:trigger-sentry-test`,linuxTitlebarConfigChannel=`codex_desktop:linux-titlebar-config`,linuxTitlebarActionChannel=`codex_desktop:linux-titlebar-action`,d=`codex_desktop:connect-app-host`;function f(e){",
          linuxTitlebarPreloadConstantsPatched,
          "preload bundle Linux titlebar IPC constants refresh",
        );
      }

      preloadSource = replaceOrThrow(
        preloadSource,
        linuxTitlebarInjectionRegex,
        linuxTitlebarInjection,
        "preload bundle Linux titlebar injector refresh",
      );

      if (!preloadSource.includes(linuxTitlebarApplicationMenuBridgePatch)) {
        preloadSource = replaceOrThrow(
          preloadSource,
          "showApplicationMenu:async(t,n,i)=>{await e.ipcRenderer.invoke(r,{menuId:t,x:n,y:i})}",
          linuxTitlebarApplicationMenuBridgePatch,
          "preload bundle Linux application menu bridge refresh",
        );
      }

      return {
        ...bundleSources,
        main: mainSource,
        preload: preloadSource,
      };
    }

    mainSource = replaceOrThrow(
      mainSource,
      "Il=`codex_desktop:system-theme-variant-updated`,Ll=`codex_desktop:trigger-sentry-test`,Rl=`codex_desktop:connect-app-host`,zl=`icons`",
      linuxTitlebarMainConstantsPatched,
      "main bundle Linux titlebar IPC constants",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "case`primary`:return n===`darwin`?t?{titleBarStyle:`hiddenInset`,trafficLightPosition:C6(r)}:{vibrancy:`menu`,titleBarStyle:`hiddenInset`,trafficLightPosition:C6(r)}:n===`win32`||n===`linux`?{titleBarStyle:`hidden`,titleBarOverlay:w6(r)}:{titleBarStyle:`default`};",
      "case`primary`:return n===`darwin`?t?{titleBarStyle:`hiddenInset`,trafficLightPosition:C6(r)}:{vibrancy:`menu`,titleBarStyle:`hiddenInset`,trafficLightPosition:C6(r)}:n===`win32`?{titleBarStyle:`hidden`,titleBarOverlay:w6(r)}:n===`linux`?{frame:!1,hasShadow:!0,transparent:!0,backgroundColor:`#00000000`,autoHideMenuBar:!0}:{titleBarStyle:`default`};",
      "main bundle Linux primary window chrome",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "let P=this.installApplicationMenuTitleBarOverlaySync(M,l),te=()=>{this.applyWindowBackdrop(M,l,!1)};process.platform===`darwin`&&(M.on(`move`,te),M.on(`resize`,te)),(process.platform===`win32`||process.platform===`linux`)&&M.removeMenu(),",
      `${linuxTitlebarOverlayInstallPatch};M.__codexCustomTitlebar=process.platform===\`linux\`&&l===\`primary\`;M.__codexCustomTitlebar&&(M.setMenu(null),M.setMenuBarVisibility(!1));process.platform===\`darwin\`&&(M.on(\`move\`,te),M.on(\`resize\`,te)),process.platform===\`win32\`&&M.removeMenu(),`,
      "main bundle primary window marker",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "r.Menu.setApplicationMenu(ut),NJ(_)",
      `${linuxTitlebarApplicationMenuPatch},${linuxTitlebarMenuScrub},NJ(_)`,
      "main bundle Linux custom titlebar menu scrub",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "function YQ({buildFlavor:e,getContextForWebContents:t,isTrustedIpcEvent:i,usesOwlAppShell:a}){r.ipcMain.on(Al,e=>{if(!i(e)){e.returnValue=null;return}e.returnValue=n.N}),r.ipcMain.on(jl,t=>{if(!i(t)){t.returnValue=null;return}t.returnValue=e}),r.ipcMain.on(Ml,e=>{if(!i(e)){e.returnValue=!1;return}e.returnValue=a}),r.ipcMain.on(Pl,e=>{if(!i(e)){e.returnValue={};return}e.returnValue=t(e.sender)?.getSharedObjectSnapshot()??{}})}",
      linuxTitlebarMainHandlersPatched,
      "main bundle Linux titlebar IPC handlers",
    );

    preloadSource = replaceOrThrow(
      preloadSource,
      "u=`codex_desktop:trigger-sentry-test`,d=`codex_desktop:connect-app-host`;function f(e){",
      linuxTitlebarPreloadConstantsPatched,
      "preload bundle Linux titlebar IPC constants",
    );

    preloadSource = replaceOrThrow(
      preloadSource,
      "//# sourceMappingURL=preload.js.map",
      `${linuxTitlebarInjection}\n//# sourceMappingURL=preload.js.map`,
      "preload bundle Linux titlebar injector",
    );

    preloadSource = replaceOrThrow(
      preloadSource,
      "showApplicationMenu:async(t,n,i)=>{await e.ipcRenderer.invoke(r,{menuId:t,x:n,y:i})}",
      linuxTitlebarApplicationMenuBridgePatch,
      "preload bundle Linux application menu bridge",
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
    ensureMarkersAbsent(
      bundleSources.webviewAppShell,
      markers.webviewAppShellForbiddenMarkers,
      "Linux native titlebar app-shell patch",
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
