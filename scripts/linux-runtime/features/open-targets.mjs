import { FEATURE_MARKERS } from "../markers.mjs";
import { getLinuxOpenTargetAssets } from "../linux-desktop-assets.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const GHOSTTY_ANCHOR =
  "var m1=z$({id:`ghostty`,label:`Ghostty`,icon:`apps/ghostty.png`,appPaths:[`/Applications/Ghostty.app`],appName:`Ghostty`}),";
const WORKER_GHOSTTY_ANCHOR =
  "var lde=T9({id:`ghostty`,label:`Ghostty`,icon:`apps/ghostty.png`,appPaths:[`/Applications/Ghostty.app`],appName:`Ghostty`}),";
const OPEN_IN_TARGETS_HANDLER_ANCHOR =
  /async getTargets\(\{cwd:e,deferEnrichment:t=!1,hostId:r,nativeBrowserDiscovery:i=`scan`,path:a\}\)\{let\{hostConfig:o\}=this\.executionHostRegistry\.get\(r\?\?void 0\);[\s\S]*?\}\}loadTargetIcon/;
const OPEN_TARGET_SELECTION_ANCHOR =
  "if(r===`native`)return e.filter(e=>e.target===`systemDefault`||e.target===`fileManager`)";
const PATCHED_OPEN_TARGET_SELECTION =
  "if(r===`native`&&!n)return e.filter(e=>e.target===`systemDefault`||e.target===`fileManager`)";
const OPEN_TARGET_NATIVE_MENU_ANCHOR =
  /\(0,([A-Za-z_$][\w$]*)\.jsx\)\(([A-Za-z_$][\w$]*),\{awaitBeforeOpen:!1,getItems:([A-Za-z_$][\w$]*),onBeforeOpen:([A-Za-z_$][\w$]*),children:([A-Za-z_$][\w$]*)\}\)/;
const PATCHED_OPEN_TARGET_NATIVE_MENU =
  "(0,$1.jsx)($2,{awaitBeforeOpen:!0,getItems:$3,onBeforeOpen:$4,children:$5})";
const OPEN_TARGET_NATIVE_BROWSER_ITEM_ANCHOR =
  /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{return \2\.target===`systemDefault`&&\2\.appPath!=null&&\2\.kind===`native`\}/;
const PATCHED_OPEN_TARGET_NATIVE_BROWSER_ITEM =
  "function $1($2){return $2.target===`systemDefault`&&$2.kind===`native`}";
const OPEN_TARGET_DEFAULT_NATIVE_BROWSER_LABEL_ANCHOR =
  /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{return \2\.default===!0&&\2\.kind===`native`&&\2\.appPath!=null\}/;
const PATCHED_OPEN_TARGET_DEFAULT_NATIVE_BROWSER_LABEL =
  "function $1($2){return $2.default===!0&&$2.kind===`native`}";
const DOLPHIN_FILE_MANAGER_HELPER = "codex-dolphin-file-manager";

function commandExpr(command, fallbackCommand, commandLookup = "ls") {
  return command ? JSON.stringify(command) : `${commandLookup}(\`${fallbackCommand}\`)`;
}

function commandCandidatesExpr(...commands) {
  return `[${[...new Set(commands.filter(Boolean))].map((command) => JSON.stringify(command)).join(",")}]`;
}

function iconExpr(iconDataUrl, fallbackIcon) {
  return JSON.stringify(iconDataUrl ?? fallbackIcon);
}

function dolphinFileManagerCommandExpr({
  fileSystemNamespace = "h",
  pathNamespace = "d",
  commandLookup = "Os",
} = {}) {
  const helperPath = `(0,${pathNamespace}.join)(process.resourcesPath,\`${DOLPHIN_FILE_MANAGER_HELPER}\`)`;
  const dolphinAvailable = `(()=>{let e=process.env.CODEX_DOLPHIN_BIN?.trim();return e?e.includes(\`/\`)?(0,${fileSystemNamespace}.existsSync)(e):${commandLookup}(e):${commandLookup}(\`dolphin\`)})()`;
  return `(0,${fileSystemNamespace}.existsSync)(${helperPath})&&${dolphinAvailable}?${helperPath}:null`;
}

const JETBRAINS_ARGS_DECLARATION =
  "function codexLinuxJetBrainsArgs(e,t){if(t==null)return[e];let n=[`--line`,String(t.line)];return t.column!=null&&n.push(`--column`,String(t.column)),n.push(e),n}";

const WORD_EXTENSIONS = ["doc", "docm", "docx", "dot", "dotm", "dotx", "odt", "rtf", "wps", "wpt"];
const WPS_WORD_EXTENSIONS = ["wpso", "wpss", "uot3", "uott3"];
const SPREADSHEET_EXTENSIONS = [
  "csv",
  "et",
  "ett",
  "ets",
  "eto",
  "ods",
  "uos",
  "uos3",
  "uost3",
  "xls",
  "xlsb",
  "xlsm",
  "xlsx",
  "xlt",
  "xltm",
  "xltx",
];
const PRESENTATION_EXTENSIONS = [
  "dps",
  "dpt",
  "dpss",
  "dpso",
  "odp",
  "pot",
  "potm",
  "potx",
  "pps",
  "ppsm",
  "ppsx",
  "ppt",
  "pptm",
  "pptx",
  "uop",
  "uop3",
  "uopt3",
];
const PDF_EXTENSIONS = ["pdf"];
const REMOTE_APP_WORD_EXTENSIONS = ["doc", "docm", "docx", "dot", "dotm", "dotx", "odt", "rtf"];
const REMOTE_APP_SPREADSHEET_EXTENSIONS = [
  "csv",
  "ods",
  "xls",
  "xlsb",
  "xlsm",
  "xlsx",
  "xlt",
  "xltm",
  "xltx",
];
const REMOTE_APP_PRESENTATION_EXTENSIONS = [
  "odp",
  "pot",
  "potm",
  "potx",
  "pps",
  "ppsm",
  "ppsx",
  "ppt",
  "pptm",
  "pptx",
];

