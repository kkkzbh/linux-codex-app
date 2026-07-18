import { FEATURE_MARKERS } from "../../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../../replace-utils.mjs";

const IDENTIFIER = String.raw`[$A-Z_a-z][$\w]*`;
const browserUseStateApiRegex = new RegExp(
  String.raw`(?<originRulesService>${IDENTIFIER})=class extends ${IDENTIFIER}\.${IDENTIFIER}\{codexHome;constructor\(e\)\{super\(\),this\.codexHome=e\}async updateOriginRules\(e\)\{let t=${IDENTIFIER}\.parse\(e\),n=await ${IDENTIFIER}\(this\.codexHome\),r=t\.map\(e=>\(\{\.\.\.e,origin:e\.action===\`add\`\?${IDENTIFIER}\(n,e\.resource,e\.origin\):e\.origin\}\)\),i=!1;for\(let e of r\)i=${IDENTIFIER}\(n,e\)\|\|i;return i&&await ${IDENTIFIER}\(this\.codexHome,n\),${IDENTIFIER}\(n\)\}\};async function (?<readState>${IDENTIFIER})\(e=${IDENTIFIER}\.${IDENTIFIER}\(\)\)\{return ${IDENTIFIER}\(await ${IDENTIFIER}\(e\)\)\}`,
  "g",
);

const browserSecurityMethodsAnchor =
  "var Dt=class{browserSessionRegistry;constructor(e){this.browserSessionRegistry=e}setDesktopFeatureAvailability(e){e.inAppBrowserUse!=null&&this.browserSessionRegistry.setBrowserUseNativePipeEnabled(e.inAppBrowserUse)}dispose(){this.browserSessionRegistry.setBrowserUseNativePipeEnabled(!1)}},Ot=";

const browserSecurityMethodsPatchedAnchor =
  "var Dt=class{browserSessionRegistry;constructor(e){this.browserSessionRegistry=e}setDesktopFeatureAvailability(e){e.inAppBrowserUse!=null&&this.browserSessionRegistry.setBrowserUseNativePipeEnabled(e.inAppBrowserUse)}dispose(){this.browserSessionRegistry.setBrowserUseNativePipeEnabled(!1)}};";

function browserUseStateApiBindings(source) {
  const matches = [...source.matchAll(browserUseStateApiRegex)];
  if (matches.length !== 1) {
    throw new Error(
      `Current Browser Use state API anchor matched ${matches.length} times; update the Linux browser security patch for the current upstream bundle`,
    );
  }

  const { originRulesService, readState } = matches[0].groups ?? {};
  if (!originRulesService || !readState) {
    throw new Error("Current Browser Use state API anchor is missing required identifier bindings");
  }

  return { originRulesService, readState };
}

