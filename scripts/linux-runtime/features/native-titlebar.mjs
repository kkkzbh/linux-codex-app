import { FEATURE_MARKERS } from "../markers.mjs";
import {
  ensureMarkersAbsent,
  ensureMarkersPresent,
  replaceOrThrow,
} from "../replace-utils.mjs";

const linuxTitlebarInjection = `
const codexLinuxIpcRenderer=(()=>{try{return typeof require=="function"?require("electron").ipcRenderer:null}catch{return null}})();
const linuxTitlebarConfigPromise=process.platform==="linux"&&codexLinuxIpcRenderer?codexLinuxIpcRenderer.invoke(linuxTitlebarConfigChannel).catch(()=>({enabled:!1})):Promise.resolve({enabled:!1});
let linuxTitlebarState={enabled:!1},linuxTitlebarHost=null,linuxTitlebarReservedStartSlots=new Set,linuxTitlebarSyncScheduled=!1,linuxTitlebarDebugLast="";
function ensureLinuxTitlebarStyles(){if(document.getElementById("codex-linux-drag-style"))return;const e=document.createElement("style");e.id="codex-linux-drag-style";e.textContent='[data-codex-linux-drag-root="true"]{-webkit-app-region:drag;}[data-codex-window-type="electron"][data-codex-os="linux"] :is(.composer-surface-chrome,.ProseMirror,[contenteditable],[role="textbox"],[data-codex-composer],[data-pierre-editor-surface]){-webkit-app-region:no-drag!important;}[data-codex-window-type="electron"][data-codex-os="linux"]{--codex-linux-sidebar-glass-dark:rgba(14,14,16,.72);--codex-linux-sidebar-glass-light:color-mix(in srgb,var(--color-token-editor-background) 58%,transparent);}[data-codex-window-type="electron"][data-codex-os="linux"] .app-shell-left-panel{background:var(--codex-linux-sidebar-glass-light)!important;background-color:var(--codex-linux-sidebar-glass-light)!important;-webkit-backdrop-filter:blur(28px) saturate(1.25);backdrop-filter:blur(28px) saturate(1.25);}[data-codex-window-type="electron"][data-codex-os="linux"].dark .app-shell-left-panel,[data-codex-window-type="electron"][data-codex-os="linux"].electron-dark .app-shell-left-panel{background:var(--codex-linux-sidebar-glass-dark)!important;background-color:var(--codex-linux-sidebar-glass-dark)!important;}[data-codex-window-type="electron"][data-codex-os="linux"] .app-shell-left-panel:after{background:inherit!important;}[data-codex-window-type="electron"][data-codex-os="linux"] .main-surface{border-top-left-radius:0!important;border-bottom-left-radius:0!important;border-start-start-radius:0!important;border-end-start-radius:0!important;}.app-header-tint.draggable.pointer-events-none.fixed{background:transparent!important;background-color:transparent!important;box-shadow:none!important;}[data-codex-window-type="electron"][data-codex-os="linux"] .app-header-tint.draggable.pointer-events-none.fixed [data-test-id="header-shell-slot"] button:not(:disabled){opacity:1!important;filter:none!important;color:var(--color-token-text-primary)!important;}[data-codex-window-type="electron"][data-codex-os="linux"] .app-shell-left-panel .app-header-tint{background:transparent!important;background-color:transparent!important;box-shadow:none!important;}#codex-linux-window-controls{position:fixed;top:16px;left:16px;height:14px;display:flex;align-items:center;gap:6px;z-index:2147483647;-webkit-app-region:no-drag;pointer-events:auto;opacity:1;transform:translateY(0) scale(1);transition:opacity 120ms ease,transform 120ms cubic-bezier(.2,.9,.2,1);}#codex-linux-window-controls[data-codex-linux-window-controls-hidden="true"]{opacity:0;transform:translateY(-2px) scale(.96);pointer-events:none;}#codex-linux-window-controls button{width:14px;height:14px;border-radius:999px;border:1px solid rgba(0,0,0,.2);padding:0;margin:0;appearance:none;-webkit-appearance:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.24),0 1px 2px rgba(0,0,0,.12);cursor:default;transform:translateY(0) scale(1);transition:transform 120ms cubic-bezier(.2,.9,.2,1),box-shadow 120ms ease,filter 120ms ease;}#codex-linux-window-controls button:hover{filter:saturate(1.16) brightness(1.06);transform:translateY(-1px) scale(1.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.34),0 3px 8px rgba(0,0,0,.18);}#codex-linux-window-controls button:active{filter:saturate(1.1) brightness(.92);transform:translateY(1px) scale(.94);box-shadow:inset 0 1px 3px rgba(0,0,0,.26),0 1px 2px rgba(0,0,0,.1);transition-duration:70ms;}#codex-linux-window-controls button:focus-visible{outline:2px solid rgba(0,102,255,.55);outline-offset:2px;}#codex-linux-window-controls button[data-codex-linux-window-action="close"]{background:#ff5f57;}#codex-linux-window-controls button[data-codex-linux-window-action="minimize"]{background:#ffbd2e;}#codex-linux-window-controls button[data-codex-linux-window-action="maximize"]{background:#28c840;}#codex-linux-window-controls:hover button:not(:hover){filter:saturate(1.04) brightness(.98);}';document.head.appendChild(e)}
function ensureLinuxEditorTextInputStyles(){if(document.getElementById("codex-linux-editor-input-style"))return;const e=document.createElement("style");e.id="codex-linux-editor-input-style";e.textContent='[data-codex-window-type="electron"][data-codex-os="linux"] :is(.ProseMirror,[contenteditable],[role="textbox"],[data-codex-composer],[data-pierre-editor-surface]){-webkit-app-region:no-drag!important;-webkit-user-select:text!important;user-select:text!important;cursor:text!important;}';document.head.appendChild(e)}
function performLinuxTitlebarAction(e){codexLinuxIpcRenderer&&codexLinuxIpcRenderer.invoke(linuxTitlebarActionChannel,e).catch(()=>{})}
function ensureLinuxWindowControls(){if(!document.body||document.getElementById("codex-linux-window-controls"))return;const e=document.createElement("div");e.id="codex-linux-window-controls";e.setAttribute("aria-label","Window controls");for(const[t,o]of [["close","Close"],["minimize","Minimize"],["maximize","Maximize"]]){const n=document.createElement("button");n.type="button";n.setAttribute("aria-label",o);n.setAttribute("title",o);n.dataset.codexLinuxWindowAction=t;n.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();performLinuxTitlebarAction(t)});e.appendChild(n)}document.body.appendChild(e)}
function isLinuxImagePreviewOpen(){return!!(document.querySelector('[role="dialog"][aria-label="Image preview"]')||document.querySelector('[data-testid="image-preview-dismiss-area"]'))}
function isLinuxSettingsSurface(){const e=String(window.location?.pathname??"")+" "+String(window.location?.hash??"");return/(^|[\\/#])settings([\\/?#]|$)/.test(e)||!!document.querySelector('[data-testid="settings-page"],[data-testid="settings-sidebar"],[data-settings-route]')}
function shouldHideLinuxWindowControls(){return isLinuxImagePreviewOpen()||isLinuxSettingsSurface()}
function syncLinuxWindowControlsVisibility(e=shouldHideLinuxWindowControls()){const t=document.getElementById("codex-linux-window-controls");if(!t)return;e?(t.dataset.codexLinuxWindowControlsHidden="true",t.setAttribute("aria-hidden","true"),t.inert=!0):(delete t.dataset.codexLinuxWindowControlsHidden,t.removeAttribute("aria-hidden"),t.inert=!1)}
function getLinuxTitlebarStartSlots(){const e=[];for(const t of document.querySelectorAll(".app-header-tint.draggable.pointer-events-none.fixed")){if(!(t instanceof HTMLElement))continue;const o=t.querySelector(':scope > [data-test-id="header-shell-slot"]');o instanceof HTMLElement&&e.push(o)}return e}
function positionLinuxWindowControls(){const e=document.getElementById("codex-linux-window-controls");if(!e)return;e.style.left="16px";e.style.right="auto";const t=new Set(getLinuxTitlebarStartSlots());for(const e of linuxTitlebarReservedStartSlots)t.has(e)||(e.style.removeProperty("padding-left"),e.style.removeProperty("box-sizing"));for(const e of t)e.style.setProperty("padding-left","80px","important"),e.style.setProperty("box-sizing","border-box","important");linuxTitlebarReservedStartSlots=t}
function resetLinuxWindowControlsPosition(){for(const e of linuxTitlebarReservedStartSlots)e.style.removeProperty("padding-left"),e.style.removeProperty("box-sizing");linuxTitlebarReservedStartSlots.clear()}
function linuxRoundRect(e){const t=e.getBoundingClientRect();return{left:Math.round(t.left),top:Math.round(t.top),right:Math.round(t.right),bottom:Math.round(t.bottom),width:Math.round(t.width),height:Math.round(t.height)}}
function linuxElementDebug(e){if(!(e instanceof HTMLElement))return null;const t=getComputedStyle(e);return{rect:linuxRoundRect(e),className:String(e.className??""),clipPath:e.style.clipPath||t.clipPath,backgroundColor:t.backgroundColor,backgroundImage:t.backgroundImage,opacity:t.opacity,filter:t.filter,backdropFilter:t.backdropFilter,webkitBackdropFilter:t.webkitBackdropFilter,zIndex:t.zIndex,paddingTop:t.paddingTop,paddingLeft:t.paddingLeft,childElementCount:e.childElementCount,text:typeof e.innerText=="string"?e.innerText.slice(0,120):""}}
function linuxPointDebug(e,t){try{return document.elementsFromPoint(e,t).slice(0,8).map(linuxElementDebug).filter(Boolean)}catch{return[]}}
function reportLinuxTitlebarDebug(e){if(process.env.CODEX_LINUX_TITLEBAR_DEBUG!=="1"||!codexLinuxIpcRenderer)return;try{codexLinuxIpcRenderer.invoke(linuxTitlebarDebugChannel,e).catch(()=>{})}catch{}}
function reportLinuxTitlebarSnapshot(e,t){if(process.env.CODEX_LINUX_TITLEBAR_DEBUG!=="1")return;const o=document.querySelector(".app-shell-left-panel"),n=[...document.querySelectorAll(".app-header-tint.draggable.pointer-events-none.fixed")].map(linuxElementDebug),r={type:"titlebar-sync",route:String(window.location?.pathname??"")+String(window.location?.hash??""),hidden:e,sidebar:linuxElementDebug(o),sidebarAfter:null,pointSamples:{left24:linuxPointDebug(24,24),left96:linuxPointDebug(96,24),left96ToolbarBottom:linuxPointDebug(96,45),left96ContentStart:linuxPointDebug(96,46),left220:linuxPointDebug(220,24),left96Lower:linuxPointDebug(96,56),title:linuxPointDebug(Math.floor(window.innerWidth/2),24)},headers:n,host:linuxElementDebug(t)};if(o instanceof HTMLElement)try{const e=getComputedStyle(o,":after");r.sidebarAfter={content:e.content,width:e.width,right:e.right,inset:e.inset,backgroundColor:e.backgroundColor}}catch{}const s=JSON.stringify(r);s!==linuxTitlebarDebugLast&&(linuxTitlebarDebugLast=s,reportLinuxTitlebarDebug(r))}
function markLinuxTitlebarInteractiveRegions(e){ensureLinuxEditorTextInputStyles();const t=['button','a','input','textarea','select','summary','[role="button"]','[role="link"]','[role="textbox"]','[contenteditable]','[data-codex-composer]','[data-pierre-editor-surface]','.composer-surface-chrome','.ProseMirror'];for(const o of e.querySelectorAll(t.join(",")))o.style.setProperty("-webkit-app-region","no-drag","important");const n=['[role="textbox"]','[contenteditable]','[data-codex-composer]','[data-pierre-editor-surface]','.ProseMirror'];for(const o of e.querySelectorAll(n.join(","))){o.style.setProperty("-webkit-user-select","text","important");o.style.setProperty("user-select","text","important");o.style.setProperty("cursor","text","important")}}
function scoreLinuxTitlebarHost(e){const t=e.getBoundingClientRect();if(t.width<window.innerWidth*.6||t.height<40||t.height>96)return-1;if(t.top<-8||t.top>40)return-1;const o=e.querySelectorAll("button,[role='button'],a").length;return o<2?-1:t.width/window.innerWidth*10+o-Math.abs(t.top)-Math.abs(t.height-56)/12}
function findLinuxTitlebarHost(){if(!document.body)return null;let e=null,t=-1;for(const o of document.body.querySelectorAll("*")){if(!(o instanceof HTMLElement))continue;const a=scoreLinuxTitlebarHost(o);a>t&&(e=o,t=a)}return e}
function releaseLinuxTitlebarHost(e){e&&e.removeAttribute("data-codex-linux-drag-root")}
function syncLinuxTitlebar(){if(!linuxTitlebarState.enabled||!document.body)return;ensureLinuxTitlebarStyles();const e=shouldHideLinuxWindowControls();e||ensureLinuxWindowControls();syncLinuxWindowControlsVisibility(e);let t=linuxTitlebarHost;(!(t instanceof HTMLElement)||!t.isConnected||scoreLinuxTitlebarHost(t)<0)&&(t=findLinuxTitlebarHost());if(!(t instanceof HTMLElement)){releaseLinuxTitlebarHost(linuxTitlebarHost);linuxTitlebarHost=null;resetLinuxWindowControlsPosition();reportLinuxTitlebarSnapshot(e,null);return}if(linuxTitlebarHost!==t){releaseLinuxTitlebarHost(linuxTitlebarHost);linuxTitlebarHost=t}t.setAttribute("data-codex-linux-drag-root","true");markLinuxTitlebarInteractiveRegions(t);e?resetLinuxWindowControlsPosition():positionLinuxWindowControls();reportLinuxTitlebarSnapshot(e,t)}
function scheduleLinuxTitlebarSync(){linuxTitlebarSyncScheduled||(linuxTitlebarSyncScheduled=!0,requestAnimationFrame(()=>{linuxTitlebarSyncScheduled=!1;ensureLinuxEditorTextInputStyles();syncLinuxTitlebar()}))}
process.platform==="linux"&&linuxTitlebarConfigPromise.then(e=>{if(!e||!e.enabled)return;linuxTitlebarState.enabled=!0;const t=()=>{scheduleLinuxTitlebarSync();const e=new MutationObserver(()=>{scheduleLinuxTitlebarSync()});e.observe(document.body,{childList:!0,subtree:!0,attributes:!0,attributeFilter:["class","style"]});window.addEventListener("resize",scheduleLinuxTitlebarSync)};document.readyState==="loading"?window.addEventListener("DOMContentLoaded",t,{once:!0}):t()}).catch(()=>{});
`.trim();

