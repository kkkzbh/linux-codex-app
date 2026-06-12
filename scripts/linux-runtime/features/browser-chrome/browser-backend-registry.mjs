import { FEATURE_MARKERS } from "../../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../../replace-utils.mjs";

const iabNativePipeAnchor =
  "var CB=t.Ur(`browser-use-native-pipe-server`);async function wB({apiImpl:e,nativePipeDirectory:t,pipePath:n,socketPeerAuthorizer:r=xB()}){let i;try{i=await sB({nativePipeDirectory:t,pipePath:n,socketPeerAuthorizer:r,events:{onListening:e=>{CB().info(`browser-use native pipe listening`,{safe:{},sensitive:{pipePath:e}})},onAuthorizationError:e=>{CB().warning(`browser-use native pipe peer authorization failed`,{safe:{},sensitive:{error:e}})},onRejectedSocket:e=>{CB().warning(`browser-use native pipe rejected socket peer`,{safe:{reason:e.reason??`unauthorized`},sensitive:{}})},onSocketError:e=>{CB().warning(`browser-use native pipe socket error`,{safe:{},sensitive:{error:e}})}}})}catch(t){throw e.dispose(),t}let a=new lt(i,e,{onMoveMouseError:(e,t)=>{CB().warning(`IAB_LIFECYCLE failed to move browser use cursor`,{safe:{tabId:t.tabId},sensitive:{error:e}})}}),o=e.addCdpEventListener(e=>{a.sendCdpEvent(e)});return{pipePath:i.pipePath,dispose:async()=>{o(),e.dispose(),await i.close()}}}function TB";

const iabNativePipeReplacement =
  "var CB=t.Ur(`browser-use-native-pipe-server`);function codexLinuxBrowserRegistryPath(){let e=require(`node:os`),t=require(`node:path`),n=process.getuid?.()??`user`,r=process.env.CODEX_BROWSER_BACKENDS_REGISTRY;return r&&r.trim().length>0?r:t.join(process.env.XDG_RUNTIME_DIR&&process.env.XDG_RUNTIME_DIR.length>0?process.env.XDG_RUNTIME_DIR:e.tmpdir(),`codex-browser-backends-${n}.json`)}function codexLinuxBrowserPidAlive(e){try{return process.kill(e,0),!0}catch{return!1}}function codexLinuxReadBrowserRegistry(e=codexLinuxBrowserRegistryPath()){let t=require(`node:fs`);try{let n=JSON.parse(t.readFileSync(e,`utf8`));return{version:1,backends:Array.isArray(n?.backends)?n.backends:[]}}catch{return{version:1,backends:[]}}}function codexLinuxWriteBrowserRegistry(e,t=codexLinuxBrowserRegistryPath()){let n=require(`node:fs`),r=require(`node:path`);n.mkdirSync(r.dirname(t),{recursive:!0,mode:448}),n.writeFileSync(t,`${JSON.stringify({version:1,backends:e.backends},null,2)}\\n`,{mode:384})}function codexLinuxNormalizeBrowserBackend(e){if(!e||typeof e!=`object`||Array.isArray(e))return null;let t=e.type,n=e.socketPath,r=Number(e.pid),i=Number(e.createdAtMs),a=e.owner;if(t!==`extension`&&t!==`iab`&&t!==`cdp`)return null;if(typeof n!=`string`||n.length===0||!require(`node:path`).isAbsolute(n))return null;if(!Number.isInteger(r)||r<=0)return null;if(!Number.isFinite(i)||i<=0)return null;if(typeof a!=`string`||a.length===0)return null;return{type:t,socketPath:n,pid:r,createdAtMs:i,owner:a}}function codexLinuxPruneBrowserRegistry(){let e=codexLinuxReadBrowserRegistry(),t=e.backends.map(codexLinuxNormalizeBrowserBackend).filter(Boolean).filter(e=>codexLinuxBrowserPidAlive(e.pid));return codexLinuxWriteBrowserRegistry({version:1,backends:t}),{version:1,backends:t}}function codexLinuxRegisterBrowserBackend(e,t,n){if(process.platform!==`linux`)return()=>{};let r=codexLinuxNormalizeBrowserBackend({type:e,socketPath:t,pid:process.pid,createdAtMs:Date.now(),owner:n});if(!r)throw Error(`Invalid Linux browser backend registry entry`);let i=codexLinuxPruneBrowserRegistry(),a=i.backends.filter(e=>e.pid!==r.pid||e.socketPath!==r.socketPath).concat(r);codexLinuxWriteBrowserRegistry({version:1,backends:a});return()=>{let e=codexLinuxReadBrowserRegistry(),t=e.backends.map(codexLinuxNormalizeBrowserBackend).filter(Boolean).filter(e=>e.pid!==r.pid||e.socketPath!==r.socketPath);if(t.length===0){try{require(`node:fs`).rmSync(codexLinuxBrowserRegistryPath(),{force:!0})}catch{}return}codexLinuxWriteBrowserRegistry({version:1,backends:t})}}async function wB({apiImpl:e,nativePipeDirectory:t,pipePath:n,socketPeerAuthorizer:r=xB()}){let i;try{i=await sB({nativePipeDirectory:t,pipePath:n,socketPeerAuthorizer:r,events:{onListening:e=>{CB().info(`browser-use native pipe listening`,{safe:{},sensitive:{pipePath:e}})},onAuthorizationError:e=>{CB().warning(`browser-use native pipe peer authorization failed`,{safe:{},sensitive:{error:e}})},onRejectedSocket:e=>{CB().warning(`browser-use native pipe rejected socket peer`,{safe:{reason:e.reason??`unauthorized`},sensitive:{}})},onSocketError:e=>{CB().warning(`browser-use native pipe socket error`,{safe:{},sensitive:{error:e}})}}})}catch(t){throw e.dispose(),t}let a=null,o=null;try{a=codexLinuxRegisterBrowserBackend(`iab`,i.pipePath,`codex-electron-iab`);let t=new lt(i,e,{onMoveMouseError:(e,t)=>{CB().warning(`IAB_LIFECYCLE failed to move browser use cursor`,{safe:{tabId:t.tabId},sensitive:{error:e}})}});o=e.addCdpEventListener(e=>{t.sendCdpEvent(e)});return{pipePath:i.pipePath,dispose:async()=>{a?.(),o?.(),e.dispose(),await i.close()}}}catch(t){a?.(),o?.(),e.dispose(),await i.close();throw t}}function TB";

export const browserBackendRegistryFeature = {
  id: "browser-backend-registry",
  version: 2,
  requiredMarkers: FEATURE_MARKERS["browser-backend-registry"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["browser-backend-registry"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    return {
      ...bundleSources,
      main: replaceOrThrow(
        bundleSources.main,
        iabNativePipeAnchor,
        iabNativePipeReplacement,
        "Linux typed browser backend registry for IAB",
      ),
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(bundleSources.main, this.requiredMarkers, "Linux browser backend registry patch");
    ensureMarkersAbsent(bundleSources.main, this.forbiddenMarkers, "Linux browser backend registry patch");
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
