import { patchFile } from "./patch-utils.mjs";

const IDENTIFIER = String.raw`[$A-Z_a-z][$\w]*`;

function replacementGroups(args) {
  const groups = args.at(-1);
  if (!groups || typeof groups !== "object") {
    throw new Error("Browser client patch expected named regex groups");
  }
  return groups;
}

const nativePipeBridgeRegex = new RegExp(
  String.raw`function (?<fn>${IDENTIFIER})\(\)\{let (?<nativePipe>${IDENTIFIER})=globalThis\.nodeRepl\?\.nativePipe;return \k<nativePipe>==null\|\|typeof \k<nativePipe>\.createConnection!="function"\?null:\k<nativePipe>\}`,
);

function replaceNativePipeBridge(...args) {
  const { fn, nativePipe } = replacementGroups(args);
  return `function ${fn}(){let ${nativePipe}=globalThis.browserAutomation?.nativePipe??globalThis.__codexNativePipe;return ${nativePipe}==null||typeof ${nativePipe}.createConnection!="function"?null:${nativePipe}}`;
}

function replaceBrowserAutomationGlobal(source) {
  return source
    .replaceAll('"nodeRepl"in globalThis&&globalThis.nodeRepl', '"browserAutomation"in globalThis&&globalThis.browserAutomation')
    .replaceAll("globalThis.nodeRepl", "globalThis.browserAutomation")
    .replaceAll("e.nodeRepl", "e.browserAutomation")
    .replaceAll("privilegedNodeRepl", "privilegedBrowserAutomation")
    .replaceAll("outside node repl", "outside browser automation");
}

const backendInfoRequestRegex = new RegExp(
  String.raw`async function (?<fn>${IDENTIFIER})\((?<socketPath>${IDENTIFIER}),(?<createApi>${IDENTIFIER})\)\{let (?<api>${IDENTIFIER})=null,(?<phase>${IDENTIFIER})="pipe-connect";try\{let (?<transport>${IDENTIFIER})=await (?<nativePipeClass>${IDENTIFIER})\.create\(\k<socketPath>\);\k<api>=\k<createApi>\(\k<transport>\),\k<phase>="backend-info-request";let (?<info>${IDENTIFIER})=await (?<getInfoWithTimeout>${IDENTIFIER})\(\k<api>\.getInfo\(\)\),(?<enrichedInfo>${IDENTIFIER})=await (?<enrichInfo>${IDENTIFIER})\(\k<info>\)\.catch\((?<enrichError>${IDENTIFIER})=>\((?<logError>${IDENTIFIER})\(\k<enrichError>\),\k<info>\)\);return\{browser:\{id:crypto\.randomUUID\(\)\.substring\(8\),api:\k<api>,info:await (?<augmentInfo>${IDENTIFIER})\(\k<enrichedInfo>\)\}\}\}catch\((?<caughtError>${IDENTIFIER})\)\{return await \k<api>\?\.close\(\),\k<logError>\(\k<caughtError>\),\{failure:\`\$\{\k<phase>\}/\$\{(?<formatError>${IDENTIFIER})\(\k<caughtError>\)\}\`\}\}\}`,
);

function replaceBackendInfoRequest(...args) {
  const {
    fn,
    socketPath,
    createApi,
    api,
    phase,
    transport,
    nativePipeClass,
    info,
    enrichedInfo,
    enrichInfo,
    enrichError,
    logError,
    augmentInfo,
    caughtError,
    formatError,
  } = replacementGroups(args);
  const registryEntry = "codexLinuxBackendEntry";

  return `async function ${fn}(${socketPath},${createApi}){let ${api}=null,${phase}="pipe-connect";try{let ${transport}=await ${nativePipeClass}.create(${socketPath});${api}=${createApi}(${transport}),${phase}="backend-info-request";let ${info}=await Promise.race([${api}.getInfo(),new Promise((codexLinuxResolve,codexLinuxReject)=>setTimeout(()=>codexLinuxReject(new Error("browser backend info request timed out")),4000))]),${registryEntry}=globalThis.__codexBrowserBackendRegistryByPath?.get?.(${socketPath});if(${registryEntry}&&${registryEntry}.type!==${info}.type)throw new Error(\`browser backend registry type mismatch for \${${socketPath}}: expected \${${registryEntry}.type}, got \${${info}.type}\`);let ${enrichedInfo}=await ${enrichInfo}(${info}).catch(${enrichError}=>(${logError}(${enrichError}),${info}));return{browser:{id:crypto.randomUUID().substring(8),api:${api},info:await ${augmentInfo}(${enrichedInfo})}}}catch(${caughtError}){return await ${api}?.close(),${logError}(${caughtError}),{failure:\`\${${phase}}/\${${formatError}(${caughtError})}\`}}}`;
}