const linuxTitlebarMenuScrub =
  "process.platform===`linux`&&c.BrowserWindow.getAllWindows().forEach(e=>{e.__codexCustomTitlebar&&!e.isDestroyed()&&(e.setMenu(null),e.setMenuBarVisibility(!1))})";

const linuxTitlebarApplicationMenuPatch =
  "process.platform===`linux`?c.Menu.setApplicationMenu(null):c.Menu.setApplicationMenu(It)";

const linuxTitlebarOverlayInstallPatch =
  "let F=process.platform===`linux`?void 0:this.installApplicationMenuTitleBarOverlaySync(M,o),I=()=>{this.applyWindowBackdrop(M,o,!1)}";

const linuxTitlebarWindowZoomPatch =
  "setWindowZoom(e,t){let n=c.BrowserWindow.fromWebContents(e),r=n&&this.windowAppearances.get(n.id);n==null||r!==`primary`&&r!==`quickChat`||(process.platform===`darwin`?n.setWindowButtonPosition(A9(t)):n.__codexCustomTitlebar?this.windowZooms.set(n.id,t):(process.platform===`win32`||process.platform===`linux`)&&(this.windowZooms.set(n.id,t),n.setTitleBarOverlay(j9(t))))}";

const linuxTitlebarOpaqueSurfaceGuardPatch =
  "shouldAlwaysUseOpaqueWindowSurface(e){return Wie({appearance:e,opaqueWindowsEnabled:this.isOpaqueWindowsEnabled(),platform:process.platform})||process.platform!==`linux`&&!Dj()&&!I9(e)}";

