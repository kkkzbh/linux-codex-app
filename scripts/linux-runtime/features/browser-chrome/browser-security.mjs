import { FEATURE_MARKERS } from "../../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../../replace-utils.mjs";

const browserSecurityMethodsAnchor =
  "}finally{this.abortControllers.delete(t.requestId)}}cancelRequest(e){";

const browserAuthenticatedFetchMethods = [
  "}finally{this.abortControllers.delete(t.requestId)}}",
  "async linuxAuthenticatedFetch(e){if(process.platform!==`linux`)throw Error(`Linux authenticated fetch is only available on Linux`);let t=new URL(String(e?.url??``)),n=String(e?.method??`GET`).toUpperCase();if(t.origin!==`https://chatgpt.com`||t.pathname!==`/backend-api/aura/site_status`||n!==`GET`)throw Error(`Linux authenticated fetch URL is not allowlisted`);let r={},i=async e=>{let n=this.cloneHeaders(r);return e&&bm(n,e,{desktopOriginator:this.options.desktopOriginator,includeSurfaceHeaders:!1}),require(`electron`).net.fetch(t.toString(),{method:`GET`,headers:n})},o=null;try{o=await this.getAppServerConnection(e?.hostId??this.options.hostId).getAuthToken({refreshToken:!1})}catch(e){Xj().error(`Failed to retrieve auth token for Linux authenticated fetch`,{safe:{},sensitive:{error:e}});throw Error(`Failed to retrieve authentication token`)}let s=await i(o);if(o&&s.status===401){try{o=await this.getAppServerConnection(e?.hostId??this.options.hostId).getAuthToken({refreshToken:!0})}catch(e){Xj().error(`Failed to refresh auth token for Linux authenticated fetch`,{safe:{},sensitive:{error:e}});throw Error(`Failed to refresh authentication token`)}o&&(s=await i(o))}let a={};s.headers.forEach((e,t)=>{a[t]=e});let c=Buffer.from(await s.arrayBuffer()).toString(`base64`);return{status:s.status,statusText:s.statusText,headers:a,bodyBase64:c}}",
  "linuxBrowserSecuritySocketPath(e,t){let n=require(`node:os`),r=require(`node:path`),i=process.getuid?.()??`user`,o=process.env.XDG_RUNTIME_DIR&&process.env.XDG_RUNTIME_DIR.length>0?process.env.XDG_RUNTIME_DIR:n.tmpdir();return e||r.join(o,`${t}-${i}.sock`)}",
];