function buildLinuxTargetHelpers({ assets, fileSystemNamespace = "h" }) {
  const wpsWordExtensions = [...WORD_EXTENSIONS, ...WPS_WORD_EXTENSIONS];

  return `const codexLinuxDefaultAppIconByExtension=${JSON.stringify(assets.defaultAppIconByExtension)};function codexLinuxFileExtension(e){let t=String(e??\`\`).toLowerCase(),n=t.lastIndexOf(\`.\`),r=Math.max(t.lastIndexOf(\`/\`),t.lastIndexOf(\`\\\\\`));return n>r?t.slice(n+1):\`\`}function codexLinuxDefaultAppIconForPath(e){return codexLinuxDefaultAppIconByExtension[codexLinuxFileExtension(e)]??null}const codexLinuxWordExtensions=new Set(${JSON.stringify(wpsWordExtensions)}),codexLinuxSpreadsheetExtensions=new Set(${JSON.stringify(SPREADSHEET_EXTENSIONS)}),codexLinuxPresentationExtensions=new Set(${JSON.stringify(PRESENTATION_EXTENSIONS)}),codexLinuxPdfExtensions=new Set(${JSON.stringify(PDF_EXTENSIONS)}),codexLinuxRemoteWordExtensions=new Set(${JSON.stringify(REMOTE_APP_WORD_EXTENSIONS)}),codexLinuxRemoteSpreadsheetExtensions=new Set(${JSON.stringify(REMOTE_APP_SPREADSHEET_EXTENSIONS)}),codexLinuxRemotePresentationExtensions=new Set(${JSON.stringify(REMOTE_APP_PRESENTATION_EXTENSIONS)});function codexLinuxOfficeKind(e){let t=codexLinuxFileExtension(e);return codexLinuxWordExtensions.has(t)?\`word\`:codexLinuxSpreadsheetExtensions.has(t)?\`spreadsheet\`:codexLinuxPresentationExtensions.has(t)?\`presentation\`:codexLinuxPdfExtensions.has(t)?\`pdf\`:null}function codexLinuxRemoteAppName(e){let t=codexLinuxFileExtension(e);return codexLinuxRemoteWordExtensions.has(t)?\`word\`:codexLinuxRemoteSpreadsheetExtensions.has(t)?\`excel\`:codexLinuxRemotePresentationExtensions.has(t)?\`powerpoint\`:null}function codexLinuxResolveCommand(e,t){for(let n of e){if(!n)continue;n=String(n);if(n.includes(\`/\`)){if((0,${fileSystemNamespace}.existsSync)(n))return n;continue}let r=t(n);if(r)return r}return null}function codexLinuxPickCommand(e,t,n){return codexLinuxResolveCommand(e[t]??[],n)}function codexLinuxFirstAvailableCommand(e,t){for(let n of Object.keys(e)){let r=codexLinuxPickCommand(e,n,t);if(r)return r}return null}`;
}

function buildTargetDeclarations({
  commandLookup = "Os",
  fileSystemNamespace = "h",
  spawnCommand = "Ns",
} = {}) {
  const assets = getLinuxOpenTargetAssets();
  const wpsCommands = `const codexLinuxWpsCommands={word:${commandCandidatesExpr(assets.wps.commands.word, "wps")},spreadsheet:${commandCandidatesExpr(assets.wps.commands.spreadsheet, "et")},presentation:${commandCandidatesExpr(assets.wps.commands.presentation, "wpp")},pdf:${commandCandidatesExpr(assets.wps.commands.pdf, "wpspdf")}};`;
  const officeRemoteAppCommands = `const codexLinuxOfficeRemoteAppCommands=${commandCandidatesExpr(assets.officeRemoteApp.command, "office-remoteapp-bridge")};`;

  return `${JETBRAINS_ARGS_DECLARATION}${buildLinuxTargetHelpers({ assets, fileSystemNamespace })}${wpsCommands}${officeRemoteAppCommands}var codexLinuxGwenviewTarget={id:\`gwenview\`,platforms:{linux:{label:\`GwenView\`,icon:${iconExpr(assets.gwenview.iconDataUrl, "apps/file-explorer.png")},kind:\`editor\`,hidden:!0,detect:()=>${commandLookup}(\`gwenview\`),args:e=>[e]}}},codexLinuxTyporaTarget={id:\`typora\`,platforms:{linux:{label:\`Typora\`,icon:${iconExpr(assets.typora.iconDataUrl, "apps/textmate.png")},kind:\`editor\`,hidden:!0,detect:()=>${commandLookup}(\`typora\`)??${commandLookup}(\`typora-x11-fcitx\`),args:e=>[e]}}},codexLinuxWpsTarget={id:\`wps\`,platforms:{linux:{label:\`WPS\`,icon:${iconExpr(assets.wps.iconDataUrl, "apps/textmate.png")},kind:\`editor\`,hidden:!0,detect:()=>codexLinuxFirstAvailableCommand(codexLinuxWpsCommands,${commandLookup}),open:async({path:e})=>{let t=codexLinuxOfficeKind(e);if(t==null)throw Error(\`Unsupported WPS file extension: \${e}\`);let n=codexLinuxPickCommand(codexLinuxWpsCommands,t,${commandLookup});if(n==null)throw Error(\`WPS command unavailable for \${t}\`);await ${spawnCommand}(n,[e])}}}},codexLinuxOfficeRemoteAppTarget={id:\`officeRemoteApp\`,platforms:{linux:{label:\`office(RemoteApp)\`,icon:${iconExpr(assets.officeRemoteApp.iconDataUrl, "apps/file-explorer.png")},kind:\`editor\`,hidden:!0,detect:()=>codexLinuxResolveCommand(codexLinuxOfficeRemoteAppCommands,${commandLookup}),open:async({path:e})=>{let t=codexLinuxRemoteAppName(e);if(t==null)throw Error(\`Unsupported Office RemoteApp file extension: \${e}\`);let n=codexLinuxResolveCommand(codexLinuxOfficeRemoteAppCommands,${commandLookup});if(n==null)throw Error(\`Office RemoteApp bridge command unavailable\`);await ${spawnCommand}(n,[\`open\`,t,e])}}}},codexLinuxClionTarget={id:\`clion\`,platforms:{linux:{label:\`CLion\`,icon:${iconExpr(assets.clion.iconDataUrl, "apps/intellij.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.clion.command, "clion", commandLookup)},args:codexLinuxJetBrainsArgs,supportsSsh:!0}}};`;
}