const currentLinuxTitlebarMainHandlersAnchor =
  "function t5({buildFlavor:e,getContextForWebContents:t,isTrustedIpcEvent:n}){c.ipcMain.on(a.X,e=>{if(!n(e)){e.returnValue=null;return}e.returnValue={...a.ct,appVersion:a.I()}}),c.ipcMain.on(a.J,t=>{if(!n(t)){t.returnValue=null;return}t.returnValue=e}),c.ipcMain.on(a.$,e=>{if(!n(e)){e.returnValue=!1;return}e.returnValue=i.o()}),c.ipcMain.on(a.Z,e=>{if(!n(e)){e.returnValue={};return}e.returnValue=t(e.sender)?.getSharedObjectSnapshot()??{}}),c.ipcMain.on(a.nt,(e,r)=>{if(!n(e)){e.returnValue=!1;return}e.returnValue=t(e.sender)?.startFileDrag(e.sender,r)??!1})}";

const currentLinuxTitlebarMainHandlersPatched =
  "function t5({buildFlavor:e,getContextForWebContents:t,isTrustedIpcEvent:n}){c.ipcMain.on(a.X,e=>{if(!n(e)){e.returnValue=null;return}e.returnValue={...a.ct,appVersion:a.I()}}),c.ipcMain.on(a.J,t=>{if(!n(t)){t.returnValue=null;return}t.returnValue=e}),c.ipcMain.on(a.$,e=>{if(!n(e)){e.returnValue=!1;return}e.returnValue=i.o()}),c.ipcMain.on(a.Z,e=>{if(!n(e)){e.returnValue={};return}e.returnValue=t(e.sender)?.getSharedObjectSnapshot()??{}}),c.ipcMain.on(a.nt,(e,r)=>{if(!n(e)){e.returnValue=!1;return}e.returnValue=t(e.sender)?.startFileDrag(e.sender,r)??!1}),c.ipcMain.handle(`codex_desktop:linux-titlebar-config`,e=>{if(!n(e))return{enabled:!1};let t=c.BrowserWindow.fromWebContents(e.sender);return{enabled:!!t?.__codexCustomTitlebar}}),c.ipcMain.handle(`codex_desktop:linux-titlebar-action`,(e,t)=>{if(!n(e))return{success:!1};let r=c.BrowserWindow.fromWebContents(e.sender);if(!r?.__codexCustomTitlebar)return{success:!1};switch(t){case`minimize`:r.minimize();break;case`maximize`:r.isMaximized()?r.unmaximize():r.maximize();break;case`close`:r.close();break;default:return{success:!1}}return{success:!0}}),c.ipcMain.handle(`codex_desktop:linux-titlebar-debug`,(e,t)=>{if(!n(e)||process.env.CODEX_LINUX_TITLEBAR_DEBUG!==`1`)return{success:!1};try{let n=require(`node:fs`),r=require(`node:path`),i=process.env.CODEX_LINUX_TITLEBAR_DEBUG_LOG||r.join(c.app.getPath(`userData`),`linux-titlebar-debug.jsonl`);return n.appendFileSync(i,JSON.stringify({time:new Date().toISOString(),payload:t})+`\\n`),{success:!0,path:i}}catch(e){return{success:!1,error:e instanceof Error?e.message:String(e)}}})}";