const browserApprovalPolicyMethods = [
  "linuxNormalizeBrowserApprovalOrigin(e){if(typeof e!=`string`||e.trim().length===0)return null;let t=new URL(e);return t.protocol!==`http:`&&t.protocol!==`https:`?null:t.origin}",
  "linuxNormalizeBrowserApprovalRequest(e){if(!e||typeof e!=`object`||Array.isArray(e))throw Error(`Linux browser approval request expected object`);let t=e.meta;if(!t||typeof t!=`object`||Array.isArray(t))throw Error(`Linux browser approval request missing metadata`);if(t.codex_approval_kind!==`mcp_tool_call`||t.connector_id!==`browser-use`)throw Error(`Linux browser approval request is not allowlisted`);if(t.tool_name===`access_browser_origin`){let e=this.linuxNormalizeBrowserApprovalOrigin(t.tool_params&&typeof t.tool_params==`object`?t.tool_params.origin:t.origin);if(!e)throw Error(`Linux browser approval origin is not allowlisted`);return{kind:`origin`,origin:e}}if(t.sensitive_data===`browsing_history`)return{kind:`history`};if(t.file_transfer===`download`||t.file_transfer===`upload`){let e=this.linuxNormalizeBrowserApprovalOrigin(t.origin);if(!e)throw Error(`Linux browser file transfer origin is not allowlisted`);return{kind:`fileTransfer`,transferKind:t.file_transfer,origin:e}}throw Error(`Linux browser approval request is not allowlisted`)}",
  "async linuxReadBrowserUseState(){try{return await A_()}catch(e){Xj().warning(`Linux browser-use state unavailable`,{safe:{},sensitive:{error:e}});return{approvalMode:`alwaysAsk`,historyApprovalMode:`alwaysAsk`,downloadApprovalMode:`alwaysAsk`,uploadApprovalMode:`alwaysAsk`,allowedOrigins:[],deniedOrigins:[],allowedDownloadOrigins:[],deniedDownloadOrigins:[],allowedUploadOrigins:[],deniedUploadOrigins:[]}}}",
  "linuxBrowserOriginListIncludes(e,t){return Array.isArray(e)&&e.includes(t)}",
  "async linuxResolveBrowserApprovalPolicy(e){let t=await this.linuxReadBrowserUseState();if(e.kind===`origin`){if(this.linuxBrowserOriginListIncludes(t.deniedOrigins,e.origin))return{action:`decline`};if(this.linuxBrowserOriginListIncludes(t.allowedOrigins,e.origin))return{action:`accept`};return t.approvalMode===`neverAsk`?{action:`accept`}:null}if(e.kind===`history`)return t.historyApprovalMode===`neverAsk`?{action:`accept`}:null;let n=e.transferKind===`download`,r=n?t.deniedDownloadOrigins:t.deniedUploadOrigins,i=n?t.allowedDownloadOrigins:t.allowedUploadOrigins,o=n?t.downloadApprovalMode:t.uploadApprovalMode;if(this.linuxBrowserOriginListIncludes(r,e.origin))return{action:`decline`};if(this.linuxBrowserOriginListIncludes(i,e.origin))return{action:`accept`};return o===`neverAsk`?{action:`accept`}:null}",
  "linuxApprovalRequestWantsAlways(e){let t=e?.persist??e?.meta?.persist;return t===`always`||Array.isArray(t)&&t.includes(`always`)}",
  "async linuxRememberBrowserApproval(e){try{e.kind===`origin`?await F_(`allowed`,e.origin):e.kind===`fileTransfer`&&await I_(e.transferKind,`allowed`,e.origin)}catch(t){Xj().warning(`Linux browser-use approval persist failed`,{safe:{kind:e.kind,origin:e.origin??null,transferKind:e.transferKind??null},sensitive:{error:t}})}}",
];

const browserApprovalDialogMethods = [
  "linuxBrowserApprovalPrompt(e){return e.kind===`origin`?{title:`Allow Browser Use access?`,message:`Allow Browser Use to access ${e.origin}?`,detail:`Codex Chrome/Browser Use requested access to this website origin.`}:e.kind===`history`?{title:`Allow Browser Use history access?`,message:`Allow Browser Use to read your browsing history?`,detail:`Codex Chrome/Browser Use requested access to browser history.`}:{title:`Allow Browser Use file ${e.transferKind}?`,message:`Allow Browser Use to ${e.transferKind} files on ${e.origin}?`,detail:`Codex Chrome/Browser Use requested file transfer access for this website origin.`}}",
  "async linuxAskBrowserApprovalWithDesktopDialog(e,t){let n=require(`electron`),r=n.BrowserWindow.getFocusedWindow?.()??n.BrowserWindow.getAllWindows?.()[0]??void 0,i=this.linuxBrowserApprovalPrompt(t),o=this.linuxApprovalRequestWantsAlways(e)&&t.kind!==`history`,s=o?[`Allow always`,`Allow once`,`Deny`]:[`Allow`,`Deny`],a=await n.dialog.showMessageBox(r,{type:`question`,buttons:s,defaultId:o?1:0,cancelId:o?2:1,noLink:!0,title:i.title,message:i.message,detail:i.detail});return o?a.response===0?(await this.linuxRememberBrowserApproval(t),{action:`accept`}):a.response===1?{action:`accept`}:{action:`decline`}:a.response===0?{action:`accept`}:{action:`decline`}}",
  "async linuxRequestBrowserApproval(e){let t=this.linuxNormalizeBrowserApprovalRequest(e),n=await this.linuxResolveBrowserApprovalPolicy(t);return n?n:this.linuxAskBrowserApprovalWithDesktopDialog(e,t)}",
];

