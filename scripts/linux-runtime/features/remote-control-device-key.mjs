import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const upstreamDeviceKeyClient =
  "function wJ({resourcesPath:e}){let t=null,n=()=>{if(process.platform!==`darwin`)throw Error(`Remote control device keys are only available on macOS`);if(e==null)throw Error(`Remote control device keys require resourcesPath`);return t??=bJ((0,o.join)(e,`native`,xJ)),t};return{createDeviceKey:e=>n().createDeviceKey(e??`hardware_only`),deleteDeviceKey:e=>n().deleteDeviceKey(e),getDeviceKeyPublic:e=>n().getDeviceKeyPublic(e),signDeviceKey:async(e,t)=>{let r=TJ(t);return{...await n().signDeviceKey(e,r),signedPayloadBase64:r.toString(`base64`)}}}}";

const linuxDeviceKeyClient = `function codexLinuxDeviceKeyStorePaths(){let e=require('node:os'),t=require('node:path'),n=typeof process.env.CODEX_HOME=='string'?process.env.CODEX_HOME.trim():'',r=n.length>0?t.resolve(n):t.join(e.homedir(),'.codex'),i=typeof process.env.XDG_DATA_HOME=='string'?process.env.XDG_DATA_HOME.trim():'',a=t.join(i.length>0?i:t.join(e.homedir(),'.local','share'),'codex-app','device-keys','keys.json');return[t.join(r,'remote-control','device-keys','keys.json'),a]}function codexLinuxDeviceKeyStorePath(){return codexLinuxDeviceKeyStorePaths()[0]}function codexLinuxNormalizeDeviceKeyRecord(e){return e&&typeof e=='object'&&!Array.isArray(e)&&typeof e.keyId=='string'&&typeof e.privateKeyPem=='string'&&typeof e.publicKeySpkiDerBase64=='string'&&e.algorithm==='ecdsa_p256_sha256'&&e.protectionClass==='os_protected_nonextractable'?e:null}function codexLinuxNormalizeDeviceKeyStore(e){if(!e||typeof e!='object'||Array.isArray(e)||e.version!==1||!e.keys||typeof e.keys!='object'||Array.isArray(e.keys))return null;let t={};for(let[n,r]of Object.entries(e.keys)){let e=codexLinuxNormalizeDeviceKeyRecord(r);e!=null&&e.keyId===n&&(t[n]=e)}return{version:1,keys:t}}function codexLinuxQuarantineDeviceKeyStore(e){try{let t=require('node:fs');t.existsSync(e)&&t.renameSync(e,e+'.invalid-'+Date.now())}catch{}}function codexLinuxLoadDeviceKeyStore(){let e=require('node:fs'),t={version:1,keys:{}},n=!1,r=codexLinuxDeviceKeyStorePaths();for(let i of r){if(!e.existsSync(i))continue;try{let r=codexLinuxNormalizeDeviceKeyStore(JSON.parse(e.readFileSync(i,'utf8')));if(r==null){codexLinuxQuarantineDeviceKeyStore(i);continue}for(let[e,n]of Object.entries(r.keys))t.keys[e]??=n;n=!0}catch{codexLinuxQuarantineDeviceKeyStore(i)}}return n&&Object.keys(t.keys).length>0&&r[0]!==void 0&&e.existsSync(r[0])===!1&&codexLinuxSaveDeviceKeyStore(t),t}function codexLinuxSaveDeviceKeyStore(e){let t=require('node:fs'),n=require('node:path'),r=require('node:crypto'),i=codexLinuxDeviceKeyStorePath(),a=n.dirname(i);t.mkdirSync(a,{recursive:!0,mode:448});let o=n.join(a,'.'+n.basename(i)+'.'+process.pid+'.'+Date.now()+'.'+r.randomUUID()+'.tmp');try{t.writeFileSync(o,JSON.stringify({version:1,keys:e.keys},null,2)+'\\n',{encoding:'utf8',mode:384}),t.renameSync(o,i),t.chmodSync(a,448),t.chmodSync(i,384)}catch(e){try{t.rmSync(o,{force:!0})}catch{}throw e}}function codexLinuxRemoteControlDeviceKeyBackend(){let e=require('node:crypto');return{createDeviceKey:(t='hardware_only')=>{if(t==='hardware_only')throw Error('Linux remote-control device keys require allow_os_protected_nonextractable policy');if(t!=='allow_os_protected_nonextractable')throw Error('Unsupported Linux remote-control device-key policy');let n=codexLinuxLoadDeviceKeyStore(),{publicKey:r,privateKey:i}=e.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),a='linux-'+e.randomUUID(),o=r.export({type:'spki',format:'der'}).toString('base64'),s=i.export({type:'pkcs8',format:'pem'});return n.keys[a]={keyId:a,algorithm:'ecdsa_p256_sha256',protectionClass:'os_protected_nonextractable',publicKeySpkiDerBase64:o,privateKeyPem:s,createdAtMs:Date.now()},codexLinuxSaveDeviceKeyStore(n),{keyId:a,algorithm:'ecdsa_p256_sha256',protectionClass:'os_protected_nonextractable',publicKeySpkiDerBase64:o}},deleteDeviceKey:t=>{let n=codexLinuxLoadDeviceKeyStore();delete n.keys[t],codexLinuxSaveDeviceKeyStore(n)},getDeviceKeyPublic:t=>{let n=codexLinuxNormalizeDeviceKeyRecord(codexLinuxLoadDeviceKeyStore().keys[t]);if(!n)throw Error('Linux remote-control device key not found');return{keyId:n.keyId,algorithm:n.algorithm,protectionClass:n.protectionClass,publicKeySpkiDerBase64:n.publicKeySpkiDerBase64}},signDeviceKey:async(t,n)=>{if(!Buffer.isBuffer(n))throw Error('Linux remote-control device-key payload must be a Buffer');let r=codexLinuxNormalizeDeviceKeyRecord(codexLinuxLoadDeviceKeyStore().keys[t]);if(!r)throw Error('Linux remote-control device key not found');let i=e.createPrivateKey(r.privateKeyPem),a=e.createPublicKey(i).export({type:'spki',format:'der'}).toString('base64');if(a!==r.publicKeySpkiDerBase64)throw Error('Linux remote-control device keypair does not match public identity');let o=e.sign('sha256',n,i);return{algorithm:r.algorithm,signatureDerBase64:o.toString('base64')}}}}function wJ({resourcesPath:e}){let t=null,n=()=>{if(process.platform==='linux')return t??=codexLinuxRemoteControlDeviceKeyBackend();if(process.platform!==\`darwin\`)throw Error(\`Remote control device keys are unavailable on this platform\`);if(e==null)throw Error(\`Remote control device keys require resourcesPath\`);return t??=bJ((0,o.join)(e,\`native\`,xJ)),t};return{createDeviceKey:e=>n().createDeviceKey(e??\`hardware_only\`),deleteDeviceKey:e=>n().deleteDeviceKey(e),getDeviceKeyPublic:e=>n().getDeviceKeyPublic(e),signDeviceKey:async(e,t)=>{let r=TJ(t);return{...await n().signDeviceKey(e,r),signedPayloadBase64:r.toString(\`base64\`)}}}}`;

export const remoteControlDeviceKeyFeature = {
  id: "remote-control-device-key",
  version: 3,
  requiredMarkers: FEATURE_MARKERS["remote-control-device-key"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["remote-control-device-key"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    return {
      ...bundleSources,
      main: replaceOrThrow(
        bundleSources.main,
        upstreamDeviceKeyClient,
        linuxDeviceKeyClient,
        "Linux remote-control device-key backend",
      ),
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(bundleSources.main, this.requiredMarkers, "Linux remote-control device-key patch");
    ensureMarkersAbsent(bundleSources.main, this.forbiddenMarkers, "Linux remote-control device-key patch");
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
