import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const GHOSTTY_ANCHOR =
  "var tE=ET({id:`ghostty`,label:`Ghostty`,icon:`apps/ghostty.png`,appPaths:[`/Applications/Ghostty.app`],appName:`Ghostty`}),";

function commandExpr(command) {
  return `Ii(\`${command}\`)`;
}

function iconExpr(icon) {
  return JSON.stringify(icon);
}

const JETBRAINS_ARGS_DECLARATION =
  "function codexLinuxJetBrainsArgs(e,t){if(t==null)return[e];let n=[`--line`,String(t.line)];return t.column!=null&&n.push(`--column`,String(t.column)),n.push(e),n}";

function buildTargetDeclarations() {
  return `${JETBRAINS_ARGS_DECLARATION}var codexLinuxGwenviewTarget={id:\`gwenview\`,platforms:{linux:{label:\`GwenView\`,icon:\`apps/file-explorer.png\`,kind:\`editor\`,hidden:!0,detect:()=>Ii(\`gwenview\`),args:e=>[e]}}},codexLinuxTyporaTarget={id:\`typora\`,platforms:{linux:{label:\`Typora\`,icon:\`apps/textmate.png\`,kind:\`editor\`,hidden:!0,detect:()=>Ii(\`typora\`)??Ii(\`typora-x11-fcitx\`),args:e=>[e]}}},codexLinuxWpsWriterTarget={id:\`wpsWriter\`,platforms:{linux:{label:\`WPS Writer\`,icon:\`apps/textmate.png\`,kind:\`editor\`,hidden:!0,detect:()=>Ii(\`wps\`),args:e=>[e]}}},codexLinuxWpsSpreadsheetsTarget={id:\`wpsSpreadsheets\`,platforms:{linux:{label:\`WPS Spreadsheets\`,icon:\`apps/textmate.png\`,kind:\`editor\`,hidden:!0,detect:()=>Ii(\`et\`),args:e=>[e]}}},codexLinuxWpsPresentationTarget={id:\`wpsPresentation\`,platforms:{linux:{label:\`WPS Presentation\`,icon:\`apps/textmate.png\`,kind:\`editor\`,hidden:!0,detect:()=>Ii(\`wpp\`),args:e=>[e]}}},codexLinuxWpsPdfTarget={id:\`wpsPdf\`,platforms:{linux:{label:\`WPS PDF\`,icon:\`apps/textmate.png\`,kind:\`editor\`,hidden:!0,detect:()=>Ii(\`wpspdf\`),args:e=>[e]}}},codexLinuxClionTarget={id:\`clion\`,platforms:{linux:{label:\`CLion\`,icon:${iconExpr("apps/intellij.png")},kind:\`editor\`,detect:()=>${commandExpr("clion")},args:codexLinuxJetBrainsArgs,supportsSsh:!0}}};`;
}

function patchedGhosttyAnchor() {
  return `${buildTargetDeclarations()}${GHOSTTY_ANCHOR}`;
}