const linuxRegistryReaderRegex = new RegExp(
  String.raw`var (?<discover>${IDENTIFIER})=\(\)=>(?<platform>${IDENTIFIER})\(\)==="win32"\?(?<windowsReader>${IDENTIFIER})\(\):(?<linuxReader>${IDENTIFIER})\(\),\k<linuxReader>=async\(\)=>\(await (?<readDir>${IDENTIFIER})\((?<pipePrefix>${IDENTIFIER})\)\)\.map\((?<entry>${IDENTIFIER})=>(?<pathModule>${IDENTIFIER})\.resolve\(\k<pipePrefix>,\k<entry>\)\),\k<windowsReader>=async\(\)=>\{let (?<windowsPipeRoot>${IDENTIFIER})="[^"]*pipe[^"]*";return\(await \k<readDir>\(\k<windowsPipeRoot>\)\)\.map\((?<windowsEntry>${IDENTIFIER})=>\k<pathModule>\.resolve\(\k<windowsPipeRoot>,\k<windowsEntry>\)\)\.filter\((?<candidate>${IDENTIFIER})=>\k<candidate>\.startsWith\(\k<pipePrefix>\)\)\};`,
);

function replaceLinuxRegistryReader(...args) {
  const {
    discover,
    platform,
    windowsReader,
    linuxReader,
    readDir,
    pipePrefix,
    pathModule,
    windowsPipeRoot,
    windowsEntry,
    candidate,
  } = replacementGroups(args);

  return `var ${discover}=()=>${platform}()==="win32"?${windowsReader}():${linuxReader}(),${linuxReader}=async()=>{let l=(await import("node:process")).default,{readFile:d}=await import("node:fs/promises"),p={...l.env};if((!p.CODEX_BROWSER_BACKENDS_REGISTRY||p.CODEX_BROWSER_BACKENDS_REGISTRY.length===0)&&(!p.XDG_RUNTIME_DIR||p.XDG_RUNTIME_DIR.length===0)&&l.ppid)try{for(let e of(await d(\`/proc/\${l.ppid}/environ\`,"utf8")).split("\\0")){let t=e.indexOf("=");if(t>0){let r=e.slice(0,t),n=e.slice(t+1);(r==="CODEX_BROWSER_BACKENDS_REGISTRY"||r==="XDG_RUNTIME_DIR")&&(p[r]=n)}}}catch{}let c=p.CODEX_BROWSER_BACKENDS_REGISTRY||(p.XDG_RUNTIME_DIR&&p.XDG_RUNTIME_DIR.length>0?${pathModule}.resolve(p.XDG_RUNTIME_DIR,\`codex-browser-backends-\${l.getuid?.()??"user"}.json\`):${pathModule}.resolve("/tmp",\`codex-browser-backends-\${l.getuid?.()??"user"}.json\`)),e=await d(c,"utf8").catch(r=>{throw new Error(\`Linux browser backend registry unavailable at \${c}: \${r instanceof Error?r.message:String(r)}\`)}),r=JSON.parse(e),n=Array.isArray(r?.backends)?r.backends:[],o=new Map,i=[];for(let e of n){if(!e||typeof e!="object"||Array.isArray(e))continue;let t=e.type,a=e.socketPath,u=Number(e.pid),f=Number(e.createdAtMs),m=e.owner;if(!(t==="extension"||t==="iab"||t==="cdp")||typeof a!="string"||a.length===0||!${pathModule}.isAbsolute(a)||!Number.isInteger(u)||u<=0||!Number.isFinite(f)||f<=0||typeof m!="string"||m.length===0)continue;try{l.kill(u,0)}catch{continue}o.set(a,{type:t,pid:u,createdAtMs:f,owner:m}),i.push(a)}if(i.length===0)throw new Error(\`Linux browser backend registry has no live entries: \${c}\`);globalThis.__codexBrowserBackendRegistryByPath=o;return i},${windowsReader}=async()=>{let ${windowsPipeRoot}="\\\\\\\\.\\\\pipe\\\\";return(await ${readDir}(${windowsPipeRoot})).map(${windowsEntry}=>${pathModule}.resolve(${windowsPipeRoot},${windowsEntry})).filter(${candidate}=>${candidate}.startsWith(${pipePrefix}))};`;
}