function patchedGhosttyAnchor() {
  return `${buildTargetDeclarations()}${GHOSTTY_ANCHOR}`;
}

function patchedWorkerGhosttyAnchor() {
  return `${buildTargetDeclarations({
    commandLookup: "G7",
    fileSystemNamespace: "w",
    spawnCommand: "q7",
  })}${WORKER_GHOSTTY_ANCHOR}`;
}

function patchedOpenInTargetsHandler() {
  return "async getTargets({cwd:e,deferEnrichment:t=!1,hostId:r,nativeBrowserDiscovery:i=`scan`,path:a}){let{hostConfig:o}=this.executionHostRegistry.get(r??void 0),{allAvailableTargets:s,targetMetadata:c}=await L0(this.settingsStore,this.#n()),l=a?.replace(/^([ab])[\\\\/]/,``)??null,u=l!=null&&e2(l)&&!n.ho(o),d=l==null||u||n.ho(o)?null:Ij(le(l,o)??l,le(e,o)??ut(this.globalState)),f=n$(o,s,c),p=new Set(f),m=H0(this.settingsStore,e,p),h=u||d!=null&&n.Fs(d),g=d!=null&&VQ(d),_=[],v=!u&&(d??l)!=null?codexLinuxDefaultAppIconForPath(d??l):null;return h?_=await Q0(i):d!=null&&zQ(d)&&(_=await Z0(d)),{preferredTarget:m,availableTargets:Array.from(p),mode:h||g?`native`:`editor`,targets:[...c.map(({id:e,label:t,icon:n,kind:r,hidden:i})=>{let a={id:e,target:e,label:t,icon:n,kind:r,hidden:i,available:p.has(e),default:m===e||void 0};return e===`systemDefault`&&v!=null?{...a,icon:v}:a}),..._]}}loadTargetIcon";
}

function buildVisibleTargetDefinitionMarkers() {
  const assets = getLinuxOpenTargetAssets();

  return [
    `linux:{label:\`Dolphin\`,icon:${iconExpr(assets.dolphin.iconDataUrl, "apps/file-explorer.png")},detect:()=>${dolphinFileManagerCommandExpr()}`,
    `linux:{label:\`VS Code\`,icon:${iconExpr(assets.vscode.iconDataUrl, "apps/vscode.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.vscode.command, "code", "Os")}`,
    `linux:{label:\`PyCharm\`,icon:${iconExpr(assets.pycharm.iconDataUrl, "apps/pycharm.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.pycharm.command, "pycharm", "Os")}`,
    `linux:{label:\`WebStorm\`,icon:${iconExpr(assets.webstorm.iconDataUrl, "apps/webstorm.svg")},kind:\`editor\`,detect:()=>${commandExpr(assets.webstorm.command, "webstorm", "Os")}`,
    `linux:{label:\`CLion\`,icon:${iconExpr(assets.clion.iconDataUrl, "apps/intellij.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.clion.command, "clion", "Os")}`,
  ];
}

function buildWorkerVisibleTargetDefinitionMarkers() {
  const assets = getLinuxOpenTargetAssets();

  return [
    `linux:{label:\`Dolphin\`,icon:${iconExpr(assets.dolphin.iconDataUrl, "apps/file-explorer.png")},detect:()=>${dolphinFileManagerCommandExpr({ fileSystemNamespace: "w", pathNamespace: "E", commandLookup: "G7" })}`,
    `linux:{label:\`VS Code\`,icon:${iconExpr(assets.vscode.iconDataUrl, "apps/vscode.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.vscode.command, "code", "G7")}`,
    `linux:{label:\`PyCharm\`,icon:${iconExpr(assets.pycharm.iconDataUrl, "apps/pycharm.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.pycharm.command, "pycharm", "G7")}`,
    `linux:{label:\`WebStorm\`,icon:${iconExpr(assets.webstorm.iconDataUrl, "apps/webstorm.svg")},kind:\`editor\`,detect:()=>${commandExpr(assets.webstorm.command, "webstorm", "G7")}`,
    `linux:{label:\`CLion\`,icon:${iconExpr(assets.clion.iconDataUrl, "apps/intellij.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.clion.command, "clion", "G7")}`,
  ];
}

