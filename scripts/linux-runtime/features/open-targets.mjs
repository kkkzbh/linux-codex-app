import { FEATURE_MARKERS } from "../markers.mjs";
import { getLinuxVisibleTargetAssets } from "../linux-desktop-assets.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const GHOSTTY_ANCHOR =
  "var gA=Vk({id:`ghostty`,label:`Ghostty`,icon:`apps/ghostty.png`,appPaths:[`/Applications/Ghostty.app`],appName:`Ghostty`}),";

function commandExpr(command, fallbackCommand) {
  return command ? JSON.stringify(command) : `vo(\`${fallbackCommand}\`)`;
}

function iconExpr(iconDataUrl, fallbackIcon) {
  return JSON.stringify(iconDataUrl ?? fallbackIcon);
}

const JETBRAINS_ARGS_DECLARATION =
  "function codexLinuxJetBrainsArgs(e,t){if(t==null)return[e];let n=[`--line`,String(t.line)];return t.column!=null&&n.push(`--column`,String(t.column)),n.push(e),n}";

function buildTargetDeclarations() {
  const assets = getLinuxVisibleTargetAssets();

  return `${JETBRAINS_ARGS_DECLARATION}var codexLinuxGwenviewTarget={id:\`gwenview\`,platforms:{linux:{label:\`GwenView\`,icon:\`apps/file-explorer.png\`,kind:\`editor\`,hidden:!0,detect:()=>vo(\`gwenview\`),args:e=>[e]}}},codexLinuxTyporaTarget={id:\`typora\`,platforms:{linux:{label:\`Typora\`,icon:\`apps/textmate.png\`,kind:\`editor\`,hidden:!0,detect:()=>vo(\`typora\`)??vo(\`typora-x11-fcitx\`),args:e=>[e]}}},codexLinuxWpsWriterTarget={id:\`wpsWriter\`,platforms:{linux:{label:\`WPS Writer\`,icon:\`apps/textmate.png\`,kind:\`editor\`,hidden:!0,detect:()=>vo(\`wps\`),args:e=>[e]}}},codexLinuxWpsSpreadsheetsTarget={id:\`wpsSpreadsheets\`,platforms:{linux:{label:\`WPS Spreadsheets\`,icon:\`apps/textmate.png\`,kind:\`editor\`,hidden:!0,detect:()=>vo(\`et\`),args:e=>[e]}}},codexLinuxWpsPresentationTarget={id:\`wpsPresentation\`,platforms:{linux:{label:\`WPS Presentation\`,icon:\`apps/textmate.png\`,kind:\`editor\`,hidden:!0,detect:()=>vo(\`wpp\`),args:e=>[e]}}},codexLinuxWpsPdfTarget={id:\`wpsPdf\`,platforms:{linux:{label:\`WPS PDF\`,icon:\`apps/textmate.png\`,kind:\`editor\`,hidden:!0,detect:()=>vo(\`wpspdf\`),args:e=>[e]}}},codexLinuxClionTarget={id:\`clion\`,platforms:{linux:{label:\`CLion\`,icon:${iconExpr(assets.clion.iconDataUrl, "apps/intellij.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.clion.command, "clion")},args:codexLinuxJetBrainsArgs,supportsSsh:!0}}};`;
}

function patchedGhosttyAnchor() {
  return `${buildTargetDeclarations()}${GHOSTTY_ANCHOR}`;
}

function buildVisibleTargetDefinitionMarkers() {
  const assets = getLinuxVisibleTargetAssets();

  return [
    `linux:{label:\`Dolphin\`,icon:${iconExpr(assets.dolphin.iconDataUrl, "apps/file-explorer.png")},detect:()=>${commandExpr(assets.dolphin.command, "dolphin")}`,
    `linux:{label:\`VS Code\`,icon:${iconExpr(assets.vscode.iconDataUrl, "apps/vscode.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.vscode.command, "code")}`,
    `linux:{label:\`PyCharm\`,icon:${iconExpr(assets.pycharm.iconDataUrl, "apps/pycharm.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.pycharm.command, "pycharm")}`,
    `linux:{label:\`WebStorm\`,icon:${iconExpr(assets.webstorm.iconDataUrl, "apps/webstorm.svg")},kind:\`editor\`,detect:()=>${commandExpr(assets.webstorm.command, "webstorm")}`,
    `linux:{label:\`CLion\`,icon:${iconExpr(assets.clion.iconDataUrl, "apps/intellij.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.clion.command, "clion")}`,
  ];
}

