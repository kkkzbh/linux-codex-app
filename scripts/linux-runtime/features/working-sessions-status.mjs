import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const IDENTIFIER = String.raw`[$A-Z_a-z][$\w]*`;
const ipcInitializerEntryRegex = new RegExp(
  String.raw`function (?<fn>${IDENTIFIER})\(\{buildFlavor:(?<buildFlavor>${IDENTIFIER}),getContextForWebContents:(?<getContext>${IDENTIFIER}),isTrustedIpcEvent:(?<isTrusted>${IDENTIFIER}),usesOwlAppShell:(?<usesOwl>${IDENTIFIER})\}\)\{(?<electron>${IDENTIFIER})\.ipcMain\.on\(`,
);
const trayThreadsNoopCaseRegex =
  /case`view-focused`:case`quit-app`:case`tray-menu-threads-changed`:break;/;

function workingSessionsStatusInjection(electronNamespace) {
  return `function codexLinuxWorkingSessionsStatusPath(){let e=process.env.CODEX_WORKING_SESSIONS_STATUS_PATH?.trim();if(e)return e;let t=process.env.XDG_RUNTIME_DIR?.trim();return t?require(\`node:path\`).join(t,\`codex-app\`,\`working-sessions.json\`):null}function codexLinuxWriteWorkingSessionsStatus(e,t=!0){if(process.platform!==\`linux\`)return;try{let n=codexLinuxWorkingSessionsStatusPath();if(!n)return;let r=Array.isArray(e?.trayMenuThreads?.runningThreads)?e.trayMenuThreads.runningThreads.length:0,i={schema:1,source:\`tray-menu-threads-changed\`,count:r,app_running:t,pid:process.pid,updated_at_ms:Date.now()},a=require(\`node:fs\`),o=require(\`node:path\`);a.mkdirSync(o.dirname(n),{recursive:!0});let s=\`\${n}.\${process.pid}.\${Date.now()}.tmp\`;a.writeFileSync(s,JSON.stringify(i),{encoding:\`utf8\`,mode:384}),a.renameSync(s,n)}catch{}}process.platform===\`linux\`&&${electronNamespace}.app.on(\`before-quit\`,()=>{codexLinuxWriteWorkingSessionsStatus({trayMenuThreads:{runningThreads:[]}},!1)});`;
}

function replaceIpcInitializerEntry(...args) {
  const groups = args.at(-1);
  if (!groups || typeof groups !== "object") {
    throw new Error("working sessions status writer patch expected named regex groups");
  }

  const { fn, buildFlavor, getContext, isTrusted, usesOwl, electron } = groups;
  return `${workingSessionsStatusInjection(electron)}function ${fn}({buildFlavor:${buildFlavor},getContextForWebContents:${getContext},isTrustedIpcEvent:${isTrusted},usesOwlAppShell:${usesOwl}}){${electron}.ipcMain.on(`;
}

export const workingSessionsStatusFeature = {
  id: "working-sessions-status",
  version: 5,
  requiredMarkers: FEATURE_MARKERS["working-sessions-status"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["working-sessions-status"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let mainSource = bundleSources.main;

    mainSource = replaceOrThrow(
      mainSource,
      ipcInitializerEntryRegex,
      replaceIpcInitializerEntry,
      "main bundle Linux working sessions status writer",
      {
        appliedMarkers: [
          "codexLinuxWorkingSessionsStatusPath",
          "codexLinuxWriteWorkingSessionsStatus",
        ],
      },
    );

    mainSource = replaceOrThrow(
      mainSource,
      trayThreadsNoopCaseRegex,
      "case`view-focused`:case`quit-app`:case`tray-menu-threads-changed`:codexLinuxWriteWorkingSessionsStatus(a);break;",
      "main bundle Linux working sessions tray update hook",
      {
        appliedMarkers: [/case`view-focused`:case`quit-app`:case`tray-menu-threads-changed`:codexLinuxWriteWorkingSessionsStatus\([$A-Z_a-z][$\w]*\);break;/],
      },
    );

    return {
      ...bundleSources,
      main: mainSource,
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.main,
      this.requiredMarkers,
      "Linux working sessions status patch",
    );
    ensureMarkersAbsent(
      bundleSources.main,
      this.forbiddenMarkers,
      "Linux working sessions status patch",
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