function buildVisibleTargetDefinitionMarkers() {
  return [
    `linux:{label:\`Dolphin\`,icon:${iconExpr("apps/file-explorer.png")},detect:()=>${commandExpr("dolphin")}`,
    `linux:{label:\`VS Code\`,icon:${iconExpr("apps/vscode.png")},kind:\`editor\`,detect:()=>${commandExpr("code")}`,
    `linux:{label:\`PyCharm\`,icon:${iconExpr("apps/pycharm.png")},kind:\`editor\`,detect:()=>${commandExpr("pycharm")}`,
    `linux:{label:\`WebStorm\`,icon:${iconExpr("apps/webstorm.svg")},kind:\`editor\`,detect:()=>${commandExpr("webstorm")}`,
    `linux:{label:\`CLion\`,icon:${iconExpr("apps/intellij.png")},kind:\`editor\`,detect:()=>${commandExpr("clion")}`,
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

    let mainSource = bundleSources.main;

    mainSource = replaceOrThrow(
      mainSource,
      "ZT=vT({id:`fileManager`,label:`Finder`,icon:`apps/finder.png`,kind:`fileManager`,darwin:{detect:()=>`open`,args:e=>Ri(e)},win32:{label:`File Explorer`,icon:`apps/file-explorer.png`,detect:QT,args:e=>Ri(e),open:async({path:e})=>$T(e)}});function QT(){let e=process.env.SystemRoot??process.env.windir;if(e){let t=(0,i.join)(e,`explorer.exe`);if((0,o.existsSync)(t))return t}return`explorer.exe`}async function $T(e){let t=eE(e);if(t&&(0,o.statSync)(t).isFile()){n.shell.showItemInFolder(t);return}let r=t??e,i=await n.shell.openPath(r);if(i)throw Error(i)}function eE(e){let t=e;for(;;){if((0,o.existsSync)(t))return t;let e=(0,i.dirname)(t);if(e===t)return null;t=e}}var tE=ET({id:`ghostty`,label:`Ghostty`,icon:`apps/ghostty.png`,appPaths:[`/Applications/Ghostty.app`],appName:`Ghostty`}),",
      `ZT=vT({id:\`fileManager\`,label:\`Finder\`,icon:\`apps/finder.png\`,kind:\`fileManager\`,darwin:{detect:()=>\`open\`,args:e=>Ri(e)},win32:{label:\`File Explorer\`,icon:\`apps/file-explorer.png\`,detect:QT,args:e=>Ri(e),open:async({path:e})=>$T(e)},linux:{label:\`Dolphin\`,icon:${iconExpr("apps/file-explorer.png")},detect:()=>${commandExpr("dolphin")},open:async({command:e,path:t})=>{let r=eE(t);if(r&&(0,o.statSync)(r).isFile()){await Bi(e,[\`--new-window\`,\`--select\`,r]);return}await Bi(e,[\`--new-window\`,r??t])}}});function QT(){let e=process.env.SystemRoot??process.env.windir;if(e){let t=(0,i.join)(e,\`explorer.exe\`);if((0,o.existsSync)(t))return t}return\`explorer.exe\`}async function $T(e){let t=eE(e);if(t&&(0,o.statSync)(t).isFile()){n.shell.showItemInFolder(t);return}let r=t??e,i=await n.shell.openPath(r);if(i)throw Error(i)}function eE(e){let t=e;for(;;){if((0,o.existsSync)(t))return t;let e=(0,i.dirname)(t);if(e===t)return null;t=e}}var tE=ET({id:\`ghostty\`,label:\`Ghostty\`,icon:\`apps/ghostty.png\`,appPaths:[\`/Applications/Ghostty.app\`],appName:\`Ghostty\`}),`,
      "current upstream Linux file manager target",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "var UE=yT({id:`vscode`,label:`VS Code`,icon:`apps/vscode.png`,darwinDetect:()=>oT([`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`,`/Applications/Code.app/Contents/Resources/app/bin/code`]),win32Detect:WE});function WE(){return $i({pathCommand:Ii(`code`),executableName:`Code.exe`,installDirName:`Microsoft VS Code`})}",
      `var UE={id:\`vscode\`,platforms:{...yT({id:\`vscode\`,label:\`VS Code\`,icon:\`apps/vscode.png\`,darwinDetect:()=>oT([\`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code\`,\`/Applications/Code.app/Contents/Resources/app/bin/code\`]),win32Detect:WE}).platforms,linux:{label:\`VS Code\`,icon:${iconExpr("apps/vscode.png")},kind:\`editor\`,detect:()=>${commandExpr("code")},args:bT,supportsSsh:!0}}};function WE(){return $i({pathCommand:Ii(\`code\`),executableName:\`Code.exe\`,installDirName:\`Microsoft VS Code\`})}`,
      "current upstream VS Code Linux target",
    );

    mainSource = replaceOrThrow(
      mainSource,
      "vE=SE({id:`pycharm`,label:`PyCharm`,icon:`apps/pycharm.png`,toolboxTarget:`pycharm`,macExecutable:`pycharm`,windowsPathCommands:[`pycharm64.exe`,`pycharm.exe`,`pycharm`],windowsInstallDirPrefixes:[`pycharm`],windowsInstallExecutables:[`pycharm64.exe`,`pycharm.exe`]}),yE=SE({id:`webstorm`,label:`WebStorm`,icon:`apps/webstorm.svg`,toolboxTarget:`webstorm`,macExecutable:`webstorm`,windowsPathCommands:[`webstorm64.exe`,`webstorm.exe`,`webstorm`],windowsInstallDirPrefixes:[`webstorm`],windowsInstallExecutables:[`webstorm64.exe`,`webstorm.exe`]}),bE=SE({id:`phpstorm`,label:`PhpStorm`,icon:`apps/phpstorm.png`,toolboxTarget:`phpstorm`,macExecutable:`phpstorm`,windowsPathCommands:[`phpstorm64.exe`,`phpstorm.exe`,`phpstorm`],windowsInstallDirPrefixes:[`phpstorm`],windowsInstallExecutables:[`phpstorm64.exe`,`phpstorm.exe`]});function xE",
      `vE={id:\`pycharm\`,platforms:{...SE({id:\`pycharm\`,label:\`PyCharm\`,icon:\`apps/pycharm.png\`,toolboxTarget:\`pycharm\`,macExecutable:\`pycharm\`,windowsPathCommands:[\`pycharm64.exe\`,\`pycharm.exe\`,\`pycharm\`],windowsInstallDirPrefixes:[\`pycharm\`],windowsInstallExecutables:[\`pycharm64.exe\`,\`pycharm.exe\`]}).platforms,linux:{label:\`PyCharm\`,icon:${iconExpr("apps/pycharm.png")},kind:\`editor\`,detect:()=>${commandExpr("pycharm")},args:codexLinuxJetBrainsArgs,supportsSsh:!0}}},yE={id:\`webstorm\`,platforms:{...SE({id:\`webstorm\`,label:\`WebStorm\`,icon:\`apps/webstorm.svg\`,toolboxTarget:\`webstorm\`,macExecutable:\`webstorm\`,windowsPathCommands:[\`webstorm64.exe\`,\`webstorm.exe\`,\`webstorm\`],windowsInstallDirPrefixes:[\`webstorm\`],windowsInstallExecutables:[\`webstorm64.exe\`,\`webstorm.exe\`]}).platforms,linux:{label:\`WebStorm\`,icon:${iconExpr("apps/webstorm.svg")},kind:\`editor\`,detect:()=>${commandExpr("webstorm")},args:codexLinuxJetBrainsArgs,supportsSsh:!0}}},bE=SE({id:\`phpstorm\`,label:\`PhpStorm\`,icon:\`apps/phpstorm.png\`,toolboxTarget:\`phpstorm\`,macExecutable:\`phpstorm\`,windowsPathCommands:[\`phpstorm64.exe\`,\`phpstorm.exe\`,\`phpstorm\`],windowsInstallDirPrefixes:[\`phpstorm\`],windowsInstallExecutables:[\`phpstorm64.exe\`,\`phpstorm.exe\`]});function xE`,
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
      "var dD=[UE,GE,VE,KT,CT,XT,jE,aD,JE,xT,aE,PE,ZT,TT,nE,WT,XE,sE,tE,qE,eD,pE,mE,hE,gE,_E,vE,yE,bE,LE],fD=t.ti(`open-in-targets`);",
      "var dD=[UE,GE,VE,KT,CT,XT,jE,aD,JE,xT,aE,PE,ZT,codexLinuxGwenviewTarget,TT,nE,WT,XE,sE,tE,qE,eD,pE,mE,hE,gE,_E,vE,codexLinuxClionTarget,yE,bE,LE,codexLinuxTyporaTarget,codexLinuxWpsWriterTarget,codexLinuxWpsSpreadsheetsTarget,codexLinuxWpsPresentationTarget,codexLinuxWpsPdfTarget],fD=t.ti(`open-in-targets`);",
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