const currentLinuxTitlebarPreloadConstantsPatched =
  "_=`codex_desktop:trigger-sentry-test`,linuxTitlebarConfigChannel=`codex_desktop:linux-titlebar-config`,linuxTitlebarActionChannel=`codex_desktop:linux-titlebar-action`,linuxTitlebarDebugChannel=`codex_desktop:linux-titlebar-debug`,v=`codex_desktop:connect-app-host`,y=`codex_desktop:start-file-drag`;function b(e){";

const currentLinuxTitlebarApplicationMenuBridgePatch =
  "showApplicationMenu:process.platform===`linux`?void 0:async(t,n,r)=>{await e.ipcRenderer.invoke(u,{menuId:t,x:n,y:r})}";

export const nativeTitlebarFeature = {
  id: "native-titlebar",
  version: 44,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let mainSource = bundleSources.main;
    let preloadSource = bundleSources.preload;

    mainSource = replaceOrThrow(
      mainSource,
      "case`quickChat`:case`primary`:return n===`darwin`?{titleBarStyle:`hiddenInset`,trafficLightPosition:A9(r),...e===`quickChat`?{hasShadow:!0,resizable:!0,transparent:!0}:{},...t?{}:{vibrancy:`menu`}}:n===`win32`||n===`linux`?{titleBarStyle:`hidden`,titleBarOverlay:j9(r),...e===`quickChat`?{resizable:!0}:{}}:{titleBarStyle:`default`,...e===`quickChat`?{resizable:!0}:{}};",
      "case`quickChat`:return n===`darwin`?{titleBarStyle:`hiddenInset`,trafficLightPosition:A9(r),hasShadow:!0,resizable:!0,transparent:!0,...t?{}:{vibrancy:`menu`}}:n===`win32`||n===`linux`?{titleBarStyle:`hidden`,titleBarOverlay:j9(r),resizable:!0}:{titleBarStyle:`default`,resizable:!0};case`primary`:return n===`darwin`?{titleBarStyle:`hiddenInset`,trafficLightPosition:A9(r),...t?{}:{vibrancy:`menu`}}:n===`win32`?{titleBarStyle:`hidden`,titleBarOverlay:j9(r)}:n===`linux`?{frame:!1,hasShadow:!0,transparent:!0,backgroundColor:`#00000000`,autoHideMenuBar:!0}:{titleBarStyle:`default`};",
      "main bundle Linux primary window chrome",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "let F=this.installApplicationMenuTitleBarOverlaySync(M,o),I=()=>{this.applyWindowBackdrop(M,o,!1)},ee=()=>{this.sendMessageToWindow(M,{type:`electron-window-position-changed`})};M.on(`move`,ee),process.platform===`darwin`&&(M.on(`move`,I),M.on(`resize`,I),o===`primary`&&M.on(`swipe`,(e,t)=>{let n=this.historySwipeNavigationStates.get(M);t===`left`&&n?.canGoBack===!0?this.sendMessageToWindow(M,{type:`navigate-back`}):t===`right`&&n?.canGoForward===!0&&this.sendMessageToWindow(M,{type:`navigate-forward`})})),(process.platform===`win32`||process.platform===`linux`)&&M.removeMenu(),",
      `${linuxTitlebarOverlayInstallPatch},ee=()=>{this.sendMessageToWindow(M,{type:\`electron-window-position-changed\`})};M.__codexCustomTitlebar=process.platform===\`linux\`&&o===\`primary\`;M.__codexCustomTitlebar&&(M.setMenu(null),M.setMenuBarVisibility(!1));M.on(\`move\`,ee),process.platform===\`darwin\`&&(M.on(\`move\`,I),M.on(\`resize\`,I),o===\`primary\`&&M.on(\`swipe\`,(e,t)=>{let n=this.historySwipeNavigationStates.get(M);t===\`left\`&&n?.canGoBack===!0?this.sendMessageToWindow(M,{type:\`navigate-back\`}):t===\`right\`&&n?.canGoForward===!0&&this.sendMessageToWindow(M,{type:\`navigate-forward\`})})),process.platform===\`win32\`&&M.removeMenu(),`,
      "main bundle primary window marker",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "c.Menu.setApplicationMenu(It),RX(_)",
      `${linuxTitlebarApplicationMenuPatch},${linuxTitlebarMenuScrub},RX(_)`,
      "main bundle Linux custom titlebar menu scrub",
    );

    mainSource = replaceOrThrow(
      mainSource,
      currentLinuxTitlebarMainHandlersAnchor,
      currentLinuxTitlebarMainHandlersPatched,
      "main bundle Linux titlebar IPC handlers",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "setWindowZoom(e,t){let n=c.BrowserWindow.fromWebContents(e),r=n&&this.windowAppearances.get(n.id);n==null||r!==`primary`&&r!==`quickChat`||(process.platform===`darwin`?n.setWindowButtonPosition(A9(t)):(process.platform===`win32`||process.platform===`linux`)&&(this.windowZooms.set(n.id,t),n.setTitleBarOverlay(j9(t))))}",
      linuxTitlebarWindowZoomPatch,
      "main bundle Linux custom titlebar window zoom overlay guard",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "shouldAlwaysUseOpaqueWindowSurface(e){return Wie({appearance:e,opaqueWindowsEnabled:this.isOpaqueWindowsEnabled(),platform:process.platform})||!Dj()&&!I9(e)}",
      linuxTitlebarOpaqueSurfaceGuardPatch,
      "main bundle Linux custom titlebar opaque surface guard",
    );

    preloadSource = replaceOrThrow(
      preloadSource,
      "_=`codex_desktop:trigger-sentry-test`,v=`codex_desktop:connect-app-host`,y=`codex_desktop:start-file-drag`;function b(e){",
      currentLinuxTitlebarPreloadConstantsPatched,
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
      "showApplicationMenu:async(t,n,r)=>{await e.ipcRenderer.invoke(u,{menuId:t,x:n,y:r})}",
      currentLinuxTitlebarApplicationMenuBridgePatch,
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

    ensureMarkersPresent(
      bundleSources.main,
      markers.mainRequiredMarkers,
      "Linux native titlebar main patch",
    );
    ensureMarkersPresent(
      bundleSources.preload,
      markers.preloadRequiredMarkers,
      "Linux native titlebar preload patch",
    );
    ensureMarkersAbsent(
      bundleSources.main,
      markers.mainForbiddenMarkers,
      "Linux native titlebar main patch",
    );
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