const nonBlockingMouseMoveRegex = new RegExp(
  String.raw`let (?<pending>${IDENTIFIER})=this\.api\.moveMouse\(\{tabId:(?<tabId>${IDENTIFIER}),\.\.\.(?<options>${IDENTIFIER})\.waitForArrival===!1\?\{waitForArrival:!1\}:\{\},x:(?<x>${IDENTIFIER}),y:(?<y>${IDENTIFIER})\}\);if\(\k<options>\.waitForArrival===!1\)\{\k<pending>\.catch\(\(\)=>\{\}\);return\}await \k<pending>`,
);

function replaceNonBlockingMouseMove(...args) {
  const { pending, tabId, x, y } = replacementGroups(args);
  return `let ${pending}=this.api.moveMouse({tabId:${tabId},waitForArrival:!1,x:${x},y:${y}});${pending}.catch(()=>{});return`;
}

const directClickDispatchRegex = new RegExp(
  String.raw`async clickPoint\((?<event>${IDENTIFIER})\)\{let (?<tabId>${IDENTIFIER})=(?<normalizeTab>${IDENTIFIER})\(\k<event>\.tabId\),(?<timeout>${IDENTIFIER})=(?<normalizeTimeout>${IDENTIFIER})\(\{timeout_ms:\k<event>\.timeoutMs\}\),(?<button>${IDENTIFIER})=\k<event>\.button\?\?"left",(?<loadTargets>${IDENTIFIER})=\k<event>\.loadTarget==null\|\|!(?<isLoadTarget>${IDENTIFIER})\(\k<event>\.loadTarget\)\?\[\k<tabId>\]:\[\k<event>\.loadTarget,\k<tabId>\],(?<pageLoadWait>${IDENTIFIER})=Promise\.all\(\k<loadTargets>\.map\(async (?<loadTarget>${IDENTIFIER})=>this\.cdp\.waitForPageLoadEvent\(\k<loadTarget>,\{timeoutMs:\k<timeout>\}\)\)\),(?<ignoredLoadWait>${IDENTIFIER})=\k<pageLoadWait>\.catch\(\(\)=>\{\}\);try\{await this\.dispatchMouseMove\(\k<tabId>,\k<event>\.point,\k<event>\.modifiers\);for\(let (?<index>${IDENTIFIER})=1;\k<index><=\k<event>\.clickCount;\k<index>\+=1\)await this\.dispatchMouseDown\(\{button:\k<button>,clickCount:\k<index>,modifiers:\k<event>\.modifiers,point:\k<event>\.point,tabId:\k<tabId>\}\),await this\.dispatchMouseUp\(\{button:\k<button>,clickCount:\k<index>,modifiers:\k<event>\.modifiers,point:\k<event>\.point,tabId:\k<tabId>\}\)\}catch\((?<error>${IDENTIFIER})\)\{throw await \k<ignoredLoadWait>,\k<error>\}await \k<pageLoadWait>\}(?=async dispatchMouseDown\()`,
);

function replaceDirectClickDispatch(...args) {
  const { event, tabId, normalizeTab, button, index } = replacementGroups(args);
  return `async clickPoint(${event}){let ${tabId}=${normalizeTab}(${event}.tabId),${button}=${event}.button??"left";await this.ui.moveMouse(${tabId},${event}.point.x,${event}.point.y);await this.cdp.call(${tabId},"Input.dispatchMouseEvent",{type:"mouseMoved",x:${event}.point.x,y:${event}.point.y,button:"none",buttons:0,modifiers:${event}.modifiers});for(let ${index}=1;${index}<=${event}.clickCount;${index}+=1)await this.dispatchMouseDown({button:${button},clickCount:${index},modifiers:${event}.modifiers,point:${event}.point,tabId:${tabId}}),await this.dispatchMouseUp({button:${button},clickCount:${index},modifiers:${event}.modifiers,point:${event}.point,tabId:${tabId}})}`;
}

const chromeProfileRootRegex = new RegExp(
  String.raw`var (?<profileRoot>${IDENTIFIER})=(?<resolve>${IDENTIFIER})\((?<homeDir>${IDENTIFIER})\(\),(?<platform>${IDENTIFIER})\(\)==="win32"\?"AppData\\\\Local\\\\Google\\\\Chrome\\\\User Data":"Library/Application Support/Google/Chrome"\);`,
);