const browserSecuritySocketServerMethods = [
  "startLinuxAuthenticatedFetchServer(){if(process.platform!==`linux`||this.linuxAuthenticatedFetchServer)return;let e=require(`node:net`),t=require(`node:fs`),n=this.linuxBrowserSecuritySocketPath(process.env.CODEX_DESKTOP_AUTH_FETCH_SOCKET,`codex-desktop-auth-fetch`);process.env.CODEX_DESKTOP_AUTH_FETCH_SOCKET=n;try{t.rmSync(n,{force:!0})}catch{}let r=e.createServer({allowHalfOpen:!0},e=>{let t=[];e.on(`data`,e=>{if(t.push(Buffer.from(e)),t.reduce((e,t)=>e+t.length,0)>1048576)e.destroy(Error(`Linux authenticated fetch request too large`))}),e.on(`end`,async()=>{try{let r=JSON.parse(Buffer.concat(t).toString(`utf8`)||`{}`),i=await this.linuxAuthenticatedFetch(r);e.end(JSON.stringify({ok:!0,...i}))}catch(t){e.end(JSON.stringify({ok:!1,error:t instanceof Error?t.message:String(t)}))}})});r.on(`error`,e=>Xj().warning(`Linux authenticated fetch server failed`,{safe:{socketPath:n},sensitive:{error:e}})),r.listen(n,()=>{try{t.chmodSync(n,384)}catch{}}),this.linuxAuthenticatedFetchServer=r,process.once(`exit`,()=>{try{r.close()}catch{}try{t.rmSync(n,{force:!0})}catch{}})}",
  "startLinuxBrowserApprovalServer(){if(process.platform!==`linux`||this.linuxBrowserApprovalServer)return;let e=require(`node:net`),t=require(`node:fs`),n=this.linuxBrowserSecuritySocketPath(process.env.CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET,`codex-browser-approval`);process.env.CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET=n;try{t.rmSync(n,{force:!0})}catch{}let r=e.createServer({allowHalfOpen:!0},e=>{let t=[];e.on(`data`,e=>{if(t.push(Buffer.from(e)),t.reduce((e,t)=>e+t.length,0)>1048576)e.destroy(Error(`Linux browser approval request too large`))}),e.on(`end`,async()=>{try{let n=JSON.parse(Buffer.concat(t).toString(`utf8`)||`{}`),r=await this.linuxRequestBrowserApproval(n);e.end(JSON.stringify({ok:!0,...r}))}catch(t){e.end(JSON.stringify({ok:!1,error:t instanceof Error?t.message:String(t)}))}})});r.on(`error`,e=>Xj().warning(`Linux browser approval server failed`,{safe:{socketPath:n},sensitive:{error:e}})),r.listen(n,()=>{try{t.chmodSync(n,384)}catch{}}),this.linuxBrowserApprovalServer=r,process.once(`exit`,()=>{try{r.close()}catch{}try{t.rmSync(n,{force:!0})}catch{}})}",
  "startLinuxBrowserSecurityServers(){this.startLinuxAuthenticatedFetchServer?.(),this.startLinuxBrowserApprovalServer?.()}cancelRequest(e){",
];

const browserSecurityMethods = [
  ...browserAuthenticatedFetchMethods,
  ...browserApprovalPolicyMethods,
  ...browserApprovalDialogMethods,
  ...browserSecuritySocketServerMethods,
].join("");

export const browserSecurityFeature = {
  id: "browser-security",
  version: 1,
  requiredMarkers: FEATURE_MARKERS["browser-security"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["browser-security"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let main = replaceOrThrow(
      bundleSources.main,
      browserSecurityMethodsAnchor,
      browserSecurityMethods,
      "Linux browser security methods",
    );

    main = replaceOrThrow(
      main,
      "prodApiBaseUrl:r.prodApiBaseUrl}),d=new",
      "prodApiBaseUrl:r.prodApiBaseUrl,hostId:L});u.startLinuxBrowserSecurityServers?.();let d=new",
      "Linux browser security server startup",
    );

    return {
      ...bundleSources,
      main,
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(bundleSources.main, this.requiredMarkers, "Linux browser security patch");
    ensureMarkersAbsent(bundleSources.main, this.forbiddenMarkers, "Linux browser security patch");
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