function buildBrowserSecurityMethods({ originRulesService, readState }) {
  return (
    `${browserSecurityMethodsPatchedAnchor}` +
    "function codexLinuxBrowserSecuritySocketPath(e,t){let n=require(`node:os`),r=require(`node:path`),i=process.getuid?.()??`user`,o=process.env.XDG_RUNTIME_DIR&&process.env.XDG_RUNTIME_DIR.length>0?process.env.XDG_RUNTIME_DIR:n.tmpdir();return e||r.join(o,`${t}-${i}.sock`)}" +
    "function codexLinuxNormalizeBrowserApprovalOrigin(e){if(typeof e!=`string`||e.trim().length===0)return null;let t=new URL(e);return t.protocol!==`http:`&&t.protocol!==`https:`?null:t.origin}" +
    "function codexLinuxNormalizeBrowserApprovalRequest(e){if(!e||typeof e!=`object`||Array.isArray(e))throw Error(`Linux browser approval request expected object`);let t=e.meta;if(!t||typeof t!=`object`||Array.isArray(t))throw Error(`Linux browser approval request missing metadata`);if(t.codex_approval_kind!==`mcp_tool_call`||t.connector_id!==`browser-use`)throw Error(`Linux browser approval request is not allowlisted`);if(t.tool_name===`access_browser_origin`){let e=codexLinuxNormalizeBrowserApprovalOrigin(t.tool_params&&typeof t.tool_params==`object`?t.tool_params.origin:t.origin);if(!e)throw Error(`Linux browser approval origin is not allowlisted`);return{kind:`origin`,origin:e}}if(t.sensitive_data===`browsing_history`)return{kind:`history`};if(t.file_transfer===`download`||t.file_transfer===`upload`){let e=codexLinuxNormalizeBrowserApprovalOrigin(t.origin);if(!e)throw Error(`Linux browser file transfer origin is not allowlisted`);return{kind:`fileTransfer`,transferKind:t.file_transfer,origin:e}}throw Error(`Linux browser approval request is not allowlisted`)}" +
    "function codexLinuxBrowserOriginListIncludes(e,t){return Array.isArray(e)&&e.includes(t)}" +
    `async function codexLinuxReadBrowserUseState(e){return await ${readState}(e)}` +
    "async function codexLinuxResolveBrowserApprovalPolicy(e,t){let n=await codexLinuxReadBrowserUseState(t);if(e.kind===`origin`){if(codexLinuxBrowserOriginListIncludes(n.deniedOrigins,e.origin))return{action:`decline`};if(codexLinuxBrowserOriginListIncludes(n.allowedOrigins,e.origin))return{action:`accept`};return n.approvalMode===`neverAsk`?{action:`accept`}:null}if(e.kind===`history`)return n.historyApprovalMode===`neverAsk`?{action:`accept`}:null;let r=e.transferKind===`download`,i=r?n.deniedDownloadOrigins:n.deniedUploadOrigins,a=r?n.allowedDownloadOrigins:n.allowedUploadOrigins,o=r?n.downloadApprovalMode:n.uploadApprovalMode;if(codexLinuxBrowserOriginListIncludes(i,e.origin))return{action:`decline`};if(codexLinuxBrowserOriginListIncludes(a,e.origin))return{action:`accept`};return o===`neverAsk`?{action:`accept`}:null}" +
    "function codexLinuxApprovalRequestWantsAlways(e){let t=e?.persist??e?.meta?.persist;return t===`always`||Array.isArray(t)&&t.includes(`always`)}" +
    `async function codexLinuxRememberBrowserApproval(e,n){await new ${originRulesService}(n).updateOriginRules([{action:\`add\`,kind:\`allowed\`,origin:e.origin,resource:e.kind===\`origin\`?\`origin\`:e.transferKind}])}` +
    "function codexLinuxBrowserApprovalPrompt(e){return e.kind===`origin`?{title:`Allow Browser Use access?`,message:`Allow Browser Use to access ${e.origin}?`,detail:`Codex Chrome/Browser Use requested access to this website origin.`}:e.kind===`history`?{title:`Allow Browser Use history access?`,message:`Allow Browser Use to read your browsing history?`,detail:`Codex Chrome/Browser Use requested access to browser history.`}:{title:`Allow Browser Use file ${e.transferKind}?`,message:`Allow Browser Use to ${e.transferKind} files on ${e.origin}?`,detail:`Codex Chrome/Browser Use requested file transfer access for this website origin.`}}" +
    "async function codexLinuxAskBrowserApprovalWithDesktopDialog(e,n,r,i){let a=codexLinuxBrowserApprovalPrompt(n),o=codexLinuxApprovalRequestWantsAlways(e)&&n.kind!==`history`,s=o?[`Allow always`,`Allow once`,`Deny`]:[`Allow`,`Deny`],c=await r.dialog.showMessageBox(r.BrowserWindow.getFocusedWindow?.()??r.BrowserWindow.getAllWindows?.()[0]??void 0,{type:`question`,buttons:s,defaultId:o?1:0,cancelId:o?2:1,noLink:!0,title:a.title,message:a.message,detail:a.detail});return o?c.response===0?(await codexLinuxRememberBrowserApproval(n,i),{action:`accept`}):c.response===1?{action:`accept`}:{action:`decline`}:c.response===0?{action:`accept`}:{action:`decline`}}" +
    "async function codexLinuxRequestBrowserApproval(e,n,r){let i=codexLinuxNormalizeBrowserApprovalRequest(e),a=await codexLinuxResolveBrowserApprovalPolicy(i,n);return a??codexLinuxAskBrowserApprovalWithDesktopDialog(e,i,r,n)}" +
    "async function codexLinuxAuthenticatedFetch(e,t){let n=new URL(String(e?.url??``)),i=String(e?.method??`GET`).toUpperCase();if(n.origin!==`https://chatgpt.com`||n.pathname!==`/backend-api/aura/site_status`||i!==`GET`)throw Error(`Linux authenticated fetch URL is not allowlisted`);let r=await a.P({action:`perform Linux authenticated browser fetch`,appServerClient:t.appServerClient,desktopOriginator:a.z,headers:{},refreshToken:!1}),o=await c.net.fetch(n.toString(),{method:`GET`,headers:r});if(o.status===401){r=await a.P({action:`perform Linux authenticated browser fetch`,appServerClient:t.appServerClient,desktopOriginator:a.z,headers:{},refreshToken:!0}),o=await c.net.fetch(n.toString(),{method:`GET`,headers:r})}let s={};o.headers.forEach((e,t)=>{s[t]=e});let a=Buffer.from(await o.arrayBuffer()).toString(`base64`);return{status:o.status,statusText:o.statusText,headers:s,bodyBase64:a}}" +
    "function codexLinuxCreateJsonSocketServer(e,n){let i=require(`node:net`),a=require(`node:fs`),o=codexLinuxBrowserSecuritySocketPath(process.env[e],n);process.env[e]=o;try{a.rmSync(o,{force:!0})}catch{}let s=i.createServer({allowHalfOpen:!0},e=>{let t=[];e.on(`data`,e=>{if(t.push(Buffer.from(e)),t.reduce((e,t)=>e+t.length,0)>1048576)e.destroy(Error(`Linux browser security request too large`))}),e.on(`end`,async()=>{try{let n=JSON.parse(Buffer.concat(t).toString(`utf8`)||`{}`),r=await this(n);e.end(JSON.stringify({ok:!0,...r}))}catch(t){e.end(JSON.stringify({ok:!1,error:t instanceof Error?t.message:String(t)}))}})});return s.on(`error`,n=>{r.r().warning(`Linux browser security socket failed`,{safe:{socketEnv:e,socketPath:o},sensitive:{error:n}})}),s.listen(o,()=>{try{a.chmodSync(o,384)}catch{}}),{socketPath:o,dispose:()=>{try{s.close()}catch{}try{a.rmSync(o,{force:!0})}catch{}}}}" +
    "function codexLinuxStartBrowserSecurityServers(e){if(process.platform!==`linux`)return{dispose(){}};let n=[],r=codexLinuxCreateJsonSocketServer.call(t=>codexLinuxAuthenticatedFetch(t,e),`CODEX_DESKTOP_AUTH_FETCH_SOCKET`,`codex-desktop-auth-fetch`),i=codexLinuxCreateJsonSocketServer.call(t=>codexLinuxRequestBrowserApproval(t,e.codexHome,c),`CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET`,`codex-browser-approval`);return n.push(r,i),{dispose:()=>{for(let e of n)e.dispose()}}}var Ot="
  );
}