function replaceChromeProfileRoot(...args) {
  const { profileRoot, resolve, homeDir, platform } = replacementGroups(args);
  return `var ${profileRoot}=${resolve}(${homeDir}(),${platform}()==="win32"?"AppData\\\\Local\\\\Google\\\\Chrome\\\\User Data":${platform}()==="linux"?".config/google-chrome":"Library/Application Support/Google/Chrome");`;
}

const chromeBackendAllowlistRegex = new RegExp(
  String.raw`function (?<fn>${IDENTIFIER})\(\)\{let (?<value>${IDENTIFIER})=(?<readEnv>${IDENTIFIER})\((?<availableBackends>${IDENTIFIER})\);return \k<value>==null\?null:(?<split>${IDENTIFIER})\(\k<value>\)\.filter\((?<isKnownBackend>${IDENTIFIER})\)\}`,
);

function replaceChromeBackendAllowlist(...args) {
  const { fn, value, readEnv, availableBackends, split, isKnownBackend } = replacementGroups(args);
  return `function ${fn}(){let ${value}=${readEnv}(${availableBackends});/* codexLinuxChromeBackendAllowlist */if(${value}!=null&&!${split}(${value}).includes("chrome"))${value}=${value}.length>0?\`${"${"}${value}},chrome\`:"chrome";return ${value}==null?null:${split}(${value}).filter(${isKnownBackend})}`;
}

export const COMMON_BROWSER_CLIENT_PATCHES = [
  {
    label: "native pipe bridge",
    locatorStrategy: "regex-preserve-minified-names",
    risk: "medium",
    searchRegex: nativePipeBridgeRegex,
    replacement: replaceNativePipeBridge,
    appliedMarkers: ["globalThis.__codexNativePipe"],
  },
  {
    label: "browser automation global name",
    locatorStrategy: "global-token-rewrite",
    risk: "medium",
    apply: replaceBrowserAutomationGlobal,
    appliedMarkers: [
      "globalThis.browserAutomation?.env",
      "e.browserAutomation?.setResponseMeta",
      "e.browserAutomation?.emitImage",
    ],
  },
  {
    label: "Linux registry-only backend discovery",
    locatorStrategy: "regex-preserve-minified-names",
    risk: "high",
    searchRegex: backendInfoRequestRegex,
    replacement: replaceBackendInfoRequest,
    appliedMarkers: [
      "browser backend info request timed out",
      "browser backend registry type mismatch",
    ],
  },
  {
    label: "Linux registry reader",
    locatorStrategy: "regex-preserve-minified-names",
    risk: "high",
    searchRegex: linuxRegistryReaderRegex,
    replacement: replaceLinuxRegistryReader,
    appliedMarkers: [
      "CODEX_BROWSER_BACKENDS_REGISTRY",
      "Linux browser backend registry unavailable",
      "/proc/${l.ppid}/environ",
    ],
  },
  {
    label: "Linux non-blocking mouse move",
    locatorStrategy: "regex-preserve-minified-names",
    risk: "medium",
    searchRegex: nonBlockingMouseMoveRegex,
    replacement: replaceNonBlockingMouseMove,
    appliedMarkers: ["waitForArrival:!1"],
  },
  {
    label: "Linux direct CDP click dispatch",
    locatorStrategy: "method-body-regex-preserve-minified-names",
    risk: "high",
    searchRegex: directClickDispatchRegex,
    replacement: replaceDirectClickDispatch,
    appliedMarkers: ['type:"mouseMoved"', "this.ui.moveMouse"],
  },
  {
    label: "Linux Chrome profile root",
    locatorStrategy: "regex-preserve-minified-names",
    risk: "medium",
    searchRegex: chromeProfileRootRegex,
    replacement: replaceChromeProfileRoot,
    appliedMarkers: ['===\"linux\"?".config/google-chrome"'],
  },
];

export const CHROME_ONLY_BROWSER_CLIENT_PATCHES = [
  {
    label: "Linux Chrome backend allowlist",
    locatorStrategy: "regex-preserve-minified-names",
    risk: "medium",
    searchRegex: chromeBackendAllowlistRegex,
    replacement: replaceChromeBackendAllowlist,
    appliedMarkers: ["codexLinuxChromeBackendAllowlist"],
  },
];

export function patchBrowserClient(browserClientPath, { includeChromePatches = false } = {}) {
  patchFile(
    browserClientPath,
    includeChromePatches
      ? [...COMMON_BROWSER_CLIENT_PATCHES, ...CHROME_ONLY_BROWSER_CLIENT_PATCHES]
      : COMMON_BROWSER_CLIENT_PATCHES,
    "browser-client",
  );
}