export const openTargetsFeature = {
  id: "open-targets",
  version: 9,
  requiredMarkers: FEATURE_MARKERS["open-targets"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["open-targets"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    const assets = getLinuxVisibleTargetAssets();
    let mainSource = bundleSources.main;

    mainSource = replaceOrThrow(
      mainSource,
      "fA=Nk({id:`fileManager`,label:`Finder`,icon:`apps/finder.png`,kind:`fileManager`,darwin:{detect:()=>`open`,args:e=>bo(e)},win32:{label:`File Explorer`,icon:`apps/file-explorer.png`,detect:pA,args:e=>bo(e),open:async({path:e})=>mA(e)}});function pA(){let e=process.env.SystemRoot??process.env.windir;if(e){let t=(0,a.join)(e,`explorer.exe`);if((0,s.existsSync)(t))return t}return`explorer.exe`}async function mA(e){let t=hA(e);if(t&&(0,s.statSync)(t).isFile()){r.shell.showItemInFolder(t);return}let n=t??e,i=await r.shell.openPath(n);if(i)throw Error(i)}function hA(e){let t=e;for(;;){if((0,s.existsSync)(t))return t;let e=(0,a.dirname)(t);if(e===t)return null;t=e}}",
      `fA=Nk({id:\`fileManager\`,label:\`Finder\`,icon:\`apps/finder.png\`,kind:\`fileManager\`,darwin:{detect:()=>\`open\`,args:e=>bo(e)},win32:{label:\`File Explorer\`,icon:\`apps/file-explorer.png\`,detect:pA,args:e=>bo(e),open:async({path:e})=>mA(e)},linux:{label:\`Dolphin\`,icon:${iconExpr(assets.dolphin.iconDataUrl, "apps/file-explorer.png")},detect:()=>${commandExpr(assets.dolphin.command, "dolphin")},open:async({command:e,path:t})=>{let n=hA(t);if(n&&(0,s.statSync)(n).isFile()){await So(e,[\`--new-window\`,\`--select\`,n]);return}await So(e,[\`--new-window\`,n??t])}}});function pA(){let e=process.env.SystemRoot??process.env.windir;if(e){let t=(0,a.join)(e,\`explorer.exe\`);if((0,s.existsSync)(t))return t}return\`explorer.exe\`}async function mA(e){let t=hA(e);if(t&&(0,s.statSync)(t).isFile()){r.shell.showItemInFolder(t);return}let n=t??e,i=await r.shell.openPath(n);if(i)throw Error(i)}function hA(e){let t=e;for(;;){if((0,s.existsSync)(t))return t;let e=(0,a.dirname)(t);if(e===t)return null;t=e}}`,
      "current upstream Linux file manager target",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "var ij=Pk({id:`vscode`,label:`VS Code`,icon:`apps/vscode.png`,darwinDetect:()=>xk([`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`,`/Applications/Code.app/Contents/Resources/app/bin/code`]),win32Detect:aj});function aj()",
      `var ij={id:\`vscode\`,platforms:{...Pk({id:\`vscode\`,label:\`VS Code\`,icon:\`apps/vscode.png\`,darwinDetect:()=>xk([\`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code\`,\`/Applications/Code.app/Contents/Resources/app/bin/code\`]),win32Detect:aj}).platforms,linux:{label:\`VS Code\`,icon:${iconExpr(assets.vscode.iconDataUrl, "apps/vscode.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.vscode.command, "code")},args:Fk,supportsSsh:!0}}};function aj()`,
      "current upstream VS Code Linux target",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "NA=LA({id:`pycharm`,label:`PyCharm`,icon:`apps/pycharm.png`,toolboxTarget:`pycharm`,macExecutable:`pycharm`,windowsPathCommands:[`pycharm64.exe`,`pycharm.exe`,`pycharm`],windowsInstallDirPrefixes:[`pycharm`],windowsInstallExecutables:[`pycharm64.exe`,`pycharm.exe`]}),PA=LA({id:`webstorm`,label:`WebStorm`,icon:`apps/webstorm.svg`,toolboxTarget:`webstorm`,macExecutable:`webstorm`,windowsPathCommands:[`webstorm64.exe`,`webstorm.exe`,`webstorm`],windowsInstallDirPrefixes:[`webstorm`],windowsInstallExecutables:[`webstorm64.exe`,`webstorm.exe`]}),FA=LA({id:`phpstorm`,label:`PhpStorm`,icon:`apps/phpstorm.png`,toolboxTarget:`phpstorm`,macExecutable:`phpstorm`,windowsPathCommands:[`phpstorm64.exe`,`phpstorm.exe`,`phpstorm`],windowsInstallDirPrefixes:[`phpstorm`],windowsInstallExecutables:[`phpstorm64.exe`,`phpstorm.exe`]});function IA",
      `NA={id:\`pycharm\`,platforms:{...LA({id:\`pycharm\`,label:\`PyCharm\`,icon:\`apps/pycharm.png\`,toolboxTarget:\`pycharm\`,macExecutable:\`pycharm\`,windowsPathCommands:[\`pycharm64.exe\`,\`pycharm.exe\`,\`pycharm\`],windowsInstallDirPrefixes:[\`pycharm\`],windowsInstallExecutables:[\`pycharm64.exe\`,\`pycharm.exe\`]}).platforms,linux:{label:\`PyCharm\`,icon:${iconExpr(assets.pycharm.iconDataUrl, "apps/pycharm.png")},kind:\`editor\`,detect:()=>${commandExpr(assets.pycharm.command, "pycharm")},args:codexLinuxJetBrainsArgs,supportsSsh:!0}}},PA={id:\`webstorm\`,platforms:{...LA({id:\`webstorm\`,label:\`WebStorm\`,icon:\`apps/webstorm.svg\`,toolboxTarget:\`webstorm\`,macExecutable:\`webstorm\`,windowsPathCommands:[\`webstorm64.exe\`,\`webstorm.exe\`,\`webstorm\`],windowsInstallDirPrefixes:[\`webstorm\`],windowsInstallExecutables:[\`webstorm64.exe\`,\`webstorm.exe\`]}).platforms,linux:{label:\`WebStorm\`,icon:${iconExpr(assets.webstorm.iconDataUrl, "apps/webstorm.svg")},kind:\`editor\`,detect:()=>${commandExpr(assets.webstorm.command, "webstorm")},args:codexLinuxJetBrainsArgs,supportsSsh:!0}}},FA=LA({id:\`phpstorm\`,label:\`PhpStorm\`,icon:\`apps/phpstorm.png\`,toolboxTarget:\`phpstorm\`,macExecutable:\`phpstorm\`,windowsPathCommands:[\`phpstorm64.exe\`,\`phpstorm.exe\`,\`phpstorm\`],windowsInstallDirPrefixes:[\`phpstorm\`],windowsInstallExecutables:[\`phpstorm64.exe\`,\`phpstorm.exe\`]});function IA`,
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
      "var Cj=[ij,oj,nj,sA,Rk,dA,KA,bj,lj,Ik,bA,YA,fA,Bk,_A,aA,dj,SA,gA,cj,hj,OA,kA,AA,jA,MA,NA,PA,FA,QA],wj=t.Ur(`open-in-targets`);",
      "var Cj=[ij,oj,nj,sA,Rk,dA,KA,bj,lj,Ik,bA,YA,fA,codexLinuxGwenviewTarget,Bk,_A,aA,dj,SA,gA,cj,hj,OA,kA,AA,jA,MA,NA,codexLinuxClionTarget,PA,FA,QA,codexLinuxTyporaTarget,codexLinuxWpsWriterTarget,codexLinuxWpsSpreadsheetsTarget,codexLinuxWpsPresentationTarget,codexLinuxWpsPdfTarget],wj=t.Ur(`open-in-targets`);",
      "current upstream Linux target registration",
    );

    return {
      ...bundleSources,
      main: mainSource,
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(bundleSources.main, this.requiredMarkers, "Linux open-target patch");
    ensureMarkersPresent(
      bundleSources.main,
      buildVisibleTargetDefinitionMarkers(),
      "Linux visible open-target definitions",
    );
    ensureMarkersAbsent(bundleSources.main, this.forbiddenMarkers, "Linux open-target patch");
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
};