export const browserSecurityFeature = {
  id: "browser-security",
  version: 3,
  requiredMarkers: FEATURE_MARKERS["browser-security"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["browser-security"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    const bindings = browserUseStateApiBindings(bundleSources.main);
    const browserSecurityMethods = buildBrowserSecurityMethods(bindings);
    let main = replaceOrThrow(
      bundleSources.main,
      browserSecurityMethodsAnchor,
      browserSecurityMethods,
      "Linux browser security methods",
    );

    main = replaceOrThrow(
      main,
      "let Oe=new Dt(he.getBrowserSessionRegistry());M.add(()=>{Oe.dispose(),Te.dispose()});",
      "let Oe=new Dt(he.getBrowserSessionRegistry()),codexLinuxBrowserSecurity=codexLinuxStartBrowserSecurityServers({appServerClient:he.getAppServerClient(),codexHome:P.codexHome});M.add(()=>{Oe.dispose(),Te.dispose(),codexLinuxBrowserSecurity.dispose()});",
      "Linux browser security server startup",
    );

    return {
      ...bundleSources,
      main,
    };
  },
  verify(bundleSources) {
    const bindings = browserUseStateApiBindings(bundleSources.main);
    ensureMarkersPresent(
      bundleSources.main,
      [
        `async function codexLinuxReadBrowserUseState(e){return await ${bindings.readState}(e)}`,
        `await new ${bindings.originRulesService}(n).updateOriginRules([{action:\`add\`,kind:\`allowed\`,origin:e.origin,resource:e.kind===\`origin\`?\`origin\`:e.transferKind}])`,
      ],
      "Linux browser security official Browser Use state bindings",
    );
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