function buildWorkerRequiredMarkers() {
  return [
    "linux:{label:`Dolphin`",
    "codex-dolphin-file-manager",
    "process.env.CODEX_DOLPHIN_BIN?.trim()",
    "e?e.includes(`/`)?(0,w.existsSync)(e):G7(e):G7(`dolphin`)",
    "open:async({command:e,path:t})=>{await q7(e,[t])}",
    "codexLinuxGwenviewTarget",
    "codexLinuxTyporaTarget",
    "codexLinuxWpsTarget",
    "codexLinuxOfficeRemoteAppTarget",
    "function codexLinuxDefaultAppIconForPath",
    "function codexLinuxOfficeKind",
    "function codexLinuxRemoteAppName",
    "codexLinuxClionTarget",
    "function codexLinuxJetBrainsArgs",
    "args:codexLinuxJetBrainsArgs",
    "linux:{label:`VS Code`",
    "linux:{label:`PyCharm`",
    "linux:{label:`WebStorm`",
    "linux:{label:`CLion`",
  ];
}

function buildMainOpenTargetFlowMarkers() {
  return [
    "var E0=[a0,s0",
    "targetMetadata:c}=await L0(this.settingsStore,this.#n())",
    "availableTargets:Array.from(p)",
    "v=!u&&(d??l)!=null?codexLinuxDefaultAppIconForPath(d??l):null",
    "e===`systemDefault`&&v!=null",
    "{...a,icon:v}:a",
  ];
}

function buildWorkerOpenTargetFlowMarkers() {
  return ["var ufe=new Map([qde,Yde"];
}

function buildWebviewOpenTargetSelectionMarkers() {
  return [
    "if(r===`native`&&!n)return e.filter(e=>e.target===`systemDefault`||e.target===`fileManager`)",
    "includeHiddenTargets",
    "availableTargets",
  ];
}

function buildWebviewOpenTargetNativeMenuMarkers() {
  return [
    /\(0,[A-Za-z_$][\w$]*\.jsx\)\([A-Za-z_$][\w$]*,\{awaitBeforeOpen:!0,getItems:[A-Za-z_$][\w$]*,onBeforeOpen:[A-Za-z_$][\w$]*,children:[A-Za-z_$][\w$]*\}\)/,
  ];
}

function buildWebviewOpenTargetResourceActionMarkers() {
  return [
    /function [A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*)\)\{return \1\.target===`systemDefault`&&\1\.kind===`native`\}/,
    /function [A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*)\)\{return \1\.default===!0&&\1\.kind===`native`\}/,
  ];
}

export const openTargetsFeature = {
  id: "open-targets",
  version: 20,
  requiredMarkers: FEATURE_MARKERS["open-targets"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["open-targets"].forbiddenMarkers,
  apply(bundleSources, context) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    const assets = getLinuxOpenTargetAssets();
    let mainSource = bundleSources.main;
    let workerSource = bundleSources.worker;
    let webviewOpenTargetSelectionSource = bundleSources.webviewOpenTargetSelection;
    let webviewOpenTargetNativeMenuSource = bundleSources.webviewOpenTargetNativeMenu;
    let webviewOpenTargetResourceActionsSource = bundleSources.webviewOpenTargetResourceActions;
    const webviewOpenTargetSourceKeys = [
      "webviewOpenTargetSelection",
      "webviewOpenTargetNativeMenu",
      "webviewOpenTargetResourceActions",
    ];
    const webviewOpenTargetSources = {
      webviewOpenTargetSelection: webviewOpenTargetSelectionSource,
      webviewOpenTargetNativeMenu: webviewOpenTargetNativeMenuSource,
      webviewOpenTargetResourceActions: webviewOpenTargetResourceActionsSource,
    };
    const bundleSourcePaths = context?.bundleSourcePaths ?? {};

    function sharedWebviewOpenTargetSourceKeys(sourceKey) {
      const sourcePath = bundleSourcePaths[sourceKey];
      if (sourcePath == null) {
        return [sourceKey];
      }
      return webviewOpenTargetSourceKeys.filter((key) => bundleSourcePaths[key] === sourcePath);
    }

    function getWebviewOpenTargetSource(sourceKey) {
      return webviewOpenTargetSources[sourceKey];
    }

    function setWebviewOpenTargetSource(sourceKey, source) {
      for (const key of sharedWebviewOpenTargetSourceKeys(sourceKey)) {
        webviewOpenTargetSources[key] = source;
      }
    }

    mainSource = replaceOrThrow(
      mainSource,
      "u1=j$({id:`fileManager`,label:`Finder`,icon:`apps/finder.png`,kind:`fileManager`,darwin:{detect:()=>`open`,args:e=>As(e)},win32:{label:`File Explorer`,icon:`apps/file-explorer.png`,detect:d1,args:e=>As(e),open:async({path:e})=>f1(e)}});function d1(){let e=process.env.SystemRoot??process.env.windir;if(e){let t=(0,d.join)(e,`explorer.exe`);if((0,h.existsSync)(t))return t}return`explorer.exe`}async function f1(e){let{shell:t}=await import(`electron`),n=p1(e);if(n&&(0,h.statSync)(n).isFile()){t.showItemInFolder(n);return}let r=n??e,i=await t.openPath(r);if(i)throw Error(i)}function p1(e){let t=e;for(;;){if((0,h.existsSync)(t))return t;let e=(0,d.dirname)(t);if(e===t)return null;t=e}}",
      `u1=j$({id:\`fileManager\`,label:\`Finder\`,icon:\`apps/finder.png\`,kind:\`fileManager\`,darwin:{detect:()=>\`open\`,args:e=>As(e)},win32:{label:\`File Explorer\`,icon:\`apps/file-explorer.png\`,detect:d1,args:e=>As(e),open:async({path:e})=>f1(e)},linux:{label:\`Dolphin\`,icon:${iconExpr(assets.dolphin.iconDataUrl, "apps/file-explorer.png")},detect:()=>${dolphinFileManagerCommandExpr()},open:async({command:e,path:t})=>{await Ns(e,[t])}}});function d1(){let e=process.env.SystemRoot??process.env.windir;if(e){let t=(0,d.join)(e,\`explorer.exe\`);if((0,h.existsSync)(t))return t}return\`explorer.exe\`}async function f1(e){let{shell:t}=await import(\`electron\`),n=p1(e);if(n&&(0,h.statSync)(n).isFile()){t.showItemInFolder(n);return}let r=n??e,i=await t.openPath(r);if(i)throw Error(i)}function p1(e){let t=e;for(;;){if((0,h.existsSync)(t))return t;let e=(0,d.dirname)(t);if(e===t)return null;t=e}}`,
      "current upstream Linux file manager target",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "var a0=M$({id:`vscode`,label:`VS Code`,icon:`apps/vscode.png`,darwinDetect:()=>C$([`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`,`/Applications/Code.app/Contents/Resources/app/bin/code`]),win32Detect:o0});function o0()",
      `var a0={id:\`vscode\`,platforms:{...M$({id:\`vscode\`,label:\`VS Code\`,icon:\`apps/vscode.png\`,darwinDetect:()=>C$([\`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code\`,\`/Applications/Code.app/Contents/Resources/app/bin/code\`]),win32Detect:o0}).platforms,linux:{label:\`VS Code\`,icon:${iconExpr(assets.vscode.iconDataUrl, "apps/vscode.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.vscode.command, "code", "Os")},args:E$,supportsSsh:!0}}};function o0()`,
      "current upstream VS Code Linux target",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "j1=F1({id:`pycharm`,label:`PyCharm`,icon:`apps/pycharm.png`,toolboxTarget:`pycharm`,macExecutable:`pycharm`,windowsPathCommands:[`pycharm64.exe`,`pycharm.exe`,`pycharm`],windowsInstallDirPrefixes:[`pycharm`],windowsInstallExecutables:[`pycharm64.exe`,`pycharm.exe`]}),M1=F1({id:`webstorm`,label:`WebStorm`,icon:`apps/webstorm.svg`,toolboxTarget:`webstorm`,macExecutable:`webstorm`,windowsPathCommands:[`webstorm64.exe`,`webstorm.exe`,`webstorm`],windowsInstallDirPrefixes:[`webstorm`],windowsInstallExecutables:[`webstorm64.exe`,`webstorm.exe`]}),N1=F1({id:`phpstorm`,label:`PhpStorm`,icon:`apps/phpstorm.png`,toolboxTarget:`phpstorm`,macExecutable:`phpstorm`,windowsPathCommands:[`phpstorm64.exe`,`phpstorm.exe`,`phpstorm`],windowsInstallDirPrefixes:[`phpstorm`],windowsInstallExecutables:[`phpstorm64.exe`,`phpstorm.exe`]});function P1",
      `j1={id:\`pycharm\`,platforms:{...F1({id:\`pycharm\`,label:\`PyCharm\`,icon:\`apps/pycharm.png\`,toolboxTarget:\`pycharm\`,macExecutable:\`pycharm\`,windowsPathCommands:[\`pycharm64.exe\`,\`pycharm.exe\`,\`pycharm\`],windowsInstallDirPrefixes:[\`pycharm\`],windowsInstallExecutables:[\`pycharm64.exe\`,\`pycharm.exe\`]}).platforms,linux:{label:\`PyCharm\`,icon:${iconExpr(assets.pycharm.iconDataUrl, "apps/pycharm.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.pycharm.command, "pycharm", "Os")},args:codexLinuxJetBrainsArgs,supportsSsh:!0}}},M1={id:\`webstorm\`,platforms:{...F1({id:\`webstorm\`,label:\`WebStorm\`,icon:\`apps/webstorm.svg\`,toolboxTarget:\`webstorm\`,macExecutable:\`webstorm\`,windowsPathCommands:[\`webstorm64.exe\`,\`webstorm.exe\`,\`webstorm\`],windowsInstallDirPrefixes:[\`webstorm\`],windowsInstallExecutables:[\`webstorm64.exe\`,\`webstorm.exe\`]}).platforms,linux:{label:\`WebStorm\`,icon:${iconExpr(assets.webstorm.iconDataUrl, "apps/webstorm.svg")},kind:\`editor\`,detect:()=>${commandExpr(assets.webstorm.command, "webstorm", "Os")},args:codexLinuxJetBrainsArgs,supportsSsh:!0}}},N1=F1({id:\`phpstorm\`,label:\`PhpStorm\`,icon:\`apps/phpstorm.png\`,toolboxTarget:\`phpstorm\`,macExecutable:\`phpstorm\`,windowsPathCommands:[\`phpstorm64.exe\`,\`phpstorm.exe\`,\`phpstorm\`],windowsInstallDirPrefixes:[\`phpstorm\`],windowsInstallExecutables:[\`phpstorm64.exe\`,\`phpstorm.exe\`]});function P1`,
      "current upstream JetBrains Linux targets",
    );

    mainSource = replaceOrThrow(
      mainSource,
      GHOSTTY_ANCHOR,
      patchedGhosttyAnchor(),
      "current upstream Linux hidden target declarations",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "var E0=[a0,s0,r0,a1,I$,l1,q1,x0,u0,P$,v1,X1,u1,R$,h1,r1,f0,b1,U1,m1,l0,g0,E1,D1,O1,k1,A1,j1,M1,N1,$1];",
      "var E0=[a0,s0,r0,a1,I$,l1,q1,x0,u0,P$,v1,X1,u1,codexLinuxGwenviewTarget,R$,h1,r1,f0,b1,U1,m1,l0,g0,E1,D1,O1,k1,A1,codexLinuxClionTarget,j1,M1,N1,codexLinuxTyporaTarget,codexLinuxWpsTarget,codexLinuxOfficeRemoteAppTarget,$1];",
      "current upstream Linux target registration",
    );

    mainSource = replaceOrThrow(
      mainSource,
      OPEN_IN_TARGETS_HANDLER_ANCHOR,
      patchedOpenInTargetsHandler(),
      "current upstream Linux open-target response handler",
    );

    workerSource = replaceOrThrow(
      workerSource,
      "ade=x9({id:`fileManager`,label:`Finder`,icon:`apps/finder.png`,kind:`fileManager`,darwin:{detect:()=>`open`,args:e=>K7(e)},win32:{label:`File Explorer`,icon:`apps/file-explorer.png`,detect:ode,args:e=>K7(e),open:async({path:e})=>sde(e)}});function ode(){let e=process.env.SystemRoot??process.env.windir;if(e){let t=(0,E.join)(e,`explorer.exe`);if((0,w.existsSync)(t))return t}return`explorer.exe`}async function sde(e){let{shell:t}=await import(`electron`),n=cde(e);if(n&&(0,w.statSync)(n).isFile()){t.showItemInFolder(n);return}let r=n??e,i=await t.openPath(r);if(i)throw Error(i)}function cde(e){let t=e;for(;;){if((0,w.existsSync)(t))return t;let e=(0,E.dirname)(t);if(e===t)return null;t=e}}",
      `ade=x9({id:\`fileManager\`,label:\`Finder\`,icon:\`apps/finder.png\`,kind:\`fileManager\`,darwin:{detect:()=>\`open\`,args:e=>K7(e)},win32:{label:\`File Explorer\`,icon:\`apps/file-explorer.png\`,detect:ode,args:e=>K7(e),open:async({path:e})=>sde(e)},linux:{label:\`Dolphin\`,icon:${iconExpr(assets.dolphin.iconDataUrl, "apps/file-explorer.png")},detect:()=>${dolphinFileManagerCommandExpr({ fileSystemNamespace: "w", pathNamespace: "E", commandLookup: "G7" })},open:async({command:e,path:t})=>{await q7(e,[t])}}});function ode(){let e=process.env.SystemRoot??process.env.windir;if(e){let t=(0,E.join)(e,\`explorer.exe\`);if((0,w.existsSync)(t))return t}return\`explorer.exe\`}async function sde(e){let{shell:t}=await import(\`electron\`),n=cde(e);if(n&&(0,w.statSync)(n).isFile()){t.showItemInFolder(n);return}let r=n??e,i=await t.openPath(r);if(i)throw Error(i)}function cde(e){let t=e;for(;;){if((0,w.existsSync)(t))return t;let e=(0,E.dirname)(t);if(e===t)return null;t=e}}`,
      "current upstream worker Linux file manager target",
    );

    workerSource = replaceOrThrow(
      workerSource,
      "var qde=S9({id:`vscode`,label:`VS Code`,icon:`apps/vscode.png`,darwinDetect:()=>$7([`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`,`/Applications/Code.app/Contents/Resources/app/bin/code`]),win32Detect:Jde});function Jde()",
      `var qde={id:\`vscode\`,platforms:{...S9({id:\`vscode\`,label:\`VS Code\`,icon:\`apps/vscode.png\`,darwinDetect:()=>$7([\`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code\`,\`/Applications/Code.app/Contents/Resources/app/bin/code\`]),win32Detect:Jde}).platforms,linux:{label:\`VS Code\`,icon:${iconExpr(assets.vscode.iconDataUrl, "apps/vscode.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.vscode.command, "code", "G7")},args:C9,supportsSsh:!0}}};function Jde()`,
      "current upstream worker VS Code Linux target",
    );

    workerSource = replaceOrThrow(
      workerSource,
      "Tde=N9({id:`pycharm`,label:`PyCharm`,icon:`apps/pycharm.png`,toolboxTarget:`pycharm`,macExecutable:`pycharm`,windowsPathCommands:[`pycharm64.exe`,`pycharm.exe`,`pycharm`],windowsInstallDirPrefixes:[`pycharm`],windowsInstallExecutables:[`pycharm64.exe`,`pycharm.exe`]}),Ede=N9({id:`webstorm`,label:`WebStorm`,icon:`apps/webstorm.svg`,toolboxTarget:`webstorm`,macExecutable:`webstorm`,windowsPathCommands:[`webstorm64.exe`,`webstorm.exe`,`webstorm`],windowsInstallDirPrefixes:[`webstorm`],windowsInstallExecutables:[`webstorm64.exe`,`webstorm.exe`]}),Dde=N9({id:`phpstorm`,label:`PhpStorm`,icon:`apps/phpstorm.png`,toolboxTarget:`phpstorm`,macExecutable:`phpstorm`,windowsPathCommands:[`phpstorm64.exe`,`phpstorm.exe`,`phpstorm`],windowsInstallDirPrefixes:[`phpstorm`],windowsInstallExecutables:[`phpstorm64.exe`,`phpstorm.exe`]});function Ode",
      `Tde={id:\`pycharm\`,platforms:{...N9({id:\`pycharm\`,label:\`PyCharm\`,icon:\`apps/pycharm.png\`,toolboxTarget:\`pycharm\`,macExecutable:\`pycharm\`,windowsPathCommands:[\`pycharm64.exe\`,\`pycharm.exe\`,\`pycharm\`],windowsInstallDirPrefixes:[\`pycharm\`],windowsInstallExecutables:[\`pycharm64.exe\`,\`pycharm.exe\`]}).platforms,linux:{label:\`PyCharm\`,icon:${iconExpr(assets.pycharm.iconDataUrl, "apps/pycharm.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.pycharm.command, "pycharm", "G7")},args:codexLinuxJetBrainsArgs,supportsSsh:!0}}},Ede={id:\`webstorm\`,platforms:{...N9({id:\`webstorm\`,label:\`WebStorm\`,icon:\`apps/webstorm.svg\`,toolboxTarget:\`webstorm\`,macExecutable:\`webstorm\`,windowsPathCommands:[\`webstorm64.exe\`,\`webstorm.exe\`,\`webstorm\`],windowsInstallDirPrefixes:[\`webstorm\`],windowsInstallExecutables:[\`webstorm64.exe\`,\`webstorm.exe\`]}).platforms,linux:{label:\`WebStorm\`,icon:${iconExpr(assets.webstorm.iconDataUrl, "apps/webstorm.svg")},kind:\`editor\`,detect:()=>${commandExpr(assets.webstorm.command, "webstorm", "G7")},args:codexLinuxJetBrainsArgs,supportsSsh:!0}}},Dde=N9({id:\`phpstorm\`,label:\`PhpStorm\`,icon:\`apps/phpstorm.png\`,toolboxTarget:\`phpstorm\`,macExecutable:\`phpstorm\`,windowsPathCommands:[\`phpstorm64.exe\`,\`phpstorm.exe\`,\`phpstorm\`],windowsInstallDirPrefixes:[\`phpstorm\`],windowsInstallExecutables:[\`phpstorm64.exe\`,\`phpstorm.exe\`]});function Ode`,
      "current upstream worker JetBrains Linux targets",
    );

    workerSource = replaceOrThrow(
      workerSource,
      WORKER_GHOSTTY_ANCHOR,
      patchedWorkerGhosttyAnchor(),
      "current upstream worker Linux hidden target declarations",
    );

    workerSource = replaceOrThrow(
      workerSource,
      "var ufe=new Map([qde,Yde,Gde,tde,zue,ide,Ide,afe,Qde,Lue,pde,zde,ade,Bue,ude,$ue,$de,hde,Pde,lde,Zde,nfe,bde,xde,Sde,Cde,wde,Tde,Ede,Dde,Vde].flatMap(e=>{let t=e.platforms[process.platform];return t==null?[]:[[e.id,{id:e.id,...t}]]}));",
      "var ufe=new Map([qde,Yde,Gde,tde,zue,ide,Ide,afe,Qde,Lue,pde,zde,ade,codexLinuxGwenviewTarget,Bue,ude,$ue,$de,hde,Pde,lde,Zde,nfe,bde,xde,Sde,Cde,wde,codexLinuxClionTarget,Tde,Ede,Dde,codexLinuxTyporaTarget,codexLinuxWpsTarget,codexLinuxOfficeRemoteAppTarget,Vde].flatMap(e=>{let t=e.platforms[process.platform];return t==null?[]:[[e.id,{id:e.id,...t}]]}));",
      "current upstream worker Linux target registration",
    );

    setWebviewOpenTargetSource(
      "webviewOpenTargetSelection",
      replaceOrThrow(
        getWebviewOpenTargetSource("webviewOpenTargetSelection"),
        OPEN_TARGET_SELECTION_ANCHOR,
        PATCHED_OPEN_TARGET_SELECTION,
        "current upstream webview open target selection",
        {
          appliedMarkers: buildWebviewOpenTargetSelectionMarkers(),
        },
      ),
    );

    setWebviewOpenTargetSource(
      "webviewOpenTargetResourceActions",
      replaceOrThrow(
        getWebviewOpenTargetSource("webviewOpenTargetResourceActions"),
        OPEN_TARGET_NATIVE_BROWSER_ITEM_ANCHOR,
        PATCHED_OPEN_TARGET_NATIVE_BROWSER_ITEM,
        "current upstream webview native browser resource menu target filter",
        {
          appliedMarkers: [PATCHED_OPEN_TARGET_NATIVE_BROWSER_ITEM],
        },
      ),
    );

    setWebviewOpenTargetSource(
      "webviewOpenTargetResourceActions",
      replaceOrThrow(
        getWebviewOpenTargetSource("webviewOpenTargetResourceActions"),
        OPEN_TARGET_DEFAULT_NATIVE_BROWSER_LABEL_ANCHOR,
        PATCHED_OPEN_TARGET_DEFAULT_NATIVE_BROWSER_LABEL,
        "current upstream webview default native browser label filter",
        {
          appliedMarkers: [PATCHED_OPEN_TARGET_DEFAULT_NATIVE_BROWSER_LABEL],
        },
      ),
    );

    // Native file-tree menus must wait for the target-path query before item
    // generation; otherwise the first menu render can use pathless fallback
    // targets and keep the generic Default app icon.
    setWebviewOpenTargetSource(
      "webviewOpenTargetNativeMenu",
      replaceOrThrow(
        getWebviewOpenTargetSource("webviewOpenTargetNativeMenu"),
        OPEN_TARGET_NATIVE_MENU_ANCHOR,
        PATCHED_OPEN_TARGET_NATIVE_MENU,
        "current upstream webview native open-target menu",
        {
          appliedMarkers: buildWebviewOpenTargetNativeMenuMarkers(),
        },
      ),
    );

    webviewOpenTargetSelectionSource = webviewOpenTargetSources.webviewOpenTargetSelection;
    webviewOpenTargetNativeMenuSource = webviewOpenTargetSources.webviewOpenTargetNativeMenu;
    webviewOpenTargetResourceActionsSource = webviewOpenTargetSources.webviewOpenTargetResourceActions;

    let sources = {
      ...bundleSources,
      main: mainSource,
      worker: workerSource,
      webviewOpenTargetSelection: webviewOpenTargetSelectionSource,
      webviewOpenTargetNativeMenu: webviewOpenTargetNativeMenuSource,
      webviewOpenTargetResourceActions: webviewOpenTargetResourceActionsSource,
    };
    if (typeof context?.syncSharedBundleSource === "function") {
      sources = context.syncSharedBundleSource(
        sources,
        "webviewOpenTargetSelection",
        sources.webviewOpenTargetSelection,
      );
      sources = context.syncSharedBundleSource(
        sources,
        "webviewOpenTargetNativeMenu",
        sources.webviewOpenTargetNativeMenu,
      );
      sources = context.syncSharedBundleSource(
        sources,
        "webviewOpenTargetResourceActions",
        sources.webviewOpenTargetResourceActions,
      );
    }
    return sources;
  },
  verify(bundleSources) {
    ensureMarkersPresent(bundleSources.main, this.requiredMarkers, "Linux open-target patch");
    ensureMarkersPresent(
      bundleSources.main,
      buildVisibleTargetDefinitionMarkers(),
      "Linux visible open-target definitions",
    );
    ensureMarkersPresent(
      bundleSources.main,
      buildMainOpenTargetFlowMarkers(),
      "Linux main open-target response and ordering patch",
    );
    ensureMarkersPresent(
      bundleSources.worker,
      buildWorkerRequiredMarkers(),
      "Linux worker open-target patch",
    );
    ensureMarkersPresent(
      bundleSources.worker,
      buildWorkerVisibleTargetDefinitionMarkers(),
      "Linux worker visible open-target definitions",
    );
    ensureMarkersPresent(
      bundleSources.worker,
      buildWorkerOpenTargetFlowMarkers(),
      "Linux worker open-target ordering patch",
    );
    ensureMarkersPresent(
      bundleSources.webviewOpenTargetSelection,
      buildWebviewOpenTargetSelectionMarkers(),
      "Linux webview open-target selection patch",
    );
    ensureMarkersPresent(
      bundleSources.webviewOpenTargetNativeMenu,
      buildWebviewOpenTargetNativeMenuMarkers(),
      "Linux webview open-target native menu patch",
    );
    ensureMarkersPresent(
      bundleSources.webviewOpenTargetResourceActions,
      buildWebviewOpenTargetResourceActionMarkers(),
      "Linux webview open-target resource action patch",
    );
    ensureMarkersAbsent(bundleSources.main, this.forbiddenMarkers, "Linux open-target patch");
    ensureMarkersAbsent(bundleSources.worker, this.forbiddenMarkers, "Linux worker open-target patch");
    ensureMarkersAbsent(
      bundleSources.webviewOpenTargetSelection,
      [OPEN_TARGET_SELECTION_ANCHOR],
      "Linux webview open-target selection patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewOpenTargetNativeMenu,
      [OPEN_TARGET_NATIVE_MENU_ANCHOR],
      "Linux webview open-target native menu patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewOpenTargetResourceActions,
      [
        OPEN_TARGET_NATIVE_BROWSER_ITEM_ANCHOR,
        OPEN_TARGET_DEFAULT_NATIVE_BROWSER_LABEL_ANCHOR,
      ],
      "Linux webview open-target resource action patch",
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
  getPatchedGhosttyAnchor() {
    return patchedGhosttyAnchor();
  },
  getPatchedWorkerGhosttyAnchor() {
    return patchedWorkerGhosttyAnchor();
  },
};
